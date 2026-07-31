import { nextTick, watch, type Ref } from "vue";
import type { PersistedGitPanelUi, PersistedWorkspaceUi } from "../utils/workspaceUiStorage";
import { readWorkspaceUi, writeWorkspaceUi } from "../utils/workspaceUiStorage";
import { gitFileSelectionKey, parseGitFileSelectionKey } from "../utils/gitHelpers";

export type GitPanelUiRefs = {
  gitLogOpen: Ref<boolean>;
  gitStagedOpen: Ref<boolean>;
  gitUnstagedOpen: Ref<boolean>;
  gitUntrackedOpen: Ref<boolean>;
  gitStashOpen: Ref<boolean>;
  gitAheadCommitsOpen: Ref<boolean>;
  batchSectionOpen: Ref<boolean>;
  gitStashSectionOpen: Ref<boolean>;
  gitLocalChangesOpen: Ref<boolean>;
  selectedGitFiles: Ref<string[]>;
  expandedGitLogEntries: Ref<Set<string>>;
  gitLogSearchQuery: Ref<string>;
  gitLogAllBranches: Ref<boolean>;
};

export type WorkspaceUiPersistenceDeps = {
  projectPath: Ref<string>;
  projectOpened: Ref<boolean>;
  expandedDirs: Ref<Set<string>>;
  selectedTreePath: Ref<string>;
  showDiffMode: Ref<boolean>;
  getChatScrollTop: () => number;
  getChatPinnedToBottom: () => boolean;
  setChatPinnedToBottom: (pinned: boolean) => void;
  git: GitPanelUiRefs;
  planPanelInForeground: Ref<boolean>;
  planPanelActive: Ref<boolean>;
  planUserDismissed: Ref<boolean>;
  planPinnedMessageId: Ref<string | undefined>;
  quickSearchOpen: Ref<boolean>;
  restoringRef?: Ref<boolean>;
};

export function snapshotGitPanelUi(git: GitPanelUiRefs): PersistedGitPanelUi {
  return {
    logOpen: git.gitLogOpen.value,
    stagedOpen: git.gitStagedOpen.value,
    unstagedOpen: git.gitUnstagedOpen.value,
    untrackedOpen: git.gitUntrackedOpen.value,
    stashOpen: git.gitStashOpen.value,
    aheadCommitsOpen: git.gitAheadCommitsOpen.value,
    batchSectionOpen: git.batchSectionOpen.value,
    stashSectionOpen: git.gitStashSectionOpen.value,
    localChangesOpen: git.gitLocalChangesOpen.value,
    selectedFiles: [...git.selectedGitFiles.value],
    expandedLogEntries: Array.from(git.expandedGitLogEntries.value),
    logSearchQuery: git.gitLogSearchQuery.value,
    logAllBranches: git.gitLogAllBranches.value,
  };
}

export function applyGitPanelUi(git: GitPanelUiRefs, saved?: PersistedGitPanelUi) {
  if (!saved) return;
  if (typeof saved.stagedOpen === "boolean") git.gitStagedOpen.value = saved.stagedOpen;
  if (typeof saved.unstagedOpen === "boolean") git.gitUnstagedOpen.value = saved.unstagedOpen;
  if (typeof saved.untrackedOpen === "boolean") git.gitUntrackedOpen.value = saved.untrackedOpen;
  if (typeof saved.stashOpen === "boolean") git.gitStashOpen.value = saved.stashOpen;
  if (typeof saved.aheadCommitsOpen === "boolean") git.gitAheadCommitsOpen.value = saved.aheadCommitsOpen;
  if (typeof saved.batchSectionOpen === "boolean") git.batchSectionOpen.value = saved.batchSectionOpen;
  if (typeof saved.stashSectionOpen === "boolean") git.gitStashSectionOpen.value = saved.stashSectionOpen;
  if (typeof saved.localChangesOpen === "boolean") git.gitLocalChangesOpen.value = saved.localChangesOpen;
  if (saved.selectedFiles) {
    // Normalize legacy plain paths and scoped keys (`staged:path` / `unstaged:path`)
    git.selectedGitFiles.value = saved.selectedFiles.map((raw) => {
      const parsed = parseGitFileSelectionKey(raw);
      if (!parsed) return raw;
      return gitFileSelectionKey(parsed.path, parsed.staged);
    });
  }
  if (saved.expandedLogEntries?.length) {
    git.expandedGitLogEntries.value = new Set(saved.expandedLogEntries);
  }
  if (typeof saved.logSearchQuery === "string") git.gitLogSearchQuery.value = saved.logSearchQuery;
  if (typeof saved.logAllBranches === "boolean") git.gitLogAllBranches.value = saved.logAllBranches;
  if (typeof saved.logOpen === "boolean") git.gitLogOpen.value = saved.logOpen;
}

