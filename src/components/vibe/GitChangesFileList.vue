<template>
  <div
    class="git-changes-wrap"
    :class="{ 'git-changes-wrap--compact': !hasExpandedFileList }"
  >
    <div v-if="selectedGitFiles.length" class="git-selection-bar">
      <span class="git-selection-count">已选 {{ selectedGitFiles.length }}</span>
      <button v-if="selectedCanStage" type="button" class="ghost tiny" title="暂存选中" @click="$emit('stage-selected')">暂存</button>
      <button v-if="selectedCanUnstage" type="button" class="ghost tiny" title="取消暂存选中" @click="$emit('unstage-selected')">取消暂存</button>
      <button v-if="selectedCanDiscard" type="button" class="ghost tiny danger" title="丢弃选中" @click="$emit('discard-selected', $event)">丢弃</button>
      <button type="button" class="ghost tiny" title="清除选择" @click="$emit('clear-selection')">清除</button>
    </div>
    <div v-if="!gitStatus.length" class="git-changes-empty">
      <span class="git-changes-empty-icon" aria-hidden="true">✓</span>
      <span>工作区干净，无本地改动</span>
    </div>
    <template v-else>
      <GitConflictList
        :files="gitConflictedFiles"
        @open-file="(path) => $emit('open-file', path)"
        @resolve="(path, side) => $emit('resolve-conflict', path, side)"
      />
      <div v-if="gitStagedFiles.length" class="git-section">
        <div class="git-section-head">
          <button type="button" class="git-section-toggle" @click="$emit('update:gitStagedOpen', !gitStagedOpen)">
            <span class="git-section-chevron">{{ gitStagedOpen ? "▾" : "▸" }}</span>
            <span class="git-section-title">已暂存 ({{ gitStagedFiles.length }})</span>
          </button>
          <button type="button" class="ghost tiny" @click="$emit('unstage-all')">取消全部</button>
        </div>
        <div v-if="gitStagedOpen" class="git-file-list">
          <GitFileTreeNode
            v-for="node in gitStagedTree"
            :key="node.path"
            :node="node"
            staged
            list-scope="staged"
            :expanded-dirs="gitStagedExpandedDirs"
            :selected-git-files="selectedGitFiles"
            :git-diff-loading-key="gitDiffLoadingKey"
            @toggle-dir="(path) => $emit('toggle-tree-dir', path, 'staged')"
            @unstage-file="$emit('unstage-file', $event)"
            @unstage-dir="$emit('unstage-dir', $event)"
            @pointer-down="(event, path, scope) => $emit('on-git-file-pointer-down', event, path, scope)"
            @contextmenu="(event, path, scope) => $emit('on-git-file-contextmenu', event, path, scope)"
            @open-file="(path) => $emit('open-file', path)"
          />
        </div>
      </div>
      <div v-if="gitModifiedFiles.length" class="git-section">
        <div class="git-section-head">
          <button type="button" class="git-section-toggle" @click="$emit('update:gitUnstagedOpen', !gitUnstagedOpen)">
            <span class="git-section-chevron">{{ gitUnstagedOpen ? "▾" : "▸" }}</span>
            <span class="git-section-title">更改 ({{ gitModifiedFiles.length }})</span>
          </button>
          <div class="git-section-actions">
            <button type="button" class="ghost tiny" @click="$emit('stage-all')">全部暂存</button>
            <button type="button" class="ghost tiny danger" @click="$emit('discard-all', $event)">丢弃全部</button>
          </div>
        </div>
        <div v-if="gitUnstagedOpen" class="git-file-list">
          <GitFileTreeNode
            v-for="node in gitModifiedTree"
            :key="`modified:${node.path}`"
            :node="node"
            :staged="false"
            list-scope="modified"
            :expanded-dirs="gitModifiedExpandedDirs"
            :selected-git-files="selectedGitFiles"
            :git-diff-loading-key="gitDiffLoadingKey"
            @toggle-dir="(path) => $emit('toggle-tree-dir', path, 'modified')"
            @stage-file="$emit('stage-file', $event)"
            @discard-file="(path, event) => $emit('discard-file', path, event)"
            @stage-dir="(path) => $emit('stage-dir', path, 'modified')"
            @discard-dir="(path, event) => $emit('discard-dir', path, 'modified', event)"
            @pointer-down="(event, path, scope) => $emit('on-git-file-pointer-down', event, path, scope)"
            @contextmenu="(event, path, scope) => $emit('on-git-file-contextmenu', event, path, scope)"
            @open-file="(path) => $emit('open-file', path)"
          />
        </div>
      </div>
      <div v-if="gitUntrackedFiles.length" class="git-section">
        <div class="git-section-head">
          <button type="button" class="git-section-toggle" @click="$emit('update:gitUntrackedOpen', !gitUntrackedOpen)">
            <span class="git-section-chevron">{{ gitUntrackedOpen ? "▾" : "▸" }}</span>
            <span class="git-section-title">未跟踪 ({{ gitUntrackedFiles.length }})</span>
          </button>
          <div class="git-section-actions">
            <button type="button" class="ghost tiny" @click="$emit('stage-untracked')">暂存未跟踪</button>
          </div>
        </div>
        <div v-if="gitUntrackedOpen" class="git-file-list">
          <GitFileTreeNode
            v-for="node in gitUntrackedTree"
            :key="`untracked:${node.path}`"
            :node="node"
            :staged="false"
            list-scope="untracked"
            :expanded-dirs="gitUntrackedExpandedDirs"
            :selected-git-files="selectedGitFiles"
            :git-diff-loading-key="gitDiffLoadingKey"
            @toggle-dir="(path) => $emit('toggle-tree-dir', path, 'untracked')"
            @stage-file="$emit('stage-file', $event)"
            @discard-file="(path, event) => $emit('discard-file', path, event)"
            @stage-dir="(path) => $emit('stage-dir', path, 'untracked')"
            @discard-dir="(path, event) => $emit('discard-dir', path, 'untracked', event)"
            @pointer-down="(event, path, scope) => $emit('on-git-file-pointer-down', event, path, scope)"
            @contextmenu="(event, path, scope) => $emit('on-git-file-contextmenu', event, path, scope)"
            @open-file="(path) => $emit('open-file', path)"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { GitFileListScope } from "../../utils/gitHelpers";
