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

      <div v-if="reviewLoading && !reviewRun.running && !reviewHistoryDetailLoading" class="review-loading">加载中…</div>

      <div
        v-else-if="hasReview && !reviewRun.running"
        class="review-summary-card"
        :class="[
          `review-summary-card--${reviewVerdict || 'unknown'}`,
          { 'review-summary-card--active': !activeHistoryReview },
          { 'review-summary-card--clickable': activeHistoryReview }
        ]"
        role="button"
        :tabindex="activeHistoryReview ? 0 : undefined"
        aria-label="当前评审"
        @click="activeHistoryReview ? emit('clear-history-view') : undefined"
        @keydown.enter="activeHistoryReview ? emit('clear-history-view') : undefined"
      >
        <div class="review-summary-head">
          <span
            class="review-verdict-badge"
            :class="`review-verdict-badge--${reviewVerdict || 'unknown'}`"
          >
            {{ verdictLabel }}
          </span>
          <span v-if="lastReviewedAt" class="review-summary-time">{{ formatTime(lastReviewedAt) }}</span>
          <span
            v-if="!activeHistoryReview"
            class="review-history-item-viewing"
            style="margin-left: auto;"
          >
            当前
          </span>
        </div>
        <p v-if="contextHint" class="review-context-hint">{{ contextHint }}</p>
        <p v-if="reviewMeta.gitHead" class="review-summary-git" :title="reviewMeta.gitHead">
          基于提交 {{ shortGitRef(reviewMeta.gitHead) }}
        </p>
      </div>

      <!-- Review History Section -->
      <div
        v-if="!reviewRun.running && (reviewHistory.length > 0 || reviewHistoryLoading)"
        class="review-history-section"
        aria-label="评审历史"
      >
        <p class="review-history-title">
          历史记录
          <span v-if="reviewHistory.length" class="review-history-count">{{ reviewHistory.length }}</span>
        </p>

        <div v-if="reviewHistoryLoading" class="review-loading">加载中…</div>

        <template v-else>
          <p v-if="reviewHistoryMessage" class="review-hint" role="status">{{ reviewHistoryMessage }}</p>
          <div class="review-history-list">
            <div
              v-for="(entry, index) in reviewHistory"
              :key="entry.id"
              class="review-history-item"
              :class="[
                `review-history-item--${entry.verdict || 'unknown'}`,
                { 'review-history-item--active': activeHistoryReview?.id === entry.id },
              ]"
            >
              <button
                type="button"
                class="review-history-item-btn"
                :aria-current="activeHistoryReview?.id === entry.id ? 'true' : undefined"
                @click="emit('view-history', entry)"
              >
                <div class="review-history-item-main">
                  <span
                    class="review-history-item-verdict"
                    :class="`review-history-item-verdict--${entry.verdict || 'unknown'}`"
                  >
                    {{ formatVerdictLabel(entry.verdict) }}
                  </span>
                  <span class="review-history-item-time">{{ formatTime(entry.createdAt) }}</span>
                  <span
                    class="review-history-item-index"
                    :class="{ 'review-history-item-index--active': activeHistoryReview?.id === entry.id }"
                  >
                    <span
                      v-if="activeHistoryReview?.id === entry.id"
                      class="review-history-item-viewing"
                    >
                      查看中
                    </span>
                    <template v-else>#{{ reviewHistory.length - index }}</template>
                  </span>
                </div>
                <div v-if="formatHistoryScope(entry) || entry.gitHead" class="review-history-item-sub">
                  <span v-if="formatHistoryScope(entry)" class="review-history-item-scope">
                    {{ formatHistoryScope(entry) }}
                  </span>
                  <span
                    v-if="entry.gitHead"
                    class="review-history-item-git"
                    :title="entry.gitHead"
                  >
                    提交 {{ shortGitRef(entry.gitHead) }}
                  </span>
                </div>
              </button>
              <button
                type="button"
                class="review-history-item-delete"
                title="删除此记录"
                @click.stop="emit('delete-history', entry, $event)"
              >
                ×
              </button>
            </div>
          </div>
        </template>
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
  reviewHistoryDetailLoading?: boolean;
  reviewHistoryMessage: string;
  activeHistoryReview: ArchitectReviewHistoryEntry | null;
}>();

const emit = defineEmits<{
  "start-review": [];
  "stop-review": [];
  "open-source": [];
  "load-history": [];
  "view-history": [entry: ArchitectReviewHistoryEntry];
  "delete-history": [entry: ArchitectReviewHistoryEntry, event: MouseEvent];
  "clear-history-view": [];
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
  const trimmed = ref.trim();
  if (!trimmed) return "";
  return trimmed.length > 7 ? trimmed.slice(0, 7) : trimmed;
}

