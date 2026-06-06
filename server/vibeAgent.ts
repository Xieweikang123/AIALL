import fs from "node:fs";
import path from "node:path";
import { chatCompletionWithTools, type ChatCompletionMessage, type ChatToolCall } from "./aiForward";
import {
  TextToolCallStreamFilter,
  hasTextToolCallMarkup,
  stripTextToolCallMarkup,
  synthesizeToolCallsFromText,
} from "./textToolCalls";
import { resolveAgentMaxTurns } from "./agentTurnBudget";
import {
  buildProjectContext,
  formatProjectContextForBuild,
  formatProjectContextForPrompt,
} from "./vibeProjectContext";
import {
  grepInProject,
  listDirectory,
  readFileContent,
  resolveProjectPath,
  searchFiles,
  sliceFileLines,
} from "./vibeFs";

export type VibeAgentEvent =
  | {
      type: "status";
      data: {
        phase: string;
        turn?: number;
        maxTurns?: number;
        openFile?: string;
        model?: string;
        retryAttempt?: number;
        retryMaxAttempts?: number;
        retryError?: string;
      };
    }
  | { type: "tool_start"; data: { id: string; name: string; args: Record<string, unknown> } }
  | { type: "tool_end"; data: { id: string; name: string; ok: boolean; summary: string; result?: string } }
  | { type: "message"; data: { text: string } }
  | { type: "message_delta"; data: { delta: string } }
  | { type: "file_diff"; data: { path: string; before: string; after: string; deleted?: boolean; created?: boolean } }
  | {
      type: "agent_context";
      data: {
        mode: VibeChatMode;
        systemPrompt: string;
        history: Array<{ role: string; content: string }>;
        projectContext?: string;
        maxTurns?: number;
        model?: string;
        openFile?: string;
      };
    }
  | {
      type: "turn_trace";
      data: { turn: number; maxTurns?: number; assistantText: string; hasToolCalls: boolean };
    }
  | { type: "error"; data: { message: string } }
  | { type: "done"; data: { writtenFiles: string[]; pendingFiles: string[]; turns: number } };

export type VibeChatMode = "ask" | "build";

export type VibeChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export interface RunVibeAgentParams {
  projectRoot: string;
  prompt: string;
  history?: VibeChatHistoryMessage[];
  openFilePath?: string;
  endpoint: string;
  apiKey?: string;
  model: string;
  mode?: VibeChatMode;
  maxTurns?: number;
  onEvent: (event: VibeAgentEvent) => void;
  signal?: AbortSignal;
}

