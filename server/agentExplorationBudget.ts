/** Consecutive read-only tool turns in interactive build mode before nudging the model to edit. */
export const INTERACTIVE_EXPLORE_TURN_BUDGET = 2;

/** Consecutive read-only tool turns in execute_plan mode before nudging the model to edit. */
export const EXECUTE_PLAN_EXPLORE_TURN_BUDGET = 1;

/** Consecutive read-only turns in plan mode before nudging the model to wrap up. */
export const PLAN_EXPLORE_TURN_BUDGET = 3;

/** Plan explore soft/hard caps — allow more reads than build before forcing text output. */
export const PLAN_MAX_TOTAL_EXPLORE_SOFT = 8;
export const PLAN_MAX_TOTAL_EXPLORE_HARD = 12;

/** Consecutive read-only turns in ask mode before nudging the model to answer. */
export const ASK_EXPLORE_TURN_BUDGET = 5;

/** Ask mode soft cap — strip wide-search tools, still allow read_file. */
export const ASK_MAX_TOTAL_EXPLORE_SOFT = 8;

/** Ask mode hard cap — force text-only answer. */
export const ASK_MAX_TOTAL_EXPLORE_HARD = 12;

/**
 * Hard cap on total exploration-only turns (read-only turns, not reset by nudges).
 * When exceeded, tools are stripped from the next request, forcing text output.
 *
 * Was 6 — raised to 10 to give legitimately complex multi-file tasks enough room,
 * while still stopping runaway exploration loops. The progressive soft-cap at 6
 * (stripping grep/search_files) provides an earlier, gentler guardrail.
 */
export const MAX_TOTAL_EXPLORE_TURNS = 10;

/**
 * Soft cap — when total exploration turns reach this, wide-search tools
 * (grep / search_files) are removed. The model can still read_file to
 * verify targeted locations, but cannot branch out further.
 */
export const MAX_TOTAL_EXPLORE_TURNS_SOFT = 6;

/**
 * Unique files read before injecting a "narrow your focus" nudge.
 * Prevents the model from reading files across many unrelated areas.
 */
export const MAX_UNIQUE_READ_FILES_BEFORE_NUDGE = 4;

/** Total explore-only turns before requiring a user-visible Chinese interim diagnosis. */
export const EXPLORE_INTERIM_DIAGNOSIS_TURN = 4;

/** Identical read_file slice requests allowed after the first read before hard-blocking. */
export const MAX_READ_SLICE_REPEATS = 2;

export function buildExploreBudgetNudge(consecutiveExploreTurns: number, mode?: string): string {
  const actionHint = mode === "plan"
    ? "请立即输出结构化修改方案（文件清单 + 代码块 + 改动说明），不要再继续读文件。"
    : "下一轮必须调用 patch_file 或 write_file；若目标文件已 read 过，直接改，不要再 grep/read。\n若仍缺路径：最多 1 次 grep/search，然后立即修改。\n禁止重复 read 同一文件相同片段；禁止用英文写长分析。\n先用 2–4 句中文写可见进度（根因假设 + 下一步），再调用工具。\n\n💡 提示：如果问题表现为「点击没反应」「按钮不工作」等前端交互异常，优先请用户打开浏览器 DevTools Console 查看报错信息——这比读代码更快定位根因。";
  return [
    `【系统提示】已连续 ${consecutiveExploreTurns} 轮仅探索、尚未修改。`,
    actionHint,
  ].join("");
}

export function buildAskExploreBudgetNudge(consecutiveExploreTurns: number): string {
  return [
    `【系统提示】Ask 模式已连续 ${consecutiveExploreTurns} 轮仅探索、尚未给出回答。`,
    "请基于已读内容立即输出完整自然语言答案。",
    "若仍缺关键片段：最多再 read 一次目标文件的连续逻辑块（勿重叠小 window 反复 read）。",
    "禁止无意义续搜；回答时区分各 API 入口的写/回滚/不写行为，条件用 AND 列全。",
  ].join("");
}

export function buildAskExploreSoftCapNudge(totalExploreTurns: number): string {
  return [
    `【系统提示】Ask 模式已累计 ${totalExploreTurns} 轮探索（超过 ${ASK_MAX_TOTAL_EXPLORE_SOFT}）。`,
    "已移除 grep / search_files，只能 read_file 做最后确认。",
    "下一轮必须输出完整文字回答，不要再调用工具。",
  ].join("");
}

export function buildAskForceAnswerNudge(totalExploreTurns: number): string {
  return [
    `【系统强制】Ask 模式已累计 ${totalExploreTurns} 轮探索（超过 ${ASK_MAX_TOTAL_EXPLORE_HARD}）。`,
    "下一轮已移除所有工具，你只能输出文字。",
    "请基于已有信息给出完整结论；若信息不足，说明已确认部分与仍不确定部分。",
  ].join("");
}

