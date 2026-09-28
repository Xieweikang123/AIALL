<template>
  <div
    class="agent-trace-panel"
    :class="{
      'agent-trace-panel--embedded': embedded,
      'agent-trace-panel--roomy': roomy,
      'agent-trace-panel--fill-thinking': fillThinkingActive,
    }"
  >
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

    <AgentTraceViewBar
      v-if="embedded"
      :view="view"
      :live="live"
      @update:view="onPickView"
    />

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
              <span class="agent-trace-row-kind" :title="kindUi[entry.kind].title">{{ kindUi[entry.kind].label }}</span>
              <span v-if="entry.kind === 'reasoning' && entry.streaming" class="agent-trace-row-dot" aria-hidden="true" />
              <span class="agent-trace-row-label">{{ entryLabel(entry) }}</span>
              <span v-if="entry.elapsedMs !== undefined" class="agent-trace-row-time">{{ formatElapsed(entry.elapsedMs) }}</span>
            </button>
            <!--
              展开程度由显示配置决定（entry.expandedByDefault），用户点箭头可临时覆盖。
              思考默认展开 —— 它是「过程」，要能边跑边看。

              思考正文走 Markdown（与聊天气泡内过程 feed 的思考同一渲染面）；
              请求/回复/工具是 JSON / 日志，保持等宽纯文本 —— 渲染 Markdown 会
              把缩进与换行吃掉。
            -->
            <div
              v-if="isEntryOpen(entry)"
              :ref="(el) => bindReasoningBody(entry.key, el)"
              class="agent-trace-detail"
              :class="{
                'agent-trace-detail--live': entry.streaming,
                'agent-trace-detail--md': entry.kind === 'reasoning',
              }"
              @scroll="onReasoningBodyScroll(entry.key)"
              @wheel="userScrolledKeys.add(entry.key)"
            >
              <ChatMarkdown
                v-if="entry.kind === 'reasoning'"
                class="agent-trace-markdown"
                :content="reasoningMarkdown(entry.detail)"
                :streaming="entry.streaming === true"
                :interactive="false"
              />
              <template v-else>{{ entry.detail }}</template>
            </div>
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
import AgentTraceViewBar from "./AgentTraceViewBar.vue";
import ChatMarkdown from "./ChatMarkdown.vue";
import {
  buildAgentTraceTurns,
  pickTurnHeadlineEntry,
  type AgentTraceEntry,
} from "../services/agentTraceTimeline";
import {
  AGENT_TRACE_KIND_UI,
  createDefaultAgentTraceView,
  normalizeAgentTraceView,
  prepareTraceReasoningMarkdown,
  type AgentTraceViewConfig,
} from "../services/agentTraceView";
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
    /** 显示配置（由抽屉头部控制） */
    view?: AgentTraceViewConfig;
    /** 该轮是否仍在运行 —— 用于实时徽标与思考条目流式标记 */
    running?: boolean;
    /**
     * 宽松模式：面板放大占满工作区时打开。
     * 思考正文不再受 220px 上限约束，整段摊开由外层滚动 —— 这就是"放大到窗口全部观看"。
     */
    roomy?: boolean;
    /**
     * 「思考中撑满轨迹窗口」开关。为 true 且面板正在跑时，
     * 思考正文铺满整个轨迹窗口（不再被 220px 小框卡住），其余条目让位。
     */
    fillThinking?: boolean;
  }>(),
  { embedded: false, running: false, tools: () => [], roomy: false, fillThinking: false },
);

const emit = defineEmits<{ (event: "update:view", view: AgentTraceViewConfig): void }>();

const open = ref(false);
/**
 * 用户对「展开/折叠」的显式覆盖。空 = 全部跟随显示配置的默认值。
 * 用 Map 而非 Set：override 要能表达"把默认展开的关掉"。
 */
const expandedKeys = ref<Map<string, boolean>>(new Map());
/** 展开的轮次；默认只展开最新一轮，旧轮折叠成一行摘要 */
const openTurns = ref<Set<number>>(new Set());

const kindUi = AGENT_TRACE_KIND_UI;
/** 归一化脏值：外部传进来的是旧档位字符串或半截对象时也不能把面板搞坏 */
const view = computed(() => normalizeAgentTraceView(props.view));
const live = computed(() => props.running);
/** 「思考中撑满轨迹窗口」只在运行时生效；跑完自动恢复常规高度。 */
const fillThinkingActive = computed(() => props.fillThinking === true && live.value);

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

const turns = computed(() => buildAgentTraceTurns(throttledGroups.value, view.value, live.value));
const totalEntries = computed(() => turns.value.reduce((sum, turn) => sum + turn.entries.length, 0));

const emptyHint = computed(() =>
  live.value ? "等待 Agent 产出…" : "本轮没有可展示的轨迹事件。",
);

