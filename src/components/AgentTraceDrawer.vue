<template>
  <Transition name="agent-trace-drawer">
    <div v-if="state.open" class="agent-trace-drawer-layer" :class="{ 'agent-trace-drawer-layer--max': state.maximized }">
      <aside
        class="agent-trace-drawer"
        role="dialog"
        aria-label="Agent 数据流轨迹"
      >
        <header class="agent-trace-drawer-head">
          <span class="agent-trace-drawer-title">{{ state.title }}</span>
          <span v-if="groups.length" class="agent-trace-drawer-sub">
            {{ groups.length }} 轮
          </span>
          <button
            type="button"
            class="agent-trace-drawer-max"
            :class="{ active: state.maximized }"
            role="switch"
            :aria-checked="state.maximized ? 'true' : 'false'"
            :title="state.maximized ? '还原为右侧窄列，点击收起' : '放大占满工作区观看，点击展开'"
            @click="setTraceMaximized(!state.maximized)"
          >
            {{ state.maximized ? "⤡ 还原" : "⤢ 放大" }}
          </button>
          <button
            type="button"
            class="agent-trace-drawer-auto"
            :class="{ active: state.autoEnabled }"
            role="switch"
            :aria-checked="state.autoEnabled ? 'true' : 'false'"
            :title="
              state.autoEnabled
                ? '自动打开已开启：Agent 思考时自动展开本面板，点击关闭'
                : '自动打开已关闭：Agent 思考时不再自动展开本面板，点击开启'
            "
            @click="setTraceAutoEnabled(!state.autoEnabled)"
          >
            <span class="agent-trace-drawer-auto-dot" aria-hidden="true" />
            自动打开
          </button>
          <button
            v-if="groups.length"
            type="button"
            class="agent-trace-drawer-copy"
            :disabled="copying"
            :title="copyHint || '导出完整轨迹到 .aiall/agent-traces/ 并复制绝对路径'"
            @click="copyTracePath"
          >
            {{ copyLabel }}
          </button>
          <button
            type="button"
            class="agent-trace-drawer-close"
            title="关闭轨迹抽屉（Esc）"
            @click="closeTraceDrawer"
          >
            ✕
          </button>
        </header>
        <div
          ref="bodyEl"
          class="agent-trace-drawer-body"
          :class="{ 'agent-trace-drawer-body--fill': fillBody }"
          @scroll="onBodyScroll"
          @wheel="markUserIntent"
          @touchstart="markUserIntent"
          @mousedown="markUserIntent"
        >
          <AgentTracePanel
            v-if="groups.length"
            :round-groups="groups"
            :tools="tools"
            :view="state.view"
            :running="running"
            :roomy="state.maximized"
            :fill-thinking="state.view.fillThinking"
            embedded
            @update:view="setTraceView"
          />
          <div v-else class="agent-trace-drawer-empty">
            {{ emptyHint }}
          </div>
        </div>
        <button
          v-if="!follow && groups.length"
          type="button"
          class="agent-trace-drawer-follow"
          title="回到底部并恢复自动跟随"
          @click="resumeFollow"
        >
          跟随最新 ↓
        </button>
      </aside>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import AgentTracePanel from "./AgentTracePanel.vue";
import { buildAgentRoundGroupViews } from "../services/agentRoundGroups";
import {
  AGENT_TRACE_PANEL_WIDTH,
  closeTraceDrawer,
  resolveTraceRoundGroups,
  resolveTraceRunning,
  resolveTraceTools,
  setTraceAutoEnabled,
  setTraceMaximized,
  setTraceView,
  useAgentTraceDrawerState,
} from "../services/agentTraceDrawer";
import { dumpAgentTraceToFile } from "../services/agentTraceDump";
import {
  isScrollNearBottom,
  scheduleScrollContainerToBottom,
  scrollContainerToBottom,
} from "../utils/scrollViewport";

