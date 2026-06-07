import fs from "node:fs";
import path from "node:path";
import { readFileContent, resolveProjectPath, searchFiles } from "./vibeFs";

export type AgentRunKind = "interactive" | "execute_plan";

export interface AgentRunProfileInput {
  kind?: AgentRunKind;
  targetFiles?: string[];
  userIntent?: string;
}

export type TargetFileStatus = "ok" | "missing" | "invalid";

export interface TargetFileManifestEntry {
  requested: string;
  status: TargetFileStatus;
  resolved?: string;
  lines?: number;
  error?: string;
  suggestions?: string[];
}

export interface AgentRunToolPolicy {
  kind: AgentRunKind;
  targetFiles: Set<string>;
  allowExplore: boolean;
  readFileMaxCalls: number;
  readFileMaxLines: number;
}

export interface AgentRunToolStats {
  readFileCalls: number;
}

const LARGE_FILE_LINE_THRESHOLD = 500;
const EXECUTE_PLAN_READ_MAX_CALLS = 16;
const EXECUTE_PLAN_READ_MAX_LINES = 320;

export function normalizeRunProfile(input?: AgentRunProfileInput | null): AgentRunProfileInput {
  if (!input?.kind || input.kind === "interactive") {
    return { kind: "interactive" };
  }
  return {
    kind: "execute_plan",
    targetFiles: [...new Set((input.targetFiles || []).map((p) => p.replace(/\\/g, "/").trim()).filter(Boolean))],
    userIntent: input.userIntent?.trim() || undefined,
  };
}

export async function buildTargetFileManifest(
  projectRoot: string,
  targetFiles: string[],
): Promise<TargetFileManifestEntry[]> {
  const root = path.resolve(projectRoot);
  const entries: TargetFileManifestEntry[] = [];

  for (const requested of targetFiles) {
    const resolved = resolveProjectPath(root, requested);
    if (!resolved.ok) {
      entries.push({ requested, status: "invalid", error: resolved.error });
      continue;
    }

    const stat = await fs.promises.stat(resolved.path).catch(() => null);
    if (!stat?.isFile()) {
      const basename = path.basename(requested);
      const suggestions = (await searchFiles(root, basename, 8))
        .filter((item) => !item.isDirectory)
        .map((item) => item.relative);
      entries.push({
        requested,
        status: "missing",
        error: `${requested} 不存在或不是文件`,
        suggestions: suggestions.length ? suggestions : undefined,
      });
      continue;
    }

    const content = await readFileContent(resolved.path);
    const lines = content.ok ? content.content.split(/\r?\n/).length : undefined;
    entries.push({
      requested,
      status: "ok",
      resolved: resolved.relative,
      lines,
    });
  }

  return entries;
}

export function createRunToolPolicy(
  profile: AgentRunProfileInput,
  manifest: TargetFileManifestEntry[],
): AgentRunToolPolicy {
  if (profile.kind !== "execute_plan") {
    return {
      kind: "interactive",
      targetFiles: new Set(),
      allowExplore: true,
      readFileMaxCalls: Number.POSITIVE_INFINITY,
      readFileMaxLines: 800,
    };
  }

  const targetFiles = new Set(
    manifest
      .filter((entry) => entry.status === "ok" && entry.resolved)
      .map((entry) => entry.resolved as string),
  );

  return {
    kind: "execute_plan",
    targetFiles,
    allowExplore: false,
    readFileMaxCalls: EXECUTE_PLAN_READ_MAX_CALLS,
    readFileMaxLines: EXECUTE_PLAN_READ_MAX_LINES,
  };
}

export function checkToolAllowed(
  toolName: string,
  args: Record<string, unknown>,
  policy: AgentRunToolPolicy,
  stats: AgentRunToolStats,
): string | null {
  if (policy.kind === "interactive") return null;

  if (toolName === "list_dir" || toolName === "search_files" || toolName === "grep") {
    return "方案执行阶段：禁止全项目探索。请只对已验证目标文件 read_file，再 patch_file / write_file。";
  }

  if (toolName === "read_file") {
    if (stats.readFileCalls >= policy.readFileMaxCalls) {
      return `方案执行阶段：read_file 已达上限（${policy.readFileMaxCalls} 次），请基于已读内容修改。`;
    }
    const filePath = String(args.path || "").trim().replace(/\\/g, "/");
    if (!filePath) return "错误：缺少 path";
    if (!policy.targetFiles.has(filePath)) {
      const allowed = [...policy.targetFiles].join("、") || "（无）";
      return `方案执行阶段：只能读取已验证目标文件：${allowed}`;
    }
    const limit = Number(args.limit);
    if (Number.isFinite(limit) && limit > policy.readFileMaxLines) {
      return `方案执行阶段：单次 read_file 最多 ${policy.readFileMaxLines} 行，请用 offset/limit 分段读取。`;
    }
    return null;
  }

  if (toolName === "write_file" || toolName === "patch_file" || toolName === "delete_file") {
    const filePath = String(args.path || "").trim().replace(/\\/g, "/");
    if (!filePath) return "错误：缺少 path";
    if (policy.targetFiles.size && !policy.targetFiles.has(filePath)) {
      return `方案执行阶段：只能修改已验证目标文件，${filePath} 不在清单中。`;
    }
  }

  return null;
}

export function formatTargetFileManifest(manifest: TargetFileManifestEntry[]): string {
  if (!manifest.length) return "";

  const lines = ["", "【已验证目标文件】"];
  for (const entry of manifest) {
    if (entry.status === "ok") {
      const sizeHint =
        entry.lines && entry.lines >= LARGE_FILE_LINE_THRESHOLD
          ? `，${entry.lines} 行（大文件，优先 patch_file）`
          : entry.lines
            ? `，${entry.lines} 行（可 write_file 或 patch_file）`
            : "";
      lines.push(`- ✓ ${entry.resolved}${sizeHint}`);
      continue;
    }
    if (entry.status === "missing") {
      const suggest = entry.suggestions?.length ? `；可能路径：${entry.suggestions.join("、")}` : "";
      lines.push(`- ✗ ${entry.requested}（不存在，勿操作${suggest}）`);
      continue;
    }
    lines.push(`- ✗ ${entry.requested}（无效：${entry.error || "路径错误"}）`);
  }
  return lines.join("\n");
}

export function buildExecutePlanSystemHint(manifest: TargetFileManifestEntry[], userIntent?: string): string {
  const manifestBlock = formatTargetFileManifest(manifest);
  const intentLine = userIntent ? `\n用户原始需求：${userIntent}` : "";

  return [
    "",
    "【方案执行阶段】用户已确认上一轮修改方案。",
    "全局策略：",
    "1. 先对目标文件 read_file（offset/limit 读相关片段），以磁盘内容为准，方案代码块仅供参考；",
    "2. 确认 old_string 后再 patch_file；新增内容用 patch_file 替换锚点或对小文件用 write_file；",
    `3. 超过 ${LARGE_FILE_LINE_THRESHOLD} 行的文件禁止 write_file 整文件覆盖；`,
    "4. 禁止 list_dir / grep / search_files 全项目探索；",
    "5. 多个文件可在同一轮并行 read_file / patch_file / write_file；完成后 1–3 句总结。",
    intentLine,
    manifestBlock,
  ]
    .filter(Boolean)
    .join("\n");
}

export function noteReadFileCall(stats: AgentRunToolStats): void {
  stats.readFileCalls += 1;
}
