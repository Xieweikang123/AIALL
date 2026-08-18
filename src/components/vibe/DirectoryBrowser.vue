<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="dir-browser-overlay"
      @mousedown.self="emit('close')"
    >
      <div
        class="dir-browser-panel"
        role="dialog"
        aria-modal="true"
        aria-label="选择项目文件夹"
        @mousedown.stop
      >
        <div class="dir-browser-header">
          <div class="dir-browser-title-row">
            <span class="dir-browser-title">选择服务器项目文件夹</span>
            <span class="dir-browser-badge">Web 模式</span>
          </div>
          <button type="button" class="dir-browser-close" title="关闭" @click="emit('close')">✕</button>
        </div>

        <!-- 快捷位置/驱动器盘符 -->
        <div class="dir-browser-shortcuts">
          <span class="shortcuts-label">快捷位置:</span>
          <button
            v-for="drive in quickDrives"
            :key="drive.path"
            type="button"
            class="shortcut-btn"
            :class="{ active: isCurrentPath(drive.path) }"
            @click="navigateTo(drive.path)"
          >
            {{ drive.name }}
          </button>
        </div>

        <div class="dir-browser-path-row">
          <button
            type="button"
            class="dir-browser-nav-btn"
            :disabled="!parentPath"
            title="返回上一级"
            @click="parentPath && navigateTo(parentPath)"
          >
            ⬆
          </button>
          <input
            ref="pathInputRef"
            v-model="currentPath"
            class="dir-browser-path-input"
            placeholder="输入完整路径后按回车跳转（如 D:\project\AIALL）"
            spellcheck="false"
            @keydown.enter="navigateTo(currentPath)"
          />
          <button
            type="button"
            class="dir-browser-go-btn"
            title="跳转到此路径"
            @click="navigateTo(currentPath)"
          >
            跳转
          </button>
        </div>

        <!-- 过滤与统计栏 -->
        <div class="dir-browser-toolbar">
          <div class="dir-browser-stats">
            <span>{{ dirCount }} 个文件夹</span>
            <span v-if="showFiles">, {{ fileCount }} 个文件</span>
          </div>
          <label class="dir-browser-toggle-label">
            <input v-model="showFiles" type="checkbox" />
            <span>显示文件</span>
          </label>
        </div>

        <div v-if="loading" class="dir-browser-loading">
          <span class="dir-browser-spinner" /> 正在加载目录…
        </div>

        <div v-else-if="error" class="dir-browser-error-wrap">
          <p class="dir-browser-error" role="alert">⚠️ {{ error }}</p>
          <div class="dir-browser-error-actions">
            <button v-if="parentPath" type="button" class="dir-browser-btn secondary" @click="navigateTo(parentPath)">
              返回上一级 ({{ parentPath }})
            </button>
            <button type="button" class="dir-browser-btn secondary" @click="navigateTo(guessInitialPath())">
              返回根目录
            </button>
          </div>
        </div>

        <div v-else class="dir-browser-list" role="listbox">
          <button
            v-if="parentPath !== null"
            type="button"
            class="dir-browser-item dir-browser-up"
            @click="navigateTo(parentPath)"
          >
            <span class="dir-browser-item-icon">📁</span>
            <span class="dir-browser-item-name">.. (上一级)</span>
          </button>

          <!-- 文件夹列表 -->
          <button
            v-for="dir in directories"
            :key="dir.path"
            type="button"
            class="dir-browser-item dir-item"
            @click="navigateTo(dir.path)"
          >
            <span class="dir-browser-item-icon">📁</span>
            <span class="dir-browser-item-name">{{ dir.name }}</span>
            <span class="dir-browser-item-action">进入 ›</span>
          </button>

          <!-- 文件列表（仅展示，供用户确认当前目录内容） -->
          <div
            v-for="file in visibleFiles"
            :key="file.path"
            class="dir-browser-item file-item"
          >
            <span class="dir-browser-item-icon">📄</span>
            <span class="dir-browser-item-name">{{ file.name }}</span>
            <span class="dir-browser-file-ext">{{ file.extension || '文件' }}</span>
          </div>

          <p v-if="!directories.length && (!showFiles || !files.length)" class="dir-browser-empty">
            此目录下为空（无子文件夹{{ showFiles ? "或文件" : "" }}）
          </p>
        </div>

        <div class="dir-browser-footer">
          <div class="dir-browser-selected-preview" :title="currentPath">
            当前选择: <code>{{ currentPath || '(未选择)' }}</code>
          </div>
          <div class="dir-browser-footer-actions">
            <button
              type="button"
              class="dir-browser-btn secondary"
              @click="emit('close')"
            >
              取消
            </button>
            <button
              type="button"
              class="dir-browser-btn primary"
              :disabled="!currentPath || loading"
              @click="selectCurrent"
            >
              选择此文件夹打开
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed } from "vue";
import { listDirectory, getSystemDrives, type DriveInfo } from "../../services/vibeCodingClient";

