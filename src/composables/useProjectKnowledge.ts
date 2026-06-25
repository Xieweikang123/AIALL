import { computed, ref, type ComputedRef, type Ref, watch } from "vue";
import {
  EXPLORE_CONTINUE_PRESET_PROMPT,
  EXPLORE_DEPTH_MAX_TURNS,
  EXPLORE_FOLLOWUP_MAX_TURNS,
  EXPLORE_PROJECT_PRESET_PROMPT,
  buildExploreChangedFilesPrompt,
  type ExploreDepth,
  resolveExploreRequestMaxTurns,
} from "../services/agentExplore";
import {
  classifyExploreKnowledgeIntent,
  type ExploreKnowledgeIntent,
} from "../services/knowledgeExplore";
import { filterKnowledgeChangePaths } from "../services/knowledgeGitChanges";
import { fetchGitChangedSince } from "../services/vibeGitClient";
import { loadWebProxyUrlFromStorage } from "../services/aiLocalConfig";
import {
  resolveKnowledgeBodyForSave,
  stripKnowledgeFrontmatter,
} from "../services/projectReportDisplay";
import {
  fetchProjectKnowledge,
  saveProjectKnowledge,
  type ProjectKnowledgeMeta,
} from "../services/vibeProjectKnowledgeClient";
import { runVibeAgentSse, type VibeAgentSseEvent } from "../services/vibeAgentClient";
import { stripTextToolCallMarkup } from "../services/textToolCallMarkup";

export type KnowledgeExploreTool = {
  id: string;
  name: string;
  ok?: boolean;
  summary?: string;
};

export type KnowledgeExploreRunState = {
  running: boolean;
  assistantText: string;
  statusDetail: string;
  turn: number;
  maxTurns: number;
  tools: KnowledgeExploreTool[];
  aborted: boolean;
  failed: boolean;
  error: string;
  intent: ExploreKnowledgeIntent;
};

function emptyRunState(): KnowledgeExploreRunState {
  return {
    running: false,
    assistantText: "",
    statusDetail: "",
    turn: 0,
    maxTurns: 0,
    tools: [],
    aborted: false,
    failed: false,
    error: "",
    intent: "initial",
  };
}

type AiConfig = {
  endpoint: string;
  apiKey: string;
  model: string;
};

type ActiveExploreContext = {
  projectPath: string;
  priorBody: string;
  gitHead?: string;
  baseExploreRounds: number;
  intent: ExploreKnowledgeIntent;
};

function normalizeProjectPath(p: string): string {
  return p.trim().replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
}

