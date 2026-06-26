import { computed, ref, type ComputedRef, type Ref } from "vue";
import {
  ARCHITECT_REVIEW_MAX_TURNS,
  architectReviewBadgeCount,
  buildArchitectReviewPrompt,
  extractArchitectReviewBody,
  formatArchitectReviewVerdictLabel,
  isArchitectReviewReport,
  parseArchitectReviewVerdictFromBody,
  type ArchitectReviewContextBundle,
} from "../../shared/projectArchitectReview";
import { stripArchitectReviewFrontmatter } from "../../shared/projectArchitectReviewFormat";
import type { ArchitectReviewHistoryEntry } from "../../shared/projectArchitectReviewHistory";
import {
  fetchArchitectReviewContext,
  fetchProjectArchitectReview,
  saveProjectArchitectReview,
  archiveReviewToHistory,
  fetchReviewHistory,
  fetchReviewHistoryDetail,
  deleteReviewHistory,
  type ArchitectReviewMeta,
} from "../services/vibeProjectArchitectReviewClient";
import { loadWebProxyUrlFromStorage } from "../services/aiLocalConfig";
import { runVibeAgentSse, type VibeAgentSseEvent } from "../services/vibeAgentClient";
import { stripTextToolCallMarkup } from "../services/textToolCallMarkup";

export type ArchitectReviewTool = {
  id: string;
  name: string;
  ok?: boolean;
  summary?: string;
};

export type ArchitectReviewRunState = {
  running: boolean;
  assistantText: string;
  statusDetail: string;
  turn: number;
  maxTurns: number;
  tools: ArchitectReviewTool[];
  aborted: boolean;
  failed: boolean;
  error: string;
};

