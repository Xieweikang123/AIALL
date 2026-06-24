/** Default user message when starting project exploration from the UI button. */
export const EXPLORE_PROJECT_PRESET_PROMPT =
  "请系统性地了解当前项目，输出完整的项目理解报告（技术栈、目录、入口、核心模块、依赖、开发命令、阅读顺序）。不要修改任何文件。";

/** Sent when user clicks「继续探索」on a project report. */
export const EXPLORE_CONTINUE_PRESET_PROMPT =
  "请继续探索项目中尚未覆盖的部分，补充并更新项目理解报告。不要修改任何文件。";

export const EXPLORE_CONTINUE_PROMPT_RE =
  /^请继续探索项目中尚未覆盖的部分/i;

export type ExploreDepth = "quick" | "standard" | "deep";

export const EXPLORE_DEPTH_MAX_TURNS: Record<ExploreDepth, number> = {
  quick: 8,
  standard: 16,
  deep: 24,
};

export const EXPLORE_FOLLOWUP_MAX_TURNS = 12;
export const EXPLORE_RESUME_BONUS_TURNS = 8;

export const EXPLORE_QUICK_FOLLOWUP_CHIPS = [
  "请深挖 server 端目录结构与职责",
  "项目的测试如何运行？",
  "请补充数据流与关键依赖说明",
] as const;

export function isExploreContinuePrompt(text: string): boolean {
  return EXPLORE_CONTINUE_PROMPT_RE.test(text.trim());
}

export function resolveExploreRequestMaxTurns(
  prompt: string,
  history: Array<{ role: string; content: string }> | undefined,
  explicit?: number,
  completedTurns = 0,
  depth: ExploreDepth = "standard",
): number {
  if (explicit != null && explicit > 0) return explicit;
  if (isExploreContinuePrompt(prompt)) {
    return completedTurns > 0
      ? Math.min(48, completedTurns + EXPLORE_RESUME_BONUS_TURNS)
      : EXPLORE_DEPTH_MAX_TURNS[depth] + EXPLORE_RESUME_BONUS_TURNS;
  }
  if (history?.some((m) => m.role === "assistant")) {
    return EXPLORE_FOLLOWUP_MAX_TURNS;
  }
  return EXPLORE_DEPTH_MAX_TURNS[depth];
}
