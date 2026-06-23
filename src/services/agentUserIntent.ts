/** Explicit change / implementation intent — Build may write. */
export const IMPLEMENT_INTENT_RE =
  /(?:帮我|请|麻烦)?(?:改|修|修复|实现|添加|新增|删除|创建|优化|调整|更新|写入|落地|开发|执行|替换|重构|改成|改为|改一下|改下|写一[个份]?|做一[个份]?|fix|implement|add\b|create\b|update\b|refactor\b)/i;

/** Short confirm-to-implement after prior analysis (e.g. 「修复吧」). */
const SHORT_IMPLEMENT_PROMPT_RE =
  /^(?:请?)?(?:修复|改一下|改(?:吧|了|下)?|修|实现|动手|执行|应用|写入|落地|按(?:此|上面)?(?:方案|分析)?)(?:吧|了|下)?[。！!]?$/i;

/** Accuracy / behavior Q&A without asking to change code yet. */
const ACCURACY_CONSULTATIVE_RE =
  /是否.{0,20}(?:准确|正确|总是|一直|可靠)|(?:准确|正确|可靠).{0,12}(?:吗|么)[？?]?$/i;

/** Observed-behavior question (e.g. 「也会通知？」) — consultative, not implement. */
const OBSERVED_BEHAVIOR_QUESTION_RE =
  /(?:也会|还会|是不是会|会不会|有没有).{0,20}(?:通知|弹窗|提示|提醒)|(?:通知|弹窗|提示).{0,12}(?:吗|么|吧)[？?]?$/i;

/** Question / explanation intent without asking to change code. */
const CONSULTATIVE_MARKERS_RE =
  /(?:什么|为什么|为啥|如何|怎么|怎样|哪里|哪儿|是否|是不是|能不能|可不可以|能否|干嘛|干啥|啥是|是什么|有没有|对不对|什么意思|啥意思|吗[？?]?$|[？?]$)/;

/** Resume / plan execution prompts must keep write access. */
const AUTOMATION_PROMPT_RE = /^\s*(?:【|\[)(?:方案执行|精准修改|效率|系统自动续跑|读图完成)/;

/** Short evaluative follow-up — consultative even when it contains verbs like 「优化」. */
const SHORT_EVALUATIVE_FOLLOW_UP_RE =
  /^(?:需要|要不要|是否|还得|还要|值得|可以|那)?[^。！!]{0,24}(?:吗|呢)[？?]?\s*$/;

/** User reports prior change did not take effect — not a read-only evaluative question. */
const IMPLEMENTATION_FAILURE_REPORT_RE =
  /没生效|不生效|未生效|没效果|没有效果|没变化|不起作用|试了.{0,16}(?:没有|没|不|无效)|仍然(?:没有|没|不)|还是(?:没有|没|不)/i;

/** User says observed behavior contradicts a prior assistant claim (not merely「试了不行」). */
const BEHAVIOR_CONTRADICTION_MARKER_RE =
  /但是|可是|然而|不对|不知道为啥|奇怪|咋会|怎么会|实际上|明明/i;

/** Prior assistant made a negative / binary behavioral claim. */
const PRIOR_NEGATIVE_BEHAVIOR_CLAIM_RE =
  /(?:^|\n)\s*(?:\*\*)?(?:不会|不(?:会|能)?更新|没有.{0,12}更新|不改变|不涉及|只是.{0,16}(?:改|设置|指向))(?:\*\*)?/im;

/** User asks whether a prior implementation task is done (progress check, not a new implement request). */
const IMPLEMENTATION_STATUS_PROMPT_RE =
  /(?:改好|做完|写好|弄好|搞定|完成|实现好|落地)[了吗呢]?[？?]?\s*$|(?:好了吗|完成了吗|做完了吗|改完了吗)[？?]?\s*$/i;

/** User wants to resume patching after prior analysis or partial implementation. */
const CONTINUE_IMPLEMENT_PROMPT_RE =
  /^(?:请?)?(?:继续|接着)(?:改|做|实现|修|完善|完成)/i;

/** Screenshot-backed UI defect — user shows broken layout/position; Build should fix, not read-only Q&A. */
const UI_DEFECT_REPORT_RE =
  /看到没|你看|你瞧|分明|明显|错位|跑(?:到|去|别的)|飘|歪|不对|坏了|出问题了|有问题|挤一块|重叠|太紧/i;

const UI_DEFECT_SUBJECT_RE =
  /按钮|控件|布局|位置|样式|界面|面板|输入框|弹窗|浮动|引用|图标/i;

/** User asks what an agent investigation step or API attribute means — explain first, not read-only Build. */
const STEP_CLARIFICATION_RE = /啥意思|什么意思|啥是|是什么|干吗|干嘛|怎么理解|confirm\s*啥|确认.*(?:啥|什么)/i;

/** Short code review / verification request — read-only, evidence-based. */
const CODE_REVIEW_PROMPT_RE =
  /^(?:请?)?(?:检查|核对|复查|自检|验证|确认)(?:一下|下)?(?:代码|改动|修改|实现|吧|了)?[。！!]?$/i;

/** Message shape: user pasted system/error copy (often no question mark, short). */
const ERROR_QUOTE_SHAPE_RE =
  /^(?:错误|警告|提示|通知|失败|已被拒绝|不可用|权限|拒绝|未授权)/;

const STEP_OR_API_REFERENCE_RE =
  /(?:读取|read|grep|opening|Teleport|target|anchor|定位|浮层|fixed|patch|工具|这一步|这步|opening tag)/i;

export function isAgentStepClarificationPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  return STEP_CLARIFICATION_RE.test(text) && STEP_OR_API_REFERENCE_RE.test(text);
}

