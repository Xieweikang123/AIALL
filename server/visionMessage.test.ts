import { describe, expect, it } from "vitest";
import {
  buildControlInnerProportionHint,
  buildModelIdentityHint,
  buildUiScopeFollowUpHint,
  buildVisionBuildContinueHint,
  buildVisionConsultativeContinueHint,
  buildVisionLocateSingleTurnRule,
  buildVisionTaskText,
  buildVisionUiLocateHint,
  buildVisionUserContent,
  contentCharSize,
  contentDisplayText,
  extractVisibleAnchorQuotes,
  isAdequateVisionFirstTurnDescription,
  isDeferredLocateReply,
  isPrematureVisionCompletionClaim,
  isRepeatingVisionFirstTurnDescription,
  isSpeculativeLocateReply,
  isSpeculativeStyleAnswer,
  replyHasCssReadEvidence,
  isUnreconciledEmptyShellAnswer,
  isUiAppearanceQuestionPrompt,
  isUiLocateQuestionPrompt,
  isUiPositioningBugPrompt,
  isVisionUnsupportedError,
  mentionsControlProportionImbalance,
  shouldBlockConsultativeVisionLocateFinalize,
  shouldBypassVisionFirstTurn,
  suggestsVisibleShellEmptyInner,
  buildVisibleShellEmptyInnerHint,
  sanitizeImageDataUrls,
  shouldRequireVisionFirstTurn,
  suggestsEmbeddedLayoutMisread,
} from "./visionMessage";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

