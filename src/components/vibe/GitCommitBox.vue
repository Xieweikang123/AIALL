<template>
  <div class="git-commit-box git-section-card">
    <textarea
      ref="inputEl"
      :value="message"
      class="git-commit-input"
      rows="1"
      placeholder="例：修了登录态偶发丢…"
      :disabled="committing || !!genStep || !!aiPushStep"
      @input="onInput"
      @keydown.ctrl.enter="$emit('commit')"
      @keydown.meta.enter="$emit('commit')"
    />
    <div class="git-commit-actions">
      <button
        type="button"
        class="secondary small git-commit-ai"
        :disabled="committing || !!genStep || !!aiPushStep || !stagedCount || !configReady"
        :title="!configReady ? '请先配置 AI 模型' : 'AI 生成提交信息'"
        @click="$emit('generateMessage')"
      >{{ genStep || "✦ AI" }}</button>
      <button
        type="button" class="small git-commit-btn"
        :class="canCommit ? 'primary' : 'secondary'"
        :disabled="!canCommit || !!aiPushStep"
        :title="conflictCount ? '请先解决冲突' : canCommit ? 'Ctrl+Enter 提交' : '请先填写提交信息'"
        @click="$emit('commit')"
      >{{ committing ? "提交中…" : `提交 (${stagedCount})` }}</button>
      <button
        type="button" class="small git-ai-push"
        :disabled="committing || !!genStep || !!aiPushStep || !stagedCount || !configReady"
        :title="!configReady ? '请先配置 AI 模型' : 'AI 生成提交信息并推送'"
        @click="$emit('aiPush')"
      >{{ aiPushStep || "AI 推送" }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";

const props = defineProps<{
  message: string;
  committing: boolean;
  genStep: string | null;
  aiPushStep: string | null;
  stagedCount: number;
  configReady: boolean;
  canCommit: boolean;
  conflictCount: number;
  loading: boolean;
}>();

const emit = defineEmits<{
  "update:message": [value: string];
  commit: [];
  generateMessage: [];
  aiPush: [];
}>();

const inputEl = ref<HTMLTextAreaElement | null>(null);

const MIN_HEIGHT_PX = 36;
const MAX_HEIGHT_PX = 160;

function resizeInput() {
  const el = inputEl.value;
  if (!el) return;
  el.style.height = "auto";
  const next = Math.min(Math.max(el.scrollHeight, MIN_HEIGHT_PX), MAX_HEIGHT_PX);
  el.style.height = `${next}px`;
  el.style.overflowY = el.scrollHeight > MAX_HEIGHT_PX ? "auto" : "hidden";
}

function onInput(event: Event) {
  emit("update:message", (event.target as HTMLTextAreaElement).value);
  void nextTick(resizeInput);
}

watch(
  () => props.message,
  async () => {
    await nextTick();
    resizeInput();
  },
  { immediate: true },
);
</script>

<style scoped>
.git-commit-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 6px;
}
.git-commit-input {
  width: 100%;
  box-sizing: border-box;
  min-height: 36px;
  max-height: 160px;
  padding: 6px 8px;
  font-size: 13px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  background: rgba(11, 18, 32, 0.72);
  color: rgba(255, 255, 255, 0.92);
  resize: none;
  font-family: inherit;
  line-height: 1.5;
  overflow-y: hidden;
  field-sizing: content;
}
.git-commit-input:focus {
  outline: none;
  border-color: rgba(88, 166, 255, 0.5);
}
.git-commit-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.git-commit-btn { min-width: 72px; }
.git-ai-push {
  font-size: 11px;
  padding: 3px 8px;
  border: 1px solid rgba(210, 153, 34, 0.35);
  background: rgba(210, 153, 34, 0.08);
  border-radius: 4px;
  color: #e3b341;
  cursor: pointer;
}
.git-ai-push:disabled { opacity: 0.4; cursor: default; }
.git-commit-ai {
  font-size: 11px;
  padding: 3px 8px;
  border: 1px solid rgba(88, 166, 255, 0.25);
  background: rgba(88, 166, 255, 0.1);
  border-radius: 4px;
  color: #58a6ff;
  cursor: pointer;
}
.git-commit-ai:disabled { opacity: 0.4; cursor: default; }
</style>
