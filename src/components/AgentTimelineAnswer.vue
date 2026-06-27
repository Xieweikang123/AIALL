<template>
  <div class="timeline-answer">
    <div
      v-if="streaming && isRunning && !text.trim()"
      class="timeline-answer-placeholder"
    >
      <span class="shimmer-text--fast">正在生成…</span>
    </div>
    <ProjectReportBlock
      v-else
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
        :enhance-layout="layoutEnhanceReady && !isRunning && !streaming"
        @execute="emit('execute-plan')"
      >
        <ChatMarkdown
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
import ChatMarkdown from "./ChatMarkdown.vue";
import PlanDocumentBlock from "./PlanDocumentBlock.vue";
import ProjectReportBlock from "./ProjectReportBlock.vue";
import { enrichPlanMarkdownForDisplay } from "../services/planDocumentDisplay";
import type { AiOption } from "../utils/parseAiOptions";

const props = withDefaults(
  defineProps<{
    text: string;
    streaming?: boolean;
    isRunning: boolean;
    chatMode?: "ask" | "build" | "plan" | "explore";
    canExecutePlan?: boolean;
    layoutEnhanceReady?: boolean;
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
}>();

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
