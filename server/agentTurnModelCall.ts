import {
  AGENT_AI_MAX_RETRIES,
  chatCompletionWithTools,
  type ChatCompletionMessage,
  type ChatToolCall,
  type ModelStreamProgress,
} from "./aiForward";
import { stripTextToolCallMarkup } from "./textToolCalls";
import { resolveToolCallsFromAssistant, buildDoneData } from "./agentClassifier";
import {
  compactMessagesForModel,
  formatCharCount,
  formatElapsedMs,
  messageCharSize,
  MAX_TOOL_RESULT_SSE_CHARS,
} from "./agentContext";
import { streamProgressDetail, streamProgressPhase, emitUserVisibleAssistantMessage } from "./agentStream";
import { isVisionUnsupportedError } from "./visionMessage";
import type { AgentTurnContext } from "./agentTurnContext";
import type { VibeAgentEvent } from "../shared/agentTypes";

export interface ModelCallParams {
  turn: number;
  toolsForTurn: { type: "function"; function: { name: string; description: string; parameters: object } }[];
  resolveFirstByteTimeoutMs?: ReturnType<typeof import("./aiForward")["resolveFirstByteTimeoutMs"]>;
}

export interface ModelCallResult {
  action: "return" | "continue" | "next";
  rawContent: string;
  visibleContent: string;
  toolCalls: ChatToolCall[];
  streamedChars: number;
}

/**
 * Call the LLM and handle truncation retries and vision fallback (Block 10).
 */
