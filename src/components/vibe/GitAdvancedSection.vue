<template>
  <div class="git-advanced-section git-section-card">
    <button
      type="button"
      class="git-advanced-toggle"
      @click="$emit('update:open', !open)"
    >
      <span class="git-section-chevron">{{ open ? "▾" : "▸" }}</span>
      <span>高级</span>
      <span
        v-if="mergeInProgress || rebaseInProgress"
        class="git-advanced-badge"
      >进行中</span>
    </button>
    <div v-if="open" class="git-advanced-body">
      <div v-if="mergeInProgress || rebaseInProgress" class="git-advanced-abort-row">
        <button
          v-if="mergeInProgress"
          type="button" class="ghost tiny danger"
          :disabled="!!action"
          @click="$emit('mergeAbort')"
        >{{ action === 'merge-abort' ? '…' : '中止 Merge' }}</button>
        <button
          v-if="rebaseInProgress"
          type="button" class="ghost tiny danger"
          :disabled="!!action"
          @click="$emit('rebaseAbort')"
        >{{ action === 'rebase-abort' ? '…' : '中止 Rebase' }}</button>
      </div>
      <div class="git-advanced-row">
        <label class="git-advanced-label">Merge</label>
        <select
          class="git-advanced-select"
          :value="mergeTarget"
          :disabled="!!action"
          @change="$emit('update:mergeTarget', ($event.target as HTMLSelectElement).value)"
        >
          <option value="">选择分支…</option>
          <option v-for="b in branchesForMerge" :key="'m-' + b.name" :value="b.name">{{ b.name }}</option>
        </select>
        <button
          type="button" class="ghost tiny"
          :disabled="!!action || !mergeTarget"
          @click="$emit('merge')"
        >{{ action === 'merge' ? '…' : '合并' }}</button>
      </div>
      <div class="git-advanced-row">
        <label class="git-advanced-label">Rebase</label>
        <select
          class="git-advanced-select"
          :value="rebaseOnto"
          :disabled="!!action"
          @change="$emit('update:rebaseOnto', ($event.target as HTMLSelectElement).value)"
        >
          <option value="">选择目标…</option>
          <option v-for="b in branchesForRebase" :key="'r-' + b.name" :value="b.name">{{ b.name }}</option>
        </select>
        <button
          type="button" class="ghost tiny"
          :disabled="!!action || !rebaseOnto"
          @click="$emit('rebase')"
        >{{ action === 'rebase' ? '…' : '变基' }}</button>
      </div>
      <div class="git-advanced-row">
        <label class="git-advanced-label">Tag</label>
        <input
          class="git-advanced-input" type="text"
          placeholder="标签名"
          :value="tagName"
          :disabled="!!action"
          @input="$emit('update:tagName', ($event.target as HTMLInputElement).value)"
          @keydown.enter="$emit('createTag')"
        />
        <button
          type="button" class="ghost tiny"
          :disabled="!!action || !tagName.trim()"
          @click="$emit('createTag')"
        >{{ action === 'tag-create' ? '…' : '创建' }}</button>
      </div>
      <div v-if="tags.length" class="git-tag-list">
        <div v-for="tag in tags.slice(0, 12)" :key="tag.name" class="git-tag-item">
          <span class="git-tag-name" :title="tag.commit">{{ tag.name }}</span>
          <button
            type="button" class="ghost tiny danger"
            :disabled="!!action"
            @click="$emit('deleteTag', tag.name)"
          >删</button>
        </div>
      </div>
      <div class="git-advanced-row">
        <label class="git-advanced-label">Submodule</label>
        <span class="git-advanced-meta">{{ submodules.length ? `${submodules.length} 个` : '无' }}</span>
        <button
          type="button" class="ghost tiny"
          :disabled="!!action"
          @click="$emit('submoduleUpdate')"
        >{{ action === 'submodule' ? '…' : '更新/初始化' }}</button>
      </div>
      <div v-if="submodules.length" class="git-submodule-list">
        <div v-for="sm in submodules" :key="sm.path" class="git-submodule-item">
          <span class="git-submodule-status">{{ sm.status }}</span>
          <span class="git-submodule-path" :title="sm.sha">{{ sm.path }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getEventValue } from "../../utils/vibeHelpers";
interface GitBranchInfo {
  name: string;
}

interface GitTag {
  name: string;
  commit: string;
}

interface GitSubmodule {
  path: string;
  status: string;
  sha?: string;
}

defineProps<{
  open: boolean;
  mergeInProgress: boolean;
  rebaseInProgress: boolean;
  action: string | null;
  mergeTarget: string;
  rebaseOnto: string;
  tagName: string;
  tags: GitTag[];
  submodules: GitSubmodule[];
  branchesForMerge: GitBranchInfo[];
  branchesForRebase: GitBranchInfo[];
}>();

defineEmits<{
  "update:open": [value: boolean];
  "update:mergeTarget": [value: string];
  "update:rebaseOnto": [value: string];
  "update:tagName": [value: string];
  mergeAbort: [];
  rebaseAbort: [];
  merge: [];
  rebase: [];
  createTag: [];
  deleteTag: [name: string];
  submoduleUpdate: [];
}>();
</script>

<style scoped>
.git-advanced-section {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding-bottom: 4px;
  margin-bottom: 4px;
}
.git-advanced-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 12px;
  background: none;
  border: none;
  color: var(--text-color, #c9d1d9);
  cursor: pointer;
  font-size: 12px;
  border-radius: 4px;
  transition: background 0.15s ease;
}
.git-advanced-toggle:hover { background: rgba(255,255,255,0.06); }
.git-section-chevron { font-size: 10px; color: rgba(139,148,158,0.6); width: 14px; flex-shrink: 0; }
.git-advanced-badge {
  margin-left: auto;
  background: rgba(255,179,0,0.2);
  color: #ffb300;
  padding: 0 6px;
  border-radius: 8px;
  font-size: 11px;
  line-height: 18px;
}
.git-advanced-body { padding: 0 12px 8px; display: flex; flex-direction: column; gap: 8px; }
.git-advanced-abort-row { display: flex; gap: 6px; }
.git-advanced-row { display: flex; align-items: center; gap: 6px; }
.git-advanced-label { font-size: 12px; color: rgba(139,148,158,0.8); min-width: 64px; flex-shrink: 0; }
.git-advanced-select {
  flex: 1;
  padding: 4px 6px;
  font-size: 12px;
  border-radius: 4px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(0,0,0,0.3);
  color: #c9d1d9;
}
.git-advanced-input {
  flex: 1;
  padding: 4px 6px;
  font-size: 12px;
  border-radius: 4px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(0,0,0,0.3);
  color: #c9d1d9;
}
.tag-ghost-input { min-width: 0; }
.git-advanced-meta { flex: 1; font-size: 12px; color: rgba(139,148,158,0.6); }
.git-tag-list { display: flex; flex-direction: column; gap: 3px; padding-left: 70px; }
.git-tag-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(255,255,255,0.03);
}
.git-tag-name { flex: 1; font-family: monospace; color: #7ee787; }
.git-submodule-list { display: flex; flex-direction: column; gap: 3px; padding-left: 70px; }
.git-submodule-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(255,255,255,0.03);
}
.git-submodule-status { font-size: 11px; color: rgba(139,148,158,0.6); min-width: 40px; }
.git-submodule-path { flex: 1; font-family: monospace; color: #8b949e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
