<template>
  <Teleport to="body">
    <Transition name="agent-trace-drawer">
      <div v-if="state.open" class="agent-trace-drawer-layer">
        <div class="agent-trace-drawer-mask" @click="closeTraceDrawer"></div>
        <aside
          class="agent-trace-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Agent 数据流轨迹"
        >
          <header class="agent-trace-drawer-head">
            <span class="agent-trace-drawer-title">{{ state.title }}</span>
            <span v-if="state.roundGroups.length" class="agent-trace-drawer-sub">
              {{ state.roundGroups.length }} 轮
            </span>
            <button
              type="button"
              class="agent-trace-drawer-close"
              title="关闭轨迹抽屉（Esc）"
              @click="closeTraceDrawer"
            >
              ✕
            </button>
          </header>
          <div class="agent-trace-drawer-body">
            <AgentTracePanel
              v-if="state.roundGroups.length"
              :round-groups="state.roundGroups"
              embedded
            />
            <div v-else class="agent-trace-drawer-empty">
              暂无轨迹数据。点击 Agent 回复内的「数据流轨迹」入口查看对应轮次的执行记录。
            </div>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import AgentTracePanel from "./AgentTracePanel.vue";
import {
  closeTraceDrawer,
  useAgentTraceDrawerState,
} from "../services/agentTraceDrawer";

const state = useAgentTraceDrawerState();

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && state.open) {
    closeTraceDrawer();
  }
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<style scoped>
.agent-trace-drawer-layer {
  position: fixed;
  inset: 0;
  z-index: 1200;
}

.agent-trace-drawer-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(1px);
}

.agent-trace-drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(460px, 92vw);
  display: flex;
  flex-direction: column;
  background: #0d0f14;
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: -16px 0 40px rgba(0, 0, 0, 0.5);
}

.agent-trace-drawer-head {
  display: flex;
  align-items: center;
  gap: 8px;
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

.agent-trace-drawer-close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.92);
}

.agent-trace-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px 14px 20px;
  min-height: 0;
}

.agent-trace-drawer-empty {
  font-size: 12px;
  color: rgba(139, 148, 158, 0.7);
  padding: 16px 4px;
  line-height: 1.6;
}

/* 进入 / 退出动画 */
.agent-trace-drawer-enter-active,
.agent-trace-drawer-leave-active {
  transition: opacity 0.18s ease;
}

.agent-trace-drawer-enter-active .agent-trace-drawer,
.agent-trace-drawer-leave-active .agent-trace-drawer {
  transition: transform 0.18s ease;
}

.agent-trace-drawer-enter-from,
.agent-trace-drawer-leave-to {
  opacity: 0;
}

.agent-trace-drawer-enter-from .agent-trace-drawer,
.agent-trace-drawer-leave-to .agent-trace-drawer {
  transform: translateX(24px);
}
</style>
