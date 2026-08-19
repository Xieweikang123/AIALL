<template>
  <div class="git-multi-overview">
    <div class="git-multi-toolbar">
      <span class="git-multi-title">全部仓库</span>
      <span class="git-multi-count">{{ entries.length }} 个</span>
      <button type="button" class="ghost tiny" :disabled="loading" @click="$emit('refresh')">
        {{ loading ? "加载中…" : "刷新" }}
      </button>
    </div>
    <p v-if="error" class="git-error">{{ error }}</p>
    <div v-if="loading && !entries.length" class="panel-empty shimmer-text--fast">加载中…</div>
    <div v-else class="git-multi-list">
      <div
        v-for="entry in entries"
        :key="entry.repo.path"
        class="git-multi-card"
        :class="{
          'git-multi-card--expanded': isExpanded(entry.repo.path),
          'git-multi-card--dirty': hasChanges(entry),
          'git-multi-card--behind': !entry.loading && !entry.error && entry.behind > 0,
          'git-multi-card--ahead': !entry.loading && !entry.error && entry.ahead > 0 && entry.behind === 0,
        }"
      >
        <button type="button" class="git-multi-card-head" @click="toggle(entry.repo.path)">
          <span class="git-multi-chevron">{{ isExpanded(entry.repo.path) ? "▾" : "▸" }}</span>
          <span class="git-multi-repo-name" :title="entry.repo.path">{{ entry.repo.name }}</span>
          <span class="git-multi-repo-rel" :title="entry.repo.path">{{ entry.repo.isRoot ? "项目根" : entry.repo.relPath || entry.repo.name }}</span>
          <span class="git-multi-branch" :title="entry.trackingBranch ? `${entry.branch} → ${entry.trackingBranch}` : entry.branch || '未知分支'">{{ entry.branch || "—" }}</span>
          <span class="git-multi-badges">
            <span v-if="entry.loading" class="git-multi-badge loading">…</span>
            <template v-else-if="!entry.error">
              <span v-if="entry.behind > 0" class="git-multi-badge behind" :title="`落后 ${entry.behind} 个提交，需拉取${entry.trackingBranch ? '（' + entry.trackingBranch + '）' : ''}`">↓ {{ entry.behind }} 待拉取</span>
              <span v-if="entry.ahead > 0" class="git-multi-badge ahead" :title="`领先 ${entry.ahead} 个提交，需推送${entry.trackingBranch ? '（' + entry.trackingBranch + '）' : ''}`">↑ {{ entry.ahead }} 待推送</span>
              <span v-if="stagedCount(entry) > 0" class="git-multi-badge staged" :title="`${stagedCount(entry)} 已暂存`">● {{ stagedCount(entry) }}</span>
              <span v-if="unstagedCount(entry) > 0" class="git-multi-badge modified" :title="`${unstagedCount(entry)} 未暂存`">○ {{ unstagedCount(entry) }}</span>
              <span v-if="untrackedCount(entry) > 0" class="git-multi-badge untracked" :title="`${untrackedCount(entry)} 未跟踪`">? {{ untrackedCount(entry) }}</span>
              <span v-if="!hasChanges(entry) && entry.behind === 0 && entry.ahead === 0" class="git-multi-badge clean">干净</span>
            </template>
            <span v-else class="git-multi-badge error" :title="entry.error">失败</span>
          </span>
        </button>

        <div class="git-multi-card-actions">
          <button type="button" class="ghost tiny" @click.stop="$emit('switch-git-repo', entry.repo.path)">进入</button>
          <button
            v-if="entry.behind > 0"
            type="button"
            class="ghost tiny git-multi-action--pull"
            :disabled="entry.loading"
            :title="entry.loading ? '拉取中…' : `拉取 ${entry.trackingBranch || entry.branch}`"
            @click.stop="$emit('pull', entry.repo.path)"
          >
            {{ entry.loading ? "拉取中…" : `↓ 拉取` }}
          </button>
          <button
            v-if="entry.ahead > 0"
            type="button"
            class="ghost tiny git-multi-action--push"
            :disabled="entry.loading"
            :title="entry.loading ? '推送中…' : `推送 ${entry.branch}`"
            @click.stop="$emit('push', entry.repo.path)"
          >
            {{ entry.loading ? "推送中…" : `↑ 推送` }}
          </button>
          <button type="button" class="ghost tiny" :disabled="entry.loading" @click.stop="$emit('refresh-single', entry.repo.path)">刷新</button>
          <button v-if="hasChanges(entry) || entry.behind > 0 || entry.ahead > 0" type="button" class="ghost tiny" @click.stop="$emit('open-repo-folder', entry.repo.path)">打开目录</button>
        </div>

        <p v-if="entry.error" class="git-multi-error">{{ entry.error }}</p>

        <div v-if="isExpanded(entry.repo.path)" class="git-multi-files">
          <div v-if="entry.loading" class="git-multi-files-loading">加载中…</div>
          <div v-else-if="!entry.files.length" class="git-changes-empty">
            <span class="git-changes-empty-icon">✓</span>
            <span>工作区干净</span>
          </div>
          <template v-else>
            <div class="git-multi-file-toolbar">
              <span class="git-multi-file-count">{{ entry.files.length }} 个变更</span>
              <span class="git-multi-file-actions">
                <button type="button" class="ghost tiny" :disabled="!canStageAll(entry)" @click="$emit('stage-all', entry.repo.path)">全部暂存</button>
                <button type="button" class="ghost tiny" :disabled="!canUnstageAll(entry)" @click="$emit('unstage-all', entry.repo.path)">全部取消暂存</button>
              </span>
            </div>
            <div class="git-file-list">
              <div
                v-for="f in entry.files"
                :key="f.path"
                class="git-file-item"
                :class="{ active: f.staged }"
                @click="$emit('open-file', { repoPath: entry.repo.path, filePath: f.path })"
              >
                <span class="git-file-status" :class="statusClass(f.status)">{{ statusLabel(f.status) }}</span>
                <span class="git-file-path">
                  <span class="git-file-path-name">{{ fileName(f.path) }}</span>
                  <span v-if="dirName(f.path)" class="git-file-path-dir">{{ dirName(f.path) }}</span>
                </span>
                <span class="git-file-actions-inline">
                  <span v-if="!f.staged && f.status !== 'conflicted'" class="git-file-btn ghost tiny" @click.stop="$emit('stage-file', { repoPath: entry.repo.path, filePath: f.path })">暂存</span>
                  <span v-else-if="f.staged" class="git-file-btn ghost tiny" @click.stop="$emit('unstage-file', { repoPath: entry.repo.path, filePath: f.path })">取消</span>
                  <span v-if="f.status !== 'conflicted'" class="git-file-btn ghost tiny danger" @click.stop="$emit('discard-file', { repoPath: entry.repo.path, filePath: f.path, event: $event })">丢弃</span>
                </span>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
    <p class="git-multi-hint">总览为只读快照，展开可做暂存/取消/丢弃；提交、分支等仍在单仓视图操作</p>
  </div>