const MAX_HISTORY_MESSAGES = 40;
const MAX_HISTORY_CHARS = 120_000;
const MAX_SSE_TEXT_CHARS = 24_000;
const MAX_TOOL_RESULT_SSE_CHARS = 16_000;
function truncateForSse(text: string, max = MAX_SSE_TEXT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n…（已截断，共 ${text.length} 字符）`;
}

function historyForDisplay(history?: VibeChatHistoryMessage[]): Array<{ role: string; content: string }> {
  return buildHistoryMessages(history).map((m) => ({
    role: m.role,
    content: truncateForSse(String(m.content || ""), 4000),
  }));
}

function emitAgentContext(
  onEvent: RunVibeAgentParams["onEvent"],
  data: Extract<VibeAgentEvent, { type: "agent_context" }>["data"],
) {
  onEvent({
    type: "agent_context",
    data: {
      ...data,
      systemPrompt: truncateForSse(data.systemPrompt),
      projectContext: data.projectContext ? truncateForSse(data.projectContext) : undefined,
    },
  });
}

function buildHistoryMessages(history?: VibeChatHistoryMessage[]): ChatCompletionMessage[] {
  if (!history?.length) return [];

  const trimmed = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
    .slice(-MAX_HISTORY_MESSAGES);

  let totalChars = 0;
  const result: ChatCompletionMessage[] = [];
  for (let i = trimmed.length - 1; i >= 0; i -= 1) {
    const item = trimmed[i];
    const len = item.content.length;
    if (totalChars + len > MAX_HISTORY_CHARS && result.length > 0) break;
    totalChars += len;
    result.unshift({ role: item.role, content: item.content });
  }
  return result;
}

const VIBE_AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "列出目录下的文件和子目录。path 为相对项目根的路径，空字符串表示根目录。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对项目根的路径，默认 ''" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取文本文件。支持 offset/limit 按行读取大文件。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对项目根的文件路径" },
          offset: { type: "number", description: "起始行号，从 1 开始，默认 1" },
          limit: { type: "number", description: "读取行数，默认 500，最大 800" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep",
      description: "在项目内搜索文本（正则或关键词）。",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "搜索模式" },
          max_matches: { type: "number", description: "最大匹配数，默认 40" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "按文件名关键词搜索文件。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "文件名关键词" },
          max_results: { type: "number", description: "最大结果数，默认 30" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "写入或覆盖文件（Build 模式下本轮 Agent 结束后自动落盘）。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对项目根的文件路径" },
          content: { type: "string", description: "完整文件内容" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "删除文件（Build 模式下本轮 Agent 结束后自动执行）。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对项目根的文件路径" },
        },
        required: ["path"],
      },
    },
  },
];

const READ_ONLY_AGENT_TOOLS = VIBE_AGENT_TOOLS.filter((t) =>
  ["list_dir", "read_file", "grep", "search_files"].includes(t.function.name),
);

function buildSystemPrompt(projectRoot: string, openFilePath?: string): string {
  const lines = [
    "你是一个专业的编程 Agent（Build 模式），可以调用工具探索并修改本地项目。",
    "回答请使用中文。",
    "工作流程：先 list_dir / grep / read_file 收集必要信息，再回答或 write_file / delete_file 修改代码。",
    "解释项目时：从 package.json、README、入口文件等关键文件入手，不要臆测。",
    "修改代码时：先 read_file 确认现状，再 write_file 写入完整文件内容；本轮 Agent 结束后修改会自动落盘，无需用户确认。",
    "删除文件时：使用 delete_file 工具，不要用 write_file 清空内容来替代删除；删除同样会在本轮结束时自动执行。",
    "重要：必须通过 API 工具接口调用 list_dir、read_file 等，禁止在正文里输出 <function>、<parameter> 等标记。",
    "工具 path 参数使用相对项目根的路径（如 package.json、src/main.ts），不要用绝对路径。",
    `项目根目录：${projectRoot}`,
  ];
  const openFile = resolveOpenFileInProject(projectRoot, openFilePath);
  if (openFile) {
    lines.push(`用户当前打开的文件：${openFile.relative}`);
  }
  return lines.join("\n");
}

function resolveOpenFileInProject(projectRoot: string, openFilePath?: string): { path: string; relative: string } | null {
  if (!openFilePath?.trim()) return null;
  const resolved = resolveProjectPath(projectRoot, openFilePath.trim());
  if (!resolved.ok || !resolved.relative) return null;
  return { path: resolved.path, relative: resolved.relative };
}

function buildAskSystemPrompt(
  projectRoot: string,
  openFilePath?: string,
  openFileSnippet?: string,
): string {
  const lines = [
    "你是一个编程问答助手（Ask 模式）。",
    "回答请使用中文。",
    "你可以使用 list_dir、read_file、grep、search_files 工具来探索项目、读取文件，但不能修改任何文件。",
    "若信息不足，请主动使用工具查找相关内容，而不是要求用户打开文件。",
    `项目根目录：${projectRoot}`,
  ];
  const openFile = resolveOpenFileInProject(projectRoot, openFilePath);
  if (openFile) {
    lines.push(`用户当前打开的文件：${openFile.relative}`);
    if (openFileSnippet?.trim()) {
      lines.push("", "当前打开文件内容（节选）：", "```", openFileSnippet.trim(), "```");
    }
  }
  return lines.join("\n");
}

function buildDoneData(stage: WriteStage | null, turns: number) {
  if (!stage) {
    return { writtenFiles: [] as string[], pendingFiles: [] as string[], turns };
  }
  return {
    writtenFiles: [...stage.files.keys(), ...stage.deletions],
    pendingFiles: [...stage.pendingList],
    turns,
  };
}

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function resolveToolCallsFromAssistant(content: string, apiToolCalls: ChatToolCall[]): ChatToolCall[] {
  if (apiToolCalls.length) return apiToolCalls;
  if (!hasTextToolCallMarkup(content)) return [];
  return synthesizeToolCallsFromText(content);
}

function toolSummary(name: string, result: string): string {
  if (result.startsWith("错误：")) {
    return result.replace(/^错误：/, "").trim();
  }

  if (name === "list_dir") {
    if (result === "（空目录）") return "空目录";
    const lines = result.split("\n").filter(Boolean);
    const dirs = lines.filter((l) => l.startsWith("[dir]")).length;
    const files = lines.filter((l) => l.startsWith("[file]")).length;
    return `${dirs} 个目录，${files} 个文件`;
  }

  if (name === "read_file") {
    const lineCount = result.split("\n").filter((l) => l.length > 0).length;
    return `读取 ${lineCount} 行内容`;
  }

  if (name === "grep") {
    if (result === "（无匹配）") return "未找到匹配";
    const n = result.split("\n").filter(Boolean).length;
    return `找到 ${n} 处匹配`;
  }

  if (name === "search_files") {
    if (result === "（无匹配文件）") return "未找到文件";
    const n = result.split("\n").filter(Boolean).length;
    return `找到 ${n} 个文件`;
  }

  if (name === "write_file") {
    const staged = result.match(/已暂存\s+(.+?)（(\d+)\s*字符）/);
    if (staged) return `已暂存 ${staged[1]}（${staged[2]} 字符），待确认`;
    const m = result.match(/已写入\s+(.+?)（(\d+)\s*字符）/);
    if (m) return `已写入 ${m[1]}（${m[2]} 字符）`;
    return result;
  }

  if (name === "delete_file") {
    const m = result.match(/已暂存删除\s+(.+?)，/);
    if (m) return `待删除 ${m[1]}`;
    return result;
  }

  const oneLine = result.replace(/\s+/g, " ").trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine;
}

type WriteStage = {
  files: Map<string, string>;
  deletions: Set<string>;
  pendingList: string[];
};

function createWriteStage(): WriteStage {
  return { files: new Map(), deletions: new Set(), pendingList: [] };
}

async function readStagedFileContent(
  root: string,
  relative: string,
  absPath: string,
  stage: WriteStage | null,
): Promise<string | null> {
  if (stage?.files.has(relative)) return stage.files.get(relative)!;
  const result = await readFileContent(absPath).catch(() => null);
  return result?.ok ? result.content : null;
}

async function executeTool(
  projectRoot: string,
  name: string,
  args: Record<string, unknown>,
  stage: WriteStage | null,
  mode: VibeChatMode = "build",
): Promise<string> {
  if (mode === "ask" && (name === "write_file" || name === "delete_file")) {
    return "Ask 模式下不支持文件修改，请仅使用只读工具查询项目。";
  }
  if (!stage && (name === "write_file" || name === "delete_file")) {
    return "错误：当前模式不支持写文件";
  }
  const root = path.resolve(projectRoot);

  if (name === "list_dir") {
    const rel = String(args.path ?? "").trim();
    const resolved = rel ? resolveProjectPath(root, rel) : { ok: true as const, path: root, relative: "" };
    if (!resolved.ok) return `错误：${resolved.error}`;
    const stat = await fs.promises.stat(resolved.path).catch(() => null);
    if (!stat?.isDirectory()) return `错误：不是目录 ${resolved.relative || "."}`;
    const items = await listDirectory(resolved.path);
    const baseRel = resolved.relative;
    const lines = items.map((item) => {
      const rel = baseRel ? `${baseRel}/${item.name}` : item.name;
      return `${item.isDirectory ? "[dir]" : "[file]"} ${rel}`;
    });
    return lines.length ? lines.join("\n") : "（空目录）";
  }

  if (name === "read_file") {
    const filePath = String(args.path || "").trim();
    if (!filePath) return "错误：缺少 path";
    const resolved = resolveProjectPath(root, filePath);
    if (!resolved.ok) return `错误：${resolved.error}`;
    const content = await readStagedFileContent(root, resolved.relative, resolved.path, stage);
    if (content === null) return `错误：${resolved.relative} 不存在或无法读取`;
    const offset = Number(args.offset) || 1;
    const limit = Math.min(800, Math.max(1, Number(args.limit) || 500));
    return sliceFileLines(content, offset, limit);
  }

  if (name === "grep") {
    const pattern = String(args.pattern || "").trim();
    if (!pattern) return "错误：缺少 pattern";
    const maxMatches = Math.min(80, Math.max(1, Number(args.max_matches) || 40));
    const result = await grepInProject(root, pattern, maxMatches);
    if (!result.ok) return `错误：${result.error}`;
    if (!result.matches.length) return "（无匹配）";
    return result.matches
      .map((m) => `${m.relative}:${m.line}: ${m.text}`)
      .join("\n");
  }

  if (name === "search_files") {
    const query = String(args.query || "").trim();
    if (!query) return "错误：缺少 query";
    const maxResults = Math.min(50, Math.max(1, Number(args.max_results) || 30));
    const results = await searchFiles(root, query, maxResults);
    if (!results.length) return "（无匹配文件）";
    return results.map((r) => `${r.isDirectory ? "[dir]" : "[file]"} ${r.relative}`).join("\n");
  }

  if (name === "write_file") {
    const filePath = String(args.path || "").trim();
    const content = args.content;
    if (!filePath) return "错误：缺少 path";
    if (typeof content !== "string") return "错误：缺少 content";
    const resolved = resolveProjectPath(root, filePath);
    if (!resolved.ok) return `错误：${resolved.error}`;
    stage.deletions.delete(resolved.relative);
    stage.files.set(resolved.relative, content);
    if (!stage.pendingList.includes(resolved.relative)) {
      stage.pendingList.push(resolved.relative);
    }
    return `已记录 ${resolved.relative}（${content.length} 字符），本轮结束后将自动写入磁盘`;
  }

  if (name === "delete_file") {
    const filePath = String(args.path || "").trim();
    if (!filePath) return "错误：缺少 path";
    const resolved = resolveProjectPath(root, filePath);
    if (!resolved.ok) return `错误：${resolved.error}`;
    const stat = await fs.promises.stat(resolved.path).catch(() => null);
    if (!stat?.isFile()) return `错误：${resolved.relative} 不是文件或不存在`;
    stage.files.delete(resolved.relative);
    stage.deletions.add(resolved.relative);
    if (!stage.pendingList.includes(resolved.relative)) {
      stage.pendingList.push(resolved.relative);
    }
    return `已记录删除 ${resolved.relative}，本轮结束后将自动执行`;
  }

  return `错误：未知工具 ${name}`;
}

export async function runVibeAgent(params: RunVibeAgentParams): Promise<void> {
  const mode = params.mode ?? "build";
  const isAsk = mode === "ask";
  const {
    projectRoot,
    prompt,
    openFilePath,
    endpoint,
    apiKey,
    model,
    onEvent,
    signal,
  } = params;

  const maxTurns =
    params.maxTurns ??
    resolveAgentMaxTurns({ mode, prompt, history: params.history });

  const openFile = resolveOpenFileInProject(projectRoot, openFilePath);
  const openFileRel = openFile?.relative;

  onEvent({
    type: "status",
    data: {
      phase: "preparing",
      maxTurns,
      model,
      ...(openFileRel ? { openFile: openFileRel } : {}),
    },
  });

  let openFileSnippet = "";
  if (openFile) {
    const result = await readFileContent(openFile.path).catch(() => null);
    if (result?.ok) {
      openFileSnippet = sliceFileLines(result.content, 1, 400);
    }
  }

  let projectContextBlock = "";
  const projectContext = await buildProjectContext(projectRoot);
  if (projectContext.ok) {
    projectContextBlock = isAsk
      ? formatProjectContextForPrompt(projectContext)
      : formatProjectContextForBuild(projectContext);
  }

  const systemPrompt =
    (isAsk
      ? buildAskSystemPrompt(projectRoot, openFilePath, openFileSnippet)
      : buildSystemPrompt(projectRoot, openFilePath)) + projectContextBlock;

  const writeStage = isAsk ? null : createWriteStage();
  const activeTools = isAsk ? READ_ONLY_AGENT_TOOLS : VIBE_AGENT_TOOLS;
  const messages: ChatCompletionMessage[] = [
    { role: "system", content: systemPrompt },
    ...buildHistoryMessages(params.history),
    { role: "user", content: prompt },
  ];

  emitAgentContext(onEvent, {
    mode,
    systemPrompt,
    history: historyForDisplay(params.history),
    projectContext: projectContextBlock || undefined,
    maxTurns,
    model,
    ...(openFileRel ? { openFile: openFileRel } : {}),
  });

  if (signal?.aborted) {
    onEvent({ type: "status", data: { phase: "aborted" } });
    onEvent({ type: "done", data: buildDoneData(writeStage, 0) });
    return;
  }

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    if (signal?.aborted) {
      onEvent({ type: "status", data: { phase: "aborted", turn, maxTurns } });
      onEvent({ type: "done", data: buildDoneData(writeStage, turn - 1) });
      return;
    }

    onEvent({ type: "status", data: { phase: "waiting_model", turn, maxTurns, model } });

    let streamedChars = 0;
    const streamFilter = new TextToolCallStreamFilter();
    let modelStatusPhase: "waiting_model" | "retrying_model" = "waiting_model";
    const heartbeat = setInterval(() => {
      if (signal?.aborted) return;
      onEvent({
        type: "status",
        data: { phase: modelStatusPhase, turn, maxTurns, model },
      });
    }, 12_000);
    let completion: Awaited<ReturnType<typeof chatCompletionWithTools>>;
    try {
      completion = await chatCompletionWithTools({
        endpoint,
        apiKey,
        model,
        messages,
        tools: activeTools,
        signal,
        onContentDelta: (delta) => {
          const userDelta = streamFilter.push(delta);
          if (userDelta) {
            streamedChars += userDelta.length;
            onEvent({ type: "message_delta", data: { delta: userDelta } });
          }
        },
        onAttemptStart: () => {
          modelStatusPhase = "waiting_model";
          onEvent({ type: "status", data: { phase: "waiting_model", turn, maxTurns, model } });
        },
        onRetry: ({ attempt, maxAttempts, error }) => {
          modelStatusPhase = "retrying_model";
          onEvent({
            type: "status",
            data: {
              phase: "retrying_model",
              turn,
              maxTurns,
              model,
              retryAttempt: attempt,
              retryMaxAttempts: maxAttempts,
              retryError: error,
            },
          });
        },
      });
    } finally {
      clearInterval(heartbeat);
    }

    if (!completion.ok || !completion.message) {
      onEvent({ type: "error", data: { message: completion.error || "模型请求失败" } });
      onEvent({ type: "done", data: buildDoneData(writeStage, turn) });
      return;
    }

    const assistant = completion.message;
    const rawContent = String(assistant.content || "");
    const toolCalls = resolveToolCallsFromAssistant(rawContent, assistant.tool_calls || []);
    const visibleContent = stripTextToolCallMarkup(rawContent);

    if (!toolCalls.length) {
      const text = visibleContent.trim();
      if (text && !streamedChars) {
        onEvent({ type: "message", data: { text } });
      }
      onEvent({ type: "status", data: { phase: "finished", turn, maxTurns } });
      onEvent({ type: "done", data: buildDoneData(writeStage, turn) });
      return;
    }

    if (visibleContent.trim()) {
      onEvent({
        type: "turn_trace",
        data: { turn, maxTurns, assistantText: visibleContent.trim(), hasToolCalls: true },
      });
    }

    messages.push({
      role: "assistant",
      content: visibleContent || null,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      if (signal?.aborted) break;

      const toolName = call.function.name;
      const toolArgs = parseToolArgs(call.function.arguments || "{}");

      onEvent({ type: "tool_start", data: { id: call.id, name: toolName, args: toolArgs } });

      let pendingDiff: Extract<VibeAgentEvent, { type: "file_diff" }> | null = null;
      if (writeStage && (toolName === "write_file" || toolName === "delete_file")) {
        const filePath = String(toolArgs.path || "").trim();
        if (filePath) {
          const resolved = resolveProjectPath(projectRoot, filePath);
          if (resolved.ok) {
            const staged = await readStagedFileContent(
              projectRoot,
              resolved.relative,
              resolved.path,
              writeStage,
            );
            pendingDiff = {
              type: "file_diff",
              data: {
                path: resolved.relative,
                before: staged ?? "",
                after: toolName === "delete_file" ? "" : String(toolArgs.content ?? ""),
                deleted: toolName === "delete_file",
                created: toolName === "write_file" && staged === null,
              },
            };
          }
        }
      }

      let result = "";
      try {
        result = await executeTool(projectRoot, toolName, toolArgs, writeStage, mode);
      } catch (error) {
        result = `错误：${error instanceof Error ? error.message : String(error)}`;
      }

      if (pendingDiff && !result.startsWith("错误：")) {
        onEvent(pendingDiff);
      }

      onEvent({
        type: "tool_end",
        data: {
          id: call.id,
          name: toolName,
          ok: !result.startsWith("错误："),
          summary: toolSummary(toolName, result),
          result: truncateForSse(result, MAX_TOOL_RESULT_SSE_CHARS),
        },
      });

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }
  }

  onEvent({ type: "status", data: { phase: "finished", turn: maxTurns, maxTurns } });
  if (!isAsk && writeStage?.pendingList.length) {
    onEvent({ type: "error", data: { message: `已达最大轮次（${maxTurns}），任务可能未完成。` } });
  }
  onEvent({ type: "done", data: buildDoneData(writeStage, maxTurns) });
}
