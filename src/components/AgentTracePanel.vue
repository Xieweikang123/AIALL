<template>
  <div class="agent-trace-panel" :class="{ 'agent-trace-panel--embedded': embedded }">
    <button
      v-if="!embedded"
      type="button"
      class="agent-trace-toggle"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="agent-trace-chevron" aria-hidden="true">{{ open ? "▾" : "▸" }}</span>
      <span class="agent-trace-title">数据流轨迹</span>
      <span class="agent-trace-meta">{{ totalEntries }} 条事件 · {{ turns.length }} 轮</span>
    </button>
    <div v-if="open || embedded" class="agent-trace-body">
      <div v-for="turn in turns" :key="turn.turn" class="agent-trace-turn">
        <div class="agent-trace-turn-head">
          <span class="agent-trace-turn-label">第 {{ turn.turn }} 轮</span>
          <span v-if="turn.model" class="agent-trace-turn-model" :title="turn.model">{{ turn.model }}</span>
          <span v-if="turn.contextChars" class="agent-trace-turn-ctx">{{ formatChars(turn.contextChars) }}</span>
        </div>
        <div
          v-for="entry in turn.entries"
          :key="entry.key"
          class="agent-trace-entry"
          :class="[
            `agent-trace-entry--${entry.kind}`,
            { 'agent-trace-entry--fail': entry.ok === false, 'agent-trace-entry--expanded': isExpanded(entry.key) },
          ]"
        >
          <button
            type="button"
            class="agent-trace-row"
            :aria-expanded="isExpanded(entry.key)"
            @click="toggleEntry(entry.key)"
          >
            <span class="agent-trace-row-chevron" aria-hidden="true">{{ isExpanded(entry.key) ? "▾" : "▸" }}</span>
            <span class="agent-trace-row-kind" :title="kindTitle(entry.kind)">{{ kindLabel(entry.kind) }}</span>
            <span class="agent-trace-row-label">{{ entry.label }}</span>
            <span v-if="entry.elapsedMs !== undefined" class="agent-trace-row-time">{{ formatElapsed(entry.elapsedMs) }}</span>
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

const props = withDefaults(
  defineProps<{
    roundGroups: AgentRoundGroupView[];
    /** 嵌入抽屉时隐藏折叠按钮，由外层容器负责滚动 */
    embedded?: boolean;
  }>(),
  { embedded: false },
);

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

function kindTitle(kind: AgentTraceEntry["kind"]): string {
  if (kind === "request") return "请求（发给模型的消息）";
  if (kind === "response") return "回复（模型返回）";
  if (kind === "tool") return "工具调用";
  return "阶段状态";
}

function formatChars(chars: number): string {
  if (chars >= 1000) return `${(chars / 1000).toFixed(1)}K 字符`;
  return `${chars} 字符`;
}

function formatElapsed(ms?: number): string {
  if (ms === undefined || ms < 0) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
</script>

<style scoped>
.agent-trace-panel {
  margin: 4px 0 0;
  border-top: 1px dashed rgba(255, 255, 255, 0.06);
  padding-top: 4px;
}

.agent-trace-panel--embedded {
  margin: 0;
  border-top: none;
  padding-top: 0;
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

.agent-trace-panel--embedded .agent-trace-body {
  max-height: none;
  margin-top: 0;
  padding: 0;
  border-radius: 0;
  background: transparent;
}

.agent-trace-panel--embedded .agent-trace-body {
  margin-top: 0;
  max-height: none;
  overflow: visible;
  padding: 0;
  border-radius: 0;
  background: transparent;
}

.agent-trace-panel--embedded .agent-trace-body {
  margin-top: 0;
  max-height: none;
  overflow: visible;
  padding: 0;
  border-radius: 0;
  background: transparent;
}

.agent-trace-panel--embedded .agent-trace-body {
  margin-top: 0;
  max-height: none;
  overflow: visible;
  padding: 0;
  border-radius: 0;
  background: transparent;
}

.agent-trace-body::-webkit-scrollbar {
  width: 4px;
}

.agent-trace-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
}

.agent-trace-turn + .agent-trace-turn {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.agent-trace-turn-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(126, 182, 255, 0.06);
}

.agent-trace-turn-label {
  font-size: 10.5px;
  font-weight: 600;
  color: rgba(126, 182, 255, 0.85);
}

.agent-trace-turn-model {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.6);
  font-variant-numeric: tabular-nums;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-trace-turn-ctx {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.5);
  font-variant-numeric: tabular-nums;
  margin-left: auto;
}

.agent-trace-entry {
  border-radius: 4px;
}

.agent-trace-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 3px 4px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: rgba(186, 196, 208, 0.85);
  font-size: 11px;
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
  transition: background 100ms ease;
}

.agent-trace-row:hover {
  background: rgba(255, 255, 255, 0.05);
}

.agent-trace-entry--expanded .agent-trace-row {
  background: rgba(255, 255, 255, 0.04);
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

.agent-trace-row-time {
  flex-shrink: 0;
  margin-left: auto;
  padding-left: 8px;
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
  color: rgba(148, 163, 184, 0.6);
}

.agent-trace-detail {
  margin: 2px 0 4px 26px;
  padding: 6px 8px;
  border-radius: 4px;
  background: rgba(1, 4, 9, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-left: 2px solid rgba(126, 182, 255, 0.25);
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