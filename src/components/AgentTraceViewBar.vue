<template>
  <div class="trace-view-bar">
    <div class="trace-view-group">
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
    </div>

    <div ref="popoverWrapEl" class="trace-view-more">
      <button
        type="button"
        class="trace-view-gear"
        :class="{ 'trace-view-gear--on': popoverOpen }"
        aria-label="轨迹显示设置"
        title="正文长度、瞬态阶段、快捷预设"
        @click="popoverOpen = !popoverOpen"
      >
        <svg
          class="trace-view-gear-icon"
          viewBox="0 0 16 16"
          width="13"
          height="13"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="8" cy="8" r="2.2" />
          <path
            d="M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3"
          />
        </svg>
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

        <label class="trace-view-row">
          <span class="trace-view-row-label" title="Agent 跑起来时自动把整个面板放大占满工作区，思考正文全宽观看">
            思考时自动放大
          </span>
          <input
            type="checkbox"
            class="trace-view-check"
            :checked="view.autoMaximize"
            @change="pickAutoMaximize(($event.target as HTMLInputElement).checked)"
          />
        </label>

        <label class="trace-view-row">
          <span
            class="trace-view-row-label"
            title="Agent 思考中时，让「思考过程」正文撑满整个数据流轨迹窗口；跑完自动恢复常规高度"
          >
            思考中撑满窗口
          </span>
          <input
            type="checkbox"
            class="trace-view-check"
            :checked="view.fillThinking"
            @change="pickFillThinking(($event.target as HTMLInputElement).checked)"
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
  withTraceAutoMaximize,
  withTraceFillThinking,
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

function pickAutoMaximize(on: boolean) {
  emit("update:view", withTraceAutoMaximize(props.view, on));
}

function pickFillThinking(on: boolean) {
  emit("update:view", withTraceFillThinking(props.view, on));
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
  gap: 10px;
  padding: 9px 14px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.018), rgba(255, 255, 255, 0));
  flex-wrap: wrap;
}

/*
 * 「默认展开」标签 + 五个 chip 收进一个浅底小容器，
 * 明确表达「这是一组开关」，跟右侧齿轮拉开层次。
 */
.trace-view-group {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.035);
}

.trace-view-caption {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: rgba(163, 176, 194, 0.85);
  margin-right: 3px;
  white-space: nowrap;
}

/*
 * chip 的字面（思/具/发/回/态）与下方条目行的 kind 标签共用同一份元数据
 * （`AGENT_TRACE_KIND_UI`），所以这里直接复用各自类型的配色 ——
 * 用户看到同一个字就知道指的是同一类事件。
 */
.trace-view-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  flex: 0 0 auto;
  width: 28px;
  height: 24px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(210, 220, 234, 0.82);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease,
    box-shadow 120ms ease;
}

.trace-view-chip:hover {
  border-color: rgba(126, 182, 255, 0.42);
  background: rgba(126, 182, 255, 0.12);
  color: rgba(232, 240, 250, 1);
}

/*
 * chip 与下方条目行的「思/具/发/回/态」字标共用同一套配色：统一蓝色。
 * 类型靠字区分、不靠色相 —— 和 AgentTracePanel 的单主色保持一致（改一处别忘另一处）。
 */
.trace-view-chip--on {
  background: rgba(88, 166, 255, 0.24);
  border-color: rgba(88, 166, 255, 0.6);
  color: rgba(150, 197, 255, 1);
  box-shadow: 0 0 0 1px rgba(88, 166, 255, 0.15), 0 2px 8px rgba(56, 139, 253, 0.22);
}

.trace-view-more {
  position: relative;
  margin-left: auto;
  flex: 0 0 auto;
}

/*
 * 全局 button 带 padding:8px 16px，会把这枚小方钮撑成宽盒子、图标被挤到角落；
 * 这里清 padding + 固定宽高 + box-sizing:border-box + flex:0 0 auto，锁死成正方形小钮。
 */
.trace-view-gear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  flex: 0 0 auto;
  width: 28px;
  height: 24px;
  min-width: 28px;
  max-width: 28px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(210, 220, 234, 0.78);
  line-height: 1;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease,
    box-shadow 120ms ease;
}

.trace-view-gear-icon {
  display: block;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.trace-view-gear:hover,
.trace-view-gear--on {
  background: rgba(126, 182, 255, 0.16);
  border-color: rgba(126, 182, 255, 0.45);
  color: rgba(165, 214, 255, 0.95);
}

/*
 * 齿轮在工具条最右端，弹层必须从它**向左**展开（right:0），
 * 否则 `left:0` 的 236px 会被抽屉层 overflow:hidden 从右侧裁掉、显示不全。
 * 宽度 / 高度都做视口兜底，窄面板或矮窗口下也不溢出被裁。
 */
.trace-view-popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  left: auto;
  z-index: 6;
  width: min(236px, calc(100vw - 24px));
  max-height: min(70vh, calc(100vh - 24px));
  overflow-y: auto;
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
