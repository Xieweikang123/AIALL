import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".vue", ".json", ".html", ".css", ".scss", ".less",
  ".md", ".txt", ".yaml", ".yml", ".toml", ".xml", ".svg", ".sql", ".sh", ".bash",
  ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp", ".cs",
  ".php", ".swift", ".kt", ".r", ".m", ".mm", ".lua", ".pl",
  ".env", ".gitignore", ".dockerignore", ".editorconfig", ".prettierrc",
  ".eslintrc", ".babelrc", ".log", ".csv", ".ini", ".cfg",
  ".svelte", ".astro", ".mdx",
]);

export const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg", "__pycache__", ".cache",
  "dist", "build", ".next", ".nuxt", "target",
]);

export function resolveProjectPath(
  projectRoot: string,
  inputPath: string,
): { ok: true; path: string; relative: string } | { ok: false; error: string } {
  const root = path.resolve(projectRoot);
  const trimmed = String(inputPath || "").trim();
  if (!trimmed) return { ok: false, error: "路径不能为空" };

  const resolved = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(root, trimmed);
  const relative = path.relative(root, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { ok: false, error: "路径超出项目根目录" };
  }

  return { ok: true, path: resolved, relative: relative.replace(/\\/g, "/") };
}

export type ResolvedReadablePath =
  | { ok: true; path: string; key: string; outsideProject: boolean; displayPath: string }
  | { ok: false; error: string };

/** Copy-template logical prefix; on disk under AppData, not under project root. */
export const AIALL_SESSION_LOGICAL_PREFIX = "aiall/vibe-chat-sessions/";

export function resolveAiallSessionDataDir(): string {
  return path.join(
    process.env.APPDATA || path.join(os.homedir(), ".config"),
    "aiall",
    "vibe-chat-sessions",
  );
}

function tryResolveLogicalSessionPath(trimmed: string): ResolvedReadablePath | null {
  const normalized = trimmed.replace(/\\/g, "/");
  if (!normalized.startsWith(AIALL_SESSION_LOGICAL_PREFIX)) return null;
  const tail = normalized.slice(AIALL_SESSION_LOGICAL_PREFIX.length);
  if (!tail || tail.includes("..")) return null;
  const resolved = path.resolve(resolveAiallSessionDataDir(), ...tail.split("/"));
  const displayPath = resolved.replace(/\\/g, "/");
  return { ok: true, path: resolved, key: displayPath, outsideProject: true, displayPath };
}

/** Read-only path resolution: relative paths stay under project root; absolute paths allowed anywhere. */
export function resolveReadablePath(projectRoot: string, inputPath: string): ResolvedReadablePath {
  const trimmed = String(inputPath || "").trim();
  if (!trimmed) return { ok: false, error: "路径不能为空" };

  if (path.isAbsolute(trimmed)) {
    const resolved = path.resolve(trimmed);
    const displayPath = resolved.replace(/\\/g, "/");
    return { ok: true, path: resolved, key: displayPath, outsideProject: true, displayPath };
  }

  const logical = tryResolveLogicalSessionPath(trimmed);
  if (logical) return logical;

  const inProject = resolveProjectPath(projectRoot, trimmed);
  if (!inProject.ok) return inProject;
  return {
    ok: true,
    path: inProject.path,
    key: inProject.relative,
    outsideProject: false,
    displayPath: inProject.relative,
  };
}

export async function listDirectory(dirPath: string) {
  const _t0 = Date.now();
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const _t1 = Date.now();
  const items: Array<{
    name: string;
    path: string;
    relative: string;
    isDirectory: boolean;
    isFile: boolean;
    extension: string;
    size?: number;
  }> = [];

  // 用 readdir 的 withFileTypes 判断类型，只对文件取 size（减少 stat 调用）
  const filtered = entries.filter((e) => !e.name.startsWith(".") && !IGNORE_DIRS.has(e.name));
  const statResults = await Promise.all(
    filtered.map(async (entry) => {
      const fullPath = path.join(dirPath, entry.name);
      let size: number | undefined;
      if (entry.isFile()) {
        const stat = await fs.promises.stat(fullPath).catch(() => null);
        size = stat?.size;
      }
      return { entry, fullPath, size };
    }),
  );
  const _t2 = Date.now();

  for (const { entry, fullPath, size } of statResults) {
    items.push({
      name: entry.name,
      path: fullPath,
      relative: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
      extension: entry.isFile() ? path.extname(entry.name).toLowerCase() : "",
      size,
    });
  }

  items.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const _t3 = Date.now();
  // 记录耗时到 debug log（仅在 AIALL_DEBUG_PERF=1 时启用）
  if (process.env.AIALL_DEBUG_PERF) {
    const timings = { readdir: _t1 - _t0, stat: _t2 - _t1, sort: _t3 - _t2, total: _t3 - _t0, entries: entries.length, filtered: filtered.length, items: items.length };
    try { fs.appendFileSync(path.join(os.tmpdir(), "aiall-list-perf.log"), `${new Date().toISOString()} ${dirPath} ${JSON.stringify(timings)}\n`); } catch {}
  }

  return items;
}