function formatHistoryScope(entry: ArchitectReviewHistoryEntry): string {
  const parts: string[] = [];
  if (entry.commitCount) parts.push(`${entry.commitCount} 次提交`);
  if (entry.changedFileCount) parts.push(`${entry.changedFileCount} 个变更文件`);
  return parts.join(" · ");
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

.review-summary-card {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-left: 3px solid rgba(139, 148, 158, 0.35);
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.12s ease;
}

.review-summary-card--on_track {
  border-left-color: rgba(183, 235, 198, 0.45);
}

.review-summary-card--caution {
  border-left-color: rgba(255, 210, 120, 0.5);
}

.review-summary-card--off_track {
  border-left-color: rgba(255, 140, 135, 0.5);
}

.review-summary-card--unknown {
  border-left-color: rgba(139, 148, 158, 0.35);
}

.review-summary-card--clickable {
  cursor: pointer;
}

.review-summary-card--clickable:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.1);
}

.review-summary-card--clickable:active {
  transform: scale(0.98);
}

.review-summary-card--active {
  border-left-width: 4px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
}

.review-summary-card--active.review-summary-card--on_track {
  background: linear-gradient(
    90deg,
    rgba(183, 235, 198, 0.14) 0%,
    rgba(183, 235, 198, 0.04) 55%,
    rgba(255, 255, 255, 0.02) 100%
  );
  border-color: rgba(183, 235, 198, 0.28);
  border-left-color: rgba(183, 235, 198, 0.9);
  box-shadow:
    inset 0 0 0 1px rgba(183, 235, 198, 0.12),
    0 0 0 1px rgba(183, 235, 198, 0.08);
}

.review-summary-card--active.review-summary-card--caution {
  background: linear-gradient(
    90deg,
    rgba(255, 210, 120, 0.16) 0%,
    rgba(255, 210, 120, 0.05) 55%,
    rgba(255, 255, 255, 0.02) 100%
  );
  border-color: rgba(255, 210, 120, 0.3);
  border-left-color: rgba(255, 210, 120, 0.95);
  box-shadow:
    inset 0 0 0 1px rgba(255, 210, 120, 0.14),
    0 0 0 1px rgba(255, 210, 120, 0.08);
}

.review-summary-card--active.review-summary-card--off_track {
  background: linear-gradient(
    90deg,
    rgba(255, 140, 135, 0.14) 0%,
    rgba(255, 140, 135, 0.05) 55%,
    rgba(255, 255, 255, 0.02) 100%
  );
  border-color: rgba(255, 140, 135, 0.28);
  border-left-color: rgba(255, 140, 135, 0.92);
  box-shadow:
    inset 0 0 0 1px rgba(255, 140, 135, 0.12),
    0 0 0 1px rgba(255, 140, 135, 0.08);
}

.review-summary-card--active.review-summary-card--unknown {
  background: linear-gradient(
    90deg,
    rgba(88, 166, 255, 0.12) 0%,
    rgba(88, 166, 255, 0.04) 55%,
    rgba(255, 255, 255, 0.02) 100%
  );
  border-color: rgba(88, 166, 255, 0.24);
  border-left-color: rgba(88, 166, 255, 0.75);
  box-shadow:
    inset 0 0 0 1px rgba(88, 166, 255, 0.1),
    0 0 0 1px rgba(88, 166, 255, 0.06);
}

.review-summary-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.review-verdict-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  flex-shrink: 0;
}

.review-verdict-badge--on_track {
  color: rgba(183, 235, 198, 0.95);
  border-color: rgba(183, 235, 198, 0.25);
  background: rgba(183, 235, 198, 0.06);
}

.review-verdict-badge--caution {
  color: rgba(255, 210, 120, 0.98);
  border-color: rgba(255, 210, 120, 0.3);
  background: rgba(255, 210, 120, 0.06);
}

.review-verdict-badge--off_track {
  color: rgba(255, 140, 135, 0.98);
  border-color: rgba(255, 140, 135, 0.3);
  background: rgba(255, 140, 135, 0.06);
}

.review-verdict-badge--unknown {
  color: rgba(160, 175, 190, 0.95);
}

.review-summary-time {
  font-size: 10.5px;
  color: rgba(139, 148, 158, 0.88);
}

.review-summary-git {
  margin: 0;
  font-size: 10px;
  color: rgba(139, 148, 158, 0.75);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.review-viewing-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 10.5px;
  color: rgba(180, 190, 200, 0.95);
  background: rgba(88, 166, 255, 0.08);
  border: 1px solid rgba(88, 166, 255, 0.2);
}

.review-viewing-back {
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(88, 166, 255, 0.35);
  background: transparent;
  color: rgba(200, 225, 255, 0.95);
  font-size: 10px;
  cursor: pointer;
  flex-shrink: 0;
}

.review-viewing-back:hover {
  background: rgba(88, 166, 255, 0.12);
}

.review-context-hint {
  margin: 0;
  font-size: 10.5px;
  color: rgba(139, 148, 158, 0.8);
  line-height: 1.4;
}

/* Review History Styles */
.review-history-section {
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.review-history-title {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  color: rgba(180, 190, 200, 0.95);
  letter-spacing: 0.02em;
  display: flex;
  align-items: center;
  gap: 6px;
}

.review-history-count {
  font-size: 10px;
  font-weight: 500;
  padding: 0 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(139, 148, 158, 0.9);
}

.review-history-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 200px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.12) transparent;
}

.review-history-list::-webkit-scrollbar {
  width: 4px;
}

.review-history-list::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
}

