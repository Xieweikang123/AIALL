<template>
  <div class="code-map-canvas">
    <VueFlow
      v-if="localNodes.length"
      id="code-map-flow"
      v-model:nodes="localNodes"
      v-model:edges="localEdges"
      :node-types="nodeTypes"
      :default-viewport="{ zoom: 0.75, x: 40, y: 40 }"
      :min-zoom="0.15"
      :max-zoom="2"
      fit-view-on-init
      :fit-view-options="{ padding: 0.2 }"
      nodes-draggable
      pan-on-drag
      zoom-on-scroll
      @node-click="onNodeClick"
      @node-double-click="onNodeDblClick"
      @node-drag-stop="onNodeDragStop"
      @pane-click="emit('select', null)"
    >
      <Background :gap="18" :size="1" color="rgba(255,255,255,0.06)" />
      <Controls position="bottom-left" :show-interactive="false" />
      <MiniMap
        position="bottom-right"
        pannable
        zoomable
        :mask-color="'rgba(0,0,0,0.45)'"
      />
    </VueFlow>
    <div v-else class="code-map-canvas-empty">暂无节点</div>
  </div>
</template>

<script setup lang="ts">
import { markRaw, nextTick, ref, watch } from "vue";
import {
  VueFlow,
  useVueFlow,
  type NodeMouseEvent,
  type NodeTypesObject,
} from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { MiniMap } from "@vue-flow/minimap";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";
import "@vue-flow/minimap/dist/style.css";
import { edgeKindLabel, type CodeMapDocument, type CodeMapNodeKind } from "../../../shared/codeMapTypes";
import { visibleNodeIds } from "../../utils/codeMapLayout";
import CodeMapFlowNode from "./CodeMapFlowNode.vue";

const props = defineProps<{
  document: CodeMapDocument;
  positions: Record<string, { x: number; y: number }>;
  collapsedIds: Set<string>;
  selectedNodeId: string | null;
  focusNodeId?: string | null;
  focusEpoch?: number;
}>();

const emit = defineEmits<{
  select: [id: string | null];
  "toggle-collapse": [id: string];
  "node-moved": [id: string, x: number, y: number];
  "open-file": [path: string];
}>();

const nodeTypes = {
  codeMap: markRaw(CodeMapFlowNode),
} as NodeTypesObject;

