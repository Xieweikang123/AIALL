<template>
  <div class="fix-panel">
    <div v-if="!projectOpened" class="panel-empty">
      <span class="panel-empty-icon" aria-hidden="true">🔧</span>
      <p class="panel-empty-title">尚未打开项目</p>
      <p class="panel-empty-hint">打开项目后，在「项目 → 修复」中一键扫描并修复</p>
    </div>

    <template v-else>
      <div class="fix-intro">
        <p class="fix-title">自动找 Bug 并修复</p>
        <p class="fix-desc">规则扫描 + 测试验证 → Agent 局部 patch → 复验</p>
      </div>

      <div class="fix-scope" role="group" aria-label="修复范围">
        <label class="fix-check">
          <input v-model="includeWarnings" type="checkbox" :disabled="running" />
          <span>包含警告级扫描项</span>
        </label>
        <p class="fix-scope-hint">默认：测试失败 + error 级扫描；TODO 等提示项不会自动修改</p>
        <label class="fix-check fix-check--disabled" title="Phase 2">
          <input type="checkbox" disabled />
          <span>包含逻辑审查（即将推出）</span>
        </label>
      </div>

      <div class="fix-toolbar">
        <button
          type="button"
          class="fix-btn fix-btn--primary fix-btn--block"
          :disabled="running"
          @click="emit('start')"
        >
          {{ running ? phaseLabel : "开始自动修复" }}
        </button>
        <div class="fix-toolbar-row">
          <button type="button" class="fix-btn fix-btn--ghost" :disabled="running" @click="emit('scan-only')">
            仅扫描
          </button>
          <button type="button" class="fix-btn fix-btn--ghost" :disabled="running" @click="emit('verify-only')">
            仅跑测试
          </button>
        </div>
      </div>

      <p v-if="error" class="fix-error" role="alert">{{ error }}</p>

      <div v-if="phase !== 'idle'" class="fix-steps" aria-label="进度">
        <span :class="stepClass('scanning')">扫描</span>
        <span class="fix-step-sep">→</span>
        <span :class="stepClass('testing')">测试</span>
        <span class="fix-step-sep">→</span>
        <span :class="stepClass('fixing')">修复</span>
        <span class="fix-step-sep">→</span>
        <span :class="stepClass('done')">完成</span>
      </div>

      <div v-if="scanSummary" class="fix-summary">
        <p>{{ scanSummary }}</p>
      </div>
      <div v-if="verifySummary" class="fix-summary">
        <p>{{ verifySummary }}</p>
      </div>
      <p v-if="lastSummary" class="fix-result">{{ lastSummary }}</p>

      <button
        v-if="phase === 'done' && !running"
        type="button"
        class="fix-btn fix-btn--ghost fix-btn--block"
        @click="emit('open-git')"
      >
        查看 Git 变更
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { AutoBugFixPhase } from "../../composables/useAutoBugFix";
import type { ProjectHealthScanResult } from "../../services/projectHealthScanClient";
import type { ProjectVerifyRunResult } from "../../services/projectVerifyRunClient";

const props = defineProps<{
  projectOpened: boolean;
  phase: AutoBugFixPhase;
  running: boolean;
  error: string;
  scanResult: ProjectHealthScanResult | null;
  verifyResult: ProjectVerifyRunResult | null;
  lastSummary: string;
  includeWarnings: boolean;
}>();

const emit = defineEmits<{
  start: [];
  "scan-only": [];
  "verify-only": [];
  "open-git": [];
  "update:includeWarnings": [value: boolean];
}>();

const includeWarnings = computed({
  get: () => props.includeWarnings,
  set: (v: boolean) => emit("update:includeWarnings", v),
});

const phaseLabel = computed(() => {
  switch (props.phase) {
    case "scanning": return "扫描中…";
    case "testing": return "测试中…";
    case "fixing": return "修复中…";
    default: return "处理中…";
  }
});

const scanSummary = computed(() => {
  const s = props.scanResult;
  if (!s?.scannedAt) return "";
  const sum = s.summary;
  return `扫描：${sum.errorCount} 错误 · ${sum.warningCount} 警告 · ${sum.infoCount} 提示`;
});

const verifySummary = computed(() => {
  const v = props.verifyResult;
  if (!v?.ranAt) return "";
  if (v.skipped) return `测试：跳过（${v.skipReason || "无 verify 脚本"}）`;
  return v.exitCode === 0 ? `测试：通过（${v.command}）` : `测试：失败 exit ${v.exitCode}（${v.command}）`;
});

function stepClass(step: AutoBugFixPhase): string {
  const order: AutoBugFixPhase[] = ["scanning", "testing", "fixing", "done", "no_work"];
  const current = props.phase;
  const curIdx = order.indexOf(current);
  const stepIdx = order.indexOf(step);
  if (current === "error") return "fix-step";
  if (curIdx >= stepIdx && current !== "idle") return "fix-step fix-step--active";
  return "fix-step";
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

.fix-intro { margin-bottom: 4px; }
.fix-title { font-weight: 600; font-size: 13px; margin: 0 0 4px; }
.fix-desc { font-size: 12px; color: var(--text-muted, #888); margin: 0; line-height: 1.4; }

.fix-scope { display: flex; flex-direction: column; gap: 6px; }
.fix-check { display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer; }
.fix-check--disabled { opacity: 0.55; cursor: not-allowed; }
.fix-scope-hint { font-size: 11px; color: var(--text-muted, #888); margin: 0; line-height: 1.35; }

.fix-toolbar { display: flex; flex-direction: column; gap: 8px; }
.fix-toolbar-row { display: flex; gap: 8px; }

.fix-btn {
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--border, #333);
  background: var(--surface, #1e1e1e);
  color: inherit;
  cursor: pointer;
}
.fix-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.fix-btn--primary { background: var(--accent, #0078d4); border-color: transparent; color: #fff; }
.fix-btn--ghost { background: transparent; }
.fix-btn--block { width: 100%; }

.fix-error { color: #e55; font-size: 12px; margin: 0; }
.fix-summary, .fix-result { font-size: 12px; margin: 0; line-height: 1.4; }
.fix-result { color: var(--text-muted, #aaa); }

.fix-steps {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  font-size: 11px;
}
.fix-step { color: var(--text-muted, #666); }
.fix-step--active { color: var(--accent, #0078d4); font-weight: 600; }
.fix-step-sep { color: var(--text-muted, #555); }

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