const state = useAgentTraceDrawerState();
/** 宽度与 `usePanelLayout` 共用同一常量（CSS 侧 `v-bind` 读它），避免两处数字漂移。 */
const tracePanelWidth = ref(`${AGENT_TRACE_PANEL_WIDTH}px`);
const copying = ref(false);
const copyStatus = ref<"idle" | "ok" | "err">("idle");
const copyHint = ref("");
let copyResetTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 实时解析当前消息的 roundGroups（而非打开时的快照）——
 * 运行中面板也要跟着长，见 `agentTraceDrawer.ts` 顶部说明。
 * 这两个 getter 只查表，视图组装放在面板的 rAF 节流之后。
 */
const groups = computed(() => resolveTraceRoundGroups());
const tools = computed(() => resolveTraceTools());

/** 导出用：把原始轮次组装成视图（含每轮 tools）。只在这一个动作上付组装成本。 */
const views = computed(() =>
  groups.value.length
    ? buildAgentRoundGroupViews({ roundGroups: groups.value, tools: tools.value })
    : [],
);

/**
 * 整轮是否仍在跑。**不能**只看 `!last.response?.isFinal` —— 运行中断/异常结束时
 * 有些轮次永远拿不到 `isFinal`，那样「思考中…」会一直挂着不收（实测踩过）。
 * 用运行时注入的真实信号（见 `setTraceRunningResolver`），拿不到才退回结构判断。
 */
const running = computed(() => {
  const fromRuntime = resolveTraceRunning();
  if (fromRuntime !== null) return fromRuntime;
  const list = groups.value;
  const last = list[list.length - 1];
  return Boolean(last && !last.response?.isFinal);
});

/** 「思考中撑满轨迹窗口」：开关打开且 Agent 在跑时给正文区切到纵向 flex。 */
const fillBody = computed(() => running.value && state.view.fillThinking === true);

/**
 * 抽屉整体的自动吸底跟随。
 *
 * 之前完全没有：面板内容一直在增长，但滚动位置不动，用户得不停手动往下拖 ——
 * 对一个「实时看运行过程」的面板来说等于没法看。
 *
 * 规则与聊天流 / 旧思考抽屉一致：默认跟随；用户自己滚动就暂停；回到底部自动恢复。
 */
const bodyEl = ref<HTMLElement | null>(null);
const follow = ref(true);
/** 用户主动操作过（滚轮/触摸/按下）—— 避免把程序滚动误判成用户意图。 */
let userIntent = false;
let followRaf = 0;

function atBottom(): boolean {
  const el = bodyEl.value;
  if (!el) return true;
  return isScrollNearBottom(el, 24);
}

function onBodyScroll(): void {
  follow.value = atBottom();
}

function markUserIntent(): void {
  userIntent = true;
}

function scrollToBottom(): void {
  const el = bodyEl.value;
  if (!el) return;
  scrollContainerToBottom(el, "auto");
}

function resumeFollow(): void {
  follow.value = true;
  scrollToBottom();
}

/**
 * 内容增长时贴到最新一行。用 rAF 合并 —— 流式期间数据每帧都在变，
 * 直接跟随会每帧多次布局读取。
 */
watch(
  () => [
    groups.value.length,
    groups.value[groups.value.length - 1]?.reasoning?.length ?? 0,
    groups.value[groups.value.length - 1]?.narrative?.length ?? 0,
    groups.value[groups.value.length - 1]?.modelSteps.length ?? 0,
    groups.value[groups.value.length - 1]?.toolIds.length ?? 0,
  ],
  () => {
    if (!follow.value) return;
    if (userIntent) {
      userIntent = false;
      return;
    }
    if (followRaf) return;
    followRaf = requestAnimationFrame(() => {
      followRaf = 0;
      scrollToBottom();
    });
  },
  { flush: "post" },
);

