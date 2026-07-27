<template>
  <div class="fix-panel">
    <PanelEmptyState
      v-if="!projectOpened"
      icon="🔧"
      title="尚未打开项目"
      hint="打开项目后，在「项目 → 测试修复」中扫描并修复"
    />

    <template v-else>
      <div class="fix-intro">
        <p class="fix-title">扫描与测试修复</p>
        <p class="fix-desc">先跑规则扫描和测试；仅对失败用例与 error 级扫描项启动 Agent 修复并复验</p>
      </div>

      <!-- Steps -->
      <div v-if="phase !== 'idle'" class="fix-progress">
        <div class="fix-steps" :style="{ '--progress': progressPercent + '%' }">
          <template v-for="(s, idx) in stepList" :key="s.key">
            <span :class="stepClass(s.key)">
              <span class="fix-step-dot"></span>
              <span class="fix-step-label">{{ s.label }}</span>
            </span>
            <span v-if="idx < stepList.length - 1" class="fix-step-line" :class="{'fix-step-line--active': isStepActive(s.key)}"></span>
          </template>
        </div>
      </div>

      <!-- Scope -->
      <div class="fix-scope" role="group" aria-label="修复范围">
        <label class="fix-check">
          <input v-model="includeWarnings" type="checkbox" :disabled="running" />
          <span>包含警告级扫描项</span>
        </label>
        <p class="fix-scope-hint">默认：测试失败 + error 级扫描；TODO 等提示项不会自动修改</p>
        <label class="fix-check">
          <input v-model="includeLogicReview" type="checkbox" :disabled="running" />
          <span>包含逻辑审查</span>
        </label>
        <p class="fix-scope-hint">审查逻辑隐患、竞态、边界与错误处理；须 read 确认后才修改</p>
      </div>

      <!-- Actions -->
      <div class="fix-toolbar">
        <button type="button" class="fix-btn fix-btn--primary" :disabled="running" @click="emit('start')">
          <span v-if="running" class="fix-spinner"></span>
          {{ running ? phaseLabel : "开始扫描修复" }}
        </button>
        <div class="fix-toolbar-row">
          <button type="button" class="fix-btn fix-btn--ghost" :disabled="running" @click="emit('scan-only')">仅扫描</button>
          <button type="button" class="fix-btn fix-btn--ghost" :disabled="running" @click="emit('verify-only')">仅跑测试</button>
          <button
            v-if="showStop"
            type="button"
            class="fix-btn fix-btn--danger"
            @click="emit('stop-fix')"
          >
            终止修复
          </button>
        </div>
      </div>

      <p v-if="error" class="fix-error" role="alert">{{ error }}</p>

      <!-- Scan result card -->
      <div v-if="scanResult" class="fix-card fix-card--scan">
        <div class="fix-card-header" @click="scanExpanded = !scanExpanded" role="button" tabindex="0" @keydown.enter="scanExpanded = !scanExpanded">
          <div class="fix-card-title">扫描结果</div>
          <div class="fix-card-badges">
            <span v-if="summary && summary.errorCount" class="fix-badge fix-badge--error">{{ summary.errorCount }}</span>
            <span v-if="summary && summary.warningCount" class="fix-badge fix-badge--warning">{{ summary.warningCount }}</span>
            <span v-if="summary && summary.infoCount" class="fix-badge fix-badge--info">{{ summary.infoCount }}</span>
            <span v-if="scanDuration" class="fix-card-duration">{{ scanDuration }}</span>
            <span class="fix-card-arrow">{{ scanExpanded ? '▾' : '▸' }}</span>
          </div>
        </div>
        <div v-if="scanExpanded" class="fix-card-body">
          <div v-if="!scanResult.issues.length" class="fix-card-empty">无扫描问题</div>
          <div v-for="group in groupedIssues" :key="group.severity" class="fix-issue-group">
            <div v-if="group.items.length" class="fix-issue-group-hd" :class="'fix-issue-group--' + group.severity">
              {{ group.label }}（{{ group.items.length }}）
            </div>
            <div v-for="issue in group.items.slice(0, 20)" :key="issue.id" class="fix-issue-item">
              <span class="fix-issue-sev" :class="'fix-issue-sev--' + issue.severity">{{ group.label.charAt(0) }}</span>
              <span class="fix-issue-text">
                {{ issue.title }}
                <span v-if="issue.file" class="fix-issue-loc">{{ issue.file }}{{ issue.line ? ':' + issue.line : '' }}</span>
              </span>
            </div>
            <div v-if="group.items.length > 20" class="fix-issue-more">还有 {{ group.items.length - 20 }} 项…</div>
          </div>
        </div>
      </div>

      <!-- Verify result card -->
      <div v-if="verifyResult" class="fix-card fix-card--verify">
        <div class="fix-card-header" @click="verifyExpanded = !verifyExpanded" role="button" tabindex="0" @keydown.enter="verifyExpanded = !verifyExpanded">
          <div class="fix-card-title">{{ verifyCardTitle }}</div>
          <div class="fix-card-badges">
            <span v-if="verifyResult.skipped" class="fix-badge fix-badge--info">跳过</span>
            <span v-else :class="['fix-badge', verifyPassed ? 'fix-badge--ok' : 'fix-badge--error']">
              {{ verifyPassed ? '通过' : '失败' }}
            </span>
            <span v-if="verifyDuration" class="fix-card-duration">{{ verifyDuration }}</span>
            <span class="fix-card-arrow">{{ verifyExpanded ? '▾' : '▸' }}</span>
          </div>
        </div>
        <div v-if="verifyExpanded && !verifyResult.skipped" class="fix-card-body">
          <div v-if="verifySteps.length" class="fix-verify-steps">
            <div v-for="(step, idx) in verifySteps" :key="idx" class="fix-verify-step">
              <span :class="['fix-badge', 'fix-badge--compact', step.ok ? 'fix-badge--ok' : 'fix-badge--error']">
                {{ step.ok ? '通过' : '失败' }}
              </span>
              <code class="fix-verify-code">{{ step.command }}</code>
              <span v-if="!step.ok" class="fix-verify-step-meta">exit {{ step.exitCode }}</span>
            </div>
          </div>
          <div v-else class="fix-verify-detail">
            <span class="fix-verify-label">命令：</span>
            <code class="fix-verify-code">{{ verifyResult.command }}</code>
          </div>
          <div class="fix-verify-detail">
            <span class="fix-verify-label">退出码：</span>
            <code class="fix-verify-code">{{ verifyResult.exitCode }}</code>
          </div>
          <p v-if="verifyEnvironmentNote" class="fix-verify-note">{{ verifyEnvironmentNote }}</p>
          <div v-if="verifyResult.stdout" class="fix-verify-detail">
            <span class="fix-verify-label">输出：</span>
            <pre class="fix-verify-pre">{{ verifyResult.stdout.slice(0, 300) }}{{ verifyResult.stdout.length > 300 ? '…' : '' }}</pre>
          </div>
          <div v-if="verifyResult.stderr" class="fix-verify-detail">
            <span class="fix-verify-label">stderr：</span>
            <pre class="fix-verify-pre fix-verify-pre--err">{{ verifyResult.stderr.slice(0, 300) }}{{ verifyResult.stderr.length > 300 ? '…' : '' }}</pre>
          </div>
          <div v-if="verifyResult.failingFiles.length" class="fix-verify-detail">
            <span class="fix-verify-label">失败文件：</span>
            <div class="fix-verify-files">
              <code v-for="f in verifyResult.failingFiles" :key="f" class="fix-verify-file">{{ f }}</code>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="verifyComparison && baselineVerify && postFixVerify"
        class="fix-card fix-card--compare"
      >
        <div class="fix-card-header">
          <div class="fix-card-title">修复前后对比</div>
          <span :class="['fix-badge', comparisonBadgeClass]">{{ comparisonBadgeLabel }}</span>
        </div>
        <div class="fix-card-body">
          <p class="fix-compare-detail">{{ verifyComparison.detail }}</p>
          <div class="fix-compare-row">
            <span class="fix-verify-label">修复前：</span>
            <span>{{ formatVerifyStatus(baselineVerify) }}</span>
          </div>
          <div class="fix-compare-row">
            <span class="fix-verify-label">修复后：</span>
            <span>{{ formatVerifyStatus(postFixVerify) }}</span>
          </div>
        </div>
      </div>

      <p v-if="lastSummary" class="fix-result">{{ lastSummary }}</p>

      <!-- Resume -->
      <div v-if="showResume" class="fix-resume">
        <p v-if="interruptedHint" class="fix-resume-hint">{{ interruptedHint }}</p>
        <div class="fix-resume-actions">
          <button type="button" class="fix-btn fix-btn--primary" @click="emit('resume-agent')">恢复运行</button>
          <button type="button" class="fix-btn fix-btn--danger" @click="emit('stop-fix')">终止修复</button>
        </div>
      </div>

      <button v-if="phase === 'done' && !running" type="button" class="fix-btn fix-btn--secondary" @click="emit('open-git')">查看 Git 变更</button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import PanelEmptyState from "./PanelEmptyState.vue";
