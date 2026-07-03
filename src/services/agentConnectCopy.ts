import { isTauriEnv, WEB_REQUIRES_TAURI_MESSAGE } from "./tauriInvoke";

export type AgentConnectRuntime = "tauri" | "web";

export function resolveAgentConnectRuntime(): AgentConnectRuntime {
  return isTauriEnv() ? "tauri" : "web";
}

const webDesktopOnlyMessage = WEB_REQUIRES_TAURI_MESSAGE;

/** User-facing hint when Agent connect stalls. */
export function agentConnectStallMessage(
  hasImages = false,
  runtime: AgentConnectRuntime = resolveAgentConnectRuntime(),
): string {
  if (runtime === "tauri") {
    if (hasImages) {
      return "连接 Agent 超时（可能因图片过大）。请缩小截图后重试，或重启应用。";
    }
    return "无法连接 Agent。请重启应用后重试。";
  }
  void hasImages;
  return webDesktopOnlyMessage;
}

/** Live status while establishing Agent transport. */
export function agentConnectingStatusText(
  runtime: AgentConnectRuntime = resolveAgentConnectRuntime(),
): string {
  if (runtime === "tauri") {
    return "正在启动 Agent…";
  }
  return "请使用 Tauri 桌面版（npm run dev）";
}

/** Timeout error when Agent transport aborts during connect. */
export function agentConnectTimeoutErrorMessage(
  hasImages = false,
  runtime: AgentConnectRuntime = resolveAgentConnectRuntime(),
): string {
  if (runtime === "tauri") {
    return agentConnectStallMessage(hasImages, "tauri");
  }
  void hasImages;
  return webDesktopOnlyMessage;
}

/** JSON parse failure when backend returns HTML (legacy web dev). */
export function backendJsonParseErrorMessage(
  runtime: AgentConnectRuntime = resolveAgentConnectRuntime(),
): string {
  if (runtime === "tauri") {
    return "后端返回 HTML 而非 JSON，请重启应用后重试。";
  }
  return webDesktopOnlyMessage;
}
