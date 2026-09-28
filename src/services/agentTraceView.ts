/**
 * 数据流轨迹的**显示配置**（纯函数层，无 Vue 依赖）。
 *
 * 为什么不再用「详细度档位」：一个档位同时管 4 件正交的事（谁默认展开 / 正文截多长 /
 * 瞬态阶段显不显示 / 折叠行预览多长），而 4 个档位又是**链式**的（高档展开的类型集合
 * 必须是低档的超集）—— 于是「工具展开但请求折叠」「只截断不展开」这类组合根本选不到，
 * 用户点一档下去同时改了好几件事也不知道改了什么。这里拆成正交开关：
 *
 *   - `expand[kind]`     每个条目类型是否默认展开（5 个开关互不影响）
 *   - `bodyLength`       展开正文的截断档（同时决定折叠行预览长度）
 *   - `transientPhases`  已回复轮次里的瞬态 loop 阶段（噪音开关）
 *
 * 老档位（brief/standard/detailed/full）不删 —— 降级成一键快捷预设，见
 * `AGENT_TRACE_VIEW_PRESETS`，肌肉记忆与各档数值都保持原样。
 *
 * 关键约定（沿用旧档位模型，不能破）：配置**不决定条目存不存在**，只决定展开到多少。
 * 唯一例外是 `transientPhases`：那是噪音开关（见 `agentTraceTimeline.phaseEntries`）。
 */

/** 条目类型（与 agentTraceTimeline 的 kind 一致）。 */
export type AgentTraceEntryKind = "request" | "response" | "reasoning" | "tool" | "phase";

export const AGENT_TRACE_ENTRY_KINDS: readonly AgentTraceEntryKind[] = [
  "reasoning",
  "tool",
  "request",
  "response",
  "phase",
];

/** 展开正文的截断档。 */
export type AgentTraceBodyLength = "short" | "long" | "full";

export type AgentTraceExpandFlags = Record<AgentTraceEntryKind, boolean>;

export type AgentTraceViewConfig = {
  /** 各类条目正文是否默认展开 */
  expand: AgentTraceExpandFlags;
  /** 展开正文的截断档 */
  bodyLength: AgentTraceBodyLength;
  /** 是否显示已回复轮次里的瞬态 loop 阶段（不是"存不存在"，是噪音开关） */
  transientPhases: boolean;
  /**
   * Agent 跑起来时是否自动把整个轨迹面板放大占满工作区。
   *
   * 与 `expand.reasoning` 配套：思考默认展开，但被 220px 的正文框压着；打开这项后
   * 面板会在运行时铺满工作区，思考正文跟着全宽、能完整观看（不截断仍受 `bodyLength` 管）。
   * 关掉只影响「自动」，头部的手动放大按钮照旧可用。
   */
  autoMaximize: boolean;
  /**
   * Agent 思考中时，是否让「思考过程」正文撑满整个「数据流轨迹」窗口。
   *
   * 与 `autoMaximize` 正交：`autoMaximize` 是把整个抽屉放大盖住工作区，
   * 这一项不动抽屉尺寸，只让轨迹窗口**内部**的思考正文铺满可用高度
   * （其余条目让位，跑完恢复常规高度）。关掉只影响运行中的自动撑满。
   */
  fillThinking: boolean;
};

/**
 * 默认配置 = 旧「标准」档，一字不差。
 * 升级后默认体验不变：思考默认展开、其余折叠、正文 20K 截断、不显示瞬态阶段。
 */
export const DEFAULT_AGENT_TRACE_VIEW: Readonly<AgentTraceViewConfig> = Object.freeze({
  expand: Object.freeze({
    request: false,
    response: false,
    reasoning: true,
    tool: false,
    phase: false,
  }) as AgentTraceExpandFlags,
  bodyLength: "long",
  transientPhases: false,
  autoMaximize: false,
  fillThinking: false,
});