interface Props {
  open: boolean;
  initialPath?: string;
}

const props = withDefaults(defineProps<Props>(), {
  initialPath: "",
});

const emit = defineEmits<{
  (e: "close"): void;
  (e: "select", path: string): void;
}>();

const pathInputRef = ref<HTMLInputElement | null>(null);
const currentPath = ref(props.initialPath);
const parentPath = ref<string | null>(null);
const directories = ref<{ name: string; path: string }[]>([]);
const files = ref<{ name: string; path: string; extension: string }[]>([]);
const loading = ref(false);
const error = ref("");
const showFiles = ref(true);

const serverDrives = ref<DriveInfo[]>([]);
const serverCurrentDir = ref("");

const dirCount = computed(() => directories.value.length);
const fileCount = computed(() => files.value.length);
const visibleFiles = computed(() => (showFiles.value ? files.value : []));

// 从服务端动态获取真实存在的盘符/挂载点
async function loadServerDrives() {
  try {
    const res = await getSystemDrives();
    if (res.ok && res.drives.length > 0) {
      serverDrives.value = res.drives;
      if (res.currentDir) serverCurrentDir.value = res.currentDir;
    }
  } catch {
    // 忽略加载错误
  }
}

// 常用驱动器/快捷位置（基于服务端真实返回）
const quickDrives = computed(() => {
  const list: { name: string; path: string }[] = [];
  if (props.initialPath) {
    list.push({ name: "当前项目", path: props.initialPath });
  } else if (serverCurrentDir.value) {
    list.push({ name: "服务目录", path: serverCurrentDir.value });
  }
  for (const d of serverDrives.value) {
    if (!list.some((item) => isSamePath(item.path, d.path))) {
      list.push({ name: d.name, path: d.path });
    }
  }
  return list;
});

function isSamePath(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();
}

function isCurrentPath(path: string): boolean {
  return isSamePath(currentPath.value, path);
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      await loadServerDrives();
      const start = props.initialPath || serverCurrentDir.value || serverDrives.value[0]?.path || guessInitialPath();
      currentPath.value = start;
      await navigateTo(start);
      await nextTick();
      pathInputRef.value?.focus();
      pathInputRef.value?.select();
    }
  },
);

function guessInitialPath(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Win")) return "D:\\";
  if (ua.includes("Mac")) return "/Users";
  return "/";
}

function normalizeInputPath(raw: string): string {
  let p = raw.trim();
  // 处理 Windows 盘符 D: -> D:\
  if (/^[A-Za-z]:$/.test(p)) {
    p += "\\";
  }
  return p;
}

async function navigateTo(dirPath: string) {
  const normalized = normalizeInputPath(dirPath);
  if (!normalized) return;
  loading.value = true;
  error.value = "";
  try {
    const result = await listDirectory(normalized);
    if (!result.ok) {
      error.value = result.error || `无法访问目录: ${normalized}`;
      directories.value = [];
      files.value = [];
      parentPath.value = getParentPath(normalized);
      return;
    }
    currentPath.value = result.path;
    directories.value = result.items
      .filter((e) => e.isDirectory)
      .map((e) => ({ name: e.name, path: e.path }));
    files.value = result.items
      .filter((e) => !e.isDirectory)
      .map((e) => ({ name: e.name, path: e.path, extension: e.extension }));
    parentPath.value = getParentPath(result.path);
  } catch (e) {
    error.value = (e as Error).message || "加载失败，请检查网络或后端服务";
    directories.value = [];
    files.value = [];
    parentPath.value = getParentPath(normalized);
  } finally {
    loading.value = false;
  }
}

function getParentPath(dirPath: string): string | null {
  const normalized = dirPath.replace(/\\/g, "/").replace(/\/$/, "");
  const lastSep = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (lastSep <= 0) {
    // Windows: "C:" → "C:\\", Unix: "/" → null
    if (/^[A-Za-z]:$/.test(normalized)) return normalized + "\\";
    return null;
  }
  return normalized.slice(0, lastSep) || "/";
}

function selectCurrent() {
  if (currentPath.value) {
    emit("select", currentPath.value.trim());
    emit("close");
  }
}
</script>

