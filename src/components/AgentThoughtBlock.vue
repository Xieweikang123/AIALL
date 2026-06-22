<template>
  <div class="cursor-thought">
    <ChatMarkdown
      :content="block.text"
      :streaming="streaming"
    />
  </div>
</template>

<script setup lang="ts">
import ChatMarkdown from "./ChatMarkdown.vue";

defineProps<{
  block: { kind: "thought"; key: string; text: string };
  streaming?: boolean;
}>();
</script>

<style scoped>
.cursor-thought {
  margin: 0;
  padding: 6px 10px;
  font-size: 12.5px;
  line-height: 1.5;
  color: rgba(230, 237, 243, 0.82);
  word-break: break-word;
  animation: thought-reveal 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;
  background: rgba(88, 166, 255, 0.04);
  border-left: 2px solid rgba(88, 166, 255, 0.3);
  border-radius: 0 4px 4px 0;
  min-width: 0;
  overflow: hidden;
}

@keyframes thought-reveal {
  from {
    opacity: 0;
    transform: translateX(-4px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.cursor-thought :deep(.msg-markdown) {
  font-size: inherit;
  line-height: inherit;
  color: inherit;
}

.cursor-thought :deep(.msg-markdown p) {
  margin: 0 0 0.4em;
}

.cursor-thought :deep(.msg-markdown p:last-child) {
  margin-bottom: 0;
}

.cursor-thought :deep(.msg-markdown h1),
.cursor-thought :deep(.msg-markdown h2),
.cursor-thought :deep(.msg-markdown h3),
.cursor-thought :deep(.msg-markdown h4) {
  margin: 0.5em 0 0.3em;
  font-size: inherit;
  font-weight: 600;
  color: rgba(230, 237, 243, 0.92);
}

.cursor-thought :deep(.msg-markdown h3) {
  font-size: 1.02em;
}

.cursor-thought :deep(.msg-markdown code) {
  font-size: 0.92em;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(139, 148, 158, 0.1);
  color: rgba(230, 237, 243, 0.88);
}

.cursor-thought :deep(.msg-markdown pre) {
  margin: 0.4em 0;
  padding: 6px 8px;
  border-radius: 4px;
  background: rgba(1, 4, 9, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.04);
  overflow-x: auto;
}
</style>
