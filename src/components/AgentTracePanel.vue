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

    <div v-if="embedded" class="agent-trace-detail-bar">
      <span class="agent-trace-detail-caption">详细度</span>
      <button
        v-for="level in detailLevels"
        :key="level"
        type="button"
        class="agent-trace-detail-btn"
        :class="{ 'agent-trace-detail-btn--on': level === detail, 'agent-trace-detail-btn--live': level === detail && live }"
        :title="specOf(level).hint"
        @click="onPickDetail(level)"
      >
        {{ specOf(level).label }}
      </button>
      <span v-if="live" class="agent-trace-live">
        <span class="agent-trace-live-dot" aria-hidden="true" />
        实时
      </span>
    </div>

    <div v-if="open || embedded" class="agent-trace-body">
      <div
        v-for="turn in turns"
        :key="turn.turn"
        class="agent-trace-turn"
        :class="{ 'agent-trace-turn--collapsed': !isTurnOpen(turn.turn) }"
      >
        <button
          type="button"
          class="agent-trace-turn-head"
          :aria-expanded="isTurnOpen(turn.turn)"
          @click="toggleTurn(turn.turn)"
        >
          <span class="agent-trace-turn-chevron" aria-hidden="true">{{ isTurnOpen(turn.turn) ? "▾" : "▸" }}</span>
          <span class="agent-trace-turn-label">第 {{ turn.turn }} 轮</span>
          <span v-if="turn.model" class="agent-trace-turn-model" :title="turn.model">{{ turn.model }}</span>
          <span v-if="turn.contextChars" class="agent-trace-turn-ctx">{{ formatChars(turn.contextChars) }}</span>
        </button>
        <template v-if="isTurnOpen(turn.turn)">
          <div
            v-for="entry in turn.entries"
            :key="entry.key"
            class="agent-trace-entry"
            :class="[
              `agent-trace-entry--${entry.kind}`,
              { 'agent-trace-entry--fail': entry.ok === false, 'agent-trace-entry--expanded': isEntryOpen(entry) },
            ]"
          >
            <button
              type="button"
              class="agent-trace-row"
              :aria-expanded="isEntryOpen(entry)"
              @click="toggleEntry(entry.key)"
            >
              <span class="agent-trace-row-chevron" aria-hidden="true">{{ isEntryOpen(entry) ? "▾" : "▸" }}</span>
              <span class="agent-trace-row-kind" :title="kindTitle(entry.kind)">{{ kindLabel(entry.kind) }}</span>
              <span v-if="entry.kind === 'reasoning' && entry.streaming" class="agent-trace-row-dot" aria-hidden="true" />
              <span class="agent-trace-row-label">{{ entryLabel(entry) }}</span>
              <span v-if="entry.elapsedMs !== undefined" class="agent-trace-row-time">{{ formatElapsed(entry.elapsedMs) }}</span>
            </button>
            <!--
              展开程度由详细度档位决定（entry.expandedByDefault），用户点箭头可临时覆盖。
              思考在标准档起就默认展开 —— 它是「过程」，要能边跑边看。
            -->
            <div
              v-if="isEntryOpen(entry)"
              :ref="(el) => bindReasoningBody(entry.key, el)"
              class="agent-trace-detail"
              :class="{ 'agent-trace-detail--live': entry.streaming }"
              @scroll="onReasoningBodyScroll(entry.key)"
              @wheel="userScrolledKeys.add(entry.key)"
            >{{ entry.detail }}</div>
          </div>
        </template>
        <div v-else class="agent-trace-turn-summary">{{ turnSummary(turn) }}</div>
      </div>
      <div v-if="!turns.length" class="agent-trace-empty">
        {{ emptyHint }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import {
  buildAgentTraceTurns,
  pickTurnHeadlineEntry,
  type AgentTraceEntry,
} from "../services/agentTraceTimeline";
import {
  AGENT_TRACE_DETAIL_LEVELS,
  normalizeAgentTraceDetail,
  resolveAgentTraceDetailSpec,
  type AgentTraceDetailLevel,
} from "../services/agentTraceDetail";
import {
  buildAgentRoundGroupViews,
  type AgentRoundGroup,
  type AgentRoundGroupView,
  type AgentRoundTool,
} from "../services/agentRoundGroups";

type TraceTurn = ReturnType<typeof buildAgentTraceTurns>[number];

const props = withDefaults(
  defineProps<{
    /** 原始轮次记录（未组装视图）；组装在 rAF 节流后做一次 */
    roundGroups: AgentRoundGroup[];
    /** 该消息的工具记录，用于补齐每轮的步骤行 */
    tools?: AgentRoundTool[];
    /** 嵌入抽屉时隐藏折叠按钮，由外层容器负责滚动 */
    embedded?: boolean;
    /** 详细度档位（由抽屉头部控制） */
    detail?: AgentTraceDetailLevel;
    /** 该轮是否仍在运行 —— 用于实时徽标与思考条目流式标记 */
    running?: boolean;
  }>(),
  { embedded: false, running: false, tools: () => [] },
);

const emit = defineEmits<{ (event: "update:detail", level: AgentTraceDetailLevel): void }>();

const open = ref(false);
/**
 * 用户对「展开/折叠」的显式覆盖。空 = 全部跟随详细度档位的默认值。
 * 用 Map 而非 Set：override 要能表达"把档位默认展开的关掉"。
 */
const expandedKeys = ref<Map<string, boolean>>(new Map());
/** 展开的轮次；默认只展开最新一轮，旧轮折叠成一行摘要 */
const openTurns = ref<Set<number>>(new Set());

const detailLevels = AGENT_TRACE_DETAIL_LEVELS;
const detail = computed(() => normalizeAgentTraceDetail(props.detail));
const live = computed(() => props.running);
const specOf = (level: AgentTraceDetailLevel) => resolveAgentTraceDetailSpec(level);

/**
 * 流式节流：reasoning_delta 是逐 token 追加的，直接跟随会让每帧都全量重建
 * （构建视图数组 + 渲染长文本，长会话实测是主要开销）。用 rAF 合并到每帧最多一次，
 * 与 `AgentInlineFeedItems.vue` 里 scheduleReasoningMeasure 的做法一致。
 *
 * 视图组装（`buildAgentRoundGroupViews` 的 map/filter/展开）也放在节流之后，
 * 保证流式期间每帧只做一次。**不**延迟首次构建 —— 换会话/清空要立刻反映。
 */
const throttledGroups = ref<AgentRoundGroupView[]>(buildViews(props.roundGroups, props.tools));
let rafId = 0;

function buildViews(groups: AgentRoundGroup[], tools: AgentRoundTool[]): AgentRoundGroupView[] {
  if (!groups?.length) return [];
  return buildAgentRoundGroupViews({ roundGroups: groups, tools });
}

function scheduleBuild() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    throttledGroups.value = buildViews(props.roundGroups, props.tools);
  });
}