import type { AutoBugFixPhase } from "../../composables/useAutoBugFix";
import type { ProjectHealthScanResult } from "../../services/projectHealthScanClient";
import type { ProjectVerifyRunResult } from "../../services/projectVerifyRunClient";
import { getVerifyEnvironmentNote } from "../../services/projectVerifyRunClient";
import type { VerifyRegressionKind } from "../../../shared/projectVerifyRun";

const props = defineProps<{
  projectOpened: boolean;
  phase: AutoBugFixPhase;
  running: boolean;
  error: string;
  scanResult: ProjectHealthScanResult | null;
  verifyResult: ProjectVerifyRunResult | null;
  baselineVerify?: ProjectVerifyRunResult | null;
  postFixVerify?: ProjectVerifyRunResult | null;
  verifyComparison?: { kind: VerifyRegressionKind; detail: string } | null;
  lastSummary: string;
  includeWarnings: boolean;
  includeLogicReview: boolean;
  showResume?: boolean;
  showStop?: boolean;
  interruptedHint?: string;
}>();

const emit = defineEmits<{
  start: [];
  "scan-only": [];
  "verify-only": [];
  "open-git": [];
  "resume-agent": [];
  "stop-fix": [];
  "update:includeWarnings": [value: boolean];
  "update:includeLogicReview": [value: boolean];
}>();

