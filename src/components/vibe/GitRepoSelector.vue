<template>
  <div ref="repoSelectorRef" class="git-repo-selector">
    <button
      type="button"
      class="git-repo-info-btn"
      :class="{ 'git-repo-info-btn--open': dropdownOpen }"
      title="切换 Git 仓库"
      @click="toggleDropdown"
    >
      <span class="git-repo-icon" aria-hidden="true">⎇</span>
      <span class="git-repo-name" :title="activeRepo?.path || '未选择仓库'">{{ activeRepoLabel }}</span>
      <span class="git-repo-chevron" aria-hidden="true">▾</span>
    </button>

    <div v-if="dropdownOpen" class="git-repo-dropdown">
      <div
        v-for="repo in gitRepos"
        :key="repo.path"
        class="git-repo-item"
        :class="{ active: isActive(repo) }"
        :title="repo.path"
        @click="handleSelect(repo)"
      >
        <span class="git-repo-item-name">{{ repo.name }}</span>
        <span class="git-repo-item-path">{{ repoRelLabel(repo) }}</span>
        <span v-if="isActive(repo)" class="git-repo-item-check" aria-hidden="true">✓</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { GitRepoInfo } from "../../services/vibeGitClient";

const props = defineProps<{
  gitRepos: GitRepoInfo[];
  gitActiveRepoPath: string;
}>();

const emit = defineEmits<{
  (e: "switch-git-repo", repoPath: string): void;
}>();

const dropdownOpen = ref(false);
const repoSelectorRef = ref<HTMLElement | null>(null);

function normalizeRepoPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function isActive(repo: GitRepoInfo): boolean {
  return normalizeRepoPath(repo.path) === normalizeRepoPath(props.gitActiveRepoPath);
}

function repoRelLabel(repo: GitRepoInfo): string {
  if (repo.isRoot) return "项目根";
  return repo.relPath || repo.name;
}

const activeRepo = computed(() =>
  props.gitRepos.find((r) => isActive(r)) || null,
);

const activeRepoLabel = computed(() => {
  const repo = activeRepo.value;
  if (!repo) return "未选择仓库";
  return repo.isRoot ? `${repo.name}（项目根）` : repo.relPath || repo.name;
});

function toggleDropdown() {
  dropdownOpen.value = !dropdownOpen.value;
}

function handleSelect(repo: GitRepoInfo) {
  if (!isActive(repo)) {
    emit("switch-git-repo", repo.path);
  }
  dropdownOpen.value = false;
}

function handleGlobalClick(event: MouseEvent) {
  if (
    dropdownOpen.value
    && repoSelectorRef.value
    && !repoSelectorRef.value.contains(event.target as Node)
  ) {
    dropdownOpen.value = false;
  }
}

onMounted(() => {
  window.addEventListener("click", handleGlobalClick, true);
});

onUnmounted(() => {
  window.removeEventListener("click", handleGlobalClick, true);
});
</script>

<style src="./styles/GitRepoSelector.scss" scoped></style>