<style scoped>
.dir-browser-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}
.dir-browser-panel {
  background: var(--bg-secondary, #1e1e2e);
  border: 1px solid var(--border-color, #333);
  border-radius: 10px;
  width: 520px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
}
.dir-browser-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 10px;
}
.dir-browser-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dir-browser-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #eee);
}
.dir-browser-badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(88, 166, 255, 0.15);
  color: #58a6ff;
  border: 1px solid rgba(88, 166, 255, 0.3);
}
.dir-browser-close {
  background: none;
  border: none;
  color: var(--text-secondary, #999);
  font-size: 16px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}
.dir-browser-close:hover { background: var(--hover-bg, rgba(255,255,255,0.08)); }

.dir-browser-shortcuts {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 18px 8px;
  flex-wrap: wrap;
}
.shortcuts-label {
  font-size: 11px;
  color: var(--text-secondary, #888);
}
.shortcut-btn {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--border-color, #333);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary, #ccc);
  cursor: pointer;
}
.shortcut-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}
.shortcut-btn.active {
  border-color: #58a6ff;
  background: rgba(88, 166, 255, 0.2);
  color: #58a6ff;
}

.dir-browser-path-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 18px 8px;
}
.dir-browser-nav-btn {
  padding: 6px 10px;
  font-size: 13px;
  border-radius: 6px;
  border: 1px solid var(--border-color, #333);
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-primary, #eee);
  cursor: pointer;
}
.dir-browser-nav-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.dir-browser-path-input {
  flex: 1;
  background: var(--bg-primary, #12121a);
  border: 1px solid var(--border-color, #333);
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 12px;
  color: var(--text-primary, #eee);
  font-family: ui-monospace, monospace;
  outline: none;
}
.dir-browser-path-input:focus { border-color: var(--accent, #5b9bf5); }
.dir-browser-go-btn {
  padding: 6px 12px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--border-color, #333);
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary, #eee);
  cursor: pointer;
}
.dir-browser-go-btn:hover { background: rgba(255, 255, 255, 0.15); }

.dir-browser-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 18px 8px;
  font-size: 11px;
  color: var(--text-secondary, #888);
}
.dir-browser-toggle-label {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  user-select: none;
}

.dir-browser-loading, .dir-browser-empty {
  padding: 20px 18px;
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary, #999);
}
.dir-browser-error-wrap {
  padding: 16px 18px;
  text-align: center;
}
.dir-browser-error {
  color: var(--error, #e55);
  font-size: 12px;
  margin: 0 0 10px;
}
.dir-browser-error-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
}

.dir-browser-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--border-color, #555);
  border-top-color: var(--accent, #5b9bf5);
  border-radius: 50%;
  animation: dir-spin 0.6s linear infinite;
  vertical-align: middle;
  margin-right: 6px;
}
@keyframes dir-spin { to { transform: rotate(360deg); } }

.dir-browser-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 10px;
  min-height: 140px;
  max-height: 45vh;
}
.dir-browser-list::-webkit-scrollbar { width: 6px; }
.dir-browser-list::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }

.dir-browser-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  background: none;
  border: none;
  border-radius: 5px;
  text-align: left;
  font-size: 12px;
}
.dir-browser-item.dir-item {
  cursor: pointer;
  color: var(--text-primary, #ddd);
}
.dir-browser-item.dir-item:hover { background: var(--hover-bg, rgba(255,255,255,0.08)); }

.dir-browser-item.file-item {
  color: var(--text-secondary, #888);
  opacity: 0.85;
}

.dir-browser-up { color: var(--text-secondary, #999); cursor: pointer; }
.dir-browser-up:hover { background: var(--hover-bg, rgba(255,255,255,0.06)); }
.dir-browser-item-icon { font-size: 13px; flex-shrink: 0; }
.dir-browser-item-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dir-browser-item-action {
  font-size: 11px;
  color: var(--text-dim, #666);
  flex-shrink: 0;
}
.dir-browser-file-ext {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-dim, #777);
  flex-shrink: 0;
}

.dir-browser-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 18px;
  border-top: 1px solid var(--border-color, #333);
}
.dir-browser-selected-preview {
  font-size: 11px;
  color: var(--text-secondary, #999);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.dir-browser-selected-preview code {
  color: #58a6ff;
  font-family: ui-monospace, monospace;
}
.dir-browser-footer-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.dir-browser-btn {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 12px;
  border: none;
  cursor: pointer;
}
.dir-browser-btn.secondary {
  background: var(--hover-bg, rgba(255,255,255,0.06));
  color: var(--text-primary, #ddd);
}
.dir-browser-btn.primary {
  background: var(--accent, #5b9bf5);
  color: #fff;
}
.dir-browser-btn.primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.dir-browser-btn:hover:not(:disabled) { filter: brightness(1.1); }
</style>