watch(
  () => [props.roundGroups, props.tools] as const,
  ([next]) => {
    if (!next?.length) {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      throttledGroups.value = [];
      return;
    }
    scheduleBuild();
  },
);

onUnmounted(() => {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
});

const turns = computed(() =>
  buildAgentTraceTurns(throttledGroups.value, detail.value, live.value),
);
const totalEntries = computed(() => turns.value.reduce((sum, turn) => sum + turn.entries.length, 0));

const emptyHint = computed(() =>
  live.value ? "等待 Agent 产出…" : "本轮没有可展示的轨迹事件。",
);

function onPickDetail(level: AgentTraceDetailLevel) {
  emit("update:detail", level);
}

/**
 * 轮次集合变化时**只**调整展开的轮次；**不**清空 `expandedKeys`。
 *
 * 原来这里无条件 `expandedKeys.value = new Set()`。旧面板是"跑完才看"的静态快照，
 * 清空只发生一次、看不出来；现在面板实时刷新（实测 ~30ms 一次），那条清空会把
 * 用户刚点开的条目立刻收回去 —— 表现为「点了展开没反应」。
 * 用户展开意图必须跨更新保留。
 */
watch(
  () => turns.value.map((t) => t.turn).join(","),
  () => {
    const next = turns.value;
    if (!next.length) {
      openTurns.value = new Set();
      return;
    }
    const known = new Set(next.map((t) => t.turn));
    const stale = [...openTurns.value].some((t) => !known.has(t));
    // 轮次集合变化说明换了新轨迹，重置为只展开最新一轮；否则自动展开新增轮次
    if (stale) {
      openTurns.value = new Set([next[next.length - 1].turn]);
      return;
    }
    const last = next[next.length - 1].turn;
    if (!openTurns.value.has(last)) {
      openTurns.value = new Set([...openTurns.value, last]);
    }
  },
  { immediate: true },
);