export interface AgentTraceBodySpec {
  /** 面板上的档位名 */
  label: string;
  /** 悬停说明 */
  hint: string;
  /** 展开后正文的最大字符数；null = 不截断 */
  maxDetailChars: number | null;
  /** 折叠态（未展开）正文的预览长度 */
  previewChars: number;
}

// 数值沿用旧档位：简略 400/60、标准 20K/120、全量 不截断/160
const BODY_SPECS: Record<AgentTraceBodyLength, AgentTraceBodySpec> = {
  short: { label: "短", hint: "只看开头一小段（400 字符）", maxDetailChars: 400, previewChars: 60 },
  long: { label: "长", hint: "展开正文最多 2 万字符", maxDetailChars: 20_000, previewChars: 120 },
  full: { label: "不截断", hint: "展开正文完整显示", maxDetailChars: null, previewChars: 160 },
};

export const AGENT_TRACE_BODY_LENGTHS: readonly AgentTraceBodyLength[] = ["short", "long", "full"];

export function normalizeAgentTraceBodyLength(value: unknown): AgentTraceBodyLength {
  return AGENT_TRACE_BODY_LENGTHS.includes(value as AgentTraceBodyLength)
    ? (value as AgentTraceBodyLength)
    : DEFAULT_AGENT_TRACE_VIEW.bodyLength;
}

export function resolveAgentTraceBodySpec(bodyLength: unknown): AgentTraceBodySpec {
  return BODY_SPECS[normalizeAgentTraceBodyLength(bodyLength)];
}

/* ------------------------------ 快捷预设 ------------------------------ */

/** 旧「详细度档位」降级成一键预设：id 与旧值同名，展开集合 / 数值都照搬。 */
export type AgentTraceViewPreset = "brief" | "standard" | "detailed" | "full";

export interface AgentTraceViewPresetSpec {
  id: AgentTraceViewPreset;
  label: string;
  hint: string;
  config: AgentTraceViewConfig;
}

export const AGENT_TRACE_VIEW_PRESETS: readonly AgentTraceViewPresetSpec[] = [
  {
    id: "brief",
    label: "简略",
    hint: "全部折叠成一行，只看每轮做了什么",
    config: {
      expand: { request: false, response: false, reasoning: false, tool: false, phase: false },
      bodyLength: "short",
      transientPhases: false,
      autoMaximize: false,
      fillThinking: false,
    },
  },
  {
    id: "standard",
    label: "标准",
    hint: "只展开思考过程（可实时看推理），其余折叠成一行",
    config: { ...DEFAULT_AGENT_TRACE_VIEW, expand: { ...DEFAULT_AGENT_TRACE_VIEW.expand } },
  },
  {
    id: "detailed",
    label: "详细",
    hint: "展开思考与工具结果，保留瞬态阶段",
    config: {
      expand: { request: false, response: false, reasoning: true, tool: true, phase: false },
      bodyLength: "long",
      transientPhases: true,
      autoMaximize: false,
      fillThinking: false,
    },
  },
  {
    id: "full",
    label: "全量",
    hint: "全部展开，正文不截断",
    config: {
      expand: { request: true, response: true, reasoning: true, tool: true, phase: true },
      bodyLength: "full",
      transientPhases: true,
      autoMaximize: false,
      fillThinking: false,
    },
  },
];

export function findAgentTraceViewPreset(id: unknown): AgentTraceViewPresetSpec | undefined {
  return AGENT_TRACE_VIEW_PRESETS.find((preset) => preset.id === id);
}

export function applyAgentTraceViewPreset(id: AgentTraceViewPreset): AgentTraceViewConfig {
  return normalizeAgentTraceView(findAgentTraceViewPreset(id)?.config);
}

/* ------------------------------ 归一化 ------------------------------ */

/**
 * 任意脏值 → 合法配置（永远返回**新对象**，别把默认值的引用交出去被改脏）。
 *
 * 三种输入都要接住：
 *   1. 旧档位字符串（"standard"）—— 直接映射到同名预设
 *   2. 部分字段的对象 —— 缺的用默认值补
 *   3. 非法值 / null / undefined —— 整体回落默认值，避免脏存档把面板清空
 */
