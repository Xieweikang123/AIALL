import { computed, nextTick, onBeforeUnmount, ref, type Ref } from "vue";
import type { TreeNode } from "../components/FileTreeNode.vue";
import { searchFiles } from "../services/vibeCodingClient";
import { fileName } from "../utils/vibeHelpers";
import { ESCAPE_DISMISS_PRIORITY, registerEscapeDismiss } from "./useEscapeDismiss";

export interface MentionFileItem {
  name: string;
  path: string;
  relative: string;
}

export type UseChatMentionOptions = {
  projectPath: Ref<string>;
  projectOpened: Ref<boolean>;
  fileTree: Ref<TreeNode[]>;
  insertFileRef: (item: MentionFileItem) => void;
  focusComposer: () => void;
};

function collectProjectFiles(nodes: TreeNode[], base: string): MentionFileItem[] {
  const items: MentionFileItem[] = [];
  const root = base.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();

  function walk(list: TreeNode[]) {
    for (const node of list) {
      if (node.isDirectory) {
        if (node.children?.length) walk(node.children);
        continue;
      }
      const full = node.path.replace(/\\/g, "/");
      const relative = full.toLowerCase().startsWith(`${root}/`)
        ? full.slice(root.length + 1)
        : fileName(full);
      items.push({ name: node.name, path: node.path, relative });
    }
  }

  walk(nodes);
  return items;
}

export function useChatMention(options: UseChatMentionOptions) {
  const mentionOpen = ref(false);
  const mentionQuery = ref("");
  const mentionActiveIndex = ref(0);
  const mentionRemoteResults = ref<MentionFileItem[]>([]);
  let mentionSearchTimer: ReturnType<typeof setTimeout> | null = null;

  const allProjectFiles = computed(() =>
    collectProjectFiles(options.fileTree.value, options.projectPath.value),
  );

  const mentionResults = computed(() => {
    if (!mentionOpen.value || !options.projectOpened.value) return [];
    const q = mentionQuery.value.trim().toLowerCase();
    if (q && mentionRemoteResults.value.length) {
      return mentionRemoteResults.value.slice(0, 12);
    }
    return allProjectFiles.value
      .filter((item) => {
        if (!q) return true;
        return item.relative.toLowerCase().includes(q) || item.name.toLowerCase().includes(q);
      })
      .slice(0, 12);
  });

  async function refreshMentionRemoteResults(query: string) {
    if (!options.projectPath.value.trim()) {
      mentionRemoteResults.value = [];
      return;
    }
    const result = await searchFiles(options.projectPath.value.trim(), query);
    if (!result.ok) {
      mentionRemoteResults.value = [];
      return;
    }
    const root = options.projectPath.value.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
    mentionRemoteResults.value = result.results
      .filter((item) => !item.isDirectory)
      .map((item) => {
        const full = item.path.replace(/\\/g, "/");
        const relative = full.toLowerCase().startsWith(`${root}/`)
          ? full.slice(root.length + 1)
          : item.name;
        return { name: item.name, path: item.path, relative };
      });
  }

  function scheduleMentionSearch() {
    if (mentionSearchTimer) clearTimeout(mentionSearchTimer);
    const q = mentionQuery.value.trim();
    if (!q) {
      mentionRemoteResults.value = [];
      return;
    }
    mentionSearchTimer = setTimeout(() => {
      mentionSearchTimer = null;
      void refreshMentionRemoteResults(q);
    }, 200);
  }

  function onComposerMentionChange(payload: { open: boolean; query: string }) {
    mentionOpen.value = payload.open;
    mentionQuery.value = payload.query;
    if (payload.open) {
      mentionActiveIndex.value = 0;
      scheduleMentionSearch();
      return;
    }
    mentionRemoteResults.value = [];
  }

  function selectMention(item: MentionFileItem) {
    options.insertFileRef(item);
    mentionOpen.value = false;
    mentionQuery.value = "";
    void nextTick(() => options.focusComposer());
  }

  function onComposerFieldKeydown(e: KeyboardEvent) {
    if (!mentionOpen.value || !mentionResults.value.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      mentionActiveIndex.value = (mentionActiveIndex.value + 1) % mentionResults.value.length;
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      mentionActiveIndex.value =
        (mentionActiveIndex.value - 1 + mentionResults.value.length) % mentionResults.value.length;
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      const item = mentionResults.value[mentionActiveIndex.value];
      if (item) selectMention(item);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      mentionOpen.value = false;
    }
  }

  function disposeMentionSearch() {
    if (mentionSearchTimer) {
      clearTimeout(mentionSearchTimer);
      mentionSearchTimer = null;
    }
  }

  registerEscapeDismiss(
    mentionOpen,
    () => {
      mentionOpen.value = false;
    },
    ESCAPE_DISMISS_PRIORITY.MENTION,
  );

  onBeforeUnmount(() => {
    disposeMentionSearch();
  });

  return {
    mentionOpen,
    mentionQuery,
    mentionActiveIndex,
    mentionResults,
    onComposerMentionChange,
    onComposerFieldKeydown,
    selectMention,
    disposeMentionSearch,
  };
}
