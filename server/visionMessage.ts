export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export function sanitizeImageDataUrls(urls?: string[]): string[] {
  if (!urls?.length) return [];
  return urls.filter((url) => typeof url === "string" && url.startsWith("data:image/"));
}

export function buildModelIdentityHint(model: string): string {
  const name = model.trim() || "（未指定）";
  return [
    `当前接入的 API 模型 ID：${name}。`,
    "若用户问「你是什么模型/哪个模型」：如实回答上述模型 ID，不要自称 Claude、GPT、Gemini 等，除非模型 ID 本身含有该名称。",
    "不要编造 Anthropic、OpenAI 等厂商或训练信息。",
  ].join("");
}

const UI_IMAGE_QUESTION_RE =
  /截图|图片|界面|面板|哪块|哪里|看到的|发图|粘贴|screen|screenshot|ui/i;

/** Layout/spacing feedback often paired with screenshots ("你看挤一块了"). */
const UI_LAYOUT_FEEDBACK_RE =
  /挤|贴|挨|重叠|太紧|间距|spacing|overlap|cramped|你看|看一下|一块|不好看|丑/i;

/** Color/button topics that should stay within the visible region the user points at. */
const NARROW_UI_TOPIC_RE = /配色|颜色|按钮|badge|几种|太多|有点多|杂乱|花哨/i;

export const VISION_FIRST_TURN_MIN_DESCRIPTION_CHARS = 24;

/** Visible copy in screenshots (placeholder, label, tab title, button). */
const VISIBLE_ANCHOR_QUOTE_RE =
  /[「『"']([^」』"']{3,})[」』"']|占位符[^，。；\n]{0,16}[「『"']([^」』"']{3,})[」』"']?|(?:标签|按钮|标题|Tab)[:：]?\s*[「『"']([^」』"']{3,})[」』"']?/;

/** Links quoted / visible text to which UI region or module it belongs to. */
const ANCHOR_TO_REGION_RE =
  /(判断|可判断|可推断|据此|由此|说明|对应|属于|定位为|应是|应该是|像是|表明|可定位)[^。\n]{0,48}(助手|Vibe|聊天|输入框|Composer|面板|模块|区域|Build|Ask|底栏|侧栏|编辑器|对话|占位)/i;

/** Names the screenshot region without necessarily quoting anchor text. */
const UI_REGION_STATEMENT_RE =
  /(截图|图中|图里|从图|可见|画面)[^。\n]{0,72}(区域|模块|面板|输入|按钮|编辑器|侧栏|底|顶|助手|聊天|Composer)/i;

const UI_MODULE_STATEMENT_RE =
  /这是[^。\n]{0,48}(助手|Vibe|聊天|输入|面板|模块|区域|Composer|编辑器|底栏|侧栏)/i;

export function buildVisionFirstTurnRule(): string {
  return [
    "【附图·首轮必读图】你必须先仔细查看附带图片，用中文描述所见：",
    "- 先说明截图对应应用中的哪一块（模块/面板/区域）；画面若只裁到局部，也要根据占位符、按钮、标签等可见文案推断归属；",
    "- 须引用图中可辨识的占位符或标签原文（用「」括起），并写明「据此可判断这是 …」；",
    "- 再补充控件类型、布局关系；若用户反馈拥挤/重叠/不好看，须点名哪两个（或哪组）元素及其关系。",
    "本轮禁止调用任何工具；仅输出读图描述，下一轮可用 grep 图中摘录的文案定位源码。",
    "布局问题后续修改时优先检查 flex-shrink、min-width、overflow、gap、margin，勿先加装饰性分隔线。",
  ].join("\n");
}

export function buildVisionFirstTurnContinueHint(): string {
  return [
    "【读图完成】已记录你对附图的理解。",
    "下一轮请结合上述描述与用户需求调用工具；",
    "若读图时摘录了占位符/按钮/标签等可见文案，优先 grep 该字符串定位组件，再 read_file 核对；",
    "回答用户时先一句点明「截图对应哪块界面」，再讲操作或改代码。",
  ].join("");
}

