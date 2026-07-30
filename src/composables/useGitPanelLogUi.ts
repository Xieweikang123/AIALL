import { ref, computed, watch, onUnmounted, type Ref } from "vue";

export interface GitLogEntryView {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
  files: Array<{ path: string; oldPath?: string; status: string }>;
  refs?: Array<{ name: string; type: string }>;
}

interface GitLogCtxMenu {
  show: boolean;
  x: number;
  y: number;
  hash: string;
  shortHash: string;
  message: string;
}

export function useGitPanelLogUi(options: {
  gitLogSearchQuery: Ref<string>;
  gitLogSearchLoading: Ref<boolean>;
  hasMoreGitLog: Ref<boolean>;
  gitLogLoadingMore: Ref<boolean>;
  expandedGitLogEntries: Ref<Set<string>>;
  onSearch: (query: string) => void;
  onLoadMore: () => void;
  onCherryPick: (hash: string) => void;
  onRevert: (hash: string) => void;
  onCreateTag: (hash: string) => void;
  onCreateBranch: (hash: string) => void;
  onReset: (hash: string, mode: string, shortHash: string) => void;
}) {
  const {
    gitLogSearchQuery,
    gitLogSearchLoading,
    hasMoreGitLog,
    gitLogLoadingMore,
    expandedGitLogEntries,
    onSearch,
    onLoadMore,
    onCherryPick,
    onRevert,
    onCreateTag,
    onCreateBranch,
    onReset,
  } = options;

  const searchVal = ref(gitLogSearchQuery.value || "");
  const searchPending = ref(false);
  let searchTimeout: ReturnType<typeof setTimeout> | null = null;

  const gitLogSearchActive = computed(() => searchPending.value || gitLogSearchLoading.value);

  watch(() => gitLogSearchQuery.value, (val) => {
    const next = val || "";
    if (searchVal.value !== next) searchVal.value = next;
  });

  watch(() => gitLogSearchLoading.value, (loading) => {
    if (!loading) searchPending.value = false;
  });

  watch(searchVal, (newVal) => {
    const trimmed = newVal.trim();
    if (trimmed === (gitLogSearchQuery.value || "")) {
      searchPending.value = false;
      return;
    }
    searchPending.value = true;
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => onSearch(newVal), 300);
  });

  function clearSearch() {
    searchPending.value = false;
    searchVal.value = "";
    if (searchTimeout) clearTimeout(searchTimeout);
    onSearch("");
  }

  onUnmounted(() => {
    if (searchTimeout) clearTimeout(searchTimeout);
  });

  function isGitLogEntryOpen(hash: string): boolean {
    return expandedGitLogEntries.value.has(hash);
  }

  function gitHistoryDiffKey(hash: string, path: string, oldPath?: string): string {
    return `history:${hash}:${oldPath || ""}:${path}`;
  }

  function handleLogScroll(event: Event) {
    const target = event.target as HTMLElement;
    if (!target) return;
    const threshold = 25;
    const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight <= threshold;
    if (isAtBottom && hasMoreGitLog.value && !gitLogLoadingMore.value && !gitLogSearchLoading.value) {
      onLoadMore();
    }
  }

  const gitLogContextMenu = ref<GitLogCtxMenu>({
    show: false,
    x: 0,
    y: 0,
    hash: "",
    shortHash: "",
    message: "",
  });

  function onGitLogContextMenu(event: MouseEvent, entry: GitLogEntryView) {
    event.preventDefault();
    const menuW = 200;
    const menuH = 220;
    const clampedX = Math.min(event.clientX, window.innerWidth - menuW);
    const clampedY = Math.min(event.clientY, window.innerHeight - menuH);
    gitLogContextMenu.value = {
      show: true,
      x: Math.max(0, clampedX),
      y: Math.max(0, clampedY),
      hash: entry.hash,
      shortHash: entry.shortHash,
      message: entry.message,
    };
  }

  function hideGitLogContextMenu() {
    gitLogContextMenu.value.show = false;
  }

  function gitLogCtxCherryPick() {
    const h = gitLogContextMenu.value.hash;
    hideGitLogContextMenu();
    if (h) onCherryPick(h);
  }

  function gitLogCtxRevert() {
    const h = gitLogContextMenu.value.hash;
    hideGitLogContextMenu();
    if (h) onRevert(h);
  }

  function gitLogCtxCreateTag() {
    const h = gitLogContextMenu.value.hash;
    hideGitLogContextMenu();
    if (h) onCreateTag(h);
  }

  function gitLogCtxCreateBranch() {
    const h = gitLogContextMenu.value.hash;
    hideGitLogContextMenu();
    if (h) onCreateBranch(h);
  }

  function gitLogCtxReset(mode: string) {
    const h = gitLogContextMenu.value.hash;
    const s = gitLogContextMenu.value.shortHash;
    hideGitLogContextMenu();
    if (h) onReset(h, mode, s);
  }

  function gitLogCtxCopyHash() {
    const h = gitLogContextMenu.value.hash;
    hideGitLogContextMenu();
    if (h) navigator.clipboard.writeText(h);
  }

  function gitLogCtxCopyMessage() {
    const msg = gitLogContextMenu.value.message;
    hideGitLogContextMenu();
    if (msg) navigator.clipboard.writeText(msg);
  }

  return {
    searchVal,
    gitLogSearchActive,
    clearSearch,
    isGitLogEntryOpen,
    gitHistoryDiffKey,
    handleLogScroll,
    gitLogContextMenu,
    onGitLogContextMenu,
    hideGitLogContextMenu,
    gitLogCtxCherryPick,
    gitLogCtxRevert,
    gitLogCtxCreateTag,
    gitLogCtxCreateBranch,
    gitLogCtxReset,
    gitLogCtxCopyHash,
    gitLogCtxCopyMessage,
  };
}
