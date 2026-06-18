<template>
  <div class="ai-option-buttons">
    <button
      v-for="opt in options"
      :key="opt.index"
      type="button"
      class="ai-option-btn"
      @mousedown.stop
      @mouseup.stop
      @click.stop.prevent="selectOption(opt)"
      @dblclick.stop
    >
      <span v-if="opt.showIndex !== false" class="ai-option-index">{{ opt.index + 1 }}</span>
      <span class="ai-option-label">{{ opt.label }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { AiOption } from "../utils/parseAiOptions";

defineProps<{
  options: AiOption[];
}>();

const emit = defineEmits<{
  select: [option: AiOption];
}>();

function selectOption(option: AiOption) {
  emit("select", option);
}
</script>

<style scoped>
.ai-option-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.ai-option-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid rgba(31, 111, 235, 0.35);
  background: rgba(31, 111, 235, 0.08);
  color: rgba(255, 255, 255, 0.88);
  font-size: 13px;
  font-family: inherit;
  line-height: 1.4;
  cursor: pointer;
  transition: all 150ms ease;
  text-align: left;
}

.ai-option-btn:hover {
  background: rgba(31, 111, 235, 0.18);
  border-color: rgba(31, 111, 235, 0.55);
  box-shadow: 0 2px 8px rgba(31, 111, 235, 0.15);
}

.ai-option-btn:active {
  transform: scale(0.98);
}

.ai-option-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(31, 111, 235, 0.25);
  color: #91beff;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.ai-option-label {
  flex: 1;
  min-width: 0;
}
</style>
