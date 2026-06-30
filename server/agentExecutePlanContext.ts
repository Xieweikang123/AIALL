import fs from "node:fs";
import path from "node:path";
import { readFileContent, resolveProjectPath, searchFiles } from "./vibeFs";

export type ExecutePlanKind = "interactive" | "execute_plan";

export type ExecutePlanTriggerSource = "auto_bug_fix";

/** Server-side execute-plan payload (target files, scoped intent). Not client run routing. */
export interface ExecutePlanContextInput {
  kind?: ExecutePlanKind;
  targetFiles?: string[];
  userIntent?: string;
  triggerSource?: ExecutePlanTriggerSource;
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

const LARGE_FILE_LINE_THRESHOLD = 500;

export function normalizeExecutePlanContext(input?: ExecutePlanContextInput | null): ExecutePlanContextInput {
  if (!input?.kind || input.kind === "interactive") {
    return { kind: "interactive" };
  }
  return {
    kind: "execute_plan",
    targetFiles: [...new Set((input.targetFiles || []).map((p) => p.replace(/\\/g, "/").trim()).filter(Boolean))],
    userIntent: input.userIntent?.trim() || undefined,
    triggerSource: input.triggerSource,
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

export function formatTargetFileManifest(manifest: TargetFileManifestEntry[]): string {
  if (!manifest.length) return "";

  const lines = ["", "【方案涉及文件（服务端已校验）】"];
  for (const entry of manifest) {
    if (entry.status === "ok") {
      const sizeHint =
        entry.lines && entry.lines >= LARGE_FILE_LINE_THRESHOLD
          ? `，${entry.lines} 行（大文件，建议 patch_file）`
          : entry.lines
            ? `，${entry.lines} 行`
            : "";
      lines.push(`- ✓ ${entry.resolved}${sizeHint}`);
      continue;
    }
    if (entry.status === "missing") {
      const suggest = entry.suggestions?.length ? `；可能路径：${entry.suggestions.join("、")}` : "";
      lines.push(`- ✗ ${entry.requested}（不存在${suggest}）`);
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
    "【方案执行阶段】用户已确认或明确要求实施（如执行、继续、改吧、优化等），请直接动手，不要再次询问是否开始。",
    "探索最多 1–2 轮（grep 定位 + read 核对），然后必须 patch_file / write_file；勿以「请确认」结尾而不改代码。",
    "建议流程（工具均可按需调用，以完成任务为准）：",
    "1. 先 read_file 核对目标文件真实内容，以磁盘为准，方案代码块仅供参考；",
    "2. old_string 确认无误后再 patch_file；小文件或新文件可用 write_file；",
    `3. 超过 ${LARGE_FILE_LINE_THRESHOLD} 行的大文件建议 patch_file 局部修改；`,
    "4. 路径不确定时可用 search_files / grep 定位；",
    "5. 可并行 read_file / patch_file / write_file；完成后 1–3 句总结。",
    "6. 勿 read/write/patch `.aiall/plans/` 下方案文件或旧版 `.aiall/PLAN.md`；方案文档不在本阶段维护，只落实业务文件改动。",
    intentLine,
    manifestBlock,
  ]
    .filter(Boolean)
    .join("\n");
}
