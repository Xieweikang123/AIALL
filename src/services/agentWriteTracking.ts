export type AgentToolWriteRecord = {
  name?: string;
  ok?: boolean;
  summary?: string;
  args?: { path?: string };
};

const WRITE_TOOL_NAMES = new Set(["patch_file", "write_file", "delete_file"]);

export function normalizeWritePath(path: string): string {
  return path.replace(/\\/g, "/").trim();
}

export function mergeWrittenFilePaths(...lists: (string[] | undefined | null)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list ?? []) {
      const normalized = normalizeWritePath(String(raw));
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
}

/** Whether a tool_end summary indicates a successful on-disk write. */
export function isSuccessfulWriteToolSummary(summary?: string): boolean {
  const text = (summary ?? "").trim();
  if (!text) return false;
  if (/^错误|^old_string 未出现|未出现在|禁止凭记忆|与已读片段高度重叠/.test(text)) return false;
  return /已修改|已写入|已删除/.test(text);
}

/** Collect project-relative paths from successful write/delete tool calls. */
export function collectSuccessfulWritePathsFromTools(tools?: AgentToolWriteRecord[]): string[] {
  const paths = new Set<string>();
  for (const tool of tools ?? []) {
    if (!tool.ok) continue;
    if (!tool.name || !WRITE_TOOL_NAMES.has(tool.name)) continue;
    if (!isSuccessfulWriteToolSummary(tool.summary)) continue;
    const path = normalizeWritePath(String(tool.args?.path ?? ""));
    if (path) paths.add(path);
  }
  return [...paths];
}

/** Merge all known write sources for one assistant turn (supports multi-segment resume). */
export function resolveCumulativeWrittenFiles(params: {
  serverWrittenFiles?: string[];
  turnFileDiffPaths?: string[];
  tools?: AgentToolWriteRecord[];
  priorWrittenFiles?: string[];
}): string[] {
  return mergeWrittenFilePaths(
    params.priorWrittenFiles,
    collectSuccessfulWritePathsFromTools(params.tools),
    params.serverWrittenFiles,
    params.turnFileDiffPaths,
  );
}

/** Paths to hydrate server writeStage when resuming an in-progress assistant turn. */
export function resolveTaskWrittenFilesForResume(params: {
  writtenFiles?: string[];
  tools?: AgentToolWriteRecord[];
}): string[] {
  return resolveCumulativeWrittenFiles({
    priorWrittenFiles: params.writtenFiles,
    tools: params.tools,
  });
}
