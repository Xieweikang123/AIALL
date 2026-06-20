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
  border-radius: 6px;
  background: rgba(139, 148, 158, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: background 0.15s ease;
}

.aggregate-card + .aggregate-card {
  margin-top: 2px;
}

.aggregate-card:last-child {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.aggregate-card:hover {
  background: rgba(139, 148, 158, 0.1);
}

.aggregate-card.running {
  animation: card-pulse 1.4s ease-in-out infinite;
}

.aggregate-card.fail {
  background: rgba(248, 81, 73, 0.03);
}

.aggregate-card-details {
  margin: 0;
}

.aggregate-card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  list-style: none;
  cursor: pointer;
  user-select: none;
  font-size: 11px;
}

.aggregate-card-head.static {
  cursor: default;
}

.aggregate-card-head::-webkit-details-marker {
  display: none;
}

.aggregate-card-icon {
  font-size: 13px;
  line-height: 1;
  flex-shrink: 0;
  opacity: 0.8;
}

.aggregate-card-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.aggregate-card-title {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aggregate-card-subtitle {
  font-size: 10px;
  line-height: 1.3;
  color: rgba(139, 148, 158, 0.8);
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.aggregate-card-hint {
  flex-shrink: 0;
  font-size: 9px;
  color: rgba(255, 255, 255, 0.35);
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.06);
}

.aggregate-card-details[open] .aggregate-card-hint {
  color: rgba(88, 166, 255, 0.8);
  background: rgba(88, 166, 255, 0.1);
}

.aggregate-card-preview {
  margin: 0;
  padding: 2px 4px 2px 24px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 1px;
  border-top: 1px solid rgba(255, 255, 255, 0.03);
  max-height: 100px;
  overflow: auto;
}

.aggregate-preview-line {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  line-height: 1.35;
  color: rgba(255, 255, 255, 0.55);
  overflow-wrap: anywhere;
  word-break: break-word;
}

@keyframes card-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.8; }
}
</style>
