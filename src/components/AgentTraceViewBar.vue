<template>
  <div class="trace-view-bar">
    <span class="trace-view-caption" :title="captionHint">默认展开</span>

    <button
      v-for="kind in kinds"
      :key="kind"
      type="button"
      class="trace-view-chip"
      :class="{
        'trace-view-chip--on': view.expand[kind],
        [`trace-view-chip--${kind}`]: true,
      }"
      :aria-pressed="view.expand[kind]"
      :title="kindUi[kind].chipTitle"
      @click="toggleExpand(kind)"
    >
      {{ kindUi[kind].label }}
    </button>

    <div ref="popoverWrapEl" class="trace-view-more">
      <button
        type="button"
        class="trace-view-gear"
        :class="{ 'trace-view-gear--on': popoverOpen }"
        aria-label="轨迹显示设置"
        title="正文长度、瞬态阶段、快捷预设"
        @click="popoverOpen = !popoverOpen"
      >
        ⚙
      </button>

      <div v-if="popoverOpen" class="trace-view-popover" @click.stop>
        <div class="trace-view-row">
          <span class="trace-view-row-label">正文长度</span>
          <div class="trace-view-seg">
            <button
              v-for="length in bodyLengths"
              :key="length"
              type="button"
              class="trace-view-seg-btn"
              :class="{ 'trace-view-seg-btn--on': length === view.bodyLength }"
              :title="bodySpec(length).hint"
              @click="pickBodyLength(length)"
            >
              {{ bodySpec(length).label }}
            </button>
          </div>
        </div>

        <label class="trace-view-row">
          <span class="trace-view-row-label" title="已回复轮次里的瞬态阶段（等待模型 / 压缩上下文之类）">
            瞬态阶段
          </span>
          <input
            type="checkbox"
            class="trace-view-check"
            :checked="view.transientPhases"
            @change="pickTransientPhases(($event.target as HTMLInputElement).checked)"
          />
        </label>

        <div class="trace-view-row">
          <span class="trace-view-row-label" title="一键套用一组配置">快捷预设</span>
          <div class="trace-view-seg">
            <button
              v-for="preset in presets"
              :key="preset.id"
              type="button"
              class="trace-view-seg-btn"
              :class="{ 'trace-view-seg-btn--on': activePreset === preset.id }"
              :title="preset.hint"
              @click="pickPreset(preset.id)"
            >
              {{ preset.label }}
            </button>
          </div>
        </div>

        <button type="button" class="trace-view-reset" title="恢复默认（只展开思考过程）" @click="resetView">
          恢复默认
        </button>
      </div>
    </div>

    <span v-if="live" class="trace-view-live">
      <span class="trace-view-live-dot" aria-hidden="true" />
      实时
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  AGENT_TRACE_BODY_LENGTHS,
  AGENT_TRACE_ENTRY_KINDS,
  AGENT_TRACE_KIND_UI,
  AGENT_TRACE_VIEW_PRESETS,
  applyAgentTraceViewPreset,
  createDefaultAgentTraceView,
  resolveAgentTraceBodySpec,
  withTraceBodyLength,
  withTraceExpand,
  withTraceTransientPhases,
  type AgentTraceBodyLength,
  type AgentTraceEntryKind,
  type AgentTraceViewConfig,
  type AgentTraceViewPreset,
} from "../services/agentTraceView";

const props = withDefaults(
  defineProps<{
    /** 当前显示配置（由 agentTraceDrawer 持有真相源） */
    view: AgentTraceViewConfig;
    /** 该轮是否仍在跑 —— 只影响「实时」徽标 */
    live?: boolean;
  }>(),
  { live: false },
);

const emit = defineEmits<{ (event: "update:view", view: AgentTraceViewConfig): void }>();

const kinds = AGENT_TRACE_ENTRY_KINDS;
const kindUi = AGENT_TRACE_KIND_UI;
const bodyLengths = AGENT_TRACE_BODY_LENGTHS;
const presets = AGENT_TRACE_VIEW_PRESETS;

const bodySpec = (length: AgentTraceBodyLength) => resolveAgentTraceBodySpec(length);

/**
 * 「默认展开」在面板里对应一行真实条目：行上的字（思/具/发/回/态）就是这里 chip 的字，
 * 点一下就等于"这行以后默认摊开"。所以文案要说清是"默认"展开 ——
 * 用户在行上手动点开/收起仍然随时可用（override 优先级更高）。
 */
const captionHint = "控制哪类条目正文默认摊开；每行仍可单独点开/收起";

/** 当前配置是否正好等于某个预设 —— 用来点亮预设按钮；组合态就都不亮。 */
const activePreset = computed<AgentTraceViewPreset | undefined>(() => {
  const match = presets.find((preset) => {
    const target = applyAgentTraceViewPreset(preset.id);
    return (
      target.bodyLength === props.view.bodyLength &&
      target.transientPhases === props.view.transientPhases &&
      AGENT_TRACE_ENTRY_KINDS.every((kind) => target.expand[kind] === props.view.expand[kind])
    );
  });
  return match?.id;
});

function toggleExpand(kind: AgentTraceEntryKind) {
  emit("update:view", withTraceExpand(props.view, kind, !props.view.expand[kind]));
}

function pickBodyLength(length: AgentTraceBodyLength) {
  emit("update:view", withTraceBodyLength(props.view, length));
}

function pickTransientPhases(on: boolean) {
  emit("update:view", withTraceTransientPhases(props.view, on));
}

function pickPreset(id: AgentTraceViewPreset) {
  emit("update:view", applyAgentTraceViewPreset(id));
}

function resetView() {
  emit("update:view", createDefaultAgentTraceView());
}

