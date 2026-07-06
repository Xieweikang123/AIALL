import {
  isAccuracyConsultativePrompt,
  isUiAppearanceQuestionPrompt,
  isUiLocateQuestionPrompt,
  isUiStatePersistenceQuestionPrompt,
} from "../generic/userIntentClassifiers";
import { isPrematureVisionCompletionClaim } from "../../../shared/visionCompletionClaim";

export {
  isUiAppearanceQuestionPrompt,
  isUiLocateQuestionPrompt,
  isUiStatePersistenceQuestionPrompt,
} from "../generic/userIntentClassifiers";
export { isPrematureVisionCompletionClaim };

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
    "勿 grep 界面运行时拼接的数字（标签+计数在源码中不存在）；勿 grep 泛化状态符号（如 activeTab、selectedIndex）。",
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
    "禁止在未 read template 前断言控件语义（如状态圆点、计数含义、占位/未实现）；须 grep/read 后再解释元素作用。",
    "布局问题后续修改时：底栏内元素拥挤查 flex-shrink、min-width、overflow、gap、margin；若控件与选区/焦点在空间上分离，优先怀疑 position:fixed/absolute 或 Teleport 浮层错位，勿误判为 flex。",
    "点击/聚焦问题另查 DOM 层级与 focus 转发，勿默认只加 padding。",
    "当你真正理解了截图内容后，在描述末尾加上暗号 [图已理解]。只有加上此暗号，才表示你已完成读图。",
  ].join("\n");
}

/** Locate-only consultative prompt with screenshot — read image and grep in the same turn. */
export function buildVisionLocateSingleTurnRule(): string {
  return [
    "【附图·定位题·同轮读图定位】用户问截图中的控件/区域在代码哪里，未要求改代码。",
    "本轮允许 list_dir / read_file / grep / search_files。同轮须完成：",
    "① 查看附图，用一句点明截图对应哪块界面，并引用可见原文（用「」括起）；",
    "② 立即 grep 该文案（≥2 字片段）或 kebab-case class；",
    "③ 必要时 read_file 1 个相关文件核对 template/DOM 是否与截图一致；",
    "④ 给出最终中文答案：只答用户所指的控件/区域，勿展开未问及的整块面板；引用行号须来自 read_file 返回。",
    "若外框可见但内层像空白，须查 v-if/shimmer/透明文字后再作答，勿只断言显示某数字。",
    "禁止写「下一轮再确认」；禁止在未 grep/read 的情况下猜测组件路径；禁止输出 [图已理解] 暗号（定位题无需读图独占轮）。",
  ].join("\n");
}

/** Accuracy / output-quality consultative prompt with screenshot — trace in same turn. */
export function buildVisionAccuracySingleTurnRule(): string {
  return [
    "【附图·准确度题·同轮读图追溯】用户问某功能/输出是否准确，未要求改代码。",
    "本轮允许 list_dir / read_file / grep / search_files。同轮须完成：",
    "① 查看附图，用一句点明截图对应哪块界面，并引用可见原文（用「」括起）；",
    "② grep 可见文案或相关符号定位用户操作入口；",
    "③ 沿调用链向下 trace：read 入口处理函数 → read API 客户端（若有）→ grep/read backend 路由或 middleware 中 prompt 构造处；",
    "④ 基于已读代码给出最终中文答案，说明实际注入的上下文；禁止用「如果 prompt 包含…」猜测。",
    "禁止写「下一轮再确认」或「想让我深入看一下」；禁止输出 [图已理解] 暗号。",
  ].join("\n");
}

/** UI state persistence after tab/mode switch — trace side effects in same turn. */
export function buildVisionStatePersistenceSingleTurnRule(): string {
  return [
    "【附图·UI 状态题·同轮读图追溯】用户问切换/返回后某面板或区域是否仍展开/可见/再次打开，未要求改代码。",
    "本轮允许 list_dir / read_file / grep / search_files。同轮须完成：",
    "① 查看附图，引用可见 tab/标签原文（用「」括起）；",
    "② grep 该文案或 mode/composable 符号定位切换入口；",
    "③ read 切换 handler，并 grep/read watch、collapse/expand 或 emit 副作用；",
    "④ 基于已读代码给出最终中文答案，说明切换时是否主动改另一状态；禁止只断言两个 ref 独立。",
    "禁止写「下一轮再确认」；禁止在未 grep/read 的情况下引用路径或行号；禁止输出 [图已理解] 暗号。",
  ].join("\n");
}