export async function readFileContent(filePath: string) {
  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat) return { ok: false as const, error: "文件不存在", size: 0 };

  if (stat.size > 2 * 1024 * 1024) {
    return { ok: false as const, error: "文件过大（超过 2MB）", size: stat.size };
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext) && stat.size > 0) {
    const fd = await fs.promises.open(filePath, "r");
    try {
      const buf = Buffer.alloc(512);
      const { bytesRead } = await fd.read(buf, 0, 512, 0);
      if (buf.subarray(0, bytesRead).includes(0)) {
        return { ok: false as const, error: "二进制文件，无法读取", size: stat.size };
      }
    } finally {
      await fd.close();
    }
  }

  const content = await fs.promises.readFile(filePath, "utf-8");
  return { ok: true as const, content, size: stat.size, encoding: "utf-8" };
}

export function sliceFileLines(content: string, offset = 1, limit = 500): string {
  const lines = content.split(/\r?\n/);
  const start = Math.max(0, Math.floor(offset) - 1);
  const end = limit > 0 ? Math.min(lines.length, start + Math.floor(limit)) : lines.length;
  const slice = lines.slice(start, end);
  const header = `// lines ${start + 1}-${start + slice.length} of ${lines.length}\n`;
  return header + slice.join("\n");
}

export type FileEOL = "\r\n" | "\n";

/** Detect predominant line ending style in file content. */
export function detectFileEOL(content: string): FileEOL {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

/** Normalize arbitrary line endings to match the target file's EOL style. */
export function adaptPatchLineEndings(text: string, eol: FileEOL): string {
  if (!text) return text;
  const normalized = text.replace(/\r\n/g, "\n");
  return eol === "\r\n" ? normalized.replace(/\n/g, "\r\n") : normalized;
}

function countSubstringOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count += 1;
    pos += needle.length;
  }
  return count;
}

export type UniquePatchResult =
  | { ok: true; patched: string }
  | { ok: false; error: string; occurrences: number };

function splitPatchLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function lineBody(line: string): string {
  return line.trimStart();
}

/** Match block when only leading indent differs between read output and disk. */
function findUniqueFlexibleIndentBlock(
  content: string,
  oldString: string,
): { matched: string; start: number; end: number; matchedLines: string[]; oldLines: string[] } | null {
  const eol = detectFileEOL(content);
  const oldLines = splitPatchLines(oldString);
  if (!oldLines.length || oldLines.every((line) => line.length === 0)) return null;

  const contentLines = splitPatchLines(content);
  const startLines: number[] = [];
  for (let i = 0; i <= contentLines.length - oldLines.length; i += 1) {
    let ok = true;
    for (let j = 0; j < oldLines.length; j += 1) {
      if (lineBody(contentLines[i + j] ?? "") !== lineBody(oldLines[j] ?? "")) {
        ok = false;
        break;
      }
    }
    if (ok) startLines.push(i);
  }
  if (startLines.length !== 1) return null;

  const startLine = startLines[0]!;
  const matchedLines = contentLines.slice(startLine, startLine + oldLines.length);
  const matched = matchedLines.join(eol);
  let start = 0;
  for (let i = 0; i < startLine; i += 1) {
    start += (contentLines[i]?.length ?? 0) + eol.length;
  }
  return { matched, start, end: start + matched.length, matchedLines, oldLines };
}

function buildIndentAdaptedNewBlock(
  matchedLines: string[],
  oldLines: string[],
  newString: string,
  eol: FileEOL,
): string {
  const newLines = splitPatchLines(newString);
  return newLines
    .map((newLine, index) => {
      const anchorLine = matchedLines[Math.min(index, matchedLines.length - 1)] ?? "";
      const oldLine = oldLines[Math.min(index, oldLines.length - 1)] ?? "";
      const anchorIndent = anchorLine.match(/^[\t ]*/)?.[0] ?? "";
      const oldIndent = oldLine.match(/^[\t ]*/)?.[0] ?? "";
      const newIndent = newLine.match(/^[\t ]*/)?.[0] ?? "";
      const content = newLine.trimStart();
      const relativeIndent =
        newIndent.length >= oldIndent.length ? newIndent.slice(oldIndent.length) : "";
      return `${anchorIndent}${relativeIndent}${content}`;
    })
    .join(eol);
}

/**
 * Apply a unique old_string → new_string replacement.
 * Falls back to EOL-normalized matching when read_file (LF) differs from disk (CRLF).
 * Falls back to indent-flexible line matching when only leading whitespace differs.
 */
