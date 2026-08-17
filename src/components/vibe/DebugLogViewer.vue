<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="debug-log-overlay"
      @mousedown.self="emit('close')"
    >
      <div
        class="debug-log-panel"
        role="dialog"
        aria-modal="true"
        aria-label="调试日志查看器"
        @mousedown.stop
      >
        <div class="debug-log-header">
          <div class="debug-log-title">
            <span class="debug-log-title-icon" aria-hidden="true">📜</span>
            <span>调试日志</span>
          </div>
          <button type="button" class="debug-log-close" aria-label="关闭" @click="emit('close')">×</button>
        </div>

        <div class="debug-log-toolbar">
          <input
            v-model.trim="fileFilter"
            class="debug-log-input"
            type="text"
            placeholder="过滤日志文件…"
            aria-label="过滤日志文件"
          />
          <input
            v-model.trim="filter"
            class="debug-log-input"
            type="text"
            placeholder="过滤日志内容（关键词）"
            aria-label="过滤日志内容"
          />
          <select v-model.number="limitLines" class="debug-log-limit" aria-label="行数限制">
            <option :value="0">全部</option>
            <option :value="2000">最近 2000 行</option>
            <option :value="500">最近 500 行</option>
          </select>
          <button type="button" class="debug-log-btn" :disabled="loadingList" @click="loadList(true)">刷新</button>
          <button type="button" class="debug-log-btn" :disabled="!content" @click="copyContent">复制</button>
        </div>

        <p v-if="listError" class="debug-log-error" role="alert">{{ listError }}</p>

        <div class="debug-log-body">
          <aside class="debug-log-list">
            <p v-if="!entries.length && !loadingList" class="debug-log-empty">没有可用的日志文件</p>
            <button
              v-for="entry in filteredEntries"
              :key="entry.relativePath"
              type="button"
              class="debug-log-item"
              :class="{ active: entry.relativePath === selectedPath }"
              :title="entry.relativePath"
              @click="selectEntry(entry)"
            >
              <span class="debug-log-item-name">{{ entry.name }}</span>
              <span class="debug-log-item-scope">{{ entry.scope === 'project' ? (entry.projectSlug || '项目') : '全局' }}</span>
            </button>
          </aside>

          <section class="debug-log-content">
            <div v-if="loadingContent" class="debug-log-loading">读取中…</div>
            <p v-else-if="contentError" class="debug-log-error" role="alert">{{ contentError }}</p>
            <pre
              v-else-if="content || readAttempted"
              ref="logPreRef"
              class="debug-log-pre"
            ></pre>
            <div v-else class="debug-log-empty">选择左侧日志文件查看内容</div>
          </section>
        </div>

        <div v-if="selectedPath" class="debug-log-foot">
          <span class="debug-log-foot-path" :title="selectedPath">{{ selectedPath }}</span>
          <span v-if="filter" class="debug-log-foot-hint">匹配 {{ filterMatchCount }} 行</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { ESCAPE_DISMISS_PRIORITY, registerEscapeDismiss } from "../../composables/useEscapeDismiss";
import { listDebugLogs, readDebugLog, type DebugLogEntry } from "../../services/vibeDebugLogClient";

interface Props {
  open: boolean;
}
const props = defineProps<Props>();
const emit = defineEmits<{ (e: "close"): void }>();

registerEscapeDismiss(
  () => props.open,
  () => emit("close"),
  ESCAPE_DISMISS_PRIORITY.MODAL,
);

const entries = ref<DebugLogEntry[]>([]);
const loadingList = ref(false);
const listError = ref("");
const selectedPath = ref("");
const content = ref("");
const loadingContent = ref(false);
const contentError = ref("");
const readAttempted = ref(false);
const limitLines = ref(2000);
const fileFilter = ref("");
const filter = ref("");

const filteredEntries = computed(() => {
  const q = fileFilter.value.trim().toLowerCase();
  if (!q) return entries.value;
  return entries.value.filter(
    (e) =>
      e.name.toLowerCase().includes(q)
      || (e.projectSlug || "").toLowerCase().includes(q)
      || e.relativePath.toLowerCase().includes(q),
  );
});

const logPreRef = ref<HTMLPreElement | null>(null);
const filterMatchCount = ref(0);
let filterPending = false;
let filterVersion = 0;

function scheduleFilter() {
  if (filterPending) return;
  filterPending = true;
  requestAnimationFrame(() => {
    filterPending = false;
    const version = ++filterVersion;
    const q = filter.value.trim().toLowerCase();
    if (!q || !content.value) {
      if (logPreRef.value) logPreRef.value.textContent = content.value;
      filterMatchCount.value = content.value ? content.value.split("\n").length : 0;
      return;
    }
    const lines = content.value.split("\n");
    const matched = lines.filter((line) => line.toLowerCase().includes(q));
    if (filterVersion === version) {
      if (logPreRef.value) logPreRef.value.textContent = matched.join("\n");
      filterMatchCount.value = matched.length;
    }
  });
}

