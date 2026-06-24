import { stripQuotedReplyPrefix } from "./agentContinuation";
import { assistantProvidedCodeLocationEvidence, PRIOR_DEFINITION_LISTING_RE } from "./agentStructuralPatterns";

/** Explicit change / implementation intent — Build may write. */
export const IMPLEMENT_INTENT_RE =
  /(?:帮我|请|麻烦)?(?:改|修|修复|实现|添加|新增|删除|创建|优化|调整|更新|写入|落地|开发|执行|替换|重构|改成|改为|改一下|改下|写一[个份]?|做一[个份]?|fix|implement|add\b|create\b|update\b|refactor\b)/i;

/** Short confirm-to-implement after prior analysis (e.g. 「修复吧」). */
const SHORT_IMPLEMENT_PROMPT_RE =
  /^(?:请?)?(?:修复|改一下|改(?:吧|了|下)?|修|实现|动手|执行|应用|写入|落地|按(?:此|上面)?(?:方案|分析)?)(?:吧|了|下)?[。！!]?$/i;

/** Accuracy / behavior Q&A without asking to change code yet. */
export const ACCURACY_CONSULTATIVE_RE =
  /是否.{0,20}(?:准确|正确|总是|一直|可靠)|(?:准确|正确|可靠).{0,12}(?:吗|么)[？?]?$/i;

export function isAccuracyConsultativePrompt(prompt: string): boolean {
  return ACCURACY_CONSULTATIVE_RE.test(prompt.trim());
}

/** Observed-behavior question (e.g. 「也会通知？」) — consultative, not implement. */
const OBSERVED_BEHAVIOR_QUESTION_RE =
  /(?:也会|还会|是不是会|会不会|有没有).{0,20}(?:通知|弹窗|提示|提醒)|(?:通知|弹窗|提示).{0,12}(?:吗|么|吧)[？?]?$/i;

/** Question / explanation intent without asking to change code. */
const CONSULTATIVE_MARKERS_RE =
  /(?:什么|为什么|为啥|如何|怎么|怎样|哪里|哪儿|是否|是不是|能不能|可不可以|能否|干嘛|干啥|啥是|是什么|有没有|对不对|什么意思|啥意思|啥作用|什么作用|有啥用|有什么用|干嘛用|吗[？?]?$|[？?]$)/;

/** User asks what a field/enum/type does in runtime (not merely what values exist). */
const BEHAVIOR_PURPOSE_PROMPT_RE =
  /(?:啥作用|什么作用|有啥用|有什么用|干嘛用|做啥用|何时用|什么时候用|什么情况下|啥情况下|用来干|用来做什么|什么用途|有何作用)/;

/** Prior assistant listed enum/field values — user now asks purpose of subset. */
const PRIOR_ENUM_LISTING_RE = PRIOR_DEFINITION_LISTING_RE;

/** Resume / plan execution prompts must keep write access. */
const AUTOMATION_PROMPT_RE = /^\s*(?:【|\[)(?:方案执行|精准修改|效率|系统自动续跑|读图完成)/;

/** Short evaluative follow-up — consultative even when it contains verbs like 「优化」. */
const SHORT_EVALUATIVE_FOLLOW_UP_RE =
  /^(?:需要|要不要|是否|还得|还要|值得|可以|那)?[^。！!]{0,24}(?:吗|呢)[？?]?\s*$/;

/** User reports prior change did not take effect — not a read-only evaluative question. */
const IMPLEMENTATION_FAILURE_REPORT_RE =
  /没生效|不生效|未生效|没效果|没有效果|没变化|不起作用|试了.{0,16}(?:没有|没|不|无效)|仍然(?:没有|没|不)|还是(?:没有|没|不)|明明(?:没有|没|不)/i;

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
  /按钮|控件|布局|位置|样式|界面|面板|输入框|弹窗|浮动|图标/i;

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

/** Prior assistant claimed the issue was fixed (structural markers, not topic-specific). */
const PRIOR_FIX_CLAIM_RE =
  /(?:✅|修复完成|修改已完成|已完成修复|问题已修复|已修复|已改完|应该(?:可以|没问题|能看到)了|(?:现在|已).{0,8}(?:可见|清晰|能看))|刷新(?:应用|页面)?(?:后|看看)/i;

/** User asks which UI region / element a screenshot shows (locate-only, not implement). */
export const UI_LOCATE_QUESTION_RE =
  /(?:哪(?:儿|里|块|个)|什么|啥)(?:的)?(?:按钮|控件|面板|区域|组件|元素|部分|内容)|(?:知道|看得出|认得|识别).{0,12}(?:哪儿|哪里|哪块|哪个)|显示的(?:什么|啥)|(?:这里|这边|旁边|此处).{0,12}(?:啥|什么)|(?:这是|那是)(?:什么|啥)/;

export function isUiLocateQuestionPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  return UI_LOCATE_QUESTION_RE.test(text);
}