export function applyUniquePatch(content: string, oldString: string, newString: string): UniquePatchResult {
  let oldToMatch = oldString;
  let newToInsert = newString;
  let occurrences = countSubstringOccurrences(content, oldToMatch);

  if (occurrences === 0) {
    const eol = detectFileEOL(content);
    oldToMatch = adaptPatchLineEndings(oldString, eol);
    newToInsert = adaptPatchLineEndings(newString, eol);
    occurrences = countSubstringOccurrences(content, oldToMatch);
  }

  if (occurrences === 0) {
    const flex = findUniqueFlexibleIndentBlock(content, oldString);
    if (flex) {
      const eol = detectFileEOL(content);
      const adaptedNew = buildIndentAdaptedNewBlock(flex.matchedLines, flex.oldLines, newString, eol);
      return {
        ok: true,
        patched: content.slice(0, flex.start) + adaptedNew + content.slice(flex.end),
      };
    }
    return {
      ok: false,
      error:
        "错误：old_string 在文件中未找到。请从 read_file 返回原文复制（含缩进）；可换更短且唯一的片段，或 read 更大范围后重试",
      occurrences: 0,
    };
  }
  if (occurrences > 1) {
    return {
      ok: false,
      error: `错误：old_string 在文件中出现 ${occurrences} 次，请缩小为更短且唯一的片段`,
      occurrences,
    };
  }

  return { ok: true, patched: content.replace(oldToMatch, newToInsert) };
}

export async function writeFileContent(filePath: string, content: string) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(filePath, content, "utf-8");
  const stat = await fs.promises.stat(filePath);
  return { ok: true, size: stat.size };
}

export async function searchFiles(dirPath: string, query: string, maxResults = 30) {
  const results: Array<{ name: string; path: string; relative: string; isDirectory: boolean }> = [];
  const lowerQuery = query.toLowerCase();
  const root = path.resolve(dirPath);

  async function walk(currentDir: string, depth: number) {
    if (depth > 6 || results.length >= maxResults) return;
    try {
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxResults) break;
        if (entry.name.startsWith(".") || IGNORE_DIRS.has(entry.name)) continue;
        if (entry.name.toLowerCase().includes(lowerQuery)) {
          const full = path.join(currentDir, entry.name);
          results.push({
            name: entry.name,
            path: full,
            relative: path.relative(root, full).replace(/\\/g, "/"),
            isDirectory: entry.isDirectory(),
          });
        }
        if (entry.isDirectory()) {
          await walk(path.join(currentDir, entry.name), depth + 1);
        }
      }
    } catch {
      // skip
    }
  }

  await walk(root, 0);
  return results;
}

export interface GrepMatch {
  file: string;
  relative: string;
  line: number;
  text: string;
}

export async function grepInProject(
  projectRoot: string,
  pattern: string,
  maxMatches = 50,
): Promise<{ ok: true; matches: GrepMatch[] } | { ok: false; error: string }> {
  const root = path.resolve(projectRoot);
  const query = String(pattern || "").trim();
  if (!query) return { ok: false, error: "搜索内容不能为空" };

  try {
    const { stdout } = await execFileAsync(
      "rg",
      ["-n", "--max-count", String(maxMatches), "--glob", "!node_modules/**", query, root],
      { maxBuffer: 4 * 1024 * 1024, windowsHide: true },
    );
    const matches = parseRgOutput(stdout, root, maxMatches);
    return { ok: true, matches };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { code?: string; stdout?: string };
    if (err.code === "ENOENT") {
      return { ok: true, matches: await grepInProjectNode(root, query, maxMatches) };
    }
    if (err.code === 1 || err.code === "1") {
      return { ok: true, matches: [] };
    }
    if (err.stdout) {
      const matches = parseRgOutput(String(err.stdout), root, maxMatches);
      return { ok: true, matches };
    }
    return { ok: false, error: err.message || "grep 失败" };
  }
}

function parseRgOutput(output: string, root: string, maxMatches: number): GrepMatch[] {
  const matches: GrepMatch[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim() || matches.length >= maxMatches) break;
    const m = /^(.+?):(\d+):(.*)$/.exec(line);
    if (!m) continue;
    matches.push({
      file: m[1],
      relative: path.relative(root, m[1]).replace(/\\/g, "/"),
      line: Number(m[2]),
      text: m[3],
    });
  }
  return matches;
}

async function grepInProjectNode(root: string, pattern: string, maxMatches: number): Promise<GrepMatch[]> {
  const matches: GrepMatch[] = [];
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }

  async function walk(dir: string, depth: number) {
    if (depth > 8 || matches.length >= maxMatches) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (matches.length >= maxMatches) break;
      if (entry.name.startsWith(".") || IGNORE_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) continue;
      try {
        const stat = await fs.promises.stat(full);
        if (stat.size > 512 * 1024) continue;
        const content = await fs.promises.readFile(full, "utf-8");
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
          if (matches.length >= maxMatches) break;
          if (regex.test(lines[i])) {
            matches.push({
              file: full,
              relative: path.relative(root, full).replace(/\\/g, "/"),
              line: i + 1,
              text: lines[i].trim().slice(0, 200),
            });
          }
        }
      } catch {
        // skip
      }
    }
  }

  await walk(root, 0);
  return matches;
}
