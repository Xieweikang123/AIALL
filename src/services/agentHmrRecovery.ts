/**
 * Agent 页面刷新/HMR 恢复 — 在 Vite full reload 或浏览器刷新前持久化 Agent 运行状态，
 * 重载后自动从断点恢复中断的 Agent 运行。
 */

import { lsGet, lsSetJson, lsRemove } from "../utils/localStorageSafe";

const STORAGE_KEY = "vibe-agent-hmr-pending";
const STALE_MS = 5 * 60 * 1000; // 5 分钟过期

export type PendingAgentRun = {
  /** 原始请求参数 */
  request: Record<string, unknown>;
  /** 项目路径 */
  projectPath: string;
  /** 持久化时间戳（写入时自动填充） */
  savedAt?: number;
  /** 会话 ID */
  sessionId?: string;
  /** 原 assistant 消息 ID —— 恢复时复用同一气泡，避免新建空壳 */
  assistantMsgId?: string;
};

/** 持久化当前 Agent 运行状态 */
export function persistAgentRunForHmr(run: PendingAgentRun): void {
  run.savedAt = Date.now();
  lsSetJson(STORAGE_KEY, run);
}

/** 读取待恢复的 Agent 运行（如果存在且未过期） */
export function popPendingAgentRun(): PendingAgentRun | null {
  const raw = lsGet(STORAGE_KEY);
  if (!raw) return null;
  lsRemove(STORAGE_KEY);
  try {
    const parsed = JSON.parse(raw) as PendingAgentRun;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.request || !parsed.projectPath) return null;
    if (Date.now() - (parsed.savedAt || 0) > STALE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 清除待恢复状态 */
export function clearPendingAgentRun(): void {
  lsRemove(STORAGE_KEY);
}

/**
 * 读取待恢复状态但不消费。
 *
 * 与 `popPendingAgentRun` 的区别：**保留** `vibe-agent-hmr-pending`。恢复时先 peek 校验
 * 会话归属，确认属于当前会话后再 pop 消费——否则「读出来发现是别的会话→丢弃」会把那条
 * 记录当场销毁，真正切回目标会话时就没得恢复了。
 */
export function peekPendingAgentRun(): PendingAgentRun | null {
  const raw = lsGet(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingAgentRun;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.request || !parsed.projectPath) return null;
    if (Date.now() - (parsed.savedAt || 0) > STALE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 待恢复的 Agent 运行是否属于当前激活会话。
 *
 * `pendingSessionId` 为旧记录（写入时尚未跟踪会话归属）时返回 true —— 无从判定，
 * 保持兼容、不误伤。一旦存在且不等于当前激活会话，说明该运行属于**别的会话**：重挂
 * 时绝不能把它注入当前会话（否则会话 A 的任务会跑到会话 B，即「别的会话串进来」）。
 */
export function pendingRunBelongsToSession(
  pendingSessionId: string | undefined,
  activeSessionId: string,
): boolean {
  const pending = (pendingSessionId ?? "").trim();
  if (!pending) return true;
  return pending === (activeSessionId ?? "").trim();
}

/**
 * 注册 Vite HMR 重载监听器。
 * 当 Vite 即将执行 full reload 时，调用 onSave 回调持久化当前运行状态。
 * 仅在开发模式下生效。
 */
export function registerHmrPreReloadHook(
  onSave: () => void,
): void {
  if (!import.meta.hot) return;
  // vite:beforeFullReload 在页面即将 full reload 时触发
  import.meta.hot.on("vite:beforeFullReload", () => {
    try {
      onSave();
    } catch {
      // ignore
    }
  });
}
