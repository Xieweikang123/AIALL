<template>
  <div class="git-commit-box git-section-card">
    <textarea
      :value="message"
      class="git-commit-input"
      rows="2"
      placeholder="提交信息…"
      :disabled="committing || !!genStep || !!aiPushStep"
      @input="$emit('update:message', ($event.target as HTMLTextAreaElement).value)"
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
      <button
        type="button" class="ghost tiny git-undo-commit"
        :disabled="loading || committing || !!aiPushStep"
        title="Soft 重置：撤销上一提交，更改保留在暂存区"
        @click="$emit('undoCommit')"
      >撤销提交</button>
      <button
        type="button" class="ghost tiny"
        :disabled="loading || committing || !!aiPushStep || !!advancedAction"
        title="Amend 上一提交（有填写则用当前信息，否则保留原文）"
        @click="$emit('amend')"
      >{{ advancedAction === 'amend' ? '…' : 'Amend' }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  message: string;
  committing: boolean;
  genStep: string | null;
  aiPushStep: string | null;
  stagedCount: number;
  configReady: boolean;
  canCommit: boolean;
  conflictCount: number;
  loading: boolean;
  advancedAction: string | null;
}>();

defineEmits<{
  "update:message": [value: string];
  commit: [];
  generateMessage: [];
  aiPush: [];
  undoCommit: [];
  amend: [];
}>();
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
  padding: 6px 8px;
  font-size: 13px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  background: rgba(11, 18, 32, 0.72);
  color: rgba(255, 255, 255, 0.92);
  resize: vertical;
  font-family: inherit;
  line-height: 1.5;
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
.git-undo-commit { font-size: 11px; margin-left: auto; }
</style>
