/**
 * Tier 1 — generic user-intent classifiers.
 * Shape / syntax / history structure only. No build*Hint strings (see product/userIntentHints).
 */
import { stripQuotedReplyPrefix } from "../../services/agentContinuation";
import { extractAmendBody } from "./quotedAmendIntent";
import {
  assistantProvidedCodeLocationEvidence,
  PRIOR_DEFINITION_LISTING_RE,
  SESSION_AUDIT_TASK_RE,
} from "../../services/agentStructuralPatterns";

/** Explicit change / implementation intent — Build may write. */
export const IMPLEMENT_INTENT_RE =
  /(?:帮我|请|麻烦)?(?:改|修|修复|实现|添加|新增|删除|创建|优化|调整|更新|写入|落地|开发|执行|替换|重构|改成|改为|改一下|改下|写一[个份]?|做一[个份]?|fix|implement|add\b|create\b|update\b|refactor\b)/i;

const SHORT_IMPLEMENT_PROMPT_RE =
  /^(?:请?)?(?:修复|改一下|改(?:吧|了|下)?|修|实现|动手|执行|应用|写入|落地|按(?:此|上面)?(?:方案|分析)?)(?:吧|了|下)?[。！!]?$/i;

export const ACCURACY_CONSULTATIVE_RE =
  /是否.{0,20}(?:准确|正确|总是|一直|可靠)|(?:准确|正确|可靠).{0,12}(?:吗|么)[？?]?$/i;

export function isAccuracyConsultativePrompt(prompt: string): boolean {
  return ACCURACY_CONSULTATIVE_RE.test(prompt.trim());
}

const OBSERVED_BEHAVIOR_QUESTION_RE =
  /(?:也会|还会|是不是会|会不会|有没有).{0,20}(?:通知|弹窗|提示|提醒)|(?:通知|弹窗|提示).{0,12}(?:吗|么|吧)[？?]?$/i;

const CONSULTATIVE_MARKERS_RE =
  /(?:什么|为什么|为啥|如何|怎么|怎样|哪里|哪儿|是否|是不是|能不能|可不可以|能否|干嘛|干啥|啥是|是什么|有没有|对不对|什么意思|啥意思|啥作用|什么作用|有啥用|有什么用|干嘛用|吗[？?]?$|[？?]$)/;

const BEHAVIOR_PURPOSE_PROMPT_RE =
  /(?:啥作用|什么作用|有啥用|有什么用|干嘛用|做啥用|何时用|什么时候用|什么情况下|啥情况下|用来干|用来做什么|什么用途|有何作用)/;

const PRIOR_ENUM_LISTING_RE = PRIOR_DEFINITION_LISTING_RE;