/** 打开抽屉时直接落到最新，否则进来看到的是顶部旧内容。 */
watch(
  () => state.open,
  (open) => {
    if (!open) return;
    follow.value = true;
    // 内容渲染后可能二次撑高（长文本换行），多次重试落底
    scheduleScrollContainerToBottom(() => bodyEl.value, { delaysMs: [0, 60, 200] });
  },
);

onUnmounted(() => {
  if (followRaf) cancelAnimationFrame(followRaf);
  followRaf = 0;
});

const emptyHint = computed(() =>
  running.value
    ? "等待 Agent 产出…"
    : "暂无轨迹数据。点击 Agent 回复内的「数据流轨迹」入口查看对应轮次的执行记录。",
);

const copyLabel = computed(() => {
  if (copying.value) return "导出中…";
  if (copyStatus.value === "ok") return "已复制";
  if (copyStatus.value === "err") return "失败";
  return "复制路径";
});

async function copyTracePath(): Promise<void> {
  if (copying.value || !groups.value.length) return;
  copying.value = true;
  copyStatus.value = "idle";
  copyHint.value = "";
  try {
    const result = await dumpAgentTraceToFile({
      projectPath: state.projectPath,
      sessionId: state.sessionId,
      messageId: state.messageId,
      roundGroups: views.value,
      view: state.view,
    });
    if (!result.ok) {
      copyStatus.value = "err";
      copyHint.value = result.error;
      return;
    }
    if (!navigator.clipboard?.writeText) {
      copyStatus.value = "err";
      copyHint.value = `已写入但剪贴板不可用：${result.absolutePath}`;
      return;
    }
    await navigator.clipboard.writeText(result.clipboardText);
    copyStatus.value = "ok";
    copyHint.value = result.absolutePath;
  } catch (error) {
    copyStatus.value = "err";
    copyHint.value = error instanceof Error ? error.message : "复制失败";
  } finally {
    copying.value = false;
    if (copyResetTimer) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      copyStatus.value = "idle";
      copyHint.value = "";
      copyResetTimer = null;
    }, 3200);
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && state.open) {
    closeTraceDrawer();
  }
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  if (copyResetTimer) clearTimeout(copyResetTimer);
});
</script>

<style scoped>
/*
 * 工作区最右侧的一列：进布局流的普通 flex item，不是 fixed 浮层，
 * 所以不会盖住会话面板 —— 两边真正并排，编辑器（flex:1）自动让出宽度。
 * 收起靠 Esc / ✕ / 工具栏「轨迹」按钮。
 *
 * 历史形态（都别改回去）：
 * - modal：全屏遮罩 + aria-modal，工具栏和聊天输入全被吞掉；
 * - fixed 浮层：非模态了，但仍压在会话面板上面。
 */
.agent-trace-drawer-layer {
  display: flex;
  flex-direction: column;
  width: min(v-bind(tracePanelWidth), 42vw);
  flex-shrink: 1;
  min-width: 0;
  min-height: 0;
  /* 收起时把面板裁掉：宽度归零时不留 1px 边框/阴影的残影 */
  overflow: hidden;
  box-shadow: -16px 0 40px rgba(0, 0, 0, 0.5);
}

.agent-trace-drawer {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  width: 100%;
  /* 「跟随最新」按钮的定位上下文 */
  position: relative;
  background: #0d0f14;
  border-left: 1px solid rgba(255, 255, 255, 0.1);
}

/*
 * 放大态：脱离右侧窄列，铺满整个工作区（覆盖在会话/编辑器之上）。
 *
 * `.workspace` 是 position: relative，抽屉作为它的 flex 子项 absolute 铺满即可 ——
 * 与窄屏媒体查询同一套接管式做法。不占布局流，所以不会把编辑器挤到最小宽度。
 * 靠内层 overflow: hidden 裁住旧宽度，宽度过渡由 0.2s 动画完成（见下）。
 */
