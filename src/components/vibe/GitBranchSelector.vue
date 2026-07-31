<template>
  <div ref="branchSelectorRef" class="git-branch-selector-container">
    <button
      type="button"
      class="git-branch-info-btn"
      :class="{ 'git-branch-info-btn--open': branchDropdownOpen }"
      @click="toggleBranchDropdown"
      title="切换/管理分支"
    >
      <span class="git-branch-icon" aria-hidden="true">⎇</span>
      <span class="git-branch-name">{{ gitBranch }}</span>
      <span class="git-branch-chevron" aria-hidden="true">▾</span>
    </button>
    <span
      v-if="gitTrackingBranch && gitTrackingShortName() !== gitBranch"
      class="git-tracking-badge"
      :title="'跟踪: ' + gitTrackingBranch"
    >
      ⟶ {{ gitTrackingShortName() }}
    </span>

    <div v-if="branchDropdownOpen" class="git-branch-dropdown">
      <div class="git-branch-search-box">
        <input
          v-model="branchSearchQuery"
          type="text"
          class="git-branch-search-input"
          placeholder="搜索分支..."
          @click.stop
        />
      </div>

      <div class="git-branch-create-box" @click.stop>
        <input
          v-model="newBranchName"
          type="text"
          class="git-branch-create-input"
          placeholder="新分支名称..."
          @keyup.enter="handleCreateBranch"
        />
        <button
          type="button"
          class="git-branch-create-btn"
          title="以此 HEAD 新建分支"
          @click="handleCreateBranch"
        >
          新建
        </button>
      </div>

      <div class="git-branch-list">
        <div class="git-branch-group-label">本地分支</div>
        <div v-if="!filteredLocalBranches.length" class="git-branch-empty">
          未找到匹配分支
        </div>
        <div
          v-for="b in filteredLocalBranches"
          :key="b.name"
          class="git-branch-item"
          :class="{ active: b.isCurrent }"
          @click="handleSelectBranch(b)"
        >
          <span class="git-branch-item-name" :title="b.name">{{ b.name }}</span>
          <span
            v-if="b.lastCommitDate"
            class="git-branch-item-date"
            :title="formatFullDate(b.lastCommitDate)"
          >{{ formatDate(b.lastCommitDate) }}</span>
          <div class="git-branch-item-actions">
            <span v-if="b.isCurrent" class="git-branch-active-indicator">✓</span>
            <button
              v-else
              type="button"
              class="git-branch-delete-btn"
              title="删除本地分支"
              @click="handleDeleteBranch(b.name, $event)"
            >
              ✕
            </button>
          </div>
        </div>

        <div class="git-branch-group-label">远程分支</div>
        <div v-if="!filteredRemoteBranches.length" class="git-branch-empty">
          未找到匹配分支
        </div>
        <div
          v-for="b in filteredRemoteBranches"
          :key="b.name"
          class="git-branch-item git-branch-item--remote"
          @click="handleSelectBranch(b)"
        >
          <span class="git-branch-item-name" :title="b.name">{{ b.name }}</span>
          <span
            v-if="b.lastCommitDate"
            class="git-branch-item-date"
            :title="formatFullDate(b.lastCommitDate)"
          >{{ formatDate(b.lastCommitDate) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import type { GitBranchInfo } from "../../services/vibeGitClient";
import { formatDate, formatFullDate } from "../../utils/gitHelpers";

const props = defineProps<{
  gitBranch: string;
  gitBranches: GitBranchInfo[];
  gitTrackingBranch: string;
}>();

const emit = defineEmits<{
  (e: "checkout-branch", branchName: string): void;
  (e: "create-branch", branchName: string): void;
  (e: "delete-branch", branchName: string): void;
}>();

const branchDropdownOpen = ref(false);
const branchSearchQuery = ref("");
const newBranchName = ref("");
const branchSelectorRef = ref<HTMLElement | null>(null);

function compareBranchRecency(a: GitBranchInfo, b: GitBranchInfo): number {
  const ta = a.lastCommitDate ? Date.parse(a.lastCommitDate) : 0;
  const tb = b.lastCommitDate ? Date.parse(b.lastCommitDate) : 0;
  if (tb !== ta) return tb - ta;
  return a.name.localeCompare(b.name);
}

const filteredLocalBranches = computed(() => {
  const query = branchSearchQuery.value.toLowerCase().trim();
  const locals = props.gitBranches.filter((b) => !b.isRemote);
  const filtered = query
    ? locals.filter((b) => b.name.toLowerCase().includes(query))
    : locals;
  return filtered.slice().sort(compareBranchRecency);
});

const filteredRemoteBranches = computed(() => {
  const query = branchSearchQuery.value.toLowerCase().trim();
  const remotes = props.gitBranches.filter((b) => b.isRemote);
  const filtered = query
    ? remotes.filter((b) => b.name.toLowerCase().includes(query))
    : remotes;
  return filtered.slice().sort(compareBranchRecency);
});

function gitTrackingShortName(): string {
  return props.gitTrackingBranch.replace(/^[^/]+\//, "");
}

function toggleBranchDropdown() {
  branchDropdownOpen.value = !branchDropdownOpen.value;
  if (branchDropdownOpen.value) {
    branchSearchQuery.value = "";
    newBranchName.value = "";
  }
}

function handleSelectBranch(branch: GitBranchInfo) {
  emit("checkout-branch", branch.name);
  branchDropdownOpen.value = false;
}

function handleCreateBranch() {
  const name = newBranchName.value.trim();
  if (!name) return;
  emit("create-branch", name);
  newBranchName.value = "";
  branchDropdownOpen.value = false;
}

function handleDeleteBranch(branchName: string, event: Event) {
  event.stopPropagation();
  emit("delete-branch", branchName);
}

function handleGlobalClick(event: MouseEvent) {
  if (
    branchDropdownOpen.value
    && branchSelectorRef.value
    && !branchSelectorRef.value.contains(event.target as Node)
  ) {
    branchDropdownOpen.value = false;
  }
}

onMounted(() => {
  window.addEventListener("click", handleGlobalClick, true);
});

onUnmounted(() => {
  window.removeEventListener("click", handleGlobalClick, true);
});
</script>

<style src="./styles/GitBranchSelector.scss" scoped></style>