export function useWorkspaceUiPersistence(deps: WorkspaceUiPersistenceDeps) {
  let persistTimer = 0;
  let restoring = false;

  function setRestoring(value: boolean) {
    restoring = value;
    if (deps.restoringRef) deps.restoringRef.value = value;
  }

  function isRestoring() {
    return restoring;
  }

  function snapshot(): Omit<PersistedWorkspaceUi, "version"> {
    return {
      expandedDirs: Array.from(deps.expandedDirs.value),
      selectedTreePath: deps.selectedTreePath.value,
      showDiffMode: deps.showDiffMode.value,
      chatScrollTop: deps.getChatScrollTop(),
      chatPinnedToBottom: deps.getChatPinnedToBottom(),
      git: snapshotGitPanelUi(deps.git),
      planPanelInForeground: deps.planPanelInForeground.value,
      planPanelActive: deps.planPanelActive.value,
      planUserDismissed: deps.planUserDismissed.value,
      planPinnedMessageId: deps.planPinnedMessageId.value,
      quickSearchOpen: deps.quickSearchOpen.value,
    };
  }

  function persistNow() {
    if (restoring) return;
    const path = deps.projectPath.value.trim();
    if (!path || !deps.projectOpened.value) return;
    writeWorkspaceUi(path, snapshot());
  }

  function schedulePersist() {
    if (restoring) return;
    if (persistTimer) window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      persistTimer = 0;
      persistNow();
    }, 200);
  }

  function apply(saved: PersistedWorkspaceUi) {
    if (saved.expandedDirs?.length) {
      deps.expandedDirs.value = new Set(saved.expandedDirs);
    }
    if (typeof saved.selectedTreePath === "string") {
      deps.selectedTreePath.value = saved.selectedTreePath;
    }
    if (typeof saved.showDiffMode === "boolean") {
      deps.showDiffMode.value = saved.showDiffMode;
    }
    if (typeof saved.chatPinnedToBottom === "boolean") {
      deps.setChatPinnedToBottom(saved.chatPinnedToBottom);
    }
    applyGitPanelUi(deps.git, saved.git);
    if (typeof saved.planPanelInForeground === "boolean") {
      deps.planPanelInForeground.value = saved.planPanelInForeground;
    }
    if (typeof saved.planUserDismissed === "boolean") {
      deps.planUserDismissed.value = saved.planUserDismissed;
    }
    if (typeof saved.planPinnedMessageId === "string") {
      deps.planPinnedMessageId.value = saved.planPinnedMessageId;
    }
    if (typeof saved.planPanelActive === "boolean") {
      deps.planPanelActive.value = saved.planPanelActive;
    }
    if (typeof saved.quickSearchOpen === "boolean") {
      deps.quickSearchOpen.value = saved.quickSearchOpen;
    }
    return saved;
  }

  function readSaved(): PersistedWorkspaceUi | null {
    const path = deps.projectPath.value.trim();
    if (!path) return null;
    return readWorkspaceUi(path);
  }

  async function restoreLayoutState(): Promise<PersistedWorkspaceUi | null> {
    const saved = readSaved();
    if (!saved) return null;
    setRestoring(true);
    try {
      apply(saved);
    } finally {
      await nextTick();
      setRestoring(false);
    }
    return saved;
  }

  watch(
    () => [
      deps.projectOpened.value,
      deps.projectPath.value,
      Array.from(deps.expandedDirs.value).join("\n"),
      deps.selectedTreePath.value,
      deps.showDiffMode.value,
      deps.planPanelInForeground.value,
      deps.planPanelActive.value,
      deps.planUserDismissed.value,
      deps.planPinnedMessageId.value,
      deps.quickSearchOpen.value,
      deps.git.gitLogOpen.value,
      deps.git.gitStagedOpen.value,
      deps.git.gitUnstagedOpen.value,
      deps.git.gitUntrackedOpen.value,
      deps.git.gitStashOpen.value,
      deps.git.gitAheadCommitsOpen.value,
      deps.git.batchSectionOpen.value,
      deps.git.gitStashSectionOpen.value,
      deps.git.gitLocalChangesOpen.value,
      deps.git.selectedGitFiles.value.join("\n"),
      Array.from(deps.git.expandedGitLogEntries.value).join("\n"),
      deps.git.gitLogSearchQuery.value,
      deps.git.gitLogAllBranches.value,
    ] as const,
    () => schedulePersist(),
  );

  return {
    isRestoring,
    snapshot,
    persistNow,
    schedulePersist,
    apply,
    readSaved,
    restoreLayoutState,
  };
}

export function restoreChatScrollPosition(
  saved: PersistedWorkspaceUi | null,
  getScrollEl: () => HTMLElement | null | undefined,
  scrollToBottom: () => void,
) {
  if (!saved) {
    scrollToBottom();
    return;
  }
  if (saved.chatPinnedToBottom !== false) {
    scrollToBottom();
    return;
  }
  void nextTick(() => {
    const el = getScrollEl();
    if (el && typeof saved.chatScrollTop === "number") {
      el.scrollTop = saved.chatScrollTop;
    }
  });
}
