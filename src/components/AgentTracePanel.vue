<template>
  <div class="agent-trace-panel">
    <button
      type="button"
      class="agent-trace-toggle"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="agent-trace-chevron" aria-hidden="true">{{ open ? "▾" : "▸" }}</span>
      <span class="agent-trace-title">数据流轨迹</span>
      <span class="agent-trace-meta">{{ totalEntries }} 条事件 · {{ turns.length }} 轮</span>
    </button>
    <div v-if="open" class="agent-trace-body">
      <div v-for="turn in turns" :key="turn.turn" class="agent-trace-turn">
        <div class="agent-trace-turn-head">
          <span class="agent-trace-turn-label">第 {{ turn.turn }} 轮</span>
          <span v-if="turn.model" class="agent-trace-turn-model">{{ turn.model }}</span>
          <span v-if="turn.contextChars" class="agent-trace-turn-ctx">{{ formatChars(turn.contextChars) }}</span>
        </div>
        <div
          v-for="entry in turn.entries"
          :key="entry.key"
          class="agent-trace-entry"
          :class="[`agent-trace-entry--${entry.kind}`, { 'agent-trace-entry--fail': entry.ok === false }]"
        >
          <button
            type="button"
            class="agent-trace-row"
            :aria-expanded="isExpanded(entry.key)"
            @click="toggleEntry(entry.key)"
          >
            <span class="agent-trace-row-chevron" aria-hidden="true">{{ isExpanded(entry.key) ? "▾" : "▸" }}</span>
            <span class="agent-trace-row-kind">{{ kindLabel(entry.kind) }}</span>
            <span class="agent-trace-row-label">{{ entry.label }}</span>
          </button>
          <pre v-if="isExpanded(entry.key)" class="agent-trace-detail">{{ entry.detail }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { buildAgentTraceTurns, type AgentTraceEntry } from "../services/agentTraceTimeline";
import type { AgentRoundGroupView } from "../services/agentRoundGroups";

const props = defineProps<{
  roundGroups: AgentRoundGroupView[];
}>();

const open = ref(false);
const expandedKeys = ref<Set<string>>(new Set());

const turns = computed(() => buildAgentTraceTurns(props.roundGroups));
const totalEntries = computed(() => turns.value.reduce((sum, turn) => sum + turn.entries.length, 0));

watch(turns, () => {
  expandedKeys.value = new Set();
});

function isExpanded(key: string): boolean {
  return expandedKeys.value.has(key);
}

function toggleEntry(key: string) {
  const next = new Set(expandedKeys.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedKeys.value = next;
}

function kindLabel(kind: AgentTraceEntry["kind"]): string {
  if (kind === "request") return "发";
  if (kind === "response") return "回";
  if (kind === "tool") return "具";
  return "态";
}

function formatChars(chars: number): string {
  if (chars >= 1000) return `${(chars / 1000).toFixed(1)}K 字符`;
  return `${chars} 字符`;
}
</script>

<style scoped>
.agent-trace-panel {
  margin: 4px 0 0;
  border-top: 1px dashed rgba(255, 255, 255, 0.06);
  padding-top: 4px;
}

.agent-trace-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: rgba(139, 148, 158, 0.6);
  font-size: 11px;
  cursor: pointer;
  transition: color 120ms ease, background 120ms ease;
}

.agent-trace-toggle:hover {
  color: rgba(165, 214, 255, 0.9);
  background: rgba(255, 255, 255, 0.03);
}

.agent-trace-chevron {
  font-size: 9px;
  flex-shrink: 0;
}

.agent-trace-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.agent-trace-meta {
  color: rgba(139, 148, 158, 0.42);
  font-variant-numeric: tabular-nums;
}

.agent-trace-body {
  margin-top: 4px;
  max-height: 320px;
  overflow-y: auto;
  padding: 4px 0 4px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.14);
}

.agent-trace-body::-webkit-scrollbar {
  width: 4px;
}

.agent-trace-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
}

.agent-trace-turn + .agent-trace-turn {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.agent-trace-turn-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
}

.agent-trace-turn-label {
  font-size: 10.5px;
  font-weight: 600;
  color: rgba(126, 182, 255, 0.72);
}

.agent-trace-turn-model,
.agent-trace-turn-ctx {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.5);
  font-variant-numeric: tabular-nums;
}

.agent-trace-entry {
  border-radius: 4px;
}

.agent-trace-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 2px 4px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: rgba(186, 196, 208, 0.85);
  font-size: 11px;
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
}

.agent-trace-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.agent-trace-row-chevron {
  font-size: 9px;
  color: rgba(126, 182, 255, 0.55);
  flex-shrink: 0;
}

.agent-trace-row-kind {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  font-size: 9.5px;
  font-weight: 600;
}

.agent-trace-entry--request .agent-trace-row-kind {
  background: rgba(88, 166, 255, 0.16);
  color: rgba(126, 182, 255, 0.9);
}

.agent-trace-entry--response .agent-trace-row-kind {
  background: rgba(63, 185, 80, 0.16);
  color: rgba(120, 210, 140, 0.9);
}

.agent-trace-entry--tool .agent-trace-row-kind {
  background: rgba(210, 153, 34, 0.16);
  color: rgba(230, 190, 110, 0.9);
}

.agent-trace-entry--phase .agent-trace-row-kind {
  background: rgba(148, 163, 184, 0.14);
  color: rgba(148, 163, 184, 0.7);
}

.agent-trace-entry--fail .agent-trace-row {
  color: rgba(255, 180, 171, 0.9);
}

.agent-trace-row-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-trace-detail {
  margin: 2px 0 4px 26px;
  padding: 6px 8px;
  border-radius: 4px;
  background: rgba(1, 4, 9, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.04);
  font-size: 10.5px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  max-height: 180px;
  overflow-y: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: rgba(139, 148, 158, 0.85);
}
</style>