describe("visionMessage", () => {
  it("sanitizeImageDataUrls keeps only data:image URLs", () => {
    expect(sanitizeImageDataUrls(["http://x/a.png", PNG_DATA_URL, "data:text/plain,x"])).toEqual([PNG_DATA_URL]);
  });

  it("buildVisionUserContent returns plain text when no images", () => {
    expect(buildVisionUserContent("hello", [])).toBe("hello");
  });

  it("buildVisionUserContent builds multimodal parts with default text", () => {
    const content = buildVisionUserContent("", [PNG_DATA_URL]);
    expect(content).toEqual([
      { type: "text", text: expect.stringContaining("首轮必读图") },
      { type: "image_url", image_url: { url: PNG_DATA_URL } },
    ]);
  });

  it("buildVisionTaskText requires vision-first for layout feedback with images", () => {
    const text = buildVisionTaskText("是好看了，但是你看挤一块了", 1);
    expect(text).toContain("首轮必读图");
    expect(text).toContain("附图为本消息重点");
    expect(text).toContain("禁止调用任何工具");
  });

  it("buildVisionFirstTurnRule is required for any attached image", () => {
    const text = buildVisionTaskText("这段报错什么意思", 1);
    expect(text).toContain("首轮必读图");
    expect(text).toContain("禁止调用任何工具");
  });

  it("shouldRequireVisionFirstTurn respects vision fallback and locate bypass", () => {
    expect(shouldRequireVisionFirstTurn(1, false)).toBe(true);
    expect(shouldRequireVisionFirstTurn(1, true)).toBe(false);
    expect(shouldRequireVisionFirstTurn(0, false)).toBe(false);
    expect(shouldRequireVisionFirstTurn(1, false, true)).toBe(false);
  });

  it("shouldBypassVisionFirstTurn applies to consultative screenshot locate questions", () => {
    expect(
      shouldBypassVisionFirstTurn({
        imageCount: 1,
        consultativeVisionRun: true,
        prompt: "知道是哪儿的按钮吗？",
      }),
    ).toBe(true);
    expect(
      shouldBypassVisionFirstTurn({
        imageCount: 1,
        consultativeVisionRun: true,
        prompt: "ai生成注释准确吗？",
      }),
    ).toBe(true);
    expect(
      shouldBypassVisionFirstTurn({
        imageCount: 1,
        consultativeVisionRun: true,
        prompt: "你看挤一块了",
      }),
    ).toBe(false);
  });

  it("buildVisionTaskText uses same-turn accuracy trace for accuracy questions", () => {
    const text = buildVisionTaskText("ai生成注释准确吗？", 1);
    expect(text).toContain("准确度题·同轮读图追溯");
    expect(text).not.toContain("本轮禁止调用任何工具");
  });

  it("buildVisionTaskText uses same-turn locate rule for locate questions", () => {
    const text = buildVisionTaskText("知道是哪儿的按钮吗？", 1);
    expect(text).toContain("同轮读图定位");
    expect(text).toContain("允许 list_dir / read_file / grep");
    expect(text).not.toContain("本轮禁止调用任何工具");
  });

  it("isAdequateVisionFirstTurnDescription requires [图已理解] and UI region", () => {
    expect(
      isAdequateVisionFirstTurnDescription(
        "截图展示的是 Git 面板右侧部分，包含「AI 一键推送」按钮… [图已理解]",
      ),
    ).toBe(true);
    expect(
      isAdequateVisionFirstTurnDescription(
        "占位符「描述要改什么」表明这是 Vibe 助手输入框。[图已理解]",
      ),
    ).toBe(true);
    expect(isAdequateVisionFirstTurnDescription("看到了")).toBe(false);
    expect(
      isAdequateVisionFirstTurnDescription(
        "截图显示深色圆角输入框，占位符为「描述要改什么」",
      ),
    ).toBe(false);
    expect(
      isAdequateVisionFirstTurnDescription(
        "已修复 padding。[图已理解]",
      ),
    ).toBe(false);
    expect(
      isAdequateVisionFirstTurnDescription(
        "深色圆角按钮，边框灰色。[图已理解]",
      ),
    ).toBe(false);
  });

  it("isUiLocateQuestionPrompt detects where-is-this UI questions", () => {
    expect(isUiLocateQuestionPrompt("知道是哪儿的按钮吗？")).toBe(true);
    expect(isUiLocateQuestionPrompt("这是哪个面板的内容？")).toBe(true);
    expect(isUiLocateQuestionPrompt("会话这里，显示的啥")).toBe(true);
    expect(isUiLocateQuestionPrompt("帮我把这个按钮改小一点")).toBe(false);
  });

  it("isDeferredLocateReply detects postponed locate answers", () => {
    expect(isDeferredLocateReply("需要在下一轮通过搜索按钮文案来精确确认。")).toBe(true);
    expect(isDeferredLocateReply("位于 FilePanel.vue 的 session-action-btn。")).toBe(false);
  });

  it("isSpeculativeLocateReply detects component guessing without evidence", () => {
    const guess =
      "它极有可能属于文件面板（`src/components/vibe/FilePanel.vue`）或工具栏（`src/components/vibe/AppToolbar.vue`）。";
    expect(isSpeculativeLocateReply(guess)).toBe(true);
    expect(isSpeculativeLocateReply("grep 命中 FilePanel.vue，按钮 class 为 session-action-btn。")).toBe(false);
  });

  it("isSpeculativeLocateReply detects placeholder claims before evidence", () => {
    expect(
      isSpeculativeLocateReply("右侧空方框是待办功能的占位按钮，目前无内容/图标，可能是早期规划尚未实现。"),
    ).toBe(true);
  });

  it("isRepeatingVisionFirstTurnDescription detects duplicated vision narrative", () => {
    const vision =
      "这是一个深色背景上的按钮，按钮文字为「+ 新建」。按钮呈圆角矩形，边框为灰色，整体是一个标准的操作按钮样式。[图已理解]";
    const repeat =
      "这是一个深色背景上的按钮，按钮文字为「+ 新建」。按钮呈圆角矩形，边框为灰色，整体是一个标准的操作按钮样式。";
    expect(isRepeatingVisionFirstTurnDescription(repeat, vision)).toBe(true);
  });

  it("shouldBlockConsultativeVisionLocateFinalize blocks guess-only consultative vision replies", () => {
    const vision =
      "这是一个深色背景上的按钮，按钮文字为「+ 新建」。据此可判断这是侧栏会话区域。[图已理解]";
    const reply =
      "这是一个深色背景上的按钮，按钮文字为「+ 新建」。极有可能属于 FilePanel 或 AppToolbar，需要在下一轮搜索确认。";
    expect(
      shouldBlockConsultativeVisionLocateFinalize({
        consultativeVisionRun: true,
        visionLocateActive: true,
        visionLocateToolsUsed: false,
        prompt: "知道是哪儿的按钮吗？",
        replyText: reply,
        visionFirstTurnText: vision,
      }),
    ).toBe(true);
    expect(
      shouldBlockConsultativeVisionLocateFinalize({
        consultativeVisionRun: true,
        visionLocateActive: true,
        visionLocateToolsUsed: true,
        prompt: "知道是哪儿的按钮吗？",
        replyText: reply,
        visionFirstTurnText: vision,
      }),
    ).toBe(true);
  });

  it("shouldBlockConsultativeVisionLocateFinalize blocks speculative style without css read", () => {
    expect(
      shouldBlockConsultativeVisionLocateFinalize({
        consultativeVisionRun: true,
        visionLocateActive: true,
        visionLocateToolsUsed: true,
        visionLocateReadUsed: false,
        prompt: "弹窗背景透明的？",
        replyText: "是的，背景是半透明毛玻璃，用了 backdrop-filter。",
        grepHitVueFiles: ["src/components/vibe/AppToolbar.vue"],
        consultativeReadPaths: [],
      }),
    ).toBe(true);
    expect(
      shouldBlockConsultativeVisionLocateFinalize({
        consultativeVisionRun: true,
        visionLocateActive: true,
        visionLocateToolsUsed: true,
        visionLocateReadUsed: true,
        prompt: "弹窗背景透明的？",
        replyText:
          "`.project-history-dropdown { background: var(--bg-primary); }` 为实色，不透明。",
        grepHitVueFiles: ["src/components/vibe/AppToolbar.vue"],
        consultativeReadPaths: ["src/components/vibe/AppToolbar.vue"],
      }),
    ).toBe(false);
    expect(isSpeculativeStyleAnswer("是的，背景是半透明毛玻璃，用了 backdrop-filter。")).toBe(true);
    expect(
      isSpeculativeStyleAnswer(
        "`.project-history-dropdown { background: var(--bg-primary); }` 为实色，不透明。",
      ),
    ).toBe(false);
    expect(
      replyHasCssReadEvidence(
        "`.project-history-dropdown { background: var(--bg-primary); }` 为实色，不透明。",
      ),
    ).toBe(true);
  });

  it("isUiAppearanceQuestionPrompt triggers bypass and pregrep eligibility", () => {
    expect(isUiAppearanceQuestionPrompt("弹窗背景透明的？")).toBe(true);
    expect(
      shouldBypassVisionFirstTurn({
        imageCount: 1,
        consultativeVisionRun: true,
        prompt: "弹窗背景透明的？",
      }),
    ).toBe(true);
  });

  it("buildVisionConsultativeContinueHint limits tool exploration", () => {
    const hint = buildVisionConsultativeContinueHint();
    expect(hint).toContain("咨询");
    expect(hint).toContain("grep");
    expect(hint).toContain("禁止连环");
    expect(hint).toContain("禁止在未 grep/read");
    expect(hint).toContain("禁止重复首轮");
  });

  it("buildVisionFirstTurnRule requires anchor-based region identification", () => {
    const text = buildVisionTaskText("这个输入框，点哪里能聚焦？", 1);
    expect(text).toContain("占位符");
    expect(text).toContain("据此可判断");
    expect(text).toContain("grep");
  });

  it("buildVisionTaskText uses same-turn locate for which-region UI questions", () => {
    const text = buildVisionTaskText("你知道截图的是哪块内容吗？", 1);
    expect(text).toContain("同轮读图定位");
    expect(text).not.toContain("本轮禁止调用任何工具");
  });

  it("buildVisionTaskText scopes narrow UI color questions to visible region", () => {
    const text = buildVisionTaskText("看到按钮配色了吗，有几种颜色", 1);
    expect(text).toContain("附图为本消息重点");
    expect(text).toContain("讨论时");
    expect(text).toContain("勿擅自扩大");
  });

  it("buildVisionTaskText allows scoped implementation with images", () => {
    const text = buildVisionTaskText("帮我把 diff 区这几条按钮配色精简一下", 1);
    expect(text).toContain("实施时");
    expect(text).toContain("grep");
    expect(text).toContain("read/patch");
  });

  it("buildUiScopeFollowUpHint keeps opinion follow-up on prior screenshot scope", () => {
    const prior =
      "## 截图中的按钮配色\n\n从截图可以看到 3 种颜色的按钮……你是想调整这些按钮的配色方案吗？";
    const hint = buildUiScopeFollowUpHint("配色感觉有点多了，是吗", prior);
    expect(hint).toContain("延续上一轮截图范围·讨论");
    expect(hint).toContain("勿全盘盘点");
    expect(hint).toContain("配色感觉有点多了");
  });

  it("buildUiScopeFollowUpHint allows scoped implementation follow-up", () => {
    const prior = "## 截图中的按钮配色\n\n从截图可以看到 diff 区有 4 种颜色的按钮。";
    const hint = buildUiScopeFollowUpHint("对，帮我精简一下这几条按钮的配色", prior);
    expect(hint).toContain("延续上一轮截图范围·实施");
    expect(hint).toContain("grep");
    expect(hint).toContain("read/patch");
    expect(hint).not.toContain("勿全盘盘点");
  });

  it("buildUiScopeFollowUpHint respects explicit expand intent", () => {
    const prior = "## 截图中的按钮配色\n\n从截图可以看到 diff 区按钮。";
    const hint = buildUiScopeFollowUpHint("帮我把整个 Git 面板配色统一一下", prior);
    expect(hint).toContain("延续上一轮截图范围·实施");
    expect(hint).toContain("扩大改动范围");
  });

  it("buildUiScopeFollowUpHint skips unrelated follow-ups", () => {
    const prior = "## 修改完成\n\n已写入 a.ts";
    expect(buildUiScopeFollowUpHint("配色感觉有点多了", prior)).toBe("配色感觉有点多了");
  });

  it("buildUiScopeFollowUpHint continues input interaction thread without screenshot keyword", () => {
    const prior = "已修复。在 ChatComposerEditor.vue 添加了 `.composer-editor.focused` 聚焦描边。";
    const hint = buildUiScopeFollowUpHint("我要的效果是，点击输入框任何位置，都能输入", prior);
    expect(hint).toContain("延续");
    expect(hint).toContain("点击/聚焦交互");
    expect(hint).toContain("任何位置");
  });

  it("buildVisionTaskText adds click-focus hint for hit-target requirements", () => {
    const text = buildVisionTaskText("我要的效果是，点击输入框任何位置，都能输入", 1);
    expect(text).toContain("点击/聚焦交互");
    expect(text).toContain("contenteditable");
    expect(text).not.toMatch(/勿默认只加 padding.*勿默认只加 padding/);
  });

  it("isPrematureVisionCompletionClaim rejects done-state before tools", () => {
    expect(isPrematureVisionCompletionClaim("已做的修改：padding 改为 8px")).toBe(true);
    expect(
      isAdequateVisionFirstTurnDescription(
        "占位符「描述要改什么」表明这是 Vibe 助手输入框。已修复 padding。",
      ),
    ).toBe(false);
  });

  it("buildModelIdentityHint uses configured model id", () => {
    expect(buildModelIdentityHint("mimo-v2.5-pro")).toContain("mimo-v2.5-pro");
    expect(buildModelIdentityHint("mimo-v2.5-pro")).toContain("不要自称 Claude");
  });

  it("contentDisplayText hides base64 and shows image count", () => {
    const content = buildVisionUserContent("看看这个", [PNG_DATA_URL, PNG_DATA_URL]);
    expect(contentDisplayText(content)).toContain("看看这个");
    expect(contentDisplayText(content)).toContain("[附带 2 张图片]");
    expect(contentCharSize(content)).toBeGreaterThan("看看这个".length);
  });

  it("isVisionUnsupportedError detects common API errors", () => {
    expect(isVisionUnsupportedError("Model does not support image input")).toBe(true);
    expect(isVisionUnsupportedError("HTTP 500 internal error")).toBe(false);
  });

  it("detects UI positioning bug prompts", () => {
    expect(isUiPositioningBugPrompt("看到没，引用按钮跑别的地方了？")).toBe(true);
    expect(isUiPositioningBugPrompt("这个函数是干什么的？")).toBe(false);
  });

  it("buildVisionTaskText adds floating control hint for positioning bugs", () => {
    const text = buildVisionTaskText("看到没，引用按钮跑别的地方了？", 1);
    expect(text).toContain("浮动/绝对定位控件");
    expect(text).toContain("position:fixed");
  });

  it("suggestsEmbeddedLayoutMisread when selection and button are spatially separated", () => {
    const vision =
      "顶部蓝色选区… 最底部状态栏有「引用」按钮与 token 挤在同一行，属于 flex 布局问题，组件 ChatPanel.vue [图已理解]";
    expect(suggestsEmbeddedLayoutMisread(vision)).toBe(true);
  });

  it("suggestsEmbeddedLayoutMisread when flex blame lacks overlay mechanism", () => {
    const vision =
      "底部状态栏左侧出现「引用」按钮，chat-action-row 添加 position: relative，flex 布局导致错位 [图已理解]";
    expect(suggestsEmbeddedLayoutMisread(vision)).toBe(true);
  });

  it("buildVisionBuildContinueHint injects grep correction after misread", () => {
    const vision =
      "选区在上方… 底部状态栏「引用」按钮… chat-bottom flex 布局 [图已理解]";
    const hint = buildVisionBuildContinueHint(vision, "引用按钮跑别的地方了");
    expect(hint).toContain("*-floating");
    expect(hint).toContain("进度");
    expect(hint).toContain("截图 UI 定位·通用");
  });

  it("extractVisibleAnchorQuotes pulls quoted strings from vision text", () => {
    const vision =
      "列表含「多会话同时进行，好实现吗？」与「今天·14条」元信息 [图已理解]";
    expect(extractVisibleAnchorQuotes(vision)).toEqual([
      "多会话同时进行，好实现吗？",
      "今天·14条",
    ]);
  });

  it("buildVisionUiLocateHint stays generic without project paths", () => {
    const hint = buildVisionUiLocateHint(["示例标题", "今天·3条"]);
    expect(hint).toContain("截图 UI 定位·通用");
    expect(hint).toContain("grep");
    expect(hint).toContain("item-meta");
    expect(hint).not.toMatch(/VibeCodingView|FilePanel|src\/views/);
  });

  it("buildVisionTaskText treats short 优化UI with image as scoped implement", () => {
    const text = buildVisionTaskText("优化UI", 1);
    expect(text).toContain("附图为本消息重点");
    expect(text).toContain("实施时");
    expect(text).toContain("grep");
    expect(text).not.toMatch(/src\/views|VibeCoding/);
  });

  it("buildVisionTaskText adds control inner proportion hint for UI feedback with images", () => {
    const text = buildVisionTaskText("你看效果", 1);
    expect(text).toContain("控件内外比例");
    expect(text).toContain("内外比例失衡");
    expect(text).toContain("svg width/height");
  });

  it("buildVisionFirstTurnRule requires inner/outer proportion for composite controls", () => {
    const text = buildVisionTaskText("这段报错什么意思", 1);
    expect(text).toContain("内外比例失衡");
  });

  it("mentionsControlProportionImbalance detects proportion language in vision text", () => {
    expect(
      mentionsControlProportionImbalance(
        "外框偏大而内层图标明显偏小，内外比例失衡 [图已理解]",
      ),
    ).toBe(true);
    expect(mentionsControlProportionImbalance("截图中有蓝色圆形按钮 [图已理解]")).toBe(false);
  });

  it("buildVisionBuildContinueHint nudges dual-layer patch when proportion imbalance noted", () => {
    const vision =
      "圆形按钮外框占满画面，内层箭头图标相对外框偏小，内外比例失衡 [图已理解]";
    const hint = buildVisionBuildContinueHint(vision, "你看效果");
    expect(hint).toContain("内外比例问题");
    expect(hint).toContain("SVG");
  });

  it("buildControlInnerProportionHint stays generic without feature names", () => {
    const hint = buildControlInnerProportionHint();
    expect(hint).toContain("stroke-width");
    expect(hint).not.toMatch(/ChatPanel|scroll-to-bottom|回到最新/);
  });

  it("detects visible shell with empty inner content from vision text", () => {
    const vision = "深色圆底按钮容器可见，但箭头图标不可见 [图已理解]";
    expect(suggestsVisibleShellEmptyInner(vision)).toBe(true);
    expect(suggestsVisibleShellEmptyInner("深灰色圆角矩形无明显内容，像空的 toggle")).toBe(true);
    expect(buildVisionBuildContinueHint(vision, "优化按钮")).toContain("padding:0");
    expect(buildVisibleShellEmptyInnerHint()).not.toMatch(/scroll-to-bottom|回到最新/);
  });

  it("isUnreconciledEmptyShellAnswer blocks numeric claims without reconcile", () => {
    const vision = "会话右侧深灰圆角矩形，无明显文字，像空 toggle";
    const bad =
      "根据代码，灰色块是 git-badge，用于显示会话数量 sessionCount。";
    const good =
      "灰色块是 git-badge；数字由 sessionCount 绑定，但 shimmer 透明文字在截图里可能看不清，且 v-if 为 0 时不渲染。";
    expect(isUnreconciledEmptyShellAnswer(vision, bad)).toBe(true);
    expect(isUnreconciledEmptyShellAnswer(vision, good)).toBe(false);
  });

  it("shouldBypassVisionFirstTurn for displayed-what prompts", () => {
    expect(
      shouldBypassVisionFirstTurn({
        imageCount: 1,
        consultativeVisionRun: true,
        prompt: "会话这里，显示的啥",
      }),
    ).toBe(true);
  });
});
