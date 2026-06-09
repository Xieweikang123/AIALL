/**
 * Agent HMR Recovery — 在 Vite HMR 触发页面重载前持久化 Agent 运行状态，
 * 重载后自动恢复中断的 Agent 运行。
 */

const STORAGE_KEY = "vibe-agent-hmr-pending";
const STALE_MS = 5 * 60 * 1000; // 5 分钟过期

export type PendingAgentRun = {
  /** 原始请求参数 */
  request: Record<string, unknown>;
  /** 项目路径 */
  projectPath: string;
  /** 持久化时间戳 */
  savedAt: number;
  /** 会话 ID */
  sessionId?: string;
};

/** 持久化当前 Agent 运行状态 */
export function persistAgentRunForHmr(run: PendingAgentRun): void {
  try {
    run.savedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(run));
  } catch {
    // localStorage 写入失败时静默忽略
  }
}

/** 读取待恢复的 Agent 运行（如果存在且未过期） */
export function popPendingAgentRun(): PendingAgentRun | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    localStorage.removeItem(STORAGE_KEY);
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
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
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