/** After vision-first turn for ask / consultative prompts (no code changes requested). */
export function buildVisionConsultativeContinueHint(): string {
  return [
    "【读图完成·咨询】用户仅为提问/说明，未要求改代码。",
    "优先 grep 读图时摘录的占位符或标签（1 次）定位组件，必要时 read_file 1 个相关文件核对；",
    "然后给出最终中文回答：先一句点明截图对应哪块界面，再答用户问题。",
    "禁止连环 read_file/grep 多个无关文件；核对后立即输出最终答案。",
  ].join("");
}

export function buildVisionFirstTurnRetryHint(): string {
  return [
    "【附图首轮】读图描述不合格：过短，或只描述了外观却没有说明截图对应哪块界面。",
    "请重新查看附图：引用占位符/标签原文，并写明据此判断属于哪个模块或区域（如 Vibe 助手底栏输入框）；",
    "若画面只裁到局部，也要根据可见文案推断，不要只复述颜色与边框。本轮仍不要调用工具。",
  ].join("");
}

function hasVisibleAnchorQuote(text: string): boolean {
  return VISIBLE_ANCHOR_QUOTE_RE.test(text);
}

function describesScreenshotUiRegion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (hasVisibleAnchorQuote(trimmed)) {
    return ANCHOR_TO_REGION_RE.test(trimmed);
  }
  return UI_REGION_STATEMENT_RE.test(trimmed) || UI_MODULE_STATEMENT_RE.test(trimmed);
}

export function isAdequateVisionFirstTurnDescription(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < VISION_FIRST_TURN_MIN_DESCRIPTION_CHARS) return false;
  return describesScreenshotUiRegion(trimmed);
}

export function shouldRequireVisionFirstTurn(imageCount: number, visionFallbackApplied: boolean): boolean {
  return imageCount > 0 && !visionFallbackApplied;
}

/** User is confirming a feeling or asking a short question — not asking to implement yet. */
const UI_OPINION_FOLLOWUP_RE =
  /有点多|太多了|是不是|对吗|是否|过多|杂乱|花哨|吗[？?]?\s*$|是不是.*多/i;

/** User wants code changes; allow scoped grep/patch within the prior screenshot region. */
const UI_IMPLEMENTATION_INTENT_RE =
  /帮我|改一下|修改|实现|统一|调整|动手|写入|应用|做成|换成|去掉|减少|精简一下|收敛到|只留|合并|优化一下/i;

/** User explicitly widens scope beyond the prior screenshot region. */
const UI_EXPLICIT_EXPAND_RE = /整个|整页|全面板|全面板|整块|全局|所有/i;

const UI_SCOPE_DISCUSS =
  "讨论时：范围限定为用户所指的可视区域（通常即截图可见部分），勿擅自扩大到未展示区域或整页/全项目样式盘点；用户明确要求扩大时再扩大。读图时若见占位符/标签/按钮文字，须据此说明截图是哪块界面。";

const UI_SCOPE_IMPLEMENT =
  "实施时：仍以上一轮截图所指的同一可视区域为默认改动范围；优先 grep 读图时摘录的占位符或标签文案定位组件，再 read/patch；勿擅自改动用户未提及的区域。";

const UI_SCOPE_IMPLEMENT_EXPANDED =
  "实施时：用户已明确要求扩大改动范围，按其所述区域实施，勿超出其描述。";

function isScreenshotScopedUiThread(lastAssistantContent: string): boolean {
  const priorMentionsScreenshot = /截图|如图所示|从截图|截图中|截图里|从图|图里|图中/.test(
    lastAssistantContent,
  );
  const priorUiTopic =
    NARROW_UI_TOPIC_RE.test(lastAssistantContent) || UI_IMAGE_QUESTION_RE.test(lastAssistantContent);
  return priorMentionsScreenshot && priorUiTopic;
}

