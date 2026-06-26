<template>
  <div class="review-panel">
    <div v-if="!projectOpened" class="panel-empty">
      <span class="panel-empty-icon" aria-hidden="true">🏛</span>
      <p class="panel-empty-title">尚未打开项目</p>
      <p class="panel-empty-hint">打开项目后，在「项目 → 审视」中启动架构审视</p>
    </div>

    <template v-else>
      <div v-if="reviewRun.running" class="review-status">
        <span class="review-spinner" aria-hidden="true" />
        <span class="review-status-text">
          {{ reviewRun.statusDetail || "架构审视中…" }}
          <template v-if="reviewRun.maxTurns"> · {{ reviewRun.turn }}/{{ reviewRun.maxTurns }}</template>
        </span>
        <button type="button" class="review-btn review-btn--danger" @click="emit('stop-review')">
          停止
        </button>
      </div>

      <template v-else>
        <div class="review-empty-card" v-if="!hasReview && !reviewLoading">
          <p class="review-empty-title">架构审视</p>
          <p class="review-empty-desc">全局视角评估方向是否跑偏，非语法/lint 检查</p>
          <button
            type="button"
            class="review-btn review-btn--primary review-btn--block"
            :disabled="!reviewReady"
            @click="emit('start-review')"
          >
            开始审视
          </button>
        </div>

        <div v-else class="review-toolbar">
          <button
            type="button"
            class="review-btn review-btn--primary"
            :disabled="!reviewReady || reviewLoading"
            @click="emit('start-review')"
          >
            {{ hasReview ? "重新审视" : "开始审视" }}
          </button>
          <button
            v-if="hasReview"
            type="button"
            class="review-btn review-btn--ghost"
            @click="emit('open-source')"
          >
            源文件
          </button>
        </div>
      </template>

      <p v-if="reviewMessage" class="review-hint" role="status">{{ reviewMessage }}</p>

      <div v-if="reviewLoading && !reviewRun.running" class="review-loading">加载中…</div>

      <div v-else-if="hasReview && !reviewRun.running" class="review-summary" aria-label="审视概况">
        <span
          class="review-verdict"
          :class="`review-verdict--${reviewVerdict || 'unknown'}`"
        >
          {{ verdictLabel }}
        </span>
        <span v-if="lastReviewedAt" class="review-meta">{{ formatTime(lastReviewedAt) }}</span>
        <p v-if="contextHint" class="review-context-hint">{{ contextHint }}</p>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { formatArchitectReviewVerdictLabel } from "../../../shared/projectArchitectReview";
import type { ArchitectReviewMeta } from "../../services/vibeProjectArchitectReviewClient";
import type { ArchitectReviewRunState } from "../../composables/useProjectArchitectReview";
import type { ArchitectReviewVerdict } from "../../../shared/projectArchitectReviewFormat";

const props = defineProps<{
  projectOpened: boolean;
  reviewReady: boolean;
  reviewLoading: boolean;
  reviewMessage: string;
  hasReview: boolean;
  reviewMeta: ArchitectReviewMeta;
  reviewVerdict: ArchitectReviewVerdict | null;
  reviewRun: ArchitectReviewRunState;
  changedFileCount?: number;
  commitCount?: number;
}>();

const emit = defineEmits<{
  "start-review": [];
  "stop-review": [];
  "open-source": [];
}>();

const verdictLabel = computed(() => formatArchitectReviewVerdictLabel(props.reviewVerdict));
const lastReviewedAt = computed(() => props.reviewMeta.lastReviewedAt ?? props.reviewMeta.updatedAt ?? "");

const contextHint = computed(() => {
  const parts: string[] = [];
  if (props.commitCount) parts.push(`近 ${props.commitCount} 次提交`);
  if (props.changedFileCount) parts.push(`${props.changedFileCount} 个变更文件`);
  return parts.length ? `范围：整个项目 + ${parts.join("、")}` : "范围：整个项目 + 近期 Git";
});

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
.review-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 8px 12px;
  min-height: 0;
  overflow: auto;
}

.review-empty-card {
  padding: 12px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
}

.review-empty-title {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(220, 228, 235, 0.98);
}

.review-empty-desc {
  margin: 0 0 10px;
  font-size: 11px;
  color: rgba(139, 148, 158, 0.92);
  line-height: 1.4;
}

.review-toolbar {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.review-btn {
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(210, 218, 226, 0.96);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.review-btn--block {
  width: 100%;
}

.review-btn--primary {
  border-color: rgba(88, 166, 255, 0.45);
  background: rgba(88, 166, 255, 0.12);
  color: rgba(200, 225, 255, 0.98);
}

.review-btn--ghost {
  font-weight: 500;
}

.review-btn--danger {
  border-color: rgba(255, 120, 115, 0.45);
  color: rgba(255, 180, 175, 0.98);
}

.review-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.review-status {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11px;
  color: rgba(139, 148, 158, 0.95);
}

.review-status-text {
  flex: 1;
  min-width: 0;
}

.review-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.12);
  border-top-color: rgba(88, 166, 255, 0.85);
  border-radius: 50%;
  animation: review-spin 0.7s linear infinite;
  flex-shrink: 0;
}

@keyframes review-spin {
  to { transform: rotate(360deg); }
}

.review-hint {
  margin: 0;
  font-size: 11px;
  color: rgba(160, 175, 190, 0.95);
  line-height: 1.35;
}

.review-loading {
  font-size: 11px;
  color: rgba(139, 148, 158, 0.95);
}

.review-summary {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.review-verdict {
  font-size: 12px;
  font-weight: 600;
}

.review-verdict--on_track {
  color: rgba(183, 235, 198, 0.95);
}

.review-verdict--caution {
  color: rgba(255, 210, 120, 0.98);
}

.review-verdict--off_track {
  color: rgba(255, 140, 135, 0.98);
}

.review-verdict--unknown {
  color: rgba(160, 175, 190, 0.95);
}

.review-meta {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.88);
}

.review-context-hint {
  margin: 0;
  font-size: 10px;
  color: rgba(139, 148, 158, 0.85);
  line-height: 1.35;
}
</style>