/**
 * 切档位时清掉用户覆盖 —— 档位本身现在就是"展开程度"，
 * 残留的旧 override 会盖住新档位的默认展开态，让人以为切档没生效。
 */
watch(detail, () => {
  expandedKeys.value = new Map();
});

function isTurnOpen(turn: number): boolean {
  return openTurns.value.has(turn);
}

function toggleTurn(turn: number) {
  const next = new Set(openTurns.value);
  if (next.has(turn)) next.delete(turn);
  else next.add(turn);
  openTurns.value = next;
}

function turnSummary(turn: TraceTurn): string {
  const tools = turn.entries.filter((e) => e.kind === "tool").length;
  // 标题取「这轮产出了什么」而不是最后一条 —— 最后一条往往是过时的等待快照。
  // 详见 agentTraceTimeline.pickTurnHeadlineEntry 的注释。
  const headline = pickTurnHeadlineEntry(turn)?.label ?? "";
  const parts: string[] = [];
  // 标题里已经报了工具数（response 标签会带「调用 N 个工具」）就不再重复前缀
  if (tools && !headline.includes("工具")) parts.push(`${tools} 个工具`);
  if (headline) parts.push(headline);
  return parts.join(" · ");
}

/**
 * 条目正文是否展开。
 *
 * 默认值来自**详细度档位**（`entry.expandedByDefault`），用户在行上点箭头可临时覆盖。
 * override 用 `Map<key, boolean>` 而不是 `Set` —— 因为 override 要能表达"把默认展开的
 * 关掉"，`Set` 只能表达"把默认折叠的打开"。
 */
function isEntryOpen(entry: AgentTraceEntry): boolean {
  const override = expandedKeys.value.get(entry.key);
  if (override !== undefined) return override;
  return Boolean(entry.expandedByDefault);
}

/**
 * 思考正文的自动吸底跟随（沿用旧思考抽屉的行为）：
 * 内容还在长时把它滚到最新一行，让人看到"正在想什么"。
 * 用户一旦自己滚动该块，就停止跟随（避免抢视角）。
 */
const reasoningBodyEls = new Map<string, HTMLElement>();

function bindReasoningBody(key: string, el: unknown): void {
  const target = el instanceof HTMLElement ? el : null;
  if (!target) {
    reasoningBodyEls.delete(key);
    return;
  }
  reasoningBodyEls.set(key, target);
  followReasoningBody(key);
}

function followReasoningBody(key: string): void {
  const el = reasoningBodyEls.get(key);
  if (!el) return;
  if (userScrolledKeys.has(key)) return;
  el.scrollTop = el.scrollHeight;
}

function onReasoningBodyScroll(key: string): void {
  const el = reasoningBodyEls.get(key);
  if (!el) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 4;
  if (atBottom) userScrolledKeys.delete(key);
  else userScrolledKeys.add(key);
}

/** 用户手动滚动过的思考块 —— 暂停吸底，回到底部自动恢复。 */
const userScrolledKeys = new Set<string>();

/** 内容增长后把展开中的正文块贴到最新一行。 */
watch(
  () =>
    turns.value
      .flatMap((t) => t.entries.filter((e) => isEntryOpen(e)).map((e) => `${e.key}:${e.detail.length}`))
      .join("|"),
  () => {
    for (const key of reasoningBodyEls.keys()) followReasoningBody(key);
  },
);