export function useProjectKnowledge(options: {
  projectPath: Ref<string>;
  projectOpened: Ref<boolean> | ComputedRef<boolean>;
  configReady: Ref<boolean> | ComputedRef<boolean>;
  apiKeyReady?: Ref<boolean> | ComputedRef<boolean>;
  aiConfig: Ref<AiConfig>;
  gitHead?: Ref<string> | ComputedRef<string>;
}) {
  const knowledgeBody = ref("");
  const knowledgeDraft = ref("");
  const knowledgeMeta = ref<ProjectKnowledgeMeta>({});
  const knowledgeLoading = ref(false);
  const knowledgeSaving = ref(false);
  const knowledgeMessage = ref("");
  const editing = ref(false);
  const knowledgeChangedFiles = ref<string[]>([]);
  const knowledgeChangesLoading = ref(false);

  const exploreRun = ref<KnowledgeExploreRunState>(emptyRunState());
  let abortHandle: { abort: () => void } | null = null;
  let completedTurns = 0;
  let finalizeInFlight: Promise<void> | null = null;
  let lastExploreIntent: ExploreKnowledgeIntent = "initial";
  let activeExploreContext: ActiveExploreContext | null = null;

  function isCurrentProject(path: string): boolean {
    return normalizeProjectPath(path) === normalizeProjectPath(options.projectPath.value);
  }

  const hasKnowledge = computed(() => Boolean(knowledgeBody.value.trim()));
  const knowledgeChangesAvailable = computed(() => {
    const saved = knowledgeMeta.value.gitHead?.trim();
    const current = options.gitHead?.value?.trim();
    if (!saved || !hasKnowledge.value) return false;
    if (current && saved !== current) return true;
    return knowledgeChangedFiles.value.length > 0;
  });

  /** Stream preview uses raw model output; merge runs once in finalizeExploreRun. */
  const displayBody = computed(() => {
    if (editing.value) return knowledgeDraft.value;
    if (exploreRun.value.running && exploreRun.value.assistantText.trim()) {
      return exploreRun.value.assistantText;
    }
    return knowledgeBody.value;
  });

  async function loadKnowledge(loadOptions?: { force?: boolean }) {
    const path = options.projectPath.value.trim();
    if (!path || !options.projectOpened.value) return;
    if (exploreRun.value.running && !loadOptions?.force) return;
    if (editing.value && !loadOptions?.force) return;
    knowledgeLoading.value = true;
    if (!loadOptions?.force) knowledgeMessage.value = "";
    try {
      const result = await fetchProjectKnowledge(path);
      if (!result.ok) {
        knowledgeMessage.value = result.error || "读取失败";
        return;
      }
      knowledgeBody.value = result.body ?? stripKnowledgeFrontmatter(result.content ?? "");
      knowledgeDraft.value = knowledgeBody.value;
      knowledgeMeta.value = result.meta ?? {};
      void loadKnowledgeChangedFiles();
    } finally {
      knowledgeLoading.value = false;
    }
  }

  async function loadKnowledgeChangedFiles() {
    const path = options.projectPath.value.trim();
    const since = knowledgeMeta.value.gitHead?.trim();
    if (!path || !since || !options.projectOpened.value || !hasKnowledge.value) {
      knowledgeChangedFiles.value = [];
      return;
    }
    knowledgeChangesLoading.value = true;
    try {
      const result = await fetchGitChangedSince(path, since);
      knowledgeChangedFiles.value = result.ok
        ? filterKnowledgeChangePaths(result.files)
        : [];
    } finally {
      knowledgeChangesLoading.value = false;
    }
  }

  async function saveKnowledgeDraft() {
    const path = options.projectPath.value.trim();
    if (!path) return false;
    knowledgeSaving.value = true;
    knowledgeMessage.value = "";
    try {
      const result = await saveProjectKnowledge(path, knowledgeDraft.value.trim(), {
        gitHead: options.gitHead?.value?.trim() || knowledgeMeta.value.gitHead,
      });
      if (!result.ok) {
        knowledgeMessage.value = result.error || "保存失败";
        return false;
      }
      knowledgeBody.value = result.body ?? knowledgeDraft.value.trim();
      knowledgeMeta.value = result.meta ?? {};
      editing.value = false;
      knowledgeMessage.value = "已保存";
      return true;
    } finally {
      knowledgeSaving.value = false;
    }
  }

  function beginEdit() {
    knowledgeDraft.value = knowledgeBody.value;
    editing.value = true;
  }

  function cancelEdit() {
    knowledgeDraft.value = knowledgeBody.value;
    editing.value = false;
  }

  function resetExploreRun() {
    exploreRun.value = emptyRunState();
    completedTurns = 0;
    lastExploreIntent = "initial";
  }

  function handleExploreEvent(event: VibeAgentSseEvent) {
    const state = exploreRun.value;
    if (event.type === "status") {
      state.statusDetail = event.data.detail?.trim() || event.data.phase || state.statusDetail;
      if (typeof event.data.turn === "number") state.turn = event.data.turn;
      if (typeof event.data.maxTurns === "number") state.maxTurns = event.data.maxTurns;
      return;
    }
    if (event.type === "message_delta") {
      state.assistantText += event.data.delta || "";
      return;
    }
    if (event.type === "message") {
      const text = event.data.text || "";
      if (text) state.assistantText = text;
      return;
    }
    if (event.type === "tool_start") {
      state.tools.push({ id: event.data.id, name: event.data.name });
      return;
    }
    if (event.type === "tool_end") {
      const tool = state.tools.find((t) => t.id === event.data.id);
      if (tool) {
        tool.ok = event.data.ok;
        tool.summary = event.data.summary;
      }
      return;
    }
    if (event.type === "turn_response") {
      completedTurns = event.data.turn;
      if (event.data.assistantText?.trim()) {
        state.assistantText = stripTextToolCallMarkup(event.data.assistantText);
      }
      return;
    }
    if (event.type === "error") {
      state.failed = true;
      state.error = event.data.message || "探索失败";
      return;
    }
  }

  function resolveExploreSaveMessage(saved: boolean): string {
    if (!saved) {
      if (exploreRun.value.aborted) return "探索已停止";
      if (exploreRun.value.failed) return exploreRun.value.error || "探索失败";
      return "";
    }
    if (exploreRun.value.failed) return "探索异常结束，已保存已有内容";
    if (exploreRun.value.aborted) return "已保存不完整知识库";
    return "知识库已更新";
  }

  async function finalizeExploreRun() {
    if (finalizeInFlight) return finalizeInFlight;

    finalizeInFlight = (async () => {
      const ctx = activeExploreContext;
      const path = ctx?.projectPath ?? options.projectPath.value.trim();
      const raw = exploreRun.value.assistantText.trim();
      const applyToUi = Boolean(path) && isCurrentProject(path);
      if (!path) return;

      if (!raw) {
        const hint = resolveExploreSaveMessage(false);
        if (hint && applyToUi) knowledgeMessage.value = hint;
        return;
      }

      const priorBody = ctx?.priorBody ?? knowledgeBody.value.trim();
      const exploreIntent = ctx?.intent ?? lastExploreIntent;
      const saveBody = resolveKnowledgeBodyForSave(priorBody, raw, {
        intent: exploreIntent === "section_fill" ? "section_fill" : undefined,
      });
      if (!saveBody.trim()) return;

      const result = await saveProjectKnowledge(path, saveBody, {
        fromExplore: true,
        gitHead: ctx?.gitHead ?? (options.gitHead?.value?.trim() || knowledgeMeta.value.gitHead),
        exploreRounds: (ctx?.baseExploreRounds ?? knowledgeMeta.value.exploreRounds ?? 0) + 1,
      });
      if (result.ok) {
        if (applyToUi) {
          knowledgeBody.value = result.body ?? saveBody;
          knowledgeDraft.value = knowledgeBody.value;
          knowledgeMeta.value = result.meta ?? {};
          knowledgeMessage.value = resolveExploreSaveMessage(true);
          void loadKnowledgeChangedFiles();
        }
      } else if (applyToUi) {
        knowledgeMessage.value = result.error || "保存知识库失败";
      }
    })().finally(() => {
      activeExploreContext = null;
      finalizeInFlight = null;
    });

    return finalizeInFlight;
  }

  async function runKnowledgeExplore(
    prompt: string,
    exploreOptions?: { maxTurns?: number; depth?: ExploreDepth; history?: Array<{ role: "user" | "assistant"; content: string }> },
  ): Promise<boolean> {
    const project = options.projectPath.value.trim();
    if (!options.projectOpened.value) {
      knowledgeMessage.value = "请先打开项目";
      return false;
    }
    if (!options.configReady.value) {
      knowledgeMessage.value = "请先配置 AI 模型";
      return false;
    }
    if (options.apiKeyReady && !options.apiKeyReady.value) {
      knowledgeMessage.value = "请先保存 API Key";
      return false;
    }
    if (exploreRun.value.running) {
      knowledgeMessage.value = "探索进行中";
      return false;
    }

    const depth = exploreOptions?.depth ?? "standard";
    const history = exploreOptions?.history ?? [];
    const maxTurns =
      exploreOptions?.maxTurns
      ?? resolveExploreRequestMaxTurns(prompt, history, undefined, completedTurns, depth);

    lastExploreIntent = classifyExploreKnowledgeIntent(prompt, hasKnowledge.value);
    activeExploreContext = {
      projectPath: project,
      priorBody: knowledgeBody.value.trim(),
      gitHead: options.gitHead?.value?.trim() || knowledgeMeta.value.gitHead,
      baseExploreRounds: knowledgeMeta.value.exploreRounds ?? 0,
      intent: lastExploreIntent,
    };

    exploreRun.value = {
      ...emptyRunState(),
      running: true,
      maxTurns,
      intent: lastExploreIntent,
    };
    knowledgeMessage.value = "";

    const request = {
      prompt,
      history,
      projectPath: project,
      endpoint: options.aiConfig.value.endpoint,
      apiKey: options.aiConfig.value.apiKey,
      model: options.aiConfig.value.model,
      mode: "explore" as const,
      maxTurns,
      webProxyUrl: loadWebProxyUrlFromStorage() || undefined,
    };

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        exploreRun.value.running = false;
        abortHandle = null;
        void finalizeExploreRun().finally(() => resolve(ok));
      };

      abortHandle = runVibeAgentSse(request, (event) => {
        handleExploreEvent(event);
        if (event.type === "done") finish(true);
        if (event.type === "error" && exploreRun.value.failed) finish(false);
      });
    });
  }

  async function startKnowledgeExplore(depth: ExploreDepth = "standard") {
    resetExploreRun();
    return runKnowledgeExplore(EXPLORE_PROJECT_PRESET_PROMPT, {
      maxTurns: EXPLORE_DEPTH_MAX_TURNS[depth],
      depth,
    });
  }

  async function continueKnowledgeExplore() {
    if (!hasKnowledge.value) return startKnowledgeExplore();
    exploreRun.value.aborted = false;
    exploreRun.value.failed = false;
    return runKnowledgeExplore(EXPLORE_CONTINUE_PRESET_PROMPT, {
      maxTurns: resolveExploreRequestMaxTurns(
        EXPLORE_CONTINUE_PRESET_PROMPT,
        undefined,
        undefined,
        knowledgeMeta.value.exploreRounds ?? completedTurns,
      ),
    });
  }

  async function sendKnowledgeFollowUp(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return false;
    return runKnowledgeExplore(trimmed, {
      maxTurns: EXPLORE_FOLLOWUP_MAX_TURNS,
    });
  }

  async function exploreKnowledgeChanges() {
    if (!hasKnowledge.value) return startKnowledgeExplore();
    if (!knowledgeChangedFiles.value.length) {
      return continueKnowledgeExplore();
    }
    return runKnowledgeExplore(
      buildExploreChangedFilesPrompt(knowledgeChangedFiles.value.length),
      { maxTurns: EXPLORE_FOLLOWUP_MAX_TURNS },
    );
  }

  function stopKnowledgeExplore() {
    if (!exploreRun.value.running) return;
    exploreRun.value.aborted = true;
    abortHandle?.abort();
    abortHandle = null;
  }

  /** 切换/关闭项目：中止 SSE 并清空 UI，finalize 仍写入锁定的原项目路径 */
  function leaveProjectKnowledge() {
    if (exploreRun.value.running) {
      exploreRun.value.aborted = true;
      abortHandle?.abort();
      abortHandle = null;
      exploreRun.value.running = false;
    }
    editing.value = false;
    knowledgeBody.value = "";
    knowledgeDraft.value = "";
    knowledgeMeta.value = {};
    knowledgeMessage.value = "";
    knowledgeChangedFiles.value = [];
  }

  watch(
    () => [
      options.projectPath.value,
      options.projectOpened.value,
      knowledgeMeta.value.gitHead,
      options.gitHead?.value,
      hasKnowledge.value,
    ] as const,
    () => {
      void loadKnowledgeChangedFiles();
    },
    { immediate: true },
  );

  return {
    knowledgeBody,
    knowledgeDraft,
    knowledgeMeta,
    knowledgeLoading,
    knowledgeSaving,
    knowledgeMessage,
    editing,
    hasKnowledge,
    knowledgeChangedFiles,
    knowledgeChangesLoading,
    knowledgeChangesAvailable,
    displayBody,
    exploreRun,
    loadKnowledge,
    loadKnowledgeChangedFiles,
    saveKnowledgeDraft,
    beginEdit,
    cancelEdit,
    startKnowledgeExplore,
    continueKnowledgeExplore,
    exploreKnowledgeChanges,
    sendKnowledgeFollowUp,
    stopKnowledgeExplore,
    leaveProjectKnowledge,
  };
}
