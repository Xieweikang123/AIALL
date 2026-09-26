/**
 * 数据流轨迹的「详细度」= **展开程度**（纯函数层，无 Vue 依赖）。
 *
 * 关键约定：档位**不决定条目存不存在**，只决定同一条目"展开到多少"。
 * 切档时条目集合保持一致（轮次、工具、思考都在），差别在于：
 *
 *   - 哪些类型的条目正文默认展开
 *   - 展开后正文截多长
 *   - 阶段状态（瞬态 loop 噪音）要不要显示
 *
 * 这样用户切档不会"东西突然没了"，只是展开程度变化 —— 符合"详细度调节"的直觉。
 */

export type AgentTraceDetailLevel = "brief" | "standard" | "detailed" | "full";

export const AGENT_TRACE_DETAIL_LEVELS: AgentTraceDetailLevel[] = [
  "brief",
  "standard",
  "detailed",
  "full",
];

export const DEFAULT_AGENT_TRACE_DETAIL: AgentTraceDetailLevel = "standard";

/** 条目类型（与 agentTraceTimeline 的 kind 一致）。 */
export type AgentTraceEntryKind = "request" | "response" | "reasoning" | "tool" | "phase";

export interface AgentTraceDetailSpec {
  /** 面板上的档位名 */
  label: string;
  /** 悬停说明：这一档展开到什么程度 */
  hint: string;
  /**
   * 默认展开正文的条目类型。
   * 不在集合里的类型仍是点击展开的细节（折叠成一行）。
   */
  expandedKinds: ReadonlySet<AgentTraceEntryKind>;
  /** 展开后正文的最大字符数；null = 不截断 */
  maxDetailChars: number | null;
  /** 是否显示瞬态 loop 阶段（compacting_context 之类）——不是"存不存在"，是噪音开关 */
  transientPhases: boolean;
  /** 折叠态（未展开）正文的预览长度，用于折叠行的 label */
  collapsedPreviewChars: number;
}

const REASONING_ONLY: ReadonlySet<AgentTraceEntryKind> = new Set(["reasoning"]);
const REASONING_TOOLS: ReadonlySet<AgentTraceEntryKind> = new Set(["reasoning", "tool"]);
const ALL_KINDS: ReadonlySet<AgentTraceEntryKind> = new Set([
  "request",
  "response",
  "reasoning",
  "tool",
  "phase",
]);

const SPECS: Record<AgentTraceDetailLevel, AgentTraceDetailSpec> = {
  brief: {
    label: "简略",
    hint: "全部折叠成一行，只看每轮做了什么",
    expandedKinds: new Set<AgentTraceEntryKind>(),
    maxDetailChars: 400,
    transientPhases: false,
    collapsedPreviewChars: 60,
  },
  standard: {
    label: "标准",
    hint: "思考默认展开（可实时看推理），其余折叠成一行",
    expandedKinds: REASONING_ONLY,
    maxDetailChars: 20_000,
    transientPhases: false,
    collapsedPreviewChars: 120,
  },
  detailed: {
    label: "详细",
    hint: "思考与工具结果默认展开，请求/回复仍折叠",
    expandedKinds: REASONING_TOOLS,
    maxDetailChars: 60_000,
    transientPhases: true,
    collapsedPreviewChars: 120,
  },
  full: {
    label: "全量",
    hint: "所有条目展开，正文不截断",
    expandedKinds: ALL_KINDS,
    maxDetailChars: null,
    transientPhases: true,
    collapsedPreviewChars: 160,
  },
};

/** 未知/非法档位一律回落到标准档，避免旧存档里的脏值把面板清空。 */
export function normalizeAgentTraceDetail(value: unknown): AgentTraceDetailLevel {
  return AGENT_TRACE_DETAIL_LEVELS.includes(value as AgentTraceDetailLevel)
    ? (value as AgentTraceDetailLevel)
    : DEFAULT_AGENT_TRACE_DETAIL;
}

export function resolveAgentTraceDetailSpec(level: AgentTraceDetailLevel): AgentTraceDetailSpec {
  return SPECS[normalizeAgentTraceDetail(level)];
}

/** 该类型的条目在当前档位下是否默认展开正文。 */
export function shouldExpandTraceKind(
  kind: AgentTraceEntryKind,
  level: AgentTraceDetailLevel,
): boolean {
  return resolveAgentTraceDetailSpec(level).expandedKinds.has(kind);
}

/** 按档位截断正文；全量档原样返回。 */
export function truncateTraceDetail(text: string, level: AgentTraceDetailLevel): string {
  const spec = resolveAgentTraceDetailSpec(level);
  const trimmed = text.trim();
  if (spec.maxDetailChars === null) return trimmed;
  if (trimmed.length <= spec.maxDetailChars) return trimmed;
  return `${trimmed.slice(0, spec.maxDetailChars)}\n…（已截断，共 ${trimmed.length} 字符）`;
}

/** 折叠行的单行预览。 */
export function collapseTracePreview(text: string, level: AgentTraceDetailLevel): string {
  const spec = resolveAgentTraceDetailSpec(level);
  return text.replace(/\s+/g, " ").trim().slice(0, spec.collapsedPreviewChars);
}
