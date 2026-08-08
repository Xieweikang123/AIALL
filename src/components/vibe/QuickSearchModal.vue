<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="quick-search-overlay"
      @mousedown.self="emit('close')"
    >
      <div
        class="quick-search-panel"
        role="dialog"
        aria-modal="true"
        aria-label="快速搜索"
        @mousedown.stop
      >
        <div class="quick-search-input-row">
          <span class="quick-search-icon" aria-hidden="true">⌕</span>
          <input
            ref="inputRef"
            v-model="query"
            type="search"
            class="quick-search-input"
            placeholder="搜索文件、代码、会话与消息…"
            autocomplete="off"
            spellcheck="false"
            @keydown="onInputKeydown"
          />
          <span v-if="loading" class="quick-search-spinner" aria-hidden="true" />
        </div>

        <div class="quick-search-scope" role="group" aria-label="搜索范围">
          <button
            type="button"
            class="quick-search-scope-btn"
            :class="{ active: scope === 'all' }"
            @click="setScope('all')"
          >
            全部
          </button>
          <button
            type="button"
            class="quick-search-scope-btn"
            :class="{ active: scope === 'files' }"
            :title="scope === 'files' ? '仅按文件名匹配，最快' : '仅搜索文件名'"
            @click="setScope('files')"
          >
            仅文件
          </button>
        </div>

        <p v-if="error" class="quick-search-error" role="alert">{{ error }}</p>

        <div
          v-if="flatItems.length"
          ref="listRef"
          class="quick-search-results"
          role="listbox"
        >
          <template v-for="group in groupedItems" :key="group.label">
            <div class="quick-search-group-label">{{ group.label }}</div>
            <button
              v-for="item in group.items"
              :key="item.id"
              type="button"
              class="quick-search-item"
              :class="{ active: item.id === selectedItem?.id }"
              role="option"
              :aria-selected="item.id === selectedItem?.id"
              @mouseenter="selectedIndex = flatIndexById.get(item.id) ?? selectedIndex"
              @click="selectItem(item)"
            >
              <span class="quick-search-item-icon" aria-hidden="true">{{ iconForKind(item.kind) }}</span>
              <span class="quick-search-item-body">
                <span class="quick-search-item-title">{{ item.title }}</span>
                <span v-if="item.snippet" class="quick-search-item-snippet">{{ item.snippet }}</span>
                <span v-else class="quick-search-item-subtitle">{{ item.subtitle }}</span>
              </span>
              <span class="quick-search-item-kind">{{ kindLabel(item.kind) }}</span>
            </button>
          </template>
        </div>

        <div v-else-if="!projectOpened" class="quick-search-empty">
          请先打开项目后再搜索文件、代码与会话
        </div>
        <div v-else-if="query.trim() && !loading" class="quick-search-empty">
          未找到匹配结果
        </div>
        <div v-else-if="!query.trim()" class="quick-search-empty">
          输入关键词搜索文件、代码与 AI 会话
        </div>

        <div class="quick-search-foot">
          <span>↑↓ 选择</span>
          <span>Enter 打开</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { ESCAPE_DISMISS_PRIORITY, registerEscapeDismiss } from "../../composables/useEscapeDismiss";
import {
  flattenQuickSearchGroups,
  groupQuickSearchItems,
  normalizeSearchQuery,
  runQuickSearchRemote,
  type QuickSearchItem,
  type QuickSearchScope,
} from "../../services/vibeQuickSearch";
import { lsGet, lsSet } from "../../utils/localStorageSafe";
import type { PersistedChatMessage, VibeChatSessionMeta } from "../../services/vibeChatStorage";
import { grepContent, searchFiles, searchSymbols, fetchSessionMessages } from "../../services/vibeCodingClient";
import { peekVibeChatSessionMessages } from "../../services/vibeChatStorage";

interface Props {
  open: boolean;
  projectOpened: boolean;
  projectPath: string;
  sessionList: VibeChatSessionMeta[];
  activeSessionId: string;
  getLiveSessionMessages: (sessionId: string) => PersistedChatMessage[] | undefined;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "open-file", payload: { path: string; line?: number }): void;
  (e: "open-session", payload: { sessionId: string; messageId?: string }): void;
}>();

registerEscapeDismiss(() => props.open, () => emit("close"), ESCAPE_DISMISS_PRIORITY.MODAL);

const query = ref("");
const scope = ref<QuickSearchScope>(initialScope());
const loading = ref(false);
const error = ref("");
const selectedIndex = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);

const resultFiles = ref<QuickSearchItem[]>([]);
const resultContent = ref<QuickSearchItem[]>([]);
const resultSymbols = ref<QuickSearchItem[]>([]);
const resultSessions = ref<QuickSearchItem[]>([]);

