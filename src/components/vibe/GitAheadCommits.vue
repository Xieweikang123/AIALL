<template>
  <div v-if="ahead > 0" class="git-ahead-section">
    <button type="button" class="git-ahead-toggle" @click="$emit('update:open', !open)">
      <span class="git-section-chevron">{{ open ? "▾" : "▸" }}</span>
      <span class="git-ahead-title">待推送提交</span>
      <span class="git-ahead-count">{{ ahead }}</span>
    </button>
    <div v-if="open" class="git-ahead-list">
      <div v-if="loading" class="git-ahead-loading">加载中…</div>
      <div v-else-if="!commits.length" class="git-ahead-empty">无待推送提交</div>
      <div v-for="entry in commits" :key="entry.hash" class="git-ahead-item">
        <div class="git-ahead-entry-head">
          <span class="git-ahead-hash">{{ entry.shortHash }}</span>
          <span v-if="entry.refs && entry.refs.length" class="git-log-refs">
            <span
              v-for="ref in entry.refs"
              :key="ref.name"
              class="git-log-ref"
              :class="'git-log-ref--' + ref.type"
              :title="ref.type + ': ' + ref.name"
            >
              <span v-if="ref.type === 'tag'" class="git-ref-icon">🏷️</span>
              <span v-else-if="ref.type === 'head'" class="git-ref-icon">⎇</span>
              {{ ref.name }}
            </span>
          </span>
          <span class="git-ahead-msg" :title="entry.message">{{ entry.message }}</span>
        </div>
        <div class="git-ahead-meta">
          <span class="git-ahead-date">{{ formatDate(entry.date) }}</span>
          <span class="git-ahead-files">{{ entry.files.length }} 文件</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface GitRef {
  name: string;
  type: "head" | "local" | "remote" | "tag" | "other";
}

interface GitLogFile {
  path: string;
  status: string;
}

interface GitLogEntry {
  hash: string;
  shortHash: string;
  date: string;
  message: string;
  files: GitLogFile[];
  refs?: GitRef[];
}

defineProps<{
  ahead: number;
  open: boolean;
  loading: boolean;
  commits: GitLogEntry[];
}>();

defineEmits<{
  "update:open": [value: boolean];
}>();

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return "刚刚";
    if (diffMins < 60) return `${diffMins}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    if (diffDays < 7) return `${diffDays}天前`;
    return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}
</script>

<style scoped>
.git-ahead-section {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding-bottom: 4px;
  margin-bottom: 4px;
}
.git-ahead-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 12px;
  background: none;
  border: none;
  color: var(--text-color, #c9d1d9);
  cursor: pointer;
  font-size: 12px;
  border-radius: 4px;
  transition: background 0.15s ease;
}
.git-ahead-toggle:hover { background: rgba(255,255,255,0.06); }
.git-section-chevron { font-size: 10px; color: rgba(139,148,158,0.6); width: 14px; flex-shrink: 0; }
.git-ahead-title { font-weight: 600; }
.git-ahead-count {
  margin-left: auto;
  background: rgba(255,255,255,0.1);
  padding: 0 6px;
  border-radius: 8px;
  font-size: 11px;
  line-height: 18px;
}
.git-ahead-list { padding: 0 12px 8px; display: flex; flex-direction: column; gap: 6px; }
.git-ahead-loading, .git-ahead-empty { font-size: 12px; color: rgba(139,148,158,0.7); padding: 4px 0; }
.git-ahead-item {
  padding: 6px 8px;
  border-radius: 4px;
  background: rgba(255,255,255,0.03);
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.git-ahead-entry-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.git-ahead-hash { font-family: monospace; font-size: 11px; color: rgba(139,148,158,0.7); flex-shrink: 0; }
.git-ahead-msg {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
}
.git-log-refs { display: flex; gap: 3px; flex-wrap: wrap; flex-shrink: 0; }
.git-log-ref {
  font-size: 10px;
  padding: 0 4px;
  border-radius: 3px;
  white-space: nowrap;
  line-height: 16px;
}
.git-log-ref--tag { background: rgba(87,171,90,0.2); color: #7ee787; }
.git-log-ref--head { background: rgba(56,139,253,0.2); color: #58a6ff; }
.git-log-ref--local { background: rgba(139,148,158,0.15); color: #8b949e; }
.git-ref-icon { margin-right: 2px; }
.git-ahead-meta { display: flex; gap: 8px; font-size: 11px; color: rgba(139,148,158,0.6); padding-left: 2px; }
</style>
