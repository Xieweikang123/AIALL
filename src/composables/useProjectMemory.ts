import { ref, watch, type Ref } from "vue";
import {
  appendProjectMemoryEntries,
  fetchProjectMemory,
  saveProjectMemory as persistProjectMemory,
} from "../services/vibeProjectMemoryClient";
import {
  archiveExplorationSnapshot,
  upsertProjectSkill,
} from "../services/vibeProjectSkillsClient";
import {
  groupCheckedCandidatesBySection,
  type ExplorationMemoryCandidate,
} from "../services/explorationMemorySuggest";
import type {
  ExplorationArchiveDraft,
  ExplorationDistillResult,
  SkillDistillProposal,
} from "../services/explorationDistill";
import type { MemoryProposalPayload, PendingMemoryProposal } from "../services/projectMemoryProposal";
import type { PendingSkillProposal, SkillProposalPayload } from "../services/projectSkillProposal";
import { genId } from "../utils/vibeHelpers";

export function useProjectMemory(projectPath: Ref<string>, projectOpened: Ref<boolean>) {
  const projectMemoryOpen = ref(false);
  const projectMemoryContent = ref("");
  const projectMemoryDraft = ref("");
  const projectMemoryLoading = ref(false);
  const projectMemorySaving = ref(false);
  const projectMemoryMessage = ref("");
  const projectMemoryMaxChars = ref(3500);

  const projectMemoryHasContent = ref(false);

  const memorySuggestOpen = ref(false);
  const memorySuggestSaving = ref(false);
  const memorySuggestMessage = ref("");
  const memorySuggestCandidates = ref<ExplorationMemoryCandidate[]>([]);
  const memorySuggestArchive = ref<(ExplorationArchiveDraft & { checked: boolean }) | null>(null);
  const memorySuggestSkillProposals = ref<SkillDistillProposal[]>([]);
  const pendingMemoryProposals = ref<PendingMemoryProposal[]>([]);
  const pendingSkillProposals = ref<PendingSkillProposal[]>([]);

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
    memorySuggestOpen.value = false;
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

  function openExplorationDistillSuggest(result: ExplorationDistillResult) {
    if (!result.offer) return;
    const hasMemory = result.memoryCandidates.length > 0;
    const hasArchive = Boolean(result.archive);
    const hasSkills = result.skillProposals.length > 0;
    if (!hasMemory && !hasArchive && !hasSkills) return;

    memorySuggestCandidates.value = result.memoryCandidates.map((item) => ({ ...item }));
    memorySuggestArchive.value = result.archive ? { ...result.archive, checked: false } : null;
    memorySuggestSkillProposals.value = result.skillProposals.map((item) => ({ ...item }));
    memorySuggestMessage.value = "";
    memorySuggestOpen.value = true;
    projectMemoryOpen.value = false;
  }

  function closeMemorySuggest() {
    memorySuggestOpen.value = false;
    memorySuggestMessage.value = "";
    memorySuggestCandidates.value = [];
    memorySuggestArchive.value = null;
    memorySuggestSkillProposals.value = [];
  }

  function toggleMemorySuggestCandidate(id: string, checked: boolean) {
    memorySuggestCandidates.value = memorySuggestCandidates.value.map((item) =>
      item.id === id ? { ...item, checked } : item,
    );
  }

  function toggleMemorySuggestArchive(checked: boolean) {
    if (!memorySuggestArchive.value) return;
    memorySuggestArchive.value = { ...memorySuggestArchive.value, checked };
  }

  function toggleMemorySuggestSkill(id: string, checked: boolean) {
    memorySuggestSkillProposals.value = memorySuggestSkillProposals.value.map((item) =>
      item.id === id ? { ...item, checked } : item,
    );
  }

  async function applyMemorySuggest() {
    const path = projectPath.value.trim();
    if (!path || memorySuggestSaving.value) return;

    const grouped = groupCheckedCandidatesBySection(memorySuggestCandidates.value);
    const memorySections = Object.keys(grouped) as Array<keyof typeof grouped>;
    const archive = memorySuggestArchive.value?.checked ? memorySuggestArchive.value : null;
    const skills = memorySuggestSkillProposals.value.filter((item) => item.checked);

    if (!memorySections.length && !archive && !skills.length) {
      memorySuggestMessage.value = "请至少勾选一项";
      return;
    }

    memorySuggestSaving.value = true;
    memorySuggestMessage.value = "";
    try {
      for (const section of memorySections) {
        const lines = grouped[section];
        if (!lines?.length) continue;
        const result = await appendProjectMemoryEntries(path, section, lines);
        if (!result.ok) {
          memorySuggestMessage.value = result.error || "写入记忆失败";
          return;
        }
        if (result.content !== undefined) {
          projectMemoryContent.value = result.content;
          projectMemoryHasContent.value = Boolean(projectMemoryContent.value.trim());
        }
      }

      if (archive) {
        const archiveResult = await archiveExplorationSnapshot(path, {
          filename: archive.filename,
          content: archive.content,
          readCount: archive.readPaths.length,
          writtenCount: archive.writtenPaths.length,
        });
        if (!archiveResult.ok) {
          memorySuggestMessage.value = archiveResult.error || "归档探索快照失败";
          return;
        }
      }

      for (const skill of skills) {
        const skillResult = await upsertProjectSkill(path, {
          slug: skill.slug,
          kind: skill.kind,
          title: skill.title,
          content: skill.content,
        });
        if (!skillResult.ok) {
          memorySuggestMessage.value = skillResult.error || "写入 skill 失败";
          return;
        }
      }

      memorySuggestMessage.value = "已保存所选内容";
      closeMemorySuggest();
    } finally {
      memorySuggestSaving.value = false;
    }
  }

  function addPendingMemoryProposal(proposal: MemoryProposalPayload) {
    pendingMemoryProposals.value = [
      ...pendingMemoryProposals.value.filter(
        (item) => !(item.section === proposal.section && item.content === proposal.content),
      ),
      { ...proposal, id: genId(), applied: false },
    ];
    memorySuggestOpen.value = false;
  }

  function addPendingSkillProposal(proposal: SkillProposalPayload) {
    pendingSkillProposals.value = [
      ...pendingSkillProposals.value.filter(
        (item) => !(item.slug === proposal.slug && item.content === proposal.content),
      ),
      { ...proposal, id: genId(), applied: false },
    ];
    memorySuggestOpen.value = false;
  }

  async function confirmPendingMemoryProposal(id: string) {
    const path = projectPath.value.trim();
    const item = pendingMemoryProposals.value.find((p) => p.id === id);
    if (!path || !item || item.applied) return;

    memorySuggestSaving.value = true;
    memorySuggestMessage.value = "";
    try {
      const result = await appendProjectMemoryEntries(path, item.section, [item.content]);
      if (!result.ok) {
        memorySuggestMessage.value = result.error || "写入失败";
        return;
      }
      if (result.content !== undefined) {
        projectMemoryContent.value = result.content;
        projectMemoryHasContent.value = Boolean(projectMemoryContent.value.trim());
      }
      pendingMemoryProposals.value = pendingMemoryProposals.value.filter((p) => p.id !== id);
    } finally {
      memorySuggestSaving.value = false;
    }
  }

  async function confirmPendingSkillProposal(id: string) {
    const path = projectPath.value.trim();
    const item = pendingSkillProposals.value.find((p) => p.id === id);
    if (!path || !item || item.applied) return;

    memorySuggestSaving.value = true;
    memorySuggestMessage.value = "";
    try {
      const result = await upsertProjectSkill(path, {
        slug: item.slug,
        kind: item.kind,
        title: item.title,
        content: item.content,
      });
      if (!result.ok) {
        memorySuggestMessage.value = result.error || "写入 skill 失败";
        return;
      }
      pendingSkillProposals.value = pendingSkillProposals.value.filter((p) => p.id !== id);
    } finally {
      memorySuggestSaving.value = false;
    }
  }

  function dismissPendingMemoryProposal(id: string) {
    pendingMemoryProposals.value = pendingMemoryProposals.value.filter((p) => p.id !== id);
  }

  function dismissPendingSkillProposal(id: string) {
    pendingSkillProposals.value = pendingSkillProposals.value.filter((p) => p.id !== id);
  }

  watch(
    () => [projectPath.value, projectOpened.value] as const,
    ([path, opened]) => {
      projectMemoryContent.value = "";
      projectMemoryDraft.value = "";
      projectMemoryHasContent.value = false;
      projectMemoryOpen.value = false;
      projectMemoryMessage.value = "";
      closeMemorySuggest();
      pendingMemoryProposals.value = [];
      pendingSkillProposals.value = [];
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
    memorySuggestOpen,
    memorySuggestSaving,
    memorySuggestMessage,
    memorySuggestCandidates,
    memorySuggestArchive,
    memorySuggestSkillProposals,
    pendingMemoryProposals,
    pendingSkillProposals,
    loadProjectMemory,
    openProjectMemoryEditor,
    closeProjectMemoryEditor,
    saveProjectMemoryDraft,
    openExplorationDistillSuggest,
    closeMemorySuggest,
    toggleMemorySuggestCandidate,
    toggleMemorySuggestArchive,
    toggleMemorySuggestSkill,
    applyMemorySuggest,
    addPendingMemoryProposal,
    addPendingSkillProposal,
    confirmPendingMemoryProposal,
    confirmPendingSkillProposal,
    dismissPendingMemoryProposal,
    dismissPendingSkillProposal,
  };
}
