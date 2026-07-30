import { ref, computed, watch, type Ref } from "vue";
import type { BatchGroup } from "./git/types";

const BATCH_FILES_PREVIEW = 4;
const BATCH_GROUP_ACCENTS = ["#58a6ff", "#3fb950", "#d29922", "#bc8cff", "#f778ba", "#79c0ff"];

export function useGitPanelBatchUi(
  batchGroups: Ref<BatchGroup[] | undefined>,
  batchGroupsFromAi: Ref<boolean | undefined>,
  batchMessages: Ref<string[]>,
  batchCommittingIndex: Ref<number | null>,
  onUpdateBatchMessages: (messages: string[]) => void,
) {
  const expandedBatchGroups = ref<Set<number>>(new Set());

  const batchTotalFiles = computed(() =>
    (batchGroups.value ?? []).reduce((sum, g) => sum + g.files.length, 0),
  );

  const batchReadyCount = computed(() =>
    batchMessages.value.filter((m) => m?.trim()).length,
  );

  const canCommitAllBatches = computed(() => {
    const n = batchGroups.value?.length ?? 0;
    if (!n || batchCommittingIndex.value !== null) return false;
    return batchMessages.value.length === n && batchMessages.value.every((m) => m?.trim());
  });

  function batchGroupTitle(group: BatchGroup): string {
    return batchGroupsFromAi.value ? group.dir : `${group.dir}/`;
  }

  function batchGroupAccent(index: number): string {
    return BATCH_GROUP_ACCENTS[index % BATCH_GROUP_ACCENTS.length];
  }

  function isBatchGroupExpanded(index: number): boolean {
    return expandedBatchGroups.value.has(index);
  }

  function toggleBatchGroupFiles(index: number) {
    const next = new Set(expandedBatchGroups.value);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    expandedBatchGroups.value = next;
  }

  function visibleBatchFiles(group: BatchGroup, index: number) {
    if (isBatchGroupExpanded(index) || group.files.length <= BATCH_FILES_PREVIEW) {
      return group.files;
    }
    return group.files.slice(0, BATCH_FILES_PREVIEW);
  }

  function onBatchMessageInput(index: number, value: string) {
    const next = [...batchMessages.value];
    next[index] = value;
    onUpdateBatchMessages(next);
  }

  watch(
    () => batchGroups.value?.map((g) => `${g.dir}:${g.files.length}`).join("|"),
    () => {
      expandedBatchGroups.value = new Set();
    },
  );

  return {
    BATCH_FILES_PREVIEW,
    batchTotalFiles,
    batchReadyCount,
    canCommitAllBatches,
    batchGroupTitle,
    batchGroupAccent,
    isBatchGroupExpanded,
    toggleBatchGroupFiles,
    visibleBatchFiles,
    onBatchMessageInput,
  };
}