const QUICK_SEARCH_SCOPE_KEY = "vibe-quick-search-scope";
const DISK_SESSION_CACHE_TTL = 60_000;
const diskSessionCache = new Map<string, { fetchedAt: number; messages: PersistedChatMessage[] }>();

function initialScope(): QuickSearchScope {
  return lsGet(QUICK_SEARCH_SCOPE_KEY) === "files" ? "files" : "all";
}

function sessionCacheKey(projectPath: string, sessionId: string): string {
  return `${projectPath}::${sessionId}`;
}

function readDiskSessionCache(projectPath: string, sessionId: string): PersistedChatMessage[] {
  const key = sessionCacheKey(projectPath, sessionId);
  const entry = diskSessionCache.get(key);
  if (!entry) return [];
  if (Date.now() - entry.fetchedAt > DISK_SESSION_CACHE_TTL) {
    diskSessionCache.delete(key);
    return [];
  }
  return entry.messages;
}

function writeDiskSessionCache(projectPath: string, sessionId: string, messages: PersistedChatMessage[]) {
  diskSessionCache.set(sessionCacheKey(projectPath, sessionId), { fetchedAt: Date.now(), messages });
}

let searchToken = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const groupedItems = computed(() =>
  groupQuickSearchItems({
    files: resultFiles.value,
    content: resultContent.value,
    symbols: resultSymbols.value,
    sessions: resultSessions.value,
  }),
);

const flatItems = computed(() => flattenQuickSearchGroups(groupedItems.value));

const flatIndexById = computed(() => {
  const map = new Map<string, number>();
  flatItems.value.forEach((item, index) => map.set(item.id, index));
  return map;
});

const selectedItem = computed(() => flatItems.value[selectedIndex.value] ?? null);

function buildSessionMessagesMap(): Map<string, PersistedChatMessage[]> {
  const map = new Map<string, PersistedChatMessage[]>();
  for (const session of props.sessionList) {
    const live = props.getLiveSessionMessages(session.id);
    if (live?.length) {
      map.set(session.id, live);
      continue;
    }
    const cached = readDiskSessionCache(props.projectPath, session.id);
    if (cached?.length) {
      map.set(session.id, cached);
      continue;
    }
    const peeked = peekVibeChatSessionMessages(props.projectPath, session.id);
    if (peeked.length) map.set(session.id, peeked);
  }
  return map;
}

async function runSearch() {
  const q = normalizeSearchQuery(query.value);
  if (!q) {
    resultFiles.value = [];
    resultContent.value = [];
    resultSymbols.value = [];
    resultSessions.value = [];
    error.value = "";
    loading.value = false;
    return;
  }
  if (!props.projectOpened || !props.projectPath.trim()) {
    resultFiles.value = [];
    resultContent.value = [];
    resultSymbols.value = [];
    resultSessions.value = [];
    error.value = "";
    loading.value = false;
    return;
  }

  const token = ++searchToken;
  loading.value = true;
  error.value = "";

  const filesOnly = scope.value === "files";
  const sessions = filesOnly ? [] : props.sessionList;
  const sessionMessages = filesOnly ? new Map() : buildSessionMessagesMap();

  try {
    const result = await runQuickSearchRemote({
      projectPath: props.projectPath,
      query: q,
      scope: scope.value,
      sessions,
      sessionMessages,
      searchFiles,
      grepContent,
      searchSymbols: (dir, queryText) => searchSymbols(dir, queryText),
      loadSessionMessages: async (sessionId) => {
        const live = props.getLiveSessionMessages(sessionId);
        if (live?.length) return live;
        const cached = readDiskSessionCache(props.projectPath, sessionId);
        if (cached?.length) return cached;
        const peeked = peekVibeChatSessionMessages(props.projectPath, sessionId);
        if (peeked.length) return peeked;
        const remote = await fetchSessionMessages(props.projectPath, sessionId);
        const messages = remote.ok && Array.isArray(remote.data.messages)
          ? (remote.data.messages as PersistedChatMessage[])
          : [];
        if (messages.length) {
          writeDiskSessionCache(props.projectPath, sessionId, messages);
        }
        return messages;
      },
    });
    if (token !== searchToken) return;
    resultFiles.value = result.files;
    resultContent.value = result.content;
    resultSymbols.value = result.symbols;
    resultSessions.value = result.sessions;
    error.value = result.error || "";
    selectedIndex.value = 0;
  } finally {
    if (token === searchToken) loading.value = false;
  }
}

function scheduleSearch() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runSearch();
  }, 180);
}

function setScope(next: QuickSearchScope) {
  if (scope.value === next) return;
  scope.value = next;
  lsSet(QUICK_SEARCH_SCOPE_KEY, next);
  scheduleSearch();
}

