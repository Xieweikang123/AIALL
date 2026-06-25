import { computed, ref, type ComputedRef, type Ref } from "vue";
import {
  EXPLORE_CONTINUE_PRESET_PROMPT,
  EXPLORE_DEPTH_MAX_TURNS,
  EXPLORE_FOLLOWUP_MAX_TURNS,
  EXPLORE_PROJECT_PRESET_PROMPT,
  type ExploreDepth,
  resolveExploreRequestMaxTurns,
} from "../services/agentExplore";
import { loadWebProxyUrlFromStorage } from "../services/aiLocalConfig";
import {
  extractReportBodyForArchive,
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
  };
}

type AiConfig = {
  endpoint: string;
  apiKey: string;
  model: string;
};

export function useProjectKnowledge(options: {
  projectPath: Ref<string>;
  projectOpened: Ref<boolean> | ComputedRef<boolean>;
  configReady: Ref<boolean> | ComputedRef<boolean>;
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

  const exploreRun = ref<KnowledgeExploreRunState>(emptyRunState());
  let abortHandle: { abort: () => void } | null = null;
  let completedTurns = 0;

  const hasKnowledge = computed(() => Boolean(knowledgeBody.value.trim()));
  const displayBody = computed(() =>
    exploreRun.value.running && exploreRun.value.assistantText.trim()
      ? exploreRun.value.assistantText
      : editing.value
        ? knowledgeDraft.value
        : knowledgeBody.value,
  );

  async function loadKnowledge() {
    const path = options.projectPath.value.trim();
    if (!path || !options.projectOpened.value) return;
    knowledgeLoading.value = true;
    knowledgeMessage.value = "";
    try {
      const result = await fetchProjectKnowledge(path);
      if (!result.ok) {
        knowledgeMessage.value = result.error || "读取失败";
        return;
      }
      knowledgeBody.value = result.body ?? stripKnowledgeFrontmatter(result.content ?? "");
      knowledgeDraft.value = knowledgeBody.value;
      knowledgeMeta.value = result.meta ?? {};
    } finally {
      knowledgeLoading.value = false;
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

  async function finalizeExploreRun() {
    const path = options.projectPath.value.trim();
    const raw = exploreRun.value.assistantText.trim();
    if (!path || !raw) return;
    const body = extractReportBodyForArchive(raw);
    const saveBody = body || raw;
    if (!saveBody.trim()) return;
    const result = await saveProjectKnowledge(path, saveBody, {
      fromExplore: true,
      gitHead: options.gitHead?.value?.trim() || knowledgeMeta.value.gitHead,
      exploreRounds: (knowledgeMeta.value.exploreRounds ?? 0) + 1,
    });
    if (result.ok) {
      knowledgeBody.value = result.body ?? saveBody;
      knowledgeDraft.value = knowledgeBody.value;
      knowledgeMeta.value = result.meta ?? {};
      knowledgeMessage.value = exploreRun.value.aborted ? "已保存不完整知识库" : "知识库已更新";
    } else {
      knowledgeMessage.value = result.error || "保存知识库失败";
    }
  }

  async function runKnowledgeExplore(
    prompt: string,
    exploreOptions?: { maxTurns?: number; depth?: ExploreDepth; history?: Array<{ role: "user" | "assistant"; content: string }> },
  ): Promise<boolean> {
    const project = options.projectPath.value.trim();
    if (!options.configReady.value || !options.projectOpened.value) {
      knowledgeMessage.value = !options.configReady.value
        ? "请先配置 AI 模型"
        : "请先打开项目";
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

    exploreRun.value = {
      ...emptyRunState(),
      running: true,
      maxTurns,
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
    const history: Array<{ role: "user" | "assistant"; content: string }> = [
      { role: "user", content: EXPLORE_PROJECT_PRESET_PROMPT },
      { role: "assistant", content: knowledgeBody.value },
    ];
    exploreRun.value.aborted = false;
    exploreRun.value.failed = false;
    return runKnowledgeExplore(EXPLORE_CONTINUE_PRESET_PROMPT, {
      history,
      maxTurns: resolveExploreRequestMaxTurns(
        EXPLORE_CONTINUE_PRESET_PROMPT,
        history,
        undefined,
        knowledgeMeta.value.exploreRounds ?? completedTurns,
      ),
    });
  }

  async function sendKnowledgeFollowUp(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return false;
    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    if (knowledgeBody.value.trim()) {
      history.push(
        { role: "user", content: EXPLORE_PROJECT_PRESET_PROMPT },
        { role: "assistant", content: knowledgeBody.value },
      );
    }
    history.push({ role: "user", content: trimmed });
    return runKnowledgeExplore(trimmed, {
      history: history.slice(0, -1),
      maxTurns: EXPLORE_FOLLOWUP_MAX_TURNS,
    });
  }

  function stopKnowledgeExplore() {
    if (!exploreRun.value.running) return;
    exploreRun.value.aborted = true;
    abortHandle?.abort();
    abortHandle = null;
    exploreRun.value.running = false;
    void finalizeExploreRun();
  }

  return {
    knowledgeBody,
    knowledgeDraft,
    knowledgeMeta,
    knowledgeLoading,
    knowledgeSaving,
    knowledgeMessage,
    editing,
    hasKnowledge,
    displayBody,
    exploreRun,
    loadKnowledge,
    saveKnowledgeDraft,
    beginEdit,
    cancelEdit,
    startKnowledgeExplore,
    continueKnowledgeExplore,
    sendKnowledgeFollowUp,
    stopKnowledgeExplore,
  };
}