/** User asks about visual style (transparency, blur, color) from a screenshot — consultative. */
export const UI_APPEARANCE_QUESTION_RE =
  /背景.{0,12}(?:透明|半透明|模糊|毛玻璃|虚化)|(?:透明|半透明|毛玻璃|blur|backdrop).{0,12}(?:吗|么|[？?]\s*$)|(?:opacity|rgba).{0,12}(?:吗|么|[？?]\s*$)/i;

export function isUiAppearanceQuestionPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  return UI_APPEARANCE_QUESTION_RE.test(text);
}

/** User asks whether prior turn already located the target in code — reuse evidence, no re-grep. */
export const LOCATE_STATUS_FOLLOW_UP_RE =
  /(?:找到|定位|搜到|查到).{0,12}(?:了吗|了么|没)|(?:已经)?(?:找到|定位).{0,6}[？?]\s*$|找.{0,4}(?:到了|着了)[？?]\s*$/;

export function historyPriorAssistantLocatedUi(
  history?: UserIntentHistoryMessage[],
): boolean {
  const last = (history ?? []).filter((m) => m.role === "assistant").slice(-1)[0];
  if (!last?.content?.trim()) return false;
  return assistantProvidedCodeLocationEvidence(last.content);
}

export function isLocateStatusFollowUpPrompt(
  prompt: string,
  history?: UserIntentHistoryMessage[],
): boolean {
  const text = prompt.trim();
  if (!text || !LOCATE_STATUS_FOLLOW_UP_RE.test(text)) return false;
  if (IMPLEMENT_INTENT_RE.test(text)) return false;
  return historyPriorAssistantLocatedUi(history);
}

export function buildLocateStatusFollowUpHint(): string {
  return [
    "【定位进度追问】用户仅问上一轮是否已在代码中定位到目标。",
    "须直接引用上一条已给出的文件路径与样式/CSS 结论作答；禁止重复 grep/read 整文件。",
    "若上一条已给出 `.vue` 与 background 证据，回答「是的，已在 … 中找到」并复述关键一行即可。",
  ].join("\n");
}

/** User continues reporting the same problem domain after a prior fix claim. */
const SAME_ISSUE_FOLLOW_UP_RE =
  /(?:还有|仍(?:然)?有|依然).{0,8}问题|发现.{0,12}问题|问题.{0,8}(?:没|吗)[？?]?|还是有问题|没(?:解决|修好)|(?:排查|检查).{0,8}(?:下|一下)/i;

export function historyPriorAssistantClaimedFix(history?: UserIntentHistoryMessage[]): boolean {
  const assistants = (history ?? []).filter((m) => m.role === "assistant").slice(-2);
  return assistants.some((m) => PRIOR_FIX_CLAIM_RE.test(m.content));
}

