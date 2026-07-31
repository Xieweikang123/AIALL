<template>
  <div class="git-log-section git-section-card" :class="{ 'git-log-section--open': gitLogOpen }">
    <button type="button" class="git-log-toggle" @click="$emit('update:gitLogOpen', !gitLogOpen)">
      <span class="git-section-chevron">{{ gitLogOpen ? "▾" : "▸" }}</span>
      <span>提交历史</span>
      <span v-if="gitLogEntries.length" class="git-log-section-count">{{ gitLogEntries.length }}</span>
    </button>
    <div v-if="gitLogOpen" class="git-log-scope" role="group" aria-label="提交历史范围">
      <button
        type="button"
        class="git-log-scope-btn"
        :class="{ active: !gitLogAllBranches }"
        title="仅当前分支"
        @click="$emit('update:gitLogAllBranches', false)"
      >
        当前
      </button>
      <button
        type="button"
        class="git-log-scope-btn"
        :class="{ active: gitLogAllBranches }"
        title="所有分支与标签"
        @click="$emit('update:gitLogAllBranches', true)"
      >
        全部
      </button>
      <select
        class="git-log-branch-select"
        :value="gitLogBranchFilter"
        aria-label="按分支筛选提交历史"
        title="只筛选该分支的提交历史，不会切换当前工作分支"
        @change="$emit('update:gitLogBranchFilter', ($event.target as HTMLSelectElement).value)"
      >
        <option value="">分支：全部</option>
        <option v-for="branch in gitBranches" :key="branch.name" :value="branch.name">
          {{ branch.isRemote ? `远程 / ${branch.name}` : branch.name }}
        </option>
      </select>
    </div>
    <div v-if="gitLogOpen" class="git-log-pointers" aria-label="当前 Git 指针">
      <span class="git-log-pointer git-log-pointer--head">HEAD {{ gitBranch || "(detached)" }}</span>
      <span v-if="gitTrackingBranch" class="git-log-pointer git-log-pointer--remote">远程 {{ shortTrackingBranch }}</span>
      <span v-if="gitAhead" class="git-log-pointer git-log-pointer--ahead">领先 {{ gitAhead }}</span>
      <span v-if="gitBehind" class="git-log-pointer git-log-pointer--behind">落后 {{ gitBehind }}</span>
    </div>
    <div v-if="gitLogOpen" class="git-log-filter-bar">
      <button type="button" class="git-log-filter-toggle" :class="{ active: filtersOpen || hasLocalFilters }" @click="filtersOpen = !filtersOpen">
        筛选<span v-if="hasLocalFilters" class="git-log-filter-badge">已启用</span>
      </button>
      <span v-if="hasLocalFilters" class="git-log-filter-summary">已加载 {{ gitLogEntries.length }} 条</span>
      <button v-if="hasLocalFilters" type="button" class="git-log-filter-clear" title="清除筛选" @click="clearLocalFilters">清除</button>
    </div>
    <div v-if="gitLogOpen && (filtersOpen || hasLocalFilters)" class="git-log-filters">
      <input v-model="authorFilter" class="git-log-filter-input" placeholder="作者" aria-label="按作者筛选" />
      <input v-model="pathFilter" class="git-log-filter-input git-log-filter-path" placeholder="文件路径" aria-label="按文件路径筛选" />
      <input v-model="fromDate" type="date" class="git-log-filter-date" aria-label="起始日期" />
      <input v-model="toDate" type="date" class="git-log-filter-date" aria-label="结束日期" />
    </div>
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
      <div v-else-if="!filteredEntries.length" class="git-log-empty">
        {{ hasLocalFilters || gitLogSearchQuery ? "未找到匹配的提交记录" : "无历史" }}
      </div>
      <div
        v-for="entry in filteredEntries"
        :key="entry.hash"
        class="git-log-item"
        :class="{ 'git-log-item--expanded': isGitLogEntryOpen(entry.hash) }"
        @contextmenu="onGitLogContextMenu($event, entry)"
      >
        <svg class="git-log-graph" :class="{ 'git-log-graph--filtered': hasLocalFilters || gitLogSearchQuery.trim() }" viewBox="0 0 40 44" preserveAspectRatio="none" aria-hidden="true">
            <path
              v-for="lane in graphRow(entry.hash)?.lanesBefore || []"
              :key="`incoming-${lane}`"
              class="git-log-graph-line"
              :style="{ stroke: graphLaneColor(lane) }"
              :d="`M ${graphX(lane)} 0 L ${graphX(lane)} 11`"
            />
            <path
              v-for="lane in graphRow(entry.hash)?.lanesAfter || []"
              :key="`lane-${lane}`"
              class="git-log-graph-line"
              :style="{ stroke: graphLaneColor(lane) }"
              :d="`M ${graphX(lane)} 11 L ${graphX(lane)} 44`"
            />
            <path
              v-for="connection in graphRow(entry.hash)?.connections || []"
              :key="`${connection.fromLane}-${connection.toLane}`"
              class="git-log-graph-line"
              :style="{ stroke: graphLaneColor(connection.toLane) }"
              :d="graphPath(connection.fromLane, connection.toLane)"
            />
            <circle :cx="graphX(graphRow(entry.hash)?.lane || 0)" cy="11" r="3" class="git-log-graph-dot" :style="{ stroke: graphLaneColor(graphRow(entry.hash)?.lane || 0) }" />
          </svg>
        <button type="button" class="git-log-entry-head" @click="$emit('toggle-git-log-entry', entry.hash)">
          <span class="git-log-chevron">{{ isGitLogEntryOpen(entry.hash) ? "▾" : "▸" }}</span>
          <span class="git-log-msg" :title="entry.message">{{ entry.message }}</span>
          <span v-if="(entry.parents?.length || 0) > 1" class="git-log-merge-badge" title="合并提交">合并</span>
        </button>
        <div class="git-log-meta-row">
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
          <span class="git-log-author">{{ entry.author }}</span>
          <span class="git-log-sep">·</span>
          <span class="git-log-date" :title="entry.date">{{ formatDate(entry.date) }}</span>
          <span class="git-log-count">{{ entry.files.length }} 文件</span>
        </div>
        <div v-if="isGitLogEntryOpen(entry.hash)" class="git-log-detail">
          <div class="git-log-meta-expanded">
            <span class="git-log-meta-item"><span class="git-log-meta-label">作者:</span> {{ entry.author }}</span>
            <span class="git-log-meta-item"><span class="git-log-meta-label">日期:</span> {{ formatFullDate(entry.date) }}</span>
            <span v-if="entryAdditions(entry) || entryDeletions(entry)" class="git-log-meta-item git-log-stat-add">+{{ entryAdditions(entry) }}</span>
            <span v-if="entryAdditions(entry) || entryDeletions(entry)" class="git-log-meta-item git-log-stat-delete">-{{ entryDeletions(entry) }}</span>
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
              <span v-if="file.additions || file.deletions" class="git-log-file-stat">+{{ file.additions || 0 }} / -{{ file.deletions || 0 }}</span>
            </button>
          </div>
        </div>
      </div>
      <div v-if="filteredEntries.length && hasMoreGitLog" class="git-log-more-container">
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
  <Teleport to="body">
    <div v-if="preview.show" class="git-log-preview-overlay" @click.self="cancelPreview">
      <div class="git-log-preview" role="dialog" aria-modal="true" aria-label="确认 Git 操作">
        <div class="git-log-preview-title">确认 Git 操作</div>
        <div class="git-log-preview-action">{{ preview.action }}</div>
        <div class="git-log-preview-commit"><code>{{ preview.shortHash }}</code> {{ preview.message }}</div>
        <div class="git-log-preview-meta">作者 {{ preview.author }} · {{ formatFullDate(preview.date) }} · {{ preview.files.length }} 个文件 · <span class="git-log-stat-add">+{{ preview.additions }}</span> <span class="git-log-stat-delete">-{{ preview.deletions }}</span></div>
        <div class="git-log-preview-risk" :class="{ 'git-log-preview-risk--danger': preview.danger }">
          <strong>{{ preview.riskTitle }}</strong>
          <span>{{ preview.riskDetail }}</span>
        </div>
        <div v-if="preview.unstagedCount || preview.stagedCount || preview.conflictCount" class="git-log-preview-worktree">
          当前工作区：{{ preview.stagedCount }} 个已暂存，{{ preview.unstagedCount }} 个未暂存<span v-if="preview.conflictCount">，{{ preview.conflictCount }} 个冲突</span>
        </div>
        <div v-if="preview.files.length" class="git-log-preview-files">
          <span v-for="file in preview.files.slice(0, 8)" :key="file">{{ file }}</span>
          <span v-if="preview.files.length > 8">还有 {{ preview.files.length - 8 }} 个文件</span>
        </div>
        <div class="git-log-preview-actions">
          <button type="button" class="secondary small" @click="cancelPreview">取消</button>
          <button type="button" class="primary small" @click="confirmPreview">继续</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import { formatDate, formatFullDate, gitStatusIcon, gitStatusClass } from "../../utils/gitHelpers";