const scanExpanded = ref(false);
const verifyExpanded = ref(false);

watch(
  () => [props.phase, props.scanResult?.issues.length ?? 0] as const,
  ([phase, issueCount]) => {
    if ((phase === "no_work" || phase === "done") && issueCount > 0) {
      scanExpanded.value = true;
    }
  },
);

watch(
  () => props.verifyResult,
  (result) => {
    if (result && (!result.ok || (result.steps?.some(s => !s.ok && !s.skipped) ?? false))) {
      verifyExpanded.value = true;
    }
  },
);

const includeWarnings = computed({
  get: () => props.includeWarnings,
  set: (v: boolean) => emit("update:includeWarnings", v),
});

const includeLogicReview = computed({
  get: () => props.includeLogicReview,
  set: (v: boolean) => emit("update:includeLogicReview", v),
});

const phaseLabel = computed(() => {
  switch (props.phase) {
    case "scanning": return "扫描中…";
    case "testing": return "测试中…";
    case "fixing": return "修复中…";
    case "verifying": return "复验中…";
    default: return "处理中…";
  }
});

const stepList = [
  { key: "scanning" as AutoBugFixPhase, label: "扫描" },
  { key: "testing" as AutoBugFixPhase, label: "测试" },
  { key: "fixing" as AutoBugFixPhase, label: "修复" },
  { key: "verifying" as AutoBugFixPhase, label: "复验" },
  { key: "done" as AutoBugFixPhase, label: "完成" },
];

const phaseOrder: AutoBugFixPhase[] = ["scanning", "testing", "fixing", "verifying", "done", "no_work"];

