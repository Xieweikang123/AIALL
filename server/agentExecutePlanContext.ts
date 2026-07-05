import fs from "node:fs";
import path from "node:path";
import {
  type TargetFileManifestEntry,
  normalizeExecutePlanContext,
  formatTargetFileManifest,
  buildExecutePlanSystemHint,
} from "../src/services/agentExecutePlanContext";
import { readFileContent, resolveProjectPath, searchFiles } from "./vibeFs";

export type {
  ExecutePlanKind,
  ExecutePlanTriggerSource,
  ExecutePlanContextInput,
  TargetFileStatus,
  TargetFileManifestEntry,
} from "../src/services/agentExecutePlanContext";

export { normalizeExecutePlanContext, formatTargetFileManifest, buildExecutePlanSystemHint };

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