import { useGitPanelLogUi, type GitLogEntryView } from "../../composables/useGitPanelLogUi";
import { buildGitLogGraph, graphLaneColor, type GitGraphRow } from "../../composables/useGitLogGraph";

const props = defineProps<{
  gitLogOpen: boolean;
  gitLogEntries: GitLogEntryView[];
  gitLogSearchQuery: string;
  gitLogSearchLoading: boolean;
  gitLogAllBranches: boolean;
  gitLogBranchFilter: string;
  gitBranches: import("../../services/vibeGitClient").GitBranchInfo[];
  gitBranch: string;
  gitHeadCommit: string;
  gitTrackingBranch: string;
  gitAhead: number;
  gitBehind: number;
  gitLogAuthorFilter: string;
  gitLogPathFilter: string;
  gitLogSince: string;
  gitLogUntil: string;
  gitStagedCount: number;
  gitUnstagedCount: number;
  gitConflictCount: number;
  hasMoreGitLog: boolean;
  gitLogLoadingMore: boolean;
  gitDiffLoadingKey: string;
  expandedGitLogEntries: Set<string>;
}>();

const emit = defineEmits<{
  (e: "update:gitLogOpen", value: boolean): void;
  (e: "update:gitLogAllBranches", value: boolean): void;
  (e: "update:gitLogBranchFilter", value: string): void;
  (e: "update-git-log-filters", value: { author: string; path: string; since: string; until: string }): void;
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

const authorFilter = ref("");
const pathFilter = ref("");
const fromDate = ref("");
const toDate = ref("");
const filtersOpen = ref(false);
watch(
  () => [props.gitLogAuthorFilter, props.gitLogPathFilter, props.gitLogSince, props.gitLogUntil],
  ([author, path, since, until]) => {
    authorFilter.value = author || "";
    pathFilter.value = path || "";
    fromDate.value = since || "";
    toDate.value = until || "";
  },
  { immediate: true },
);
const hasLocalFilters = computed(() => Boolean(authorFilter.value || pathFilter.value || fromDate.value || toDate.value));
const shortTrackingBranch = computed(() => props.gitTrackingBranch.replace(/^[^/]+\//, ""));
const filteredEntries = computed(() => props.gitLogEntries);
const graphRows = computed(() => buildGitLogGraph(filteredEntries.value));
const graphRowsByHash = computed(() => new Map(graphRows.value.map((row) => [row.entry.hash, row])));
function graphRow(hash: string): GitGraphRow<GitLogEntryView> | undefined { return graphRowsByHash.value.get(hash); }
function graphX(lane: number): number { return 6 + Math.min(lane, 4) * 7; }
function graphPath(fromLane: number, toLane: number): string {
  const from = graphX(fromLane);
  const to = graphX(toLane);
  return `M ${from} 11 C ${from} 19, ${to} 27, ${to} 44`;
}
function entryAdditions(entry: GitLogEntryView) { return entry.files.reduce((sum, file) => sum + (file.additions || 0), 0); }
function entryDeletions(entry: GitLogEntryView) { return entry.files.reduce((sum, file) => sum + (file.deletions || 0), 0); }
function clearLocalFilters() {
  authorFilter.value = "";
  pathFilter.value = "";
  fromDate.value = "";
  toDate.value = "";
  emit("update-git-log-filters", { author: "", path: "", since: "", until: "" });
}
let filterTimer: ReturnType<typeof setTimeout> | null = null;
watch([authorFilter, pathFilter, fromDate, toDate], () => {
  if (filterTimer) clearTimeout(filterTimer);
  filterTimer = setTimeout(() => emit("update-git-log-filters", {
    author: authorFilter.value,
    path: pathFilter.value,
    since: fromDate.value,
    until: toDate.value,
  }), 300);
});

const preview = ref({ show: false, action: "", hash: "", shortHash: "", message: "", author: "", date: "", files: [] as string[], additions: 0, deletions: 0, kind: "", danger: false, riskTitle: "", riskDetail: "", stagedCount: 0, unstagedCount: 0, conflictCount: 0 });
function openPreview(action: string, kind: string, hash: string) {
  const entry = props.gitLogEntries.find((item) => item.hash === hash);
  if (!entry) return;
  const mode = kind.startsWith("reset:") ? kind.slice(6) : kind;
  const risk = mode === "hard"
    ? [true, "高风险：硬重置", "当前提交之后的提交和未提交工作区内容可能丢失。"]
    : mode === "mixed"
      ? [true, "会改变工作区状态", "提交会回退，文件修改会保留但取消暂存。"]
      : mode === "soft"
        ? [false, "会回退 HEAD", "修改会保留并保持暂存状态。"]
        : mode === "cherry-pick"
          ? [props.gitConflictCount > 0, "应用提交到当前分支", "可能产生冲突，完成后需要检查并提交结果。"]
          : mode === "revert"
            ? [false, "生成反向提交", "不会改写历史，但可能与当前修改产生冲突。"]
            : [false, "创建引用", "不会修改现有提交内容。"];
  preview.value = { show: true, action, kind, hash, shortHash: entry.shortHash, message: entry.message.split("\n")[0], author: entry.author, date: entry.date, files: entry.files.map((file) => file.path), additions: entryAdditions(entry), deletions: entryDeletions(entry), danger: risk[0] as boolean, riskTitle: risk[1] as string, riskDetail: risk[2] as string, stagedCount: props.gitStagedCount, unstagedCount: props.gitUnstagedCount, conflictCount: props.gitConflictCount };
}
function cancelPreview() { preview.value.show = false; }
function confirmPreview() {
  const p = preview.value;
  preview.value.show = false;
  if (p.kind === "cherry-pick") emit("do-cherry-pick", p.hash);
  else if (p.kind === "revert") emit("do-revert-commit", p.hash);
  else if (p.kind === "branch") emit("do-create-branch-at", p.hash);
  else if (p.kind.startsWith("reset:")) emit("reset-to-commit", p.hash, p.kind.slice(6), p.shortHash);
  else if (p.kind === "tag") emit("do-create-tag-at", p.hash);
}

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
  onCherryPick: (hash) => openPreview("拣选此提交", "cherry-pick", hash),
  onRevert: (hash) => openPreview("还原此提交", "revert", hash),
  onCreateTag: (hash) => openPreview("在此提交创建标签", "tag", hash),
  onCreateBranch: (hash) => openPreview("从此提交创建分支", "branch", hash),
  onReset: (hash, mode, shortHash) => openPreview(`重置到此提交 (${mode})`, `reset:${mode}`, hash),
});
</script>

<style src="./styles/GitPanel.scss" scoped></style>
