<template>
  <div class="git-log-section git-section-card" :class="{ 'git-log-section--open': gitLogOpen }">
    <button type="button" class="git-log-toggle" @click="$emit('update:gitLogOpen', !gitLogOpen)">
      <span class="git-section-chevron">{{ gitLogOpen ? "▾" : "▸" }}</span>
      <span>提交历史</span>
      <span v-if="gitLogEntries.length" class="git-log-section-count">{{ gitLogEntries.length }}</span>
    </button>
    <div
      v-if="gitLogOpen"
      class="git-log-search-container"
      :class="{ 'git-log-search-container--loading': gitLogSearchActive }"
    >
      <span v-if="gitLogSearchActive" class="panel-loading-spinner git-log-search-spinner" aria-hidden="true" />
      <span v-else class="git-log-search-icon">🔍</span>
      <input
        v-model="searchVal"
        type="text"
        class="git-log-search-input"
        placeholder="搜索提交信息、哈希或作者..."
        :disabled="gitLogSearchLoading"
        @keyup.enter="$emit('search-git-log', searchVal)"
      />
      <button
        v-if="searchVal && !gitLogSearchActive"
        type="button"
        class="git-log-search-clear"
        @click="clearSearch"
        title="清除搜索"
      >
        ✕
      </button>
    </div>

    <div
      v-if="gitLogOpen"
      class="git-log-list"
      :class="{ 'git-log-list--searching': gitLogSearchLoading }"
      @scroll="handleLogScroll"
    >
      <div v-if="gitLogSearchLoading && !gitLogEntries.length" class="git-log-searching-hint">
        <span class="panel-loading-spinner git-log-search-hint-spinner" aria-hidden="true" />
        <span>正在搜索…</span>
      </div>
      <div v-else-if="!gitLogEntries.length" class="git-log-empty">
        {{ gitLogSearchQuery ? "未找到匹配的提交记录" : "无历史" }}
      </div>
      <div
        v-for="entry in gitLogEntries"
        :key="entry.hash"
        class="git-log-item"
        @contextmenu="onGitLogContextMenu($event, entry)"
      >
        <button type="button" class="git-log-entry-head" @click="$emit('toggle-git-log-entry', entry.hash)">
          <span class="git-log-chevron">{{ isGitLogEntryOpen(entry.hash) ? "▾" : "▸" }}</span>
          <span class="git-log-hash">{{ entry.shortHash }}</span>
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
          <span class="git-log-msg" :title="entry.message">{{ entry.message }}</span>
        </button>
        <div class="git-log-meta-row">
          <span class="git-log-author">{{ entry.author }}</span>
          <span class="git-log-sep">·</span>
          <span class="git-log-date" :title="entry.date">{{ formatDate(entry.date) }}</span>
          <span class="git-log-count">{{ entry.files.length }} 文件</span>
        </div>
        <div v-if="isGitLogEntryOpen(entry.hash)" class="git-log-detail">
          <div class="git-log-meta-expanded">
            <span class="git-log-meta-item"><span class="git-log-meta-label">作者:</span> {{ entry.author }}</span>
            <span class="git-log-meta-item"><span class="git-log-meta-label">日期:</span> {{ formatFullDate(entry.date) }}</span>
          </div>
          <div v-if="entry.message.includes('\n')" class="git-log-full-msg">{{ entry.message }}</div>
          <div class="git-log-files">
            <button
              v-for="file in entry.files"
              :key="`${entry.hash}:${file.oldPath || ''}:${file.path}`"
              type="button"
              class="git-log-file"
              :class="{ loading: gitDiffLoadingKey === gitHistoryDiffKey(entry.hash, file.path, file.oldPath) }"
              :title="file.oldPath ? `${file.oldPath} → ${file.path}` : file.path"
              @click="$emit('open-git-log-file', entry, file)"
            >
              <span class="git-file-status" :class="gitStatusClass(file.status)">
                {{ gitStatusIcon(file.status) }}
              </span>
              <span class="git-file-path">{{ file.oldPath ? `${file.oldPath} → ${file.path}` : file.path }}</span>
            </button>
          </div>
        </div>
      </div>
      <div v-if="gitLogEntries.length && hasMoreGitLog" class="git-log-more-container">
        <button
          type="button"
          class="secondary small git-log-more-btn"
          :disabled="gitLogLoadingMore"
          @click="$emit('load-more-git-log')"
        >
          <span v-if="gitLogLoadingMore" class="panel-loading-spinner git-log-more-spinner" aria-hidden="true" />
          {{ gitLogLoadingMore ? "正在加载…" : "加载更多" }}
        </button>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="gitLogContextMenu.show"
      class="ctx-overlay"
      @click="hideGitLogContextMenu"
      @contextmenu.prevent="hideGitLogContextMenu"
    >
      <div
        class="ctx-menu git-log-ctx-menu"
        :style="{ left: gitLogContextMenu.x + 'px', top: gitLogContextMenu.y + 'px' }"
        @click.stop
      >
        <button type="button" class="ctx-item" @click="gitLogCtxCopyHash">复制提交哈希</button>
        <button type="button" class="ctx-item" @click="gitLogCtxCopyMessage">复制提交消息</button>
        <div class="ctx-sep" />
        <button type="button" class="ctx-item" @click="gitLogCtxCreateBranch">在此创建分支</button>
        <div class="ctx-sep" />
        <button type="button" class="ctx-item" @click="gitLogCtxCherryPick">拣选 (cherry-pick)</button>
        <button type="button" class="ctx-item" @click="gitLogCtxRevert">还原 (revert)</button>
        <div class="ctx-sep" />
        <button type="button" class="ctx-item" @click="gitLogCtxReset('soft')">重置到此提交 (soft)</button>
        <button type="button" class="ctx-item" @click="gitLogCtxReset('mixed')">重置到此提交 (mixed)</button>
        <button type="button" class="ctx-item" @click="gitLogCtxReset('hard')">重置到此提交 (hard)</button>
        <div class="ctx-sep" />
        <button type="button" class="ctx-item" @click="gitLogCtxCreateTag">在此创建标签</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { toRef } from "vue";
