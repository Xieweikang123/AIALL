import type { ChatToolCall } from "./aiForward";
import type { WriteStage } from "./agentToolExecutor";
import {
  hasTextToolCallMarkup,
  synthesizeToolCallsFromText,
} from "./textToolCalls";
import { isProductiveWritePath } from "./agentExplorationBudget";
import { isToolResultFailure } from "./agentExploreGuard";

export const READ_ONLY_AGENT_TOOL_NAMES = new Set([
  "list_dir",
  "read_file",
  "grep",
  "search_files",
  "web_search",
  "web_extract",
  "list_skills",
  "read_skill",
]);
export const WRITE_AGENT_TOOL_NAMES = new Set(["write_file", "patch_file", "delete_file"]);

export const VIBE_AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "列出目录下的文件和子目录。空 path 表示项目根；相对路径限于项目内；绝对路径可读本机任意目录。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "目录路径：''=项目根，相对=项目内，绝对=本机任意目录" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取文本文件。支持 offset/limit 按行读取大文件。相对路径限于项目内；绝对路径可读本机任意文件（如 AppData 下的配置/会话 JSON）。建议一次读取 200-500 行连续代码，避免小窗口（<80 行）反复读取同一文件。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径：相对项目根，或本机绝对路径" },
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
      description: "写入或覆盖整个文件（Build 模式下立即落盘）。大文件优先用 patch_file。",
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
      name: "patch_file",
      description:
        "对文件做精确局部替换（old_string 须在文件中唯一匹配）。适合大文件的小改动，比 write_file 更快。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对项目根的文件路径" },
          old_string: { type: "string", description: "要被替换的原文（须精确匹配且唯一）" },
          new_string: { type: "string", description: "替换后的内容" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "删除文件（Build 模式下立即执行）。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对项目根的文件路径" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "append_memory",
      description:
        "向项目记忆（.aiall/project-memory.md）追加一条记录（自动写入，无需确认）。section 为 术语|导航|偏好。仅在遇到重要的项目约定、导航信息时调用，不要滥用。",
      parameters: {
        type: "object",
        properties: {
          section: {
            type: "string",
            enum: ["术语", "导航", "偏好"],
            description: "写入分区：术语 / 导航 / 偏好",
          },
          content: { type: "string", description: "单条要点（勿带 leading -），1–200 字" },
        },
        required: ["section", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_skills",
      description: "列出 .aiall/skills/ 下的 skill（slug、kind、title）。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "read_skill",
      description: "读取指定 slug 的 skill 完整 Markdown 内容。",
      parameters: {
        type: "object",
        properties: {
          slug: { type: "string", description: "skill 文件名（不含 .md），如 ui-screenshot-locate" },
        },
        required: ["slug"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_skill",
      description:
        "提议写入/更新 .aiall/skills/ 下的 skill 文件；须经用户确认。kind 为 fact|heuristic|preference。",
      parameters: {
        type: "object",
        properties: {
          slug: { type: "string", description: "skill 标识（kebab-case）" },
          kind: { type: "string", enum: ["fact", "heuristic", "preference"] },
          title: { type: "string", description: "短标题" },
          content: { type: "string", description: "Markdown 正文（不含 frontmatter）" },
        },
        required: ["slug", "kind", "title", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "在项目目录中执行 shell 命令（如 npm run dev、python main.py、go test）。返回 stdout 和 stderr。",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "要执行的 shell 命令" },
          timeout_ms: { type: "number", description: "超时时间（毫秒），默认 30000，最大 120000" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "联网搜索，获取最新信息。返回搜索结果列表（标题、链接、摘要）。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词" },
          engine: { type: "string", enum: ["google", "bing", "baidu", "duckduckgo"], description: "搜索引擎，默认 baidu；百度无静态结果时会自动回退" },
          max_results: { type: "number", description: "最大结果数，默认 5，最大 10" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_extract",
      description: "抓取指定 URL 的网页内容，返回标题和正文。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "要抓取的网页 URL（http/https）" },
          mode: { type: "string", enum: ["auto", "html", "browser"], description: "抓取模式，默认 auto" },
        },
        required: ["url"],
      },
    },
  },
];

export const READ_ONLY_AGENT_TOOLS = VIBE_AGENT_TOOLS.filter((t) =>
  ["list_dir", "read_file", "grep", "search_files", "web_search", "web_extract", "list_skills", "read_skill"].includes(
    t.function.name,
  ),
);

export function isEnglishToolNarration(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^(?:Now let me|Let me|I'll|I need to|First,?\s+I)\b/i.test(trimmed)) return true;
  const cjk = (trimmed.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (trimmed.match(/[a-zA-Z]/g) || []).length;
  return latin >= 24 && cjk < 8 && trimmed.length <= 220;
}

export function isSubstantiveChineseToolPreamble(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || isEnglishToolNarration(trimmed)) return false;
  return (trimmed.match(/[\u4e00-\u9fff]/g) || []).length >= 8;
}

export function canParallelizeToolBatch(calls: ChatToolCall[]): boolean {
  if (calls.length <= 1) return false;
  const names = calls.map((call) => call.function.name);
  if (names.every((name) => READ_ONLY_AGENT_TOOL_NAMES.has(name))) return true;
  if (!names.every((name) => WRITE_AGENT_TOOL_NAMES.has(name))) return false;
  const paths = calls.map((call) => String(parseToolArgs(call.function.arguments || "{}").path || "").trim());
  if (!paths.every(Boolean)) return false;
  return new Set(paths).size === paths.length;
}

export function callIsProductiveWrite(call: ChatToolCall): boolean {
  if (!WRITE_AGENT_TOOL_NAMES.has(call.function.name)) return false;
  const filePath = String(parseToolArgs(call.function.arguments || "{}").path || "").trim();
  return isProductiveWritePath(filePath);
}

export function buildDoneData(stage: WriteStage | null, turns: number, truncated = false) {
  if (!stage) {
    return { writtenFiles: [] as string[], pendingFiles: [] as string[], turns, ...(truncated ? { truncated: true } : {}) };
  }
  return {
    writtenFiles: [...stage.writtenList],
    pendingFiles: [] as string[],
    turns,
    ...(truncated ? { truncated: true } : {}),
  };
}

export function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function resolveToolCallsFromAssistant(content: string, apiToolCalls: ChatToolCall[]): ChatToolCall[] {
  if (apiToolCalls.length) return apiToolCalls;
  if (!hasTextToolCallMarkup(content)) return [];
  return synthesizeToolCallsFromText(content);
}

export function toolSummary(name: string, result: string): string {
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
    const m = result.match(/已写入\s+(.+?)（(\d+)\s*字符）/);
    if (m) return `已写入 ${m[1]}（${m[2]} 字符）`;
    return result;
  }

  if (name === "patch_file") {
    const m = result.match(/已修改\s+(.+?)（/);
    if (m) return `已修改 ${m[1]}`;
    return result;
  }

  if (name === "delete_file") {
    const m = result.match(/已删除\s+(.+)$/);
    if (m) return `已删除 ${m[1]}`;
    return result;
  }

  if (name === "run_command") {
    if (result.startsWith("错误：") || result.startsWith("命令执行失败")) return `执行失败`;
    const outMatch = result.match(/^stdout:\n(.+)/m);
    const oneLine = (outMatch?.[1] || result).replace(/\s+/g, " ").trim();
    return oneLine.length > 60 ? `${oneLine.slice(0, 60)}…` : oneLine || "执行完成";
  }

  if (name === "web_search") {
    const n = result.split("\n").filter((l) => l.match(/^\d+\./)).length;
    return n > 0 ? `找到 ${n} 条结果` : "搜索完成";
  }

  if (name === "web_extract") {
    const m = result.match(/标题：(.+)/);
    return m ? `抓取「${m[1].slice(0, 30)}」` : "抓取网页";
  }

  const oneLine = result.replace(/\s+/g, " ").trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine;
}
