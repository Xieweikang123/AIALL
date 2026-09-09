<template>
  <div v-if="trace" class="intent-trace-card">
    <div class="intent-trace-head">
      <span class="intent-trace-dot" :class="{ 'intent-trace-dot--pending': isClassifying }" aria-hidden="true"></span>
      <span class="intent-trace-label">意图</span>
      <span class="intent-trace-value" :class="{ 'intent-trace-value--pending': isClassifying }">
        {{ displayValue }}
      </span>
      <span v-if="sourceLabel" class="intent-trace-source">{{ sourceLabel }}</span>
      <span v-if="trace.elapsedMs !== undefined" class="intent-trace-meta-item">
        {{ formatElapsed(trace.elapsedMs) }}
      </span>
      <button
        v-if="hasDetails"
        type="button"
        class="intent-trace-toggle"
        @click="expanded = !expanded"
      >
        {{ expanded ? "收起" : "详情" }}
      </button>
    </div>

    <div v-if="trace.aiFailed" class="intent-trace-fallback">
      ⚠ AI 意图分类失败{{ trace.aiError ? `（${trace.aiError}）` : "" }}
    </div>

    <div v-if="expanded" class="intent-trace-detail">
      <div class="intent-trace-section">
        <div class="intent-trace-section-title">分类信息</div>
        <div class="intent-trace-meta">
          <span v-if="trace.aiModel" class="intent-trace-meta-item">分类模型：{{ trace.aiModel }}</span>
        </div>
      </div>
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
    aiRawResponse?: string;
    aiMessages?: Array<{ role: string; content: string }>;
    finalResult?: string;
    skippedAi?: boolean;
    aiModel?: string;
    elapsedMs?: number;
    aiPrimary?: string;
    aiFailed?: boolean;
    aiError?: string;
    aiStage?: string;
  };
}>();

const expanded = ref(false);

/** Consultative topic slug → 用户可读中文；未收录的 slug 原样兜底。 */
const TOPIC_LABELS: Record<string, string> = {
  general: "综合咨询",
  project_overview: "项目概览",
  behavior_purpose: "行为目的",
  accuracy: "准确性追问",
  ui_appearance: "界面外观",
  session_audit: "会话审计",
  code_review: "代码审查",
  implementation_status: "实现状态",
  step_clarification: "步骤澄清",
  behavior_contradiction: "行为矛盾澄清",
  config_binding: "配置绑定",
  git_working_tree: "Git 工作区",
};

const PRIMARY_LABELS: Record<string, string> = {
  consultative: "咨询",
  implement: "改代码",
  automation: "自动化",
};

const SOURCE_LABELS: Record<string, string> = {
  ai: "AI",
  rules: "规则",
};

/** 解析 finalResult（意图：primary/topic（source…）），拆出可读主值与来源徽章。 */
const parsedResult = computed(() => {
  const raw = props.trace?.finalResult?.trim().replace(/^意图：/, "") ?? "";
  if (!raw) return null;
  const body = raw.replace(/（[^）]*）\s*$/, "").trim();
  const sourceMatch = raw.match(/（([^）]*)）/);
  const source = sourceMatch?.[1]?.trim() ?? "";
  const [primary = "", topic = ""] = body.split("/");
  const primaryLabel = PRIMARY_LABELS[primary.trim()] ?? primary.trim();
  const topicSlug = topic.trim();
  const topicLabel = topicSlug
    ? TOPIC_LABELS[topicSlug] ?? topicSlug
    : "";
  return {
    value: topicLabel ? `${primaryLabel} · ${topicLabel}` : primaryLabel,
    source,
  };
});

const sourceLabel = computed(() => {
  if (props.trace?.aiFailed) return "规则兜底";
  const raw = parsedResult.value?.source ?? "";
  if (!raw) return "";
  // source 形如「ai」「ai·规则短路」「ai·pending_amend」，取首段做映射
  const key = raw.split("·")[0]?.trim() ?? "";
  return SOURCE_LABELS[key] ?? key;
});

const displayValue = computed(() => {
  if (props.trace?.aiFailed) {
    const reason = props.trace.aiError?.trim();
    return reason ? `分类未完成：${reason}` : "分类未完成";
  }
  const parsed = parsedResult.value;
  if (parsed) return parsed.value;
  const stage = props.trace?.aiStage;
  if (stage === "sending") return "正在请求分类模型…";
  if (stage === "parsing") return "已收到响应，正在解析…";
  if (stage === "retrying") return "分类失败，正在重试…";
  return "识别中…";
});

const isClassifying = computed(
  () => Boolean(props.trace?.aiStage) && !props.trace?.finalResult?.trim(),
);

const hasDetails = computed(
  () =>
    Boolean(props.trace?.aiMessages?.length) ||
    Boolean(props.trace?.aiRawResponse) ||
    Boolean(props.trace?.aiModel),
);

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
/* 单行元信息条：无卡片边框/底色，降低与 rail 的视觉层级冲突 */
.intent-trace-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 2px 0 6px;
  margin: 0;
  font-size: 11px;
}

.intent-trace-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.intent-trace-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(88, 166, 255, 0.85);
  flex-shrink: 0;
}

.intent-trace-dot--pending {
  animation: intent-trace-pulse 1.2s ease-in-out infinite;
}

.intent-trace-label {
  font-weight: 600;
  color: rgba(139, 148, 158, 0.85);
  flex-shrink: 0;
}

.intent-trace-source {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  color: rgba(88, 166, 255, 0.9);
  background: rgba(88, 166, 255, 0.12);
}

.intent-trace-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(230, 237, 243, 0.92);
  font-weight: 500;
}

.intent-trace-toggle {
  margin-left: auto;
  flex-shrink: 0;
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

.intent-trace-value--pending {
  color: rgba(88, 166, 255, 0.9);
  animation: intent-trace-pulse 1.2s ease-in-out infinite;
}

@keyframes intent-trace-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
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

.intent-trace-fallback {
  margin-top: 4px;
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid rgba(240, 185, 95, 0.35);
  background: rgba(240, 185, 95, 0.1);
  color: rgba(240, 185, 95, 0.95);
  font-size: 10.5px;
  line-height: 1.4;
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
