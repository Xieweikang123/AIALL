import type * as Monaco from "monaco-editor";
import { runNpmScript } from "../services/npmScriptClient";

const RUN_COMMAND_ID = "aiall.runNpmScript";

let setupDone = false;

/**
 * 注册 package.json npm scripts 的 hover（仿 VS Code）：
 * 悬停脚本名时显示 `npm run <script>` 与「▶ Run」命令链接。
 * 全局注册一次即可（HoverProvider / Command 均为 Monaco 全局能力）。
 */
export function setupNpmScriptHover(monaco: typeof Monaco): void {
  if (setupDone) return;
  setupDone = true;

  monaco.editor.registerCommand(
    RUN_COMMAND_ID,
    (_accessor: unknown, projectDir: string, script: string) => {
      runNpmScript(projectDir, script);
    },
  );

  monaco.languages.registerHoverProvider("json", {
    provideHover(model, position): Monaco.languages.Hover | null {
      const uriPath = model.uri.path;
      if (!uriPath.endsWith("/package.json")) return null;

      const content = model.getValue();
      const offset = model.getOffsetAt(position);
      const hit = detectScriptAt(content, offset);
      if (!hit) return null;

      const projectDir = projectDirFromUriPath(uriPath);
      const args = encodeURIComponent(JSON.stringify([projectDir, hit.name]));

      const markdown = [
        `**npm run ${hit.name}**`,
        "",
        "```bash",
        `npm run ${hit.name}`,
        "```",
        "",
        `[▶ Run](command:${RUN_COMMAND_ID}?${args})`,
      ].join("\n");

      const startPos = model.getPositionAt(hit.start);
      const endPos = model.getPositionAt(hit.end);
      return {
        contents: [{ value: markdown, isTrusted: true }],
        range: {
          startLineNumber: startPos.lineNumber,
          startColumn: startPos.column,
          endLineNumber: endPos.lineNumber,
          endColumn: endPos.column,
        },
      };
    },
  });
}

interface ScriptHit {
  name: string;
  /** 脚本名 token 的字符区间（含引号），供 hover 定位 */
  start: number;
  end: number;
}

/** 导出供单测使用 */
export type { ScriptHit as NpmScriptHit };

/** 判断 offset 是否落在 package.json `"scripts"` 对象内的某个脚本键上。 */
export function detectScriptAt(content: string, offset: number): ScriptHit | null {
  let root: unknown;
  try {
    root = JSON.parse(content);
  } catch {
    return null;
  }
  if (!root || typeof root !== "object" || Array.isArray(root)) return null;
  const scripts = (root as Record<string, unknown>).scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return null;
  const names = new Set(Object.keys(scripts as Record<string, unknown>));
  if (names.size === 0) return null;

  const scriptsRange = findQuotedKeyObjectRange(content, "scripts");
  if (!scriptsRange || offset < scriptsRange.start || offset > scriptsRange.end) return null;

  const token = keyTokenAt(content, offset);
  if (!token) return null;
  const name = unescapeJsonString(token.text);
  if (!names.has(name)) return null;

  return { name, start: token.start, end: token.end };
}

export function projectDirFromUriPath(uriPath: string): string {
  let normalized = uriPath.replace(/^\/+/, "");
  if (!/^[A-Za-z]:\//.test(normalized)) {
    normalized = "/" + normalized;
  }
  const idx = normalized.lastIndexOf("/package.json");
  return idx > 0 ? normalized.slice(0, idx) : normalized;
}

/** 找到 `"key": {` 的对象的 `{`..`}` 区间（仅当 key 位于对象条目位置）。 */
function findQuotedKeyObjectRange(text: string, key: string): { start: number; end: number } | null {
  const needle = `"${key}"`;
  let idx = text.indexOf(needle);
  while (idx !== -1) {
    if (isObjectKeyPosition(text, idx)) {
      let k = idx + needle.length;
      while (k < text.length && isWhitespace(text[k])) k++;
      if (text[k] === ":") {
        k++;
        while (k < text.length && isWhitespace(text[k])) k++;
        if (text[k] === "{") {
          const end = findMatchingBrace(text, k);
          if (end !== -1) return { start: k, end };
        }
      }
    }
    idx = text.indexOf(needle, idx + 1);
  }
  return null;
}

function isObjectKeyPosition(text: string, keyStart: number): boolean {
  let i = keyStart - 1;
  while (i >= 0 && isWhitespace(text[i])) i--;
  if (i < 0) return false;
  return text[i] === "{" || text[i] === ",";
}

function findMatchingBrace(text: string, openIdx: number): number {
  let depth = 0;
  let i = openIdx;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      i = skipJsonString(text, i);
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function skipJsonString(text: string, i: number): number {
  i++;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === '"') return i + 1;
    i++;
  }
  return i;
}

/** 找出包含 offset 的 JSON 字符串 token；仅当其后紧跟 `:`（对象键）时返回。 */
function keyTokenAt(
  text: string,
  offset: number,
): { text: string; start: number; end: number } | null {
  const pos = Math.min(Math.max(offset, 0), text.length);

  let start: number;
  if (text[pos] === '"') {
    start = pos;
  } else {
    let quote = -1;
    let i = pos;
    while (i >= 0) {
      if (text[i] === '"') {
        quote = i;
        break;
      }
      i--;
    }
    if (quote < 0) return null;
    start = quote;
  }

  const end = skipJsonString(text, start);
  if (end <= start || end > text.length) return null;
  if (pos < start || pos >= end) return null;

  let k = end;
  while (k < text.length && isWhitespace(text[k])) k++;
  if (text[k] !== ":") return null;

  return { text: text.slice(start + 1, end - 1), start, end };
}

function unescapeJsonString(raw: string): string {
  return raw
    .replace(/\\u[0-9a-fA-F]{4}/g, (m) => String.fromCharCode(parseInt(m.slice(2), 16)))
    .replace(
      /\\(["\\/bfnrt])/g,
      (_m, ch: string) =>
        ({ '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" })[
          ch
        ] as string,
    );
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}