.agent-trace-drawer-layer--max {
  position: absolute;
  inset: 0;
  width: 100% !important;
  z-index: 6;
  box-shadow: none;
}

.agent-trace-drawer-layer--max .agent-trace-drawer {
  border-left: none;
}

/*
 * 窄屏（含移动端）装不下第三列：退化成铺满工作区的接管式面板，
 * `.workspace` 是 position: relative，这里 absolute 正好盖住工作区、底部导航不受影响。
 */
@media (max-width: 768px) {
  .agent-trace-drawer-layer {
    position: absolute;
    inset: 0;
    width: 100% !important;
    z-index: 5;
    border-left: none;
    box-shadow: none;
  }
}

.agent-trace-drawer-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.agent-trace-drawer-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
}

.agent-trace-drawer-sub {
  font-size: 10.5px;
  color: rgba(126, 182, 255, 0.75);
  font-variant-numeric: tabular-nums;
  padding: 1px 7px;
  border-radius: 4px;
  background: rgba(88, 166, 255, 0.12);
}

/*
 * 「放大 / 还原」按钮：切面板尺寸，不改开合与消息锁。
 * 与「自动打开」同为面板头部控件，样式共用一套底色，避免两个按钮观感割裂。
 */
.agent-trace-drawer-max {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(201, 209, 217, 0.6);
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.agent-trace-drawer-max:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(226, 232, 240, 0.9);
}

.agent-trace-drawer-max.active {
  color: rgba(165, 214, 255, 0.95);
  border-color: rgba(88, 166, 255, 0.45);
  background: rgba(88, 166, 255, 0.14);
}

.agent-trace-drawer-max.active:hover {
  background: rgba(88, 166, 255, 0.2);
  color: #a5d6ff;
}

/*
 * 「自动打开」开关：面板自己的持久化配置入口。
 * 开着 → Agent 一跑自动展开本面板；关掉只影响自动行为，手动「轨迹」入口照旧。
 */
.agent-trace-drawer-auto {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px 3px 7px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(201, 209, 217, 0.6);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.agent-trace-drawer-auto:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(226, 232, 240, 0.9);
}

.agent-trace-drawer-auto-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(139, 148, 158, 0.55);
  flex-shrink: 0;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}

.agent-trace-drawer-auto.active {
  color: rgba(165, 214, 255, 0.95);
  border-color: rgba(88, 166, 255, 0.45);
  background: rgba(88, 166, 255, 0.14);
}

.agent-trace-drawer-auto.active .agent-trace-drawer-auto-dot {
  background: #58a6ff;
  box-shadow: 0 0 6px rgba(88, 166, 255, 0.7);
}

.agent-trace-drawer-auto.active:hover {
  background: rgba(88, 166, 255, 0.2);
  color: #a5d6ff;
}

.agent-trace-drawer-copy {
  margin-left: auto;
  padding: 3px 9px;
  border: 1px solid rgba(126, 182, 255, 0.28);
  border-radius: 6px;
  background: rgba(88, 166, 255, 0.1);
  color: rgba(165, 214, 255, 0.92);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.agent-trace-drawer-copy:hover:not(:disabled) {
  background: rgba(88, 166, 255, 0.18);
  border-color: rgba(126, 182, 255, 0.45);
}

.agent-trace-drawer-copy:disabled {
  opacity: 0.65;
  cursor: default;
}

.agent-trace-drawer-close {
  margin-left: auto;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: 6px;
  color: rgba(139, 148, 158, 0.8);
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s ease, color 0.15s ease;
}

.agent-trace-drawer-copy + .agent-trace-drawer-close {
  margin-left: 6px;
}

.agent-trace-drawer-close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.92);
}

.agent-trace-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 0 20px;
  min-height: 0;
}

/*
 * 「思考中撑满」开关打开且 Agent 在跑：正文区改成纵向 flex，
 * 让内层轨迹面板拿到确定高度（`flex: 1`），思考正文才能铺满整个轨迹窗口。
 * 思考内容超长时仍由本容器滚动，不会把抽屉顶破。
 */
