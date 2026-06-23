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

/** Click-to-focus / hit-target interaction (distinct from padding-only layout tweaks). */
export const UI_CLICK_FOCUS_INTERACTION_RE =
  /任何位置|任意位置|点到哪|点哪里|点击.{0,8}(输入|聚焦|focus)|都能输入|都能聚焦|点.{0,6}空白|点不到|没反应|聚焦输入/i;

/** User clarifies desired behavior — treat as implementation in Build follow-ups. */
export const UI_REQUIREMENT_SPEC_RE =
  /我要的效果|我期望|期望效果|应该是|需要能|要能|得能|想要的效果/i;

/** Layout/spacing feedback often paired with screenshots ("你看挤一块了"). */
const UI_LAYOUT_FEEDBACK_RE =
  /挤|贴|挨|重叠|太紧|间距|spacing|overlap|cramped|你看|看一下|一块|不好看|丑|效果|太小|太大|偏小|偏大|比例|不协调/i;

/** Control rendered at wrong screen coordinates (often fixed/Teleport overlay, not flex). */
export const UI_POSITIONING_BUG_RE =
  /跑(?:到|去|别的)|错位|位置不对|飘到|歪了|不在.{0,8}旁边|离.{0,8}远|跑到.{0,12}(底|顶|角)/i;

/** Color/button topics that should stay within the visible region the user points at. */
const NARROW_UI_TOPIC_RE = /配色|颜色|按钮|badge|几种|太多|有点多|杂乱|花哨/i;

export const VISION_FIRST_TURN_MIN_DESCRIPTION_CHARS = 24;

/** Visible copy in screenshots (placeholder, label, tab title, button). */
const VISIBLE_ANCHOR_QUOTE_RE =
  /[「『"']([^」』"']{3,})[」』"']|占位符[^，。；\n]{0,16}[「『"']([^」』"']{3,})[」』"']?|(?:标签|按钮|标题|Tab)[:：]?\s*[「『"']([^」』"']{3,})[」』"']?/g;

const VISIBLE_ANCHOR_QUOTE_TEST_RE =
  /[「『"']([^」』"']{3,})[」』"']|占位符[^，。；\n]{0,16}[「『"']([^」』"']{3,})[」』"']?|(?:标签|按钮|标题|Tab)[:：]?\s*[「『"']([^」』"']{3,})[」』"']?/;

/** Extract quoted visible strings from a vision-first-turn description. */
export function extractVisibleAnchorQuotes(text: string): string[] {
  const quotes: string[] = [];
  const re = new RegExp(VISIBLE_ANCHOR_QUOTE_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const quote = (match[1] || match[2] || match[3] || "").trim();
    if (quote.length >= 3) quotes.push(quote);
  }
  return [...new Set(quotes)];
}

/** Links quoted / visible text to which UI region or module it belongs to. */
const ANCHOR_TO_REGION_RE =
  /(判断|可判断|可推断|据此|由此|说明|对应|属于|定位为|应是|这是|应该是|像是|表明|可定位)[^。\n]{0,48}(助手|聊天|输入框|面板|模块|区域|底栏|侧栏|编辑器|对话|占位|工具栏|列表)/i;

/** Names the screenshot region without necessarily quoting anchor text. */
const UI_REGION_STATEMENT_RE =
  /(截图|图中|图里|从图|可见|画面)[^。\n]{0,72}(区域|模块|面板|输入|按钮|编辑器|侧栏|底|顶|助手|聊天|工具栏|列表)/i;

const UI_MODULE_STATEMENT_RE =
  /这是[^。\n]{0,48}(助手|聊天|输入|面板|模块|区域|编辑器|底栏|侧栏|工具栏)/i;

export function buildClickFocusInteractionHint(): string {
  return [
    "【点击/聚焦交互】用户要求点击输入区域任意位置即可输入或聚焦。",
    "这通常不是单纯加大 padding：须核对父容器与内层 contenteditable/textarea 的命中区域是否一致；",
    "常见修复：外层 mousedown 转发 focus、或让 editable 用 min-height:100% 填满父容器；改 padding 前先 read_file 看清 DOM 层级。",
  ].join("");
}