export function isCodeReviewPrompt(prompt: string): boolean {
  return CODE_REVIEW_PROMPT_RE.test(prompt.trim());
}

/** User likely pasted an error/banner they saw — not necessarily a new feature request. */
export function isUserErrorQuotePrompt(
  prompt: string,
  history?: UserIntentHistoryMessage[],
): boolean {
  const text = prompt.trim();
  if (!text || text.length > 160) return false;
  if (/[？?]$/.test(text)) return false;
  if (IMPLEMENT_INTENT_RE.test(text)) return false;
  if (ERROR_QUOTE_SHAPE_RE.test(text)) return true;
  const snippet = text.slice(0, Math.min(48, text.length));
  if (snippet.length < 8) return false;
  const recentAssistant = (history ?? [])
    .filter((m) => m.role === "assistant")
    .slice(-3)
    .map((m) => m.content)
    .join("\n");
  return recentAssistant.includes(snippet);
}

/** User asks whether agent can see attached screenshot issue — treat as UI defect when image present. */
export function isScreenshotVisibilityPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  return /能看到|看见|看清|看到.*问题|截图.*问题|问题.*截图/i.test(text);
}

export function isUiDefectReportPrompt(prompt: string, hasImage = false): boolean {
  const text = prompt.trim();
  if (!text) return false;
  if (hasImage && isScreenshotVisibilityPrompt(text)) return true;
  return UI_DEFECT_REPORT_RE.test(text) && UI_DEFECT_SUBJECT_RE.test(text);
}

export function isShortImplementPrompt(prompt: string): boolean {
  return SHORT_IMPLEMENT_PROMPT_RE.test(prompt.trim());
}

export type UserIntentHistoryMessage = { role: string; content: string };

export function isImplementationStatusPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  return IMPLEMENTATION_STATUS_PROMPT_RE.test(text);
}

