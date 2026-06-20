import { ref, watch, type Ref } from "vue";
import {
  appendProjectMemoryEntries,
  fetchProjectMemory,
  saveProjectMemory as persistProjectMemory,
} from "../services/vibeProjectMemoryClient";
import {
  archiveExplorationSnapshot,
  fetchProjectSkill,
  fetchProjectSkills,
  upsertProjectSkill,
} from "../services/vibeProjectSkillsClient";
import { readFile } from "../services/vibeCodingClient";
import { groupCheckedCandidatesBySection } from "../services/explorationMemorySuggest";
import type { ExplorationDistillResult } from "../services/explorationDistill";
import type { ExplorationIndexEntry, SkillIndexEntry, SkillKind } from "../services/projectSkills";
import type { MemoryProposalPayload, PendingMemoryProposal } from "../services/projectMemoryProposal";
import type { PendingSkillProposal, SkillProposalPayload } from "../services/projectSkillProposal";
import { genId } from "../utils/vibeHelpers";

export type ProjectMemoryTab = "memory" | "skills" | "exploration";

export function useProjectMemory(projectPath: Ref<string>, projectOpened: Ref<boolean>) {
  const projectMemoryOpen = ref(false);
  const projectMemoryTab = ref<ProjectMemoryTab>("memory");
  const projectMemoryContent = ref("");
  const projectMemoryDraft = ref("");
  const projectMemoryLoading = ref(false);
  const projectMemorySaving = ref(false);
  const projectMemoryMessage = ref("");
  const projectMemoryMaxChars = ref(3500);

  const projectMemoryHasContent = ref(false);

  const projectSkillsList = ref<SkillIndexEntry[]>([]);
  const projectExplorationList = ref<ExplorationIndexEntry[]>([]);
  const projectSkillsLoading = ref(false);
  const selectedSkillSlug = ref("");
  const skillDraftTitle = ref("");
  const skillDraftKind = ref<SkillKind>("heuristic");
  const skillDraftBody = ref("");
  const skillDetailLoading = ref(false);
  const skillSaving = ref(false);
  const selectedExplorationId = ref("");
  const explorationContent = ref("");
  const explorationDetailLoading = ref(false);

  const memorySuggestSaving = ref(false);
  const pendingMemoryProposals = ref<PendingMemoryProposal[]>([]);
  const pendingSkillProposals = ref<PendingSkillProposal[]>([]);

  function resetSkillDetail() {
    selectedSkillSlug.value = "";
    skillDraftTitle.value = "";
    skillDraftKind.value = "heuristic";
    skillDraftBody.value = "";
  }

  function resetExplorationDetail() {
    selectedExplorationId.value = "";
    explorationContent.value = "";
  }

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

  async function loadProjectSkillsIndex() {
    const path = projectPath.value.trim();
    if (!path || !projectOpened.value) return;
    projectSkillsLoading.value = true;
    try {
      const result = await fetchProjectSkills(path);
      if (!result.ok) {
        projectMemoryMessage.value = result.error || "读取 Skills 失败";
        return;
      }
      projectSkillsList.value = result.skills ?? [];
      projectExplorationList.value = result.exploration ?? [];
    } finally {
      projectSkillsLoading.value = false;
    }
  }

  async function openProjectMemoryEditor() {
    if (!projectOpened.value || projectPath.value.trim() === "") return;
    projectMemoryOpen.value = true;
    projectMemoryTab.value = "memory";
    projectMemoryMessage.value = "";
    resetSkillDetail();
    resetExplorationDetail();
    await Promise.all([loadProjectMemory(), loadProjectSkillsIndex()]);
    projectMemoryDraft.value = projectMemoryContent.value;
  }

  function closeProjectMemoryEditor() {
    projectMemoryOpen.value = false;
    projectMemoryMessage.value = "";
    projectMemoryTab.value = "memory";
    resetSkillDetail();
    resetExplorationDetail();
  }

  function setProjectMemoryTab(tab: ProjectMemoryTab) {
    projectMemoryTab.value = tab;
    projectMemoryMessage.value = "";
  }

  async function selectProjectSkill(slug: string) {
    const path = projectPath.value.trim();
    if (!path || !slug || skillDetailLoading.value) return;
    selectedSkillSlug.value = slug;
    skillDetailLoading.value = true;
    projectMemoryMessage.value = "";
    try {
      const result = await fetchProjectSkill(path, slug);
      if (!result.ok) {
        projectMemoryMessage.value = result.error || "读取 skill 失败";
        return;
      }
      skillDraftTitle.value = result.frontmatter?.title ?? slug;
      skillDraftKind.value = (result.frontmatter?.kind as SkillKind) ?? "heuristic";
      skillDraftBody.value = result.body ?? "";
    } finally {
      skillDetailLoading.value = false;
    }
  }

  async function selectProjectExploration(id: string) {
    const path = projectPath.value.trim();
    const entry = projectExplorationList.value.find((item) => item.id === id);
    if (!path || !entry || explorationDetailLoading.value) return;
    selectedExplorationId.value = id;
    explorationDetailLoading.value = true;
    projectMemoryMessage.value = "";
    try {
      const result = await readFile(entry.path, path);
      if (!result.ok) {
        projectMemoryMessage.value = result.error || "读取探索快照失败";
        return;
      }
      explorationContent.value = result.content ?? "";
    } finally {
      explorationDetailLoading.value = false;
    }
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

  async function saveProjectSkillDraft() {
    const path = projectPath.value.trim();
    const slug = selectedSkillSlug.value.trim();
    if (!path || !slug || skillSaving.value) return;
    skillSaving.value = true;
    projectMemoryMessage.value = "";
    try {
      const result = await upsertProjectSkill(path, {
        slug,
        kind: skillDraftKind.value,
        title: skillDraftTitle.value.trim() || slug,
        content: skillDraftBody.value,
      });
      if (!result.ok) {
        projectMemoryMessage.value = result.error || "保存 skill 失败";
        return;
      }
      projectMemoryMessage.value = "Skill 已保存";
      await loadProjectSkillsIndex();
    } finally {
      skillSaving.value = false;
    }
  }

  async function applyExplorationDistillSilently(result: ExplorationDistillResult) {
    if (!result.offer) return;

    const grouped = groupCheckedCandidatesBySection(
      result.memoryCandidates.map((item) => ({ ...item, checked: true })),
    );
    const memorySections = Object.keys(grouped) as Array<keyof typeof grouped>;

    if (!memorySections.length && !result.archive && !result.skillProposals.length) return;

    const path = projectPath.value.trim();
    if (!path || memorySuggestSaving.value) return;

    memorySuggestSaving.value = true;
    try {
      for (const section of memorySections) {
        const lines = grouped[section];
        if (!lines?.length) continue;
        const appendResult = await appendProjectMemoryEntries(path, section, lines);
        if (!appendResult.ok) return;
        if (appendResult.content !== undefined) {
          projectMemoryContent.value = appendResult.content;
          projectMemoryHasContent.value = Boolean(projectMemoryContent.value.trim());
        }
      }

      if (result.archive) {
        const archiveResult = await archiveExplorationSnapshot(path, {
          filename: result.archive.filename,
          content: result.archive.content,
          readCount: result.archive.readPaths.length,
          writtenCount: result.archive.writtenPaths.length,
        });
        if (!archiveResult.ok) return;
      }

      for (const skill of result.skillProposals) {
        const skillResult = await upsertProjectSkill(path, {
          slug: skill.slug,
          kind: skill.kind,
          title: skill.title,
          content: skill.content,
        });
        if (!skillResult.ok) return;
      }

      if (projectMemoryOpen.value) {
        await loadProjectSkillsIndex();
      }
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
  }

  function addPendingSkillProposal(proposal: SkillProposalPayload) {
    pendingSkillProposals.value = [
      ...pendingSkillProposals.value.filter(
        (item) => !(item.slug === proposal.slug && item.content === proposal.content),
      ),
      { ...proposal, id: genId(), applied: false },
    ];
  }

  async function confirmPendingMemoryProposal(id: string) {
    const path = projectPath.value.trim();
    const item = pendingMemoryProposals.value.find((p) => p.id === id);
    if (!path || !item || item.applied) return;

    memorySuggestSaving.value = true;
    try {
      const result = await appendProjectMemoryEntries(path, item.section, [item.content]);
      if (!result.ok) return;
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
    try {
      const result = await upsertProjectSkill(path, {
        slug: item.slug,
        kind: item.kind,
        title: item.title,
        content: item.content,
      });
      if (!result.ok) return;
      pendingSkillProposals.value = pendingSkillProposals.value.filter((p) => p.id !== id);
      if (projectMemoryOpen.value) {
        await loadProjectSkillsIndex();
      }
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

  async function trackMemoryUsageAfterRun(assistantResponse: string) {
    const path = projectPath.value.trim();
    if (!path || !projectMemoryContent.value.trim()) return;
    try {
      const { backendUrl } = await import("../services/backendBase");
      await fetch(backendUrl("/backend/vibe/memory-usage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectPath: path,
          memoryContent: projectMemoryContent.value,
          assistantResponse,
        }),
      });
    } catch {
      // silent
    }
  }

  watch(
    () => [projectPath.value, projectOpened.value] as const,
    ([path, opened]) => {
      projectMemoryContent.value = "";
      projectMemoryDraft.value = "";
      projectMemoryHasContent.value = false;
      projectMemoryOpen.value = false;
      projectMemoryTab.value = "memory";
      projectMemoryMessage.value = "";
      projectSkillsList.value = [];
      projectExplorationList.value = [];
      resetSkillDetail();
      resetExplorationDetail();
      pendingMemoryProposals.value = [];
      pendingSkillProposals.value = [];
      if (opened && path.trim()) {
        void loadProjectMemory();
      }
    },
  );

  return {
    projectMemoryOpen,
    projectMemoryTab,
    projectMemoryContent,
    projectMemoryDraft,
    projectMemoryLoading,
    projectMemorySaving,
    projectMemoryMessage,
    projectMemoryMaxChars,
    projectMemoryHasContent,
    projectSkillsList,
    projectExplorationList,
    projectSkillsLoading,
    selectedSkillSlug,
    skillDraftTitle,
    skillDraftKind,
    skillDraftBody,
    skillDetailLoading,
    skillSaving,
    selectedExplorationId,
    explorationContent,
    explorationDetailLoading,
    memorySuggestSaving,
    pendingMemoryProposals,
    pendingSkillProposals,
    loadProjectMemory,
    loadProjectSkillsIndex,
    openProjectMemoryEditor,
    closeProjectMemoryEditor,
    setProjectMemoryTab,
    selectProjectSkill,
    selectProjectExploration,
    saveProjectMemoryDraft,
    saveProjectSkillDraft,
    applyExplorationDistillSilently,
    addPendingMemoryProposal,
    addPendingSkillProposal,
    confirmPendingMemoryProposal,
    confirmPendingSkillProposal,
    dismissPendingMemoryProposal,
    dismissPendingSkillProposal,
    trackMemoryUsageAfterRun,
  };
}