export function normalizeAgentTraceView(value: unknown): AgentTraceViewConfig {
  if (typeof value === "string") {
    return findAgentTraceViewPreset(value)
      ? applyAgentTraceViewPreset(value as AgentTraceViewPreset)
      : createDefaultAgentTraceView();
  }
  if (!value || typeof value !== "object") return createDefaultAgentTraceView();

  const raw = value as Partial<AgentTraceViewConfig> & { detail?: unknown };
  // 旧存档形状：{ detail: "detailed", ... } —— 认这个键，别静默回落默认值
  if (raw.detail !== undefined) return applyAgentTraceViewPreset(raw.detail as AgentTraceViewPreset);

  const rawExpand = (raw.expand ?? {}) as Partial<AgentTraceExpandFlags>;
  /**
   * 展开开关的取值规则：**只认显式 true**，其余（缺失 / 脏值）都回落该类型的默认值。
   * 不能一律当 false —— 默认档里 reasoning 是 true，一份残缺存档会把思考折叠掉，
   * 表现为"打开面板看不到思考过程"。
   */
  const flag = (kind: AgentTraceEntryKind): boolean =>
    rawExpand[kind] === undefined ? DEFAULT_AGENT_TRACE_VIEW.expand[kind] : rawExpand[kind] === true;

  return {
    expand: {
      request: flag("request"),
      response: flag("response"),
      reasoning: flag("reasoning"),
      tool: flag("tool"),
      phase: flag("phase"),
    },
    bodyLength: normalizeAgentTraceBodyLength(raw.bodyLength),
    transientPhases: raw.transientPhases === true,
    autoMaximize: raw.autoMaximize === true,
    fillThinking: raw.fillThinking === true,
  };
}

export function createDefaultAgentTraceView(): AgentTraceViewConfig {
  return {
    expand: { ...DEFAULT_AGENT_TRACE_VIEW.expand },
    bodyLength: DEFAULT_AGENT_TRACE_VIEW.bodyLength,
    transientPhases: DEFAULT_AGENT_TRACE_VIEW.transientPhases,
    autoMaximize: DEFAULT_AGENT_TRACE_VIEW.autoMaximize,
    fillThinking: DEFAULT_AGENT_TRACE_VIEW.fillThinking,
  };
}

/** 开关一个条目类型的「默认展开」，其余配置原样保留（返回新对象）。 */
export function withTraceExpand(
  view: AgentTraceViewConfig,
  kind: AgentTraceEntryKind,
  expanded: boolean,
): AgentTraceViewConfig {
  return {
    ...view,
    expand: { ...view.expand, [kind]: expanded },
  };
}

export function withTraceBodyLength(
  view: AgentTraceViewConfig,
  bodyLength: AgentTraceBodyLength,
): AgentTraceViewConfig {
  return { ...view, bodyLength: normalizeAgentTraceBodyLength(bodyLength) };
}

export function withTraceTransientPhases(
  view: AgentTraceViewConfig,
  transientPhases: boolean,
): AgentTraceViewConfig {
  return { ...view, transientPhases };
}

/** 开关「运行时自动放大面板」，其余配置原样保留（返回新对象）。 */
export function withTraceAutoMaximize(
  view: AgentTraceViewConfig,
  autoMaximize: boolean,
): AgentTraceViewConfig {
  return { ...view, autoMaximize: autoMaximize === true };
}

/** 开关「思考中撑满轨迹窗口」，其余配置原样保留（返回新对象）。 */
export function withTraceFillThinking(
  view: AgentTraceViewConfig,
  fillThinking: boolean,
): AgentTraceViewConfig {
  return { ...view, fillThinking: fillThinking === true };
}

/* ------------------------------ 查询 ------------------------------ */

/** 该类型的条目在当前配置下是否默认展开。 */
export function shouldExpandTraceKind(
  kind: AgentTraceEntryKind,
  view: AgentTraceViewConfig = DEFAULT_AGENT_TRACE_VIEW,
): boolean {
  return view.expand[kind] === true;
}

