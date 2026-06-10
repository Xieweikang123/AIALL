<template>
  <div class="cursor-actions-block">
    <details v-if="block.collapsed.length" class="cursor-actions-fold" open>
      <summary class="cursor-actions-fold-summary">
        {{ formatCollapsedStepsSummary(block.collapsed.map((item: any) => item.step)) }}
      </summary>
      <div class="cursor-actions-fold-body">
        <template v-for="item in block.collapsed" :key="item.key">
          <div class="cursor-action-compact" :class="cursorActionClass(item.step)">
            <span class="cursor-action-icon" :class="getToolIconClass(item.step.name)">{{ getToolIcon(item.step.name) }}</span>
            <span class="cursor-action-label">{{ getToolLabel(item.step.name) }}</span>
            <span class="cursor-action-path">{{ getToolPath(item.step) }}</span>
            <span class="cursor-action-meta">{{ getToolMeta(item.step) }}</span>
            <span class="cursor-action-status" :class="cursorActionClass(item.step)"></span>
            <details
              v-if="shouldShowToolExpand(item.step)"
              class="cursor-action-details-compact"
            >
              <summary class="cursor-action-expand-toggle"></summary>
              <div class="cursor-action-expand-compact">
                <pre v-if="shouldShowToolResult(item.step)" class="trace-pre compact">{{ item.step.fullResult }}</pre>
                <pre
                  v-if="formatToolArgsPreview(item.step.name, item.step.args || {})"
                  class="trace-pre compact"
                >{{ formatToolArgsPreview(item.step.name, item.step.args || {}) }}</pre>
              </div>
            </details>
          </div>
        </template>
      </div>
    </details>
    <template v-for="item in block.visible" :key="item.key">
      <div class="cursor-action-compact" :class="cursorActionClass(item.step)">
        <span class="cursor-action-icon" :class="getToolIconClass(item.step.name)">{{ getToolIcon(item.step.name) }}</span>
        <span class="cursor-action-label">{{ getToolLabel(item.step.name) }}</span>
        <span class="cursor-action-path">{{ getToolPath(item.step) }}</span>
        <span class="cursor-action-meta">{{ getToolMeta(item.step) }}</span>
        <span class="cursor-action-status" :class="cursorActionClass(item.step)"></span>
        <details
          v-if="shouldShowToolExpand(item.step)"
          class="cursor-action-details-compact"
        >
          <summary class="cursor-action-expand-toggle"></summary>
          <div class="cursor-action-expand-compact">
            <pre v-if="shouldShowToolResult(item.step)" class="trace-pre compact">{{ item.step.fullResult }}</pre>
            <pre
              v-if="formatToolArgsPreview(item.step.name, item.step.args || {})"
              class="trace-pre compact"
            >{{ formatToolArgsPreview(item.step.name, item.step.args || {}) }}</pre>
          </div>
        </details>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { CursorFeedProcessBlock } from "../services/agentCursorFeed";
import {
  getToolIcon,
  getToolIconClass,
  getToolLabel,
  getToolPath,
  getToolMeta,
  formatToolArgsPreview,
  isTrivialToolResult,
  shouldShowToolResult,
  shouldShowToolExpand,
  cursorActionClass,
  formatCollapsedStepsSummary,
  type AgentToolStep,
} from "../utils/toolHelpers";

type ActionItem = { key: string; step: AgentToolStep };
type ActionsBlock = { kind: "actions"; key: string; collapsed: ActionItem[]; visible: ActionItem[] };

defineProps<{ block: ActionsBlock }>();
</script>

<style scoped>
.cursor-actions-block {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-left: 12px;
  border-left: 2px solid rgba(88, 166, 255, 0.12);
  min-width: 0;
  margin: 2px 0;
}

.cursor-actions-fold {
  margin: 0 0 1px;
}

.cursor-actions-fold-summary {
  list-style: none;
  font-size: 10.5px;
  line-height: 1.4;
  color: rgba(139, 148, 158, 0.75);
  cursor: pointer;
  user-select: none;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
  transition: color 0.15s ease;
}