/** Screenshot locate or accuracy question — skip vision-first no-tools turn; use same-turn grep/trace instead. */
export function shouldBypassVisionFirstTurn(params: {
  imageCount: number;
  consultativeVisionRun: boolean;
  prompt: string;
}): boolean {
  if (params.imageCount <= 0) return false;
  if (!params.consultativeVisionRun) return false;
  return (
    isUiLocateQuestionPrompt(params.prompt) ||
    isAccuracyConsultativePrompt(params.prompt) ||
    isUiAppearanceQuestionPrompt(params.prompt) ||
    isUiStatePersistenceQuestionPrompt(params.prompt)
  );
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
  if (
    /(?:外框|圆|容器|按钮|徽标|徽章|圆角).{0,24}(?:可见|在渲染|出现).{0,24}(?:箭头|图标|文字|符号|内容|数字).{0,16}(?:不可见|看不到|空白|被裁|没有|无明显)|(?:箭头|图标|文字|符号|数字|内容).{0,16}(?:不可见|看不到|空白|没有|无明显).{0,24}(?:外框|圆|容器|按钮|徽标|徽章|圆角)/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  return /无明显(?:内容|文字)|无文字|像.{0,16}(?:空|占位|toggle|开关)|(?:空洞|空白).{0,12}(?:控件|圆角|矩形)/i.test(
    trimmed,
  );
}

export function buildVisibleShellEmptyInnerHint(): string {
  return [
    "【读图·内外层】外框可见但内层符号/文字不可见：grep/read 全局 element 选择器（如 button { padding }）是否与 compact 控件 width/height 冲突；",
    "冲突时组件内须 padding:0 + box-sizing:border-box，再改内层 text/SVG 尺寸/stroke；勿只调 currentColor 或外层 position/bottom。",
  ].join("");
}

/** Consultative: vision noted empty-looking shell — reconcile before answering, do not patch. */
export function buildConsultativeVisibleShellEmptyInnerHint(): string {
  return [
    "【读图·外框有内层无·咨询】读图记录外框可见但内层文字/数字看不清或像空白。",
    "最终回答须解释观感与源码是否一致：read template 查 v-if/v-show、内层绑定字段，以及 shimmer/透明文字/background-clip 等样式；",
    "若截图观感与数据绑定矛盾，须在答案中说明原因（条件未满足则不渲染、动画类使文字透明等），勿只断言「显示某数字」。",
    "只答用户所指的单个控件，勿展开整块面板结构。",
  ].join("");
}

/** Final answer claims display without reconciling vision-noted empty shell. */
export function isUnreconciledEmptyShellAnswer(visionText: string, replyText: string): boolean {
  if (!suggestsVisibleShellEmptyInner(visionText)) return false;
  const reply = replyText.replace(/\s*\[图已理解\]\s*/g, "").trim();
  if (!reply) return false;
  if (/v-if|v-show|shimmer|透明|渐变|background-clip|text-fill|条件.{0,8}(?:不|未)|为\s*0|不渲染|看不见|观感/i.test(reply)) {
    return false;
  }
  return /显示.{0,12}(?:数字|数量|条数|N|\d)|徽标|badge|用于显示/i.test(reply);
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
    "禁止在未 grep/read 的情况下猜测源码路径或组件文件名；禁止写「下一轮再确认/需要再搜索」。",
    "禁止重复首轮完整外观描述；读图记录已生效，本轮只输出定位结论与答案。",
    "禁止连环 read_file/grep 多个无关文件；核对后立即输出最终答案。",
    "只答用户所指的单个控件/区域，勿展开整块面板；行号须来自 read_file 返回，禁止凭记忆写行号。",
  ].join("");
}

