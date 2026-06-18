import { ref, type Ref } from "vue";
import {
  abandonVibeChatDraftIfEmpty,
  beginVibeChatDraftSession,
  buildActiveSessionDiskSyncPayload,
  chatMessagesHavePendingImageBase64,
  clearVibeChatHistory,
  cloneChatMessagesForDiskSync,
  diskChatStoreAheadOfLocalIndex,
  getActiveSessionSnapshot,
  getActiveVibeChatSessionId,
  getSessionDiagSnapshot,
  getVibeChatProjectSnapshot,
  isSessionRecentlyDeletedLocally,
  loadVibeChatHistory,
  projectChatNeedsDiskRestore,
  replaceChatStoreFromDiskSnapshot,
  resolveActiveVibeChatSessionId,
  saveVibeChatHistory,
  sessionIdsWithDiskAheadMessageCounts,
  switchVibeChatSession,
  syncLocalIndexFromRecord,
  vibeProjectPathsMatch,
  type PersistedChatMessage,
} from "../services/vibeChatStorage";
import {
  deleteChatSessionOnDisk,
  enqueueChatStoreOp,
  flushChatStoreOnDisk,
} from "../services/chatStoreCoordinator";
import {
  fetchChatStoreFromDisk,
  fetchSessionMessages,
  syncChatSession,
  syncChatStore,
  type ChatStoreSyncResult,
} from "../services/vibeCodingClient";
import { stampImageRefsAfterSync } from "../services/vibeChatImageStore";
import { markSessionDeleted, sessionDiag } from "../utils/sessionDiagLog";
import type { useSessionManager } from "./useSessionManager";

export type ChatSessionStoreDeps<T extends PersistedChatMessage = PersistedChatMessage> = {
  projectPath: () => string;
  chatMessages: Ref<T[]>;
  chatError: Ref<string>;
  chatSending: () => boolean;
  session: ReturnType<typeof useSessionManager>;
  normalizeMessages: (msgs: PersistedChatMessage[]) => T[];
  confirm: (message: string) => Promise<boolean>;
  onAfterSwitch?: () => void;
  scrollToBottom?: (force?: boolean) => void | Promise<void>;
};

