<template>
  <div
    class="agent-live-status"
    :class="{
      'agent-live-status--banner': variant === 'banner',
      'agent-live-status--rail': variant === 'rail',
    }"
    aria-live="polite"
    aria-atomic="true"
  >
    <div
      v-if="showProgress"
      class="agent-live-status-progress agent-live-status-progress--indeterminate"
      aria-hidden="true"
    >
      <div class="agent-live-status-progress-indeterminate" />
    </div>
    <div class="agent-live-status-row">
      <span class="agent-live-status-dot" aria-hidden="true" />
      <div class="agent-live-status-body">
        <div class="agent-live-status-line">
          <span
            class="agent-live-status-phase"
            :class="{ 'shimmer-text--fast': shimmer }"
          >
            {{ parts.phase }}
          </span>
          <span
            v-for="(meta, index) in parts.meta"
            :key="`${meta}-${index}`"
            class="agent-live-status-chip"
          >
            {{ meta }}
          </span>
          <span v-if="stageLabel" class="agent-live-status-stage">{{ stageLabel }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { splitAgentLiveStatusLine } from "../services/agentCompactStatus";

const props = withDefaults(
  defineProps<{
    statusLine: string;
    stageLabel?: string;
    waitingModel?: boolean;
    shimmer?: boolean;
    variant?: "rail" | "banner";
  }>(),
  {
    waitingModel: false,
    shimmer: false,
    variant: "rail",
    stageLabel: "",
  },
);

const parts = computed(() => splitAgentLiveStatusLine(props.statusLine));

const showProgress = computed(() => props.waitingModel && props.variant === "rail");
</script>

<style scoped>
.agent-live-status {
  min-width: 0;
  overflow: hidden;
}

.agent-live-status--rail {
  margin-top: 4px;
  border-radius: 8px;
  border: 1px solid rgba(88, 166, 255, 0.12);
  background: rgba(11, 18, 32, 0.45);
}

.agent-live-status--banner {
  display: flex;
  flex-direction: column;
  margin: 2px 0 8px;
  border-radius: 8px;
  border: 1px solid rgba(88, 166, 255, 0.12);
  background: rgba(88, 166, 255, 0.06);
}

.agent-live-status-progress {
  height: 2px;
  background: rgba(88, 166, 255, 0.1);
}

.agent-live-status-progress--indeterminate {
  position: relative;
  overflow: hidden;
}

.agent-live-status-progress-indeterminate {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 38%;
  background: linear-gradient(
    90deg,
    rgba(31, 111, 235, 0),
    rgba(31, 111, 235, 0.85),
    rgba(88, 166, 255, 0.95),
    rgba(31, 111, 235, 0.85),
    rgba(31, 111, 235, 0)
  );
  animation: agent-live-status-indeterminate 1.35s ease-in-out infinite;
}

@keyframes agent-live-status-indeterminate {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(320%); }
}

.agent-live-status-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 10px;
}

.agent-live-status-dot {
  width: 7px;
  height: 7px;
  margin-top: 4px;
  border-radius: 50%;
  background: rgba(88, 166, 255, 0.85);
  box-shadow: 0 0 8px rgba(88, 166, 255, 0.4);
  flex-shrink: 0;
  animation: agent-live-status-pulse 1.4s ease-in-out infinite;
}

@keyframes agent-live-status-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.88); }
}

.agent-live-status-body {
  flex: 1;
  min-width: 0;
}

.agent-live-status-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.agent-live-status-phase {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  line-height: 1.45;
  font-weight: 600;
  color: rgba(190, 218, 255, 0.96);
}

.agent-live-status--banner .agent-live-status-phase {
  color: rgba(165, 214, 255, 0.92);
}

.agent-live-status-chip {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 1.35;
  font-weight: 500;
  color: rgba(165, 205, 255, 0.82);
  background: rgba(88, 166, 255, 0.1);
  border: 1px solid rgba(88, 166, 255, 0.14);
}

.agent-live-status-stage {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 1.35;
  font-weight: 600;
  color: rgba(255, 213, 79, 0.92);
  background: rgba(255, 213, 79, 0.1);
  border: 1px solid rgba(255, 213, 79, 0.18);
}

@media (prefers-reduced-motion: reduce) {
  .agent-live-status-dot,
  .agent-live-status-progress-indeterminate {
    animation: none;
  }

  .agent-live-status-progress-indeterminate {
    width: 100%;
    background: linear-gradient(90deg, rgba(31, 111, 235, 0.85), rgba(88, 166, 255, 0.95));
  }
}
</style>