/* ------------------------------ 弹层开合 ------------------------------ */

const popoverOpen = ref(false);
const popoverWrapEl = ref<HTMLElement | null>(null);

function closePopover() {
  popoverOpen.value = false;
}

function handleOutsideClick(event: MouseEvent) {
  const target = event.target as Node | null;
  if (!target || popoverWrapEl.value?.contains(target)) return;
  closePopover();
}

/**
 * Esc 只关弹层，不连带关掉整个抽屉。
 *
 * 抽屉自己的 Esc 监听挂在 window 的冒泡阶段，这里用 **捕获** 阶段 + stopPropagation
 * 抢先处理掉 —— 否则按一下 Esc 会把面板整个关掉，弹层里的操作白做。
 */
function handleKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || !popoverOpen.value) return;
  event.stopPropagation();
  closePopover();
}

// 只在弹层打开期间挂全局监听，别给每次渲染挂常驻监听
watch(popoverOpen, (open) => {
  if (open) {
    document.addEventListener("mousedown", handleOutsideClick, true);
    document.addEventListener("keydown", handleKeydown, true);
    return;
  }
  document.removeEventListener("mousedown", handleOutsideClick, true);
  document.removeEventListener("keydown", handleKeydown, true);
});

onBeforeUnmount(() => {
  // 面板整体卸载（抽屉关闭）时兜底摘掉，别给文档留常驻监听
  document.removeEventListener("mousedown", handleOutsideClick, true);
  document.removeEventListener("keydown", handleKeydown, true);
});
</script>

<style scoped>
.trace-view-bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-wrap: wrap;
}

.trace-view-caption {
  font-size: 10.5px;
  color: rgba(148, 163, 184, 0.6);
  margin-right: 2px;
  white-space: nowrap;
}

/*
 * chip 的字面（思/具/发/回/态）与下方条目行的 kind 标签共用同一份元数据
 * （`AGENT_TRACE_KIND_UI`），所以这里直接复用各自类型的配色 ——
 * 用户看到同一个字就知道指的是同一类事件。
 */
.trace-view-chip {
  width: 24px;
  height: 20px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 5px;
  background: transparent;
  color: rgba(148, 163, 184, 0.55);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}

.trace-view-chip:hover {
  border-color: rgba(126, 182, 255, 0.35);
  color: rgba(200, 214, 232, 0.95);
}

/* 开 = 默认展开：给实心底 + 该类型自己的色，跟行内 kind 标签对得上 */
.trace-view-chip--on.trace-view-chip--reasoning {
  background: rgba(163, 113, 247, 0.22);
  border-color: rgba(163, 113, 247, 0.5);
  color: rgba(196, 160, 255, 0.95);
}

.trace-view-chip--on.trace-view-chip--tool {
  background: rgba(210, 153, 34, 0.2);
  border-color: rgba(210, 153, 34, 0.5);
  color: rgba(230, 190, 110, 0.95);
}

.trace-view-chip--on.trace-view-chip--request {
  background: rgba(88, 166, 255, 0.2);
  border-color: rgba(88, 166, 255, 0.5);
  color: rgba(126, 182, 255, 0.95);
}

.trace-view-chip--on.trace-view-chip--response {
  background: rgba(63, 185, 80, 0.2);
  border-color: rgba(63, 185, 80, 0.5);
  color: rgba(120, 210, 140, 0.95);
}

.trace-view-chip--on.trace-view-chip--phase {
  background: rgba(148, 163, 184, 0.22);
  border-color: rgba(148, 163, 184, 0.5);
  color: rgba(203, 213, 225, 0.95);
}

.trace-view-more {
  position: relative;
  margin-left: 2px;
}

.trace-view-gear {
  width: 22px;
  height: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 5px;
  background: transparent;
  color: rgba(148, 163, 184, 0.7);
  font-size: 11px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}

.trace-view-gear:hover,
.trace-view-gear--on {
  background: rgba(126, 182, 255, 0.16);
  border-color: rgba(126, 182, 255, 0.45);
  color: rgba(165, 214, 255, 0.95);
}

.trace-view-popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 6;
  width: 236px;
  padding: 10px 12px;
  border: 1px solid rgba(126, 182, 255, 0.22);
  border-radius: 8px;
  background: #12151c;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.trace-view-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.trace-view-row-label {
  font-size: 10.5px;
  color: rgba(148, 163, 184, 0.75);
  white-space: nowrap;
}

.trace-view-seg {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.trace-view-seg-btn {
  padding: 2px 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  background: transparent;
  color: rgba(148, 163, 184, 0.8);
  font-size: 10.5px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}

.trace-view-seg-btn:hover {
  color: rgba(200, 214, 232, 0.95);
  border-color: rgba(126, 182, 255, 0.35);
}

.trace-view-seg-btn--on {
  background: rgba(88, 166, 255, 0.16);
  border-color: rgba(126, 182, 255, 0.45);
  color: rgba(165, 214, 255, 0.95);
}

.trace-view-check {
  accent-color: rgb(88, 166, 255);
  cursor: pointer;
}

.trace-view-reset {
  margin-top: 2px;
  padding: 3px 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  background: transparent;
  color: rgba(148, 163, 184, 0.8);
  font-size: 10.5px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}

.trace-view-reset:hover {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(200, 214, 232, 0.95);
  border-color: rgba(126, 182, 255, 0.3);
}

.trace-view-live {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  font-size: 10px;
  color: rgba(120, 210, 140, 0.85);
}

.trace-view-live-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  animation: trace-view-breathe 1.6s ease-in-out infinite;
}

@keyframes trace-view-breathe {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}
</style>
