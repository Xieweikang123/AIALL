<template>
  <div v-if="behind > 0" class="git-behind-section">
    <button type="button" class="git-behind-toggle" @click="$emit('update:open', !open)">
      <span class="git-section-chevron">{{ open ? "▾" : "▸" }}</span>
      <span class="git-behind-title">待拉取提交</span>
      <span class="git-behind-count">{{ behind }}</span>
    </button>
    <div v-if="open" class="git-behind-list">
      <div v-if="loading" class="git-behind-loading">加载中…</div>
      <div v-else-if="!commits.length" class="git-behind-empty">无待拉取提交</div>
      <div
        v-for="entry in commits"
        :key="entry.hash"
        class="git-behind-item"
        :class="{ 'git-behind-item--open': expandedHash === entry.hash }"
      >
        <button
          type="button"
          class="git-behind-entry-head"
          :title="entry.message"
          :aria-expanded="expandedHash === entry.hash"
          @click="toggleCommit(entry.hash)"
        >
          <span class="git-behind-chevron">{{ expandedHash === entry.hash ? "▾" : "▸" }}</span>
          <span class="git-behind-hash">{{ entry.shortHash }}</span>
          <span class="git-behind-msg">{{ entry.message }}</span>
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
          class="git-behind-meta"
          :title="expandedHash === entry.hash ? '收起文件列表' : '展开文件列表'"
          @click="toggleCommit(entry.hash)"
        >
          <span class="git-behind-author">{{ entry.author }}</span>
          <span class="git-behind-date">{{ formatDate(entry.date) }}</span>
          <span class="git-behind-files-count">{{ entry.files.length }} 个文件</span>
          <span class="git-behind-meta-hint">{{ expandedHash === entry.hash ? "收起" : "查看变更" }}</span>
        </button>
        <div v-if="expandedHash === entry.hash" class="git-behind-detail">
          <div v-if="!entry.files.length" class="git-behind-empty">无文件变更</div>
          <button
            v-for="file in entry.files"
            :key="file.path"
            type="button"
            class="git-behind-file"
            :title="`查看 diff：${file.path}`"
            @click.stop="$emit('open-git-log-file', entry, file)"
          >
            <span class="git-behind-file-status" :class="gitStatusClass(file.status)">
              {{ gitStatusIcon(file.status) }}
            </span>
            <span
              v-for="parts in [splitGitFilePath(file.path)]"
              :key="file.path + ':parts'"
              class="git-behind-file-path"
            >
              <span class="git-behind-file-name">{{ parts.name }}</span>
              <span v-if="parts.dir" class="git-behind-file-dir">{{ parts.dir }}</span>
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
  behind: number;
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
.git-behind-section {
  padding: 2px 0;
  contain: layout style;
}
.git-behind-toggle {
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
.git-behind-toggle:hover { background: rgba(255, 255, 255, 0.06); }
.git-section-chevron { font-size: 10px; color: rgba(139, 148, 158, 0.5); width: 14px; flex-shrink: 0; }
.git-behind-title { font-weight: 600; }
.git-behind-count {
  margin-left: auto;
  font-size: 11px;
  color: rgba(139, 148, 158, 0.7);
}
.git-behind-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 0 4px 8px;
}
.git-behind-loading,
.git-behind-empty {
  font-size: 12px;
  color: rgba(139, 148, 158, 0.6);
  padding: 4px 0;
}
.git-behind-item {
  padding: 6px 8px;
  border-radius: 6px;
  border-left: 2px solid rgba(210, 153, 34, 0.35);
  background: rgba(255, 255, 255, 0.02);
  display: flex;
  flex-direction: column;
  gap: 2px;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.git-behind-item:hover {
  background: rgba(255, 255, 255, 0.04);
}
.git-behind-item--open {
  border-left-color: #d29922;
  background: rgba(210, 153, 34, 0.06);
}
.git-behind-entry-head {
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
.git-behind-entry-head:hover .git-behind-msg {
  color: #fff;
}
.git-behind-chevron {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.55);
  flex-shrink: 0;
  width: 12px;
}
.git-behind-hash {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 11px;
  color: #8b949e;
  flex-shrink: 0;
}
.git-behind-msg {
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
.git-behind-meta {
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
.git-behind-meta:hover {
  color: rgba(201, 209, 217, 0.9);
}
.git-behind-author { color: rgba(139, 148, 158, 0.75); }
.git-behind-meta-hint {
  margin-left: auto;
  font-size: 10px;
  color: rgba(88, 166, 255, 0.85);
  opacity: 0;
  transition: opacity 0.12s ease;
}
.git-behind-item:hover .git-behind-meta-hint,
.git-behind-item--open .git-behind-meta-hint {
  opacity: 1;
}
.git-behind-detail {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-top: 4px;
  padding: 4px 0 2px 10px;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  margin-left: 5px;
}
.git-behind-file {
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
.git-behind-file:hover {
  background: rgba(88, 166, 255, 0.12);
}
.git-behind-file:focus-visible {
  outline: 1px solid rgba(88, 166, 255, 0.55);
  outline-offset: 0;
}
.git-behind-file-status {
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
.git-behind-file-status.git-status-added {
  color: #3fb950;
  background: rgba(63, 185, 80, 0.14);
}
.git-behind-file-status.git-status-modified {
  color: #d29922;
  background: rgba(210, 153, 34, 0.14);
}
.git-behind-file-status.git-status-deleted {
  color: #f85149;
  background: rgba(248, 81, 73, 0.14);
}
.git-behind-file-status.git-status-renamed {
  color: #58a6ff;
  background: rgba(88, 166, 255, 0.14);
}
.git-behind-file-status.git-status-untracked,
.git-behind-file-status.git-status-unknown {
  color: #8b949e;
  background: rgba(139, 148, 158, 0.12);
}
.git-behind-file-path {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.git-behind-file-name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #e6edf3;
  font-weight: 550;
}
.git-behind-file-dir {
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
