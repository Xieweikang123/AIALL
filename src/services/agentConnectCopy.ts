import { isTauriEnv } from "./tauriInvoke";

export type AgentConnectRuntime = "tauri" | "web";

export function resolveAgentConnectRuntime(): AgentConnectRuntime {
  return isTauriEnv() ? "tauri" : "web";
}

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
  return "无法连接 agent-server。请确认已启动 agent-server（start-web.bat）且网络可达，然后重试。";
}

/** Live status while establishing Agent transport. */
export function agentConnectingStatusText(
  runtime: AgentConnectRuntime = resolveAgentConnectRuntime(),
): string {
  if (runtime === "tauri") {
    return "正在启动 Agent…";
  }
  return "正在连接 agent-server…";
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
  return "连接 agent-server 超时。请确认 agent-server 已启动且网络可达，然后重试。";
}

/** JSON parse failure when backend returns HTML (legacy web dev). */
export function backendJsonParseErrorMessage(
  runtime: AgentConnectRuntime = resolveAgentConnectRuntime(),
): string {
  if (runtime === "tauri") {
    return "后端返回 HTML 而非 JSON，请重启应用后重试。";
  }
  return "agent-server 返回了非预期内容（可能返回 HTML 而非 JSON）。请确认 agent-server 已正确启动，然后重试。";
}
