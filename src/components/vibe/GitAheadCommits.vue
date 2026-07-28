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
import { formatDate } from "../../utils/gitHelpers";

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
</script>

<style scoped>
.git-ahead-section {
  padding: 2px 0;
}
.git-ahead-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 4px;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.85);
  cursor: pointer;
  font-size: 12px;
  border-radius: 4px;
  transition: background 0.15s ease;
}
.git-ahead-toggle:hover { background: rgba(255, 255, 255, 0.06); }
.git-section-chevron { font-size: 10px; color: rgba(139, 148, 158, 0.5); width: 14px; flex-shrink: 0; }
.git-ahead-title { font-weight: 600; }
.git-ahead-count {
  margin-left: auto;
  font-size: 11px;
  color: rgba(139, 148, 158, 0.7);
}
.git-ahead-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0 4px 20px;
}
.git-ahead-loading,
.git-ahead-empty {
  font-size: 12px;
  color: rgba(139, 148, 158, 0.6);
  padding: 4px 0;
}
.git-ahead-item {
  padding: 5px 8px;
  border-radius: 4px;
  border-left: 2px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  gap: 2px;
  transition: background 0.12s ease;
}
.git-ahead-item:hover {
  background: rgba(255, 255, 255, 0.04);
}
.git-ahead-entry-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.git-ahead-hash {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 11px;
  color: rgba(139, 148, 158, 0.65);
  flex-shrink: 0;
}
.git-ahead-msg {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.88);
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
.git-log-ref--tag { background: rgba(87, 171, 90, 0.2); color: #7ee787; }
.git-log-ref--head { background: rgba(56, 139, 253, 0.2); color: #58a6ff; }
.git-log-ref--local { background: rgba(139, 148, 158, 0.15); color: #8b949e; }
.git-ref-icon { margin-right: 2px; }
.git-ahead-meta {
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: rgba(139, 148, 158, 0.5);
  padding-left: 0;
}
</style>
