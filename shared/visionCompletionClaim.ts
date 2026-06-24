/** Vision-first turn must not claim code changes before any tool runs. */
export function isPrematureVisionCompletionClaim(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /已(?:经)?(?:修复|修改|添加|完成|写入|调整|做)|已做的修改|现在点击输入框任何位置/i.test(trimmed);
}