export function useChatSessionStore<T extends PersistedChatMessage = PersistedChatMessage>(
  deps: ChatSessionStoreDeps<T>,
) {
  const switchingSession = ref(false);
  const syncingChatStore = ref(false);
  const chatStoreSyncMessage = ref("");

  let switchSessionGeneration = 0;
  let saveChatTimer: ReturnType<typeof setTimeout> | null = null;
  let persistDelayTimer: ReturnType<typeof setTimeout> | null = null;
  let persistChatGeneration = 0;

  const {
    projectPath,
    chatMessages,
    chatError,
    chatSending,
    session,
    normalizeMessages,
    confirm,
    onAfterSwitch,
    scrollToBottom,
  } = deps;

  const {
    activeSessionId,
    sessionList,
    refreshSessionList,
    setActiveSession,
    removeSession: removeSessionLocal,
    resetSessionUi,
    closeSessionPicker,
  } = session;

  function refreshList(path?: string) {
    refreshSessionList(path);
  }

  async function loadFullChatStoreFromDisk(project: string): Promise<void> {
    sessionDiag("ui:load-full-chat-store:start", { projectPath: project, local: getSessionDiagSnapshot(project) });
    const diskStore = await fetchChatStoreFromDisk(project, { loadMessages: true });
    if (
      diskStore.ok
      && diskStore.data.sessions.length
      && vibeProjectPathsMatch(project, diskStore.data.projectPath)
    ) {
      replaceChatStoreFromDiskSnapshot(diskStore.data, project);
      sessionDiag("ui:load-full-chat-store:after", {
        projectPath: project,
        local: getSessionDiagSnapshot(project),
      });
    }
  }

  async function restoreIndexedSessionsFromDisk(project: string, sessionIds: string[]): Promise<void> {
    if (!sessionIds.length) return;
    const indexedIds = getSessionDiagSnapshot(project).indexSessionIds;
    for (const id of sessionIds.filter((sid) => indexedIds.includes(sid))) {
      if (isSessionRecentlyDeletedLocally(project, id)) continue;
      if (!projectChatNeedsDiskRestore(project, id)) continue;
      const result = await fetchSessionMessages(project, id);
      if (result.ok && Array.isArray(result.data.messages) && result.data.messages.length) {
        saveVibeChatHistory(project, result.data.messages as PersistedChatMessage[], id, { touchTimestamp: false });
      }
    }
  }

  async function restoreDiskAheadSessionsFromDisk(project: string): Promise<void> {
    const diskIndex = await fetchChatStoreFromDisk(project, { loadMessages: false });
    if (
      !diskIndex.ok
      || !diskIndex.data.sessions.length
      || !vibeProjectPathsMatch(project, diskIndex.data.projectPath)
    ) {
      return;
    }
    const aheadIds = sessionIdsWithDiskAheadMessageCounts(project, diskIndex.data.sessions).filter(
      (id) => !isSessionRecentlyDeletedLocally(project, id),
    );
    if (!aheadIds.length) return;
    await restoreIndexedSessionsFromDisk(project, aheadIds);
  }

  async function ensureProjectChatLoadedFromDiskInternal(project: string, sessionId?: string): Promise<void> {
    if (sessionId) {
      if (!projectChatNeedsDiskRestore(project, sessionId)) return;
      await restoreIndexedSessionsFromDisk(project, [sessionId]);
      return;
    }
    const activeId = getActiveVibeChatSessionId(project);
    const idsToRestore: string[] = [];
    if (activeId && projectChatNeedsDiskRestore(project, activeId)) {
      idsToRestore.push(activeId);
    }
    await restoreIndexedSessionsFromDisk(project, idsToRestore);
    await restoreDiskAheadSessionsFromDisk(project);
  }

  async function ensureProjectChatLoadedFromDisk(project: string, sessionId?: string): Promise<void> {
    if (!project.trim()) return;
    await enqueueChatStoreOp(project, () => ensureProjectChatLoadedFromDiskInternal(project, sessionId));
  }

  async function hydrateProjectChatFromDisk(project: string): Promise<boolean> {
    if (!project.trim()) return false;
    return enqueueChatStoreOp(project, async () => {
      const diskIndex = await fetchChatStoreFromDisk(project, { loadMessages: false });
      const diskOk =
        diskIndex.ok
        && diskIndex.data.sessions.length > 0
        && vibeProjectPathsMatch(project, diskIndex.data.projectPath);
      const indexEmpty = !getSessionDiagSnapshot(project).indexSessionIds.length;
      const activeId = getActiveVibeChatSessionId(project);
      const needsDisk =
        (indexEmpty && diskOk)
        || (activeId ? projectChatNeedsDiskRestore(project, activeId) : false)
        || (diskOk && diskChatStoreAheadOfLocalIndex(project, diskIndex.data.sessions));
      if (!needsDisk) return false;
      if (indexEmpty) {
        await loadFullChatStoreFromDisk(project);
      } else {
        await ensureProjectChatLoadedFromDiskInternal(project);
      }
      return true;
    });
  }

  /** Open project / hydrate: returns resolved active id + messages. */
  async function loadProjectChatState(project: string): Promise<{
    activeSessionId: string;
    messages: PersistedChatMessage[];
  }> {
    await hydrateProjectChatFromDisk(project);
    const activeId = resolveActiveVibeChatSessionId(project);
    return { activeSessionId: activeId, messages: loadVibeChatHistory(project) };
  }

  function resetUiForProjectSwitch() {
    resetSessionUi();
    chatMessages.value = [];
  }

  function cancelPendingChatPersistence() {
    persistChatGeneration++;
    if (saveChatTimer) {
      clearTimeout(saveChatTimer);
      saveChatTimer = null;
    }
    if (persistDelayTimer) {
      clearTimeout(persistDelayTimer);
      persistDelayTimer = null;
    }
  }

  function schedulePersistChat() {
    if (!projectPath().trim()) return;
    if (chatSending()) return;
    if (saveChatTimer) clearTimeout(saveChatTimer);
    saveChatTimer = setTimeout(() => {
      saveChatTimer = null;
      persistChatNow();
    }, 400);
  }

  async function flushChatStoreToDisk(
    path: string,
    options?: { quiet?: boolean; force?: boolean },
  ): Promise<ChatStoreSyncResult | undefined> {
    if (!path || (syncingChatStore.value && !options?.force)) return undefined;
    syncingChatStore.value = true;
    try {
      const snapshot = getVibeChatProjectSnapshot(path);
      const result = await flushChatStoreOnDisk(path, () => syncChatStore(path, snapshot));
      if (!result.ok) {
        if (!options?.quiet) {
          chatStoreSyncMessage.value = result.error || "同步会话到本地失败";
        } else {
          chatError.value = result.error || "会话未能写入项目目录，请检查后端服务是否运行";
        }
        return result;
      }
      if (!options?.quiet) {
        chatStoreSyncMessage.value = `已同步 ${result.sessionCount ?? sessionList.value.length} 条会话到 ${result.path || "本地目录"}`;
      }
      return result;
    } finally {
      syncingChatStore.value = false;
    }
  }

  async function runDelayedChatDiskSync(
    path: string,
    sessionId: string,
    messagesForDiskSync: PersistedChatMessage[],
    options?: { flushStore?: boolean },
    persistGen?: number,
  ) {
    if (persistGen !== undefined && persistGen !== persistChatGeneration) return;
    if (isSessionRecentlyDeletedLocally(path, sessionId)) return;

    const sameActiveSession =
      activeSessionId.value === sessionId && projectPath().trim() === path;
    const snapshot =
      buildActiveSessionDiskSyncPayload(path, sessionId, messagesForDiskSync) ??
      getActiveSessionSnapshot(path, sessionId);
    let syncOk = false;
    if (snapshot) {
      const syncResult = await syncChatSession(path, sessionId, snapshot, {
        activeSessionId: activeSessionId.value || sessionId,
      });
      syncOk = syncResult.ok;
      if (
        !syncOk
        && chatMessagesHavePendingImageBase64(messagesForDiskSync)
        && sameActiveSession
      ) {
        chatError.value = ("error" in syncResult && syncResult.error)
          ? syncResult.error
          : "附图未能写入本地，刷新后可能丢失";
      }
    }
    if (syncOk) {
      if (persistGen !== undefined && persistGen !== persistChatGeneration) return;
      if (isSessionRecentlyDeletedLocally(path, sessionId)) return;

      const stamped = stampImageRefsAfterSync(sessionId, messagesForDiskSync);
      if (sameActiveSession) {
        chatMessages.value = normalizeMessages(stamped);
      }
      saveVibeChatHistory(path, stamped, sessionId, { setActive: sameActiveSession, touchTimestamp: false });
      refreshList(path);
    }
    if (options?.flushStore) {
      const pendingImages = chatMessagesHavePendingImageBase64(messagesForDiskSync);
      if (!pendingImages || syncOk) {
        await flushChatStoreToDisk(path, { quiet: true });
      }
    }
  }

  function persistChatNow(path = projectPath().trim(), options?: { flushStore?: boolean }) {
    if (!path || !chatMessages.value.length) return;

    let sessionId = activeSessionId.value;
    if (!sessionId) {
      sessionId = beginVibeChatDraftSession(path).id;
      setActiveSession(sessionId);
    }

    const messagesForDiskSync = cloneChatMessagesForDiskSync(chatMessages.value);
    const gen = ++persistChatGeneration;
    saveVibeChatHistory(path, chatMessages.value, sessionId, { touchTimestamp: false });
    refreshList(path);

    if (persistDelayTimer) clearTimeout(persistDelayTimer);
    persistDelayTimer = setTimeout(() => {
      persistDelayTimer = null;
      if (gen !== persistChatGeneration) return;
      void runDelayedChatDiskSync(path, sessionId, messagesForDiskSync, options, gen);
    }, 100);
  }

  function startNewSession() {
    if (chatSending() || !projectPath().trim()) return;
    cancelPendingChatPersistence();
    const project = projectPath().trim();
    const fromSessionId = activeSessionId.value;
    if (fromSessionId && chatMessages.value.length) {
      saveVibeChatHistory(project, chatMessages.value, fromSessionId, { touchTimestamp: false });
    } else if (fromSessionId) {
      abandonVibeChatDraftIfEmpty(project, fromSessionId);
    }
    const { id } = beginVibeChatDraftSession(project);
    setActiveSession(id);
    chatMessages.value = [];
    chatError.value = "";
    refreshList(project);
    closeSessionPicker();
    void scrollToBottom?.(true);
  }

  function switchSession(sessionId: string) {
    if (chatSending() || !projectPath().trim()) return;
    if (sessionId === activeSessionId.value) {
      closeSessionPicker();
      return;
    }
    cancelPendingChatPersistence();
    const fromSessionId = activeSessionId.value;
    const project = projectPath().trim();
    if (fromSessionId && chatMessages.value.length) {
      saveVibeChatHistory(project, chatMessages.value, fromSessionId, { touchTimestamp: false });
    } else if (fromSessionId) {
      abandonVibeChatDraftIfEmpty(project, fromSessionId);
    }
    const gen = ++switchSessionGeneration;
    switchingSession.value = true;
    void (async () => {
      try {
        await ensureProjectChatLoadedFromDisk(project, sessionId);
        if (gen !== switchSessionGeneration) return;
        const messages = switchVibeChatSession(project, sessionId);
        chatMessages.value = normalizeMessages(messages);
        setActiveSession(sessionId);
        chatError.value = "";
        refreshList(project);
        closeSessionPicker();
        onAfterSwitch?.();
        await scrollToBottom?.(true);
      } finally {
        if (gen === switchSessionGeneration) switchingSession.value = false;
      }
    })();
  }

  async function removeSession(sessionId: string) {
    const ok = await confirm("确定删除此会话？");
    if (!ok) return;
    const project = projectPath().trim();
    cancelPendingChatPersistence();
    markSessionDeleted(sessionId);
    const result = removeSessionLocal(sessionId, chatSending());
    if (result) chatMessages.value = normalizeMessages(result);
    refreshList();
    const nextActiveId = getActiveVibeChatSessionId(project);
    const diskResult = await deleteChatSessionOnDisk(project, sessionId, nextActiveId);
    if (!diskResult.ok) {
      await flushChatStoreToDisk(project, { quiet: true, force: true });
    }
    const activeId = resolveActiveVibeChatSessionId(project);
    setActiveSession(activeId);
    chatMessages.value = normalizeMessages(loadVibeChatHistory(project));
    refreshList();
    void scrollToBottom?.(true);
  }

  async function syncChatStoreToDisk() {
    const path = projectPath().trim();
    if (!path || syncingChatStore.value) return;
    persistChatNow(path);
    syncingChatStore.value = true;
    chatError.value = "";
    chatStoreSyncMessage.value = "正在同步会话到本地...";
    try {
      const result = await syncChatStore(path, getVibeChatProjectSnapshot(path));
      if (!result.ok) {
        chatStoreSyncMessage.value = result.error || "同步会话到本地失败";
        return;
      }
      syncLocalIndexFromRecord(path);
      refreshList(path);
      chatStoreSyncMessage.value = `已同步 ${result.sessionCount ?? sessionList.value.length} 条会话到 ${result.path || "本地目录"}`;
    } finally {
      syncingChatStore.value = false;
    }
  }

  function clearProjectChat() {
    if (chatSending()) return;
    const project = projectPath().trim();
    if (!project) return;
    chatMessages.value = [];
    chatError.value = "";
    clearVibeChatHistory(project);
    setActiveSession(resolveActiveVibeChatSessionId(project));
    refreshList(project);
  }

  return {
    switchingSession,
    syncingChatStore,
    chatStoreSyncMessage,
    persistChatNow,
    schedulePersistChat,
    cancelPendingChatPersistence,
    flushChatStoreToDisk,
    startNewSession,
    switchSession,
    removeSession,
    syncChatStoreToDisk,
    hydrateProjectChatFromDisk,
    loadProjectChatState,
    resetUiForProjectSwitch,
    clearProjectChat,
    ensureProjectChatLoadedFromDisk,
  };
}
