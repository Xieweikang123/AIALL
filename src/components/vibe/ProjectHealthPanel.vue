<template>
  <div class="health-panel">
    <PanelEmptyState
      v-if="!projectOpened"
      icon="🩺"
      title="尚未打开项目"
      hint="打开项目后，可在「项目 → 测试修复」中扫描并自动修复问题代码"
    />

    <template v-else-if="!hasResult && !scanning && !error">
      <div class="health-empty-card">
        <p class="health-empty-title">问题代码体检</p>
        <p class="health-empty-desc">快速圈定可疑代码，非 lint/语法检查</p>
        <button
          type="button"
          class="health-btn health-btn--primary health-btn--block"
          @click="emit('scan')"
        >
          开始扫描
        </button>
      </div>
    </template>

    <template v-else>
      <div class="health-toolbar">
        <button
          type="button"
          class="health-btn health-btn--primary"
          :disabled="scanning"
          @click="emit('scan')"
        >
          {{ scanning ? "扫描中…" : "重新扫描" }}
        </button>
        <button
          v-if="hasResult"
          type="button"
          class="health-btn health-btn--ghost"
          :disabled="scanning"
          @click="emit('ai-analyze')"
        >
          AI 分析
        </button>
      </div>

      <p
        v-if="error"
        class="health-error"
        role="alert"
        :title="error"
      >{{ error }}</p>

      <div v-if="scanning && !hasResult" class="health-loading">
        <span class="health-spinner" aria-hidden="true" />
        <span>扫描中…</span>
      </div>

      <div v-else-if="hasResult" class="health-summary" aria-label="体检概况">
        <span class="health-stat-inline" :class="{ 'health-stat-inline--error': summary.errorCount }">
          {{ summary.errorCount }} 错误
        </span>
        <span class="health-stat-sep">·</span>
        <span class="health-stat-inline" :class="{ 'health-stat-inline--warn': summary.warningCount }">
          {{ summary.warningCount }} 警告
        </span>
        <span class="health-stat-sep">·</span>
        <span class="health-stat-inline">{{ summary.infoCount }} 提示</span>
        <span v-if="scannedAt" class="health-meta">{{ formatTime(scannedAt) }}</span>
      </div>

      <p v-if="hasResult && !issues.length" class="health-ok" role="status">
        未发现常见坏味道，可点「AI 分析」做深入审查。
      </p>

      <div v-if="groupedIssues.length" class="health-groups">
        <section
          v-for="group in groupedIssues"
          :key="group.category"
          class="health-group"
          :aria-label="group.label"
        >
          <h3 class="health-group-title">{{ group.label }} · {{ group.issues.length }}</h3>
          <ul class="health-issues">
            <li
              v-for="issue in group.issues"
              :key="issue.id"
              class="health-issue"
              :class="`health-issue--${issue.severity}`"
            >
              <button
                type="button"
                class="health-issue-btn"
                :disabled="!issue.file"
                :title="issue.detail"
                @click="issue.file && emit('open-file', issue.file, issue.line)"
              >
                <span class="health-issue-dot" aria-hidden="true" />
                <span class="health-issue-line">
                  <span class="health-issue-title">{{ issue.title }}</span>
                  <span v-if="issueLocation(issue)" class="health-issue-loc">{{ issueLocation(issue) }}</span>
                </span>
              </button>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import PanelEmptyState from "./PanelEmptyState.vue";
import {
  HEALTH_CATEGORY_LABELS,
  HEALTH_CATEGORY_ORDER,
  type HealthIssue,
  type HealthIssueCategory,
  type ProjectHealthScanPayload,
} from "../../../shared/projectHealthScan";

type ScanView = ProjectHealthScanPayload & { ok?: boolean };

const props = defineProps<{
  projectOpened: boolean;
  scanning: boolean;
  error: string;
  scan: ScanView | null;
}>();

const emit = defineEmits<{
  scan: [];
  "ai-analyze": [];
  "open-file": [path: string, line?: number];
}>();

