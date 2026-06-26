<template>
  <div class="review-panel">
    <div v-if="!projectOpened" class="panel-empty">
      <span class="panel-empty-icon" aria-hidden="true">🏛</span>
      <p class="panel-empty-title">尚未打开项目</p>
      <p class="panel-empty-hint">打开项目后，在「项目 → 评审」中启动架构评审</p>
    </div>

    <template v-else>
      <div v-if="reviewRun.running" class="review-status">
        <span class="review-spinner" aria-hidden="true" />
        <span class="review-status-text">
          {{ reviewRun.statusDetail || "架构评审中…" }}
          <template v-if="reviewRun.maxTurns"> · {{ reviewRun.turn }}/{{ reviewRun.maxTurns }}</template>
        </span>
        <button type="button" class="review-btn review-btn--danger" @click="emit('stop-review')">
          停止
        </button>
      </div>

      <template v-else>
        <div class="review-empty-card" v-if="!hasReview && !reviewLoading">
          <p class="review-empty-title">架构评审</p>
          <p class="review-empty-desc">全局视角评估方向是否跑偏，非语法/lint 检查</p>
          <button
            type="button"
            class="review-btn review-btn--primary review-btn--block"
            :disabled="!reviewReady"
            @click="emit('start-review')"
          >
            开始评审
          </button>
        </div>

        <div v-else class="review-toolbar">
          <button
            type="button"
            class="review-btn review-btn--primary"
            :disabled="!reviewReady || reviewLoading"
            @click="emit('start-review')"
          >
            {{ hasReview ? "重新评审" : "开始评审" }}
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

      <div v-else-if="hasReview && !reviewRun.running" class="review-summary" aria-label="评审概况">
        <span
          class="review-verdict"
          :class="`review-verdict--${reviewVerdict || 'unknown'}`"
        >
          {{ verdictLabel }}
        </span>
        <span v-if="lastReviewedAt" class="review-meta">{{ formatTime(lastReviewedAt) }}</span>
        <p v-if="contextHint" class="review-context-hint">{{ contextHint }}</p>
      </div>

      <!-- Review History Section -->
      <div v-if="!reviewRun.running && (reviewHistory.length > 0 || reviewHistoryLoading)" class="review-history-section">
        <div v-if="reviewHistoryLoading" class="review-loading">加载中…</div>
        
        <template v-else>
          <p v-if="reviewHistoryMessage" class="review-hint" role="status">{{ reviewHistoryMessage }}</p>
          <div
            v-for="entry in reviewHistory"
            :key="entry.id"
            class="review-history-item"
            :class="{ 'review-history-item--active': activeHistoryReview?.id === entry.id }"
          >
            <button
              type="button"
              class="review-history-item-btn"
              @click="emit('view-history', entry)"
            >
              <span
                class="review-history-item-verdict"
                :class="`review-history-item-verdict--${entry.verdict || 'unknown'}`"
              >
                {{ formatVerdictLabel(entry.verdict) }}
              </span>
              <span class="review-history-item-time">{{ formatTime(entry.createdAt) }}</span>
              <span v-if="entry.commitCount" class="review-history-item-meta">
                {{ entry.commitCount }} commits
              </span>
              <span v-if="entry.changedFileCount" class="review-history-item-meta">
                {{ entry.changedFileCount }} files
              </span>
              <span v-if="entry.gitHead" class="review-history-item-git">
                {{ shortGitRef(entry.gitHead) }}
              </span>
            </button>
            <button
              type="button"
              class="review-history-item-delete"
              title="删除此记录"
              @click.stop="emit('delete-history', entry)"
            >
              ×
            </button>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { formatArchitectReviewVerdictLabel } from "../../../shared/projectArchitectReview";
import type { ArchitectReviewMeta } from "../../services/vibeProjectArchitectReviewClient";
import type { ArchitectReviewRunState } from "../../composables/useProjectArchitectReview";
import type { ArchitectReviewVerdict } from "../../../shared/projectArchitectReviewFormat";
import type { ArchitectReviewHistoryEntry } from "../../../shared/projectArchitectReviewHistory";

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
  reviewHistory: ArchitectReviewHistoryEntry[];
  reviewHistoryLoading: boolean;
  reviewHistoryMessage: string;
  activeHistoryReview: ArchitectReviewHistoryEntry | null;
}>();

