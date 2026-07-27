<template>
  <div v-if="files.length" class="git-section git-conflict-section">
    <div class="git-section-head">
      <span class="git-section-title git-conflict-title">冲突 ({{ files.length }})</span>
    </div>
    <div class="git-conflict-list">
      <div v-for="file in files" :key="'conflict:' + file.path" class="git-conflict-item">
        <button type="button" class="git-conflict-path" :title="file.path" @click="$emit('openFile', file.path)">
          <span class="git-file-status git-status-conflicted">⚠</span>
          <span class="git-file-path">{{ file.path }}</span>
        </button>
        <div class="git-conflict-actions">
          <button type="button" class="ghost tiny" title="保留当前分支版本（ours）" @click="$emit('resolve', file.path, 'ours')">用当前</button>
          <button type="button" class="ghost tiny" title="保留传入分支版本（theirs）" @click="$emit('resolve', file.path, 'theirs')">用传入</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface GitFile {
  path: string;
}

defineProps<{
  files: GitFile[];
}>();

defineEmits<{
  openFile: [path: string];
  resolve: [path: string, strategy: "ours" | "theirs"];
}>();
</script>

<style scoped>
.git-conflict-section {
  margin-bottom: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(248, 81, 73, 0.08);
  border: 1px solid rgba(248, 81, 73, 0.22);
}
.git-conflict-title { color: #f85149; font-weight: 600; }
.git-conflict-list { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
.git-conflict-item { display: flex; align-items: center; gap: 6px; min-width: 0; }
.git-conflict-path { flex: 1; display: flex; align-items: center; gap: 6px; background: none; border: none; color: inherit; cursor: pointer; padding: 3px 4px; border-radius: 3px; font-size: 12px; min-width: 0; text-align: left; }
.git-conflict-path:hover { background: rgba(255, 255, 255, 0.05); }
.git-conflict-actions { display: flex; gap: 4px; flex-shrink: 0; }
.git-file-status { font-size: 11px; flex-shrink: 0; }
.git-status-conflicted { color: #f85149; }
.git-file-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.git-section-head { display: flex; align-items: center; justify-content: space-between; }
.git-section-title { font-size: 12px; font-weight: 600; color: rgba(255, 255, 255, 0.85); }
</style>
