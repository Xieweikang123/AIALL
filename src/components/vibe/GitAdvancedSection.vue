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
      <div class="git-advanced-group">
        <div class="git-advanced-group-head">
          <span class="git-advanced-group-title">合并分支</span>
          <span class="git-advanced-group-desc">将所选分支合入当前分支</span>
        </div>
        <div class="git-advanced-row">
          <select
            class="git-advanced-select"
            :value="mergeTarget"
            :disabled="!!action"
            @change="$emit('update:mergeTarget', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">选择要合并的分支…</option>
            <option v-for="b in branchesForMerge" :key="'m-' + b.name" :value="b.name">{{ b.name }}</option>
          </select>
          <button
            type="button" class="ghost tiny"
            :disabled="!!action || !mergeTarget"
            @click="$emit('merge')"
          >{{ action === 'merge' ? '…' : '合并' }}</button>
        </div>
      </div>
      <div class="git-advanced-group">
        <div class="git-advanced-group-head">
          <span class="git-advanced-group-title">变基</span>
          <span class="git-advanced-group-desc">将当前分支变基到所选分支</span>
        </div>
        <div class="git-advanced-row">
          <select
            class="git-advanced-select"
            :value="rebaseOnto"
            :disabled="!!action"
            @change="$emit('update:rebaseOnto', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">选择目标分支…</option>
            <option v-for="b in branchesForRebase" :key="'r-' + b.name" :value="b.name">{{ b.name }}</option>
          </select>
          <button
            type="button" class="ghost tiny"
            :disabled="!!action || !rebaseOnto"
            @click="$emit('rebase')"
          >{{ action === 'rebase' ? '…' : '变基' }}</button>
        </div>
      </div>
      <div class="git-advanced-group">
        <div class="git-advanced-group-head">
          <span class="git-advanced-group-title">标签</span>
          <span class="git-advanced-group-desc">为当前 HEAD 创建或管理标签</span>
        </div>
        <div class="git-advanced-row">
          <input
            class="git-advanced-input" type="text"
            placeholder="输入标签名…"
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
      </div>
      <div class="git-advanced-group">
        <div class="git-advanced-group-head">
          <span class="git-advanced-group-title">子模块</span>
          <span class="git-advanced-group-desc">{{ submodules.length ? `${submodules.length} 个子模块` : '无子模块' }}</span>
        </div>
        <div class="git-advanced-row">
          <button
            type="button" class="ghost tiny"
            :disabled="!!action || !submodules.length"
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
  padding: 2px 0;
}
.git-advanced-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 4px;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.85);
  cursor: pointer;
  font-size: 12px;
  border-radius: 4px;
  transition: background 0.15s ease;
}
.git-advanced-toggle:hover { background: rgba(255, 255, 255, 0.06); }
.git-section-chevron { font-size: 10px; color: rgba(139, 148, 158, 0.5); width: 14px; flex-shrink: 0; }
.git-advanced-badge {
  margin-left: auto;
  background: rgba(255, 179, 0, 0.2);
  color: #ffb300;
  padding: 0 6px;
  border-radius: 8px;
  font-size: 11px;
  line-height: 18px;
}
.git-advanced-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 6px 0 4px 20px;
}
.git-advanced-abort-row {
  display: flex;
  gap: 6px;
  padding: 6px 8px;
  background: rgba(248, 81, 73, 0.08);
  border: 1px solid rgba(248, 81, 73, 0.2);
  border-radius: 4px;
}
.git-advanced-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.git-advanced-group-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.git-advanced-group-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
}
.git-advanced-group-desc {
  font-size: 11px;
  color: rgba(139, 148, 158, 0.5);
}
.git-advanced-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.git-advanced-select {
  flex: 1;
  padding: 5px 8px;
  font-size: 12px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(11, 18, 32, 0.6);
  color: rgba(255, 255, 255, 0.85);
}
.git-advanced-select:focus {
  outline: none;
  border-color: rgba(88, 166, 255, 0.5);
}
.git-advanced-input {
  flex: 1;
  padding: 5px 8px;
  font-size: 12px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(11, 18, 32, 0.6);
  color: rgba(255, 255, 255, 0.85);
}
.git-advanced-input:focus {
  outline: none;
  border-color: rgba(88, 166, 255, 0.5);
}
.git-tag-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.git-tag-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 3px 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.03);
}
.git-tag-name {
  flex: 1;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 11px;
  color: #7ee787;
}
.git-submodule-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.git-submodule-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 3px 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.03);
}
.git-submodule-status {
  font-size: 11px;
  color: rgba(139, 148, 158, 0.6);
  min-width: 40px;
}
.git-submodule-path {
  flex: 1;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 11px;
  color: rgba(139, 148, 158, 0.8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
