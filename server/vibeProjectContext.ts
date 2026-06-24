import fs from "node:fs";
import path from "node:path";
import { buildRouteContextSummary } from "./projectRouteContext";
import { listDirectory, readFileContent } from "./vibeFs";

const KEY_PROJECT_FILES = [
  "package.json",
  "README.md",
  "README",
  "tsconfig.json",
  "vite.config.ts",
  "index.html",
  "src/main.ts",
  "src/main.js",
  "src/App.vue",
  "src/router/index.ts",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
];

const PROJECT_CONTEXT_MAX_NODES = 200;
const PROJECT_CONTEXT_MAX_DEPTH = 4;
const PROJECT_CONTEXT_MAX_CHARS = 100_000;
const PROJECT_CONTEXT_FILE_SLICE = 12_000;

async function buildProjectTree(rootPath: string): Promise<string[]> {
  const lines: string[] = [];
  let nodeCount = 0;

  async function walk(dirPath: string, depth: number, prefix: string) {
    if (depth > PROJECT_CONTEXT_MAX_DEPTH || nodeCount >= PROJECT_CONTEXT_MAX_NODES) return;
    const items = await listDirectory(dirPath);
    for (const item of items) {
      if (nodeCount >= PROJECT_CONTEXT_MAX_NODES) break;
      lines.push(`${prefix}${item.isDirectory ? "[dir] " : ""}${item.name}`);
      nodeCount += 1;
      if (item.isDirectory) {
        await walk(item.path, depth + 1, `${prefix}  `);
      }
    }
  }

  await walk(rootPath, 0, "");
  if (nodeCount >= PROJECT_CONTEXT_MAX_NODES) {
    lines.push("...（目录过多，已截断）");
  }
  return lines;
}

export type ProjectContextResult =
  | {
      ok: true;
      path: string;
      tree: string;
      keyFiles: Array<{ path: string; content: string }>;
      routeSummary: string;
      truncated: boolean;
    }
  | { ok: false; error: string };

const CONTEXT_CACHE_TTL_MS = 45_000;
const contextCache = new Map<string, { builtAt: number; result: ProjectContextResult }>();

export function invalidateProjectContextCache(projectPath?: string): void {
  if (!projectPath) {
    contextCache.clear();
    return;
  }
  contextCache.delete(path.resolve(projectPath));
}

export async function buildProjectContext(projectPath: string): Promise<ProjectContextResult> {
  const resolved = path.resolve(projectPath);
  const cached = contextCache.get(resolved);
  if (cached && Date.now() - cached.builtAt < CONTEXT_CACHE_TTL_MS) {
    return cached.result;
  }

  const stat = await fs.promises.stat(resolved).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    return { ok: false, error: "路径不存在或不是目录" };
  }

  const treeLines = await buildProjectTree(resolved);
  const tree = treeLines.join("\n");
  let usedChars = tree.length;

  const keyFiles: Array<{ path: string; content: string }> = [];
  for (const rel of KEY_PROJECT_FILES) {
    if (usedChars >= PROJECT_CONTEXT_MAX_CHARS) break;
    const fullPath = path.join(resolved, rel);
    const result = await readFileContent(fullPath);
    if (!result.ok) continue;
    const budget = Math.min(PROJECT_CONTEXT_FILE_SLICE, PROJECT_CONTEXT_MAX_CHARS - usedChars);
    if (budget <= 0) break;
    const content = result.content.slice(0, budget);
    keyFiles.push({ path: rel.replace(/\\/g, "/"), content });
    usedChars += content.length + rel.length;
  }

  const routeSummary = await buildRouteContextSummary(resolved).catch(() => "");
  usedChars += routeSummary.length;

  const result: ProjectContextResult = {
    ok: true,
    path: resolved,
    tree,
    keyFiles,
    routeSummary,
    truncated: usedChars >= PROJECT_CONTEXT_MAX_CHARS || treeLines.length >= PROJECT_CONTEXT_MAX_NODES,
  };
  contextCache.set(resolved, { builtAt: Date.now(), result });
  return result;
}

export function buildInjectedKeyFilePathSet(
  context: Extract<ProjectContextResult, { ok: true }> | null | undefined,
): Set<string> {
  const paths = new Set<string>();
  if (!context?.ok) return paths;
  for (const file of context.keyFiles) {
    paths.add(file.path.replace(/\\/g, "/"));
  }
  return paths;
}

export function formatInjectedKeyFileReadNudge(filePath: string): string {
  return [
    `（提示：\`${filePath}\` 已在上方「关键文件」项目上下文中注入。`,
    "请直接引用该内容作答；若需未注入的行段，请指定 offset/limit，勿整文件重复 read。）",
  ].join("");
}

export function formatProjectContextForPrompt(context: Extract<ProjectContextResult, { ok: true }>): string {
  const lines = ["", "项目目录结构：", "```", context.tree, "```"];
  if (context.routeSummary.trim()) {
    lines.push(context.routeSummary.trim());
  }
  if (context.keyFiles.length) {
    lines.push("", "关键文件内容：");
    for (const file of context.keyFiles) {
      lines.push("", `### ${file.path}`, "```", file.content, "```");
    }
  }
  if (context.truncated) {
    lines.push("", "（项目上下文已截断，如需更多细节请让用户切换到 Build 模式或打开具体文件。）");
  }
  return lines.join("\n");
}

const BUILD_CONTEXT_MAX_CHARS = 32_000;
const BUILD_CONTEXT_FILE_SLICE = 4_000;

/** Shorter project context for Build mode agent loop (saves tokens for tool rounds). */
export function formatProjectContextForBuild(context: Extract<ProjectContextResult, { ok: true }>): string {
  let tree = context.tree;
  if (tree.length > 12_000) {
    tree = `${tree.slice(0, 12_000)}\n...（目录树已截断）`;
  }
  const lines = ["", "项目目录结构（节选）：", "```", tree, "```"];
  if (context.routeSummary.trim()) {
    lines.push(context.routeSummary.trim());
  }
  let used = tree.length;
  const keyFiles: Array<{ path: string; content: string }> = [];
  for (const file of context.keyFiles) {
    if (used >= BUILD_CONTEXT_MAX_CHARS) break;
    const budget = Math.min(BUILD_CONTEXT_FILE_SLICE, BUILD_CONTEXT_MAX_CHARS - used);
    if (budget <= 0) break;
    const content = file.content.slice(0, budget);
    keyFiles.push({ path: file.path, content });
    used += content.length + file.path.length;
  }
  if (keyFiles.length) {
    lines.push("", "关键文件（节选）：");
    for (const file of keyFiles) {
      lines.push("", `### ${file.path}`, "```", file.content, "```");
    }
  }
  if (context.truncated || keyFiles.length < context.keyFiles.length) {
    lines.push("", "（项目上下文已截断，细节请用 list_dir / read_file / grep 查询。）");
  }
  return lines.join("\n");
}
