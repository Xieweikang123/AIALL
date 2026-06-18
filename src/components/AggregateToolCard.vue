<template>
  <div class="aggregate-card" :class="cardClass">
    <details v-if="card.previewLines.length" class="aggregate-card-details">
      <summary class="aggregate-card-head">
        <span class="aggregate-card-icon">{{ card.icon }}</span>
        <div class="aggregate-card-text">
          <span class="aggregate-card-title">{{ card.title }}</span>
          <span class="aggregate-card-subtitle">{{ card.subtitle }}</span>
        </div>
        <span class="aggregate-card-hint">命中摘要</span>
      </summary>
      <ul class="aggregate-card-preview">
        <li v-for="(line, index) in card.previewLines" :key="index" class="aggregate-preview-line">
          {{ line }}
        </li>
      </ul>
    </details>

    <div v-else class="aggregate-card-head static">
      <span class="aggregate-card-icon">{{ card.icon }}</span>
      <div class="aggregate-card-text">
        <span class="aggregate-card-title">{{ card.title }}</span>
        <span class="aggregate-card-subtitle">{{ card.subtitle }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolAggregateCard } from "../services/agentToolAggregates";

const props = defineProps<{
  card: ToolAggregateCard;
}>();

const cardClass = computed(() => {
  if (props.card.running) return "running";
  if (props.card.failed) return "fail";
  return "ok";
});
</script>

<style scoped>
.aggregate-card {
  border: 1px solid rgba(88, 166, 255, 0.14);
  border-radius: 8px;
  background: rgba(88, 166, 255, 0.04);
  overflow: hidden;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.aggregate-card:hover {
  border-color: rgba(88, 166, 255, 0.28);
  background: rgba(88, 166, 255, 0.07);
}

.aggregate-card.running {
  border-color: rgba(88, 166, 255, 0.35);
  animation: card-pulse 1.4s ease-in-out infinite;
}

.aggregate-card.fail {
  border-color: rgba(248, 81, 73, 0.35);
  background: rgba(248, 81, 73, 0.05);
}

.aggregate-card-details {
  margin: 0;
}

.aggregate-card-head {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 8px;
  list-style: none;
  cursor: pointer;
  user-select: none;
}

.aggregate-card-head.static {
  cursor: default;
}

.aggregate-card-head::-webkit-details-marker {
  display: none;
}

.aggregate-card-icon {
  font-size: 14px;
  line-height: 1.2;
  flex-shrink: 0;
  margin-top: 1px;
}

.aggregate-card-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.aggregate-card-title {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  font-weight: 600;
  color: rgba(126, 182, 255, 0.95);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aggregate-card-subtitle {
  font-size: 11px;
  line-height: 1.45;
  color: rgba(139, 148, 158, 0.82);
  overflow-wrap: anywhere;
}

.aggregate-card-hint {
  flex-shrink: 0;
  font-size: 10px;
  color: rgba(139, 148, 158, 0.65);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid rgba(139, 148, 158, 0.2);
  margin-top: 1px;
}

.aggregate-card-details[open] .aggregate-card-hint {
  color: rgba(126, 182, 255, 0.85);
  border-color: rgba(88, 166, 255, 0.35);
}

.aggregate-card-preview {
  margin: 0;
  padding: 4px 8px 6px 28px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
  border-top: 1px solid rgba(88, 166, 255, 0.08);
  max-height: 120px;
  overflow: auto;
}

.aggregate-preview-line {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10.5px;
  line-height: 1.45;
  color: rgba(139, 148, 158, 0.88);
  overflow-wrap: anywhere;
  word-break: break-word;
}

@keyframes card-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.72; }
}
</style>
