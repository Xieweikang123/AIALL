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
        <span class="git-stash-list-hint">点选一条再操作</span>
      </div>
      <div v-if="listOpen" class="git-stash-list-content">
        <div
          v-for="stash in stashes"
          :key="stash.index"
          class="git-stash-item"
          :class="{
            active: selectedIndex === String(stash.index),
            busy: !!stashAction && stashAction.endsWith('-' + stash.index),
          }"
        >
          <button
            type="button"
            class="git-stash-row"
            :title="stash.message || ('stash@{' + stash.index + '}')"
            :disabled="!!stashAction"
            @click="toggleSelect(String(stash.index))"
          >
            <span class="git-stash-label">{{ 'stash@{' + stash.index + '}' }}</span>
            <span class="git-stash-msg">{{ stash.message || '（无说明）' }}</span>
          </button>
          <div v-if="selectedIndex === String(stash.index)" class="git-stash-actions">
            <button
              type="button"
              class="ghost tiny"
              :disabled="!!stashAction"
              title="应用贮藏（保留条目）"
              @click.stop="onAction('apply', stash.index, $event)"
            >{{ stashAction === 'apply-' + stash.index ? '…' : '应用' }}</button>
            <button
              type="button"
              class="ghost tiny"
              :disabled="!!stashAction"
              title="应用并删除此贮藏"
              @click.stop="onAction('pop', stash.index, $event)"
            >{{ stashAction === 'pop-' + stash.index ? '…' : '弹出' }}</button>
            <button
              type="button"
              class="ghost tiny danger"
              :disabled="!!stashAction"
              title="仅删除，不应用改动"
              @click.stop="onAction('drop', stash.index, $event)"
            >{{ stashAction === 'drop-' + stash.index ? '…' : '删除' }}</button>
          </div>
        </div>
      </div>
    </div>
    <div v-else-if="sectionOpen && stashAction === 'list'" class="git-stash-empty shimmer-text--fast">加载中…</div>
    <div v-else-if="sectionOpen" class="git-stash-empty">暂无贮藏</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";

interface GitStash {
  index: number | string;
  message: string;
}

const props = defineProps<{
  sectionOpen: boolean;
  stashes: GitStash[];
  stashMessage: string;
  stashAction: string | null;
  listOpen: boolean;
}>();

const emit = defineEmits<{
  "update:sectionOpen": [value: boolean];
  "update:listOpen": [value: boolean];
  "update:stashMessage": [value: string];
  save: [];
  apply: [index: number | string, event: MouseEvent];
  pop: [index: number | string, event: MouseEvent];
  drop: [index: number | string, event: MouseEvent];
}>();

const selectedIndex = ref<string | null>(null);

watch(
  () => props.stashes.map((s) => String(s.index)).join(","),
  () => {
    if (selectedIndex.value == null) return;
    if (!props.stashes.some((s) => String(s.index) === selectedIndex.value)) {
      selectedIndex.value = null;
    }
  },
);

function toggleSelect(index: string) {
  selectedIndex.value = selectedIndex.value === index ? null : index;
}

function onAction(kind: "apply" | "pop" | "drop", index: number | string, event: MouseEvent) {
  selectedIndex.value = String(index);
  if (kind === "apply") emit("apply", index, event);
  else if (kind === "pop") emit("pop", index, event);
  else emit("drop", index, event);
}
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
  min-width: 0;
  padding: 5px 8px;
  font-size: 12px;
  border-radius: 4px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(0,0,0,0.3);
  color: #c9d1d9;
}
.stash-save-btn { flex-shrink: 0; }
.git-stash-list { padding: 0 12px 8px; display: flex; flex-direction: column; gap: 6px; }
.git-stash-list-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.git-stash-list-hint {
  margin-left: auto;
  font-size: 11px;
  color: rgba(139, 148, 158, 0.55);
}
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
  flex-direction: column;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(255,255,255,0.03);
  border: 1px solid transparent;
  font-size: 12px;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.git-stash-item:hover { background: rgba(255,255,255,0.05); }
.git-stash-item.active {
  background: rgba(56, 139, 253, 0.08);
  border-color: rgba(56, 139, 253, 0.28);
}
.git-stash-item.busy { opacity: 0.75; }
.git-stash-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 0;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.git-stash-row:disabled { cursor: not-allowed; opacity: 0.7; }
.git-stash-label {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: rgba(139,148,158,0.75);
  font-size: 11px;
}
.git-stash-msg {
  width: 100%;
  color: #c9d1d9;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}
.git-stash-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 2px;
}
.git-stash-actions .danger {
  margin-left: auto;
  color: #ff9a9a;
}
.git-stash-empty { font-size: 12px; color: rgba(139,148,158,0.7); padding: 4px 12px 8px; }
</style>
