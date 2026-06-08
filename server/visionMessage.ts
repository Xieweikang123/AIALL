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

/** Color/button topics that should stay within the visible region the user points at. */
const NARROW_UI_TOPIC_RE = /配色|颜色|按钮|badge|几种|太多|有点多|杂乱|花哨/i;

/** User is confirming a feeling or asking a short question — not asking to implement yet. */
const UI_OPINION_FOLLOWUP_RE =
  /有点多|太多了|是不是|对吗|是否|过多|杂乱|花哨|吗[？?]?\s*$|是不是.*多/i;

/** User wants code changes; allow scoped grep/patch within the prior screenshot region. */
const UI_IMPLEMENTATION_INTENT_RE =
  /帮我|改一下|修改|实现|统一|调整|动手|写入|应用|做成|换成|去掉|减少|精简一下|收敛到|只留|合并|优化一下/i;

/** User explicitly widens scope beyond the prior screenshot region. */
const UI_EXPLICIT_EXPAND_RE = /整个|整页|全面板|全面板|整块|全局|所有/i;

const UI_SCOPE_DISCUSS =
  "讨论时：范围限定为用户所指的可视区域（通常即截图可见部分），勿擅自扩大到未展示区域或整页/全项目样式盘点；用户明确要求扩大时再扩大。";

const UI_SCOPE_IMPLEMENT =
  "实施时：仍以上一轮截图所指的同一可视区域为默认改动范围，可 grep/read 该区域对应组件与样式后 patch_file；勿擅自改动用户未提及的区域。";

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
  const isUiQuestion = UI_IMAGE_QUESTION_RE.test(body) || NARROW_UI_TOPIC_RE.test(body);
  if (!isUiQuestion) {
    return `【附带图片】请先结合图片理解并回答；仅在信息不足时再调用工具。\n\n${body}`;
  }

  const implementing = UI_IMPLEMENTATION_INTENT_RE.test(body);
  const expanded = UI_EXPLICIT_EXPAND_RE.test(body);
  const scopeRule = implementing
    ? expanded
      ? UI_SCOPE_IMPLEMENT_EXPANDED
      : UI_SCOPE_IMPLEMENT
    : UI_SCOPE_DISCUSS;
  const toolHint = implementing
    ? "先结合图片确认所指区域，再在该区域对应源码内定位并修改。"
    : "先根据图片直接回答（描述所见界面、按钮、文字、布局），仅在需要对应源码时再调用工具；不要跳过读图先去全盘 grep/search。";
  const prefix = `【附图为本消息重点】${scopeRule} ${toolHint} 若界面像 Git/设置/聊天等，优先在 src/views 中查找，勿默认是外部应用。`;
  return `${prefix}\n\n${body}`;
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