const emit = defineEmits<{
  "start-review": [];
  "stop-review": [];
  "open-source": [];
  "load-history": [];
  "view-history": [entry: ArchitectReviewHistoryEntry];
  "delete-history": [entry: ArchitectReviewHistoryEntry];
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

function formatVerdictLabel(verdict?: ArchitectReviewVerdict | null): string {
  return formatArchitectReviewVerdictLabel(verdict ?? null);
}

function shortGitRef(ref: string): string {
  return ref.length > 8 ? ref.slice(0, 8) : ref;
}
</script>

<style scoped>
.review-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 2px 6px 8px;
  min-height: 0;
  overflow: auto;
}

.review-empty-card {
  padding: 14px 10px;
  border-radius: 8px;
  border: 1px solid rgba(88, 166, 255, 0.15);
  background: linear-gradient(135deg, rgba(88, 166, 255, 0.04) 0%, rgba(255, 255, 255, 0.02) 100%);
}

.review-empty-title {
  margin: 0 0 4px;
  font-size: 12.5px;
  font-weight: 600;
  color: rgba(220, 228, 235, 0.98);
  letter-spacing: 0.02em;
}

.review-empty-desc {
  margin: 0 0 10px;
  font-size: 11px;
  color: rgba(139, 148, 158, 0.92);
  line-height: 1.45;
}

.review-toolbar {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}

.review-btn {
  padding: 4px 9px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(210, 218, 226, 0.96);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.1s;
}

.review-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
}

.review-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.review-btn--block {
  width: 100%;
}

.review-btn--primary {
  border-color: rgba(88, 166, 255, 0.45);
  background: rgba(88, 166, 255, 0.12);
  color: rgba(200, 225, 255, 0.98);
}

.review-btn--primary:hover:not(:disabled) {
  border-color: rgba(88, 166, 255, 0.6);
  background: rgba(88, 166, 255, 0.18);
}

.review-btn--ghost {
  font-weight: 500;
}

.review-btn--danger {
  border-color: rgba(255, 120, 115, 0.45);
  color: rgba(255, 180, 175, 0.98);
}

.review-btn--danger:hover:not(:disabled) {
  border-color: rgba(255, 120, 115, 0.6);
  background: rgba(255, 120, 115, 0.12);
}

.review-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.review-status {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  font-size: 11px;
  color: rgba(160, 175, 190, 0.95);
  padding: 4px 0;
}

.review-status-text {
  flex: 1;
  min-width: 0;
  color: rgba(180, 190, 200, 0.95);
}

.review-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(88, 166, 255, 0.15);
  border-top-color: rgba(88, 166, 255, 0.85);
  border-radius: 50%;
  animation: review-spin 0.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
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
  gap: 2px;
}

.review-verdict {
  font-size: 12px;
  font-weight: 600;
  padding-left: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
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
  font-size: 10.5px;
  color: rgba(139, 148, 158, 0.85);
  padding-left: 8px;
}

.review-context-hint {
  margin: 0;
  font-size: 10.5px;
  color: rgba(139, 148, 158, 0.8);
  line-height: 1.4;
  padding-left: 8px;
}

/* Review History Styles */
.review-history-section {
  margin-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 5px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 180px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.12) transparent;
}

.review-history-section::-webkit-scrollbar {
  width: 4px;
}

.review-history-section::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
}

.review-history-item {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: background 0.15s, border-color 0.15s;
}

.review-history-item:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.1);
}

.review-history-item--active {
  background: rgba(88, 166, 255, 0.1);
  border-color: rgba(88, 166, 255, 0.25);
}

.review-history-item-btn {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  min-width: 0;
}

.review-history-item-verdict {
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
}

.review-history-item-verdict--on_track {
  color: rgba(183, 235, 198, 0.95);
}

.review-history-item-verdict--caution {
  color: rgba(255, 210, 120, 0.98);
}

.review-history-item-verdict--off_track {
  color: rgba(255, 140, 135, 0.98);
}

.review-history-item-verdict--unknown {
  color: rgba(160, 175, 190, 0.95);
}

.review-history-item-time {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.88);
  flex-shrink: 0;
}

.review-history-item-meta {
  font-size: 9px;
  color: rgba(139, 148, 158, 0.7);
  flex-shrink: 0;
}

.review-history-item-git {
  font-size: 9px;
  color: rgba(139, 148, 158, 0.6);
  font-family: monospace;
  flex-shrink: 0;
}

.review-history-item-delete {
  padding: 2px 4px;
  border: none;
  background: transparent;
  color: rgba(139, 148, 158, 0.6);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  border-radius: 3px;
  flex-shrink: 0;
  transition: color 0.15s, background 0.15s;
}

.review-history-item-delete:hover {
  color: rgba(255, 140, 135, 0.98);
  background: rgba(255, 140, 135, 0.12);
}
</style>
