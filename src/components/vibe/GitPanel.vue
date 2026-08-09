<template>
  <div class="git-panel">
    <div v-if="!projectOpened" class="panel-empty">
      <span class="panel-empty-icon" aria-hidden="true">⎇</span>
      <p class="panel-empty-title">尚未打开项目</p>
      <p class="panel-empty-hint">打开项目后可查看 Git 状态与变更</p>
    </div>
    <div v-else-if="gitLoading && !gitStatusKnown" class="panel-empty">
      <span class="panel-loading-spinner panel-empty-spinner" aria-hidden="true" />
      <p class="panel-empty-title">正在加载 Git 状态…</p>
    </div>
    <div v-else-if="gitIsRepo" class="git-panel-content">
      <GitPanelHeader
        :git-branch="gitBranch"
        :git-branches="gitBranches"
        :git-tracking-branch="gitTrackingBranch"
        :git-remotes="gitRemotes"
        :git-ahead="gitAhead"
        :git-behind="gitBehind"
        :git-stashes="gitStashes"
        :git-loading="gitLoading"
        :git-remote-action="gitRemoteAction"
        :file-watcher-active="fileWatcherActive"
        :file-watcher-connected="fileWatcherConnected"
        :git-ahead-commits="gitAheadCommits"
        :git-ahead-commits-open="gitAheadCommitsOpen"
        :git-ahead-commits-loading="gitAheadCommitsLoading"
        :git-behind-commits="gitBehindCommits"
        :git-behind-commits-open="gitBehindCommitsOpen"
        :git-behind-commits-loading="gitBehindCommitsLoading"
        :git-stash-section-open="gitStashSectionOpen"
        @refresh="$emit('refresh')"
        @do-fetch="$emit('do-fetch')"
        @do-pull="$emit('do-pull')"
        @do-push="$emit('do-push')"
        @checkout-branch="$emit('checkout-branch', $event)"
        @create-branch="$emit('create-branch', $event)"
        @delete-branch="$emit('delete-branch', $event)"
        @update:git-ahead-commits-open="$emit('update:gitAheadCommitsOpen', $event)"
        @update:git-behind-commits-open="$emit('update:gitBehindCommitsOpen', $event)"
        @update:git-stash-section-open="$emit('update:gitStashSectionOpen', $event)"
      />

      <GitStashPanel
        :section-open="stashSectionOpen"
        :stashes="gitStashes"
        :stash-message="gitStashMessage"
        :stash-action="gitStashAction"
        :list-open="gitStashOpen"
        @update:section-open="$emit('update:gitStashSectionOpen', $event)"
        @update:list-open="$emit('update:gitStashOpen', $event)"
        @update:stash-message="$emit('update:gitStashMessage', $event)"
        @save="$emit('do-stash-save')"
        @apply="(index) => $emit('do-stash-apply', index)"
        @pop="(index) => $emit('do-stash-pop', index)"
        @drop="(index) => $emit('do-stash-drop', index)"
      />

      <div v-if="gitError" class="git-error">{{ gitError }}</div>
      <div class="git-work-area" :class="{ 'git-work-area--log-open': gitLogOpen }">
        <div class="git-local-section" :class="{ 'git-local-section--collapsed': gitLogOpen && !localChangesOpen }">
          <button
            v-if="gitLogOpen"
            type="button"
            class="git-local-toggle"
            @click="emit('update:gitLocalChangesOpen', !localChangesOpen)"
          >
            <span class="git-section-chevron">{{ localChangesOpen ? "▾" : "▸" }}</span>
            <span>当前更改</span>
            <span v-if="uniqueChangeCount > 0" class="git-local-count-badge">{{ uniqueChangeCount }}</span>
          </button>

          <div
            v-show="!gitLogOpen || localChangesOpen"
            class="git-local-content"
            :class="{ 'git-local-content--batch-open': batchSectionOpen }"
          >
            <GitCommitBox
              :message="gitCommitMessage"
              :committing="gitCommitting"
              :gen-step="gitGenStep"
              :ai-push-step="gitAiPushStep"
              :staged-count="gitStagedFiles.length"
              :config-ready="configReady"
              :can-commit="canGitCommit"
              :conflict-count="gitConflictedFiles.length"
              :loading="gitLoading"
              @update:message="$emit('update:gitCommitMessage', $event)"
              @commit="$emit('commit-git')"
              @generate-message="$emit('generate-commit-message')"
              @ai-push="$emit('ai-commit-and-push')"
            />

            <GitChangesFileList
              :git-status="gitStatus"
              :git-staged-files="gitStagedFiles"
              :git-conflicted-files="gitConflictedFiles"
              :git-modified-files="gitModifiedFiles"
              :git-untracked-files="gitUntrackedFiles"
              :git-staged-open="gitStagedOpen"
              :git-unstaged-open="gitUnstagedOpen"
              :git-untracked-open="gitUntrackedOpen"
              :selected-git-files="selectedGitFiles"
              :git-diff-loading-key="gitDiffLoadingKey"
              :has-expanded-file-list="hasExpandedFileList"
              :selected-can-stage="selectedCanStage"
              :selected-can-unstage="selectedCanUnstage"
              :selected-can-discard="selectedCanDiscard"
              :git-staged-tree="gitStagedTree"
              :git-modified-tree="gitModifiedTree"
              :git-untracked-tree="gitUntrackedTree"
              :git-staged-expanded-dirs="gitStagedExpandedDirs"
              :git-modified-expanded-dirs="gitModifiedExpandedDirs"
              :git-untracked-expanded-dirs="gitUntrackedExpandedDirs"
              :git-ignored-local-files="gitIgnoredLocalFiles"
              :git-ignored-local-open="gitIgnoredLocalOpen"
              :view-mode="gitChangesViewMode"
              @update:view-mode="setGitChangesViewMode"
              @stage-selected="$emit('stage-selected')"
              @unstage-selected="$emit('unstage-selected')"
              @discard-selected="$emit('discard-selected', $event)"
              @stage-selected-with="$emit('stage-selected-with', $event)"
              @unstage-selected-with="$emit('unstage-selected-with', $event)"
              @discard-selected-with="(path, event) => $emit('discard-selected-with', path, event)"
              @clear-selection="$emit('clear-selection')"
              @update:git-staged-open="$emit('update:gitStagedOpen', $event)"
              @update:git-unstaged-open="$emit('update:gitUnstagedOpen', $event)"
              @update:git-untracked-open="$emit('update:gitUntrackedOpen', $event)"
              @update:git-ignored-local-open="$emit('update:gitIgnoredLocalOpen', $event)"
              @unstage-all="$emit('unstage-all')"
              @stage-all="$emit('stage-all')"
              @stage-untracked="$emit('stage-untracked')"
              @discard-all="$emit('discard-all', $event)"
              @stage-file="$emit('stage-file', $event)"
              @unstage-file="$emit('unstage-file', $event)"
              @discard-file="(path, event) => $emit('discard-file', path, event)"
              @unignore-file="$emit('unignore-file', $event)"
              @stage-dir="(path, scope) => $emit('stage-dir', path, scope)"
              @unstage-dir="$emit('unstage-dir', $event)"
              @discard-dir="(path, scope, event) => $emit('discard-dir', path, scope, event)"
              @open-file="$emit('open-file', $event)"
              @resolve-conflict="(path, side) => $emit('resolve-conflict', path, side)"
              @toggle-tree-dir="(path, kind) => toggleGitTreeDir(path, kind)"
              @on-git-file-pointer-down="(event, path, scope) => $emit('on-git-file-pointer-down', event, path, scope)"
              @on-git-file-contextmenu="(event, path, scope) => $emit('on-git-file-contextmenu', event, path, scope)"
            />

            <GitBatchCommitSection
              :batch-groups="batchGroups"
              :batch-groups-from-ai="batchGroupsFromAi"
              :batch-messages="batchMessages"
              :batch-section-open="batchSectionOpen"
              :batch-committing-index="batchCommittingIndex"
              :ai-batch-grouping="aiBatchGrouping"
              :ai-batch-grouping-step="aiBatchGroupingStep"
              :config-ready="configReady"
              @update:batch-section-open="$emit('update:batchSectionOpen', $event)"
              @update:batch-messages="$emit('update:batchMessages', $event)"
              @ai-batch-groups="$emit('ai-batch-groups')"
              @commit-all-batches="$emit('commit-all-batches', $event)"
              @commit-batch-group="(index, message) => $emit('commit-batch-group', index, message)"
            />
          </div>
        </div>

        <GitLogSection
          :git-log-open="gitLogOpen"
          :git-log-entries="gitLogEntries"
          :git-log-search-query="gitLogSearchQuery"
          :git-log-search-loading="gitLogSearchLoading"
          :git-log-all-branches="gitLogAllBranches"
          :git-log-branch-filter="gitLogBranchFilter"
          :git-branches="gitBranches"
          :git-branch="gitBranch"
          :git-head-commit="gitHeadCommit"
          :git-tracking-branch="gitTrackingBranch"
          :git-ahead="gitAhead"
          :git-behind="gitBehind"
          :git-staged-count="gitStagedFiles.length"
          :git-unstaged-count="gitUnstagedFiles.length"
          :git-conflict-count="gitConflictedFiles.length"
          :git-log-author-filter="gitLogAuthorFilter"
          :git-log-path-filter="gitLogPathFilter"
          :git-log-since="gitLogSince"
          :git-log-until="gitLogUntil"
          :has-more-git-log="hasMoreGitLog"
          :git-log-loading-more="gitLogLoadingMore"
          :git-diff-loading-key="gitDiffLoadingKey"
          :expanded-git-log-entries="expandedGitLogEntries"
          @update:git-log-open="$emit('update:gitLogOpen', $event)"
          @update:git-log-all-branches="$emit('update:gitLogAllBranches', $event)"
          @update:git-log-branch-filter="$emit('update:gitLogBranchFilter', $event)"
          @update-git-log-filters="$emit('update-git-log-filters', $event)"
          @search-git-log="$emit('search-git-log', $event)"
          @load-more-git-log="$emit('load-more-git-log')"
          @toggle-git-log-entry="$emit('toggle-git-log-entry', $event)"
          @open-git-log-file="(entry, file) => $emit('open-git-log-file', entry, file)"
          @do-cherry-pick="$emit('do-cherry-pick', $event)"
          @do-revert-commit="$emit('do-revert-commit', $event)"
          @do-create-tag-at="$emit('do-create-tag-at', $event)"
          @do-create-branch-at="$emit('do-create-branch-at', $event)"
          @reset-to-commit="(hash, mode, shortHash) => $emit('reset-to-commit', hash, mode, shortHash)"
        />
      </div>
    </div>
    <div v-else-if="gitError" class="panel-empty git-panel-fetch-error">
      <p>获取 Git 状态失败</p>
      <p class="git-fetch-error-detail">{{ gitError }}</p>
      <button type="button" class="secondary small" @click="$emit('refresh')">重试</button>
    </div>
    <div v-else-if="gitStatusKnown" class="panel-empty">当前目录不是 Git 仓库</div>
    <div v-else class="panel-empty shimmer-text--fast">加载中…</div>
  </div>