export function buildFloatingControlPositioningHint(): string {
  return [
    "【浮动/绝对定位控件】若图中某按钮/标签与上方选区、焦点区域在空间上分离（如选区在消息区、按钮却出现在底栏/角落），",
    "该控件多半是 position:fixed/absolute 或 Teleport 到 body 的浮层，而非父容器 flex 内嵌元素。",
    "读图时须区分「浮层错位」与「底栏 flex 拥挤」；后续 grep 优先搜 kebab-case class（如 *-floating、*-popup）及 Teleport，勿仅凭可见中文文案锁定错误组件。",
  ].join("");
}

/** Icon/label vs outer control shell — common in screenshot UI feedback. */
export function buildControlInnerProportionHint(): string {
  return [
    "【控件内外比例】读图时若见按钮、徽章、chip、带图标的圆形/方形控件等复合元素：",
    "须分别描述外框（容器）与内层（图标、箭头、文字、徽标）的相对大小与视觉权重；",
    "若外框明显偏大/占满画面而内层图标或文字显得过小、过细、留白过多，须明确写出「内外比例失衡」及哪一层偏大/偏小，",
    "勿只并列「有大容器和小图标」却不作比例判断；若外框正常仅内层偏小/偏细，也要单独点出。",
    "后续改代码时须同时核对容器尺寸（width/height/padding）与内层尺寸（svg width/height、font-size、stroke-width），勿只改其中一层。",
  ].join("");
}

export function isUiPositioningBugPrompt(text: string): boolean {
  const body = text.trim();
  if (!body) return false;
  return UI_POSITIONING_BUG_RE.test(body) && NARROW_UI_TOPIC_RE.test(body);
}

/** Vision description treats a spatially separated control as embedded layout. */
export function suggestsEmbeddedLayoutMisread(visionDescription: string): boolean {
  const text = visionDescription.trim();
  if (!text) return false;
  const blamesInFlowLayout =
    /flex|布局问题|父容器|(?:[\w-]+-)?(?:bottom|footer|toolbar|status|action)(?:-(?:row|bar|area))?|position:\s*relative/i.test(text);
  const hasSeparatedRegions =
    /选区|选中|蓝色|高亮/.test(text) &&
    /底(?:部|栏)|状态栏|角落|同一行|左下|右下/.test(text);
  if (hasSeparatedRegions && blamesInFlowLayout) return true;

  const controlAtEdge =
    /底(?:部|栏)|状态栏|角落|左下|右下/.test(text) &&
    /按钮|控件|悬浮|浮在|停留|弹出/.test(text);
  const omitsOverlayMechanism = !/Teleport|fixed|absolute|浮层错位/i.test(text);
  if (controlAtEdge && blamesInFlowLayout && omitsOverlayMechanism) return true;

  return false;
}

export function buildVisionGrepAnchorHint(visionDescription: string): string {
  if (!suggestsEmbeddedLayoutMisread(visionDescription)) return "";
  return [
    "【读图校正·定位方式】读图把浮层按钮误判为底栏 flex 内嵌控件。",
    "下一轮勿再 grep 纯中文泛词；改 grep kebab-case class（如 *-floating、Teleport）或 position:fixed / show*At / getSelection* 等结构符号。",
    "read_file 定位到浮层/坐标计算相关代码后应 patch 或输出诊断，勿反复读与截图区域无关的 layout template。",
  ].join("");
}

/** Generic post-vision locate chain — structural, not bound to any page or directory. */
export function buildVisionUiLocateHint(anchorQuotes: string[]): string {
  const anchorHint =
    anchorQuotes.length > 0
      ? `读图已摘录可见原文：${anchorQuotes.slice(0, 4).map((q) => `「${q}」`).join("、")}。`
      : "读图描述中须引用占位符/标签/按钮等可见原文。";
  return [
    "【截图 UI 定位·通用】",
    anchorHint,
    "定位顺序：① grep 上述原文中最短可唯一识别的片段（≥4 字）或 grep kebab-case class（如 item-meta、panel-list）；② read_file 核对 template/DOM 是否与截图一致；③ 不一致则换下一个 grep 命中，勿猜组件文件名。",
    "search_files 仅按文件名匹配，中文 UI 文案须用 grep 搜内容；patch 的 old_string 必须来自 read_file 返回原文，禁止凭记忆构造 CSS/DOM。",
  ].join("");
}