const DEFERRED_LOCATE_REPLY_RE =
  /(?:下一(?:轮|步)|再.{0,8}(?:搜索|确认|核对|定位|查))|(?:需要|须|应).{0,16}(?:搜索|确认|核对|定位)|通过搜索.{0,16}确认|精确确认/i;

export function isDeferredLocateReply(text: string): boolean {
  const body = text.replace(/\s*\[图已理解\]\s*/g, "").trim();
  if (!body) return false;
  return DEFERRED_LOCATE_REPLY_RE.test(body);
}

const SPECULATIVE_LOCATE_REPLY_RE =
  /(?:极有可能|很可能|可能属于|或许在|猜测|推断.{0,24}(?:属于|位于)).{0,48}(?:或|\/)/i;

const SPECULATIVE_PATH_GUESS_RE =
  /(?:极有可能|很可能|可能属于|或许|猜测).{0,48}[`'"][\w./-]+\.(?:vue|tsx?|jsx?)['"`]/i;

/** Claims placeholder/unimplemented before grep/read evidence. */
const SPECULATIVE_PLACEHOLDER_CLAIM_RE =
  /(?:占位|placeholder|尚未实现|无(?:内容|图标|点击)|待办功能|早期规划).{0,32}(?:占位|placeholder|未实现|无内容|无图标|无点击)/i;

export function isSpeculativeLocateReply(text: string): boolean {
  const body = text.replace(/\s*\[图已理解\]\s*/g, "").trim();
  if (!body) return false;
  return (
    SPECULATIVE_LOCATE_REPLY_RE.test(body) ||
    SPECULATIVE_PATH_GUESS_RE.test(body) ||
    SPECULATIVE_PLACEHOLDER_CLAIM_RE.test(body)
  );
}

export function isRepeatingVisionFirstTurnDescription(replyText: string, visionText: string): boolean {
  const a = replyText.replace(/\s*\[图已理解\]\s*/g, "").trim();
  const b = visionText.replace(/\s*\[图已理解\]\s*/g, "").trim();
  if (!a || !b || a.length < 48 || b.length < 48) return false;
  const headA = a.slice(0, 72);
  const headB = b.slice(0, 72);
  if (headA === headB) return true;
  const snippet = headB.slice(0, 44);
  return snippet.length >= 24 && a.includes(snippet);
}

export function buildVisionConsultativeLocateRetryHint(anchorQuotes: string[]): string {
  const anchorHint =
    anchorQuotes.length > 0
      ? `读图已摘录：${anchorQuotes.slice(0, 3).map((q) => `「${q}」`).join("、")}。请 grep 其中 ≥4 字片段。`
      : "请 grep 读图描述中的可见文案（≥4 字）或 kebab-case class。";
  return [
    "【定位未完成】读图已完成，但尚未 grep/read 核对源码。",
    anchorHint,
    "禁止猜测组件路径或写「下一轮再确认」。",
    "请立即调用 grep（必要时 read_file 1 个文件），然后给出最终答案：先一句点明截图对应哪块界面，再答用户问题。",
    "勿重复首轮完整外观描述。",
  ].join("");
}

export function shouldRunVisionAnchorPrefgrep(params: {
  consultativeVisionRun: boolean;
  prompt: string;
  anchorQuotes: string[];
}): boolean {
  if (!params.consultativeVisionRun || params.anchorQuotes.length === 0) return false;
  return (
    isUiLocateQuestionPrompt(params.prompt) ||
    isAccuracyConsultativePrompt(params.prompt) ||
    isUiAppearanceQuestionPrompt(params.prompt)
  );
}

export function buildConsultativeUiAppearanceHint(): string {
  return [
    "【读图·样式/观感咨询】用户问背景透明度、模糊、颜色等视觉效果。",
    "须 grep 定位组件后 read_file 其 scoped 样式中的 background / backdrop-filter / opacity；",
    "再答是否与截图一致；无 read 证据禁止「是的/不是」或断言 rgba/backdrop-filter。",
    "若用户感觉「透」，须区分弹层容器与父级工具栏：父级可能有 rgba/backdrop-filter，弹层本身仍可能是实色 background。",
    "只答用户所问的视觉属性，勿展开整块面板结构。",
  ].join("");
}