watch(content, () => void scheduleFilter());
watch(filter, () => void scheduleFilter());

async function loadList(force = false) {
  if (loadingList.value) return;
  loadingList.value = true;
  listError.value = "";
  try {
    const list = await listDebugLogs();
    entries.value = list;
    if (!selectedPath.value && list.length) {
      const preferred = list.find((e) => e.name === "debug.log") || list[0];
      await selectEntry(preferred);
    } else if (selectedPath.value && force && entries.value.some((e) => e.relativePath === selectedPath.value)) {
      await readCurrent();
    }
  } catch (err) {
    listError.value = err instanceof Error ? err.message : String(err);
  } finally {
    loadingList.value = false;
  }
}

async function selectEntry(entry: DebugLogEntry) {
  selectedPath.value = entry.relativePath;
  await readCurrent();
}

async function readCurrent() {
  if (!selectedPath.value) return;
  loadingContent.value = true;
  contentError.value = "";
  readAttempted.value = true;
  try {
    content.value = await readDebugLog(selectedPath.value, limitLines.value || undefined);
  } catch (err) {
    content.value = "";
    contentError.value = err instanceof Error ? err.message : String(err);
  } finally {
    loadingContent.value = false;
  }
}

async function copyContent() {
  const q = filter.value.trim().toLowerCase();
  let text = content.value;
  if (q && text) {
    text = text.split("\n").filter((line) => line.toLowerCase().includes(q)).join("\n");
  }
  if (!text) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch {
    /* ignore */
  }
}

watch(
  () => props.open,
  async (visible) => {
    if (visible) {
      filter.value = "";
      await nextTick();
      await loadList();
    } else {
      content.value = "";
      contentError.value = "";
      listError.value = "";
      readAttempted.value = false;
      selectedPath.value = "";
      filterMatchCount.value = 0;
      if (logPreRef.value) logPreRef.value.textContent = "";
    }
  },
);

watch(limitLines, () => {
  if (selectedPath.value) void readCurrent();
});
</script>

<style scoped>
.debug-log-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(4, 8, 16, 0.55);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: min(10vh, 80px) 16px 24px;
}

.debug-log-panel {
  width: min(960px, calc(100vw - 32px));
  height: min(78vh, 720px);
  display: flex;
  flex-direction: column;
  background: rgba(17, 24, 39, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.debug-log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.debug-log-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
}

.debug-log-close {
  border: none;
  background: transparent;
  color: rgba(139, 148, 158, 0.9);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
}

.debug-log-close:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

.debug-log-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.debug-log-input {
  flex: 1;
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.92);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 13px;
  outline: none;
}

.debug-log-input::placeholder {
  color: rgba(139, 148, 158, 0.7);
}

.debug-log-limit {
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.92);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 12px;
  appearance: none;
  -webkit-appearance: none;
  background-image: none;
}
.debug-log-limit option {
  background: #1e2738;
  color: rgba(255, 255, 255, 0.92);
}

.debug-log-btn {
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.9);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.debug-log-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}

.debug-log-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.debug-log-error {
  margin: 0;
  padding: 8px 16px;
  font-size: 12px;
  color: #f85149;
  background: rgba(248, 81, 73, 0.08);
}

.debug-log-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.debug-log-list {
  width: 240px;
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.debug-log-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.9);
  text-align: left;
  padding: 8px 10px;
  cursor: pointer;
}

.debug-log-item:hover,
.debug-log-item.active {
  background: rgba(88, 166, 255, 0.14);
}

.debug-log-item-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.debug-log-item-scope {
  font-size: 11px;
  color: rgba(139, 148, 158, 0.8);
}

.debug-log-content {
  flex: 1;
  min-width: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
}

.debug-log-pre {
  margin: 0;
  border: none;
  padding: 12px 14px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  color: rgba(230, 237, 243, 0.92);
  background: transparent;
  white-space: pre-wrap;
  word-break: break-word;
  width: 100%;
  flex: 1 1 auto;
  min-height: 0;
  resize: none;
  cursor: default;
  outline: none;
  appearance: none;
  -webkit-appearance: none;
}

.debug-log-loading,
.debug-log-empty {
  padding: 24px 16px;
  text-align: center;
  font-size: 13px;
  color: rgba(139, 148, 158, 0.8);
}

.debug-log-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 11px;
  color: rgba(139, 148, 158, 0.7);
}

.debug-log-foot-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
