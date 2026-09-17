<template>
  <div v-show="ahead > 0" class="git-ahead-section">
    <button type="button" class="git-ahead-toggle" @click="$emit('update:open', !open)">
      <span class="git-section-chevron">{{ open ? "▾" : "▸" }}</span>
      <span class="git-ahead-title">待推送提交</span>
      <span class="git-ahead-count">{{ ahead }}</span>
    </button>
    <div v-show="open" class="git-ahead-list">
      <div v-if="loading" class="git-ahead-loading">加载中…</div>
      <div v-else-if="!commits.length" class="git-ahead-empty">无待推送提交</div>
      <div v-for="entry in commits" :key="entry.hash" class="git-ahead-item">
        <button
          type="button"
          class="git-ahead-entry-head"
          :title="entry.message"
          @click="toggleCommit(entry.hash)"
        >
          <span class="git-ahead-chevron">{{ expandedHash === entry.hash ? "▾" : "▸" }}</span>
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
          <span class="git-ahead-msg">{{ entry.message }}</span>
        </button>
        <div class="git-ahead-meta">
          <span class="git-ahead-date">{{ formatDate(entry.date) }}</span>
          <span class="git-ahead-files">{{ entry.files.length }} 文件</span>
        </div>
        <div v-if="expandedHash === entry.hash" class="git-ahead-detail">
          <div v-if="!entry.files.length" class="git-ahead-empty">无文件变更</div>
          <button
            v-for="file in entry.files"
            :key="file.path"
            type="button"
            class="git-ahead-file"
            :title="file.path"
            @click.stop="$emit('open-git-log-file', entry, file)"
          >
            <span class="git-ahead-file-status" :data-status="file.status">
              {{ statusLabel(file.status) }}
            </span>
            <span class="git-ahead-file-path">{{ file.path }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
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
  author: string;
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
  "open-git-log-file": [entry: GitLogEntry, file: GitLogFile];
}>();

const expandedHash = ref<string>("");

function toggleCommit(hash: string): void {
  expandedHash.value = expandedHash.value === hash ? "" : hash;
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    added: "A",
    modified: "M",
    deleted: "D",
    renamed: "R",
    copied: "C",
    untracked: "?",
  };
  return map[status] ?? status.slice(0, 1).toUpperCase();
}
</script>

<style scoped>
.git-ahead-section {
  padding: 2px 0;
  contain: layout style;
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
  width: 100%;
  padding: 0;
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.git-ahead-chevron {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.5);
  flex-shrink: 0;
  width: 12px;
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
.git-ahead-detail {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-top: 3px;
  padding-left: 18px;
}
.git-ahead-file {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 2px 4px;
  background: none;
  border: none;
  border-radius: 3px;
  color: rgba(255, 255, 255, 0.8);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.git-ahead-file:hover { background: rgba(255, 255, 255, 0.06); }
.git-ahead-file-status {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 10px;
  width: 12px;
  text-align: center;
  color: #8b949e;
  flex-shrink: 0;
}
.git-ahead-file-status[data-status="added"] { color: #7ee787; }
.git-ahead-file-status[data-status="modified"] { color: #d29922; }
.git-ahead-file-status[data-status="deleted"] { color: #f85149; }
.git-ahead-file-status[data-status="renamed"] { color: #58a6ff; }
.git-ahead-file-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