.agent-trace-drawer-body--fill {
  display: flex;
  flex-direction: column;
}

.agent-trace-drawer-body--fill > .agent-trace-panel {
  flex: 1 1 auto;
  min-height: 0;
}

/* 「跟随最新」浮在内容右下角：暂停跟随后给一个一键回到底部的入口 */
.agent-trace-drawer-follow {
  position: absolute;
  right: 16px;
  bottom: 16px;
  padding: 4px 12px;
  border: 1px solid rgba(126, 182, 255, 0.35);
  border-radius: 14px;
  background: rgba(30, 41, 59, 0.95);
  color: rgba(165, 214, 255, 0.95);
  font-size: 11px;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
  transition: background 0.15s ease, border-color 0.15s ease;
}

.agent-trace-drawer-follow:hover {
  background: rgba(51, 65, 85, 0.98);
  border-color: rgba(126, 182, 255, 0.6);
}

.agent-trace-drawer-empty {
  font-size: 12px;
  color: rgba(139, 148, 158, 0.7);
  padding: 16px 18px;
  line-height: 1.6;
}

/*
 * 进入 / 退出动画：**宽度**从 0 展开到整列，编辑器（flex:1）和折叠态下的会话面板
 * 随自由空间连续变化，不再是「淡出完最后一帧硬弹」。
 * 动画期间把内层面板钉死在最终宽度（`width: 100%` 会跟着逐帧挤压正文、造成二次抖动），
 * 靠外层 `overflow: hidden` 裁切，观感就是面板向右滑出。
 */
.agent-trace-drawer-enter-active,
.agent-trace-drawer-leave-active {
  transition: width 0.2s ease, opacity 0.18s ease;
}
.agent-trace-drawer-enter-active .agent-trace-drawer,
.agent-trace-drawer-leave-active .agent-trace-drawer {
  width: min(v-bind(tracePanelWidth), 42vw);
  transition: transform 0.2s ease;
}

/* 带上前缀提高特异性，不靠「声明顺序在后」压过基础规则 */
.agent-trace-drawer-layer.agent-trace-drawer-enter-from,
.agent-trace-drawer-layer.agent-trace-drawer-leave-to {
  opacity: 0;
  width: 0;
}

/*
 * 放大态下，进场/退场动画里的「钉死窄宽」和「从 0 宽滑出」都不适用 ——
 * 放大后是铺满工作区，若还钉 420px 会在动画期间露一条缝、结束后硬跳。
 * 特异性带上前缀，压过上面的基础动画规则（不靠声明顺序）。
 */
.agent-trace-drawer-layer--max.agent-trace-drawer-enter-active,
.agent-trace-drawer-layer--max.agent-trace-drawer-leave-active {
  width: 100% !important;
}
.agent-trace-drawer-layer--max.agent-trace-drawer-enter-active .agent-trace-drawer,
.agent-trace-drawer-layer--max.agent-trace-drawer-leave-active .agent-trace-drawer {
  width: 100%;
}
.agent-trace-drawer-layer--max.agent-trace-drawer-enter-from,
.agent-trace-drawer-layer--max.agent-trace-drawer-leave-to {
  width: 100%;
}

.agent-trace-drawer-enter-from .agent-trace-drawer,
.agent-trace-drawer-leave-to .agent-trace-drawer {
  transform: translateX(24px);
}

/* 尊重系统的「减少动态效果」：宽度直接跳，不做 0.2s 的连续重排 */
@media (prefers-reduced-motion: reduce) {
  .agent-trace-drawer-enter-active,
  .agent-trace-drawer-leave-active,
  .agent-trace-drawer-enter-active .agent-trace-drawer,
  .agent-trace-drawer-leave-active .agent-trace-drawer {
    transition: none;
  }
}
</style>