export async function runTurnModelCall(
  ctx: AgentTurnContext,
  params: ModelCallParams,
  onEvent: (event: VibeAgentEvent) => void,
  signal?: AbortSignal,
): Promise<ModelCallResult> {
  const cfg = ctx.runConfig;
  const {
    turn,
    toolsForTurn,
    resolveFirstByteTimeoutMs,
  } = params;
  const {
    endpoint,
    apiKey,
    model,
    maxContextChars,
    imageDataUrls,
    prompt,
    runPolicy: { readOnlyBuildRun },
    isReadOnlyAgent,
  } = cfg;

  const firstByteTimeoutMs = (resolveFirstByteTimeoutMs as (m: string) => number | undefined)?.(model) ?? undefined;
  let modelStatusPhase = "waiting_model";
  let modelWaitStartedAt: number | null = null;
  let streamedChars = 0;
  let streamedMsgContent = "";
  let streamedContentChunks: string[] = [];

  const heartbeat = setInterval(() => {
    if (signal?.aborted || modelWaitStartedAt === null) return;
    const elapsedMs = Date.now() - modelWaitStartedAt;
    onEvent({
      type: "status",
      data: {
        phase: modelStatusPhase,
        turn,
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
        model,
        detail: `已等待 ${formatElapsedMs(elapsedMs)}`,
        elapsedMs,
      },
    });
  }, 2000);

  try {
    const compactedMessages = compactMessagesForModel(ctx.messages, maxContextChars);
    const contextChars = compactedMessages.reduce((sum, m) => sum + messageCharSize(m), 0);
    onEvent({
      type: "status",
      data: {
        phase: "compacting_context",
        turn,
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
        model,
        detail: `${compactedMessages.length} 条消息 · ${formatCharCount(contextChars)} 上下文`,
        contextMessages: compactedMessages.length,
        contextChars,
      },
    });
    onEvent({
      type: "turn_request",
      data: {
        turn,
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
        contextMessages: compactedMessages.length,
        contextChars,
      },
    });

    modelWaitStartedAt = Date.now();
    onEvent({
      type: "status",
      data: {
        phase: modelStatusPhase,
        turn,
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
        model,
        detail: "已等待 0s",
        elapsedMs: 0,
      },
    });

    const completion = await chatCompletionWithTools({
      endpoint,
      apiKey,
      model,
      messages: compactedMessages,
      tools: toolsForTurn,
      maxRetries: AGENT_AI_MAX_RETRIES,
      signal,
      onStreamProgress: (progress: ModelStreamProgress) => {
        if (progress.type === "status") {
          const nextPhase = streamProgressPhase(progress);
          if (nextPhase) modelStatusPhase = nextPhase;
        }
        if (progress.type === "content_delta") {
          onEvent({ type: "message_delta", data: { delta: progress.delta } });
          streamedChars += progress.delta.length;
          streamedMsgContent += progress.delta;
          streamedContentChunks.push(progress.delta);
        }
        const detail = streamProgressDetail(progress);
        if (detail) {
          onEvent({
            type: "status",
            data: {
              phase: "streaming_model",
              turn,
              ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
              model,
              detail,
            },
          });
        }
      },
      onFirstByte: () => {
        modelStatusPhase = "streaming_model";
      },
      onRetry: ({ attempt, maxAttempts, error }) => {
        modelStatusPhase = "retrying_model";
        onEvent({
          type: "status",
          data: {
            phase: "retrying_model",
            turn,
            ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
            model,
            retryAttempt: attempt,
            retryMaxAttempts: maxAttempts,
            retryError: error,
          },
        });
      },
    });

    if (!completion.ok || !completion.message) {
      // Vision fallback
      if (!ctx.visionFallbackApplied && imageDataUrls.length > 0 && isVisionUnsupportedError(completion.error)) {
        ctx.visionFallbackApplied = true;
        ctx.visionFirstTurnPending = false;
        const userIndex = ctx.messages.findIndex((m) => m.role === "user");
        if (userIndex >= 0) {
          ctx.messages[userIndex] = {
            role: "user",
            content: `${prompt}\n\n（注：当前模型不支持图片输入，已忽略 ${imageDataUrls.length} 张附带图片，请仅根据文字继续。）`,
          };
        }
        onEvent({
          type: "status",
          data: {
            phase: "vision_fallback",
            turn,
            ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
            model,
            detail: "当前模型不支持视觉输入，已降级为纯文本请求",
          },
        });
        return { action: "continue", rawContent: "", visibleContent: "", toolCalls: [], streamedChars };
      }

      onEvent({ type: "error", data: { message: completion.error || "模型请求失败" } });
      onEvent({ type: "done", data: buildDoneData(ctx.writeStage, turn) });
      return { action: "return", rawContent: "", visibleContent: "", toolCalls: [], streamedChars };
    }

    // Truncation retry
    if (completion.finish_reason === "length" && !completion.message.tool_calls?.length) {
      if (ctx.truncationRetryCount < 5) {
        ctx.truncationRetryCount += 1;
        onEvent({
          type: "status",
          data: {
            phase: "streaming_model",
            turn,
            ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
            model,
            detail: `内容较长，正在自动补充完成（第 ${ctx.truncationRetryCount}/5 次）…`,
          },
        });
        const truncatedText = String(completion.message.content || "");
        if (truncatedText.trim()) {
          ctx.messages.push({ role: "assistant", content: truncatedText });
          const hasToolCalls = truncatedText.includes("patch_file") || truncatedText.includes("write_file") ||
            truncatedText.includes("read_file") || truncatedText.includes("grep") || truncatedText.includes("search_files");
          const hasPartialCode = truncatedText.includes("```") && !truncatedText.match(/```\s*$/m);
          let continueHint: string;
          if (hasToolCalls && !hasPartialCode) {
            continueHint = readOnlyBuildRun
              ? "你的上一次回复因内容较多被截断。只读工具结果已有，请勿重复 grep/read 或调用写工具；直接完成剩余分析与结论。"
              : "你的上一次回复因内容较多被截断，之前的工具调用已成功执行，无需重复。" +
                "请继续完成剩余的分析和总结；如果任务已完成，直接输出简短结论即可。";
          } else if (hasPartialCode) {
            continueHint =
              "你的上一次回复因内容较多被截断，你正在写入代码/内容。" +
              "请从截断处继续完成当前代码块，不要重新开始。";
          } else {
            continueHint =
              "你的上一次回复因内容较多被截断。" +
              "请从被截断的地方继续，不要重复已输出的内容。" +
              "如果任务已完成，直接输出简短结论即可。";
          }
          ctx.messages.push({ role: "user", content: continueHint });
        }
        return { action: "continue", rawContent: "", visibleContent: "", toolCalls: [], streamedChars };
      }
      ctx.outputTruncated = true;
    }

    const rawContent = String(completion.message.content || "");
    const toolCalls = resolveToolCallsFromAssistant(rawContent, completion.message.tool_calls || []);
    const visibleContent = stripTextToolCallMarkup(rawContent);

    return { action: "next", rawContent, visibleContent, toolCalls, streamedChars };
  } finally {
    clearInterval(heartbeat);
  }
}
