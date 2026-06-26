<template>
  <div class="architect-review-main">
    <header class="architect-review-head">
      <h2 class="architect-review-title">项目架构审视</h2>
      <span
        v-if="hasReview || reviewRun.running"
        class="architect-review-verdict-badge"
        :class="`architect-review-verdict-badge--${reviewVerdict || 'unknown'}`"
      >
        {{ verdictLabel }}
      </span>
      <span v-if="reviewRun.running" class="architect-review-badge architect-review-badge--pulse">
        审视中
      </span>
      <div class="architect-review-head-actions">
        <button
          v-if="hasReview && !reviewRun.running"
          type="button"
          class="architect-review-btn architect-review-btn--ghost"
          title="在编辑器打开 .aiall/project-architect-review.md"
          @click="emit('open-source')"
        >
          源文件
        </button>
        <button
          v-if="chatCollapsed"
          type="button"
          class="architect-review-btn architect-review-btn--ghost"
          @click="emit('expand-chat')"
        >
          展开 AI 助手
        </button>
      </div>
    </header>

    <p v-if="reviewMessage" class="architect-review-hint" role="status">{{ reviewMessage }}</p>

    <div v-if="reviewLoading && !reviewRun.running" class="architect-review-loading">加载中…</div>

    <div
      v-else-if="!hasReview && !reviewRun.running"
      class="architect-review-empty"
    >
      <p class="architect-review-empty-title">尚未生成审视报告</p>
      <p class="architect-review-empty-desc">在左侧点击「开始审视」，AI 将从架构师视角分析整个项目与近期 Git 变更。</p>
    </div>

    <article
      v-else
      class="architect-review-body markdown-body"
      v-html="displayHtml"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import DOMPurify from "dompurify";
import { formatArchitectReviewVerdictLabel } from "../../../shared/projectArchitectReview";
import { stripArchitectReviewFrontmatter } from "../../../shared/projectArchitectReviewFormat";
import type { ArchitectReviewRunState } from "../../composables/useProjectArchitectReview";
import type { ArchitectReviewVerdict } from "../../../shared/projectArchitectReviewFormat";
import { renderMarkdown } from "../../utils/renderMarkdown";

const props = defineProps<{
  chatCollapsed: boolean;
  hasReview: boolean;
  reviewLoading: boolean;
  reviewMessage: string;
  displayBody: string;
  reviewVerdict: ArchitectReviewVerdict | null;
  reviewRun: ArchitectReviewRunState;
}>();

const emit = defineEmits<{
  "open-source": [];
  "expand-chat": [];
}>();

const verdictLabel = computed(() => formatArchitectReviewVerdictLabel(props.reviewVerdict));

const displayHtml = computed(() => {
  const body = stripArchitectReviewFrontmatter(props.displayBody.trim());
  if (!body) return "";
  return DOMPurify.sanitize(renderMarkdown(body));
});
</script>

<style scoped>
.architect-review-main {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: rgba(13, 17, 23, 0.55);
}

.architect-review-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 12px 16px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.architect-review-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: rgba(230, 237, 243, 0.98);
}

.architect-review-verdict-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.architect-review-verdict-badge--on_track {
  color: rgba(183, 235, 198, 0.95);
  border-color: rgba(183, 235, 198, 0.25);
}

.architect-review-verdict-badge--caution {
  color: rgba(255, 210, 120, 0.98);
  border-color: rgba(255, 210, 120, 0.3);
}

.architect-review-verdict-badge--off_track {
  color: rgba(255, 140, 135, 0.98);
  border-color: rgba(255, 140, 135, 0.3);
}

.architect-review-verdict-badge--unknown {
  color: rgba(160, 175, 190, 0.95);
}

.architect-review-badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(88, 166, 255, 0.15);
  color: rgba(200, 225, 255, 0.98);
}

.architect-review-badge--pulse {
  animation: architect-review-pulse 1.4s ease-in-out infinite;
}

@keyframes architect-review-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}

.architect-review-head-actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
}

.architect-review-btn {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(210, 218, 226, 0.96);
  font-size: 11px;
  cursor: pointer;
}

.architect-review-btn--ghost {
  font-weight: 500;
}

.architect-review-hint {
  margin: 0;
  padding: 0 16px 8px;
  font-size: 11px;
  color: rgba(160, 175, 190, 0.95);
}

.architect-review-loading,
.architect-review-empty {
  padding: 24px 16px;
  color: rgba(139, 148, 158, 0.95);
  font-size: 12px;
}

.architect-review-empty-title {
  margin: 0 0 6px;
  font-weight: 600;
  color: rgba(220, 228, 235, 0.96);
}

.architect-review-empty-desc {
  margin: 0;
  line-height: 1.5;
}

.architect-review-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 20px 24px;
  font-size: 13px;
  line-height: 1.6;
  color: rgba(220, 228, 235, 0.94);
}
</style>