/** System automation / resume markers — must not be classified as user consultative. */
export const AUTOMATION_PROMPT_RE =
  /^\s*(?:【|\[)(?:方案执行|精准修改|效率|系统自动续跑|读图完成)/;

export function isAutomationResumePrompt(prompt: string): boolean {
  return AUTOMATION_PROMPT_RE.test(prompt.trim());
}

/** Short follow-ups that depend on prior assistant context (e.g. 「需要吗」「还要吧」). */
export function isShortContextDependentFollowUp(prompt: string): boolean {
  const text = prompt.trim();
  if (!text || text.length > 24) return false;
  return /^(?:需要|要不要|是否|还得|还要|值得|可以|那)?[^。！!]{0,20}(?:吗|呢|吧|了)[？?]?\s*$/.test(text);
}

const IMPLEMENTATION_FAILURE_REPORT_RE =
  /没生效|不生效|未生效|没效果|没有效果|没变化|不起作用|试了.{0,16}(?:没有|没|不|无效)|仍然(?:没有|没|不)|还是(?:没有|没|不)|明明(?:没有|没|不)/i;

const BEHAVIOR_CONTRADICTION_MARKER_RE =
  /但是|可是|然而|不对|不知道为啥|奇怪|咋会|怎么会|实际上|明明/i;

const PRIOR_ANSWER_CHALLENGE_RE =
  /^(?:你)?觉得.{0,12}(?:有问题|不对|靠谱|准确)|(?:这样|那(?:样)?).{0,8}(?:对吗|行不行|有问题)|(?:有问题吗|对不对|对吗|靠谱吗)[？?]?\s*$/;

const PRIOR_ASSISTANT_BEHAVIOR_CLAIM_RE =
  /(?:不会|会.{0,16}(?:打开|关闭|恢复|保留|改变|更新|折叠|展开)|独立|互不干扰|无需.{0,8}再)/;

const PRIOR_NEGATIVE_BEHAVIOR_CLAIM_RE =
  /(?:^|\n)\s*(?:\*\*)?(?:不会|不(?:会|能)?更新|没有.{0,12}更新|不改变|不涉及|只是.{0,16}(?:改|设置|指向))(?:\*\*)?/im;

export const UI_STATE_PERSISTENCE_QUESTION_RE =
  /(?:切|换|切换).{0,20}(?:再|回|之后|然后).{0,20}(?:切|换|回)|(?:还会|会不会|是不是会|是否会|会不会再).{0,24}(?:再次|重新|仍然|保留|恢复|打开|关闭|展开|折叠|显示|隐藏|保持)|再次.{0,12}(?:打开|展开|显示|出现|恢复)/;

export function isUiStatePersistenceQuestionPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  if (IMPLEMENT_INTENT_RE.test(text) && !/[？?]/.test(text)) return false;
  return UI_STATE_PERSISTENCE_QUESTION_RE.test(text);
}

export function historyPriorAssistantBehaviorClaim(
  history?: UserIntentHistoryMessage[],
): boolean {
  const lastAssistant = (history ?? [])
    .filter((m) => m.role === "assistant")
    .slice(-1)[0]?.content;
  if (!lastAssistant?.trim()) return false;
  if (PRIOR_NEGATIVE_BEHAVIOR_CLAIM_RE.test(lastAssistant)) return true;
  return (
    PRIOR_ASSISTANT_BEHAVIOR_CLAIM_RE.test(lastAssistant) &&
    assistantProvidedCodeLocationEvidence(lastAssistant)
  );
}

export function isPriorAnswerChallengePrompt(
  prompt: string,
  history?: UserIntentHistoryMessage[],
): boolean {
  const text = prompt.trim();
  if (!text || text.length > 48) return false;
  if (IMPLEMENT_INTENT_RE.test(text)) return false;
  if (isImplementationFailureReportPrompt(text)) return false;
  if (!PRIOR_ANSWER_CHALLENGE_RE.test(text)) return false;
  return historyPriorAssistantBehaviorClaim(history);
}

const IMPLEMENTATION_STATUS_PROMPT_RE =
  /(?:改好|做完|写好|弄好|搞定|完成|实现好|落地)[了吗呢]?[？?]?\s*$|(?:好了吗|完成了吗|做完了吗|改完了吗)[？?]?\s*$/i;

const CONTINUE_IMPLEMENT_PROMPT_RE =
  /^(?:请?)?(?:继续|接着)(?:改|做|实现|修|完善|完成)/i;

const UI_DEFECT_REPORT_RE =
  /看到没|你看|你瞧|分明|明显|错位|跑(?:到|去|别的)|飘|歪|不对|坏了|出问题了|有问题|挤一块|重叠|太紧/i;

const UI_DEFECT_SUBJECT_RE =
  /按钮|控件|布局|位置|样式|界面|面板|输入框|弹窗|浮动|图标/i;

const UI_AESTHETIC_FEEDBACK_RE =
  /(?:不|真|太|好|看着|也)?(?:好看|美观|顺眼|丑|乱|糙|简陋|挤|土)/;

const BULK_EXECUTE_PROMPT_RE =
  /^(?:请?)?(?:全部|都|通通)(?:执行|落地|改|做|应用)|^按(?:上面|此|方案|推荐)(?:全部)?(?:执行|改|做)/i;

const NUMBERED_OPTION_BODY_RE = /^[1-9]\d?(?:[.、)]\s*)?$/;

