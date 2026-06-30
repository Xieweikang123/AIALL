/** Consecutive read-only tool turns in interactive build mode before nudging the model to edit. */
export const INTERACTIVE_EXPLORE_TURN_BUDGET = 2;

/**
 * Build 模式下的读文件重叠检测阈值：同一文件重叠 read 超过此次数后硬阻断。
 * 原值 2 仍保留给 readSliceRepeatCounts，此处用于全局 read_file 同文件计数。
 */
export const BUILD_MAX_READ_FILE_REPEATS = 3;

/** Consecutive read-only tool turns in execute_plan mode before nudging the model to edit. */
export const EXECUTE_PLAN_EXPLORE_TURN_BUDGET = 1;

/** Consecutive read-only turns in plan mode before nudging the model to wrap up. */
export const PLAN_EXPLORE_TURN_BUDGET = 3;

/** Plan explore soft/hard caps — allow more reads than build before forcing text output. */
export const PLAN_MAX_TOTAL_EXPLORE_SOFT = 8;
export const PLAN_MAX_TOTAL_EXPLORE_HARD = 12;

/** Consecutive read-only turns in ask mode before nudging the model to answer. */
export const ASK_EXPLORE_TURN_BUDGET = 5;

/** Consecutive read-only turns in consultative build (read-only) before nudging to answer. */
export const CONSULTATIVE_BUILD_EXPLORE_TURN_BUDGET = 4;

/** Ask mode soft cap — strip wide-search tools, still allow read_file. */
export const ASK_MAX_TOTAL_EXPLORE_SOFT = 8;

/** Ask mode hard cap — force text-only answer. */
export const ASK_MAX_TOTAL_EXPLORE_HARD = 12;

/** Consecutive read-only turns in explore mode before nudging to output report. */
export const EXPLORE_EXPLORE_TURN_BUDGET = 6;

/** Explore mode soft/hard caps for total read-only turns. */
export const EXPLORE_MAX_TOTAL_EXPLORE_SOFT = 10;
export const EXPLORE_MAX_TOTAL_EXPLORE_HARD = 14;

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

/** Tighter caps when user continues reporting issues after a prior「修复完成」claim in the same thread. */
export const SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE_SOFT = 5;
export const SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE = 8;

/** Paths written during exploration note-taking — do not reset explore-budget counters. */
export function isExplorationArchivePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").trim();
  return /^\.aiall\/exploration\//i.test(normalized);
}

export function isProductiveWritePath(filePath: string): boolean {
  return Boolean(filePath.trim()) && !isExplorationArchivePath(filePath);
}

/** Identical read_file slice requests allowed after the first read before hard-blocking. */
export const MAX_READ_SLICE_REPEATS = 2;