</template>

<script setup lang="ts">
import { computed, toRef, watch } from "vue";
import type { GitRemoteInfo, GitBranchInfo } from "../../services/vibeGitClient";
import type { BatchGroup } from "../../composables/useGitPanel";
import type { GitFileListScope } from "../../utils/gitHelpers";
import { useGitPanelFileTree } from "../../composables/useGitPanelFileTree";
import GitPanelHeader from "./GitPanelHeader.vue";
import GitStashPanel from "./GitStashPanel.vue";
import GitCommitBox from "./GitCommitBox.vue";
import GitChangesFileList from "./GitChangesFileList.vue";
import GitBatchCommitSection from "./GitBatchCommitSection.vue";
import GitLogSection from "./GitLogSection.vue";

interface GitStash {
  index: number | string;
  message: string;
}

interface GitFile {
  path: string;
  status: string;
  staged: boolean;
}

interface GitRef {
  name: string;
  type: "head" | "local" | "remote" | "tag" | "other";
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

interface GitLogFile {
  path: string;
  oldPath?: string;
  status: string;
}

const props = defineProps<{
  projectOpened: boolean;
  gitLoading: boolean;
  gitIsRepo: boolean;
  gitStatusKnown: boolean;
  gitHeadCommit: string;
  gitError: string;
  gitBranch: string;
  gitBranches: GitBranchInfo[];
  gitTrackingBranch: string;
  gitRemotes: GitRemoteInfo[];
  gitAhead: number;
  gitBehind: number;
  gitLogAuthorFilter: string;
  gitLogPathFilter: string;
  gitLogSince: string;
  gitLogUntil: string;
  gitStashes: GitStash[];
  gitStatus: unknown[];
  gitStagedFiles: GitFile[];
  gitUnstagedFiles: GitFile[];
  gitConflictedFiles: GitFile[];
  canGitCommit: boolean;
  gitCommitMessage: string;
  gitCommitting: boolean;
  gitGenStep: string;
  gitAiPushStep: string;
  gitStashAction: string;
  gitStashMessage: string;
  gitStashOpen: boolean;
  gitStagedOpen: boolean;
  gitUnstagedOpen: boolean;
  gitUntrackedOpen: boolean;
  gitLogOpen: boolean;
  gitLogEntries: GitLogEntry[];
  gitLogSearchQuery: string;
  gitLogAllBranches: boolean;
  gitLogBranchFilter: string;
  selectedGitFiles: string[];
  gitDiffLoadingKey: string;
  gitRemoteAction: string;
  configReady: boolean;
  fileWatcherActive: boolean;
  fileWatcherConnected: boolean;
  expandedGitLogEntries: Set<string>;
  batchGroups?: BatchGroup[];
  batchGroupsFromAi?: boolean;
  batchMessages: string[];
  batchSectionOpen: boolean;
  batchCommittingIndex: number | null;
  aiBatchGrouping: boolean;
  aiBatchGroupingStep: string;
  gitAheadCommits: GitLogEntry[];
  gitAheadCommitsOpen: boolean;
  gitAheadCommitsLoading: boolean;
  gitBehindCommits: GitLogEntry[];
  gitBehindCommitsOpen: boolean;
  gitBehindCommitsLoading: boolean;
  hasMoreGitLog: boolean;
  gitLogLoadingMore: boolean;
  gitLogSearchLoading: boolean;
  gitLocalChangesOpen: boolean;
  gitStashSectionOpen: boolean;
  gitIgnoredLocalFiles: string[];
  gitIgnoredLocalOpen: boolean;
}>();

const emit = defineEmits<{
  (e: "refresh"): void;
  (e: "do-fetch"): void;
  (e: "do-pull"): void;
  (e: "do-push"): void;
  (e: "commit-git"): void;
  (e: "generate-commit-message"): void;
  (e: "ai-commit-and-push"): void;
  (e: "stage-file", path: string): void;
  (e: "unstage-file", path: string): void;
  (e: "stage-dir", path: string, scope: "modified" | "untracked"): void;
  (e: "unstage-dir", path: string): void;
  (e: "discard-dir", path: string, scope: "modified" | "untracked", event: MouseEvent): void;
  (e: "stage-all"): void;
  (e: "stage-untracked"): void;
  (e: "unstage-all"): void;
  (e: "stage-selected"): void;
  (e: "unstage-selected"): void;
  (e: "discard-selected", event: MouseEvent): void;
  (e: "stage-selected-with", path: string): void;
  (e: "unstage-selected-with", path: string): void;
  (e: "discard-selected-with", path: string, event: MouseEvent): void;
  (e: "clear-selection"): void;
  (e: "discard-file", path: string, event: MouseEvent): void;
  (e: "discard-all", event: MouseEvent): void;
  (e: "do-stash-save"): void;
  (e: "do-stash-apply", index: number): void;
  (e: "do-stash-pop", index: number | string): void;
  (e: "do-stash-drop", index: number): void;
  (e: "update:gitStashOpen", value: boolean): void;
  (e: "update:gitStagedOpen", value: boolean): void;
  (e: "update:gitUnstagedOpen", value: boolean): void;
  (e: "update:gitUntrackedOpen", value: boolean): void;
  (e: "update:gitLogOpen", value: boolean): void;
  (e: "update:gitLogAllBranches", value: boolean): void;
  (e: "update:gitLogBranchFilter", value: string): void;
  (e: "update-git-log-filters", value: { author: string; path: string; since: string; until: string }): void;
  (e: "update:gitAheadCommitsOpen", value: boolean): void;
  (e: "update:gitBehindCommitsOpen", value: boolean): void;
  (e: "update:gitCommitMessage", value: string): void;
  (e: "update:gitStashMessage", value: string): void;
  (e: "toggle-git-log-entry", hash: string): void;
  (e: "open-git-log-file", entry: GitLogEntry, file: GitLogFile): void;
  (e: "open-file", path: string): void;
  (e: "resolve-conflict", path: string, side: "ours" | "theirs"): void;
  (e: "on-git-file-pointer-down", event: PointerEvent, path: string, listScope: GitFileListScope): void;
  (e: "on-git-file-contextmenu", event: MouseEvent, path: string, listScope: GitFileListScope): void;
  (e: "do-cherry-pick", hash: string): void;
  (e: "do-revert-commit", hash: string): void;
  (e: "do-create-tag-at", hash: string): void;
  (e: "do-create-branch-at", hash: string): void;
  (e: "reset-to-commit", hash: string, mode: string, shortHash: string): void;
  (e: "commit-batch-group", index: number, message: string): void;
  (e: "commit-all-batches", messages: string[]): void;
  (e: "ai-batch-groups"): void;
  (e: "update:batchMessages", messages: string[]): void;
  (e: "update:batchSectionOpen", open: boolean): void;
  (e: "update:gitLocalChangesOpen", open: boolean): void;
  (e: "update:gitStashSectionOpen", open: boolean): void;
  (e: "update:gitIgnoredLocalOpen", open: boolean): void;
  (e: "unignore-file", path: string): void;
  (e: "load-more-git-log"): void;
  (e: "search-git-log", query: string): void;
  (e: "checkout-branch", branchName: string): void;
  (e: "create-branch", branchName: string): void;
  (e: "delete-branch", branchName: string): void;
}>();

const stashSectionOpen = computed(() => props.gitStashSectionOpen);
const localChangesOpen = computed(() => props.gitLocalChangesOpen);

const fileTree = useGitPanelFileTree(
  toRef(props, "gitStagedFiles"),
  toRef(props, "gitUnstagedFiles"),
  toRef(props, "gitConflictedFiles"),
  toRef(props, "gitStagedOpen"),
  toRef(props, "gitUnstagedOpen"),
  toRef(props, "gitUntrackedOpen"),
  toRef(props, "selectedGitFiles"),
);

const {
  gitModifiedFiles,
  gitUntrackedFiles,
  gitStagedTree,
  gitModifiedTree,
  gitUntrackedTree,
  uniqueChangeCount,
  selectedCanStage,
  selectedCanUnstage,
  selectedCanDiscard,
  hasExpandedFileList,
  gitStagedExpandedDirs,
  gitModifiedExpandedDirs,
  gitUntrackedExpandedDirs,
  toggleGitTreeDir,
  gitChangesViewMode,
  setGitChangesViewMode,
} = fileTree;

watch(
  () => props.gitLogOpen,
  (open) => {
    if (open) {
      emit("update:gitStashSectionOpen", false);
      emit("update:batchSectionOpen", false);
      emit("update:gitLocalChangesOpen", false);
    }
  },
);

watch(
  () => props.gitLocalChangesOpen,
  (open) => {
    if (open) emit("update:gitLogOpen", false);
  },
);
</script>

<style src="./styles/GitPanel.scss" scoped></style>
