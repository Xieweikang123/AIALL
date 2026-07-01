<template>
  <div class="timeline-answer">
    <div
      v-if="streaming && isRunning && !text.trim()"
      class="timeline-answer-placeholder"
    >
      <span class="shimmer-text--fast">
        {{ planExternalView ? "方案正在左侧窗口生成…" : "正在生成…" }}
      </span>
    </div>
    <div
      v-else-if="showThinkingPlaceholder"
      class="timeline-answer-placeholder timeline-answer-placeholder--exploring"
    >
      <span class="shimmer-text--fast">{{ thinkingPlaceholder }}</span>
    </div>
    <ProjectReportBlock
      v-else-if="hasRenderableContent"
      :content="text"
      :chat-mode="chatMode"
      :streaming="streaming && isRunning"
      @open-file="(path) => emit('openFile', path)"
    >
      <PlanDocumentBlock
        :content="text"
        :chat-mode="chatMode"
        :streaming="streaming && isRunning"
        :can-execute="canExecutePlan && !isRunning && !streaming"
        :plan-file-path="planFilePath"
        :plan-panel-active="planPanelActive"
        :enhance-layout="layoutEnhanceReady && !isRunning && !streaming"
        :external-view="planExternalView"
        @execute="emit('execute-plan')"
        @open-plan-file="() => chatCtx?.openPlanFileInEditor(props.planFilePath)"
        @focus-panel="focusPlanPanel"
      >
        <ChatMarkdown
          v-if="!planExternalView"
          class="inline-feed-markdown inline-feed-markdown--answer"
          :content="answerMarkdown(text)"
          :streaming="streaming && isRunning"
          :interactive="true"
          @select-option="(option) => emit('select-option', option)"
        />
      </PlanDocumentBlock>
    </ProjectReportBlock>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";
import ChatMarkdown from "./ChatMarkdown.vue";
import PlanDocumentBlock from "./PlanDocumentBlock.vue";
import ProjectReportBlock from "./ProjectReportBlock.vue";
import { enrichPlanMarkdownForDisplay } from "../services/planDocumentDisplay";
import { shouldUsePlanExternalView } from "../services/planFile";
import { vibeChatMessageContextKey } from "../composables/vibeChatMessageContext";
import type { AiOption } from "../utils/parseAiOptions";

const props = withDefaults(
  defineProps<{
    text: string;
    streaming?: boolean;
    isRunning: boolean;
    thinkingPlaceholder?: string;
    chatMode?: "ask" | "build" | "plan" | "explore";
    canExecutePlan?: boolean;
    layoutEnhanceReady?: boolean;
    planFilePath?: string;
    messageId?: string;
  }>(),
  {
    streaming: false,
    canExecutePlan: false,
    layoutEnhanceReady: false,
  },
);

const emit = defineEmits<{
  "execute-plan": [];
  "select-option": [option: AiOption];
  openFile: [path: string];
  "open-plan-file": [];
}>();

const chatCtx = inject(vibeChatMessageContextKey, null);
const planExternalView = computed(() =>
  shouldUsePlanExternalView(props.text, { chatMode: props.chatMode ?? "ask", planFilePath: props.planFilePath }),
);
const planPanelLinked = computed(() => {
  if (!chatCtx?.planPanelActive.value) return false;
  if (!props.messageId || !chatCtx.planPanelMessageId.value) return false;
  return chatCtx.planPanelMessageId.value === props.messageId;
});
const planPanelActive = computed(
  () => planPanelLinked.value && Boolean(chatCtx?.planWorkspaceOpen?.value),
);

const showThinkingPlaceholder = computed(
  () =>
    Boolean(props.isRunning && props.thinkingPlaceholder?.trim() && !props.text.trim() && !props.streaming),
);

const hasRenderableContent = computed(() => Boolean(props.text.trim()) || Boolean(props.streaming && props.isRunning));

function focusPlanPanel() {
  chatCtx?.focusPlanPanel(props.messageId);
}

function answerMarkdown(text: string) {
  return enrichPlanMarkdownForDisplay(text, {
    whileStreaming: Boolean(props.isRunning),
  });
}
</script>

<style scoped>
.timeline-answer {
  min-width: 0;
}

.timeline-answer-placeholder {
  padding: 4px 0;
  font-size: 13px;
}

.timeline-answer-placeholder--exploring {
  color: rgba(148, 163, 184, 0.82);
  font-size: 13px;
  line-height: 1.55;
}

.inline-feed-markdown--answer :deep(.msg-markdown) {
  font-size: 14px;
  line-height: 1.65;
  color: rgba(240, 245, 250, 0.96);
}

.inline-feed-markdown--answer :deep(.msg-markdown--streaming p:last-child::after) {
  content: "";
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 2px;
  vertical-align: -0.12em;
  background: rgba(88, 166, 255, 0.85);
  animation: stream-caret-blink 1s step-end infinite;
}

@keyframes stream-caret-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
</style>
