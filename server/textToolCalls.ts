import type { ChatToolCall } from "./aiForward";

const TOOL_MARKUP_START = /<function[=>]/i;

const TOOL_BLOCK_RE = /<function[=>](\w+)>?\s*([\s\S]*?)(?=<function[=>]|$)/gi;
const PARAM_RE = /<parameter[=>](\w+)>([^<]*)/gi;

const TOOL_NAME_ALIASES: Record<string, string> = {
  list_directory: "list_dir",
  listdir: "list_dir",
  list: "list_dir",
  read: "read_file",
  readfile: "read_file",
  write: "write_file",
  writefile: "write_file",
  delete: "delete_file",
  deletefile: "delete_file",
  remove_file: "delete_file",
  remove: "delete_file",
  searchfiles: "search_files",
  search: "search_files",
  grep_search: "grep",
};

const PARAM_ALIASES: Record<string, string> = {
  filepath: "path",
  file_path: "path",
  directory: "path",
  dir: "path",
  pattern: "pattern",
  query: "query",
};

export function normalizeTextToolName(raw: string): string {
  const key = raw.trim().toLowerCase();
  return TOOL_NAME_ALIASES[key] || raw.trim();
}

export function normalizeTextToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    const normalizedKey = PARAM_ALIASES[key.trim().toLowerCase()] || key.trim();
    out[normalizedKey] = typeof value === "string" ? value.trim() : value;
  }
  if (out.filePath != null && out.path == null) {
    out.path = out.filePath;
    delete out.filePath;
  }
  return out;
}

/** Remove XML-style pseudo tool calls from assistant text shown to the user. */
export function stripTextToolCallMarkup(text: string): string {
  const start = text.search(TOOL_MARKUP_START);
  if (start < 0) return text;
  return text.slice(0, start).trimEnd();
}

export function hasTextToolCallMarkup(text: string): boolean {
  return TOOL_MARKUP_START.test(text);
}

export interface ParsedTextToolCall {
  name: string;
  args: Record<string, unknown>;
}

export function parseTextToolCallsFromContent(content: string): ParsedTextToolCall[] {
  const results: ParsedTextToolCall[] = [];
  if (!hasTextToolCallMarkup(content)) return results;

  TOOL_BLOCK_RE.lastIndex = 0;
  let block: RegExpExecArray | null;
  while ((block = TOOL_BLOCK_RE.exec(content)) !== null) {
    const rawName = block[1];
    const body = block[2] || "";
    const args: Record<string, unknown> = {};

    PARAM_RE.lastIndex = 0;
    let param: RegExpExecArray | null;
    while ((param = PARAM_RE.exec(body)) !== null) {
      args[param[1]] = param[2];
    }

    const name = normalizeTextToolName(rawName);
    const normalizedArgs = normalizeTextToolArgs(args);
    if (name) {
      results.push({ name, args: normalizedArgs });
    }
  }

  return results;
}

export function synthesizeToolCallsFromText(content: string): ChatToolCall[] {
  const parsed = parseTextToolCallsFromContent(content);
  const stamp = Date.now();
  return parsed.map((item, index) => ({
    id: `text_tool_${stamp}_${index}`,
    type: "function" as const,
    function: {
      name: item.name,
      arguments: JSON.stringify(item.args),
    },
  }));
}

/** Filter streaming deltas: hide pseudo tool-call markup from the user. */
export class TextToolCallStreamFilter {
  private raw = "";
  private visibleLen = 0;
  private markupStarted = false;

  push(delta: string): string {
    if (!delta || this.markupStarted) return "";

    this.raw += delta;
    const markupAt = this.raw.search(TOOL_MARKUP_START);
    if (markupAt < 0) {
      const userDelta = this.raw.slice(this.visibleLen);
      this.visibleLen = this.raw.length;
      return userDelta;
    }

    this.markupStarted = true;
    const userDelta = this.raw.slice(this.visibleLen, markupAt);
    this.visibleLen = markupAt;
    return userDelta;
  }

  getVisibleText(): string {
    return stripTextToolCallMarkup(this.raw);
  }
}
