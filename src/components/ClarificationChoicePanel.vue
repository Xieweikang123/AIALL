<template>
  <div class="clarification-choices">
    <section
      v-for="(question, qi) in questions"
      :key="`${qi}-${question.prompt.slice(0, 24)}`"
      class="clarification-question"
    >
      <p class="clarification-question-prompt">{{ question.prompt }}</p>
      <AiOptionButtons
        :options="question.options"
        @select="(option) => emit('select', { question: question.prompt, option })"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import AiOptionButtons from "./AiOptionButtons.vue";
import type { AiOption } from "../utils/parseAiOptions";
import type { ClarificationQuestionGroup } from "../utils/parseClarificationChoices";

defineProps<{
  questions: ClarificationQuestionGroup[];
}>();

const emit = defineEmits<{
  select: [payload: { question: string; option: AiOption }];
}>();
</script>

<style scoped>
.clarification-choices {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 12px;
}

.clarification-question {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(88, 166, 255, 0.2);
  background: rgba(88, 166, 255, 0.05);
}

.clarification-question-prompt {
  margin: 0 0 4px;
  font-size: 13px;
  line-height: 1.55;
  font-weight: 600;
  color: rgba(220, 230, 240, 0.96);
}

.clarification-question :deep(.ai-option-buttons) {
  margin-top: 8px;
}
</style>
