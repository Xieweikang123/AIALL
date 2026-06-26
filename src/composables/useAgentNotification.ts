import { debugLog } from "../utils/debugLog";

const isTauriEnv = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

async function tryTauriNotification(title: string, body: string): Promise<boolean> {
  if (!isTauriEnv) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("send_notification", { title, body });
    return true;
  } catch (e) {
    debugLog(`tryTauriNotification failed: ${e}`);
    return false;
  }
}

export function useAgentNotification(getSessionTitle: (sessionId: string) => string) {
  function sendAgentCompleteNotification(sessionName: string) {
    const title = "AIALL · Agent 回复完毕";
    const body = sessionName ? `「${sessionName}」已完成，点击查看` : "Agent 已完成，可以查看结果";
    tryTauriNotification(title, body);
  }

  function notifyAgentDoneIfNeeded(sessionId: string) {
    const name = getSessionTitle(sessionId) || sessionId;
    sendAgentCompleteNotification(name);
  }

  async function testNotification() {
    await tryTauriNotification("AIALL · 通知测试", "系统通知正常工作 ✅");
  }

  return { notifyAgentDoneIfNeeded, testNotification };
}
