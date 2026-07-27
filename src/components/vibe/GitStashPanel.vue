<template>
  <div v-if="sectionOpen" class="git-stash-section git-section-card">
    <button type="button" class="git-stash-collapse-toggle" @click="$emit('update:sectionOpen', !sectionOpen)">
      <span class="git-section-chevron">{{ sectionOpen ? "▾" : "▸" }}</span>
      <span class="git-stash-icon">📦</span>
      <span class="git-stash-title">贮藏</span>
      <span v-if="stashes.length" class="git-stash-count">{{ stashes.length }}</span>
    </button>
    <div v-if="sectionOpen" class="git-stash-header">
      <div class="git-stash-save-row">
        <input
          :value="stashMessage"
          class="git-stash-msg-input"
          type="text"
          placeholder="贮藏信息（可选）"
          :disabled="!!stashAction"
          @input="$emit('update:stashMessage', ($event.target as HTMLInputElement).value)"
          @keydown.enter="$emit('save')"
        />
        <button
          type="button"
          class="ghost tiny stash-save-btn"
          :disabled="!!stashAction"
          @click="$emit('save')"
        >
          {{ stashAction === 'save' ? '…' : '贮藏' }}
        </button>
      </div>
    </div>
    <div v-if="sectionOpen && stashes.length" class="git-stash-list">
      <div class="git-stash-list-header">
        <button type="button" class="git-section-toggle" @click="$emit('update:listOpen', !listOpen)">
          <span class="git-section-chevron">{{ listOpen ? "▾" : "▸" }}</span>
          <span class="git-stash-list-title">贮藏列表</span>
        </button>
      </div>
      <div v-if="listOpen" class="git-stash-list-content">
        <div v-for="stash in stashes" :key="stash.index" class="git-stash-item">
          <span class="git-stash-label">{{ 'stash@{' + stash.index + '}' }}</span>
          <span class="git-stash-msg">{{ stash.message }}</span>
          <div class="git-stash-actions">
            <button
              type="button" class="ghost tiny"
              :disabled="!!stashAction"
              @click="$emit('apply', stash.index)"
              title="应用贮藏（保留贮藏）"
            >{{ stashAction === 'apply-' + stash.index ? '…' : 'Apply' }}</button>
            <button
              type="button" class="ghost tiny"
              :disabled="!!stashAction"
              @click="$emit('pop', stash.index)"
              title="弹出贮藏（应用并删除）"
            >{{ stashAction === 'pop-' + stash.index ? '…' : 'Pop' }}</button>
            <button
              type="button" class="ghost tiny danger"
              :disabled="!!stashAction"
              @click="$emit('drop', stash.index)"
              title="移除此贮藏（不应用）"
            >{{ stashAction === 'drop-' + stash.index ? '…' : 'Drop' }}</button>
          </div>
        </div>
      </div>
    </div>
    <div v-else-if="sectionOpen && stashAction === 'list'" class="git-stash-empty shimmer-text--fast">加载中…</div>
    <div v-else-if="sectionOpen" class="git-stash-empty">暂无贮藏</div>
  </div>
</template>

<script setup lang="ts">
import { getEventValue } from "../../utils/vibeHelpers";
interface GitStash {
  index: number | string;
  message: string;
}

defineProps<{
  sectionOpen: boolean;
  stashes: GitStash[];
  stashMessage: string;
  stashAction: string | null;
  listOpen: boolean;
}>();

defineEmits<{
  "update:sectionOpen": [value: boolean];
  "update:listOpen": [value: boolean];
  "update:stashMessage": [value: string];
  save: [];
  apply: [index: number | string];
  pop: [index: number | string];
  drop: [index: number | string];
}>();
</script>

<style scoped>
.git-stash-section {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding-bottom: 4px;
  margin-bottom: 4px;
}
.git-stash-collapse-toggle {
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
.git-stash-collapse-toggle:hover { background: rgba(255,255,255,0.06); }
.git-section-chevron { font-size: 10px; color: rgba(139,148,158,0.6); width: 14px; flex-shrink: 0; }
.git-stash-icon { font-size: 14px; }
.git-stash-title { font-weight: 600; }
.git-stash-count {
  margin-left: auto;
  background: rgba(255,255,255,0.1);
  padding: 0 6px;
  border-radius: 8px;
  font-size: 11px;
  line-height: 18px;
}
.git-stash-header { padding: 0 12px 8px; }
.git-stash-save-row { display: flex; gap: 6px; align-items: center; }
.git-stash-msg-input {
  flex: 1;
  padding: 5px 8px;
  font-size: 12px;
  border-radius: 4px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(0,0,0,0.3);
  color: #c9d1d9;
}
.stash-save-btn { flex-shrink: 0; }
.git-stash-list { padding: 0 12px 8px; display: flex; flex-direction: column; gap: 6px; }
.git-stash-list-header { display: flex; align-items: center; }
.git-section-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  color: var(--text-color, #c9d1d9);
  cursor: pointer;
  font-size: 12px;
  padding: 4px 0;
}
.git-stash-list-content { display: flex; flex-direction: column; gap: 4px; }
.git-stash-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  background: rgba(255,255,255,0.03);
  font-size: 12px;
}
.git-stash-label { font-family: monospace; color: rgba(139,148,158,0.7); flex-shrink: 0; font-size: 11px; }
.git-stash-msg { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.git-stash-actions { display: flex; gap: 4px; flex-shrink: 0; }
.git-stash-empty { font-size: 12px; color: rgba(139,148,158,0.7); padding: 4px 12px 8px; }
</style>
