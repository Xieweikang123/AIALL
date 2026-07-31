/**
 * Tier 3 — product user-intent hints injected into system / tool messages.
 * May reference AIALL modes (Ask/Build/Plan), screenshots, session audit paths.
 */
import type { ConfigBindingTopic } from "../generic/userIntentClassifiers";
import type { QuotedAmendIntent } from "../generic/quotedAmendIntent";

export function buildLocateStatusFollowUpHint(): string {
  return [
    "【定位进度追问】用户仅问上一轮是否已在代码中定位到目标。",
    "须直接引用上一条已给出的文件路径与样式/CSS 结论作答；禁止重复 grep/read 整文件。",
    "若上一条已给出路径与样式证据，回答「是的，已在 … 中找到」并复述关键一行即可。",
  ].join("\n");
}

export function buildBehaviorPurposeHint(): string {
  return [
    "",
    "【行为·用途/作用】用户问的是运行时用途或分支差异，不是再要枚举/字段定义列表。",
    "grep 符号后须 read 引用处（条件分支、调用关系或结果构造），说明满足何条件 → 得到什么结果；结果可以是返回值、异常、状态、事件或外部影响。",
    "禁止只复述枚举值；禁止「可能…作为标识」「具体使用位置需要查看」推给用户查。",
  ].join("\n");
}

export function buildBehaviorContradictionHint(): string {
  return [
    "",
    "【现象与上轮矛盾】用户反馈的实际现象与上一条助手结论不符，或在质疑上一条结论/设计是否合理。",
    "禁止维持上轮「不会/不更新/仅…/独立状态/不会有问题」等结论；须显式承认先前结论不完整或有误。",
    "从实际相关符号重新 trace 调用关系，grep 命中后必须 read 完整函数体、直接调用方/被调用方与决定结果的分支；不假设固定目录、层数或中间层。",
    "结论须附带代码中的 if/guard 前提；咨询只读时先给出更正后的根因，用户明确实施指令后再 patch。",
  ].join("\n");
}

export function buildConsultativeBuildHint(): string {
  return [
    "",
    "【咨询任务·只读】用户本条仅为提问/解释，未要求改代码。",
    "只允许 list_dir / read_file / grep / search_files；禁止 patch_file / write_file / delete_file。",
    "优先 grep 精确符号；「会不会/是否/做 X 时会不会 Y/准确吗」须沿实际调用关系追到直接调用方与直接决定结论的结果点，并核对相关分支与前提；禁止只读单个函数或根据目录名称猜测链路。",
    "准确度/输出质量类：须 read 到实际决定输出的数据、上下文或结果构造处，包括 middleware 等中间处理层，说明代码里真正注入或产生了什么；禁止用「如果 prompt 包含…」猜测。",
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
    "若原始问题为准确度/是否类且证据链尚未覆盖决定结果的代码：须继续 read 相关定义、直接调用方、调用关系、分支与结果构造（包括必要的 middleware）；禁止「基于已有信息直接回答」或反问用户要不要继续查。",
  ];
  if (behaviorPurpose) {
    lines.push(
      "原始问题为用途/作用类：须基于下方已 read 的分支、调用关系或结果构造作答（条件→结果），禁止重复枚举定义或写「可能需要查看引用」。",
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

export function buildQuotedAmendHint(resolved: QuotedAmendIntent): string {
  const scope = resolved.scopeHint ? `scope「${resolved.scopeHint}」` : "引用行所指 scope";
  const symbols =
    resolved.symbolHints.length > 0
      ? resolved.symbolHints.map((s) => `\`${s}\``).join("、")
      : "引用块中的目标符号";

  if (resolved.kind === "remove") {
    return [
      "",
      "【引用修订·删除】用户引用上一轮助手总结/代码块，短句是对引用内容的删除指令（不是新任务）。",
      `须从 ${scope} 删除 ${symbols} 对应配置/代码块；禁止删除 ${scope} 整段注册或服务块。`,
      "禁止在其它 scope 重新添加用户要求移除的符号；禁止把「也移除/不要这个」理解成删除整个 scope。",
      "patch 前 read 一次确认符号位置；完成后一句话说明已从哪段删除了哪些符号。",
    ].join("\n");
  }

  return [
    "",
    "【引用修订·添加】用户引用上一轮内容并要求补充添加。",
    `在 ${scope} 添加 ${symbols}；勿扩大至未引用的 scope。`,
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
    "【UI 缺陷·须修复】用户用截图反馈控件/布局/交互异常。",
    "须定位后 patch_file/write_file；禁止只分析并反问「要不要修」。",
    "诊断清单（按序核对，勿预设修法）：",
    "1. 读图：描述所见；判断是否本项目 UI（查 AGENTS.md / 已注入项目结构中的 UI 源码目录），勿默认外部 IDE。",
    "2. 定位：grep 图中可见原文最短片段（≥3 字）定位 template/组件，勿先猜 CSS class 或 SVG 路径。",
    "3. 范围：局部提问只改所指区域；用户明确「整页/全面板」时再扩大。",
    "4. 布局：控件与选区/焦点空间分离 → 查 fixed/absolute/portal 浮层；同容器拥挤 → 查 flex/overflow/gap/min-width。",
    "5. 交互：「点击没反应/不工作」→ 查事件 handler/绑定；注意 mouseup 与 getSelection 时序与异步回调。",
    "6. 样式：read 已定位组件 scoped `<style>`；chip/badge 查承载组件局部样式，勿臆断全局 theme。",
    "7. 可见性：外框有内层空 → 查 v-if/shimmer/显示条件与全局 element 选择器是否冲突 compact 尺寸。",
    "8. class 重命名：grep 旧名全部出现再一次性 patch，改完 grep 验证零残留。",
    "同一组件在连续消息中每条独立排查，勿因上一条修了布局假设本条同因。",
    "附截图时首轮描述后，后续轮禁止重复描述同一张截图。",
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
    "【解释已完成】若上文已回答用户「啥意思」，且仍在修浮层/定位类 UI 缺陷：",
    "下一轮禁止重复解释或再读已定位的浮层/锚点代码；直接 patch 已 read 的定位逻辑，或至多 1 次 read 后立即 patch。",
  ].join("");
}

const CONFIG_BINDING_TOPIC_LINES: Record<ConfigBindingTopic, string> = {
  reject:
    "用户否定当前字段/选项集合：禁止扩 scope；对照用户已展示项或类型定义收窄，显式更正前轮映射错误。",
  enumeration:
    "用户问可选值个数或列表：首句写「共 N 个：…」完整列表，再附代码；禁止以 patch 汇报开头漏答。",
  doc_lookup:
    "用户要求查官方定义：须 web_search + web_extract 后再改映射；回答含字段名与类型/枚举对照。",
};

export function buildConfigBindingTopicHint(topic: ConfigBindingTopic): string {
  return [
    "",
    "【外部配置·准确度】绑定外部库或内置组件配置字段时，须 read 类型定义或 web_extract 官方文档；禁止凭字段名相似猜测。",
    CONFIG_BINDING_TOPIC_LINES[topic],
  ].join("\n");
}

export function buildUserOptionMismatchHint(): string {
  return buildConfigBindingTopicHint("reject");
}

export function buildEnumerationAnswerFirstHint(): string {
  return buildConfigBindingTopicHint("enumeration");
}

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