.review-history-item {
  display: flex;
  align-items: stretch;
  gap: 4px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-left-width: 3px;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.12s ease;
}

.review-history-item--on_track {
  border-left-color: rgba(183, 235, 198, 0.45);
}

.review-history-item--caution {
  border-left-color: rgba(255, 210, 120, 0.5);
}

.review-history-item--off_track {
  border-left-color: rgba(255, 140, 135, 0.5);
}

.review-history-item--unknown {
  border-left-color: rgba(139, 148, 158, 0.35);
}

.review-history-item:hover:not(.review-history-item--active) {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.1);
}

.review-history-item--active {
  border-left-width: 4px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
}

.review-history-item--active.review-history-item--on_track {
  background: linear-gradient(
    90deg,
    rgba(183, 235, 198, 0.14) 0%,
    rgba(183, 235, 198, 0.04) 55%,
    rgba(255, 255, 255, 0.02) 100%
  );
  border-color: rgba(183, 235, 198, 0.28);
  border-left-color: rgba(183, 235, 198, 0.9);
  box-shadow:
    inset 0 0 0 1px rgba(183, 235, 198, 0.12),
    0 0 0 1px rgba(183, 235, 198, 0.08);
}

.review-history-item--active.review-history-item--caution {
  background: linear-gradient(
    90deg,
    rgba(255, 210, 120, 0.16) 0%,
    rgba(255, 210, 120, 0.05) 55%,
    rgba(255, 255, 255, 0.02) 100%
  );
  border-color: rgba(255, 210, 120, 0.3);
  border-left-color: rgba(255, 210, 120, 0.95);
  box-shadow:
    inset 0 0 0 1px rgba(255, 210, 120, 0.14),
    0 0 0 1px rgba(255, 210, 120, 0.08);
}

.review-history-item--active.review-history-item--off_track {
  background: linear-gradient(
    90deg,
    rgba(255, 140, 135, 0.14) 0%,
    rgba(255, 140, 135, 0.05) 55%,
    rgba(255, 255, 255, 0.02) 100%
  );
  border-color: rgba(255, 140, 135, 0.28);
  border-left-color: rgba(255, 140, 135, 0.92);
  box-shadow:
    inset 0 0 0 1px rgba(255, 140, 135, 0.12),
    0 0 0 1px rgba(255, 140, 135, 0.08);
}

.review-history-item--active.review-history-item--unknown {
  background: linear-gradient(
    90deg,
    rgba(88, 166, 255, 0.12) 0%,
    rgba(88, 166, 255, 0.04) 55%,
    rgba(255, 255, 255, 0.02) 100%
  );
  border-color: rgba(88, 166, 255, 0.24);
  border-left-color: rgba(88, 166, 255, 0.75);
  box-shadow:
    inset 0 0 0 1px rgba(88, 166, 255, 0.1),
    0 0 0 1px rgba(88, 166, 255, 0.06);
}

.review-history-item-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 8px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  min-width: 0;
  border-radius: 5px;
}

.review-history-item-btn:focus {
  outline: none;
}

.review-history-item-btn:focus-visible {
  outline: 2px solid rgba(88, 166, 255, 0.45);
  outline-offset: -2px;
}

.review-history-item-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.review-history-item-sub {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.review-history-item-verdict {
  font-size: 11px;
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
  font-size: 10.5px;
  color: rgba(139, 148, 158, 0.92);
  flex-shrink: 0;
}

.review-history-item-index {
  margin-left: auto;
  font-size: 9.5px;
  font-weight: 500;
  color: rgba(139, 148, 158, 0.55);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.review-history-item-index--active {
  color: rgba(200, 225, 255, 0.92);
}

.review-history-item-viewing {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: rgba(220, 235, 255, 0.98);
  background: rgba(88, 166, 255, 0.22);
  border: 1px solid rgba(88, 166, 255, 0.35);
}

.review-history-item--active.review-history-item--on_track .review-history-item-viewing {
  color: rgba(210, 250, 220, 0.98);
  background: rgba(183, 235, 198, 0.18);
  border-color: rgba(183, 235, 198, 0.35);
}

.review-history-item--active.review-history-item--caution .review-history-item-viewing {
  color: rgba(255, 235, 190, 0.98);
  background: rgba(255, 210, 120, 0.2);
  border-color: rgba(255, 210, 120, 0.38);
}

.review-history-item--active.review-history-item--off_track .review-history-item-viewing {
  color: rgba(255, 210, 205, 0.98);
  background: rgba(255, 140, 135, 0.18);
  border-color: rgba(255, 140, 135, 0.35);
}

.review-history-item-scope {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.75);
}

.review-history-item-git {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.65);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  flex-shrink: 0;
}

.review-history-item-delete {
  align-self: center;
  margin-right: 4px;
  padding: 2px 6px;
  border: none;
  background: transparent;
  color: rgba(139, 148, 158, 0.6);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  border-radius: 4px;
  flex-shrink: 0;
  transition: color 0.15s, background 0.15s;
}

.review-history-item-delete:hover {
  color: rgba(255, 140, 135, 0.98);
  background: rgba(255, 140, 135, 0.12);
}
</style>