const SPECULATIVE_STYLE_ANSWER_RE =
  /(?:rgba\s*\(|backdrop-filter|毛玻璃|半透明|透明背景|blur\s*\()/i;

const BINARY_STYLE_CONCLUSION_RE =
  /(?:是的|不是|并非|确实|属于).{0,24}(?:透明|半透明|毛玻璃|实色|不透明)/;

/** Style/binary visual claim without citing read CSS evidence. */
export function isSpeculativeStyleAnswer(text: string): boolean {
  const body = text.replace(/\s*\[图已理解\]\s*/g, "").trim();
  if (!body) return false;
  if (/var\s*\(--|background\s*:|\.[\w-]+\s*\{/.test(body)) return false;
  return SPECULATIVE_STYLE_ANSWER_RE.test(body) || BINARY_STYLE_CONCLUSION_RE.test(body);
}

export function buildConsultativeUiAppearanceRetryHint(vueFiles: string[]): string {
  const fileHint =
    vueFiles.length > 0
      ? `请 read_file：${vueFiles.slice(0, 2).join("、")}（含 \`<style>\` 段）。`
      : "请 read_file 定位到的组件样式段。";
  return [
    "【样式未闭环】你在未 read CSS 的情况下断言了透明/模糊/rgba 等视觉效果。",
    fileHint,
    "从 read 返回引用 background 等属性后再给二元结论；不确定则明确说「无法确认」。",
    "若本轮工具结果中已有该文件片段，禁止再 grep/read 同一文件，直接基于已有内容作答。",
  ].join("");
}

export function buildConsultativeAppearanceAnswerAfterReadHint(): string {
  return [
    "【样式已读·须作答】你已 read 过相关组件/CSS，禁止再调用 grep/read 重复同一文件。",
    "请基于已有 read 结果立即输出最终中文答案：引用 background / var(--*) 等属性，说明弹层是否透明；",
    "勿重复读图首轮的外观描述；禁止写「下一轮再确认」。",
  ].join("");
}

function normalizeConsultativeRelPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").trim().toLowerCase();
}

function consultativePathsMatch(read: string, vue: string): boolean {
  const r = normalizeConsultativeRelPath(read);
  const v = normalizeConsultativeRelPath(vue);
  if (!r || !v) return false;
  return r.endsWith(v) || v.endsWith(r) || r.includes(v);
}

/** Final answer cites CSS read from grep-hit component. */
export function replyHasCssReadEvidence(text: string): boolean {
  const body = text.replace(/\s*\[图已理解\]\s*/g, "").trim();
  if (!body) return false;
  return (
    /var\s*\(--|background\s*:|backdrop-filter|opacity\s*:/i.test(body) ||
    /\.[\w-]+\s*\{/.test(body)
  );
}

function consultativeNeedsGrepHitVueRead(
  grepHitVueFiles: string[] | undefined,
  consultativeReadPaths: string[] | undefined,
): boolean {
  if (!grepHitVueFiles?.length) return false;
  const reads = consultativeReadPaths ?? [];
  if (!reads.length) return true;
  return !grepHitVueFiles.some((vue) => reads.some((read) => consultativePathsMatch(read, vue)));
}

export function consultativeAppearanceNeedsVueRead(
  grepHitVueFiles: string[] | undefined,
  consultativeReadPaths: string[] | undefined,
  visionLocateReadUsed?: boolean,
): boolean {
  if (visionLocateReadUsed) return false;
  return consultativeNeedsGrepHitVueRead(grepHitVueFiles, consultativeReadPaths);
}

export function shouldBlockConsultativeVisionLocateFinalize(params: {
  consultativeVisionRun: boolean;
  visionLocateActive: boolean;
  visionLocateToolsUsed: boolean;
  visionAutoGrepHadMatches?: boolean;
  visionLocateReadUsed?: boolean;
  prompt: string;
  replyText: string;
  visionFirstTurnText?: string;
  grepHitVueFiles?: string[];
  consultativeReadPaths?: string[];
}): boolean {
  if (!params.consultativeVisionRun || !params.visionLocateActive) return false;

  const appearancePrompt = isUiAppearanceQuestionPrompt(params.prompt);

  if (
    params.visionLocateReadUsed &&
    appearancePrompt &&
    replyHasCssReadEvidence(params.replyText) &&
    !isSpeculativeStyleAnswer(params.replyText)
  ) {
    return false;
  }

  if (isDeferredLocateReply(params.replyText)) return true;

  if (
    params.visionFirstTurnText &&
    isRepeatingVisionFirstTurnDescription(params.replyText, params.visionFirstTurnText) &&
    !replyHasCssReadEvidence(params.replyText)
  ) {
    return true;
  }

  if (
    appearancePrompt &&
    isSpeculativeStyleAnswer(params.replyText) &&
    consultativeNeedsGrepHitVueRead(params.grepHitVueFiles, params.consultativeReadPaths)
  ) {
    return true;
  }

  if (
    params.visionAutoGrepHadMatches &&
    !params.visionLocateReadUsed &&
    (isUiLocateQuestionPrompt(params.prompt) || appearancePrompt)
  ) {
    return true;
  }

  if (
    appearancePrompt &&
    !params.visionLocateReadUsed &&
    consultativeNeedsGrepHitVueRead(params.grepHitVueFiles, params.consultativeReadPaths)
  ) {
    return true;
  }

  if (params.visionLocateToolsUsed) return false;

  if (isUiLocateQuestionPrompt(params.prompt)) return true;
  if (isUiStatePersistenceQuestionPrompt(params.prompt) && !params.visionLocateToolsUsed) {
    return true;
  }
  if (isSpeculativeLocateReply(params.replyText)) return true;
  if (
    params.visionFirstTurnText &&
    isUnreconciledEmptyShellAnswer(params.visionFirstTurnText, params.replyText)
  ) {
    return true;
  }
  return false;
}

export function buildUnreconciledEmptyShellRetryHint(): string {
  return [
    "【观感未闭环】读图记录控件外框可见但内层像空白，而你的回答只断言显示数字/徽标，未解释观感差异。",
    "请 read template 查 v-if/v-show、绑定字段及 shimmer/透明文字类样式，在最终答案中说明：源码意图显示什么、为何截图里看不清。",
    "只答用户所指的控件，勿展开整块面板；行号须来自 read_file 返回。",
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

function hasVisibleAnchorQuote(text: string): boolean {
  return VISIBLE_ANCHOR_QUOTE_TEST_RE.test(text);
}

function describesScreenshotUiRegion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (UI_REGION_STATEMENT_RE.test(trimmed) || UI_MODULE_STATEMENT_RE.test(trimmed)) return true;
  if (hasVisibleAnchorQuote(trimmed)) {
    return ANCHOR_TO_REGION_RE.test(trimmed);
  }
  return false;
}

export function isAdequateVisionFirstTurnDescription(text: string): boolean {
  if (isPrematureVisionCompletionClaim(text)) return false;
  const trimmed = text.trim();
  if (!/\[图已理解\]/.test(trimmed)) return false;
  if (trimmed.replace(/\s*\[图已理解\]\s*/g, "").trim().length < VISION_FIRST_TURN_MIN_DESCRIPTION_CHARS) return false;
  return describesScreenshotUiRegion(trimmed);
}

export function shouldRequireVisionFirstTurn(
  imageCount: number,
  visionFallbackApplied: boolean,
  bypassVisionFirstTurn = false,
): boolean {
  if (bypassVisionFirstTurn) return false;
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
  if (isUiLocateQuestionPrompt(body) && !hasUiImplementationIntent(body)) {
    return `${buildVisionLocateSingleTurnRule()}\n\n${body}`;
  }
  if (isAccuracyConsultativePrompt(body)) {
    return `${buildVisionAccuracySingleTurnRule()}\n\n${body}`;
  }
  if (isUiStatePersistenceQuestionPrompt(body) && !hasUiImplementationIntent(body)) {
    return `${buildVisionStatePersistenceSingleTurnRule()}\n\n${body}`;
  }
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