function stepClass(step: AutoBugFixPhase): string {
  const curIdx = phaseOrder.indexOf(props.phase);
  const stepIdx = phaseOrder.indexOf(step);
  if (props.phase === "error" || props.phase === "idle") return "fix-step";
  if (curIdx === stepIdx) return "fix-step fix-step--active";
  if (curIdx > stepIdx) return "fix-step fix-step--done";
  return "fix-step";
}

function isStepActive(step: AutoBugFixPhase): boolean {
  const curIdx = phaseOrder.indexOf(props.phase);
  const stepIdx = phaseOrder.indexOf(step);
  if (props.phase === "error" || props.phase === "idle") return false;
  return curIdx > stepIdx;
}

const progressValue = computed(() => {
  switch (props.phase) {
    case "scanning": return 20;
    case "testing": return 40;
    case "fixing": return 60;
    case "verifying": return 80;
    case "done":
    case "no_work": return 100;
    default: return 0;
  }
});

const progressPercent = computed(() => {
  return progressValue.value;
});

const summary = computed(() => props.scanResult?.summary ?? null);

const groupedIssues = computed(() => {
  const issues = props.scanResult?.issues ?? [];
  const groups: { severity: "error" | "warning" | "info"; label: string; items: typeof issues }[] = [
    { severity: "error", label: "错误", items: [] },
    { severity: "warning", label: "警告", items: [] },
    { severity: "info", label: "提示", items: [] },
  ];
  for (const issue of issues) {
    const g = groups.find((g) => g.severity === issue.severity);
    if (g) g.items.push(issue);
  }
  return groups;
});

function formatDuration(ms: number): string {
  if (ms < 1000) return ms + "ms";
  return (ms / 1000).toFixed(1) + "s";
}

const scanDuration = computed(() => {
  if (!props.scanResult?.durationMs) return "";
  return formatDuration(props.scanResult.durationMs);
});

const verifyDuration = computed(() => {
  if (!props.verifyResult?.durationMs) return "";
  return formatDuration(props.verifyResult.durationMs);
});

const verifyPassed = computed(() => {
  if (!props.verifyResult || props.verifyResult.skipped) return false;
  if (!props.verifyResult.ok) return false;
  return (props.verifyResult.failingFiles?.length ?? 0) === 0;
});

const verifySteps = computed(() => props.verifyResult?.steps ?? []);

const verifyCardTitle = computed(() => {
  if (props.phase === "done" && props.postFixVerify) return "复验结果";
  return verifySteps.value.length > 1 ? "验证结果" : "测试结果";
});

const verifyEnvironmentNote = computed(() => {
  if (!props.verifyResult || props.verifyResult.skipped || !props.verifyResult.ok) return "";
  return getVerifyEnvironmentNote(props.verifyResult);
});

const comparisonBadgeClass = computed(() => {
  switch (props.verifyComparison?.kind) {
    case "improved": return "fix-badge--ok";
    case "worse": return "fix-badge--error";
    default: return "fix-badge--info";
  }
});

const comparisonBadgeLabel = computed(() => {
  switch (props.verifyComparison?.kind) {
    case "improved": return "已改善";
    case "worse": return "可能回归";
    case "unchanged": return "无变化";
    default: return "对比";
  }
});

function formatVerifyStatus(result: ProjectVerifyRunResult): string {
  if (result.skipped) return "跳过";
  if (result.ok) {
    const fails = result.failingFiles?.length ?? 0;
    return fails ? `通过（${fails} 个失败文件待确认）` : "通过";
  }
  const failCount = result.failingFiles?.length ?? 0;
  return failCount
    ? `失败 (exit ${result.exitCode}，${failCount} 个失败文件)`
    : `失败 (exit ${result.exitCode})`;
}
</script>

<style scoped>
.fix-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 8px 12px;
  min-height: 0;
  overflow: auto;
}

