<template>
  <div class="code-map-main">
    <header class="code-map-head">
      <h2 class="code-map-title">项目架构图</h2>
      <span v-if="building || annotating" class="code-map-badge code-map-badge--pulse">
        {{ annotating ? "标注中" : "生成中" }}
      </span>
      <span v-else-if="isStale" class="code-map-badge code-map-badge--warn">可能过期</span>
      <span v-else-if="generatedAtLabel" class="code-map-meta">{{ generatedAtLabel }}</span>
      <div class="code-map-head-actions">
        <button
          v-if="hasDocument"
          type="button"
          class="code-map-btn code-map-btn--ghost"
          title="恢复自动排布（清除拖拽位置）"
          @click="emit('reset-layout')"
        >
          重置布局
        </button>
        <button
          v-if="hasDocument"
          type="button"
          class="code-map-btn code-map-btn--ghost"
          title="导出 Mermaid"
          @click="emit('export-mermaid')"
        >
          导出 Mermaid
        </button>
        <button
          v-if="hasDocument"
          type="button"
          class="code-map-btn code-map-btn--ghost"
          title="导出 SVG"
          @click="emit('export-svg')"
        >
          导出 SVG
        </button>
        <button
          v-if="chatCollapsed"
          type="button"
          class="code-map-btn code-map-btn--ghost"
          @click="emit('expand-chat')"
        >
          展开 AI 助手
        </button>
      </div>
    </header>

    <p v-if="statusText" class="code-map-hint" role="status">{{ statusText }}</p>

    <div v-if="loading && !hasDocument" class="code-map-loading">
      <span class="panel-loading-spinner" aria-hidden="true" />
      <p class="code-map-empty-title">正在加载架构图…</p>
    </div>

    <div v-else-if="hasDocument && document" class="code-map-body">
      <div class="code-map-canvas-wrap">
        <CodeMapCanvas
          :key="layoutEpoch"
          :document="document"
          :positions="positions"
          :collapsed-ids="collapsedIds"
          :selected-node-id="selectedNodeId"
          :focus-node-id="focusNodeId"
          :focus-epoch="focusEpoch"
          @select="emit('select', $event)"
          @toggle-collapse="emit('toggle-collapse', $event)"
          @node-moved="(id, x, y) => emit('node-moved', id, x, y)"
          @open-file="emit('open-file', $event)"
        />
        <div
          v-if="building || annotating"
          class="code-map-canvas-busy"
          role="status"
          aria-live="polite"
        >
          <span class="panel-loading-spinner" aria-hidden="true" />
          <span>{{ annotating ? "标注中…" : "生成中…" }}</span>
        </div>
      </div>
      <aside class="code-map-side" aria-label="节点详情">
        <template v-if="selectedNode">
          <div class="code-map-side-kind">{{ kindLabel(selectedNode.kind) }}</div>
          <h3 class="code-map-side-title">{{ selectedNode.label }}</h3>
          <p v-if="selectedNode.path" class="code-map-side-path">
            <button type="button" class="code-map-link" @click="emit('open-file', selectedNode.path!)">
              {{ selectedNode.path }}
            </button>
          </p>
          <p v-if="selectedNode.summary" class="code-map-side-summary">{{ selectedNode.summary }}</p>
          <div v-if="relatedEdges.length" class="code-map-side-edges">
            <div class="code-map-side-label">关联边</div>
            <ul>
              <li v-for="edge in relatedEdges" :key="edge.id">
                {{ edgeKindLabel(edge.kind) }}:
                {{ edge.source === selectedNode.id ? "→" : "←" }}
                {{ edge.source === selectedNode.id ? shortId(edge.target) : shortId(edge.source) }}
              </li>
            </ul>
          </div>
          <div class="code-map-side-actions">
            <button
              v-if="selectedNode.path && selectedNode.path !== '.'"
              type="button"
              class="code-map-btn"
              @click="emit('open-file', selectedNode.path)"
            >
              打开文件
            </button>
            <button type="button" class="code-map-btn code-map-btn--ghost" @click="emit('explain-node')">
              解释此节点
            </button>
            <button
              v-if="canCollapseSelected"
              type="button"
              class="code-map-btn code-map-btn--ghost"
              @click="emit('toggle-collapse', selectedNode.id)"
            >
              {{ collapsedIds.has(selectedNode.id) ? "展开子树" : "折叠子树" }}
            </button>
          </div>
        </template>
        <template v-else>
          <p class="code-map-side-empty">点击节点查看详情；双击打开文件。</p>
        </template>
      </aside>
    </div>

    <div v-else class="code-map-empty">
      <p class="code-map-empty-title">尚未生成架构图</p>
      <p class="code-map-empty-desc">根据目录、入口与路由构建可交互模块脑图。</p>
      <button
        type="button"
        class="code-map-btn code-map-btn--primary"
        :disabled="building || loading"
        @click="emit('generate')"
      >
        {{ building ? "生成中…" : "生成架构图" }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  edgeKindLabel,
  kindLabel,
  type CodeMapDocument,
  type CodeMapEdge,
  type CodeMapNode,
} from "../../../shared/codeMapTypes";
import CodeMapCanvas from "./CodeMapCanvas.vue";

