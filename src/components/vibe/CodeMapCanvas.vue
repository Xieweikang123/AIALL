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
import { markRaw, ref, watch } from "vue";
import {
  VueFlow,
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
import type { CodeMapDocument, CodeMapNodeKind } from "../../../shared/codeMapTypes";
import { visibleNodeIds } from "../../utils/codeMapLayout";
import CodeMapFlowNode from "./CodeMapFlowNode.vue";

const props = defineProps<{
  document: CodeMapDocument;
  positions: Record<string, { x: number; y: number }>;
  collapsedIds: Set<string>;
  selectedNodeId: string | null;
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
      animated: e.kind === "depends" || e.kind === "routes_to",
      label: e.kind === "contains" ? undefined : e.kind,
      style: {
        stroke:
          e.kind === "depends"
            ? "#f9e2af"
            : e.kind === "routes_to"
              ? "#89b4fa"
              : "rgba(205, 214, 244, 0.35)",
      },
    }));
}

watch(
  () => ({
    docKey: `${props.document.generatedAt}:${props.document.nodes.length}:${props.document.edges.length}`,
    posKey: JSON.stringify(props.positions),
    collapsedKey: [...props.collapsedIds].sort().join("|"),
    selected: props.selectedNodeId,
    summaries: props.document.nodes.map((n) => n.summary || "").join("\0"),
  }),
  () => rebuildGraph(),
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
  background: #11111b;
  border-radius: 8px;
  overflow: hidden;
}

.code-map-canvas-empty {
  display: grid;
  place-items: center;
  height: 100%;
  color: #6c7086;
  font-size: 13px;
}

:deep(.vue-flow__controls) {
  box-shadow: none;
  border: 1px solid rgba(205, 214, 244, 0.12);
  overflow: hidden;
  border-radius: 6px;
}

:deep(.vue-flow__controls-button) {
  background: #1e1e2e;
  border: none;
  border-bottom: 1px solid rgba(205, 214, 244, 0.08);
  fill: #cdd6f4;
}

:deep(.vue-flow__minimap) {
  background: #181825;
  border: 1px solid rgba(205, 214, 244, 0.12);
  border-radius: 6px;
}
</style>
