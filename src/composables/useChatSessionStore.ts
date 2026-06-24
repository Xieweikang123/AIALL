import { ref, type Ref } from "vue";
import {
  beginVibeChatDraftSession,
  finalizeDraftSessionOnLeave,
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
  peekVibeChatSessionMessages,
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
import { sessionDiag } from "../utils/sessionDiagLog";
import type { useSessionManager } from "./useSessionManager";
import { useSessionMessageRegistry } from "./useSessionMessageRegistry";

export type ChatSessionStoreDeps<T extends PersistedChatMessage = PersistedChatMessage> = {
  projectPath: () => string;
  chatError: Ref<string>;
  chatSending: () => boolean;
  session: ReturnType<typeof useSessionManager>;
  normalizeMessages: (msgs: PersistedChatMessage[]) => T[];
  confirm: (message: string) => Promise<boolean>;
  onAfterSwitch?: () => void;
  scrollToBottom?: (force?: boolean) => void | Promise<void>;
  /** Prefer in-memory registry over disk when switching back. */
  resolveSessionMessages?: (sessionId: string, diskMessages: PersistedChatMessage[]) => T[];
  /** Save composer input before leaving a session (must run before draft cleanup). */
  persistComposerDraft?: () => void;
};

export function useChatSessionStore<T extends PersistedChatMessage = PersistedChatMessage>(
  deps: ChatSessionStoreDeps<T>,
) {
  const switchingSession = ref(false);
  const syncingChatStore = ref(false);
  const chatStoreSyncMessage = ref("");
  /** UI binds here; always the same array reference as registry.get(activeSessionId). */
  const activeMessages = ref<T[]>([]) as Ref<T[]>;

  const sessionMessages = useSessionMessageRegistry<T>();

  let switchSessionGeneration = 0;
  let saveChatTimer: ReturnType<typeof setTimeout> | null = null;
  let persistDelayTimer: ReturnType<typeof setTimeout> | null = null;
  let persistChatGeneration = 0;
  /** Messages typed before first session id exists (ensureSessionForSend). */
  let orphanMessages: T[] | null = null;

  const {
    projectPath,
    chatError,
    chatSending,
    session,
    normalizeMessages,
    confirm,
    onAfterSwitch,
    scrollToBottom,
    resolveSessionMessages,
    persistComposerDraft,
  } = deps;

  const {
    activeSessionId,
    sessionList,
    refreshSessionList,
    setActiveSession,
    removeSession: removeSessionLocal,
    resetSessionUi,
  } = session;

  function refreshList(path?: string) {
    refreshSessionList(path);
  }

  /** Bind session id + messages atomically; activeMessages points into the registry. */
  function activateSession(sessionId: string, messages?: T[]) {
    const id = sessionId.trim();
    if (!id) return;
    const bound = messages ?? sessionMessages.getSessionMessages(id) ?? [];
    sessionMessages.setSessionMessages(id, bound);
    setActiveSession(id);
    activeMessages.value = sessionMessages.getSessionMessages(id)!;
    orphanMessages = null;
  }

  function bindSessionMessages(sessionId: string, messages: T[]) {
    const id = sessionId.trim();
    if (!id) return;
    sessionMessages.setSessionMessages(id, messages);
    if (activeSessionId.value.trim() === id) {
      activeMessages.value = messages;
    }
  }

  function resolveMessagesForSession(sessionId: string, diskMessages: PersistedChatMessage[]): T[] {
    const cached = sessionMessages.getSessionMessages(sessionId);
    if (cached?.length) return cached;
    if (resolveSessionMessages) return resolveSessionMessages(sessionId, diskMessages);
    return normalizeMessages(diskMessages);
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
    sessionMessages.clearAll();
    orphanMessages = null;
    activeMessages.value = [];
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
    if (switchingSession.value) return;
    const scheduledSessionId = activeSessionId.value.trim();
    if (!scheduledSessionId) return;
    if (saveChatTimer) clearTimeout(saveChatTimer);
    saveChatTimer = setTimeout(() => {
      saveChatTimer = null;
      if (switchingSession.value) return;
      if (activeSessionId.value.trim() !== scheduledSessionId) return;
      persistSessionNow(scheduledSessionId);
    }, 400);
  }

  /** Skip mid-run debounced writes — large sessions block the main thread; done handler persists. */
  function schedulePersistDuringAgentRun(_options?: { sessionId?: string; flushStore?: boolean }) {
    // no-op
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
      saveVibeChatHistory(path, stamped, sessionId, { setActive: sameActiveSession, touchTimestamp: false });
      bindSessionMessages(sessionId, normalizeMessages(stamped) as T[]);
      refreshList(path);
    }
    if (options?.flushStore) {
      const pendingImages = chatMessagesHavePendingImageBase64(messagesForDiskSync);
      if (!pendingImages || syncOk) {
        await flushChatStoreToDisk(path, { quiet: true });
      }
    }
  }

  /** Persist using registry pairing — never reads a mismatched UI ref. */
  function persistSessionNow(
    sessionId: string,
    path = projectPath().trim(),
    options?: { flushStore?: boolean; touchTimestamp?: boolean },
  ) {
    const id = sessionId.trim();
    if (!path || !id) return;
    const messages = sessionMessages.getSessionMessages(id);
    if (!messages?.length) return;

    const messagesForDiskSync = cloneChatMessagesForDiskSync(messages);
    const gen = ++persistChatGeneration;
    let touchTimestamp =
      options?.touchTimestamp
      ?? (id === activeSessionId.value.trim() && !switchingSession.value);
    if (options?.touchTimestamp === undefined && touchTimestamp) {
      const disk = peekVibeChatSessionMessages(path, id);
      if (
        disk.length === messages.length
        && disk.every(
          (d, i) =>
            d.id === messages[i]?.id
            && d.role === messages[i]?.role
            && (d.content ?? "") === (messages[i]?.content ?? ""),
        )
      ) {
        touchTimestamp = false;
      }
    }
    saveVibeChatHistory(path, messages, id, { touchTimestamp });
    refreshList(path);

    if (persistDelayTimer) clearTimeout(persistDelayTimer);
    persistDelayTimer = setTimeout(() => {
      persistDelayTimer = null;
      if (gen !== persistChatGeneration) return;
      void runDelayedChatDiskSync(path, id, messagesForDiskSync, options, gen);
    }, 100);
  }

  function persistChatNow(
    path = projectPath().trim(),
    options?: { flushStore?: boolean; sessionId?: string },
  ) {
    const sessionId = (options?.sessionId || activeSessionId.value).trim();
    if (!sessionId || switchingSession.value) return;
    persistSessionNow(sessionId, path, options);
  }

  function ensureSessionForSend(): string {
    const project = projectPath().trim();
    if (!project) return "";
    const existing = activeSessionId.value.trim();
    if (existing) return existing;
    const { id } = beginVibeChatDraftSession(project);
    const seed = orphanMessages ?? (activeMessages.value.length ? [...activeMessages.value] : []);
    activateSession(id, seed);
    refreshList(project);
    return id;
  }

  function startNewSession() {
    if (!projectPath().trim()) return;
    const project = projectPath().trim();
    const fromSessionId = activeSessionId.value.trim();
    const fromMessages = fromSessionId ? sessionMessages.getSessionMessages(fromSessionId) : undefined;
    if (fromSessionId && fromMessages?.length) {
      saveVibeChatHistory(project, fromMessages, fromSessionId, { touchTimestamp: false });
    }
    persistComposerDraft?.();
    if (fromSessionId) {
      finalizeDraftSessionOnLeave(project, fromSessionId);
    }
    cancelPendingChatPersistence();
    const { id } = beginVibeChatDraftSession(project);
    activateSession(id, []);
    chatError.value = "";
    refreshList(project);
    void scrollToBottom?.(true);
  }

  function applySessionSwitch(project: string, sessionId: string) {
    switchVibeChatSession(project, sessionId);
    const diskMessages = peekVibeChatSessionMessages(project, sessionId);
    const resolved = resolveMessagesForSession(sessionId, diskMessages);
    activateSession(sessionId, normalizeMessages(resolved));
    chatError.value = "";
    refreshList(project);
    onAfterSwitch?.();
  }

  function switchSession(sessionId: string) {
    if (!projectPath().trim()) return;
    if (sessionId === activeSessionId.value) {
      return;
    }
    const fromSessionId = activeSessionId.value.trim();
    const project = projectPath().trim();
    const fromMessages = fromSessionId ? sessionMessages.getSessionMessages(fromSessionId) : undefined;
    if (fromSessionId && fromMessages?.length) {
      saveVibeChatHistory(project, fromMessages, fromSessionId, { touchTimestamp: false });
    }
    persistComposerDraft?.();
    if (fromSessionId && fromSessionId !== sessionId) {
      finalizeDraftSessionOnLeave(project, fromSessionId);
    }
    cancelPendingChatPersistence();
    const gen = ++switchSessionGeneration;
    applySessionSwitch(project, sessionId);

    if (!projectChatNeedsDiskRestore(project, sessionId)) {
      void scrollToBottom?.(true);
      return;
    }

    switchingSession.value = true;
    void (async () => {
      try {
        await ensureProjectChatLoadedFromDisk(project, sessionId);
        if (gen !== switchSessionGeneration) return;
        const diskMessages = peekVibeChatSessionMessages(project, sessionId);
        const resolved = resolveMessagesForSession(sessionId, diskMessages);
        bindSessionMessages(sessionId, normalizeMessages(resolved));
      } finally {
        if (gen === switchSessionGeneration) {
          switchingSession.value = false;
          void scrollToBottom?.(true);
        }
      }
    })();
  }

  async function removeSession(sessionId: string) {
    const ok = await confirm("确定删除此会话？");
    if (!ok) return;
    const project = projectPath().trim();
    cancelPendingChatPersistence();
    sessionMessages.deleteSessionMessages(sessionId);
    removeSessionLocal(sessionId);
    refreshList();
    const nextActiveId = getActiveVibeChatSessionId(project);
    const diskResult = await deleteChatSessionOnDisk(project, sessionId, nextActiveId);
    if (!diskResult.ok) {
      await flushChatStoreToDisk(project, { quiet: true, force: true });
    }
    const activeId = resolveActiveVibeChatSessionId(project);
    activateSession(activeId, normalizeMessages(loadVibeChatHistory(project)));
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
    const activeId = resolveActiveVibeChatSessionId(project);
    activateSession(activeId, []);
    chatError.value = "";
    clearVibeChatHistory(project);
    refreshList(project);
  }

  return {
    activeMessages,
    switchingSession,
    syncingChatStore,
    chatStoreSyncMessage,
    activateSession,
    bindSessionMessages,
    getSessionMessages: sessionMessages.getSessionMessages,
    patchSessionMessage: sessionMessages.patchSessionMessage,
    persistSessionNow,
    persistChatNow,
    schedulePersistChat,
    schedulePersistDuringAgentRun,
    cancelPendingChatPersistence,
    flushChatStoreToDisk,
    ensureSessionForSend,
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