/** Prior turns already analyzed positioning/coordinates — user now wants code applied. */
export function historySuggestsQuotePositionFix(history?: UserIntentHistoryMessage[]): boolean {
  const text = (history ?? [])
    .slice(-6)
    .filter((m) => m.role === "assistant" || m.role === "user")
    .map((m) => m.content)
    .join("\n");
  if (!text.trim()) return false;
  // 检测消息结构：已有定位/坐标分析 + 修复方案结论
  const hasPositionAnalysis = /定位|坐标|位置|浮层|fixed|absolute|Teleport|锚点|偏移/i.test(text);
  const hasAnalysisConclusion = /根因|原因|问题在于|分析|诊断|排查/i.test(text);
  const hasFixProposal = /修复方案|修改方案|建议|patch|改法/i.test(text);
  return hasPositionAnalysis && (hasAnalysisConclusion || hasFixProposal);
}

/** Recent turns mention an in-flight or partial code change task. */
export function historySuggestsActiveImplementation(history?: UserIntentHistoryMessage[]): boolean {
  const text = (history ?? [])
    .slice(-8)
    .filter((m) => m.role === "assistant" || m.role === "user")
    .map((m) => m.content)
    .join("\n");
  if (!text.trim()) return false;
  if (historySuggestsQuotePositionFix(history)) return true;
  return /(?:改吧|实现吧|执行吧|继续改|动手吧|patch_file|write_file|已修改|修改方案|实施计划|下一步需要|部分改好|未完成|须改代码|让我完成|剩余(?:的)?实现)/i.test(
    text,
  );
}

export function isImplementFollowUpRun(
  prompt: string,
  history?: UserIntentHistoryMessage[],
  opts?: { isAsk?: boolean },
): boolean {
  if (opts?.isAsk) return false;
  const text = prompt.trim();
  if (!text) return false;
  if (!historySuggestsActiveImplementation(history)) return false;
  if (isShortImplementPrompt(text)) return true;
  if (CONTINUE_IMPLEMENT_PROMPT_RE.test(text)) return true;
  if (isImplementationFailureReportPrompt(text)) return true;
  if (IMPLEMENT_INTENT_RE.test(text) && !isImplementationStatusPrompt(text)) return true;
  return false;
}

export function isImplementationFailureReportPrompt(prompt: string): boolean {
  return IMPLEMENTATION_FAILURE_REPORT_RE.test(prompt.trim());
}

/** User reports phenomenon that conflicts with the assistant's prior「不会/不更新」类结论. */
export function isBehaviorContradictionPrompt(
  prompt: string,
  history?: UserIntentHistoryMessage[],
): boolean {
  const text = prompt.trim();
  if (!text) return false;
  if (isImplementationFailureReportPrompt(text)) return false;
  if (isShortImplementPrompt(text)) return false;
  if (IMPLEMENT_INTENT_RE.test(text) && !BEHAVIOR_CONTRADICTION_MARKER_RE.test(text)) return false;
  if (!BEHAVIOR_CONTRADICTION_MARKER_RE.test(text)) return false;
  if (!/(?:会|有|跳|跑|变|出现|显示|排序|更新|通知|消失|移到|跑到|往上|往下)/i.test(text)) return false;

  const lastAssistant = (history ?? [])
    .filter((m) => m.role === "assistant")
    .slice(-1)[0]?.content;
  if (!lastAssistant?.trim()) return false;
  return PRIOR_NEGATIVE_BEHAVIOR_CLAIM_RE.test(lastAssistant);
}

export function buildBehaviorContradictionHint(): string {
  return [
    "",
    "【现象与上轮矛盾】用户反馈的实际现象与上一条助手结论不符。",
    "禁止维持上轮「不会/不更新/仅…」等结论；须显式承认先前结论不完整或有误。",
    "从用户操作入口重新 trace 调用链（入口 → 编排层 → 副作用/持久化），grep 命中底层符号后必须 read 其直接调用方及完整函数体。",
    "结论须附带代码中的 if/guard 前提；咨询只读时先给出更正后的根因，用户明确实施指令后再 patch。",
  ].join("\n");
}

