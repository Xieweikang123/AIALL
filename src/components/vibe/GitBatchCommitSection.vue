<template>
  <div
    v-if="batchGroups && batchGroups.length > 0"
    class="git-batch-section git-section-card"
    :class="{
      'git-batch-section--open': batchSectionOpen,
      'git-batch-section--grouping': aiBatchGrouping,
      'git-batch-section--ai': batchGroupsFromAi,
    }"
  >
    <div class="git-section-head git-batch-head">
      <button
        type="button"
        class="git-section-toggle git-batch-toggle"
        @click="$emit('update:batchSectionOpen', !batchSectionOpen)"
      >
        <span class="git-section-chevron">{{ batchSectionOpen ? "▾" : "▸" }}</span>
        <span class="git-section-title">分批提交</span>
        <span class="git-batch-count">{{ batchGroups.length }}</span>
        <span v-if="batchGroupsFromAi" class="git-batch-ai-tag">AI</span>
      </button>
      <button
        type="button"
        class="git-ai-batch-btn"
        :class="{ 'git-ai-batch-btn--loading': aiBatchGrouping }"
        :disabled="aiBatchGrouping || batchCommittingIndex !== null || !configReady"
        :title="!configReady ? '请先配置 AI 模型' : `分析 ${batchTotalFiles} 个未提交文件，按功能模块智能分组并生成提交说明`"
        @click="$emit('ai-batch-groups')"
      >
        <span v-if="aiBatchGrouping" class="panel-loading-spinner git-ai-batch-spinner" aria-hidden="true" />
        {{ aiBatchGrouping ? "分析中…" : "AI 分析变更" }}
      </button>
    </div>
    <p v-if="!batchSectionOpen" class="git-batch-collapsed-hint">
        {{ batchTotalFiles }} 个文件 · {{ batchGroups.length }} 组 · {{ batchReadyCount }}/{{ batchGroups.length }} 组已填写说明
        <span v-if="ungroupedFileCount" class="git-batch-unassigned-hint"> · {{ ungroupedFileCount }} 个未分组</span>
    </p>
    <div v-if="batchSectionOpen" class="git-batch-body">
      <div v-if="aiBatchGrouping" class="git-batch-loading">
        <span class="panel-loading-spinner git-batch-loading-spinner" aria-hidden="true" />
        <span class="git-batch-loading-text">{{ aiBatchGroupingStep || "正在分析文件变更…" }}</span>
      </div>
      <div class="git-batch-toolbar">
        <span class="git-batch-toolbar-hint">
          {{ batchTotalFiles }} 个文件 · {{ batchReadyCount }}/{{ batchGroups.length }} 组就绪
          <span v-if="ungroupedFileCount" class="git-batch-unassigned-hint"> · {{ ungroupedFileCount }} 个未分组</span>
        </span>
        <button
          type="button"
          class="small git-batch-all-btn"
          :class="canCommitAllBatches ? 'primary' : 'secondary'"
          :disabled="batchCommittingIndex !== null || !canCommitAllBatches || !batchGroupsFromAi"
          :title="!batchGroupsFromAi ? '请先完成 AI 分析变更' : canCommitAllBatches ? '按照当前分组依次创建多个 Git commit' : '请先为每组填写提交说明'"
          @click="$emit('commit-all-batches', [...batchMessages])"
        >
          <template v-if="batchCommittingIndex !== null">
            提交中 {{ batchCommittingIndex + 1 }}/{{ batchGroups.length }}…
          </template>
          <template v-else>按分组提交</template>
        </button>
      </div>
      <div
        v-if="batchCommittingIndex !== null"
        class="git-batch-progress"
        role="progressbar"
        :aria-valuenow="batchCommittingIndex + 1"
        :aria-valuemin="1"
        :aria-valuemax="batchGroups.length"
      >
        <div
          class="git-batch-progress-bar"
          :style="{ width: `${((batchCommittingIndex + 1) / batchGroups.length) * 100}%` }"
        />
      </div>
      <div class="git-batch-groups">
        <div
          v-for="(group, i) in batchGroups"
          :key="`${group.dir}-${i}`"
          class="git-batch-group"
          :class="{
            'git-batch-group--busy': batchCommittingIndex === i,
            'git-batch-group--done': batchCommittingIndex !== null && batchCommittingIndex > i,
            'git-batch-group--ready': !!batchMessages[i]?.trim(),
            'git-batch-group--unassigned': isUnassignedGroup(group),
          }"
          :style="{ '--batch-accent': batchGroupAccent(i) }"
        >
          <div class="git-batch-group-header">
            <span class="git-batch-group-index">{{ i + 1 }}</span>
            <span class="git-batch-group-dir" :title="batchGroupTitle(group)">{{ batchGroupTitle(group) }}</span>
            <span class="git-batch-group-count">{{ group.files.length }} 文件</span>
            <span v-if="isUnassignedGroup(group)" class="git-batch-group-status git-batch-group-status--warn">待归类</span>
            <span v-if="batchCommittingIndex === i" class="git-batch-group-status">提交中</span>
            <span v-else-if="!isUnassignedGroup(group) && !batchMessages[i]?.trim()" class="git-batch-group-status git-batch-group-status--warn">待填写</span>
          </div>
          <div class="git-batch-group-files">
            <div
              v-for="f in visibleBatchFiles(group, i)"
              :key="f.path"
              class="git-batch-file"
              :title="f.path"
            >
              <span class="git-file-status" :class="gitStatusClass(f.status)">{{ gitStatusIcon(f.status) }}</span>
              <span class="git-file-path" :title="f.path">
                <span class="git-file-path-name">{{ splitGitFilePath(f.path).name }}</span>
                <span v-if="splitGitFilePath(f.path).dir" class="git-file-path-dir">{{ splitGitFilePath(f.path).dir }}</span>
              </span>
            </div>
          </div>
          <button
            v-if="group.files.length > batchFilesPreview"
            type="button"
            class="git-batch-files-toggle"
            @click="toggleBatchGroupFiles(i)"
          >
            {{ isBatchGroupExpanded(i) ? "收起文件列表" : `展开其余 ${group.files.length - batchFilesPreview} 个文件` }}
          </button>
          <div class="git-batch-group-commit">
            <textarea
              :value="batchMessages[i]"
              class="git-batch-msg-input"
              rows="2"
              placeholder="提交说明…"
              :disabled="batchCommittingIndex !== null"
              @input="onBatchMessageInput(i, ($event.target as HTMLTextAreaElement).value)"
            />
            <button
              type="button"
              class="small git-batch-commit-btn"
              :class="batchMessages[i]?.trim() ? 'primary' : 'secondary'"
              :disabled="batchCommittingIndex !== null || !batchMessages[i]?.trim() || !batchGroupsFromAi"
              :title="!batchGroupsFromAi ? '请先完成 AI 分析变更' : !batchMessages[i]?.trim() ? '请先填写提交说明' : '提交此分组'"
              @click="$emit('commit-batch-group', i, batchMessages[i] || '')"
            >
              {{ batchCommittingIndex === i ? "提交中…" : "提交" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { BatchGroup } from "../../composables/useGitPanel";
import { gitStatusIcon, gitStatusClass, splitGitFilePath } from "../../utils/gitHelpers";
import { useGitPanelBatchUi } from "../../composables/useGitPanelBatchUi";
import { computed, toRef } from "vue";

const props = defineProps<{
  batchGroups?: BatchGroup[];
  batchGroupsFromAi?: boolean;
  batchMessages: string[];
  batchSectionOpen: boolean;
  batchCommittingIndex: number | null;
  aiBatchGrouping: boolean;
  aiBatchGroupingStep: string;
  configReady: boolean;
}>();

const emit = defineEmits<{
  (e: "update:batchSectionOpen", open: boolean): void;
  (e: "update:batchMessages", messages: string[]): void;
  (e: "ai-batch-groups"): void;
  (e: "commit-all-batches", messages: string[]): void;
  (e: "commit-batch-group", index: number, message: string): void;
}>();

const batchUi = useGitPanelBatchUi(
  computed(() => props.batchGroups),
  computed(() => props.batchGroupsFromAi),
  toRef(props, "batchMessages"),
  toRef(props, "batchCommittingIndex"),
  (messages) => emit("update:batchMessages", messages),
);

const {
  BATCH_FILES_PREVIEW: batchFilesPreview,
  batchTotalFiles,
  batchReadyCount,
  canCommitAllBatches,
  batchGroupTitle,
  batchGroupAccent,
  isBatchGroupExpanded,
  toggleBatchGroupFiles,
  visibleBatchFiles,
  onBatchMessageInput,
} = batchUi;

const unassignedGroupNames = new Set(["其他未分组变更", "正在分析其余变更"]);
const isUnassignedGroup = (group: BatchGroup) => unassignedGroupNames.has(group.dir);
const ungroupedFileCount = computed(() =>
  (props.batchGroups || [])
    .filter(isUnassignedGroup)
    .reduce((sum, group) => sum + group.files.length, 0),
);
</script>

<style src="./styles/GitPanel.scss" scoped></style>
