<template>
  <div
    v-if="showDebug"
    class="cursor-debug-panel"
  >
    <div class="cursor-debug-body">
      <section
        v-for="group in groups"
        :key="`debug-${group.turn}`"
        class="cursor-debug-round"
      >
        <div class="cursor-debug-round-title">第 {{ group.turn }} 轮</div>
        <details v-if="group.modelSteps.length" class="cursor-debug-nested">
          <summary>模型链路 · {{ group.modelSteps.length }} 步</summary>
          <ul class="agent-round-model-steps">
            <li
              v-for="step in group.modelSteps"
              :key="step.id"
              class="agent-round-model-step status-log-entry"
            >
              <span class="status-log-text">{{ cleanStatusLogText(step.text) }}</span>
            </li>
          </ul>
        </details>
        <details v-if="group.request" class="cursor-debug-nested">
          <summary>
            请求详情 · {{ group.request.contextMessages }} 条 · {{ formatContextChars(group.request.contextChars) }}
          </summary>
          <div class="agent-round-message-list">
            <div
              v-for="(message, mi) in group.request.messages"
              :key="`${group.turn}-req-${mi}`"
              class="agent-round-message"
            >
              <details
                v-if="shouldCollapseRequestMessage(message.role, message.content || '')"
                class="agent-round-message-collapsible"
              >
                <summary class="agent-round-message-summary">
                  <span class="agent-round-message-role">{{ turnMessageRoleLabel(message.role) }}</span>
                  <span class="agent-round-message-meta">{{ messagePreviewLength(message.content || "") }}</span>
                </summary>
                <pre v-if="message.content" class="trace-pre compact">{{ message.content }}</pre>
                <pre v-if="message.toolCalls" class="trace-pre compact tool-call-preview">{{ message.toolCalls }}</pre>
              </details>
              <template v-else>
                <div class="agent-round-message-head">
                  <span class="agent-round-message-role">{{ turnMessageRoleLabel(message.role) }}</span>
                </div>
                <pre v-if="message.content" class="trace-pre compact">{{ message.content }}</pre>
              </template>
            </div>
          </div>
        </details>
        <details v-if="group.response" class="cursor-debug-nested">
          <summary>回复详情</summary>
          <pre v-if="group.response.assistantText" class="trace-pre compact">{{ group.response.assistantText }}</pre>
          <pre
            v-for="call in group.response.toolCalls"
            :key="call.id"
            class="trace-pre compact tool-call-preview"
          >{{ call.name }}({{ call.arguments }})</pre>
        </details>
      </section>
      <details v-if="agentContext" class="cursor-debug-nested">
        <summary>初始上下文</summary>
        <pre class="trace-pre compact">{{ agentContext.systemPrompt }}</pre>
      </details>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { AgentRoundGroupView } from "../services/agentRoundGroups";
import {
  messagePreviewLength,
  shouldCollapseRequestMessage,
} from "../services/agentNarrativeSegments";
import { cleanStatusLogText, formatContextChars } from "../utils/vibeHelpers";

const props = defineProps<{
  groups: AgentRoundGroupView[];
  agentContext?: { systemPrompt: string; model: string };
  showDebug: boolean;
}>();

const filteredGroups = computed(() => props.groups.filter((g) => g.turn > 0));

function turnMessageRoleLabel(role: string): string {
  switch (role) {
    case "system":
      return "系统";
    case "user":
      return "用户";
    case "assistant":
      return "助手";
    case "tool":
      return "工具结果";
    default:
      return role;
  }
}
</script>

<style scoped>
.cursor-debug-panel {
  margin-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  padding-top: 6px;
}

.cursor-debug-panel > summary {
  font-size: 11px;
  color: rgba(139, 148, 158, 0.6);
  cursor: pointer;
  user-select: none;
  transition: color 0.15s ease;
}

.cursor-debug-panel > summary:hover {
  color: rgba(139, 148, 158, 0.85);
}

.cursor-debug-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
  padding: 6px 8px;
  background: rgba(1, 4, 9, 0.3);
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.cursor-debug-round-title {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(88, 166, 255, 0.55);
  margin-bottom: 4px;
}

.cursor-debug-nested {
  margin-left: 4px;
}

.cursor-debug-nested > summary {
  font-size: 11px;
  color: rgba(139, 148, 158, 0.7);
  cursor: pointer;
  margin-bottom: 4px;
  transition: color 0.15s ease;
}

.cursor-debug-nested > summary:hover {
  color: rgba(230, 237, 243, 0.85);
}

.agent-round-model-steps {
  list-style: none;
  padding: 0;
  margin: 4px 0;
}

.agent-round-model-step {
  padding: 2px 0;
  font-size: 11px;
  color: rgba(139, 148, 158, 0.75);
}

.status-log-text {
  color: rgba(139, 148, 158, 0.7);
}

.agent-round-message-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 4px 0;
}

.agent-round-message {
  font-size: 11px;
}

.agent-round-message-head {
  margin-bottom: 2px;
}

.agent-round-message-role {
  font-size: 10px;
  font-weight: 600;
  color: rgba(88, 166, 255, 0.65);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.agent-round-message-meta {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.5);
  margin-left: 6px;
}

.agent-round-message-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  list-style: none;
  padding: 2px 0;
}

.agent-round-message-summary::-webkit-details-marker {
  display: none;
}

.agent-round-message-summary::before {
  content: "▸";
  font-size: 9px;
  color: rgba(139, 148, 158, 0.5);
}

.agent-round-message-collapsible[open] > .agent-round-message-summary::before {
  content: "▾";
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
  max-height: 160px;
  overflow-x: hidden;
  overflow-y: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: rgba(139, 148, 158, 0.82);
}

.trace-pre.compact {
  max-height: 120px;
}

.tool-call-preview {
  color: rgba(88, 166, 255, 0.7);
  font-style: italic;
}
</style>
