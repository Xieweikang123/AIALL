import { computed, ref, type Ref } from "vue";
import {
  mergeCodeMapSummaries,
} from "../../shared/codeMapAnnotate";
import { CODE_MAP_SCHEMA_VERSION, type CodeMapDocument, type CodeMapLayoutFile, type CodeMapNode } from "../../shared/codeMapTypes";
import { annotateCodeMapDocument } from "../services/codeMapAnnotateClient";
import {
  buildCodeMap,
  fetchCodeMap,
  fetchCodeMapLayout,
  saveCodeMap,
  saveCodeMapLayout,
} from "../services/vibeCodeMapClient";
import { CODE_MAP_LAYOUT_ALGO, computeTreeLayout, mergeLayoutPositions } from "../utils/codeMapLayout";

export type CodeMapAiConfig = {
  endpoint: string;
  apiKey: string;
  model: string;
};

export function useCodeMap(options: {
  projectPath: Ref<string>;
  gitHead: Ref<string>;
  aiConfig: () => CodeMapAiConfig;
  configReady: Ref<boolean>;
}) {
  const document = ref<CodeMapDocument | null>(null);
  const positions = ref<Record<string, { x: number; y: number }>>({});
  const collapsedIds = ref<Set<string>>(new Set());
  const selectedNodeId = ref<string | null>(null);
  const loading = ref(false);
  const building = ref(false);
  const annotating = ref(false);
  const savingLayout = ref(false);
  const message = ref("");
  const error = ref("");
  const annotateEnabled = ref(true);
  /** Bumped on resetLayout so the canvas remounts and fits the view. */
  const layoutEpoch = ref(0);
  /** Bumped when we want the canvas to center on focusHint / selected entry. */
  const focusEpoch = ref(0);

  let annotateAbort: AbortController | null = null;
  let layoutSaveTimer: ReturnType<typeof setTimeout> | null = null;

  const selectedNode = computed<CodeMapNode | null>(() => {
    if (!document.value || !selectedNodeId.value) return null;
    return document.value.nodes.find((n) => n.id === selectedNodeId.value) ?? null;
  });

  const relatedEdges = computed(() => {
    if (!document.value || !selectedNodeId.value) return [];
    const id = selectedNodeId.value;
    return document.value.edges.filter((e) => e.source === id || e.target === id);
  });

  const hasDocument = computed(() => Boolean(document.value?.nodes?.length));

  const generatedAtLabel = computed(() => {
    const raw = document.value?.generatedAt;
    if (!raw) return "";
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleString();
  });

  /** True when cached map was built on a different git HEAD than current. */
  const isStale = computed(() => {
    const docHead = document.value?.gitHead?.trim();
    const current = options.gitHead.value.trim();
    if (!docHead || !current) return false;
    return docHead !== current;
  });

  const focusNodeId = computed(() => document.value?.focusHint?.trim() || null);

  function applyFocusHint(doc: CodeMapDocument, opts?: { center?: boolean }) {
    const hint = doc.focusHint?.trim();
    if (hint && doc.nodes.some((n) => n.id === hint)) {
      selectedNodeId.value = hint;
      if (opts?.center) focusEpoch.value += 1;
    }
  }

  function applyDocument(
    doc: CodeMapDocument,
    layout?: CodeMapLayoutFile | null,
    opts?: { resetLayout?: boolean; focus?: boolean },
  ) {
    document.value = doc;
    const computedPositions = computeTreeLayout(doc);
    positions.value = opts?.resetLayout
      ? computedPositions
      : mergeLayoutPositions(computedPositions, layout?.positions, layout?.algoVersion);
    collapsedIds.value = opts?.resetLayout
      ? new Set()
      : new Set(layout?.collapsedIds ?? []);
    if (selectedNodeId.value && !doc.nodes.some((n) => n.id === selectedNodeId.value)) {
      selectedNodeId.value = null;
    }
    if (opts?.focus) {
      applyFocusHint(doc, { center: true });
    }
  }

  async function loadCached(): Promise<boolean> {
    const root = options.projectPath.value.trim();
    if (!root) {
      document.value = null;
      return false;
    }
    loading.value = true;
    error.value = "";
    message.value = "";
    try {
      const [mapRes, layoutRes] = await Promise.all([
        fetchCodeMap(root),
        fetchCodeMapLayout(root),
      ]);
      if (!mapRes.ok) {
        error.value = mapRes.error || "读取架构图失败";
        return false;
      }
      if (mapRes.missing || !mapRes.document) {
        document.value = null;
        positions.value = {};
        collapsedIds.value = new Set();
        message.value = "尚未生成架构图";
        return false;
      }
      applyDocument(mapRes.document, layoutRes.layout ?? null, { focus: true });
      message.value = "";
      return true;
    } finally {
      loading.value = false;
    }
  }

  async function generate(opts?: { withAnnotate?: boolean }): Promise<boolean> {
    const root = options.projectPath.value.trim();
    if (!root) {
      error.value = "未打开项目";
      return false;
    }
    annotateAbort?.abort();
    annotateAbort = null;
    building.value = true;
    error.value = "";
    message.value = "正在分析项目结构…";
    try {
      const built = await buildCodeMap(root, options.gitHead.value || undefined);
      if (!built.ok || !built.document) {
        error.value = built.error || "生成失败";
        message.value = "";
        return false;
      }
      let doc = mergeCodeMapSummaries(built.document, document.value);
      const saved = await saveCodeMap(root, doc);
      if (!saved.ok) {
        error.value = saved.error || "保存失败";
        message.value = "";
        return false;
      }

      // Fresh generate always uses the current compact layout algorithm.
      applyDocument(doc, null, { resetLayout: true, focus: true });
      await persistLayout();

      const truncated = doc.truncatedCount ?? 0;
      message.value = truncated > 0
        ? `已生成（折叠 ${truncated} 个次要模块）`
        : "已生成";

      const shouldAnnotate = opts?.withAnnotate ?? annotateEnabled.value;
      if (shouldAnnotate && options.configReady.value) {
        void runAnnotate(doc, { force: false });
      }
      return true;
    } finally {
      building.value = false;
    }
  }

  async function runAnnotate(
    baseDoc?: CodeMapDocument,
    opts?: { force?: boolean },
  ): Promise<boolean> {
    const root = options.projectPath.value.trim();
    const doc = baseDoc ?? document.value;
    if (!root || !doc) return false;
    const cfg = options.aiConfig();
    if (!cfg.endpoint || !cfg.model) {
      message.value = "已生成（跳过 AI 标注：配置不完整）";
      return false;
    }
    const force = opts?.force === true;
    annotateAbort?.abort();
    annotateAbort = new AbortController();
    annotating.value = true;
    message.value = force ? "正在 AI 重新标注…" : "正在 AI 标注节点…";
    try {
      const result = await annotateCodeMapDocument({
        document: doc,
        endpoint: cfg.endpoint,
        apiKey: cfg.apiKey,
        model: cfg.model,
        signal: annotateAbort.signal,
        force,
      });
      if (!result.ok || !result.document) {
        // Silent degrade: keep graph
        message.value = document.value
          ? `已生成（标注未完成：${result.error || "未知错误"}）`
          : "";
        return false;
      }
      if (result.skipped) {
        message.value = "已生成（节点均已有标注）";
        return true;
      }
      const saved = await saveCodeMap(root, result.document);
      if (!saved.ok) {
        message.value = "标注完成但保存失败";
        return false;
      }
      const layoutRes = await fetchCodeMapLayout(root);
      applyDocument(result.document, layoutRes.layout ?? null);
      message.value = "已生成并完成标注";
      return true;
    } finally {
      annotating.value = false;
      annotateAbort = null;
    }
  }

  function selectNode(id: string | null) {
    selectedNodeId.value = id;
  }

  function toggleCollapsed(id: string) {
    const next = new Set(collapsedIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsedIds.value = next;
    scheduleSaveLayout();
  }

  function updatePosition(id: string, x: number, y: number) {
    positions.value = { ...positions.value, [id]: { x, y } };
    scheduleSaveLayout();
  }

  function scheduleSaveLayout() {
    if (layoutSaveTimer) clearTimeout(layoutSaveTimer);
    layoutSaveTimer = setTimeout(() => {
      void persistLayout();
    }, 400);
  }

  async function persistLayout(): Promise<void> {
    const root = options.projectPath.value.trim();
    if (!root || !document.value) return;
    savingLayout.value = true;
    try {
      const layout: CodeMapLayoutFile = {
        schemaVersion: CODE_MAP_SCHEMA_VERSION,
        algoVersion: CODE_MAP_LAYOUT_ALGO,
        positions: { ...positions.value },
        collapsedIds: [...collapsedIds.value],
        updatedAt: new Date().toISOString(),
      };
      await saveCodeMapLayout(root, layout);
    } finally {
      savingLayout.value = false;
    }
  }

  /** Recompute auto layout and clear dragged positions (keeps graph data). */
  async function resetLayout(): Promise<boolean> {
    const doc = document.value;
    if (!doc) return false;
    if (layoutSaveTimer) {
      clearTimeout(layoutSaveTimer);
      layoutSaveTimer = null;
    }
    positions.value = computeTreeLayout(doc);
    collapsedIds.value = new Set();
    selectedNodeId.value = null;
    layoutEpoch.value += 1;
    applyFocusHint(doc, { center: true });
    message.value = "已重置布局";
    error.value = "";
    await persistLayout();
    return true;
  }

  function reset() {
    annotateAbort?.abort();
    annotateAbort = null;
    if (layoutSaveTimer) clearTimeout(layoutSaveTimer);
    document.value = null;
    positions.value = {};
    collapsedIds.value = new Set();
    selectedNodeId.value = null;
    loading.value = false;
    building.value = false;
    annotating.value = false;
    message.value = "";
    error.value = "";
  }

  function onProjectPathChanged() {
    reset();
  }

  return {
    document,
    positions,
    collapsedIds,
    selectedNodeId,
    selectedNode,
    relatedEdges,
    hasDocument,
    generatedAtLabel,
    isStale,
    focusNodeId,
    focusEpoch,
    loading,
    building,
    annotating,
    savingLayout,
    message,
    error,
    annotateEnabled,
    layoutEpoch,
    loadCached,
    generate,
    runAnnotate,
    selectNode,
    toggleCollapsed,
    updatePosition,
    persistLayout,
    resetLayout,
    reset,
    onProjectPathChanged,
  };
}
