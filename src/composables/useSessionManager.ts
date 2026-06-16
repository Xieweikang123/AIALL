import { computed, ref } from "vue";
import {
  formatSessionTitle,
  clearVibeChatHistory,
  deleteVibeChatSession,
  getActiveVibeChatSessionId,
  listVibeChatSessions,
  switchVibeChatSession,
  type VibeChatSessionMeta,
} from "../services/vibeChatStorage";

export function useSessionManager(projectPath: () => string) {
  const sessionPickerOpen = ref(false);
  const activeSessionId = ref("");
  const sessionList = ref<VibeChatSessionMeta[]>([]);

  const activeSessionTitle = computed(() => {
    const fromList = sessionList.value.find((s) => s.id === activeSessionId.value)?.title;
    if (fromList) return fromList;
    return "";
  });

  const activeSessionIndex = computed(() => {
    if (!activeSessionId.value) return -1;
    return sessionList.value.findIndex((s) => s.id === activeSessionId.value);
  });

  const canSwitchToNewerSession = computed(() => activeSessionIndex.value > 0);

  const canSwitchToOlderSession = computed(() => {
    const idx = activeSessionIndex.value;
    if (idx < 0) return sessionList.value.length > 0;
    return idx < sessionList.value.length - 1;
  });

  const sessionPickerTitle = computed(() => {
    if (!projectPath()) return "请先打开项目";
    if (sessionList.value.length) return "点击切换会话";
    return "点击新建或查看会话";
  });

  function refreshSessionList(path?: string) {
    const p = path ?? projectPath();
    if (!p) {
      sessionList.value = [];
      activeSessionId.value = "";
      return;
    }
    sessionList.value = listVibeChatSessions(p);
    activeSessionId.value = getActiveVibeChatSessionId(p);
  }

  function toggleSessionPicker(chatSending: boolean) {
    if (!projectPath() || chatSending) return;
    sessionPickerOpen.value = !sessionPickerOpen.value;
    if (sessionPickerOpen.value) refreshSessionList();
  }

  function closeSessionPicker() {
    sessionPickerOpen.value = false;
  }

  function switchToAdjacentSession(delta: number, chatSending: boolean) {
    if (chatSending || !projectPath() || !sessionList.value.length) return;
    let nextIdx = activeSessionIndex.value + delta;
    if (activeSessionIndex.value < 0 && delta > 0) nextIdx = 0;
    if (nextIdx < 0 || nextIdx >= sessionList.value.length) return;
    return sessionList.value[nextIdx]?.id;
  }

  function removeSession(sessionId: string, chatSending: boolean) {
    if (chatSending || !projectPath()) return;
    return deleteVibeChatSession(projectPath(), sessionId);
  }

  function sessionLocalFileName(sessionId: string): string {
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return `chat-${safe}.json`;
  }

  function formatSessionInfoForCopy(session: VibeChatSessionMeta, project: string): string {
    const chatDir = "aiall/vibe-chat-sessions";
    const relFile = `${chatDir}/${sessionLocalFileName(session.id)}`;
    const storeFile = `${chatDir}/chat-store.json`;
    const lines = [
      "【任务】请自行排查以下 AIALL Vibe 本地会话记录是否存在异常（存储、索引、展示、Agent 行为等均可）。不要回答会话消息里的业务或编程问题。",
      "",
      "【相关文件】",
      `- 会话文件：${relFile}`,
      `- 索引文件：${storeFile}`,
      "",
      "【会话定位】",
      `- 标题: ${session.title}`,
      `- 项目: ${project}`,
      `- 会话 ID: ${session.id}`,
      `- 本地文件: ${relFile}`,
      `- 索引目录: ${chatDir}/`,
      `- 创建: ${session.createdAt}`,
      `- 更新: ${session.updatedAt}`,
      `- 消息数: ${session.messageCount}`,
    ];
    if (session.id === activeSessionId.value) {
      lines.push("- 状态: 当前活跃会话");
    }
    return lines.join("\n");
  }

  return {
    sessionPickerOpen,
    activeSessionId,
    sessionList,
    activeSessionTitle,
    activeSessionIndex,
    canSwitchToNewerSession,
    canSwitchToOlderSession,
    sessionPickerTitle,
    refreshSessionList,
    toggleSessionPicker,
    closeSessionPicker,
    switchToAdjacentSession,
    removeSession,
    sessionLocalFileName,
    formatSessionInfoForCopy,
  };
}
