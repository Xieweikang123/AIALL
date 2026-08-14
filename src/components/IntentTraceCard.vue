<template>
  <div v-if="trace" class="intent-trace-card">
    <div class="intent-trace-head">
      <span class="intent-trace-dot" aria-hidden="true" />
      <span class="intent-trace-label">意图判断</span>
      <span class="intent-trace-source">{{ trace.skippedAi ? "规则" : "AI" }}</span>
    </div>
    <div class="intent-trace-body">
      <span class="intent-trace-value">{{ displayValue }}</span>
      <span v-if="trace.ruleResult" class="intent-trace-rule">
        规则基线：{{ trace.ruleResult }}
      </span>
      <button
        v-if="hasDetails"
        type="button"
        class="intent-trace-toggle"
        @click="expanded = !expanded"
      >
        {{ expanded ? "收起" : "查看分类详情" }}
      </button>
    </div>

    <div v-if="!trace.skippedAi" class="intent-trace-meta">
      <span v-if="trace.aiModel" class="intent-trace-meta-item">
        分类模型：{{ trace.aiModel }}
      </span>
      <span v-if="trace.elapsedMs !== undefined" class="intent-trace-meta-item">
        耗时：{{ formatElapsed(trace.elapsedMs) }}
      </span>
      <span v-if="isDiverged" class="intent-trace-meta-item intent-trace-meta-item--warn">
        ⚠ 规则与 AI 分歧（规则：{{ rulePrimary }} / AI：{{ trace.aiPrimary }}）
      </span>
    </div>

    <div v-if="expanded" class="intent-trace-detail">
      <div v-if="trace.aiMessages?.length" class="intent-trace-section">
        <div class="intent-trace-section-title">分类器输入</div>
        <div
          v-for="(msg, mi) in trace.aiMessages"
          :key="`ai-msg-${mi}`"
          class="intent-trace-message"
        >
          <span class="intent-trace-message-role">{{ messageRoleLabel(msg.role) }}</span>
          <pre class="trace-pre">{{ msg.content }}</pre>
        </div>
      </div>
      <div v-if="trace.aiRawResponse" class="intent-trace-section">
        <div class="intent-trace-section-title">AI 原始响应</div>
        <pre class="trace-pre">{{ trace.aiRawResponse }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{
  trace?: {
    ruleResult?: string;
    aiRawResponse?: string;
    aiMessages?: Array<{ role: string; content: string }>;
    finalResult?: string;
    skippedAi?: boolean;
    aiModel?: string;
    elapsedMs?: number;
    aiPrimary?: string;
  };
}>();

const expanded = ref(false);

const displayValue = computed(() => {
  const raw = props.trace?.finalResult?.trim();
  if (raw) return raw.replace(/^意图：/, "");
  return "识别中…";
});

const hasDetails = computed(
  () =>
    Boolean(props.trace?.aiMessages?.length) || Boolean(props.trace?.aiRawResponse),
);

const rulePrimary = computed(() => {
  const raw = props.trace?.ruleResult?.split("|")[0]?.trim() ?? "";
  return raw || undefined;
});

const isDiverged = computed(() => {
  if (props.trace?.skippedAi) return false;
  const rule = rulePrimary.value;
  const ai = props.trace?.aiPrimary;
  return Boolean(rule && ai && rule !== ai);
});

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function messageRoleLabel(role: string): string {
  if (role === "system") return "系统";
  if (role === "user") return "用户";
  return role;
}
</script>

<style scoped>
.intent-trace-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 10px;
  margin: 2px 0 6px;
  border-radius: 8px;
  background: rgba(88, 166, 255, 0.06);
  border: 1px solid rgba(88, 166, 255, 0.14);
  font-size: 11px;
}

.intent-trace-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.intent-trace-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(88, 166, 255, 0.85);
}

.intent-trace-label {
  font-weight: 600;
  color: rgba(139, 148, 158, 0.85);
}

.intent-trace-source {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  color: rgba(88, 166, 255, 0.9);
  background: rgba(88, 166, 255, 0.12);
}

.intent-trace-body {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.intent-trace-value {
  color: rgba(230, 237, 243, 0.92);
  font-weight: 500;
}

.intent-trace-rule {
  color: rgba(139, 148, 158, 0.6);
  font-size: 10px;
}

.intent-trace-toggle {
  margin-left: auto;
  padding: 1px 8px;
  border: 1px solid rgba(88, 166, 255, 0.25);
  border-radius: 4px;
  background: transparent;
  color: rgba(88, 166, 255, 0.85);
  font-size: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.intent-trace-toggle:hover {
  background: rgba(88, 166, 255, 0.1);
}

.intent-trace-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding-top: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.intent-trace-meta-item {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.55);
}

.intent-trace-meta-item--warn {
  color: rgba(240, 185, 95, 0.9);
  font-weight: 500;
}

.intent-trace-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.intent-trace-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.intent-trace-section-title {
  font-size: 10px;
  font-weight: 600;
  color: rgba(139, 148, 158, 0.55);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.intent-trace-message {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.intent-trace-message-role {
  font-size: 10px;
  font-weight: 600;
  color: rgba(88, 166, 255, 0.7);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.trace-pre {
  margin: 0;
  padding: 6px 8px;
  border-radius: 4px;
  background: rgba(1, 4, 9, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.04);
  font-size: 10.5px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  max-width: 100%;
  max-height: 200px;
  overflow-x: hidden;
  overflow-y: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: rgba(139, 148, 158, 0.82);
}
</style>