function toggleEntry(key: string) {
  const current = turns.value
    .flatMap((t) => t.entries)
    .find((e) => e.key === key);
  const next = new Map(expandedKeys.value);
  const nowOpen = current ? isEntryOpen(current) : false;
  next.set(key, !nowOpen);
  expandedKeys.value = next;
}

/** 思考条目标签带上字数，折叠态也能看出思考量。 */
function entryLabel(entry: AgentTraceEntry): string {
  if (!entry.label.trim()) return "（无内容）";
  return entry.label;
}

function kindLabel(kind: AgentTraceEntry["kind"]): string {
  if (kind === "request") return "发";
  if (kind === "response") return "回";
  if (kind === "reasoning") return "思";
  if (kind === "tool") return "具";
  return "态";
}

function kindTitle(kind: AgentTraceEntry["kind"]): string {
  if (kind === "request") return "请求（发给模型的消息）";
  if (kind === "response") return "回复（模型返回）";
  if (kind === "reasoning") return "思考过程（模型的推理通道）";
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

/* 详细度切换条：抽屉头部下方一行 */
.agent-trace-detail-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-wrap: wrap;
}

.agent-trace-detail-caption {
  font-size: 10.5px;
  color: rgba(148, 163, 184, 0.6);
  margin-right: 2px;
}

.agent-trace-detail-btn {
  padding: 2px 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  background: transparent;
  color: rgba(148, 163, 184, 0.8);
  font-size: 10.5px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}

.agent-trace-detail-btn:hover {
  color: rgba(200, 214, 232, 0.95);
  border-color: rgba(126, 182, 255, 0.35);
}

.agent-trace-detail-btn--on {
  background: rgba(88, 166, 255, 0.16);
  border-color: rgba(126, 182, 255, 0.45);
  color: rgba(165, 214, 255, 0.95);
}

.agent-trace-live {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  font-size: 10px;
  color: rgba(120, 210, 140, 0.85);
}

.agent-trace-live-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  animation: agent-trace-breathe 1.6s ease-in-out infinite;
}

@keyframes agent-trace-breathe {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
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

.agent-trace-empty {
  padding: 12px 4px;
  font-size: 11.5px;
  color: rgba(139, 148, 158, 0.6);
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
  width: 100%;
  margin-bottom: 4px;
  padding: 3px 6px;
  border: none;
  border-radius: 4px;
  background: rgba(126, 182, 255, 0.06);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 100ms ease;
}

.agent-trace-turn-head:hover {
  background: rgba(126, 182, 255, 0.14);
}

.agent-trace-turn-chevron {
  font-size: 9px;
  color: rgba(126, 182, 255, 0.55);
  width: 10px;
  flex-shrink: 0;
}

.agent-trace-turn-summary {
  margin: -2px 0 2px 24px;
  font-size: 10.5px;
  color: rgba(139, 148, 158, 0.55);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.agent-trace-entry--reasoning .agent-trace-row-kind {
  background: rgba(163, 113, 247, 0.18);
  color: rgba(196, 160, 255, 0.92);
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

/** 思考条目正文：保持可读的思考色，与请求/回复区分开 */
.agent-trace-entry--reasoning .agent-trace-detail {
  border-left-color: rgba(163, 113, 247, 0.35);
  color: rgba(203, 190, 226, 0.9);
}

/*
 * 思考正文块：默认可见、流式时贴最新一行。
 * 比折叠展开的 detail 高一点（思考常有段落），仍设上限避免单条撑爆抽屉。
 */
.agent-trace-detail--live {
  max-height: 220px;
  overflow-y: auto;
  font-family: inherit;
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  color: rgba(210, 200, 232, 0.92);
}

.agent-trace-detail--live::-webkit-scrollbar {
  width: 4px;
}

.agent-trace-detail--live::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
}

.agent-trace-row-dot {
  flex-shrink: 0;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(196, 160, 255, 0.95);
  animation: agent-trace-breathe 1.6s ease-in-out infinite;
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