/** Question-shaped message describing observed behavior — not an implement command. */
function isQuestionShapedConsultative(text: string): boolean {
  if (!/[？?]\s*$/.test(text)) return false;
  if (!CONSULTATIVE_MARKERS_RE.test(text)) return false;
  if (/^(?:请|帮我|帮忙|麻烦)/.test(text) && IMPLEMENT_INTENT_RE.test(text)) return false;
  return true;
}

export function isConsultativeUserPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  if (AUTOMATION_PROMPT_RE.test(text)) return false;
  if (isUiDefectReportPrompt(text)) return false;
  if (isAgentStepClarificationPrompt(text)) return false;
  if (isImplementationFailureReportPrompt(text)) return false;
  if (SHORT_EVALUATIVE_FOLLOW_UP_RE.test(text)) return true;
  if (ACCURACY_CONSULTATIVE_RE.test(text)) return true;
  if (OBSERVED_BEHAVIOR_QUESTION_RE.test(text)) return true;
  if (isQuestionShapedConsultative(text)) return true;
  if (IMPLEMENT_INTENT_RE.test(text)) return false;
  return CONSULTATIVE_MARKERS_RE.test(text);
}

export function buildConsultativeBuildHint(): string {
  return [
    "",
    "【咨询任务·只读】用户本条仅为提问/解释，未要求改代码。",
    "只允许 list_dir / read_file / grep / search_files；禁止 patch_file / write_file / delete_file。",
    "优先 grep 精确符号；「会不会/是否/做 X 时会不会 Y」须 trace 入口→编排层→副作用，read 目标函数及至少一层直接调用方后再答；禁止只读最底层 export。",
    "勿广搜或同一文件多段重叠 read；信息足够后立即用自然语言回答「当前代码下会怎样」，勿连环读取无关文件。",
    "禁止在未对照工具结果前宣称「逻辑已正确/无需再改/链路完整」；需要改代码时说明结论并请用户发送明确实施指令。",
    "若写工具返回「Build 只读轮」相关错误：当前仍是 Build 模式，只是本条被标为咨询只读；禁止向用户称 Ask 模式或让用户切换 Build。",
  ].join("\n");
}

export function buildConsultativeResumeHint(): string {
  return [
    "【咨询续跑·只读】原始消息仅为提问/解释，未要求改代码。",
    "请根据下方已完成的 grep/read 证据直接回答原始问题；禁止 patch_file / write_file / delete_file。",
    "禁止宣称「上一轮的 patch 已生效/无需再改/逻辑已正确」——须基于当前磁盘代码说明结论；若曾误执行写操作，说明现状即可，勿重复 patch。",
    "相同文件区域禁止再 read_file；最多 1 次 grep 补齐遗漏。",
  ].join("\n");
}

export function buildImplementationStatusHint(): string {
  return [
    "",
    "【实施进度追问】用户在问前述改动是否已完成。",
    "只读 grep/read 核对仓库现状后直接回答进度；禁止 patch_file / write_file。",
    "禁止称 Ask 模式或让用户切换 Build（当前为 Build 模式的咨询只读轮）。",
  ].join("\n");
}

export function buildImplementFollowUpHint(quotePositionFix = false): string {
  const lines = [
    "",
    "【确认执行·须改代码】用户在上文分析或部分实施后要求继续修复/改吧，不是再要一篇分析。",
    "最多 1–2 次 read_file 核对目标后即 patch_file/write_file；禁止只分析并反问「要不要修」。",
    "禁止输出「请将以下修改应用到…」或只贴代码块让用户手动改；你必须亲自提交 patch。",
  ];
  if (quotePositionFix) {
    lines.push(
      "最多 1 次 read_file 核对上文已定位的目标函数；禁止重复 grep 已讨论过的定位问题。",
      "优先改上文已识别的目标文件和函数。",
    );
  }
  return lines.join("\n");
}

