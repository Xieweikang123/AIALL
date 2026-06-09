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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentToolStep = Record<string, any>;
type ActionItem = { key: string; step: AgentToolStep };
type ActionsBlock = { kind: "actions"; key: string; collapsed: ActionItem[]; visible: ActionItem[] };

defineProps<{ block: ActionsBlock }>();

function getToolIcon(name: string): string {
  if (name === 'read_file') return '📄';
  if (name === 'write_file' || name === 'patch_file') return '🔧';
  if (name === 'grep') return '🔍';
  if (name === 'search_files') return '🔎';
  if (name === 'list_dir') return '📁';
  if (name === 'delete_file') return '🗑️';
  if (name === 'run_command') return '▶️';
  return '⚡';
}

function getToolIconClass(name: string): string {
  if (name === 'read_file') return 'read';
  if (name === 'write_file' || name === 'patch_file') return 'write';
  if (name === 'grep' || name === 'search_files') return 'search';
  return 'default';
}

function getToolLabel(name: string): string {
  if (name === 'read_file') return '读取';
  if (name === 'write_file') return '写入';
  if (name === 'patch_file') return '修改';
  if (name === 'grep') return '搜索';
  if (name === 'search_files') return '搜索文件';
  if (name === 'list_dir') return '列出';
  if (name === 'delete_file') return '删除';
  if (name === 'run_command') return '执行';
  return name;
}

function getToolPath(step: { args?: Record<string, unknown>; detail?: string }): string {
  const path = String(step.args?.path ?? step.args?.pattern ?? step.args?.query ?? step.detail?.split(' · ')[0] ?? '').trim();
  return path || '...';
}

function getToolMeta(step: { summary?: string; ok?: boolean; running?: boolean }): string {
  if (step.running) return '进行中';
  if (step.summary) {
    const match = step.summary.match(/(\d+)/);
    if (match) return match[1] + (step.summary.includes('行') ? ' 行' : step.summary.includes('个') ? ' 个' : '');
  }
  return step.ok === false ? '失败' : '';
}

function formatToolArgsPreview(name: string, args: Record<string, unknown>): string {
  if (name === "write_file") {
    const path = String(args.path ?? "").trim();
    const content = typeof args.content === "string" ? args.content : "";
    const preview = content.length > 600 ? `${content.slice(0, 600)}\n…（共 ${content.length} 字符）` : content;
    return path ? `路径：${path}\n\n${preview}` : preview;
  }
  if (name === "delete_file") {
    const path = String(args.path ?? "").trim();
    return path ? `将删除：${path}` : "";
  }
  return "";
}

const TRIVIAL_TOOL_RESULTS = new Set(["（无匹配文件）", "（无匹配）", "（空目录）"]);

function isTrivialToolResult(result?: string): boolean {
  const text = result?.trim() || "";
  if (!text) return true;
  return TRIVIAL_TOOL_RESULTS.has(text);
}

function shouldShowToolResult(step: AgentToolStep): boolean {
  if (step.running || !step.fullResult?.trim()) return false;
  return !isTrivialToolResult(step.fullResult);
}

function shouldShowToolExpand(step: AgentToolStep): boolean {
  if (step.running) return false;
  if (step.fullResult?.trim()) return true;
  return Boolean(formatToolArgsPreview(step.name, step.args || {}));
}

function cursorActionClass(step: AgentToolStep): string {
  if (step.running) return 'running';
  if (step.ok === false) return 'error';
  return 'ok';
}

function formatCollapsedStepsSummary(steps: AgentToolStep[]): string {
  const count = steps.length;
  if (count === 0) return '';
  const first = steps[0];
  if (count === 1) return `${getToolLabel(first.name)} ${getToolPath(first)}`;
  return `${count} 个步骤已折叠`;
}
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
