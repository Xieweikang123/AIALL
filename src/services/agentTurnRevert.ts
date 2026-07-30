import type { FileDiff } from "../types/vibeChat";
import { createItem, deleteItem, readFile, writeFile } from "./vibeCodingClient";
import { isDeleteNotFoundError } from "./vibeAgentTurnApply";

export async function revertTurnFileDiffs(params: {
  turnFileDiffs: Record<string, FileDiff>;
  projectPath: string;
  resolveFullPathFromRel: (relPath: string) => string;
  removeOpenTabForPath: (fullPath: string) => void;
  clearFileDiffForPath: (fullPath: string) => void;
  reloadOpenFile?: (fullPath: string) => Promise<void>;
}): Promise<void> {
  const root = params.projectPath.trim();
  for (const [relPath, diff] of Object.entries(params.turnFileDiffs)) {
    const fullPath = params.resolveFullPathFromRel(relPath);
    if (diff.deleted) {
      const result = await writeFile(fullPath, diff.before, root);
      if (!result.ok) throw new Error(result.error || `恢复 ${relPath} 失败`);
    } else if (diff.created) {
      const result = await deleteItem(fullPath, root);
      if (!result.ok) throw new Error(result.error || `删除 ${relPath} 失败`);
      params.removeOpenTabForPath(fullPath);
    } else {
      const result = await writeFile(fullPath, diff.before, root);
      if (!result.ok) throw new Error(result.error || `恢复 ${relPath} 失败`);
    }
    params.clearFileDiffForPath(fullPath);
    if (params.reloadOpenFile) {
      await params.reloadOpenFile(fullPath);
    }
  }
}

export async function applyTurnFileDiffs(params: {
  turnFileDiffs: Record<string, FileDiff>;
  projectPath: string;
  resolveFullPathFromRel: (relPath: string) => string;
  removeOpenTabForPath: (fullPath: string) => void;
}): Promise<string[]> {
  const root = params.projectPath.trim();
  const applied: string[] = [];
  for (const [relPath, diff] of Object.entries(params.turnFileDiffs)) {
    const fullPath = params.resolveFullPathFromRel(relPath);
    if (diff.deleted) {
      const deleteResult = await deleteItem(fullPath, root);
      if (!deleteResult.ok && !isDeleteNotFoundError(deleteResult.error)) {
        throw new Error(deleteResult.error || `删除 ${relPath} 失败`);
      }
      params.removeOpenTabForPath(fullPath);
    } else {
      const existing = await readFile(fullPath, root);
      const writeResult = existing.ok
        ? await writeFile(fullPath, diff.after, root)
        : await createItem(fullPath, false, diff.after, root);
      if (!writeResult.ok) throw new Error(writeResult.error || `写入 ${relPath} 失败`);
    }
    applied.push(relPath);
  }
  return applied;
}