export function buildVisionTaskText(text: string, imageCount: number): string {
  if (imageCount <= 0) return text;
  const body = text.trim() || "请描述并分析附带的图片。";
  const firstTurnRule = buildVisionFirstTurnRule();
  const isUiQuestion =
    UI_IMAGE_QUESTION_RE.test(body) ||
    NARROW_UI_TOPIC_RE.test(body) ||
    UI_LAYOUT_FEEDBACK_RE.test(body);
  if (!isUiQuestion) {
    return `${firstTurnRule}\n\n${body}`;
  }

  const implementing = UI_IMPLEMENTATION_INTENT_RE.test(body);
  const expanded = UI_EXPLICIT_EXPAND_RE.test(body);
  const scopeRule = implementing
    ? expanded
      ? UI_SCOPE_IMPLEMENT_EXPANDED
      : UI_SCOPE_IMPLEMENT
    : UI_SCOPE_DISCUSS;
  const toolHint = implementing
    ? "读图描述须先根据占位符/标签说明截图是哪块界面，下一轮再 grep 该文案并在对应源码内修改。"
    : "读图须说明截图对应哪块界面（可据占位符/标签推断），并覆盖用户所指可见范围；不要跳过读图先去全盘 grep/search。";
  const prefix = `【附图为本消息重点】${scopeRule} ${toolHint} 若界面像 Git/设置/聊天等，优先在 src/views 中查找，勿默认是外部应用。`;
  return `${firstTurnRule}\n\n${prefix}\n\n${body}`;
}

/**
 * When the user continues a screenshot-scoped UI topic without a new image,
 * inject phase-specific scope hints (discuss vs implement).
 */
export function buildUiScopeFollowUpHint(prompt: string, lastAssistantContent?: string): string {
  const body = prompt.trim();
  if (!body || !lastAssistantContent?.trim()) return prompt;
  if (!isScreenshotScopedUiThread(lastAssistantContent)) return prompt;

  const implementing = UI_IMPLEMENTATION_INTENT_RE.test(body);
  const expanded = UI_EXPLICIT_EXPAND_RE.test(body);
  const opinionFollowUp =
    UI_OPINION_FOLLOWUP_RE.test(body) || (NARROW_UI_TOPIC_RE.test(body) && !implementing);

  if (!implementing && !opinionFollowUp) return prompt;

  if (implementing) {
    const scopeRule = expanded ? UI_SCOPE_IMPLEMENT_EXPANDED : UI_SCOPE_IMPLEMENT;
    return ["【延续上一轮截图范围·实施】", scopeRule, "", body].join("\n");
  }

  return [
    "【延续上一轮截图范围·讨论】",
    UI_SCOPE_DISCUSS,
    "用户似乎在确认感受或继续讨论，勿全盘盘点整页配色或 grep 全项目样式；若要改代码应等用户明确说出。",
    "",
    body,
  ].join("\n");
}

export function buildVisionUserContent(text: string, imageDataUrls?: string[]): string | ChatContentPart[] {
  const urls = sanitizeImageDataUrls(imageDataUrls);
  if (!urls.length) return text;

  const parts: ChatContentPart[] = [];
  parts.push({ type: "text", text: buildVisionTaskText(text, urls.length) });
  for (const url of urls) {
    parts.push({ type: "image_url", image_url: { url } });
  }
  return parts;
}

export function contentDisplayText(content: string | ChatContentPart[] | null | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;

  const textParts = content.filter((part) => part.type === "text").map((part) => part.text);
  const imageCount = content.filter((part) => part.type === "image_url").length;
  const text = textParts.join("\n");
  if (imageCount > 0) {
    return text ? `${text}\n[附带 ${imageCount} 张图片]` : `[附带 ${imageCount} 张图片]`;
  }
  return text;
}

export function contentCharSize(content: string | ChatContentPart[] | null | undefined): number {
  if (!content) return 0;
  if (typeof content === "string") return content.length;
  return content.reduce((sum, part) => {
    if (part.type === "text") return sum + part.text.length;
    if (part.type === "image_url") return sum + part.image_url.url.length;
    return sum;
  }, 0);
}

export function isVisionUnsupportedError(error?: string): boolean {
  if (!error) return false;
  const haystack = error.toLowerCase();
  return /vision|image|multimodal|unsupported.*content|does not support.*image|invalid.*image_url/.test(haystack);
}
