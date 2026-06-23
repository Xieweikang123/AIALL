<template>
  <div class="aggregate-card" :class="[cardClass, { 'aggregate-card--compact': compact }]" :title="card.path || ''">
    <details v-if="card.previewLines.length" class="aggregate-card-details">
      <summary class="aggregate-card-head">
        <span class="aggregate-card-icon">{{ card.icon }}</span>
        <template v-if="compact">
          <span class="aggregate-card-title">{{ card.title }}</span>
          <span class="aggregate-card-sep">·</span>
          <span class="aggregate-card-subtitle" :class="{ 'shimmer-text--fast': card.running }">{{ card.subtitle }}</span>
        </template>
        <template v-else>
          <div class="aggregate-card-text">
            <span class="aggregate-card-title">{{ card.title }}</span>
            <span class="aggregate-card-subtitle" :class="{ 'shimmer-text--fast': card.running }">{{ card.subtitle }}</span>
          </div>
        </template>
        <span class="aggregate-card-hint">{{ card.kind === 'search' ? '查看匹配' : '展开详情' }}</span>
      </summary>
      <ul class="aggregate-card-preview">
        <li v-for="(line, index) in card.previewLines" :key="index" class="aggregate-preview-line">
          <span v-if="highlightKeyword" v-html="highlightLine(line, highlightKeyword)"></span>
          <span v-else>{{ line }}</span>
        </li>
      </ul>
    </details>

    <div v-else class="aggregate-card-head static">
      <span class="aggregate-card-icon">{{ card.icon }}</span>
      <template v-if="compact">
        <span class="aggregate-card-title">{{ card.title }}</span>
        <span class="aggregate-card-sep">·</span>
        <span class="aggregate-card-subtitle">{{ card.subtitle }}</span>
      </template>
      <template v-else>
        <div class="aggregate-card-text">
          <span class="aggregate-card-title">{{ card.title }}</span>
          <span class="aggregate-card-subtitle">{{ card.subtitle }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolAggregateCard } from "../services/agentToolAggregates";

const props = defineProps<{
  card: ToolAggregateCard;
  highlightKeyword?: string;
  compact?: boolean;
}>();

const cardClass = computed(() => {
  if (props.card.running) return "running";
  if (props.card.failed) return "fail";
  return "ok";
});

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function highlightLine(line: string, keyword: string): string {
  if (!keyword) return escapeHtml(line);
  const escaped = escapeHtml(line);
  const kw = escapeHtml(keyword);
  const regex = new RegExp(`(${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return escaped.replace(regex, '<mark class="search-hit">$1</mark>');
}
</script>

<style scoped>
.aggregate-card {
  border-radius: 6px;
  background: rgba(148, 163, 184, 0.04);
  border: 1px solid rgba(148, 163, 184, 0.08);
  transition: background 0.15s ease;
  animation: tool-card-appear 0.3s cubic-bezier(0.22, 1, 0.36, 1) both;
  min-width: 0;
  overflow: hidden;
}

@keyframes tool-card-appear {
  from {
    opacity: 0;
    transform: translateX(-6px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.aggregate-card + .aggregate-card {
  margin-top: 2px;
}

.aggregate-card--compact {
  border-radius: 4px;
  background: transparent;
  border: none;
}

.aggregate-card--compact + .aggregate-card--compact {
  margin-top: 0;
}

.aggregate-card--compact:hover {
  background: rgba(148, 163, 184, 0.06);
}

.aggregate-card--compact .aggregate-card-head {
  padding: 2px 6px;
  gap: 4px;
}

.aggregate-card--compact .aggregate-card-icon {
  font-size: 11px;
}

.aggregate-card--compact .aggregate-card-title {
  font-size: 10px;
  font-weight: 500;
  flex-shrink: 0;
  max-width: 40%;
}

.aggregate-card--compact .aggregate-card-sep {
  color: rgba(139, 148, 158, 0.3);
  font-size: 10px;
  flex-shrink: 0;
}

.aggregate-card--compact .aggregate-card-subtitle {
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
  -webkit-line-clamp: unset;
  -webkit-box-orient: unset;
}

.aggregate-card:last-child {
  border-bottom: 1px solid rgba(148, 163, 184, 0.08);
}

.aggregate-card:hover {
  background: rgba(148, 163, 184, 0.08);
}

.aggregate-card.running {
  animation: card-pulse 1.4s ease-in-out infinite;
}

.aggregate-card.fail {
  background: rgba(248, 81, 73, 0.05);
  border-color: rgba(248, 81, 73, 0.1);
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
  color: rgba(148, 163, 184, 0.65);
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.aggregate-card-hint {
  flex-shrink: 0;
  font-size: 9px;
  color: rgba(148, 163, 184, 0.4);
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(148, 163, 184, 0.06);
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
  border-top: 1px solid rgba(148, 163, 184, 0.06);
  max-height: 100px;
  overflow: auto;
}

.aggregate-preview-line {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  line-height: 1.35;
  color: rgba(148, 163, 184, 0.55);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.aggregate-preview-line :deep(.search-hit) {
  background: rgba(210, 153, 34, 0.3);
  color: rgba(255, 255, 255, 0.92);
  border-radius: 2px;
  padding: 0 2px;
}

@keyframes card-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
</style>
