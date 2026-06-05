import fs from "node:fs";
import path from "node:path";
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
      truncated: boolean;
    }
  | { ok: false; error: string };

export async function buildProjectContext(projectPath: string): Promise<ProjectContextResult> {
  const resolved = path.resolve(projectPath);
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

  return {
    ok: true,
    path: resolved,
    tree,
    keyFiles,
    truncated: usedChars >= PROJECT_CONTEXT_MAX_CHARS || treeLines.length >= PROJECT_CONTEXT_MAX_NODES,
  };
}

export function formatProjectContextForPrompt(context: Extract<ProjectContextResult, { ok: true }>): string {
  const lines = ["", "项目目录结构：", "```", context.tree, "```"];
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
