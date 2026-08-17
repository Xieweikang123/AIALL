import { computed, ref, type Ref } from "vue";
import {
  beginVibeChatDraftSession,
  finalizeDraftSessionOnLeave,
  buildActiveSessionDiskSyncPayload,
  chatMessagesHavePendingImageBase64,
  clearProjectMemoryCache,
  clearProjectSessionIndex,
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
  setVibeChatSessionProvider,
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
import { stampImageRefsAfterSync, applySyncedImageRefs } from "../services/vibeChatImageStore";
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
  /** True while a project switch is in progress; timers skip themselves. */
  isSwitchingProject?: () => boolean;
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
  /** Bumped when registry bindings change so UI always reads the active session array. */
  const registryVersion = ref(0);
  function bumpRegistryVersion() {
    registryVersion.value += 1;
  }

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
    isSwitchingProject,
  } = deps;

  const {
    activeSessionId,
    sessionList,
    refreshSessionList,
    setActiveSession,
    removeSession: removeSessionLocal,
    resetSessionUi,
  } = session;

  /** UI binds here; always reads registry.get(activeSessionId) without stale array refs. */
  const activeMessages = computed({
    get(): T[] {
      void registryVersion.value;
      const id = activeSessionId.value.trim();
      if (!id) {
        if (orphanMessages) return orphanMessages;
        return sessionMessages.getOrCreateSessionMessages("__orphan__");
      }
      return sessionMessages.getOrCreateSessionMessages(id);
    },
    set(next: T[]) {
      const id = activeSessionId.value.trim();
      if (!id) {
        orphanMessages = next;
        bumpRegistryVersion();
        return;
      }
      sessionMessages.setSessionMessages(id, next);
      bumpRegistryVersion();
    },
  }) as Ref<T[]>;

  function refreshList(path?: string) {
    refreshSessionList(path);
  }

  /** Bind session id + messages atomically; activeMessages reads from the registry. */
  function activateSession(sessionId: string, messages?: T[]) {
    const id = sessionId.trim();
    if (!id) return;
    const bound = messages ?? sessionMessages.getSessionMessages(id) ?? [];
    sessionMessages.setSessionMessages(id, bound);
    setActiveSession(id);
    orphanMessages = null;
    bumpRegistryVersion();
  }

  function bindSessionMessages(sessionId: string, messages: T[]) {
    const id = sessionId.trim();
    if (!id) return;
    sessionMessages.setSessionMessages(id, messages);
    bumpRegistryVersion();
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
    for (const id of sessionIds) {
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
      // 检测：磁盘拒绝此项目（projectPath 不匹配）但 localStorage 有数据 → 数据已污染
      if (!diskOk && !indexEmpty && "error" in diskIndex && diskIndex.error === "会话属于其他项目，已忽略") {
        clearProjectSessionIndex(project);
      }
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
    const msgs = loadVibeChatHistory(project);
    return { activeSessionId: activeId, messages: msgs };
  }

  function resetUiForProjectSwitch(oldProjectPath?: string) {
    resetSessionUi();
    sessionMessages.clearAll();
    orphanMessages = null;
    bumpRegistryVersion();
    if (oldProjectPath) {
      clearProjectMemoryCache(oldProjectPath);
    }
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
    if (isSwitchingProject?.()) return;
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
    let syncResult: Awaited<ReturnType<typeof syncChatSession>> | undefined;
    if (snapshot) {
      syncResult = await syncChatSession(path, sessionId, snapshot, {
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

      const syncedRefs = syncResult?.ok ? syncResult.imageRefsByMessageId : undefined;
      const stamped = syncedRefs && Object.keys(syncedRefs).length
        ? applySyncedImageRefs(messagesForDiskSync, syncedRefs)
        : stampImageRefsAfterSync(sessionId, messagesForDiskSync);
      saveVibeChatHistory(path, stamped, sessionId, { setActive: sameActiveSession, touchTimestamp: false });
      const live = sessionMessages.getSessionMessages(sessionId);
      if (live?.length) {
        for (const sm of stamped) {
          if (sm.role !== "user" || !sm.imageRefs?.length) continue;
          const idx = live.findIndex((m) => (m as { id?: string }).id === sm.id);
          if (idx >= 0) {
            Object.assign(live[idx] as object, { imageRefs: sm.imageRefs, imageCount: sm.imageCount });
          }
        }
      } else {
        bindSessionMessages(sessionId, normalizeMessages(stamped) as T[]);
      }
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

    // 项目切换中跳过延迟同步定时器
    if (isSwitchingProject?.()) {
      // 但如果请求了 flushStore，直接执行磁盘同步以确保 chat-store.json 的 projectPath 及时更新
      if (options?.flushStore) {
        void flushChatStoreToDisk(path, { quiet: true });
      }
      return;
    }

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

  /**
   * 删除当前会话消息区间。registry 数组本身非响应式，且 Vue 3.5 computed 在
   * 返回值引用不变时不会触发订阅者（hasChanged 为 false），因此必须换新数组引用
   * 并 bump，activeMessages computed 重新求值后才能驱动 UI 更新。
   * deleteCount 省略 = 删除到数组末尾（对齐 Array#splice 的单参语义）。
   */
  function spliceActiveMessages(start: number, deleteCount?: number) {
    const id = activeSessionId.value.trim();
    const list = id ? sessionMessages.getSessionMessages(id) : orphanMessages;
    if (!list) return;
    const next = [...list];
    next.splice(start, deleteCount ?? next.length - start);
    if (id) {
      sessionMessages.setSessionMessages(id, next);
    } else {
      orphanMessages = next;
    }
    bumpRegistryVersion();
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
    const id = sessionId.trim();
    const diskMessages = peekVibeChatSessionMessages(project, id);
    const resolved = resolveMessagesForSession(id, diskMessages);
    activateSession(id, resolved);
    chatError.value = "";
    refreshList(project);
    onAfterSwitch?.();
  }

  function hydrateSessionFromDiskAfterSwitch(project: string, sessionId: string, gen: number) {
    void (async () => {
      let registryDirty = false;
      try {
        await ensureProjectChatLoadedFromDisk(project, sessionId);
        const id = sessionId.trim();
        const stillActive = activeSessionId.value.trim() === id;
        const diskMessages = peekVibeChatSessionMessages(project, id);
        const cached = sessionMessages.getSessionMessages(id);
        if (stillActive) {
          const cachedLen = cached?.length ?? 0;
          if (diskMessages.length && cachedLen < diskMessages.length) {
            bindSessionMessages(id, resolveMessagesForSession(id, diskMessages));
            registryDirty = true;
          } else if (diskMessages.length) {
            bumpRegistryVersion();
            registryDirty = true;
          }
          onAfterSwitch?.();
        }
      } finally {
        const id = sessionId.trim();
        if (activeSessionId.value.trim() === id) {
          switchingSession.value = false;
          if (!registryDirty) bumpRegistryVersion();
          void scrollToBottom?.(true);
        } else if (gen === switchSessionGeneration) {
          switchingSession.value = false;
        }
        schedulePersistChat();
      }
    })();
  }

  function switchSession(sessionId: string) {
    const id = sessionId.trim();
    const project = projectPath().trim();
    const currentId = activeSessionId.value.trim();
    if (!project || !id) {
      return;
    }

    if (id === currentId) {
      applySessionSwitch(project, id);
      void scrollToBottom?.(true);
      return;
    }

    switchingSession.value = false;
    const fromSessionId = currentId;
    const fromMessages = fromSessionId ? sessionMessages.getSessionMessages(fromSessionId) : undefined;
    persistComposerDraft?.();
    if (fromSessionId && fromSessionId !== id) {
      finalizeDraftSessionOnLeave(project, fromSessionId);
    }
    cancelPendingChatPersistence();
    const gen = ++switchSessionGeneration;
    applySessionSwitch(project, id);

    if (fromSessionId && fromMessages?.length) {
      saveVibeChatHistory(project, fromMessages, fromSessionId, { touchTimestamp: false, setActive: false });
    }

    if (!projectChatNeedsDiskRestore(project, id)) {
      void scrollToBottom?.(true);
      return;
    }

    const hasDisplayableMessages = (sessionMessages.getSessionMessages(id)?.length ?? 0) > 0;
    if (hasDisplayableMessages) {
      hydrateSessionFromDiskAfterSwitch(project, id, gen);
      void scrollToBottom?.(true);
      return;
    }

    switchingSession.value = true;
    hydrateSessionFromDiskAfterSwitch(project, id, gen);
  }

  async function removeSession(sessionId: string, options?: { silent?: boolean }) {
    if (!options?.silent) {
      const ok = await confirm("确定删除此会话？");
      if (!ok) return;
    }
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
    // 磁盘 chat-store.json 是唯一真相源：推送前若本地索引为空，先从磁盘补齐，
    // 避免用"瘦身"的本地索引整体覆盖磁盘、把仅存在于磁盘的会话变成孤儿文件。
    if (!getSessionDiagSnapshot(path).indexSessionIds.length) {
      await loadFullChatStoreFromDisk(path);
    }
    syncingChatStore.value = true;
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

  const activeSessionProviderId = computed(() => {
    const id = activeSessionId.value.trim();
    if (!id) return "";
    return sessionList.value.find((s) => s.id === id)?.providerId?.trim() || "";
  });

  function setActiveSessionProvider(providerId: string) {
    const project = projectPath().trim();
    const id = activeSessionId.value.trim();
    if (!project || !id) return;
    setVibeChatSessionProvider(project, id, providerId);
    refreshList(project);
    schedulePersistChat();
  }

  return {
    activeMessages,
    switchingSession,
    syncingChatStore,
    chatStoreSyncMessage,
    activeSessionProviderId,
    setActiveSessionProvider,
    activateSession,
    bindSessionMessages,
    getSessionMessages: sessionMessages.getSessionMessages,
    patchSessionMessage: sessionMessages.patchSessionMessage,
    spliceActiveMessages,
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