</template>

<script setup lang="ts">
import type { GitRepoInfo, GitStatusFile } from "../../services/vibeGitClient";
import type { MultiRepoEntry } from "../../composables/git/useGitMultiRepoOverview";

const props = defineProps<{
  entries: MultiRepoEntry[];
  loading: boolean;
  error: string;
  expandedKeys: Set<string>;
}>();

const emit = defineEmits<{
  (e: "refresh"): void;
  (e: "refresh-single", repoPath: string): void;
  (e: "switch-git-repo", repoPath: string): void;
  (e: "open-repo-folder", repoPath: string): void;
  (e: "open-file", payload: { repoPath: string; filePath: string }): void;
  (e: "stage-file", payload: { repoPath: string; filePath: string }): void;
  (e: "unstage-file", payload: { repoPath: string; filePath: string }): void;
  (e: "discard-file", payload: { repoPath: string; filePath: string; event: MouseEvent }): void;
  (e: "stage-all", repoPath: string): void;
  (e: "unstage-all", repoPath: string): void;
  (e: "pull", repoPath: string): void;
  (e: "push", repoPath: string): void;
  (e: "fetch", repoPath: string): void;
  (e: "toggle-expanded", repoPath: string): void;
}>();

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
function isExpanded(repoPath: string): boolean {
  return props.expandedKeys.has(normalizePath(repoPath));
}
function toggle(repoPath: string) {
  emit("toggle-expanded", repoPath);
}
function hasChanges(entry: MultiRepoEntry): boolean {
  return entry.files.length > 0;
}
function stagedCount(entry: MultiRepoEntry): number {
  return entry.files.filter((f) => f.staged && f.status !== "conflicted").length;
}
function unstagedCount(entry: MultiRepoEntry): number {
  return entry.files.filter((f) => !f.staged && f.status !== "untracked" && f.status !== "conflicted").length;
}
function untrackedCount(entry: MultiRepoEntry): number {
  return entry.files.filter((f) => f.status === "untracked").length;
}
function canStageAll(entry: MultiRepoEntry): boolean {
  return entry.files.some((f) => !f.staged && f.status !== "conflicted");
}
function canUnstageAll(entry: MultiRepoEntry): boolean {
  return entry.files.some((f) => f.staged);
}
function statusLabel(s: string): string {
  if (s === "added") return "A";
  if (s === "modified") return "M";
  if (s === "deleted") return "D";
  if (s === "renamed") return "R";
  if (s === "untracked") return "?";
  if (s === "conflicted") return "C";
  return s.slice(0, 1).toUpperCase();
}
function statusClass(s: string): string {
  if (s === "added" || s === "untracked") return "git-status-added";
  if (s === "modified") return "git-status-modified";
  if (s === "deleted") return "git-status-deleted";
  if (s === "renamed") return "git-status-renamed";
  return "git-status-unknown";
}
function fileName(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1] || p;
}
function dirName(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx >= 0 ? p.slice(0, idx) : "";
}
</script>

<style src="./styles/GitMultiRepoOverview.scss" scoped></style>
