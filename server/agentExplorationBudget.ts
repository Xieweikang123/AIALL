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

export function buildExploreBudgetNudge(consecutiveExploreTurns: number, mode?: string): string {
  const actionHint = mode === "plan"
    ? "请立即输出结构化修改方案（文件清单 + 代码块 + 改动说明），不要再继续读文件。"
    : "下一轮必须调用 patch_file 或 write_file；若目标文件已 read 过，直接改，不要再 grep/read。\n若仍缺路径：最多 1 次 grep/search，然后立即修改。\n禁止重复 read 同一文件相同片段；禁止用英文写长分析。\n\n💡 提示：如果问题表现为「点击没反应」「按钮不工作」等前端交互异常，优先请用户打开浏览器 DevTools Console 查看报错信息——这比读代码更快定位根因。";
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

/** Injected when total exploration turns exceed the hard cap — forces text-only output. */
export function buildForceOutputNudge(totalExploreTurns: number, mode?: string): string {
  const actionHint = mode === "plan"
    ? "请基于已有信息，立即输出结构化修改方案（文件清单 + 代码块 + 改动说明）。不要再调用任何工具。"
    : "请基于已有信息，立即输出当前发现的结论、问题根因、以及建议的修复方案。不要再调用任何工具。";
  return [
    `【系统强制】已累计 ${totalExploreTurns} 轮仅探索（超过上限 ${MAX_TOTAL_EXPLORE_TURNS}）。`,
    "下一轮已移除所有工具，你只能输出文字。",
    actionHint,
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