.cursor-actions-fold-summary:hover {
  color: rgba(139, 148, 158, 0.95);
}

.cursor-actions-fold-summary::-webkit-details-marker {
  display: none;
}

.cursor-actions-fold-summary::before {
  content: "▸ ";
  font-size: 9px;
  color: rgba(139, 148, 158, 0.5);
}

.cursor-actions-fold[open] > .cursor-actions-fold-summary::before {
  content: "▾ ";
}

.cursor-actions-fold-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-top: 3px;
  padding-left: 4px;
  max-height: 120px;
  overflow: auto;
}

.cursor-action-compact {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  border-radius: 4px;
  transition: all 0.15s ease;
  min-width: 0;
  border: 1px solid transparent;
}

.cursor-action-compact:hover {
  background: rgba(88, 166, 255, 0.06);
  border-color: rgba(88, 166, 255, 0.1);
}

.cursor-action-compact.running {
  background: rgba(88, 166, 255, 0.04);
  border-color: rgba(88, 166, 255, 0.15);
}

.cursor-action-compact.done {
  border-color: transparent;
}

.cursor-action-compact.fail {
  border-color: rgba(248, 81, 73, 0.15);
  background: rgba(248, 81, 73, 0.04);
}

.cursor-action-compact.ok {
  border-color: transparent;
}

.cursor-action-compact.error {
  border-color: rgba(248, 81, 73, 0.15);
  background: rgba(248, 81, 73, 0.04);
}

.cursor-action-icon {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  flex-shrink: 0;
  line-height: 1;
}

.cursor-action-icon.read {
  background: rgba(63, 185, 80, 0.12);
}

.cursor-action-icon.write {
  background: rgba(137, 87, 229, 0.12);
}

.cursor-action-icon.search {
  background: rgba(210, 153, 34, 0.12);
}

.cursor-action-icon.default {
  background: rgba(139, 148, 158, 0.1);
}

.cursor-action-icon.running {
  animation: tool-pulse 1.2s ease-in-out infinite;
}

.cursor-action-label {
  color: rgba(139, 148, 158, 0.82);
  flex-shrink: 0;
  font-size: 11px;
}

.cursor-action-path {
  color: rgba(88, 166, 255, 0.85);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  font-size: 11px;
}

.cursor-action-meta {
  color: rgba(139, 148, 158, 0.55);
  margin-left: auto;
  flex-shrink: 0;
  font-size: 10px;
}

.cursor-action-status {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}

.cursor-action-status.pending {
  background: rgba(72, 79, 88, 0.5);
}

.cursor-action-status.running {
  background: #58a6ff;
  animation: tool-pulse 1.2s ease-in-out infinite;
  box-shadow: 0 0 4px rgba(88, 166, 255, 0.4);
}

.cursor-action-status.done {
  background: #3fb950;
  box-shadow: 0 0 3px rgba(63, 185, 80, 0.3);
}

.cursor-action-status.fail {
  background: #f85149;
  box-shadow: 0 0 3px rgba(248, 81, 73, 0.3);
}

.cursor-action-details-compact {
  margin: 0;
  position: relative;
}

.cursor-action-expand-toggle {
  cursor: pointer;
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  color: rgba(139, 148, 158, 0.5);
  font-size: 9px;
  transition: all 0.15s ease;
}

.cursor-action-expand-toggle:hover {
  background: rgba(139, 148, 158, 0.1);
  color: rgba(139, 148, 158, 0.8);
}

.cursor-action-expand-toggle::before {
  content: "▸";
}

.cursor-action-details-compact[open] > .cursor-action-expand-toggle::before {
  content: "▾";
}

.cursor-action-expand-compact {
  margin: 2px 0 0 22px;
  padding: 4px 6px;
  background: rgba(1, 4, 9, 0.4);
  border-radius: 4px;
  border-left: 2px solid rgba(88, 166, 255, 0.1);
  font-size: 10.5px;
  max-height: 100px;
  overflow: auto;
}

.cursor-action-expand-compact pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  color: rgba(139, 148, 158, 0.82);
  line-height: 1.45;
}

@keyframes tool-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