const STEP_CLARIFICATION_RE = /啥意思|什么意思|啥是|是什么|干吗|干嘛|怎么理解|confirm\s*啥|确认.*(?:啥|什么)/i;

const CODE_REVIEW_PROMPT_RE =
  /^(?:请?)?(?:检查|核对|复查|自检|验证|确认)(?:一下|下)?(?:代码|改动|修改|实现|吧|了)?[。！!]?$/i;

const ERROR_QUOTE_SHAPE_RE =
  /^(?:错误|警告|提示|通知|失败|已被拒绝|不可用|权限|拒绝|未授权)/;

const STEP_OR_API_REFERENCE_RE =
  /(?:读取|read|grep|opening|portal|overlay|target|anchor|定位|浮层|fixed|patch|工具|这一步|这步|opening tag)/i;

export function isAgentStepClarificationPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  return STEP_CLARIFICATION_RE.test(text) && STEP_OR_API_REFERENCE_RE.test(text);
}

export function isCodeReviewPrompt(prompt: string): boolean {
  return CODE_REVIEW_PROMPT_RE.test(prompt.trim());
}

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

export function isScreenshotVisibilityPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  return /能看到|看见|看清|看到.*问题|截图.*问题|问题.*截图/i.test(text);
}

export function isUiAestheticFeedbackPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text || text.length > 24) return false;
  return UI_AESTHETIC_FEEDBACK_RE.test(text);
}

export function historyOffersNumberedImplementOptions(
  history?: UserIntentHistoryMessage[],
): boolean {
  const last = (history ?? [])
    .filter((m) => m.role === "assistant")
    .slice(-1)[0]?.content;
  if (!last?.trim()) return false;
  if (/需要我(?:实际)?执行|请确认优先级|我可以逐个|逐个 patch/i.test(last)) return true;
  if (/^\s*\|\s*[#№]?/m.test(last) && /优先级|修改项|优化项/i.test(last)) return true;
  if (/^\s*[1-9][.、)]/m.test(last) && /建议|方案|改造/i.test(last)) return true;
  return false;
}

export function isNumberedImplementSelection(
  prompt: string,
  history?: UserIntentHistoryMessage[],
): boolean {
  const body = extractAmendBody(prompt.trim()) || prompt.trim();
  if (!NUMBERED_OPTION_BODY_RE.test(body)) return false;
  return historyOffersNumberedImplementOptions(history) || historySuggestsActiveImplementation(history);
}

export function isBulkExecutePrompt(prompt: string): boolean {
  return BULK_EXECUTE_PROMPT_RE.test(prompt.trim());
}

export function isUiDefectReportPrompt(prompt: string, hasImage = false): boolean {
  const text = prompt.trim();
  if (!text) return false;
  if (hasImage && isScreenshotVisibilityPrompt(text)) return true;
  if (hasImage && isUiAestheticFeedbackPrompt(text)) return true;
  return UI_DEFECT_REPORT_RE.test(text) && UI_DEFECT_SUBJECT_RE.test(text);
}

export function isShortImplementPrompt(prompt: string): boolean {
  return SHORT_IMPLEMENT_PROMPT_RE.test(prompt.trim());
}

const ULTRA_SHORT_OPEN_TASK_MAX_LEN = 20;
const ULTRA_SHORT_OPEN_TASK_BRIEF_LEN = 8;
const FILE_PATH_IN_PROMPT_RE = /(?:@[\w./-]+|(?:[\w@.-]+\/)+[\w.-]+\.\w{2,4})/;
const OPEN_ENDED_TAIL_RE =
  /^(?:请?)?[\u4e00-\u9fa5a-zA-Z]{1,14}(?:一下|下|吧|了|看看)[。！!]?$/i;
const ULTRA_SHORT_SCOPE_OBJECT_RE =
  /(?:代码|组件|页面|模块|面板|按钮|路由|样式|编辑器|会话|功能|接口|字段|类型|文件|列表|滚动|输入|通知|API|UI)/i;

export function isUltraShortOpenTaskPrompt(prompt: string): boolean {
  const text = stripQuotedReplyPrefix(prompt.trim());
  if (!text || text.length > ULTRA_SHORT_OPEN_TASK_MAX_LEN) return false;
  if (/[？?]$/.test(text)) return false;
  if (AUTOMATION_PROMPT_RE.test(text)) return false;
  if (isCodeReviewPrompt(text)) return false;
  if (isShortImplementPrompt(text)) return false;
  if (FILE_PATH_IN_PROMPT_RE.test(text)) return false;
  if (ULTRA_SHORT_SCOPE_OBJECT_RE.test(text)) return false;
  if (IMPLEMENT_INTENT_RE.test(text) && text.length > ULTRA_SHORT_OPEN_TASK_BRIEF_LEN) return false;
  if (CONSULTATIVE_MARKERS_RE.test(text) && /什么|为什么|如何|怎么|哪里|哪儿|是否|是不是/.test(text)) {
    return false;
  }
  if (text.length <= ULTRA_SHORT_OPEN_TASK_BRIEF_LEN) return true;
  return OPEN_ENDED_TAIL_RE.test(text);
}

export type UserIntentHistoryMessage = {
  role: string;
  content: string;
  writtenFiles?: string[];
  planFilePath?: string;
};

export function isImplementationStatusPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  return IMPLEMENTATION_STATUS_PROMPT_RE.test(text);
}