export function buildVisionBuildContinueHint(visionDescription: string, userPrompt: string): string {
  const parts = [buildVisionFirstTurnContinueHint()];
  parts.push(buildVisionUiLocateHint(extractVisibleAnchorQuotes(visionDescription)));
  if (mentionsControlProportionImbalance(visionDescription)) {
    parts.push(
      "【读图已指出内外比例问题】下一轮 read_file 须同时覆盖容器样式与内层 SVG/字体尺寸，patch 时两层一起调整，勿只改 width/height 或只改图标其一。",
    );
  }
  if (suggestsVisibleShellEmptyInner(visionDescription)) {
    parts.push(buildVisibleShellEmptyInnerHint());
  }
  if (isUiPositioningBugPrompt(userPrompt) || UI_POSITIONING_BUG_RE.test(visionDescription)) {
    parts.push(buildFloatingControlPositioningHint());
  }
  const grepHint = buildVisionGrepAnchorHint(visionDescription);
  if (grepHint) parts.push(grepHint);
  parts.push(
    "探索过程中每 3 轮须用中文写一段可见进度（根因假设 + 下一步），勿仅用英文 planning 句；grep 命中且 read_file 核对一致后 Build 模式必须 patch_file/write_file。",
  );
  return parts.join("\n");
}

export function buildVisionFirstTurnRule(): string {
  return [
    "【附图·首轮必读图】你必须先仔细查看附带图片，用中文描述所见：",
    "- 先说明截图对应应用中的哪一块（模块/面板/区域）；画面若只裁到局部，也要根据占位符、按钮、标签等可见文案推断归属；",
    "- 须引用图中可辨识的占位符或标签原文（用「」括起），并写明「据此可判断这是 …」；",
    "- 再补充控件类型、布局关系；若用户反馈拥挤/重叠/不好看，须点名哪两个（或哪组）元素及其关系；",
    "- 若控件含图标、文字或徽章等内嵌内容，须描述外框与内层的相对大小；内外明显不匹配时须点明「内外比例失衡」及哪一层偏大/偏小，勿只罗列元素类型而不作比例判断。",
    "本轮禁止调用任何工具；仅输出读图描述，下一轮可用 grep 图中摘录的文案定位源码。",
    "读图首轮禁止写「已修改/已修复/已添加/已做」等完成时态，禁止描述尚未执行的 patch。",
    "布局问题后续修改时：底栏内元素拥挤查 flex-shrink、min-width、overflow、gap、margin；若控件与选区/焦点在空间上分离，优先怀疑 position:fixed/absolute 或 Teleport 浮层错位，勿误判为 flex。",
    "点击/聚焦问题另查 DOM 层级与 focus 转发，勿默认只加 padding。",
    "当你真正理解了截图内容后，在描述末尾加上暗号 [图已理解]。只有加上此暗号，才表示你已完成读图。",
  ].join("\n");
}

/** Vision text flagged inner/outer scale mismatch for follow-up locate hints. */
export function mentionsControlProportionImbalance(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /内外比例|比例失衡|内层.{0,12}(偏小|偏细|过小)|外框.{0,12}(偏大|过大)|图标.{0,12}(偏小|过小|偏细)|文字.{0,12}(偏小|过小)|相对.{0,8}(偏小|过大|失衡)/i.test(
    trimmed,
  );
}

/** Container visible in screenshot but inner symbol/text appears missing or clipped. */
export function suggestsVisibleShellEmptyInner(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /(?:外框|圆|容器|按钮).{0,24}(?:可见|在渲染|出现).{0,24}(?:箭头|图标|文字|符号|内容).{0,16}(?:不可见|看不到|空白|被裁|没有)|(?:箭头|图标|文字|符号).{0,16}(?:不可见|看不到|空白|没有).{0,24}(?:外框|圆|容器|按钮)/i.test(
    trimmed,
  );
}

export function buildVisibleShellEmptyInnerHint(): string {
  return [
    "【读图·内外层】外框可见但内层符号/文字不可见：优先改内层渲染（text 字符、SVG 尺寸/stroke、font-size/line-height），",
    "勿再改外层 position/bottom；除非 read 证明控件不在 viewport 或被 overflow 裁切。",
  ].join("");
}