function onPickView(next: AgentTraceViewConfig) {
  emit("update:view", next);
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
 * 改显示配置时清掉用户覆盖 —— 配置本身现在就是"哪几类默认展开"，
 * 残留的旧 override 会盖住新配置的默认展开态，让人以为改了没生效。
 */
watch(view, () => {
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
 * 默认值来自**显示配置**（`entry.expandedByDefault`），用户在行上点箭头可临时覆盖。
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

/** 思考正文 → Markdown 源（去掉截断提示、补齐截断处裂开的代码围栏）。 */
function reasoningMarkdown(detail: string): string {
  return prepareTraceReasoningMarkdown(detail);
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

/* 显示配置条在 AgentTraceViewBar 里自带样式（chip 与行内 kind 标签共用配色） */

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
  font-size: 9.5px;
  color: rgba(139, 148, 158, 0.4);
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

/*
 * 条目类型的字标（思/具/发/回/态）统一用同一个蓝色底 —— 类型靠**字**区分，
 * 不靠色相。此前五类各一个颜色（蓝/绿/紫/琥珀/灰），一个列表里六种色挤在
 * 一起显花；改单主色后整块安静下来，强调位只留轮次头与箭头。
 */
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
  background: rgba(88, 166, 255, 0.14);
  color: rgba(126, 182, 255, 0.9);
}

.agent-trace-entry--fail .agent-trace-row {
  color: rgba(255, 180, 171, 0.9);
}

/*
 * 条目正文基础样式。
 * 必须排在 `.agent-trace-detail--live` **之前** —— 两者特异性相同（单个 class），
 * 谁在后谁赢。此前基础块写在了 --live 之后，把思考块的 `font-family: inherit` /
 * `font-size: 11px` / `max-height: 220px` 全部盖成了等宽 10.5px/180px。
 */
.agent-trace-detail {
  /* 右边距不能为 0：嵌入抽屉时 body padding 被清掉，正文框（含自带滚动条）会顶到面板最右 */
  margin: 2px 8px 4px 26px;
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

/*
 * 思考条目正文：不再上紫色，改回与其它条目一致的中性灰 —— 单主色下只靠
 * 左侧竖线的蓝调区分「思考」，正文本身不染色，避免整块发灰紫、对比度偏低。
 */
.agent-trace-entry--reasoning .agent-trace-detail {
  border-left-color: rgba(126, 182, 255, 0.3);
  color: rgba(186, 196, 208, 0.9);
}

/*
 * 放大占满工作区时，思考正文不再被 220px 小框卡住 —— 整段摊开，滚动交给外层
 * `.agent-trace-drawer-body`。这就是「放大到窗口全部观看」的落点。
 *
 * 只放开思考（--md）：请求 / 回复 / 工具的 JSON 仍是小框 + 内部滚动，
 * 避免超长日志在放大态下把整块撑到几屏高。
 */
.agent-trace-panel--roomy .agent-trace-detail--md {
  max-height: none;
  overflow: visible;
}

/*
 * 「思考中撑满轨迹窗口」：面板变成纵向 flex，思考条目（含其正文框）一路铺到
 * 容器底部，正文框内部滚动承载超长思考。
 * 只在运行时生效（见 fillThinkingActive），跑完自动回到常规高度。
 */
.agent-trace-panel--fill-thinking {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 正文区（条目宿主）也要吃满剩余高度，否则 flex 链断在这里、思考框撑不高 */
.agent-trace-panel--fill-thinking .agent-trace-body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

/* 条目与轮次都要能往下传高度：链上任意一环 min-height:0 缺失，flex 子项就撑不出滚动区 */
.agent-trace-panel--fill-thinking .agent-trace-entry,
.agent-trace-panel--fill-thinking .agent-trace-turn {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/*
 * 思考条目独占剩余高度。`:has` 让「只有这一轮有思考」的常见情形也生效；
 * 未命中（如展开中的请求/回复更长）时靠 `flex: 1 1 auto` 仍会分到空余空间。
 */
.agent-trace-panel--fill-thinking .agent-trace-entry--reasoning {
  flex: 1 1 auto;
  min-height: 0;
}

.agent-trace-panel--fill-thinking .agent-trace-entry--reasoning .agent-trace-detail--md {
  flex: 1 1 auto;
  max-height: none;
  min-height: 120px;
  overflow: auto;
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
  color: rgba(208, 216, 228, 0.94);
}

/*
 * 思考正文改走 Markdown 后的容器：白名单恢复排版 ——
 * 基础块是 `white-space: pre-wrap` + 等宽字体（给 JSON/日志用），
 * Markdown 的 <pre> 会继承 pre-wrap 造成代码块双重换行，字体也会被吃掉。
 */
.agent-trace-detail--md {
  white-space: normal;
  font-family: inherit;
}

/* Markdown 正文在 11px 轨迹里跟着缩一号，行高与正文一致 */
.agent-trace-markdown :deep(.msg-markdown) {
  font-size: 11px;
  line-height: 1.55;
  color: rgba(208, 216, 228, 0.94);
}

.agent-trace-detail--md::-webkit-scrollbar {
  width: 4px;
}

.agent-trace-detail--md::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
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

@keyframes agent-trace-breathe {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
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

</style>