export function historySuggestsQuotePositionFix(history?: UserIntentHistoryMessage[]): boolean {
  const text = (history ?? [])
    .slice(-6)
    .filter((m) => m.role === "assistant" || m.role === "user")
    .map((m) => m.content)
    .join("\n");
  if (!text.trim()) return false;
  const hasPositionAnalysis = /定位|坐标|位置|浮层|fixed|absolute|portal|锚点|偏移/i.test(text);
  const hasAnalysisConclusion = /根因|原因|问题在于|分析|诊断|排查/i.test(text);
  const hasFixProposal = /修复方案|修改方案|建议|patch|改法/i.test(text);
  return hasPositionAnalysis && (hasAnalysisConclusion || hasFixProposal);
}

export function historySuggestsActiveImplementation(history?: UserIntentHistoryMessage[]): boolean {
  const text = (history ?? [])
    .slice(-8)
    .filter((m) => m.role === "assistant" || m.role === "user")
    .map((m) => m.content)
    .join("\n");
  if (!text.trim()) return false;
  if (historySuggestsQuotePositionFix(history)) return true;
  return /(?:改吧|实现吧|执行吧|继续改|动手吧|patch_file|write_file|已修改|修改方案|实施计划|下一步需要|部分改好|未完成|须改代码|让我完成|剩余(?:的)?实现|需要我(?:实际)?执行|请确认优先级)/i.test(
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
  if (isEvaluativeOpinionPrompt(text)) return false;
  if (!historySuggestsActiveImplementation(history)) return false;
  if (isBulkExecutePrompt(text)) return true;
  if (isNumberedImplementSelection(text, history)) return true;
  if (isShortImplementPrompt(text)) return true;
  if (CONTINUE_IMPLEMENT_PROMPT_RE.test(text)) return true;
  if (isImplementationFailureReportPrompt(text)) return true;
  if (IMPLEMENT_INTENT_RE.test(text) && !isImplementationStatusPrompt(text)) return true;
  return false;
}

export function isImplementationFailureReportPrompt(prompt: string): boolean {
  return IMPLEMENTATION_FAILURE_REPORT_RE.test(prompt.trim());
}

const PRIOR_FIX_CLAIM_RE =
  /(?:✅|修复完成|修改已完成|已完成修复|问题已修复|已修复|已改完|应该(?:可以|没问题|能看到)了|(?:现在|已).{0,8}(?:可见|清晰|能看))|刷新(?:应用|页面)?(?:后|看看)/i;

export const UI_LOCATE_QUESTION_RE =
  /(?:哪(?:儿|里|块|个)|什么|啥)(?:的)?(?:按钮|控件|面板|区域|组件|元素|部分|内容)|(?:知道|看得出|认得|识别).{0,12}(?:哪儿|哪里|哪块|哪个)|显示的(?:什么|啥)|(?:这里|这边|旁边|此处).{0,12}(?:啥|什么)|(?:这是|那是)(?:什么|啥)/;

export function isUiLocateQuestionPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  return UI_LOCATE_QUESTION_RE.test(text);
}

