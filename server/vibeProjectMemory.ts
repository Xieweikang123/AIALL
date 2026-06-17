import fs from "node:fs";
import path from "node:path";
import { resolveProjectPath } from "./vibeFs";

/** Relative to project root; listed in .gitignore by default. */
export const PROJECT_MEMORY_REL_PATH = ".aiall/project-memory.md";

/** Keep injected context small — force curation of high-signal notes. */
export const PROJECT_MEMORY_MAX_CHARS = 3_500;

export const PROJECT_MEMORY_DEFAULT_TEMPLATE = `# 项目记忆

可记录：编码风格偏好、常用命令、目录约定、已知踩坑。AI 助手每次对话会自动读取此文件。
`;

export type ProjectMemoryReadResult =
  | { ok: true; content: string; truncated: boolean; path: string; maxChars: number }
  | { ok: false; error: string };

export type ProjectMemoryWriteResult =
  | { ok: true; path: string; size: number; truncated: boolean }
  | { ok: false; error: string };

const memoryCache = new Map<string, { builtAt: number; result: ProjectMemoryReadResult }>();
const MEMORY_CACHE_TTL_MS = 30_000;

export function resolveProjectMemoryAbsolutePath(projectRoot: string): string | null {
  const resolved = resolveProjectPath(projectRoot, PROJECT_MEMORY_REL_PATH);
  if (!resolved.ok) return null;
  return resolved.path;
}

export function normalizeProjectMemoryContent(raw: string): { content: string; truncated: boolean } {
  const trimmed = raw.replace(/\r\n/g, "\n").trim();
  if (trimmed.length <= PROJECT_MEMORY_MAX_CHARS) {
    return { content: trimmed, truncated: false };
  }
  return {
    content: `${trimmed.slice(0, PROJECT_MEMORY_MAX_CHARS)}\n\n…（已截断）`,
    truncated: true,
  };
}

export function formatProjectMemoryForPrompt(content: string, truncated = false): string {
  const body = content.trim();
  if (!body) return "";

  const lines = [
    "",
    "项目记忆（用户确认的偏好、常用命令与踩坑，请优先遵守；与当前任务冲突时以用户最新消息为准）：",
    "```markdown",
    body,
    "```",
  ];
  if (truncated) {
    lines.push("", `（项目记忆已截断，完整内容见 ${PROJECT_MEMORY_REL_PATH}）`);
  }
  return lines.join("\n");
}

export function invalidateProjectMemoryCache(projectPath?: string): void {
  if (!projectPath) {
    memoryCache.clear();
    return;
  }
  memoryCache.delete(path.resolve(projectPath));
}

export async function readProjectMemory(projectRoot: string): Promise<ProjectMemoryReadResult> {
  const resolvedRoot = path.resolve(projectRoot);
  const cached = memoryCache.get(resolvedRoot);
  if (cached && Date.now() - cached.builtAt < MEMORY_CACHE_TTL_MS) {
    return cached.result;
  }

  const absPath = resolveProjectMemoryAbsolutePath(resolvedRoot);
  if (!absPath) {
    return { ok: false, error: "无效的项目路径" };
  }

  let raw = "";
  try {
    raw = await fs.promises.readFile(absPath, "utf-8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      const result: ProjectMemoryReadResult = {
        ok: true,
        content: "",
        truncated: false,
        path: PROJECT_MEMORY_REL_PATH,
        maxChars: PROJECT_MEMORY_MAX_CHARS,
      };
      memoryCache.set(resolvedRoot, { builtAt: Date.now(), result });
      return result;
    }
    return { ok: false, error: error instanceof Error ? error.message : "读取项目记忆失败" };
  }

  const normalized = normalizeProjectMemoryContent(raw);
  const result: ProjectMemoryReadResult = {
    ok: true,
    content: normalized.content,
    truncated: normalized.truncated,
    path: PROJECT_MEMORY_REL_PATH,
    maxChars: PROJECT_MEMORY_MAX_CHARS,
  };
  memoryCache.set(resolvedRoot, { builtAt: Date.now(), result });
  return result;
}

export async function writeProjectMemory(
  projectRoot: string,
  content: string,
): Promise<ProjectMemoryWriteResult> {
  const resolvedRoot = path.resolve(projectRoot);
  const absPath = resolveProjectMemoryAbsolutePath(resolvedRoot);
  if (!absPath) {
    return { ok: false, error: "无效的项目路径" };
  }

  const normalized = normalizeProjectMemoryContent(content);
  const dir = path.dirname(absPath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(absPath, normalized.content, "utf-8");

  invalidateProjectMemoryCache(resolvedRoot);

  return {
    ok: true,
    path: PROJECT_MEMORY_REL_PATH,
    size: Buffer.byteLength(normalized.content, "utf-8"),
    truncated: normalized.truncated,
  };
}
