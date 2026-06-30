<template>
  <div class="plan-main">
    <header class="plan-main-head">
      <h2 class="plan-main-title">修改方案</h2>
      <span v-if="!streaming && content.trim()" class="plan-main-hint">选中文字可引用到对话</span>
      <span v-if="streaming" class="plan-main-badge plan-main-badge--draft">生成中</span>
      <span
        v-else-if="display.files.length || display.codeBlockCount"
        class="plan-main-meta"
      >
        <template v-if="display.files.length">{{ display.files.length }} 个文件</template>
        <template v-if="display.files.length && display.codeBlockCount"> · </template>
        <template v-if="display.codeBlockCount">{{ display.codeBlockCount }} 处代码</template>
      </span>
      <div class="plan-main-head-actions">
        <button
          v-if="planFilePath"
          type="button"
          class="plan-main-btn plan-main-btn--ghost"
          title="在编辑器打开 .aiall/PLAN.md"
          @click="emit('open-plan-file')"
        >
          编辑 PLAN.md
        </button>
        <button
          v-if="canExecute"
          type="button"
          class="plan-main-btn plan-main-btn--primary"
          title="按此方案开始改代码"
          @click="emit('execute')"
        >
          执行方案
        </button>
        <button
          v-if="chatCollapsed"
          type="button"
          class="plan-main-btn plan-main-btn--ghost"
          @click="emit('expand-chat')"
        >
          展开 AI 助手
        </button>
        <button
          type="button"
          class="plan-main-btn plan-main-btn--ghost"
          title="关闭方案窗口"
          @click="emit('close')"
        >
          关闭
        </button>
      </div>
    </header>

    <div v-if="streaming && !content.trim()" class="plan-main-empty">
      <span class="plan-main-spinner" aria-hidden="true" />
      <span>正在生成方案…</span>
    </div>

    <PlanDocumentBlock
      v-else
      :content="content"
      chat-mode="plan"
      :streaming="streaming"
      :can-execute="false"
      :plan-file-path="planFilePath"
      :enhance-layout="!streaming"
      :external-view="false"
      @content-scroll="emit('content-scroll')"
    >
      <ChatMarkdown
        class="plan-main-markdown"
        :class="{ 'plan-main-markdown--streaming': streaming }"
        :content="markdownContent"
        :streaming="streaming"
        :interactive="!streaming"
        @select-option="(option) => emit('select-option', option)"
      />
    </PlanDocumentBlock>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import ChatMarkdown from "../ChatMarkdown.vue";
import PlanDocumentBlock from "../PlanDocumentBlock.vue";
import { enrichPlanMarkdownForDisplay, parsePlanDocumentDisplay } from "../../services/planDocumentDisplay";
import type { AiOption } from "../../utils/parseAiOptions";

const props = withDefaults(
  defineProps<{
    content: string;
    streaming?: boolean;
    planFilePath?: string;
    canExecute?: boolean;
    chatCollapsed?: boolean;
  }>(),
  {
    streaming: false,
    canExecute: false,
    chatCollapsed: false,
  },
);

const emit = defineEmits<{
  execute: [];
  close: [];
  "open-plan-file": [];
  "expand-chat": [];
  "content-scroll": [];
  "select-option": [option: AiOption];
}>();

const display = computed(() => parsePlanDocumentDisplay(props.content));

const markdownContent = computed(() =>
  enrichPlanMarkdownForDisplay(props.content, { whileStreaming: props.streaming }),
);
</script>

<style scoped>
.plan-main {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: rgba(13, 17, 23, 0.98);
}

.plan-main-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.plan-main-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: rgba(240, 245, 250, 0.96);
}

.plan-main-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}

.plan-main-badge--draft {
  background: rgba(210, 153, 34, 0.14);
  color: rgba(255, 214, 130, 0.96);
}

.plan-main-meta {
  color: rgba(139, 148, 158, 0.92);
  font-size: 12px;
}

.plan-main-hint {
  color: rgba(139, 148, 158, 0.78);
  font-size: 11px;
}

.plan-main-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-wrap: wrap;
}

.plan-main-btn {
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(201, 209, 217, 0.95);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.plan-main-btn--primary {
  border-color: rgba(88, 166, 255, 0.45);
  background: rgba(88, 166, 255, 0.12);
  color: rgba(190, 218, 255, 0.98);
}

.plan-main-btn--ghost:hover,
.plan-main-btn--primary:hover {
  filter: brightness(1.08);
}

.plan-main-empty {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 24px 16px;
  color: rgba(148, 163, 184, 0.85);
  font-size: 13px;
}

.plan-main-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(88, 166, 255, 0.25);
  border-top-color: rgba(88, 166, 255, 0.9);
  border-radius: 50%;
  animation: plan-main-spin 0.8s linear infinite;
}

@keyframes plan-main-spin {
  to { transform: rotate(360deg); }
}

.plan-main :deep(.plan-document) {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 16px 16px;
}

.plan-main :deep(.plan-document-head) {
  display: none;
}

.plan-main-markdown :deep(.msg-markdown) {
  font-size: 14px;
  line-height: 1.65;
  user-select: text;
}
</style>