/** Shown in Build system prompt — disambiguate write-tool errors from UI Ask mode. */
export function buildBuildWriteBlockedHint(): string {
  return [
    "写工具若返回「Build 只读轮」：说明本条被标为【咨询任务·只读】，不是 UI 的 Ask 模式；禁止让用户切换 Build 或称 Ask 模式。",
    "写工具若返回「Ask 模式下不支持」：才表示用户确实在 Ask 模式。",
  ].join("\n");
}

export type WriteToolBlockReason = "ask" | "plan" | "consultative_build";

export function buildWriteToolBlockedMessage(reason: WriteToolBlockReason): string {
  if (reason === "ask") {
    return "Ask 模式下不支持文件修改，请仅使用只读工具查询项目。";
  }
  if (reason === "plan") {
    return "Plan 规划阶段不支持文件修改，请先输出方案；用户确认后再执行。";
  }
  return (
    "错误：本条为咨询任务（Build 只读轮），不支持写文件。" +
    "请用自然语言回答；若须继续改代码，请用户发送明确实施指令（如「继续改」）。" +
    "禁止向用户称「Ask 模式」或让用户切换 Build。"
  );
}

export function buildUiDefectBuildHint(): string {
  return [
    "",
    "【UI 缺陷·须修复】用户用截图反馈控件/布局异常。",
    "须定位后 patch_file/write_file；禁止只分析并反问「要不要修」。",
    "控件与选区/焦点在空间上分离时优先查浮层定位（fixed/absolute/Teleport），勿查底栏 flex。",
    "排查 mouseup 与 getSelection 时序：选区在 mouseup 时可能尚未就绪，关注异步回调链路。",
  ].join("\n");
}

export function buildAgentStepClarificationHint(): string {
  return [
    "",
    "【用户追问排查步骤】用户在问「你这步是在确认什么」或某属性/API 含义。",
    "本轮禁止调用工具；先用 2–4 句中文面向用户解释（勿写 planning 句如「让我读取…」）。",
    "解释后若任务仍是修 UI 缺陷：下一轮直接定位并 patch，勿再重复解释。",
  ].join("\n");
}

export function buildAgentStepClarifyContinueHint(): string {
  return [
    "【解释已完成】若上文已回答用户「啥意思」，且仍在修浮层错位：",
    "下一轮禁止重复解释或再读 Teleport；直接 patch show*At / getSelection* 相关逻辑，或 1 次 read 后立即 patch。",
  ].join("");
}

/** User pasted session-audit task (evaluate another Vibe chat's agent quality). */
const SESSION_AUDIT_TASK_RE =
  /【任务】请自行排查以下\s*AIALL\s*Vibe\s*会话|Agent\s*回复的准确度|会话文件.*chat-\d{10,}/i;

export function isSessionAuditPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  return SESSION_AUDIT_TASK_RE.test(text);
}

export function buildSessionAuditHint(): string {
  return [
    "",
    "【会话审计·只读】用户要求评估另一 Vibe 会话中 Agent 的回复质量；勿回答被审计会话内的业务/编程问题。",
    "优先读取用户给出的会话 JSON：若路径以 aiall/vibe-chat-sessions/ 开头，这是逻辑路径，会自动映射到 %APPDATA%\\aiall\\vibe-chat-sessions\\；不要先在项目根目录搜索 aiall。",
    "若用户同时给出磁盘实际路径，用 read_file 直接读该绝对路径；大 JSON 用 offset/limit 分段读取，禁止 run_command 分页读文件。",
    "审计工具记录时必须区分证据强度：只根据 tools/roundGroups/statusLog 中明确出现的内容下结论；若工具摘要缺少具体输出，只能写“摘要不足，无法确认”，禁止断言 Agent 未验证或编造。",
    "输出应聚焦准确性、工具调用、上下文理解、表达结构；把确定问题、推测风险、无法判断项分开写，避免把被审计会话中的业务问题展开解答。",
    "禁止 write_file 将审计报告写入仓库；结论直接写入聊天回复。",
  ].join("\n");
}