export function buildVisionFirstTurnContinueHint(): string {
  return [
    "【读图完成】已记录你对附图的理解。",
    "下一轮请结合上述描述与用户需求调用工具；",
    "若读图时摘录了占位符/按钮/标签等可见文案，优先 grep 该字符串（≥4 字片段）定位源码，再 read_file 核对 DOM 是否与截图一致；不一致则换下一个命中。",
    "回答用户时先一句点明「截图对应哪块界面」，再讲操作或改代码。",
    "注意：首轮截图描述已生效，后续轮次禁止重复输出同一张截图的描述；若仅需配合用户追问补充少量布局细节，也不要完整重写。",
    "若本轮可产出最终回复（如用户仅提问/讨论，无需改代码），应直接回答并结束，不要无工具调用地空转多轮。",
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
    "请重新查看附图：引用占位符/标签原文，并写明据此判断属于哪个模块或区域；",
    "若画面只裁到局部，也要根据可见文案推断，不要只复述颜色与边框；",
    "复合控件（按钮/徽章等）还须说明外框与内层图标/文字的比例是否失衡。本轮仍不要调用工具。",
    "真正理解截图后，在末尾加上暗号 [图已理解]。",
  ].join("");
}

export function buildVisionFirstTurnPrematureCompletionRetryHint(): string {
  return [
    "【附图首轮·禁止抢答】你在尚未调用工具前写了「已修改/已修复/已添加/已做」等完成表述。",
    "读图首轮只能描述截图所见与控件类型，不得声称已改代码。请重写读图描述，本轮仍不要调用工具。",
    "真正理解截图后，在末尾加上暗号 [图已理解]。",
  ].join("");
}

/** Vision-first turn must not claim code changes before any tool runs. */
export function isPrematureVisionCompletionClaim(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /已(?:经)?(?:修复|修改|添加|完成|写入|调整|做)|已做的修改|现在点击输入框任何位置/i.test(trimmed);
}

function hasVisibleAnchorQuote(text: string): boolean {
  return VISIBLE_ANCHOR_QUOTE_TEST_RE.test(text);
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
  if (isPrematureVisionCompletionClaim(text)) return false;
  return /\[图已理解\]/.test(text);
}

export function shouldRequireVisionFirstTurn(imageCount: number, visionFallbackApplied: boolean): boolean {
  return imageCount > 0 && !visionFallbackApplied;
}

/** User is confirming a feeling or asking a short question — not asking to implement yet. */
const UI_OPINION_FOLLOWUP_RE =
  /有点多|太多了|是不是|对吗|是否|过多|杂乱|花哨|吗[？?]?\s*$|是不是.*多/i;

/** User wants code changes; allow scoped grep/patch within the prior screenshot region. */
const UI_IMPLEMENTATION_INTENT_RE =
  /帮我|改一下|修改|修复|实现|统一|调整|动手|写入|应用|做成|换成|去掉|减少|精简一下|收敛到|只留|合并|优化(?:一下|下|UI|ui|界面|样式|布局)?|我要的效果|期望效果|要能|需要能/i;

/** Short UI tweak prompt with screenshot (e.g. 「优化UI」). */
const UI_SHORT_IMAGE_IMPLEMENT_RE =
  /^(?:优化|改(?:一下|下)?)(?:UI|ui|界面|样式|布局)?[。！!]?$/i;

/** User explicitly widens scope beyond the prior screenshot region. */
const UI_EXPLICIT_EXPAND_RE = /整个|整页|全面板|全面板|整块|全局|所有/i;

const UI_SCOPE_DISCUSS =
  "讨论时：范围限定为用户所指的可视区域（通常即截图可见部分），勿擅自扩大到未展示区域或整页/全项目样式盘点；用户明确要求扩大时再扩大。读图时若见占位符/标签/按钮文字，须据此说明截图是哪块界面。";

const UI_SCOPE_IMPLEMENT =
  "实施时：仍以上一轮截图所指的同一可视区域为默认改动范围；优先 grep 读图时摘录的占位符或标签文案定位组件，再 read/patch；勿擅自改动用户未提及的区域。";

const UI_SCOPE_IMPLEMENT_EXPANDED =
  "实施时：用户已明确要求扩大改动范围，按其所述区域实施，勿超出其描述。";

function isUiInputInteractionThread(content: string): boolean {
  return /输入框|可编辑|contenteditable|textarea|聚焦|focus|点击.{0,6}输入|padding|占位/.test(
    content,
  );
}

function isScreenshotScopedUiThread(lastAssistantContent: string): boolean {
  const priorMentionsScreenshot = /截图|如图所示|从截图|截图中|截图里|从图|图里|图中/.test(
    lastAssistantContent,
  );
  const priorUiTopic =
    NARROW_UI_TOPIC_RE.test(lastAssistantContent) ||
    UI_IMAGE_QUESTION_RE.test(lastAssistantContent) ||
    isUiInputInteractionThread(lastAssistantContent);
  if (isUiInputInteractionThread(lastAssistantContent)) return true;
  return priorMentionsScreenshot && priorUiTopic;
}

