<template>
  <div class="git-header git-section-card">
    <div class="git-header-row git-branch-row">
      <GitBranchSelector
        :git-branch="gitBranch"
        :git-branches="gitBranches"
        :git-tracking-branch="gitTrackingBranch"
        @checkout-branch="$emit('checkout-branch', $event)"
        @create-branch="$emit('create-branch', $event)"
        @delete-branch="$emit('delete-branch', $event)"
      />
      <div class="git-header-actions">
        <button
          type="button"
          class="ghost tiny"
          :class="{ active: stashSectionOpen }"
          title="贮藏工作区修改"
          @click="$emit('update:gitStashSectionOpen', !stashSectionOpen)"
        >
          <svg class="git-stash-icon" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
            <path fill="currentColor" d="M3.5 1.5h9a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Zm0 8h9a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z"/>
          </svg>
          贮藏<span v-if="gitStashes.length" class="git-stash-btn-count">{{ gitStashes.length }}</span>
        </button>
        <button type="button" class="ghost tiny" :disabled="gitLoading" @click="$emit('refresh')">刷新</button>
        <span
          v-if="fileWatcherActive"
          class="file-watcher-dot"
          :class="{ connected: fileWatcherConnected }"
          :title="fileWatcherConnected ? '文件监控已连接' : '文件监控重连中…'"
        />
      </div>
    </div>
    <div class="git-header-row git-sync-row">
      <div class="git-sync-info">
        <span class="git-sync-stat" :class="{ ahead: gitAhead > 0 }">
          <span class="git-sync-arrow">↑</span>{{ gitAhead }}
        </span>
        <span class="git-sync-stat" :class="{ behind: gitBehind > 0 }">
          <span class="git-sync-arrow">↓</span>{{ gitBehind }}
        </span>
      </div>
      <div class="git-remote-actions">
        <button type="button" class="git-remote-btn" :class="{ 'git-remote-btn--loading': gitRemoteAction === 'fetch' }" :disabled="!!gitRemoteAction || !gitRemotes.length" @click="$emit('do-fetch')">
          {{ gitRemoteAction === 'fetch' ? '…' : 'Fetch' }}
        </button>
        <button type="button" class="git-remote-btn git-remote-btn--pull" :class="{ 'git-remote-btn--loading': gitRemoteAction === 'pull' }" :disabled="!!gitRemoteAction || !gitRemotes.length" @click="$emit('do-pull')">
          {{ gitRemoteAction === 'pull' ? '…' : 'Pull' }}
        </button>
        <button type="button" class="git-remote-btn git-remote-btn--push" :class="{ 'git-remote-btn--loading': gitRemoteAction === 'push', 'git-remote-btn--push--loading': gitRemoteAction === 'push' }" :disabled="!!gitRemoteAction || !gitRemotes.length" @click="$emit('do-push')">
          {{ gitRemoteAction === 'push' ? '…' : 'Push' }}
        </button>
      </div>
      <button
        type="button"
        class="git-remote-link"
        :disabled="!remoteBrowserUrl || !gitRemotes.length"
        title="在浏览器打开远程仓库"
        @click="$emit('open-remote', remoteBrowserUrl)"
      >
        ↗ 仓库
      </button>
    </div>
    <GitAheadCommits
      :ahead="gitAhead"
      :open="gitAheadCommitsOpen"
      :loading="gitAheadCommitsLoading"
      :commits="gitAheadCommits"
      @update:open="$emit('update:gitAheadCommitsOpen', $event)"
    />
    <GitBehindCommits
      :behind="gitBehind"
      :open="gitBehindCommitsOpen"
      :loading="gitBehindCommitsLoading"
      :commits="gitBehindCommits"
      @update:open="$emit('update:gitBehindCommitsOpen', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { GitRemoteInfo, GitBranchInfo } from "../../services/vibeGitClient";
import { toGitRemoteBrowserUrl } from "../../utils/gitHelpers";
import GitBranchSelector from "./GitBranchSelector.vue";
import GitAheadCommits from "./GitAheadCommits.vue";
import GitBehindCommits from "./GitBehindCommits.vue";

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

const props = defineProps<{
  gitBranch: string;
  gitBranches: GitBranchInfo[];
  gitTrackingBranch: string;
  gitRemotes: GitRemoteInfo[];
  gitAhead: number;
  gitBehind: number;
  gitStashes: Array<{ index: number | string; message: string }>;
  gitLoading: boolean;
  gitRemoteAction: string;
  fileWatcherActive: boolean;
  fileWatcherConnected: boolean;
  gitAheadCommits: GitLogEntry[];
  gitAheadCommitsOpen: boolean;
  gitAheadCommitsLoading: boolean;
  gitBehindCommits: GitLogEntry[];
  gitBehindCommitsOpen: boolean;
  gitBehindCommitsLoading: boolean;
  gitStashSectionOpen: boolean;
}>();

defineEmits<{
  (e: "refresh"): void;
  (e: "do-fetch"): void;
  (e: "do-pull"): void;
  (e: "do-push"): void;
  (e: "open-remote", url: string): void;
  (e: "checkout-branch", branchName: string): void;
  (e: "create-branch", branchName: string): void;
  (e: "delete-branch", branchName: string): void;
  (e: "update:gitAheadCommitsOpen", value: boolean): void;
  (e: "update:gitBehindCommitsOpen", value: boolean): void;
  (e: "update:gitStashSectionOpen", value: boolean): void;
}>();

const stashSectionOpen = computed(() => props.gitStashSectionOpen);

const remoteBrowserUrl = computed(() => {
  const first = props.gitRemotes[0];
  return first ? toGitRemoteBrowserUrl(first.url) : "";
});
</script>

<style src="./styles/GitPanel.scss" scoped></style>