export function isSameIssueFollowUpRun(
  prompt: string,
  history?: UserIntentHistoryMessage[],
): boolean {
  const text = prompt.trim();
  if (!text || !historyPriorAssistantClaimedFix(history)) return false;
  if (SAME_ISSUE_FOLLOW_UP_RE.test(text)) return true;
  if (isImplementationFailureReportPrompt(text)) return true;
  if (isBehaviorContradictionPrompt(text, history)) return true;
  return false;
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

export function isBehaviorPurposePrompt(
  prompt: string,
  history?: UserIntentHistoryMessage[],
): boolean {
  const text = stripQuotedReplyPrefix(prompt.trim());
  if (!text) return false;
  if (AUTOMATION_PROMPT_RE.test(text)) return false;
  if (IMPLEMENT_INTENT_RE.test(text) && !BEHAVIOR_PURPOSE_PROMPT_RE.test(text)) return false;
  if (BEHAVIOR_PURPOSE_PROMPT_RE.test(text)) return true;

  const lastAssistant = (history ?? [])
    .filter((m) => m.role === "assistant")
    .slice(-1)[0]?.content;
  if (!lastAssistant?.trim()) return false;
  if (!PRIOR_ENUM_LISTING_RE.test(lastAssistant)) return false;

  return /(?:作用|用途|干嘛|干啥|干啥用|怎么用|何时|什么时候)/.test(text) && text.length <= 120;
}

export function buildBehaviorPurposeHint(): string {
  return [
    "",
    "【行为·用途/作用】用户问的是运行时用途或分支差异，不是再要枚举/字段定义列表。",
    "grep 符号后须 read 引用处（if/switch、handler、更新/校验逻辑），说明满足何条件 → 触发何副作用。",
    "禁止只复述枚举值；禁止「可能…作为标识」「具体使用位置需要查看」推给用户查。",
  ].join("\n");
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

export function isConsultativeUserPrompt(
  prompt: string,
  history?: UserIntentHistoryMessage[],
): boolean {
  const text = prompt.trim();
  if (!text) return false;
  if (AUTOMATION_PROMPT_RE.test(text)) return false;
  if (isUiDefectReportPrompt(text)) return false;
  if (isAgentStepClarificationPrompt(text)) return false;
  if (isImplementationFailureReportPrompt(text)) return false;
  if (isBehaviorPurposePrompt(text, history)) return true;
  if (isUiLocateQuestionPrompt(text) && !IMPLEMENT_INTENT_RE.test(text)) return true;
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
    "优先 grep 精确符号；「会不会/是否/做 X 时会不会 Y/准确吗」须 trace 入口→编排层→副作用或 prompt 构造处，read 目标函数及至少一层直接调用方后再答；禁止只读 composable 即下结论。",
    "准确度/输出质量类：须 read 到 backend 路由或 middleware 中实际 prompt/数据拼装处，说明代码里注入了哪些上下文；禁止用「如果 prompt 包含…」猜测。",
    "勿广搜或同一文件多段重叠 read；信息足够后立即用自然语言回答「当前代码下会怎样」，勿连环读取无关文件。",
    "禁止在未对照工具结果前宣称「逻辑已正确/无需再改/链路完整」；需要改代码时说明结论并请用户发送明确实施指令。",
    "禁止在咨询结论末尾主动推销 patch（如「需要我调整…吗」）；用户未要求改代码时勿反问要不要改。",
    "若写工具返回「Build 只读轮」相关错误：当前仍是 Build 模式，只是本条被标为咨询只读；禁止向用户称 Ask 模式或让用户切换 Build。",
  ].join("\n");
}

export function buildConsultativeResumeHint(behaviorPurpose = false): string {
  const lines = [
    "【咨询续跑·只读】原始消息仅为提问/解释，未要求改代码。",
    "请根据下方已完成的 grep/read 证据直接回答原始问题；禁止 patch_file / write_file / delete_file。",
    "禁止宣称「上一轮的 patch 已生效/无需再改/逻辑已正确」——须基于当前磁盘代码说明结论；若曾误执行写操作，说明现状即可，勿重复 patch。",
    "若原始问题为准确度/是否类且尚未 read backend/middleware 的 prompt 构造：须补齐该层 read 后再答；禁止「基于已有信息直接回答」或反问用户要不要继续查。",
  ];
  if (behaviorPurpose) {
    lines.push(
      "原始问题为用途/作用类：须基于下方已 read 的分支逻辑作答（条件→副作用），禁止重复枚举定义或写「可能需要查看引用」。",
    );
  }
  lines.push("相同文件区域禁止再 read_file；最多 1 次 grep 补齐遗漏。");
  return lines.join("\n");
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
    "外框可见但图标/文字空白：read 全局样式表中同标签选择器（如 button { padding }）是否与 compact 控件 width/height 冲突；须在组件内显式 padding:0 + box-sizing:border-box，勿重复只调 stroke/currentColor。",
    "说明控件含义或修复可见性时须附带 v-if/v-show 等显示前提；用户截图 tab/模式与当前讨论不一致时先核对条件。",
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

/** User rejects assistant-offered config field / enum set — narrow scope. */
const USER_OPTION_MISMATCH_RE =
  /(?:不是|并非)(?:这几|这些)(?:个)?(?:选项|项|值|字段)?|(?:选项|配置项|字段|枚举|取值).{0,10}(?:不对|错了|不正确|不符|不匹配)|不对[，,]?是这几/i;

/** User asks count or list of allowed enum/config values. */
const ENUMERATION_COUNT_QUESTION_RE =
  /(?:有|共|几个|多少).{0,20}(?:选项|取值|枚举|可选值|模式|值)|(?:选项|枚举|可选值|取值).{0,12}(?:有|共).{0,8}几个|\d+\s*个(?:选项|值)/i;

/** Lookup intent must co-occur with config-binding context (avoid bare「联网搜搜」). */
const DOC_LOOKUP_INTENT_RE =
  /(?:联网|查.{0,10}(?:官方|文档)|官方文档|类型定义|typedoc|interface\s*定义)/i;
const CONFIG_BINDING_CONTEXT_RE =
  /配置|选项|option|enum|枚举|属性|字段|参数|映射|mapping|api/i;

export type ConfigBindingTopic = "reject" | "enumeration" | "doc_lookup";

export function isUserOptionMismatchPrompt(prompt: string): boolean {
  return USER_OPTION_MISMATCH_RE.test(prompt.trim());
}

export function isEnumerationCountQuestionPrompt(prompt: string): boolean {
  return ENUMERATION_COUNT_QUESTION_RE.test(prompt.trim());
}

export function isExternalApiLookupPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  return DOC_LOOKUP_INTENT_RE.test(text) && CONFIG_BINDING_CONTEXT_RE.test(text);
}

/** At most one topic per message — reject > enumeration > doc_lookup. */
export function resolveConfigBindingTopic(prompt: string): ConfigBindingTopic | null {
  const text = prompt.trim();
  if (!text) return null;
  if (isUserOptionMismatchPrompt(text)) return "reject";
  if (isEnumerationCountQuestionPrompt(text)) return "enumeration";
  if (isExternalApiLookupPrompt(text)) return "doc_lookup";
  return null;
}

const CONFIG_BINDING_TOPIC_LINES: Record<ConfigBindingTopic, string> = {
  reject:
    "用户否定当前字段/选项集合：禁止扩 scope；对照用户已展示项或类型定义收窄，显式更正前轮映射错误。",
  enumeration:
    "用户问可选值个数或列表：首句写「共 N 个：…」完整列表，再附代码；禁止以 patch 汇报开头漏答。",
  doc_lookup:
    "用户要求查官方定义：须 web_search + web_extract 后再改映射；回答含字段名与类型/枚举对照。",
};

/** Single injected hint — shared mapping guard + topic-specific tail. */
export function buildConfigBindingTopicHint(topic: ConfigBindingTopic): string {
  return [
    "",
    "【外部配置·准确度】绑定外部库或内置组件配置字段时，须 read 类型定义或 web_extract 官方文档；禁止凭字段名相似猜测。",
    CONFIG_BINDING_TOPIC_LINES[topic],
  ].join("\n");
}

/** @deprecated Use buildConfigBindingTopicHint(resolveConfigBindingTopic(...)). */
export function buildUserOptionMismatchHint(): string {
  return buildConfigBindingTopicHint("reject");
}

/** @deprecated Use buildConfigBindingTopicHint(resolveConfigBindingTopic(...)). */
export function buildEnumerationAnswerFirstHint(): string {
  return buildConfigBindingTopicHint("enumeration");
}

/** @deprecated Use buildConfigBindingTopicHint(resolveConfigBindingTopic(...)). */
export function buildExternalApiLookupHint(): string {
  return buildConfigBindingTopicHint("doc_lookup");
}

export function buildSessionAuditHint(): string {
  return [
    "",
    "【会话审计·只读】用户要求评估另一聊天会话中 Agent 的回复质量；勿回答被审计会话内的业务/编程问题。",
    "优先读取用户消息中给出的会话 JSON（逻辑路径或绝对路径，按 AGENTS.md / 用户说明解析）；勿在项目根臆搜数据目录。",
    "大 JSON 用 offset/limit 分段读取，禁止 run_command 分页读文件。",
    "审计工具记录时必须区分证据强度：只根据 tools/roundGroups/statusLog 中明确出现的内容下结论；若工具摘要缺少具体输出，只能写“摘要不足，无法确认”，禁止断言 Agent 未验证或编造。",
    "输出应聚焦准确性、工具调用、上下文理解、表达结构；把确定问题、推测风险、无法判断项分开写，避免把被审计会话中的业务问题展开解答。",
    "禁止 write_file 将审计报告写入仓库；结论直接写入聊天回复。",
  ].join("\n");
}