function hasUiImplementationIntent(body: string): boolean {
  return (
    UI_IMPLEMENTATION_INTENT_RE.test(body) ||
    UI_REQUIREMENT_SPEC_RE.test(body) ||
    UI_CLICK_FOCUS_INTERACTION_RE.test(body)
  );
}

export function buildVisionTaskText(text: string, imageCount: number): string {
  if (imageCount <= 0) return text;
  const body = text.trim() || "请描述并分析附带的图片。";
  const firstTurnRule = buildVisionFirstTurnRule();
  const clickFocusHint = UI_CLICK_FOCUS_INTERACTION_RE.test(body)
    ? `\n\n${buildClickFocusInteractionHint()}`
    : "";
  const positioningHint = isUiPositioningBugPrompt(body)
    ? `\n\n${buildFloatingControlPositioningHint()}`
    : "";
  const shortImageImplement = UI_SHORT_IMAGE_IMPLEMENT_RE.test(body);
  const isUiQuestion =
    shortImageImplement ||
    UI_IMAGE_QUESTION_RE.test(body) ||
    NARROW_UI_TOPIC_RE.test(body) ||
    UI_LAYOUT_FEEDBACK_RE.test(body) ||
    UI_CLICK_FOCUS_INTERACTION_RE.test(body) ||
    UI_REQUIREMENT_SPEC_RE.test(body) ||
    isUiPositioningBugPrompt(body);
  const proportionHint = isUiQuestion ? `\n\n${buildControlInnerProportionHint()}` : "";
  if (!isUiQuestion) {
    return `${firstTurnRule}${clickFocusHint}${positioningHint}\n\n${body}`;
  }

  const implementing = shortImageImplement || hasUiImplementationIntent(body);
  const expanded = UI_EXPLICIT_EXPAND_RE.test(body);
  const scopeRule = implementing
    ? expanded
      ? UI_SCOPE_IMPLEMENT_EXPANDED
      : UI_SCOPE_IMPLEMENT
    : UI_SCOPE_DISCUSS;
  const toolHint = implementing
    ? "读图描述须先根据占位符/标签说明截图是哪块界面，下一轮再 grep 该文案并在对应源码内修改；修改前先 read_file 父/子 DOM 层级，勿在未读代码前声称已改完。"
    : "读图须说明截图对应哪块界面（可据占位符/标签推断），并覆盖用户所指可见范围；不要跳过读图先去全盘 grep/search。";
  const prefix = `【附图为本消息重点】${scopeRule} ${toolHint} 定位须从截图可见原文或 grep 命中出发，勿猜组件文件名或固定目录。`;
  return `${firstTurnRule}${clickFocusHint}${positioningHint}${proportionHint}\n\n${prefix}\n\n${body}`;
}

/**
 * When the user continues a screenshot-scoped UI topic without a new image,
 * inject phase-specific scope hints (discuss vs implement).
 */
export function buildUiScopeFollowUpHint(prompt: string, lastAssistantContent?: string): string {
  const body = prompt.trim();
  if (!body || !lastAssistantContent?.trim()) return prompt;
  if (!isScreenshotScopedUiThread(lastAssistantContent)) return prompt;

  const implementing = hasUiImplementationIntent(body);
  const expanded = UI_EXPLICIT_EXPAND_RE.test(body);
  const opinionFollowUp =
    UI_OPINION_FOLLOWUP_RE.test(body) || (NARROW_UI_TOPIC_RE.test(body) && !implementing);

  if (!implementing && !opinionFollowUp) {
    if (UI_CLICK_FOCUS_INTERACTION_RE.test(body)) {
      return ["【延续 UI 交互需求·实施】", buildClickFocusInteractionHint(), "", body].join("\n");
    }
    return prompt;
  }

  if (implementing) {
    const scopeRule = expanded ? UI_SCOPE_IMPLEMENT_EXPANDED : UI_SCOPE_IMPLEMENT;
    const clickFocusHint = UI_CLICK_FOCUS_INTERACTION_RE.test(body)
      ? `\n${buildClickFocusInteractionHint()}`
      : "";
    return ["【延续上一轮截图范围·实施】", scopeRule, clickFocusHint, "", body].filter(Boolean).join("\n");
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