/**
 * 截断标记的正则。**必须**与 `truncateTraceDetail` 产出的文案同步
 * （改一处别忘另一处；`agentTraceView.test.ts` 里有对照断言）。
 * 前导换行写可选：真实正文里一定有，但单独一段标记也要能认出来。
 */
export const AGENT_TRACE_TRUNCATION_RE = /\n?…（已截断，共 \d+ 字符）\s*$/;

/** 按配置截断正文；「不截断」档原样返回。 */
export function truncateTraceDetail(
  text: string,
  view: AgentTraceViewConfig = DEFAULT_AGENT_TRACE_VIEW,
): string {
  const spec = resolveAgentTraceBodySpec(view.bodyLength);
  const trimmed = text.trim();
  if (spec.maxDetailChars === null) return trimmed;
  if (trimmed.length <= spec.maxDetailChars) return trimmed;
  return `${trimmed.slice(0, spec.maxDetailChars)}\n…（已截断，共 ${trimmed.length} 字符）`;
}

/**
 * 轨迹里「思考」条目的正文在喂给 Markdown 渲染器前，先做两步整理（纯函数，可测）。
 *
 * 思考正文现在走 ChatMarkdown 渲染（与聊天气泡内过程 feed 的思考保持一致），
 * 但轨迹正文可能被档位截断（`truncateTraceDetail`）。截断会把未闭合的代码围栏
 * 切断 —— 直接喂 Markdown，marked 会把围栏之后的全部内容当代码块吞掉，整块裂开。
 *
 *   1. `…（已截断，共 N 字符）` 是给人看纯文本的提示，对 Markdown 是噪音 → 去掉；
 *   2. 去掉后若代码围栏数为**奇数**（截断点落在围栏内）→ 补一个结束围栏。
 *
 * 只在**确有截断标记**时才动围栏：完整思考里模型自己写了未闭合围栏，交给
 * ChatMarkdown 的流式兜底（`stabilizeIncompleteFencedCodeBlock`）处理，
 * 这里再补一个反而可能改变其语义。
 */
export function prepareTraceReasoningMarkdown(detail: string): string {
  const source = String(detail ?? "").trim();
  if (!source) return "";
  if (!AGENT_TRACE_TRUNCATION_RE.test(source)) return source;
  const body = source.replace(AGENT_TRACE_TRUNCATION_RE, "").trimEnd();
  if (!body) return "";
  const fences = body.match(/^```/gm);
  if (fences && fences.length % 2 === 1) {
    return `${body}\n\`\`\``;
  }
  return body;
}

/** 折叠行的单行预览。 */
export function collapseTracePreview(
  text: string,
  view: AgentTraceViewConfig = DEFAULT_AGENT_TRACE_VIEW,
): string {
  const spec = resolveAgentTraceBodySpec(view.bodyLength);
  return text.replace(/\s+/g, " ").trim().slice(0, spec.previewChars);
}

/* ------------------------------ UI 元数据 ------------------------------ */

/**
 * 条目类型的展示元数据。面板里的行标签（思/具/发/回/态）与配置条上的开关 chip
 * 共用同一份 —— 两处各写一遍会漂（chip 显示的字和行上的字对不上）。
 */
export const AGENT_TRACE_KIND_UI: Record<
  AgentTraceEntryKind,
  { label: string; title: string; chipTitle: string }
> = {
  reasoning: {
    label: "思",
    title: "思考过程（模型的推理通道）",
    chipTitle: "思考过程是否默认展开",
  },
  tool: { label: "具", title: "工具调用", chipTitle: "工具调用是否默认展开" },
  request: { label: "发", title: "请求（发给模型的每条消息，含系统提示词）", chipTitle: "发给模型的请求是否默认展开" },
  response: { label: "回", title: "回复（模型返回）", chipTitle: "模型回复是否默认展开" },
  phase: { label: "态", title: "阶段状态", chipTitle: "阶段状态是否默认展开" },
};
