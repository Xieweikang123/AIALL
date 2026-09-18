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
      <div
        v-for="entry in commits"
        :key="entry.hash"
        class="git-ahead-item"
        :class="{ 'git-ahead-item--open': expandedHash === entry.hash }"
      >
        <button
          type="button"
          class="git-ahead-entry-head"
          :title="entry.message"
          :aria-expanded="expandedHash === entry.hash"
          @click="toggleCommit(entry.hash)"
        >
          <span class="git-ahead-chevron">{{ expandedHash === entry.hash ? "▾" : "▸" }}</span>
          <span class="git-ahead-hash">{{ entry.shortHash }}</span>
          <span class="git-ahead-msg">{{ entry.message }}</span>
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
        </button>
        <button
          type="button"
          class="git-ahead-meta"
          :title="expandedHash === entry.hash ? '收起文件列表' : '展开文件列表'"
          @click="toggleCommit(entry.hash)"
        >
          <span class="git-ahead-date">{{ formatDate(entry.date) }}</span>
          <span class="git-ahead-files-count">{{ entry.files.length }} 个文件</span>
          <span class="git-ahead-meta-hint">{{ expandedHash === entry.hash ? "收起" : "查看变更" }}</span>
        </button>
        <div v-if="expandedHash === entry.hash" class="git-ahead-detail">
          <div v-if="!entry.files.length" class="git-ahead-empty">无文件变更</div>
          <button
            v-for="file in entry.files"
            :key="file.path"
            type="button"
            class="git-ahead-file"
            :title="`查看 diff：${file.path}`"
            @click.stop="$emit('open-git-log-file', entry, file)"
          >
            <span class="git-ahead-file-status" :class="gitStatusClass(file.status)">
              {{ gitStatusIcon(file.status) }}
            </span>
            <span
              v-for="parts in [splitGitFilePath(file.path)]"
              :key="file.path + ':parts'"
              class="git-ahead-file-path"
            >
              <span class="git-ahead-file-name">{{ parts.name }}</span>
              <span v-if="parts.dir" class="git-ahead-file-dir">{{ parts.dir }}</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import {
  formatDate,
  gitStatusClass,
  gitStatusIcon,
  splitGitFilePath,
} from "../../utils/gitHelpers";

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
  gap: 6px;
  padding: 4px 0 4px 8px;
}
.git-ahead-loading,
.git-ahead-empty {
  font-size: 12px;
  color: rgba(139, 148, 158, 0.6);
  padding: 4px 0;
}
.git-ahead-item {
  padding: 6px 8px;
  border-radius: 6px;
  border-left: 2px solid rgba(63, 185, 80, 0.35);
  background: rgba(255, 255, 255, 0.02);
  display: flex;
  flex-direction: column;
  gap: 2px;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.git-ahead-item:hover {
  background: rgba(255, 255, 255, 0.04);
}
.git-ahead-item--open {
  border-left-color: #3fb950;
  background: rgba(63, 185, 80, 0.06);
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
.git-ahead-entry-head:hover .git-ahead-msg {
  color: #fff;
}
.git-ahead-chevron {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.55);
  flex-shrink: 0;
  width: 12px;
}
.git-ahead-hash {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 11px;
  color: #8b949e;
  flex-shrink: 0;
}
.git-ahead-msg {
  font-size: 12px;
  font-weight: 550;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
}
.git-log-refs {
  display: flex;
  gap: 3px;
  flex-wrap: nowrap;
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
}
.git-log-ref {
  font-size: 10px;
  padding: 0 4px;
  border-radius: 3px;
  white-space: nowrap;
  line-height: 16px;
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.git-log-ref--tag { background: rgba(87, 171, 90, 0.2); color: #7ee787; }
.git-log-ref--head { background: rgba(56, 139, 253, 0.2); color: #58a6ff; }
.git-log-ref--local { background: rgba(139, 148, 158, 0.15); color: #8b949e; }
.git-ref-icon { margin-right: 2px; }
.git-ahead-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 1px 0 1px 18px;
  background: none;
  border: none;
  font: inherit;
  font-size: 11px;
  color: rgba(139, 148, 158, 0.65);
  text-align: left;
  cursor: pointer;
  border-radius: 3px;
}
.git-ahead-meta:hover {
  color: rgba(201, 209, 217, 0.9);
}
.git-ahead-meta-hint {
  margin-left: auto;
  font-size: 10px;
  color: rgba(88, 166, 255, 0.85);
  opacity: 0;
  transition: opacity 0.12s ease;
}
.git-ahead-item:hover .git-ahead-meta-hint,
.git-ahead-item--open .git-ahead-meta-hint {
  opacity: 1;
}
.git-ahead-detail {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-top: 4px;
  padding: 4px 0 2px 10px;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  margin-left: 5px;
}
.git-ahead-file {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 6px;
  background: none;
  border: none;
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.88);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease;
}
.git-ahead-file:hover {
  background: rgba(88, 166, 255, 0.12);
}
.git-ahead-file:focus-visible {
  outline: 1px solid rgba(88, 166, 255, 0.55);
  outline-offset: 0;
}
.git-ahead-file-status {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 10px;
  font-weight: 700;
  min-width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  flex-shrink: 0;
}
.git-ahead-file-status.git-status-added {
  color: #3fb950;
  background: rgba(63, 185, 80, 0.14);
}
.git-ahead-file-status.git-status-modified {
  color: #d29922;
  background: rgba(210, 153, 34, 0.14);
}
.git-ahead-file-status.git-status-deleted {
  color: #f85149;
  background: rgba(248, 81, 73, 0.14);
}
.git-ahead-file-status.git-status-renamed {
  color: #58a6ff;
  background: rgba(88, 166, 255, 0.14);
}
.git-ahead-file-status.git-status-untracked,
.git-ahead-file-status.git-status-unknown {
  color: #8b949e;
  background: rgba(139, 148, 158, 0.12);
}
.git-ahead-file-path {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.git-ahead-file-name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #e6edf3;
  font-weight: 550;
}
.git-ahead-file-dir {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
  unicode-bidi: plaintext;
  font-size: 11px;
  color: rgba(139, 148, 158, 0.7);
}
</style>