const props = defineProps<{
  chatCollapsed: boolean;
  document: CodeMapDocument | null;
  positions: Record<string, { x: number; y: number }>;
  collapsedIds: Set<string>;
  selectedNodeId: string | null;
  selectedNode: CodeMapNode | null;
  relatedEdges: CodeMapEdge[];
  hasDocument: boolean;
  loading: boolean;
  building: boolean;
  annotating: boolean;
  message: string;
  error: string;
  generatedAtLabel: string;
  layoutEpoch: number;
  focusNodeId?: string | null;
  focusEpoch?: number;
  isStale?: boolean;
}>();

const emit = defineEmits<{
  select: [id: string | null];
  "toggle-collapse": [id: string];
  "node-moved": [id: string, x: number, y: number];
  "open-file": [path: string];
  "explain-node": [];
  "reset-layout": [];
  "export-mermaid": [];
  "export-svg": [];
  "expand-chat": [];
  generate: [];
}>();

const statusText = computed(() => props.error || props.message);

const canCollapseSelected = computed(() => {
  if (!props.selectedNode || !props.document) return false;
  return props.document.edges.some(
    (e) =>
      e.source === props.selectedNode!.id &&
      (e.kind === "contains" || e.kind === "routes_to"),
  );
});

function shortId(id: string): string {
  const node = props.document?.nodes.find((n) => n.id === id);
  return node?.label ?? id.replace(/^[^:]+:/, "");
}
</script>

<style scoped>
.code-map-main {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 12px 14px 14px;
  color: var(--text, rgba(255, 255, 255, 0.92));
}

.code-map-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.code-map-title {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
}

.code-map-meta {
  font-size: 12px;
  color: var(--text-dim, rgba(255, 255, 255, 0.48));
}

.code-map-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 18%, transparent);
  color: var(--accent-color, #58a6ff);
}

.code-map-badge--pulse {
  animation: code-map-pulse 1.2s ease-in-out infinite;
}

.code-map-badge--warn {
  background: color-mix(in srgb, var(--warning-color, #d29922) 18%, transparent);
  color: var(--warning-color, #d29922);
}

@keyframes code-map-pulse {
  50% { opacity: 0.55; }
}

.code-map-head-actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.code-map-btn {
  border: 1px solid color-mix(in srgb, var(--accent-color, #58a6ff) 40%, transparent);
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 14%, transparent);
  color: var(--text, rgba(255, 255, 255, 0.92));
  border-radius: var(--radius-sm, 6px);
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}

.code-map-btn--ghost {
  background: transparent;
  border-color: var(--border, rgba(255, 255, 255, 0.1));
}

.code-map-btn--primary {
  margin-top: 10px;
  padding: 7px 16px;
  font-size: 13px;
  background: var(--primary, #1f6feb);
  border-color: var(--primary, #1f6feb);
  color: #fff;
}

.code-map-btn--primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.code-map-btn:hover:not(:disabled) {
  border-color: var(--accent-hover, #79c0ff);
}

.code-map-hint {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--muted, rgba(255, 255, 255, 0.62));
}

.code-map-loading,
.code-map-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: var(--muted, rgba(255, 255, 255, 0.62));
  gap: 8px;
}

.code-map-empty-title {
  margin: 0;
  font-size: 14px;
  color: var(--text, rgba(255, 255, 255, 0.92));
}

.code-map-empty-desc {
  margin: 0;
  font-size: 12px;
  max-width: 360px;
}

.code-map-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 240px;
  gap: 10px;
}

.code-map-canvas-wrap {
  position: relative;
  min-width: 0;
  min-height: 0;
}

.code-map-canvas-busy {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: color-mix(in srgb, var(--bg, #0b1220) 55%, transparent);
  backdrop-filter: blur(2px);
  color: var(--text, rgba(255, 255, 255, 0.92));
  font-size: 13px;
  border-radius: 8px;
  pointer-events: none;
  z-index: 2;
}

.code-map-side {
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 8px;
  background: var(--bg-secondary, rgba(17, 24, 39, 0.65));
  padding: 12px;
  overflow: auto;
}

.code-map-side-kind {
  font-size: 11px;
  color: var(--accent-color, #58a6ff);
  margin-bottom: 4px;
}

.code-map-side-title {
  margin: 0 0 8px;
  font-size: 14px;
  word-break: break-word;
}

.code-map-side-path {
  margin: 0 0 8px;
  font-size: 12px;
}

.code-map-link {
  border: none;
  background: none;
  color: var(--accent-color, #58a6ff);
  cursor: pointer;
  padding: 0;
  text-align: left;
  word-break: break-all;
  font: inherit;
}

.code-map-side-summary {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--muted, rgba(255, 255, 255, 0.62));
  line-height: 1.45;
}

.code-map-side-edges {
  margin-bottom: 12px;
}

.code-map-side-label {
  font-size: 11px;
  color: var(--text-dim, rgba(255, 255, 255, 0.48));
  margin-bottom: 4px;
}

.code-map-side-edges ul {
  margin: 0;
  padding-left: 16px;
  font-size: 11px;
  color: var(--muted, rgba(255, 255, 255, 0.62));
}

.code-map-side-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.code-map-side-empty {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim, rgba(255, 255, 255, 0.48));
  line-height: 1.5;
}

@media (max-width: 960px) {
  .code-map-body {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr auto;
  }
  .code-map-side {
    max-height: 180px;
  }
}
</style>