const hasResult = computed(() => Boolean(props.scan?.ok !== false && props.scan?.scannedAt));
const issues = computed(() => props.scan?.issues ?? []);
const summary = computed(() => props.scan?.summary ?? { errorCount: 0, warningCount: 0, infoCount: 0 });
const scannedAt = computed(() => props.scan?.scannedAt ?? "");

const groupedIssues = computed(() => {
  const map = new Map<HealthIssueCategory, HealthIssue[]>();
  for (const issue of issues.value) {
    const list = map.get(issue.category) ?? [];
    list.push(issue);
    map.set(issue.category, list);
  }
  return HEALTH_CATEGORY_ORDER
    .filter((cat) => map.has(cat))
    .map((category) => ({
      category,
      label: HEALTH_CATEGORY_LABELS[category],
      issues: map.get(category)!,
    }));
});

function issueLocation(issue: HealthIssue): string {
  if (!issue.file) return "";
  return issue.line ? `${issue.file}:${issue.line}` : issue.file;
}

function formatTime(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}
</script>

<style scoped>
.health-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 8px 12px;
  min-height: 0;
  overflow: auto;
}

.health-empty-card {
  padding: 12px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
}

.health-empty-title {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(220, 228, 235, 0.98);
}

.health-empty-desc {
  margin: 0 0 10px;
  font-size: 11px;
  color: rgba(139, 148, 158, 0.92);
  line-height: 1.4;
}

.health-toolbar {
  display: flex;
  gap: 6px;
}

.health-btn {
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(210, 218, 226, 0.96);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.health-btn--block {
  width: 100%;
}

.health-btn--primary {
  border-color: rgba(88, 166, 255, 0.45);
  background: rgba(88, 166, 255, 0.12);
  color: rgba(200, 225, 255, 0.98);
}

.health-btn--ghost {
  font-weight: 500;
}

.health-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.health-error {
  margin: 0;
  padding: 0;
  font-size: 11px;
  color: rgba(255, 160, 155, 0.96);
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.health-loading {
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgba(139, 148, 158, 0.95);
  font-size: 11px;
  padding: 4px 0;
}

.health-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.12);
  border-top-color: rgba(88, 166, 255, 0.85);
  border-radius: 50%;
  animation: health-spin 0.7s linear infinite;
}

@keyframes health-spin {
  to { transform: rotate(360deg); }
}

.health-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: rgba(139, 148, 158, 0.92);
}

.health-stat-inline--error {
  color: rgba(255, 140, 135, 0.98);
  font-weight: 600;
}

.health-stat-inline--warn {
  color: rgba(255, 210, 120, 0.98);
  font-weight: 600;
}

.health-stat-sep {
  opacity: 0.5;
}

.health-meta {
  flex-basis: 100%;
  font-size: 10px;
  opacity: 0.85;
}

.health-ok {
  margin: 0;
  font-size: 11px;
  color: rgba(183, 235, 198, 0.9);
  line-height: 1.4;
}

.health-groups {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.health-group-title {
  margin: 0 0 4px;
  font-size: 10px;
  font-weight: 600;
  color: rgba(150, 160, 170, 0.95);
  letter-spacing: 0.02em;
}

.health-issues {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.health-issue-btn {
  width: 100%;
  text-align: left;
  padding: 4px 6px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.health-issue-btn:disabled {
  cursor: default;
}

.health-issue-btn:not(:disabled):hover {
  background: rgba(255, 255, 255, 0.05);
}

.health-issue-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  margin-top: 5px;
  border-radius: 50%;
  background: rgba(139, 148, 158, 0.7);
}

.health-issue--error .health-issue-dot {
  background: rgba(255, 120, 115, 0.95);
}

.health-issue--warning .health-issue-dot {
  background: rgba(255, 200, 100, 0.95);
}

.health-issue--info .health-issue-dot {
  background: rgba(120, 170, 255, 0.85);
}

.health-issue-line {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.health-issue-title {
  font-size: 11px;
  font-weight: 500;
  color: rgba(220, 228, 235, 0.96);
  line-height: 1.3;
}

.health-issue-loc {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.88);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