import GitFileTreeNode from "./GitFileTreeNode.vue";
import GitConflictList from "./GitConflictList.vue";
import type { GitPanelFileInput } from "../../composables/useGitPanelFileTree";

defineProps<{
  gitStatus: unknown[];
  gitStagedFiles: GitPanelFileInput[];
  gitConflictedFiles: GitPanelFileInput[];
  gitModifiedFiles: GitPanelFileInput[];
  gitUntrackedFiles: GitPanelFileInput[];
  gitStagedOpen: boolean;
  gitUnstagedOpen: boolean;
  gitUntrackedOpen: boolean;
  selectedGitFiles: string[];
  gitDiffLoadingKey: string;
  hasExpandedFileList: boolean;
  selectedCanStage: boolean;
  selectedCanUnstage: boolean;
  selectedCanDiscard: boolean;
  gitStagedTree: ReturnType<typeof import("../../utils/gitFileTree").buildGitFileTree>;
  gitModifiedTree: ReturnType<typeof import("../../utils/gitFileTree").buildGitFileTree>;
  gitUntrackedTree: ReturnType<typeof import("../../utils/gitFileTree").buildGitFileTree>;
  gitStagedExpandedDirs: Set<string>;
  gitModifiedExpandedDirs: Set<string>;
  gitUntrackedExpandedDirs: Set<string>;
}>();

defineEmits<{
  (e: "stage-selected"): void;
  (e: "unstage-selected"): void;
  (e: "discard-selected", event: MouseEvent): void;
  (e: "clear-selection"): void;
  (e: "update:gitStagedOpen", value: boolean): void;
  (e: "update:gitUnstagedOpen", value: boolean): void;
  (e: "update:gitUntrackedOpen", value: boolean): void;
  (e: "unstage-all"): void;
  (e: "stage-all"): void;
  (e: "stage-untracked"): void;
  (e: "discard-all", event: MouseEvent): void;
  (e: "stage-file", path: string): void;
  (e: "unstage-file", path: string): void;
  (e: "discard-file", path: string, event: MouseEvent): void;
  (e: "stage-dir", path: string, scope: "modified" | "untracked"): void;
  (e: "unstage-dir", path: string): void;
  (e: "discard-dir", path: string, scope: "modified" | "untracked", event: MouseEvent): void;
  (e: "open-file", path: string): void;
  (e: "resolve-conflict", path: string, side: "ours" | "theirs"): void;
  (e: "toggle-tree-dir", path: string, kind: "staged" | "modified" | "untracked"): void;
  (e: "on-git-file-pointer-down", event: PointerEvent, path: string, listScope: GitFileListScope): void;
  (e: "on-git-file-contextmenu", event: MouseEvent, path: string, listScope: GitFileListScope): void;
}>();
</script>

<style src="./styles/GitPanel.scss" scoped></style>