/** Injected when total exploration exceeds the soft cap — removes wide-search tools. */
export function buildExploreSoftCapNudge(totalExploreTurns: number, mode?: string): string {
  const actionHint = mode === "plan"
    ? "请基于已有信息输出结构化方案；本次已移除 grep/search_files，你只能 read_file 确认具体行号。"
    : "你已探索较多轮次（超过搜索预算）。本次移除了 grep / search_files，只能 read_file 确认具体位置。\n若目标文件内容已明确：必须在本轮调用 patch_file / write_file 进行修改。";
  return [
    `【系统提示】已累计 ${totalExploreTurns} 轮仅探索（超过搜索预算 ${MAX_TOTAL_EXPLORE_TURNS_SOFT}）。`,
    "已移除 grep / search_files，只能 read_file 做最后确认。",
    actionHint,
  ].join("");
}

/** Injected when Plan mode exploration exceeds the hard cap — forces text-only plan output. */
export function buildForceOutputNudge(totalExploreTurns: number, mode?: string): string {
  const actionHint = mode === "plan"
    ? "请基于已有信息，立即输出结构化修改方案（文件清单 + 代码块 + 改动说明）。不要再调用任何工具。"
    : "请基于已有信息，立即用中文输出完整结论。不要再调用任何工具。";
  return [
    `【系统强制】已累计 ${totalExploreTurns} 轮仅探索（超过上限 ${MAX_TOTAL_EXPLORE_TURNS}）。`,
    "下一轮已移除所有工具，你只能输出文字。",
    actionHint,
  ].join("");
}

/** Build mode hard cap — keep write tools; agent must patch, not output a plan and ask. */
export function buildBuildExploreForcePatchNudge(totalExploreTurns: number): string {
  return [
    `【系统强制·Build】已累计 ${totalExploreTurns} 轮探索且尚未改代码（超过上限 ${MAX_TOTAL_EXPLORE_TURNS}）。`,
    "你已判断需要修改时，下一轮只能调用 patch_file / write_file / delete_file；禁止 grep / read_file / search。",
    "必须直接提交代码修改并简要说明；禁止只输出 patch 思路或反问「需要我执行吗」。",
  ].join("");
}

/** UI defect + located anchor: hard cap keeps write tools instead of text-only stall. */
export function buildUiDefectForcePatchNudge(totalExploreTurns: number): string {
  return [
    `【系统强制】UI 缺陷任务已累计 ${totalExploreTurns} 轮探索且已定位相关代码。`,
    "下一轮只能调用 patch_file / write_file / delete_file；禁止 grep / read_file / search。",
    "必须直接修复并简要说明改动；禁止只输出分析或反问「要不要修」。",
  ].join("");
}

/** Located patch anchor — next turn must write (independent of explore-budget counter resets). */
export function buildPatchAnchorForcePatchNudge(): string {
  return [
    "【系统强制·已定位】浮层/选区定位函数已在工具结果中出现。",
    "下一轮只能调用 patch_file / write_file / delete_file，禁止任何 read/grep/search。",
    "禁止重复输出截图分析；须直接提交代码修改。",
  ].join("");
}

/** Model returned analysis text while force-patch was active — retry without ending the run. */
export function buildPatchRequiredRetryNudge(): string {
  return [
    "【系统强制】上一轮在必须改代码时你只输出了分析/读图复述，任务未完成。",
    "请立即调用 patch_file 或 write_file 修复；回复中说明改动要点，勿再复述截图或根因猜测。",
  ].join("");
}

/** User said 「修复吧」 after prior analysis — forbid ending with paste-instructions. */
export function buildImplementPasteBlockedNudge(): string {
  return [
    "【系统强制】用户已确认修复，禁止「请将修改应用到文件」或只贴代码块。",
    "下一轮必须调用 patch_file/write_file 提交 diff；简要说明改了什么即可。",
  ].join("");
}

/** Injected mid-exploration — requires a user-visible Chinese progress summary. */
export function buildExploreInterimDiagnosisNudge(totalExploreTurns: number): string {
  return [
    `【系统提示】已累计 ${totalExploreTurns} 轮探索且尚未修改或给出结论。`,
    "下一轮开始必须用中文输出一段用户可见的进度摘要（2–4 句）：",
    "① 当前根因假设；② 已读过哪些关键文件/符号；③ 下一步是 patch 还是仍需一次 read。",
    "摘要写完后才能继续调用工具；禁止仅用英文 \"Now let me...\" 句式。",
    "若已足够定位问题，本轮必须 patch_file / write_file。",
  ].join("");
}

/**
 * Injected when the model reads too many different files in explore-only mode.
 * Guides it to narrow focus rather than spreading across unrelated areas.
 */
export function buildFileBreadthNudge(uniqueReadFiles: string[], mode?: string): string {
  const fileList = uniqueReadFiles.slice(-4).join("、");
  const actionHint = mode === "plan"
    ? "请基于以上已读文件立即输出结构化方案，不要再读新文件。"
    : "请基于以上已读文件确定下一步操作。如果需要修改，请直接 patch；如果还需要信息，请在已读文件中搜索而非打开新文件。\n\n💡 如果任务是一类前端交互问题（点击没反应 / 样式异常），优先怀疑 JS 运行时错误（Console 报错）或最近一次改动引入的副作用，而非大范围探索代码。";
  return [
    `【系统提示】已探索 ${uniqueReadFiles.length} 个不同文件（${fileList} 等）。`,
    "请缩小范围，聚焦在已读文件中定位问题。",
    actionHint,
  ].join("");
}
