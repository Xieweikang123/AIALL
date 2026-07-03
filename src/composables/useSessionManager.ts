import { computed, ref } from "vue";
import {
  compactProjectSessionRecord,
  deleteVibeChatSession,
  listVibeChatSessions,
  VIBE_CHAT_SESSIONS_LOGICAL_DIR,
  vibeChatSessionDiskDir,
  vibeChatSessionDiskFilePath,
  vibeChatSessionLocalFileName,
  vibeChatSessionStoreDiskPath,
  type VibeChatSessionMeta,
} from "../services/vibeChatStorage";

export function useSessionManager(projectPath: () => string) {
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

  /** Read-only projection of persisted sessions. Does not mutate activeSessionId. */
  function refreshSessionList(path?: string) {
    const p = path ?? projectPath();
    if (!p) {
      sessionList.value = [];
      return;
    }
    compactProjectSessionRecord(p);
    sessionList.value = listVibeChatSessions(p);
  }

  function setActiveSession(sessionId: string) {
    activeSessionId.value = sessionId;
  }

  function resetSessionUi() {
    sessionList.value = [];
    activeSessionId.value = "";
  }

  function switchToAdjacentSession(delta: number) {
    if (!projectPath()) return;
    refreshSessionList();
    if (!sessionList.value.length) return;
    let nextIdx = activeSessionIndex.value + delta;
    if (activeSessionIndex.value < 0 && delta > 0) nextIdx = 0;
    if (nextIdx < 0 || nextIdx >= sessionList.value.length) return;
    return sessionList.value[nextIdx]?.id;
  }

  function removeSession(sessionId: string) {
    if (!projectPath()) return;
    return deleteVibeChatSession(projectPath(), sessionId);
  }

  function sessionLocalFileName(sessionId: string): string {
    return vibeChatSessionLocalFileName(sessionId);
  }

  function formatSessionInfoForCopy(session: VibeChatSessionMeta, project: string): string {
    const chatDir = VIBE_CHAT_SESSIONS_LOGICAL_DIR;
    const relFile = `${chatDir}/${sessionLocalFileName(session.id)}`;
    const storeFile = `${chatDir}/chat-store.json`;
    const diskFile = vibeChatSessionDiskFilePath(session.id);
    const diskStore = vibeChatSessionStoreDiskPath();
    const lines = [
      "【任务】请自行排查以下 AIALL Vibe 会话中 Agent 回复的准确度问题。不要回答会话消息里的业务或编程问题。重点关注：",
      "- 回复内容准确性：Agent 回答的问题对不对、有没有胡编",
      "- 工具调用准确性：搜的文件对不对、修改的内容合不合理",
      "- 上下文理解：是否理解了用户意图、是否遗漏关键信息",
      "- 回复结构与表达：回复是否清晰、有没有冗余重复",
      "",
      "【相关文件】",
      `- 会话文件（逻辑路径，不在项目根内）：${relFile}`,
      `- 索引文件（逻辑路径）：${storeFile}`,
      `- 会话文件（磁盘实际路径）：${diskFile}`,
      `- 索引文件（磁盘实际路径）：${diskStore}`,
      "- 说明：项目内文件用相对路径；上述磁盘路径可用 read_file 绝对路径 + offset/limit 读取",
      "",
      "【会话定位】",
      `- 标题: ${session.title}`,
      `- 项目: ${project}`,
      `- 会话 ID: ${session.id}`,
      `- 本地文件: ${diskFile}`,
      `- 索引目录: ${vibeChatSessionDiskDir()}/`,
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
    activeSessionId,
    sessionList,
    activeSessionTitle,
    activeSessionIndex,
    canSwitchToNewerSession,
    canSwitchToOlderSession,
    refreshSessionList,
    setActiveSession,
    resetSessionUi,
    switchToAdjacentSession,
    removeSession,
    sessionLocalFileName,
    formatSessionInfoForCopy,
  };
}