import { formatDate, formatFullDate, gitStatusIcon, gitStatusClass } from "../../utils/gitHelpers";
import { useGitPanelLogUi, type GitLogEntryView } from "../../composables/useGitPanelLogUi";

const props = defineProps<{
  gitLogOpen: boolean;
  gitLogEntries: GitLogEntryView[];
  gitLogSearchQuery: string;
  gitLogSearchLoading: boolean;
  hasMoreGitLog: boolean;
  gitLogLoadingMore: boolean;
  gitDiffLoadingKey: string;
  expandedGitLogEntries: Set<string>;
}>();

const emit = defineEmits<{
  (e: "update:gitLogOpen", value: boolean): void;
  (e: "search-git-log", query: string): void;
  (e: "load-more-git-log"): void;
  (e: "toggle-git-log-entry", hash: string): void;
  (e: "open-git-log-file", entry: GitLogEntryView, file: GitLogEntryView["files"][number]): void;
  (e: "do-cherry-pick", hash: string): void;
  (e: "do-revert-commit", hash: string): void;
  (e: "do-create-tag-at", hash: string): void;
  (e: "do-create-branch-at", hash: string): void;
  (e: "reset-to-commit", hash: string, mode: string, shortHash: string): void;
}>();

const {
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
} = useGitPanelLogUi({
  gitLogSearchQuery: toRef(props, "gitLogSearchQuery"),
  gitLogSearchLoading: toRef(props, "gitLogSearchLoading"),
  hasMoreGitLog: toRef(props, "hasMoreGitLog"),
  gitLogLoadingMore: toRef(props, "gitLogLoadingMore"),
  expandedGitLogEntries: toRef(props, "expandedGitLogEntries"),
  onSearch: (query) => emit("search-git-log", query),
  onLoadMore: () => emit("load-more-git-log"),
  onCherryPick: (hash) => emit("do-cherry-pick", hash),
  onRevert: (hash) => emit("do-revert-commit", hash),
  onCreateTag: (hash) => emit("do-create-tag-at", hash),
  onCreateBranch: (hash) => emit("do-create-branch-at", hash),
  onReset: (hash, mode, shortHash) => emit("reset-to-commit", hash, mode, shortHash),
});
</script>

<style src="./styles/GitPanel.scss" scoped></style>
