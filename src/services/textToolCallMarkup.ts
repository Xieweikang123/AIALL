/** Detect and strip pseudo tool-call markup leaked into assistant text. */

export const TOOL_MARKUP_START_RE =
  /<function_calls\b|<function[=>]|<invoke\b|<tool_call\b|\[Tool call:/i;

const LEGACY_TOOL_BLOCK_RE = /<function[=>](\w+)>?\s*([\s\S]*?)(?=<function[=>]|<function_calls\b|<invoke\b|<tool_call\b|$)/gi;
const LEGACY_PARAM_RE = /<parameter[=>](\w+)>([^<]*)/gi;

const INVOKE_BLOCK_RE = /<invoke\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/invoke>/gi;
const PARAM_NAME_ATTR_RE = /<parameter\s+name=["']([^"']+)["']\s*>([^<]*)/gi;

const JSON_TOOL_CALL_RE = /\[Tool call:\s*(\w+)\(([\s\S]*?)\)\]/gi;

export const TOOL_NAME_ALIASES: Record<string, string> = {
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

export const PARAM_ALIASES: Record<string, string> = {
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

export function findToolMarkupStart(text: string): number {
  let earliest = -1;
  const re = new RegExp(TOOL_MARKUP_START_RE.source, "gi");
  for (const match of text.matchAll(re)) {
    if (match.index === undefined) continue;
    if (earliest < 0 || match.index < earliest) earliest = match.index;
  }
  return earliest;
}

/** Remove XML-style and JSON-style pseudo tool calls from assistant text shown to the user. */
export function stripTextToolCallMarkup(text: string): string {
  let result = text.replace(/\[Tool call:\s*\w+\([\s\S]*?\)\]/gi, "");
  result = result.replace(/<tool_call>\s*$/i, "");
  const start = findToolMarkupStart(result);
  if (start >= 0) result = result.slice(0, start);
  return result.trimEnd();
}

export function hasTextToolCallMarkup(text: string): boolean {
  return TOOL_MARKUP_START_RE.test(text);
}

export interface ParsedTextToolCall {
  name: string;
  args: Record<string, unknown>;
}

function parseLegacyToolBlocks(content: string, results: ParsedTextToolCall[]): void {
  LEGACY_TOOL_BLOCK_RE.lastIndex = 0;
  let block: RegExpExecArray | null;
  while ((block = LEGACY_TOOL_BLOCK_RE.exec(content)) !== null) {
    const rawName = block[1];
    const body = block[2] || "";
    const args: Record<string, unknown> = {};

    LEGACY_PARAM_RE.lastIndex = 0;
    let param: RegExpExecArray | null;
    while ((param = LEGACY_PARAM_RE.exec(body)) !== null) {
      args[param[1]] = param[2];
    }

    const name = normalizeTextToolName(rawName);
    if (name) results.push({ name, args: normalizeTextToolArgs(args) });
  }
}

function parseInvokeToolBlocks(content: string, results: ParsedTextToolCall[]): void {
  INVOKE_BLOCK_RE.lastIndex = 0;
  let block: RegExpExecArray | null;
  while ((block = INVOKE_BLOCK_RE.exec(content)) !== null) {
    const rawName = block[1];
    const body = block[2] || "";
    const args: Record<string, unknown> = {};

    PARAM_NAME_ATTR_RE.lastIndex = 0;
    let param: RegExpExecArray | null;
    while ((param = PARAM_NAME_ATTR_RE.exec(body)) !== null) {
      args[param[1]] = param[2];
    }

    const name = normalizeTextToolName(rawName);
    if (name) results.push({ name, args: normalizeTextToolArgs(args) });
  }
}

function parseJsonToolCalls(content: string, results: ParsedTextToolCall[]): void {
  JSON_TOOL_CALL_RE.lastIndex = 0;
  let jsonMatch: RegExpExecArray | null;
  while ((jsonMatch = JSON_TOOL_CALL_RE.exec(content)) !== null) {
    const rawName = jsonMatch[1];
    const argsStr = jsonMatch[2] || "{}";
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(argsStr) as Record<string, unknown>;
    } catch {
      const keyValRe = /(\w+)\s*:\s*"([^"]*)"/g;
      let kv: RegExpExecArray | null;
      while ((kv = keyValRe.exec(argsStr)) !== null) {
        args[kv[1]] = kv[2];
      }
    }

    const name = normalizeTextToolName(rawName);
    if (name) results.push({ name, args: normalizeTextToolArgs(args) });
  }
}

export function parseTextToolCallsFromContent(content: string): ParsedTextToolCall[] {
  if (!hasTextToolCallMarkup(content)) return [];
  const results: ParsedTextToolCall[] = [];
  parseInvokeToolBlocks(content, results);
  parseLegacyToolBlocks(content, results);
  parseJsonToolCalls(content, results);
  return results;
}

/** Filter streaming deltas: hide pseudo tool-call markup from the user. */
export class TextToolCallStreamFilter {
  private raw = "";
  private visibleLen = 0;
  private markupStarted = false;

  push(delta: string): string {
    if (!delta || this.markupStarted) return "";

    this.raw += delta;
    const markupAt = findToolMarkupStart(this.raw);
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
