import { ref, watch, type Ref } from "vue";
import {
  fetchProjectMemory,
  saveProjectMemory as persistProjectMemory,
} from "../services/vibeProjectMemoryClient";

export function useProjectMemory(projectPath: Ref<string>, projectOpened: Ref<boolean>) {
  const projectMemoryOpen = ref(false);
  const projectMemoryContent = ref("");
  const projectMemoryDraft = ref("");
  const projectMemoryLoading = ref(false);
  const projectMemorySaving = ref(false);
  const projectMemoryMessage = ref("");
  const projectMemoryMaxChars = ref(3500);

  const projectMemoryHasContent = ref(false);

  async function loadProjectMemory() {
    const path = projectPath.value.trim();
    if (!path || !projectOpened.value) return;
    projectMemoryLoading.value = true;
    projectMemoryMessage.value = "";
    try {
      const result = await fetchProjectMemory(path);
      if (!result.ok) {
        projectMemoryMessage.value = result.error || "读取失败";
        return;
      }
      projectMemoryContent.value = result.content ?? "";
      projectMemoryHasContent.value = Boolean(projectMemoryContent.value.trim());
      if (typeof result.maxChars === "number" && result.maxChars > 0) {
        projectMemoryMaxChars.value = result.maxChars;
      }
    } finally {
      projectMemoryLoading.value = false;
    }
  }

  async function openProjectMemoryEditor() {
    if (!projectOpened.value || projectPath.value.trim() === "") return;
    projectMemoryOpen.value = true;
    projectMemoryMessage.value = "";
    await loadProjectMemory();
    projectMemoryDraft.value = projectMemoryContent.value;
  }

  function closeProjectMemoryEditor() {
    projectMemoryOpen.value = false;
    projectMemoryMessage.value = "";
  }

  async function saveProjectMemoryDraft() {
    const path = projectPath.value.trim();
    if (!path || projectMemorySaving.value) return;
    projectMemorySaving.value = true;
    projectMemoryMessage.value = "";
    try {
      const result = await persistProjectMemory(path, projectMemoryDraft.value);
      if (!result.ok) {
        projectMemoryMessage.value = result.error || "保存失败";
        return;
      }
      projectMemoryContent.value = projectMemoryDraft.value.trim();
      projectMemoryHasContent.value = Boolean(projectMemoryContent.value);
      if (result.truncated) {
        projectMemoryMessage.value = "已保存（内容超出上限，注入 Agent 时会截断）";
      } else {
        projectMemoryMessage.value = "已保存";
      }
    } finally {
      projectMemorySaving.value = false;
    }
  }

  watch(
    () => [projectPath.value, projectOpened.value] as const,
    ([path, opened]) => {
      projectMemoryContent.value = "";
      projectMemoryDraft.value = "";
      projectMemoryHasContent.value = false;
      projectMemoryOpen.value = false;
      projectMemoryMessage.value = "";
      if (opened && path.trim()) {
        void loadProjectMemory();
      }
    },
  );

  return {
    projectMemoryOpen,
    projectMemoryContent,
    projectMemoryDraft,
    projectMemoryLoading,
    projectMemorySaving,
    projectMemoryMessage,
    projectMemoryMaxChars,
    projectMemoryHasContent,
    loadProjectMemory,
    openProjectMemoryEditor,
    closeProjectMemoryEditor,
    saveProjectMemoryDraft,
  };
}