/* Header */
.fix-intro { margin-bottom: 4px; }
.fix-title { font-weight: 600; font-size: 13px; margin: 0 0 4px; }
.fix-desc { font-size: 12px; color: var(--text-muted, #888); margin: 0; line-height: 1.4; }

/* Progress bar */
.fix-progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 2px 0;
}

.fix-steps {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0;
  padding: 6px 0;
}
.fix-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-muted, #666);
  flex-shrink: 0;
  z-index: 1;
}
.fix-step--active {
  color: var(--accent, #0078d4);
  font-weight: 600;
}
.fix-step--done { color: color-mix(in srgb, var(--accent, #0078d4) 55%, var(--text-muted, #666)); }
.fix-step-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--border, #444);
  border: 2px solid var(--surface, #1e1e1e);
  flex-shrink: 0;
  transition: background 0.3s, box-shadow 0.3s;
}
.fix-step--active .fix-step-dot {
  background: var(--accent, #0078d4);
  border-color: var(--accent, #0078d4);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent, #0078d4) 15%, transparent), 0 0 12px color-mix(in srgb, var(--accent, #0078d4) 35%, transparent);
}
.fix-step--done .fix-step-dot {
  background: color-mix(in srgb, var(--accent, #0078d4) 50%, var(--border, #444));
}
.fix-step-line {
  display: inline-block;
  flex: 1;
  height: 3px;
  background: var(--border, #333);
  border-radius: 2px;
  margin: 0;
  vertical-align: middle;
  flex-shrink: 1;
  transition: background 0.3s;
}
.fix-step-line--active {
  background: linear-gradient(90deg, var(--accent, #0078d4), color-mix(in srgb, var(--accent, #0078d4) 70%, #00b4d8));
  box-shadow: 0 0 6px color-mix(in srgb, var(--accent, #0078d4) 30%, transparent);
}
.fix-step-label { white-space: nowrap; font-size: 11px; letter-spacing: 0.02em; }
/* Scope */
.fix-scope { display: flex; flex-direction: column; gap: 6px; }
.fix-check { display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer; }
.fix-check--disabled { opacity: 0.55; cursor: not-allowed; }
.fix-scope-hint { font-size: 11px; color: var(--text-muted, #888); margin: 0; line-height: 1.35; }

/* Buttons */
.fix-toolbar { display: flex; flex-direction: column; gap: 16px; }
.fix-toolbar-row { display: flex; gap: 8px; }
.fix-btn {
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--border, #333);
  background: var(--surface, #1e1e1e);
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.fix-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.fix-btn--primary { background: var(--accent, #0078d4); border-color: transparent; color: #fff; }
.fix-btn--secondary { background: var(--surface-hover, #2a2d2e); border-color: var(--border, #333); }
.fix-btn--secondary:hover { background: var(--accent, #0078d4); border-color: transparent; color: #fff; }
.fix-btn--ghost { background: transparent; }
.fix-btn--danger {
  background: rgba(248, 81, 73, 0.12);
  border-color: rgba(248, 81, 73, 0.35);
  color: rgba(255, 180, 175, 0.98);
}
.fix-btn--danger:hover {
  background: rgba(248, 81, 73, 0.22);
  border-color: rgba(248, 81, 73, 0.5);
}
.fix-btn--block { width: 100%; }

/* Spinner */
.fix-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: fix-spin 0.6s linear infinite;
  flex-shrink: 0;
}
@keyframes fix-spin {
  to { transform: rotate(360deg); }
}

/* Error */
.fix-error { color: #e55; font-size: 12px; margin: 0; padding: 6px 8px; background: rgba(238,85,85,0.08); border-radius: 6px; }

/* Cards */
.fix-card {
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  overflow: hidden;
  background: var(--surface, #1e1e1e);
}
.fix-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 7px 10px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}
.fix-card-header:hover { background: rgba(255,255,255,0.03); }
.fix-card-title { font-size: 12px; font-weight: 600; }
.fix-card-badges {
  display: flex;
  align-items: center;
  gap: 5px;
}
.fix-card-duration { font-size: 10px; color: var(--text-muted, #888); }
.fix-card-arrow { font-size: 11px; color: var(--text-muted, #888); }
.fix-card-body {
  border-top: 1px solid var(--border, #333);
  padding: 4px 10px 8px;
}
.fix-card-empty {
  font-size: 11px;
  color: var(--text-muted, #888);
  padding: 8px 0;
  text-align: center;
}

/* Badges */
.fix-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 10px;
  min-width: 18px;
  text-align: center;
  line-height: 1.5;
}
.fix-badge--error { background: rgba(238,85,85,0.15); color: #e55; }
.fix-badge--warning { background: rgba(232,168,56,0.15); color: #e8a838; }
.fix-badge--info { background: rgba(119,170,187,0.15); color: #7ab; }
.fix-badge--ok { background: rgba(76,175,80,0.15); color: #4caf50; }

/* Issue list */
.fix-issue-group { margin-top: 4px; }
.fix-issue-group:first-child { margin-top: 0; }
.fix-issue-group-hd {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 0;
  margin-bottom: 1px;
}
.fix-issue-group--error { color: #e55; }
.fix-issue-group--warning { color: #e8a838; }
.fix-issue-group--info { color: #7ab; }

.fix-issue-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 2px 0;
  font-size: 11px;
  line-height: 1.45;
}
.fix-issue-sev {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
}
.fix-issue-sev--error { background: rgba(238,85,85,0.2); color: #e55; }
.fix-issue-sev--warning { background: rgba(232,168,56,0.2); color: #e8a838; }
.fix-issue-sev--info { background: rgba(119,170,187,0.2); color: #7ab; }
.fix-issue-text { flex: 1; min-width: 0; word-break: break-word; }
.fix-issue-loc { color: var(--text-muted, #888); font-family: monospace; font-size: 10px; margin-left: 4px; }
.fix-issue-more { font-size: 10px; color: var(--text-muted, #888); padding: 3px 0; }

/* Verify detail */
.fix-verify-detail { margin-top: 5px; font-size: 11px; line-height: 1.4; }
.fix-verify-detail:first-child { margin-top: 0; }
.fix-verify-label { color: var(--text-muted, #888); margin-right: 4px; }
.fix-verify-code { font-size: 10px; font-family: monospace; background: rgba(255,255,255,0.05); padding: 1px 5px; border-radius: 3px; }
.fix-verify-pre {
  font-size: 10px;
  font-family: monospace;
  background: rgba(0,0,0,0.2);
  padding: 6px 8px;
  border-radius: 4px;
  margin: 4px 0 0;
  max-height: 120px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.3;
}
.fix-verify-pre--err { color: #e55; }
.fix-verify-files { display: flex; flex-direction: column; gap: 2px; margin-top: 3px; }
.fix-verify-file { font-size: 10px; font-family: monospace; padding: 1px 5px; }
.fix-verify-steps { display: flex; flex-direction: column; gap: 6px; margin-bottom: 6px; }
.fix-verify-step {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.fix-verify-step-meta { font-size: 10px; color: var(--text-muted, #888); }
.fix-verify-note {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--text-muted, #aaa);
  line-height: 1.4;
}
.fix-badge--compact { font-size: 10px; padding: 1px 6px; }
.fix-card--compare .fix-card-header { cursor: default; }
.fix-compare-detail { margin: 0 0 6px; font-size: 12px; line-height: 1.4; }
.fix-compare-row { font-size: 11px; line-height: 1.5; }

/* Result */
.fix-result { font-size: 12px; margin: 0; line-height: 1.4; color: var(--text-muted, #aaa); }

/* Resume */
.fix-resume {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border, #333);
  background: color-mix(in srgb, var(--accent, #0078d4) 8%, transparent);
}
.fix-resume-hint { font-size: 12px; margin: 0; line-height: 1.4; color: var(--text-muted, #aaa); }

/* Empty */
.panel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 12px;
  text-align: center;
  color: var(--text-muted, #888);
}
.panel-empty-icon { font-size: 28px; }
.panel-empty-title { font-weight: 600; margin: 0; color: inherit; }
.panel-empty-hint { font-size: 12px; margin: 0; line-height: 1.4; }
</style>