function iconForKind(kind: QuickSearchItem["kind"]): string {
  if (kind === "file") return "📄";
  if (kind === "content") return "⌗";
  if (kind === "symbol") return "ƒ";
  if (kind === "session-title") return "💬";
  return "📝";
}

function kindLabel(kind: QuickSearchItem["kind"]): string {
  if (kind === "file") return "文件";
  if (kind === "content") return "代码";
  if (kind === "symbol") return "符号";
  if (kind === "session-title") return "会话";
  return "消息";
}

function selectItem(item: QuickSearchItem) {
  if (item.kind === "file" || item.kind === "content" || item.kind === "symbol") {
    if (!item.filePath) return;
    emit("open-file", { path: item.filePath, line: item.line });
    emit("close");
    return;
  }
  if (item.sessionId) {
    emit("open-session", { sessionId: item.sessionId, messageId: item.messageId });
    emit("close");
  }
}

function scrollSelectedIntoView() {
  void nextTick(() => {
    const host = listRef.value;
    const active = host?.querySelector(".quick-search-item.active");
    active?.scrollIntoView({ block: "nearest" });
  });
}

function onInputKeydown(e: KeyboardEvent) {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (!flatItems.value.length) return;
    selectedIndex.value = (selectedIndex.value + 1) % flatItems.value.length;
    scrollSelectedIntoView();
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    if (!flatItems.value.length) return;
    selectedIndex.value = (selectedIndex.value - 1 + flatItems.value.length) % flatItems.value.length;
    scrollSelectedIntoView();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    if (selectedItem.value) selectItem(selectedItem.value);
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    emit("close");
  }
}

watch(
  () => props.open,
  async (visible) => {
    if (!visible) {
      query.value = "";
      resultFiles.value = [];
      resultContent.value = [];
      resultSymbols.value = [];
      resultSessions.value = [];
      error.value = "";
      loading.value = false;
      selectedIndex.value = 0;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      return;
    }
    await nextTick();
    inputRef.value?.focus();
    inputRef.value?.select();
  },
);

watch(query, () => {
  selectedIndex.value = 0;
  scheduleSearch();
});
</script>

<style scoped>
.quick-search-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(4, 8, 16, 0.55);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: min(12vh, 96px) 16px 24px;
}

.quick-search-panel {
  width: min(680px, calc(100vw - 32px));
  max-height: min(70vh, 640px);
  display: flex;
  flex-direction: column;
  background: rgba(17, 24, 39, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.quick-search-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.quick-search-icon {
  color: rgba(139, 148, 158, 0.85);
  font-size: 18px;
  line-height: 1;
}

.quick-search-input {
  flex: 1;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.95);
  font-size: 15px;
  outline: none;
}

.quick-search-input::placeholder {
  color: rgba(139, 148, 158, 0.75);
}

.quick-search-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(88, 166, 255, 0.2);
  border-top-color: #58a6ff;
  border-radius: 50%;
  animation: quick-search-spin 0.75s linear infinite;
}

.quick-search-scope {
  display: flex;
  gap: 4px;
  padding: 8px 16px 0;
}

.quick-search-scope-btn {
  padding: 3px 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  background: transparent;
  color: rgba(139, 148, 158, 0.85);
  font-size: 12px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}

.quick-search-scope-btn:hover {
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.05);
}

.quick-search-scope-btn.active {
  color: #58a6ff;
  border-color: rgba(88, 166, 255, 0.45);
  background: rgba(88, 166, 255, 0.12);
}

@keyframes quick-search-spin {
  to { transform: rotate(360deg); }
}

.quick-search-error {
  margin: 0;
  padding: 8px 16px;
  font-size: 12px;
  color: #f85149;
  background: rgba(248, 81, 73, 0.08);
}

.quick-search-results {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.quick-search-group-label {
  padding: 8px 10px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(139, 148, 158, 0.75);
}

.quick-search-item {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: rgba(255, 255, 255, 0.92);
  text-align: left;
  cursor: pointer;
}

.quick-search-item:hover,
.quick-search-item.active {
  background: rgba(88, 166, 255, 0.12);
}

.quick-search-item-icon {
  width: 22px;
  flex-shrink: 0;
  text-align: center;
  line-height: 1.4;
}

.quick-search-item-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.quick-search-item-title {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.quick-search-item-subtitle,
.quick-search-item-snippet {
  font-size: 12px;
  color: rgba(139, 148, 158, 0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.quick-search-item-kind {
  flex-shrink: 0;
  font-size: 10px;
  color: rgba(139, 148, 158, 0.65);
  padding-top: 2px;
}

.quick-search-empty {
  padding: 28px 16px;
  text-align: center;
  font-size: 13px;
  color: rgba(139, 148, 158, 0.8);
}

.quick-search-foot {
  display: flex;
  gap: 14px;
  padding: 10px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 11px;
  color: rgba(139, 148, 158, 0.65);
}
</style>
