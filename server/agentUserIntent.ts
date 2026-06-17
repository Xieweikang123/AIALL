/** Explicit change / implementation intent — Build may write. */
export const IMPLEMENT_INTENT_RE =
  /(?:帮我|请|麻烦)?(?:改|修|修复|实现|添加|新增|删除|创建|优化|调整|更新|写入|落地|开发|执行|替换|重构|改成|改为|改一下|改下|写一[个份]?|做一[个份]?|fix|implement|add\b|create\b|update\b|refactor\b)/i;

/** Short confirm-to-implement after prior analysis (e.g. 「修复吧」). */
const SHORT_IMPLEMENT_PROMPT_RE =
  /^(?:请?)?(?:修复|改|修|实现|动手|执行|应用|写入|落地|按(?:此|上面)?(?:方案|分析)?)(?:吧|了|下)?[。！!]?$/i;

/** Accuracy / behavior Q&A without asking to change code yet. */
const ACCURACY_CONSULTATIVE_RE =
  /是否.{0,20}(?:准确|正确|总是|一直|可靠)|(?:准确|正确|可靠).{0,12}(?:吗|么)[？?]?$/i;

/** Question / explanation intent without asking to change code. */
const CONSULTATIVE_MARKERS_RE =
  /(?:什么|为什么|为啥|如何|怎么|怎样|哪里|哪儿|是否|是不是|能不能|可不可以|能否|干嘛|干啥|啥是|是什么|有没有|对不对|什么意思|啥意思|吗[？?]?$|[？?]$)/;

/** Resume / plan execution prompts must keep write access. */
const AUTOMATION_PROMPT_RE = /^\s*(?:【|\[)(?:方案执行|精准修改|效率|系统自动续跑|读图完成)/;

/** Short evaluative follow-up — consultative even when it contains verbs like 「优化」. */
const SHORT_EVALUATIVE_FOLLOW_UP_RE =
  /^(?:需要|要不要|是否|还得|还要|值得|可以|那)?[^。！!]{0,24}(?:吗|呢)[？?]?\s*$/;

/** Screenshot-backed UI defect — user shows broken layout/position; Build should fix, not read-only Q&A. */
const UI_DEFECT_REPORT_RE =
  /看到没|你看|你瞧|分明|明显|错位|跑(?:到|去|别的)|飘|歪|不对|坏了|出问题了|有问题|挤一块|重叠|太紧/i;

const UI_DEFECT_SUBJECT_RE =
  /按钮|控件|布局|位置|样式|界面|面板|输入框|弹窗|浮动|引用|图标/i;

/** User asks what an agent investigation step or API attribute means — explain first, not read-only Build. */
const STEP_CLARIFICATION_RE = /啥意思|什么意思|啥是|是什么|干吗|干嘛|怎么理解|confirm\s*啥|确认.*(?:啥|什么)/i;

const STEP_OR_API_REFERENCE_RE =
  /(?:读取|read|grep|opening|Teleport|target|anchor|定位|浮层|fixed|patch|工具|这一步|这步|opening tag)/i;

export function isAgentStepClarificationPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  return STEP_CLARIFICATION_RE.test(text) && STEP_OR_API_REFERENCE_RE.test(text);
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

/** Prior turns already analyzed quote-button positioning — user now wants code applied. */
export function historySuggestsQuotePositionFix(history?: UserIntentHistoryMessage[]): boolean {
  const text = (history ?? [])
    .slice(-6)
    .filter((m) => m.role === "assistant" || m.role === "user")
    .map((m) => m.content)
    .join("\n");
  if (!text.trim()) return false;
  return /引用按钮|quote-floating|showQuoteButtonAt|getSelectionAnchorRect|clampQuoteButton|修复方案|修改方案|根因|patch/i.test(
    text,
  );
}

export function isImplementFollowUpRun(
  prompt: string,
  history?: UserIntentHistoryMessage[],
  opts?: { isAsk?: boolean; readOnlyBuild?: boolean },
): boolean {
  if (opts?.isAsk || opts?.readOnlyBuild) return false;
  const text = prompt.trim();
  if (!text) return false;
  if (isConsultativeUserPrompt(text)) return false;
  if (isShortImplementPrompt(text) && historySuggestsQuotePositionFix(history)) return true;
  if (IMPLEMENT_INTENT_RE.test(text) && historySuggestsQuotePositionFix(history)) return true;
  return false;
}

export function isConsultativeUserPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  if (AUTOMATION_PROMPT_RE.test(text)) return false;
  if (isUiDefectReportPrompt(text)) return false;
  if (isAgentStepClarificationPrompt(text)) return false;
  if (SHORT_EVALUATIVE_FOLLOW_UP_RE.test(text)) return true;
  if (IMPLEMENT_INTENT_RE.test(text)) return false;
  if (ACCURACY_CONSULTATIVE_RE.test(text)) return true;
  return CONSULTATIVE_MARKERS_RE.test(text);
}

export function buildConsultativeBuildHint(): string {
  return [
    "",
    "【咨询任务·只读】用户本条仅为提问/解释，未要求改代码。",
    "只允许 list_dir / read_file / grep / search_files；禁止 patch_file / write_file / delete_file。",
    "优先 1 次 grep 定位，必要时 read_file 1 个相关文件后即回答；勿连环读取多个无关文件。",
    "用自然语言直接回答；若调查后发现代码须改才能符合描述，说明结论并提示用户描述期望行为，勿擅自 patch。",
  ].join("\n");
}

export function buildImplementFollowUpHint(): string {
  return [
    "",
    "【确认执行·须改代码】用户在上文分析后要求修复/改吧，不是再要一篇分析。",
    "最多 1 次 read_file 核对目标函数后即 patch_file/write_file；禁止 grep transform/Teleport（上文已讨论过）。",
    "禁止输出「请将以下修改应用到…」或只贴代码块让用户手动改；你必须亲自提交 patch。",
    "优先改 src/views/VibeCodingView.vue 中 getSelectionAnchorRect / showQuoteButtonAt / onMessageSelect 相关逻辑。",
  ].join("\n");
}

export function buildUiDefectBuildHint(): string {
  return [
    "",
    "【UI 缺陷·须修复】用户用截图反馈控件/布局异常。",
    "须定位后 patch_file/write_file；禁止只分析并反问「要不要修」。",
    "控件与选区/焦点在空间上分离时优先查 Teleport/fixed 浮层（grep *-floating、show*At），勿查底栏 flex。",
    "排查 mouseup 与 getSelection 时序：选区在 mouseup 时可能尚未就绪，关注 getSelection* / queueMicrotask 链路。",
  ].join("\n");
}

export function buildAgentStepClarificationHint(): string {
  return [
    "",
    "【用户追问排查步骤】用户在问「你这步是在确认什么」或某属性/API 含义。",
    "本轮禁止调用工具；先用 2–4 句中文面向用户解释（勿写 planning 句如「让我读取…」）。",
    "Teleport 的 to：传送目标容器；to=\"body\" 表示节点挂到 document.body，position:fixed 相对视口，非底栏 flex 内嵌。",
    "解释后若任务仍是修 UI 缺陷：下一轮转向 show*At / getSelection* 坐标计算并 patch，勿再 grep transform 或 chat-bottom layout。",
  ].join("\n");
}

export function buildAgentStepClarifyContinueHint(): string {
  return [
    "【解释已完成】若上文已回答用户「啥意思」，且仍在修浮层错位：",
    "下一轮禁止重复解释或再读 Teleport；直接 patch show*At / getSelection* 相关逻辑，或 1 次 read 后立即 patch。",
  ].join("");
}