function emptyRunState(): ArchitectReviewRunState {
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

type ActiveReviewContext = {
  projectPath: string;
  gitHead?: string;
};

function normalizeProjectPath(p: string): string {
  return p.trim().replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
}

export function useProjectArchitectReview(options: {
  projectPath: Ref<string>;
  projectOpened: Ref<boolean> | ComputedRef<boolean>;
  configReady: Ref<boolean> | ComputedRef<boolean>;
  apiKeyReady?: Ref<boolean> | ComputedRef<boolean>;
  aiConfig: Ref<AiConfig>;
  gitHead?: Ref<string> | ComputedRef<string>;
  confirm?: (msg: string, event?: MouseEvent) => Promise<boolean>;
}) {
  const reviewBody = ref("");
  const reviewMeta = ref<ArchitectReviewMeta>({});
  const reviewLoading = ref(false);
  const reviewMessage = ref("");
  const reviewContext = ref<ArchitectReviewContextBundle | null>(null);

  // Review history state
  const reviewHistory = ref<ArchitectReviewHistoryEntry[]>([]);
  const reviewHistoryLoading = ref(false);
  const reviewHistoryMessage = ref("");
  const activeHistoryReview = ref<ArchitectReviewHistoryEntry | null>(null);

  const reviewRun = ref<ArchitectReviewRunState>(emptyRunState());
  let abortHandle: { abort: () => void } | null = null;
  let finalizeInFlight: Promise<void> | null = null;
  let activeReviewContext: ActiveReviewContext | null = null;

  function isCurrentProject(path: string): boolean {
    return normalizeProjectPath(path) === normalizeProjectPath(options.projectPath.value);
  }

  const hasReview = computed(() => Boolean(reviewBody.value.trim()));
  const reviewVerdict = computed(() => reviewMeta.value.verdict ?? null);
  const reviewAttentionCount = computed(() => architectReviewBadgeCount(reviewVerdict.value));

  const displayBody = computed(() => {
    if (reviewRun.value.running && reviewRun.value.assistantText.trim()) {
      return reviewRun.value.assistantText;
    }
    return reviewBody.value;
  });

  async function loadReview(loadOptions?: { force?: boolean }) {
    const path = options.projectPath.value.trim();
    if (!path || !options.projectOpened.value) return;
    if (reviewRun.value.running && !loadOptions?.force) return;
    reviewLoading.value = true;
    if (!loadOptions?.force) reviewMessage.value = "";
    try {
      const result = await fetchProjectArchitectReview(path);
      if (!result.ok) {
        reviewMessage.value = result.error || "读取失败";
        return;
      }
      reviewBody.value = result.body ?? stripArchitectReviewFrontmatter(result.content ?? "");
      reviewMeta.value = result.meta ?? {};
    } finally {
      reviewLoading.value = false;
    }
  }

  async function loadReviewHistory() {
    const path = options.projectPath.value.trim();
    if (!path || !options.projectOpened.value) return;
    reviewHistoryLoading.value = true;
    reviewHistoryMessage.value = "";
    try {
      const result = await fetchReviewHistory(path);
      if (!result.ok) {
        reviewHistoryMessage.value = result.error || "加载历史失败";
        return;
      }
      reviewHistory.value = result.reviews ?? [];
    } finally {
      reviewHistoryLoading.value = false;
    }
  }

  async function viewHistoryReview(entry: ArchitectReviewHistoryEntry) {
    const path = options.projectPath.value.trim();
    if (!path || !options.projectOpened.value) return;
    activeHistoryReview.value = entry;
    reviewLoading.value = true;
    try {
      const result = await fetchReviewHistoryDetail(path, entry.id);
      if (!result.ok) {
        reviewMessage.value = result.error || "加载历史记录失败";
        return;
      }
      if (result.review) {
        reviewBody.value = result.review.body;
        reviewMeta.value = {
          gitHead: result.review.gitHead,
          verdict: result.review.verdict,
          lastReviewedAt: result.review.createdAt,
          updatedAt: result.review.createdAt,
        };
      }
    } finally {
      reviewLoading.value = false;
    }
  }

  async function deleteHistoryReview(entry: ArchitectReviewHistoryEntry, event?: MouseEvent) {
    const path = options.projectPath.value.trim();
    if (!path || !options.projectOpened.value) return;

    const verdict = formatArchitectReviewVerdictLabel(entry.verdict ?? null);
    let timeLabel = "";
    if (entry.createdAt) {
      try {
        const d = new Date(entry.createdAt);
        timeLabel = d.toLocaleString(undefined, {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      } catch {
        timeLabel = entry.createdAt;
      }
    }
    const detail = timeLabel ? `${timeLabel} · ${verdict}` : verdict;
    if (options.confirm && !(await options.confirm(`确定删除评审记录（${detail}）？此操作不可撤销。`, event))) {
      return;
    }

    reviewHistoryLoading.value = true;
    try {
      const result = await deleteReviewHistory(path, entry.id);
      if (!result.ok) {
        reviewHistoryMessage.value = result.error || "删除历史失败";
        return;
      }
      reviewHistory.value = result.reviews ?? [];
      // If viewing the deleted review, clear it
      if (activeHistoryReview.value?.id === entry.id) {
        activeHistoryReview.value = null;
        await loadReview();
      }
    } finally {
      reviewHistoryLoading.value = false;
    }
  }

  function clearHistoryReview() {
    activeHistoryReview.value = null;
    loadReview();
  }

  function handleReviewEvent(event: VibeAgentSseEvent) {
    const state = reviewRun.value;
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
      if (event.data.assistantText?.trim()) {
        state.assistantText = stripTextToolCallMarkup(event.data.assistantText);
      }
      return;
    }
    if (event.type === "error") {
      state.failed = true;
      state.error = event.data.message || "评审失败";
    }
  }

  function resolveReviewSaveMessage(saved: boolean): string {
    if (!saved) {
      if (reviewRun.value.aborted) return "评审已停止";
      if (reviewRun.value.failed) return reviewRun.value.error || "评审失败";
      return "";
    }
    if (reviewRun.value.failed) return "评审异常结束，已保存已有内容";
    if (reviewRun.value.aborted) return "已保存不完整评审报告";
    return "架构评审报告已更新";
  }

  async function finalizeReviewRun() {
    if (finalizeInFlight) return finalizeInFlight;

    finalizeInFlight = (async () => {
      const ctx = activeReviewContext;
      const path = ctx?.projectPath ?? options.projectPath.value.trim();
      const raw = stripTextToolCallMarkup(reviewRun.value.assistantText).trim();
      const applyToUi = Boolean(path) && isCurrentProject(path);
      if (!path) return;

      if (!raw || !isArchitectReviewReport(raw)) {
        const hint = resolveReviewSaveMessage(false);
        if (hint && applyToUi) reviewMessage.value = hint;
        if (!isArchitectReviewReport(raw) && raw && applyToUi) {
          reviewMessage.value = "模型输出未包含评审报告标记，未保存";
        }
        return;
      }

      const saveBody = extractArchitectReviewBody(raw);
      const verdict = parseArchitectReviewVerdictFromBody(saveBody) ?? undefined;
      
      // Extract commit count and changed file count from context
      const commitCount = reviewContext.value?.recentCommits?.length;
      const changedFileCount = reviewContext.value?.changedFiles?.length;
      
      const result = await saveProjectArchitectReview(path, saveBody, {
        fromReview: false,
        gitHead: ctx?.gitHead ?? (options.gitHead?.value?.trim() || reviewMeta.value.gitHead),
        verdict,
        commitCount,
        changedFileCount,
      });
      if (result.ok) {
        if (applyToUi) {
          reviewBody.value = result.body ?? saveBody;
          reviewMeta.value = result.meta ?? {};
          reviewMessage.value = resolveReviewSaveMessage(true);
          await loadReviewHistory();
        }
      } else if (applyToUi) {
        reviewMessage.value = result.error || "保存评审报告失败";
      }
    })().finally(() => {
      activeReviewContext = null;
      finalizeInFlight = null;
    });

    return finalizeInFlight;
  }

  async function startArchitectReview(): Promise<boolean> {
    const project = options.projectPath.value.trim();
    if (!options.projectOpened.value) {
      reviewMessage.value = "请先打开项目";
      return false;
    }
    if (!options.configReady.value) {
      reviewMessage.value = "请先配置 AI 模型";
      return false;
    }
    if (options.apiKeyReady && !options.apiKeyReady.value) {
      reviewMessage.value = "请先保存 API Key";
      return false;
    }
    if (reviewRun.value.running) {
      reviewMessage.value = "评审进行中";
      return false;
    }

    reviewMessage.value = "";

    if (hasReview.value) {
      const commitCount = reviewContext.value?.recentCommits?.length;
      const changedFileCount = reviewContext.value?.changedFiles?.length;
      const archiveResult = await archiveReviewToHistory(project, reviewBody.value, {
        gitHead: options.gitHead?.value?.trim() || reviewMeta.value.gitHead,
        verdict: reviewVerdict.value ?? undefined,
        commitCount,
        changedFileCount,
      });
      if (!archiveResult.ok) {
        reviewMessage.value = archiveResult.error || "归档当前评审失败";
        return false;
      }
      activeHistoryReview.value = null;
      await loadReviewHistory();
    }

    const contextResult = await fetchArchitectReviewContext(project);
    if (!contextResult.ok || !contextResult.context) {
      reviewMessage.value = contextResult.error || "获取评审上下文失败";
      return false;
    }
    reviewContext.value = contextResult.context;

    const prompt = buildArchitectReviewPrompt(contextResult.context);
    const maxTurns = ARCHITECT_REVIEW_MAX_TURNS;

    activeReviewContext = {
      projectPath: project,
      gitHead: contextResult.context.currentGitHead ?? options.gitHead?.value?.trim(),
    };

    reviewRun.value = {
      ...emptyRunState(),
      running: true,
      maxTurns,
    };

    const request = {
      prompt,
      history: [],
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
        reviewRun.value.running = false;
        abortHandle = null;
        void finalizeReviewRun().finally(() => resolve(ok));
      };

      abortHandle = runVibeAgentSse(request, (event) => {
        handleReviewEvent(event);
        if (event.type === "done") finish(true);
        if (event.type === "error" && reviewRun.value.failed) finish(false);
      });
    });
  }

  function stopArchitectReview() {
    if (!reviewRun.value.running) return;
    reviewRun.value.aborted = true;
    abortHandle?.abort();
    abortHandle = null;
  }

  function onProjectClosed() {
    stopArchitectReview();
    reviewBody.value = "";
    reviewMeta.value = {};
    reviewMessage.value = "";
    reviewContext.value = null;
    reviewRun.value = emptyRunState();
    reviewHistory.value = [];
    reviewHistoryMessage.value = "";
    activeHistoryReview.value = null;
  }

  function onProjectPathChanged() {
    if (reviewRun.value.running) stopArchitectReview();
    reviewBody.value = "";
    reviewMeta.value = {};
    reviewMessage.value = "";
    reviewContext.value = null;
    reviewHistory.value = [];
    reviewHistoryMessage.value = "";
    activeHistoryReview.value = null;
  }

  return {
    reviewBody,
    reviewMeta,
    reviewLoading,
    reviewMessage,
    reviewContext,
    reviewRun,
    hasReview,
    reviewVerdict,
    reviewAttentionCount,
    displayBody,
    loadReview,
    startArchitectReview,
    stopArchitectReview,
    onProjectClosed,
    onProjectPathChanged,
    // History
    reviewHistory,
    reviewHistoryLoading,
    reviewHistoryMessage,
    activeHistoryReview,
    loadReviewHistory,
    viewHistoryReview,
    deleteHistoryReview,
    clearHistoryReview,
  };
}