export function buildExploreBudgetNudge(consecutiveExploreTurns: number, mode?: string): string {
  const actionHint = mode === "plan"
    ? "请立即输出结构化修改方案（文件清单 + 代码块 + 改动说明），不要再继续读文件。"
    : mode === "build"
    ? "下一轮必须调用 patch_file 或 write_file；若目标文件已 read 过，直接改，不要再 grep/read。\n若仍缺路径：最多 1 次 grep/search，然后立即修改。\n禁止重复 read 同一文件相同片段；禁止用英文写长分析。\n先用 1–2 句中文写根因假设，然后直接改代码。\n\n⚠️ Build 模式下分析不是产出，patch 才是产出。"
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

export function buildConsultativeExploreBudgetNudge(consecutiveExploreTurns: number): string {
  return [
    `【系统提示】咨询只读已连续 ${consecutiveExploreTurns} 轮探索、尚未给出回答。`,
    "请基于已有 grep/read 证据立即输出自然语言结论；禁止继续广搜或同一文件重叠 read。",
    "行为/是否类：若已 grep 到底层符号，须 read 其直接调用方后再答；仍不足则说明「无法确认」。",
  ].join("");
}

/** After grep locates .vue component files — nudge read before answering style questions. */
export function buildGrepHitVueReadNudge(vueFiles: string[]): string {
  const primary = vueFiles.slice(0, 2).join("、");
  return [
    `【系统提示】grep 已定位组件文件：${primary}。`,
    "下一轮须 read_file 该文件（含 template 与 `<style>` 段），再答样式/观感问题；禁止只 read 引用它的父视图。",
  ].join("");
}

/** Consultative read-only hit segment turn cap — force answer instead of auto-continuing. */
export function buildConsultativeSegmentCapNudge(turn: number, totalExploreTurns: number): string {
  return [
    `【系统提示】咨询只读已达第 ${turn} 轮段内上限（累计探索 ${totalExploreTurns} 轮）。`,
    "下一轮必须输出最终中文结论；若 CSS/逻辑证据不足，说明已确认部分与仍不确定部分，禁止写「下一轮再确认」。",
  ].join("");
}

/** Same grep/read batch repeated — stop exploring and answer from existing tool results. */
export function buildConsultativeDuplicateExploreNudge(): string {
  return [
    "【系统提示】你已重复执行相同的 grep/read 组合，且工具结果未变。",
    "禁止再调用工具；请基于已有 read/grep 输出立即给出最终中文答案。",
    "若 CSS 已在工具结果中，直接引用 background / var(--*) 作答，勿重复读同一文件。",
  ].join("");
}

/** Injected when grep returns no matches for a pattern in the current turn. */
export function buildGrepEmptyRecoveryNudge(patterns: string[]): string {
  const listed = patterns
    .slice(0, 3)
    .map((pattern) => `\`${pattern}\``)
    .join("、");
  return [
    `【系统提示】本轮 grep 未找到匹配：${listed}。`,
    "禁止重复相同 pattern；请改用精确函数/导出名、调用方符号，或更短的英文标识符。",
    "行为类问题：底层未命中时应 grep 上层 handler/composable 再 read，禁止广搜凑轮次。",
  ].join("");
}

export function buildAskExploreSoftCapNudge(totalExploreTurns: number): string {
  return [
    `【系统提示】Ask 模式已累计 ${totalExploreTurns} 轮探索（超过 ${ASK_MAX_TOTAL_EXPLORE_SOFT}）。`,
    "已移除 grep / search_files，只能 read_file 做最后确认。",
    "下一轮必须输出完整文字回答，不要再调用工具。",
  ].join("");
}

/** Plan explore — list_dir only with no read_file yet; soft nudge to output plan. */
export function buildPlanListDirOnlySoftNudge(totalExploreTurns: number): string {
  return [
    `【系统提示·Plan】已累计 ${totalExploreTurns} 轮只读探索，且尚未 read_file 任何源码。`,
    "若目录结构已足够理解需求，请立即输出 `[PLAN]` 或 `## 修改方案`（文件清单 + 代码块 + 改动说明）。",
    "若需求是新建独立工程/服务，可直接写脚手架方案，勿继续空扫目录。",
  ].join("");
}

/** Plan explore — force structured plan output after read budget is exhausted. */
export function buildPlanForceAnswerNudge(totalExploreTurns: number): string {
  return [
    `【系统强制·Plan】已累计 ${totalExploreTurns} 轮只读探索，规划阶段必须结案。`,
    "下一轮已移除所有工具，你只能输出文字。",
    "请立即输出结构化修改方案（`[PLAN]` 或 `## 修改方案` + 文件清单 + 代码块 + 改动说明）。",
    "若需求是新建独立项目/模块，直接给出脚手架与目录结构方案，勿再 list_dir/read。",
  ].join("");
}

/** Plan mode hit segment turn cap — must output structured plan next turn. */
export function buildPlanSegmentCapNudge(turn: number, totalExploreTurns: number): string {
  return [
    `【系统提示·Plan】规划阶段已达第 ${turn} 轮段内上限（累计探索 ${totalExploreTurns} 轮）。`,
    "下一轮必须输出结构化修改方案（`[PLAN]` 或 `## 修改方案` + 文件清单 + 代码块）；禁止再调用工具。",
  ].join("");
}

/** User quoted a plan excerpt and asked to change it — output a full revised plan. */
export function buildPlanRevisionFollowUpHint(): string {
  return [
    "【方案修订】用户引用了当前方案中的一段并提出了修改意见。",
    "须先 read_file 该条方案对应的 `.aiall/plans/` 文件（路径见 planFilePath），或承接会话中上一版完整方案，在全文基础上按用户意见增删改。",
    "下一轮必须输出完整结构化修改方案（`[PLAN]` 或 `## 修改方案` + 文件清单 + 代码块），禁止只回复「好的/已去掉」等短句。",
    "除非用户明确要求大范围重构，否则勿重新广泛探索；优先在既有方案上修订。",
  ].join("");
}

/** Pending plan exists — user adopted a prior consultative suggestion; amend, do not spawn Plan 2. */
export function buildPendingPlanAmendHint(planFilePath?: string): string {
  const planPathHint = planFilePath?.trim()
    ? `优先 read_file \`${planFilePath.trim()}\`；若用户已编辑该文件，以其为准。`
    : "优先 read_file 会话中第一份未执行的 `[PLAN]` / `.aiall/plans/` 方案文件，或承接会话内上一版完整方案正文。";
  return [
    "【Pending Plan·方案增量修订】当前会话存在尚未执行的修改方案（用户未点「执行方案」、代码未落盘）。",
    "用户已采纳你上一轮答疑中的建议，或在引用回复后给出短指令（如「持久化」「加上」「合并」）。",
    planPathHint,
    "禁止输出独立的新方案栈（Plan 2）；必须在既有 Pending Plan 全文基础上合并增量，输出一份完整修订版方案（`[PLAN]` 或 `## 修改方案` + 文件清单 + 代码块）。",
    "勿重新 list_dir 广泛扫描；最多 read 方案文件与本次增量涉及的 1–2 个关键文件。",
  ].join("");
}

/** Pending plan + ambiguous short follow-up — clarify merge vs separate before rewriting. */
export function buildPendingPlanClarificationHint(): string {
  return [
    "【Pending Plan·澄清】当前会话有尚未执行的方案，用户本条短指令含义不够明确。",
    "禁止输出 `[PLAN]` / `## 修改方案` / 新文件清单；用 2–4 句中文直接提问。",
    "须问清：用户希望把刚讨论的内容并入现有 Pending Plan，还是单独作为独立模块/子方案；可提示用户回复「合并」或「单独」。",
    "不要猜测后直接写方案。",
  ].join("");
}

/** User quoted a plan excerpt and asked an informational question — answer in chat only. */
export function buildPlanQuoteInformationalHint(): string {
  return [
    "【方案答疑】用户引用了当前方案中的一段并提问，未要求修改方案。",
    "须 read_file/grep 相关代码或配置核实引用内容的行为（如日志落盘位置、配置项、调用链），在会话中用中文直接回答。",
    "禁止输出 `[PLAN]` / `## 修改方案` / 文件清单 / 完整修订方案；勿改动 `.aiall/plans/` 下方案文件。",
    "回答 2–8 句即可，可引用路径或配置键；探索够了立即作答，不要凑方案格式。",
  ].join("");
}

/** User prompt has no target file paths — nudge plan without deep repo scan. */
export function buildPlanNoTargetPathHint(): string {
  return [
    "【规划提示】用户未指明具体文件/模块路径。",
    "请根据需求判断：若与当前仓库无关或是新建独立工程/服务，可直接输出脚手架方案，勿深入扫描无关目录；",
    "若存在无法从仓库佐证的歧义术语/专有名词，须先走澄清流向用户提问，禁止猜测其含义后直接写方案；",
    "若需对齐现有约定，最多 list_dir 一次后 read 关键入口文件，然后输出方案。",
  ].join("");
}

/** Sparse repo + ungrounded ambiguous terms — force clarification before any plan/scaffold. */
export function buildAmbiguousTermClarificationHint(terms: string[]): string {
  const listed = terms.map((term) => `「${term}」`).join("、");
  return [
    `【歧义词澄清·强制】用户消息含当前仓库无法佐证含义的术语：${listed}。`,
    "当前项目无可见业务代码可消歧，禁止猜测其指代（如臆测为某类技术栈、某个外部系统名、某个产品代号等）。",
    "本轮须用中文向用户提出 1–3 个澄清问题（须覆盖上述术语的可能含义与边界），禁止输出 `[PLAN]` / `## 修改方案` 或完整脚手架/示例 API。",
    "每个问题单独一段，标题行用「**1. …？**」格式；下一行起列出 2–4 个编号选项（1. 2. 3. 单独成行，每项不超过 60 字，供聊天区按钮点击），最后一项可为「其他（请说明）」；禁止用 - 子弹列表代替选项。",
    "示例：",
    "**1. 「foo」指的是什么？**",
    "1. 外部业务系统",
    "2. 可视化前端",
    "3. 其他（请说明）",
    "探索预算至少保留 1 轮用于澄清问答；收到用户明确答复后再探索或输出方案。",
  ].join("");
}

/** Model attempted plan/scaffold while clarification is still required. */
export function buildAmbiguousTermClarificationRetryNudge(terms: string[]): string {
  const listed = terms.map((term) => `「${term}」`).join("、");
  return [
    `【系统强制·歧义词澄清】上一轮在未澄清 ${listed} 的情况下输出了方案或脚手架代码。`,
    "禁止猜测；请立即改为仅向用户提问（1–3 个中文问句，覆盖术语可能含义），每个问题附 2–4 个编号选项（1. 2. 3. 单独成行）供聊天区点击；不要 bullet 列表、不要代码块、不要文件清单。",
  ].join("");
}

export function buildAskForceAnswerNudge(totalExploreTurns: number): string {
  return [
    `【系统强制】Ask 模式已累计 ${totalExploreTurns} 轮探索（超过 ${ASK_MAX_TOTAL_EXPLORE_HARD}）。`,
    "下一轮已移除所有工具，你只能输出文字。",
    "请基于已有信息给出完整结论；若信息不足，说明已确认部分与仍不确定部分。",
  ].join("");
}

export function buildExploreExploreBudgetNudge(consecutiveExploreTurns: number): string {
  return [
    `【系统提示】Explore 模式已连续 ${consecutiveExploreTurns} 轮仅探索、尚未输出报告。`,
    "请基于已读内容立即输出或更新项目理解报告（含 <!-- project-report --> 标记）。",
    "若仍缺关键片段：最多再 read 1–2 个代表文件，禁止重叠小 window 反复 read。",
  ].join("");
}

export function buildExploreExploreSoftCapNudge(totalExploreTurns: number): string {
  return [
    `【系统提示】Explore 模式已累计 ${totalExploreTurns} 轮探索（超过 ${EXPLORE_MAX_TOTAL_EXPLORE_SOFT}）。`,
    "已移除 grep / search_files，只能 read_file 做最后确认。",
    "下一轮必须输出完整项目理解报告，不要再调用工具。",
  ].join("");
}

export function buildExploreForceReportNudge(totalExploreTurns: number): string {
  return [
    `【系统强制】Explore 模式已累计 ${totalExploreTurns} 轮探索（超过 ${EXPLORE_MAX_TOTAL_EXPLORE_HARD}）。`,
    "下一轮已移除所有工具，你只能输出文字。",
    "请基于已有信息输出完整项目理解报告；未覆盖章节在 `## 标题` 末尾加（未探索）。",
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

/** Segment turn cap approaching — prioritize patch then summary. */
export function buildSegmentEmergencyFinishNudge(remainingTurns: number): string {
  return `【紧急提示】剩余 ${remainingTurns} 轮。请优先 patch_file 完成必要修改，然后输出中文总结；若任务已完成，直接写总结（已改文件、验证方式、剩余问题）。`;
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
    "禁止再读文件——你已有足够信息，立即改。",
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
    "下一轮开始须以 `<!-- agent-progress -->` 开头，随后用中文输出一段用户可见的进度摘要（2–4 句）：",
    "① 当前根因假设（须基于已读/grep 证据，禁止臆测未出现的符号或错误）；② 已读过哪些关键文件/行号；③ 下一步是 patch 还是仍需一次 read。",
    "摘要写完后才能继续调用工具；禁止仅用英文 \"Now let me...\" 句式。",
    "若 grep 零命中，或 read 片段与当前假设（错误类型/文件区域）不符，须在摘要中更正假设，勿重复已证伪方向。",
    "若已足够定位问题，本轮必须 patch_file / write_file。",
  ].join("");
}

/** Build mode: user gave an ultra-short open-ended instruction without scope. */
export function buildUltraShortOpenTaskHint(): string {
  return [
    "【超短任务·范围澄清】用户指令极短且未指明具体现象/文件/模块。",
    "第一步：用 1 句中文说明你的假设（验证脚本 / 运行时 / 当前打开文件 / 用户描述的现象等），再选一条路径执行；",
    "禁止无假设地广搜目录；优先读 package.json scripts，选用项目已有的 verify 命令（test/lint/typecheck/check），再 grep 精确符号。",
    "每轮 progress 须区分「已证实」与「待验证」；命令失败时勿宣称已看到完整错误列表。",
  ].join("");
}

/** After productive patch/write — remind to verify with project script or read-back. */
export function buildPostPatchVerifyNudge(verifyScript: string): string {
  return [
    "【系统提示·修改后验证】本轮已写入项目文件。",
    `下一轮须先验证再宣称修复完成：优先 run_command \`${verifyScript}\`，或 read_file 核对变更区。`,
    "禁止在未验证前输出「已修复全部/检查完成」；验证仍失败时说明剩余项，项目内错误须继续修，外部依赖可注明跳过。",
  ].join("");
}

/** When package.json has no detectable verify script — still require read-back. */
export function buildPostPatchReadVerifyNudge(): string {
  return [
    "【系统提示·修改后验证】本轮已写入项目文件，但项目未检测到标准 verify script。",
    "下一轮须 read_file 核对变更区，或 run_command 执行项目惯用的 test/lint/check 命令后再宣称修复完成。",
    "禁止在未验证前输出「已修复全部/检查完成」。",
  ].join("");
}

/**
 * Injected when user has expressed dissatisfaction ≥2 times consecutively.
 * Forces the model to abandon current approach and propose a completely different direction.
 */
export function buildUserNegationNudge(negationCount: number): string {
  return [
    `【系统提示】用户已连续 ${negationCount} 次表达不满（"不好看"/"换一种"等）。`,
    "当前设计方向不被认可，请立即停止在当前方向上微调。",
    "下一轮必须：",
    "1. 提出 2-3 个完全不同设计风格的方案（如：从圆形→胶囊形、从实心→线框、从纯色→渐变等形态级变化）",
    "2. 用简短文字描述每个方案的视觉特点，让用户选择",
    "3. 不要直接执行修改，先让用户确认方向",
    "禁止继续调整当前方案的参数（颜色/大小/圆角等），必须切换设计方向。",
  ].join("");
}

/**
 * Injected when the model reads too many different files in explore-only mode.
 * Guides it to narrow focus rather than spreading across unrelated areas.
 */
/** Model ended a turn with empty or near-empty user-visible text. */
export function buildEmptyReplyRetryNudge(): string {
  return [
    "【系统强制】上一轮未输出任何面向用户的有效正文（空回复或仅空白）。",
    "请用中文写出完整结论：做了什么、验证了什么、用户下一步如何测试；若任务未完成，说明阻塞点与所需信息。",
    "禁止无正文结束；若仍需工具，先写 1–2 句进度摘要再调用。",
  ].join("");
}

/** Model declared success / all-correct without tool evidence or despite user failure reports. */
export function buildPrematureCompletionRetryNudge(userReportedFailure: boolean): string {
  const lines = [
    "【系统强制】上一轮回复过早宣称「全部正确/无需再改/检查完成✅」，但缺乏工具证据或用户实测仍失败。",
    "禁止 rubber-stamp 式自检；须基于 read/grep 结果与用户反馈逐项核对。",
    "未验证项写「无法确认」；失败项如实标注；区分主路径效果与降级/兜底 UI。",
  ];
  if (userReportedFailure) {
    lines.push("用户已报告「试了不行/没有效果」——禁止重复宣称成功，须换排查方向或给出可执行验证步骤。");
  }
  return lines.join("");
}

/** Short 「检查/核对/复查」 prompts — evidence-based review, not affirmation. */
export function buildCodeReviewHonestyNudge(userReportedFailure: boolean): string {
  const lines = [
    "",
    "【代码核对·只读】用户要求检查/核对实现，不是索要肯定答复。",
    "须 read/grep 对照仓库现状；结论分「已确认」「未验证」「与用户反馈矛盾」三类。",
    "禁止在未对照工具结果前写「全部正确✅/无逻辑漏洞/可以测试了」。",
  ];
  if (userReportedFailure) {
    lines.push("用户近期报告实测失败：优先排查为何无效，勿重复「链路完整」类总结。");
  }
  return lines.join("\n");
}

/** User likely pasted an error/banner string they saw — clarify intent before implementing. */
export function buildUserErrorQuoteHint(): string {
  return [
    "",
    "【用户可能在复述报错/横幅】本条短消息可能是用户粘贴他们看到的提示文案，而非要求原样实现该文案。",
    "先判断：是在报告问题、询问含义，还是要求新增该提示？",
    "若是报告问题：定位根因并修复底层能力；若是询问：解释含义；勿把报错文本当作产品需求直接复刻。",
  ].join("\n");
}

/** User reported the feature still does not work — pivot from repeat patches to diagnosis. */
export function buildUserFailureReportNudge(): string {
  return [
    "",
    "【实测失败反馈】用户报告先前改动未达预期（试了不行/没有效果等）。",
    "禁止再次输出「已完成/无需再改」式总结；须：①承认未验证或仍失败；②列出与预期不符的具体点；③给出下一步排查或不同方案。",
    "若涉及原生/系统能力，先确认运行环境（Web dev vs 桌面壳）是否匹配测试方式。",
    buildUiSymptomDiagnosisHint(),
  ].join("\n");
}

/** Structural UI symptom checklist — not bound to any specific feature. */
export function buildUiSymptomDiagnosisHint(): string {
  return [
    "【UI 分症状排查】禁止在同一文件反复微调 position/bottom/sticky 组合；按序核对：",
    "① v-if/显示条件与 scroll/resize 事件是否更新；② 控件是否在 overflow-y:auto 子树内（改 overlay sibling）；",
    "③ 外框可见但符号/文字空白：grep/read 全局 element 选择器（如 button { padding }）是否与 compact 控件 width/height 冲突，组件内须 padding:0 + box-sizing:border-box，再查内层 text/SVG；勿只改 stroke/currentColor；",
    "④ 给出用户可复现验证步骤（含当前 tab/模式前提）。",
  ].join("");
}

/** patch_file failed but assistant claimed overall success — force honest audit. */
export function buildPatchFailureCompletionRetryNudge(
  failedPaths: string[],
  successPaths: string[],
): string {
  const failed = failedPaths.filter(Boolean).join("、") || "未知";
  const success = successPaths.filter(Boolean).join("、") || "无";
  return [
    "【系统强制·修改审计】你宣称已完成，但本轮会话存在 patch_file 失败，禁止把部分成功说成「全部完成」。",
    `失败文件：${failed}；已成功：${success}。`,
    "须列出失败项与原因（old_string 不匹配等），read 后重试 patch 或换方案；若用户仍报告无效，用分症状排查，禁止「无需修改/没有 bug」。",
  ].join("");
}

export function buildExplorationArchiveWriteBlockedMessage(): string {
  return "错误：同问题追问且用户报告仍失败时，禁止 write_file 探索笔记；请直接 patch 源码或输出分症状结论。";
}

/** Repeated patch failures on one file — switch strategy instead of tweaking CSS. */
export function buildAlternateUiPatchStrategyNudge(filePath: string): string {
  return [
    `【系统提示】${filePath} 已连续多次 patch_file 失败（old_string 不匹配）。`,
    "禁止凭记忆再构造 old_string；read_file 后从返回原文复制更短且唯一的片段；或一次读更大范围（300–500 行）。",
    "若属 UI 浮层/滚动区问题，考虑换 overlay sibling 方案，勿再微调同一组 position/bottom。",
  ].join("");
}

/** Same-thread follow-up after assistant claimed a fix — must connect prior scope before re-exploring. */
export function buildSameIssueFollowUpHint(): string {
  return [
    "",
    "【同问题追问·前轮已宣称修复】用户在同一会话继续报告异常或质疑修复是否完整。",
    "① 先回顾前轮改了什么、针对哪个可见症状；列出仍存疑的现象，勿假设已解决。",
    "② 从用户操作入口 trace 完整链路（入口→编排→副作用/持久化→UI 展示）；禁止只修展示/format 单分支而忽略状态默认值、列表投影、切换/路由等关联路径。",
    "③ patch 前 grep import 确认运行时入口；未引用的同名/近似路径文件勿改。",
    "④ 若前轮修复不完整须显式承认并扩大范围；禁止再次无验证「修复完成」。",
    "⑤ 探索预算收紧：基于会话已有上下文优先 patch 或分症状结论，禁止从零广搜全链路。",
    "禁止 write_file 写探索笔记或归档 markdown；结论直接用于 patch 或用户可见回复。",
    buildUiSymptomDiagnosisHint(),
  ].join("\n");
}

/** Hard cap for same-issue follow-up without productive patch — force structured status, not endless read. */
export function buildSameIssueFollowUpForceSummaryNudge(totalExploreTurns: number): string {
  return [
    `【系统强制·同问题追问】已累计 ${totalExploreTurns} 轮探索且尚未提交有效代码修改。`,
    "下一轮已移除 read/grep/search；你必须用中文输出结构化结论：",
    "① 前轮修复覆盖了什么、遗漏了什么；② 各可见症状在调用链上的状态（已确认/未验证/仍异常）；③ 若需继续改代码，列出目标文件与改动要点（下轮再 patch）。",
    "禁止继续探索或写探索笔记；禁止再次无依据宣称「修复完成」。",
  ].join("");
}

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
