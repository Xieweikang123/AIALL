import { lsGet, lsSet } from "./localStorageSafe";

/**
 * 底部用量栏「显示哪些信息」的全局偏好（localStorage 持久化）。
 *
 * 底部那行原本只放了一枚上下文占用圆环；这里让用户自选旁边再显示哪些指标
 * （输出速度 / 首字延迟 / 上下文百分比 / 累计输出 / 缓存命中率 / 工具 / 文件 / 轮次）。
 * 与「哪些指标当前可用」解耦：偏好只记 id，渲染时再按实际有数据的指标过滤。
 */
export const CHAT_STATUS_BAR_STORAGE_KEY = "vibe-chat-status-metrics";

export type ChatStatusMetricId =
  | "speed"
  | "ttft"
  | "context"
  | "output"
  | "cache"
  | "tools"
  | "files"
  | "turns";

/** 可配置指标全集（顺序即界面上「底部显示项」的排列顺序）。 */
export const CHAT_STATUS_METRICS: ReadonlyArray<{ id: ChatStatusMetricId; label: string }> = [
  { id: "speed", label: "输出速度" },
  { id: "ttft", label: "首字延迟" },
  { id: "context", label: "上下文占用" },
  { id: "output", label: "累计输出" },
  { id: "cache", label: "缓存命中率" },
  { id: "tools", label: "工具调用" },
  { id: "files", label: "写入文件" },
  { id: "turns", label: "Agent 轮次" },
];

const METRIC_IDS = new Set<string>(CHAT_STATUS_METRICS.map((m) => m.id));

/** 默认显示上下文占用百分比：圆环给视觉，数字给精度。 */
export const DEFAULT_CHAT_STATUS_METRICS: readonly ChatStatusMetricId[] = ["context"];

/** 把任意输入清洗成合法 id 列表（去重、丢未知项）。 */
export function sanitizeChatStatusMetrics(input: unknown): ChatStatusMetricId[] {
  if (!Array.isArray(input)) return [...DEFAULT_CHAT_STATUS_METRICS];
  const out: ChatStatusMetricId[] = [];
  for (const raw of input) {
    if (typeof raw !== "string" || !METRIC_IDS.has(raw)) continue;
    const id = raw as ChatStatusMetricId;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export function loadChatStatusMetrics(): ChatStatusMetricId[] {
  const raw = lsGet(CHAT_STATUS_BAR_STORAGE_KEY);
  if (raw === null) return [...DEFAULT_CHAT_STATUS_METRICS];
  try {
    return sanitizeChatStatusMetrics(JSON.parse(raw));
  } catch {
    return [...DEFAULT_CHAT_STATUS_METRICS];
  }
}

export function saveChatStatusMetrics(ids: readonly ChatStatusMetricId[]): void {
  lsSet(CHAT_STATUS_BAR_STORAGE_KEY, JSON.stringify(sanitizeChatStatusMetrics([...ids])));
}