/** Loose graph refs — Vue Flow generics can explode TS recursion depth. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const localNodes = ref<any[]>([]);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const localEdges = ref<any[]>([]);

const { setCenter, findNode } = useVueFlow({ id: "code-map-flow" });

function edgeStroke(kind: string): string {
  switch (kind) {
    case "depends":
      return "#d29922";
    case "routes_to":
      return "#58a6ff";
    case "imports":
      return "#3fb950";
    default:
      return "rgba(255, 255, 255, 0.28)";
  }
}

function rebuildGraph() {
  const parentsWithChildren = new Set<string>();
  for (const edge of props.document.edges) {
    if (edge.kind === "contains" || edge.kind === "routes_to") {
      parentsWithChildren.add(edge.source);
    }
  }
  const visible = visibleNodeIds(props.document, props.collapsedIds);
  localNodes.value = props.document.nodes
    .filter((n) => visible.has(n.id))
    .map((n) => {
      const pos = props.positions[n.id] ?? { x: 0, y: 0 };
      return {
        id: n.id,
        type: "codeMap",
        position: { x: pos.x, y: pos.y },
        selected: props.selectedNodeId === n.id,
        data: {
          kind: n.kind as CodeMapNodeKind,
          label: n.label,
          summary: n.summary,
          path: n.path,
          collapsed: props.collapsedIds.has(n.id),
          collapsible: parentsWithChildren.has(n.id),
          onToggleCollapse: () => emit("toggle-collapse", n.id),
        },
      };
    });
  localEdges.value = props.document.edges
    .filter((e) => visible.has(e.source) && visible.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      animated: e.kind === "depends" || e.kind === "routes_to" || e.kind === "imports",
      label: e.kind === "contains" ? undefined : edgeKindLabel(e.kind),
      style: { stroke: edgeStroke(e.kind) },
    }));
}

function patchPositions() {
  for (const node of localNodes.value) {
    const pos = props.positions[node.id];
    if (!pos) continue;
    if (node.position.x !== pos.x || node.position.y !== pos.y) {
      node.position = { x: pos.x, y: pos.y };
    }
  }
}

function patchSelection() {
  for (const node of localNodes.value) {
    node.selected = props.selectedNodeId === node.id;
  }
}

function patchSummaries() {
  const byId = new Map(props.document.nodes.map((n) => [n.id, n]));
  for (const node of localNodes.value) {
    const src = byId.get(node.id);
    if (!src) continue;
    if (node.data.summary !== src.summary) {
      node.data = { ...node.data, summary: src.summary };
    }
  }
}

async function centerOnFocus() {
  const id = props.focusNodeId?.trim();
  if (!id) return;
  await nextTick();
  // Wait a frame so Vue Flow has measured nodes after remount/rebuild.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const node = findNode(id);
  if (!node) return;
  const w = node.dimensions?.width || 200;
  const h = node.dimensions?.height || 72;
  setCenter(node.position.x + w / 2, node.position.y + h / 2, {
    zoom: 1,
    duration: 280,
  });
}

watch(
  () => ({
    docKey: `${props.document.generatedAt}:${props.document.nodes.length}:${props.document.edges.length}`,
    collapsedKey: [...props.collapsedIds].sort().join("|"),
  }),
  () => rebuildGraph(),
  { immediate: true },
);

watch(
  () => props.positions,
  () => {
    if (!localNodes.value.length) {
      rebuildGraph();
      return;
    }
    const ids = new Set(localNodes.value.map((n) => n.id as string));
    const posIds = Object.keys(props.positions);
    const structureChanged =
      posIds.some((id) => !ids.has(id)) ||
      [...ids].some((id) => !(id in props.positions));
    if (structureChanged) rebuildGraph();
    else patchPositions();
  },
  { deep: true },
);

watch(
  () => props.selectedNodeId,
  () => patchSelection(),
);

watch(
  () => props.document.nodes.map((n) => n.summary || "").join("\0"),
  () => patchSummaries(),
);

watch(
  () => props.focusEpoch ?? 0,
  (epoch) => {
    if (epoch > 0) void centerOnFocus();
  },
  { immediate: true },
);

function onNodeClick(ev: NodeMouseEvent) {
  emit("select", ev.node.id);
}

function onNodeDblClick(ev: NodeMouseEvent) {
  const path = ev.node.data?.path as string | undefined;
  if (path && path !== ".") {
    emit("open-file", path);
  }
}

function onNodeDragStop(ev: NodeMouseEvent) {
  emit("node-moved", ev.node.id, ev.node.position.x, ev.node.position.y);
}
</script>

<style scoped>
.code-map-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  background: var(--bg, #0b1220);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 8px;
  overflow: hidden;
}

.code-map-canvas-empty {
  display: grid;
  place-items: center;
  height: 100%;
  color: var(--text-dim, rgba(255, 255, 255, 0.48));
  font-size: 13px;
}

:deep(.vue-flow__controls) {
  box-shadow: none;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  overflow: hidden;
  border-radius: 6px;
}

:deep(.vue-flow__controls-button) {
  background: var(--bg-secondary, rgba(17, 24, 39, 0.65));
  border: none;
  border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  fill: var(--text, rgba(255, 255, 255, 0.92));
}

:deep(.vue-flow__minimap) {
  background: var(--bg-secondary, rgba(17, 24, 39, 0.65));
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 6px;
}

:deep(.vue-flow__edge-text) {
  fill: var(--muted, rgba(255, 255, 255, 0.62));
  font-size: 10px;
}

:deep(.vue-flow__edge-textbg) {
  fill: var(--bg, #0b1220);
}
</style>
