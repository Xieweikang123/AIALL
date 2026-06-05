import fs from "node:fs";
import path from "node:path";
import { chatCompletionWithTools, type ChatCompletionMessage } from "./aiForward";
import {
  grepInProject,
  listDirectory,
  readFileContent,
  resolveProjectPath,
  searchFiles,
  sliceFileLines,
  writeFileContent,
} from "./vibeFs";

export type VibeAgentEvent =
  | { type: "status"; data: { phase: string; turn?: number; maxTurns?: number } }
  | { type: "tool_start"; data: { id: string; name: string; args: Record<string, unknown> } }
  | { type: "tool_end"; data: { id: string; name: string; ok: boolean; summary: string } }
  | { type: "message"; data: { text: string } }
  | { type: "error"; data: { message: string } }
  | { type: "done"; data: { writtenFiles: string[]; turns: number } };

export interface RunVibeAgentParams {
  projectRoot: string;
  prompt: string;
  openFilePath?: string;
  endpoint: string;
  apiKey?: string;
  model: string;
  maxTurns?: number;
  onEvent: (event: VibeAgentEvent) => void;
  signal?: AbortSignal;
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
      description: "写入或覆盖文件内容。",
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
];

function buildSystemPrompt(projectRoot: string, openFilePath?: string): string {
  const lines = [
    "你是一个专业的编程 Agent，可以调用工具探索并修改本地项目。",
    "回答请使用中文。",
    "工作流程：先 list_dir / grep / read_file 收集必要信息，再回答或 write_file 修改代码。",
    "解释项目时：从 package.json、README、入口文件等关键文件入手，不要臆测。",
    "修改代码时：先 read_file 确认现状，再 write_file 写入完整文件。",
    `项目根目录：${projectRoot}`,
  ];
  if (openFilePath?.trim()) {
    const rel = path.relative(projectRoot, path.resolve(openFilePath)).replace(/\\/g, "/");
    lines.push(`用户当前打开的文件：${rel}`);
  }
  return lines.join("\n");
}

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toolSummary(name: string, result: string): string {
  const oneLine = result.replace(/\s+/g, " ").trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine;
}

async function executeTool(
  projectRoot: string,
  name: string,
  args: Record<string, unknown>,
  writtenFiles: string[],
): Promise<string> {
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
    const result = await readFileContent(resolved.path);
    if (!result.ok) return `错误：${result.error}`;
    const offset = Number(args.offset) || 1;
    const limit = Math.min(800, Math.max(1, Number(args.limit) || 500));
    return sliceFileLines(result.content, offset, limit);
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
    await writeFileContent(resolved.path, content);
    if (!writtenFiles.includes(resolved.relative)) {
      writtenFiles.push(resolved.relative);
    }
    return `已写入 ${resolved.relative}（${content.length} 字符）`;
  }

  return `错误：未知工具 ${name}`;
}

export async function runVibeAgent(params: RunVibeAgentParams): Promise<void> {
  const {
    projectRoot,
    prompt,
    openFilePath,
    endpoint,
    apiKey,
    model,
    maxTurns = 12,
    onEvent,
    signal,
  } = params;

  const writtenFiles: string[] = [];
  const messages: ChatCompletionMessage[] = [
    { role: "system", content: buildSystemPrompt(projectRoot, openFilePath) },
    { role: "user", content: prompt },
  ];

  onEvent({ type: "status", data: { phase: "starting", maxTurns } });

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    if (signal?.aborted) {
      onEvent({ type: "status", data: { phase: "aborted", turn, maxTurns } });
      onEvent({ type: "done", data: { writtenFiles, turns: turn - 1 } });
      return;
    }

    onEvent({ type: "status", data: { phase: "thinking", turn, maxTurns } });

    const completion = await chatCompletionWithTools({
      endpoint,
      apiKey,
      model,
      messages,
      tools: VIBE_AGENT_TOOLS,
    });

    if (!completion.ok || !completion.message) {
      onEvent({ type: "error", data: { message: completion.error || "模型请求失败" } });
      onEvent({ type: "done", data: { writtenFiles, turns: turn } });
      return;
    }

    const assistant = completion.message;
    const toolCalls = assistant.tool_calls || [];

    if (!toolCalls.length) {
      const text = String(assistant.content || "").trim();
      if (text) {
        onEvent({ type: "message", data: { text } });
      }
      onEvent({ type: "status", data: { phase: "finished", turn, maxTurns } });
      onEvent({ type: "done", data: { writtenFiles, turns: turn } });
      return;
    }

    messages.push({
      role: "assistant",
      content: assistant.content ?? null,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      if (signal?.aborted) break;

      const toolName = call.function.name;
      const toolArgs = parseToolArgs(call.function.arguments || "{}");

      onEvent({ type: "tool_start", data: { id: call.id, name: toolName, args: toolArgs } });

      let result = "";
      try {
        result = await executeTool(projectRoot, toolName, toolArgs, writtenFiles);
      } catch (error) {
        result = `错误：${error instanceof Error ? error.message : String(error)}`;
      }

      onEvent({
        type: "tool_end",
        data: {
          id: call.id,
          name: toolName,
          ok: !result.startsWith("错误："),
          summary: toolSummary(toolName, result),
        },
      });

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }
  }

  onEvent({ type: "error", data: { message: `已达最大轮次（${maxTurns}），任务可能未完成。` } });
  onEvent({ type: "done", data: { writtenFiles, turns: maxTurns } });
}