export const UI_APPEARANCE_QUESTION_RE =
  /背景.{0,12}(?:透明|半透明|模糊|毛玻璃|虚化)|(?:透明|半透明|毛玻璃|blur|backdrop).{0,12}(?:吗|么|[？?]\s*$)|(?:opacity|rgba).{0,12}(?:吗|么|[？?]\s*$)|(?:遮挡|被挡|遮住|重叠|错位|挤压|拥挤|挤在一|对不齐|凌乱|杂乱|难看|丑|不好看|太挤|太宽|太窄|太紧|太松|太小|太大|偏小|偏大|不协调|别扭|怪怪|花哨|裁切|截断).{0,10}(?:吗|么|了|着|[？?])?|(?:显示|布局|界面|样式|按钮|排版).{0,8}(?:有问题|出问题|问题|有毛病|不对|异常|错乱)/i;

export function isUiAppearanceQuestionPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  return UI_APPEARANCE_QUESTION_RE.test(text);
}

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

export function isBehaviorContradictionPrompt(
  prompt: string,
  history?: UserIntentHistoryMessage[],
): boolean {
  const text = prompt.trim();
  if (!text) return false;
  if (isPriorAnswerChallengePrompt(text, history)) return true;
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

const EVALUATIVE_OPINION_PROMPT_RE =
  /(?:你觉得|你认为|您觉得|你感觉|评价一下|有何评价|什么看法|怎么样|如何)[？?]?\s*$|(?:你觉得|你认为|您觉得).{0,24}(?:如何|怎样|怎么样|靠谱|可行)[？?]?\s*$/;

/** Opinion / evaluation questions — not implement follow-ups even when topic text contains 修复/优化. */
export function isEvaluativeOpinionPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text || !/[？?]\s*$/.test(text)) return false;
  return EVALUATIVE_OPINION_PROMPT_RE.test(text);
}

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
  if (isUiStatePersistenceQuestionPrompt(text)) return true;
  if (isUiLocateQuestionPrompt(text) && !IMPLEMENT_INTENT_RE.test(text)) return true;
  if (isShortContextDependentFollowUp(text)) return true;
  if (ACCURACY_CONSULTATIVE_RE.test(text)) return true;
  if (OBSERVED_BEHAVIOR_QUESTION_RE.test(text)) return true;
  if (isEvaluativeOpinionPrompt(text)) return true;
  if (isQuestionShapedConsultative(text)) return true;
  if (IMPLEMENT_INTENT_RE.test(text)) return false;
  return CONSULTATIVE_MARKERS_RE.test(text);
}

export function isSessionAuditPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  return SESSION_AUDIT_TASK_RE.test(text);
}

const USER_OPTION_MISMATCH_RE =
  /(?:不是|并非)(?:这几|这些)(?:个)?(?:选项|项|值|字段)?|(?:选项|配置项|字段|枚举|取值).{0,10}(?:不对|错了|不正确|不符|不匹配)|不对[，,]?是这几/i;

const ENUMERATION_COUNT_QUESTION_RE =
  /(?:有|共|几个|多少).{0,20}(?:选项|取值|枚举|可选值|模式|值)|(?:选项|枚举|可选值|取值).{0,12}(?:有|共).{0,8}几个|\d+\s*个(?:选项|值)/i;

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

export function resolveConfigBindingTopic(prompt: string): ConfigBindingTopic | null {
  const text = prompt.trim();
  if (!text) return null;
  if (isUserOptionMismatchPrompt(text)) return "reject";
  if (isEnumerationCountQuestionPrompt(text)) return "enumeration";
  if (isExternalApiLookupPrompt(text)) return "doc_lookup";
  return null;
}
