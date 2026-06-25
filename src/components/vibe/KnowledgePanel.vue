<template>
  <div class="knowledge-panel" :class="`knowledge-panel--${layout}`">
    <div v-if="!projectOpened && layout !== 'main'" class="panel-empty">
      <span class="panel-empty-icon" aria-hidden="true">📚</span>
      <p class="panel-empty-title">尚未打开项目</p>
      <p class="panel-empty-hint">打开项目后可构建与浏览项目知识库</p>
    </div>

    <template v-else-if="showToolbar">
      <div class="knowledge-toolbar">
        <div v-if="exploreRun.running" class="knowledge-status">
          <span class="knowledge-status-spinner" aria-hidden="true" />
          <span class="knowledge-status-text">
            {{ exploreRun.statusDetail || "正在构建知识库…" }}
            <template v-if="exploreRun.maxTurns"> · {{ exploreRun.turn }}/{{ exploreRun.maxTurns }}</template>
          </span>
          <button type="button" class="knowledge-btn knowledge-btn--danger" @click="emit('stop-explore')">
            停止
          </button>
        </div>
        <template v-else>
          <div class="knowledge-depth-switch" role="group" aria-label="探索深度">
            <button
              v-for="opt in depthOptions"
              :key="opt.id"
              type="button"
              class="knowledge-depth-btn"
              :class="{ active: depth === opt.id }"
              :aria-pressed="depth === opt.id"
              :disabled="exploreRun.running || knowledgeLoading"
              @click="depth = opt.id"
            >
              <span class="knowledge-depth-label">{{ opt.label }}</span>
              <span class="knowledge-depth-hint">{{ opt.hint }}</span>
            </button>
          </div>
          <div class="knowledge-actions">
            <button
              type="button"
              class="knowledge-btn knowledge-btn--primary"
              :disabled="!configReady || exploreRun.running || knowledgeLoading"
              @click="emit('start-explore', depth)"
            >
              {{ hasKnowledge ? "重新构建" : "开始构建知识库" }}
            </button>
            <button
              v-if="hasKnowledge"
              type="button"
              class="knowledge-btn"
              :disabled="!configReady || exploreRun.running"
              @click="emit('continue-explore')"
            >
              继续探索
            </button>
            <button
              v-if="hasKnowledge && !editing"
              type="button"
              class="knowledge-btn knowledge-btn--ghost"
              :disabled="exploreRun.running"
              @click="emit('begin-edit')"
            >
              编辑
            </button>
            <template v-if="editing">
              <button
                type="button"
                class="knowledge-btn knowledge-btn--primary"
                :disabled="knowledgeSaving"
                @click="emit('save-draft')"
              >
                {{ knowledgeSaving ? "保存中…" : "保存" }}
              </button>
              <button type="button" class="knowledge-btn knowledge-btn--ghost" @click="emit('cancel-edit')">
                取消
              </button>
            </template>
          </div>
        </template>
      </div>

      <p v-if="knowledgeMessage" class="knowledge-hint" role="status">{{ knowledgeMessage }}</p>
      <p v-if="knowledgeMeta.lastExploredAt" class="knowledge-meta">
        上次探索 {{ formatTime(knowledgeMeta.lastExploredAt) }}
        <template v-if="knowledgeMeta.exploreRounds"> · 第 {{ knowledgeMeta.exploreRounds }} 轮</template>
      </p>

      <div v-if="layout === 'sidebar' && knowledgeLoading" class="knowledge-loading">加载中…</div>

      <div
        v-else-if="layout === 'sidebar' && !hasKnowledge && !exploreRun.running"
        class="knowledge-empty-card"
      >
        <p class="knowledge-empty-title">项目知识库</p>
        <p class="knowledge-empty-desc">只读探索整个项目，生成一份可浏览、可增量更新的结构化知识库。</p>
      </div>

      <p
        v-else-if="layout === 'sidebar' && (hasKnowledge || exploreRun.running)"
        class="knowledge-sidebar-hint"
      >
        正文在中间主区域展示，便于阅读表格与长文档。
      </p>
    </template>

    <template v-if="showContent">
      <header class="knowledge-main-head">
        <h2 class="knowledge-main-title">项目知识库</h2>
        <span v-if="exploreRun.running" class="knowledge-main-badge">构建中</span>
        <div class="knowledge-main-head-actions">
          <button
            v-if="chatCollapsed"
            type="button"
            class="knowledge-btn knowledge-btn--ghost"
            @click="emit('expand-chat')"
          >
            展开 AI 助手
          </button>
        </div>
      </header>

      <div v-if="knowledgeLoading && !exploreRun.running" class="knowledge-loading">加载中…</div>

      <div
        v-else-if="!hasKnowledge && !exploreRun.running"
        class="knowledge-empty-card knowledge-empty-card--main"
      >
        <p class="knowledge-empty-title">尚未构建知识库</p>
        <p class="knowledge-empty-desc">在左侧选择探索深度并点击「开始构建知识库」。</p>
      </div>

      <template v-else>
        <nav v-if="!editing && tocSections.length > 1" class="knowledge-toc" aria-label="知识库目录">
          <button
            v-for="(section, index) in tocSections"
            :key="section.id"
            type="button"
            class="knowledge-toc-item"
            @click="scrollToSection(index)"
          >
            {{ section.title }}
          </button>
        </nav>

        <div
          v-if="!editing"
          ref="bodyRef"
          class="knowledge-body knowledge-markdown"
          v-html="renderedHtml"
          @click="onBodyClick"
        />

        <textarea
          v-else
          class="knowledge-editor"
          :value="knowledgeDraft"
          rows="18"
          spellcheck="false"
          @input="emit('update:draft', ($event.target as HTMLTextAreaElement).value)"
        />

        <div v-if="exploreRun.tools.length && exploreRun.running" class="knowledge-tools">
          <div v-for="tool in recentTools" :key="tool.id" class="knowledge-tool-item">
            <span class="knowledge-tool-name">{{ tool.name }}</span>
            <span v-if="tool.summary" class="knowledge-tool-summary">{{ tool.summary }}</span>
          </div>
        </div>

        <div v-if="hasKnowledge && !exploreRun.running && !editing" class="knowledge-followup">
          <input
            v-model="followUpDraft"
            class="knowledge-followup-input"
            type="text"
            placeholder="针对知识库追问…"
            :disabled="!configReady || exploreRun.running"
            @keydown.enter.prevent="submitFollowUp"
          />
          <button
            type="button"
            class="knowledge-btn"
            :disabled="!configReady || !followUpDraft.trim() || exploreRun.running"
            @click="submitFollowUp"
          >
            追问
          </button>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ExploreDepth } from "../../services/agentExplore";
import type { KnowledgeExploreRunState } from "../../composables/useProjectKnowledge";
import type { ProjectKnowledgeMeta } from "../../services/vibeProjectKnowledgeClient";
import { parseProjectReportDisplay } from "../../services/projectReportDisplay";
import { renderMarkdown } from "../../utils/renderMarkdown";

const props = withDefaults(
  defineProps<{
    projectOpened: boolean;
    configReady: boolean;
    hasKnowledge: boolean;
    knowledgeDraft: string;
    knowledgeMeta: ProjectKnowledgeMeta;
    knowledgeLoading: boolean;
    knowledgeSaving: boolean;
    knowledgeMessage: string;
    editing: boolean;
    displayBody: string;
    exploreRun: KnowledgeExploreRunState;
    /** sidebar: controls only; main: readable content; full: legacy single-panel layout */
    layout?: "sidebar" | "main" | "full";
    chatCollapsed?: boolean;
  }>(),
  { layout: "full", chatCollapsed: false },
);

const emit = defineEmits<{
  (e: "start-explore", depth: ExploreDepth): void;
  (e: "continue-explore"): void;
  (e: "stop-explore"): void;
  (e: "begin-edit"): void;
  (e: "cancel-edit"): void;
  (e: "save-draft"): void;
  (e: "follow-up", text: string): void;
  (e: "open-file", path: string): void;
  (e: "expand-chat"): void;
  (e: "update:draft", value: string): void;
}>();

const depth = ref<ExploreDepth>("standard");
const followUpDraft = ref("");
const bodyRef = ref<HTMLElement | null>(null);

const depthOptions: Array<{ id: ExploreDepth; label: string; hint: string }> = [
  { id: "quick", label: "快速", hint: "8 轮" },
  { id: "standard", label: "标准", hint: "16 轮" },
  { id: "deep", label: "深入", hint: "24 轮" },
];

const showToolbar = computed(
  () => props.layout === "sidebar" || props.layout === "full",
);
const showContent = computed(
  () => props.layout === "main" || props.layout === "full",
);

const tocSections = computed(() => parseProjectReportDisplay(props.displayBody).sections);
const renderedHtml = computed(() => renderMarkdown(props.displayBody));
const recentTools = computed(() => props.exploreRun.tools.slice(-6).reverse());

watch(
  () => props.exploreRun.running,
  (running, wasRunning) => {
    if (wasRunning && !running) followUpDraft.value = "";
  },
);

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function scrollToSection(index: number) {
  const root = bodyRef.value;
  if (!root) return;
  const headings = root.querySelectorAll("h1, h2, h3");
  const target = headings[index];
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function onBodyClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  const code = target?.closest("code");
  const text = code?.textContent?.trim();
  if (!text || !looksLikeFilePath(text)) return;
  emit("open-file", text);
}

function looksLikeFilePath(text: string): boolean {
  return /^[\w./@-]+\.[a-z0-9]+$/i.test(text) || /^src\//.test(text) || /^server\//.test(text);
}

function submitFollowUp() {
  const text = followUpDraft.value.trim();
  if (!text) return;
  emit("follow-up", text);
  followUpDraft.value = "";
}
</script>

<style scoped>
.knowledge-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 10px 16px;
  min-height: 0;
  height: 100%;
  overflow: auto;
}

.knowledge-panel--main {
  padding: 0;
  overflow: hidden;
  gap: 0;
}

.knowledge-panel--sidebar {
  overflow: auto;
}

.knowledge-toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.knowledge-status {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(210, 153, 34, 0.08);
  border: 1px solid rgba(210, 153, 34, 0.22);
}

.knowledge-status-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(210, 153, 34, 0.25);
  border-top-color: rgba(255, 214, 130, 0.95);
  border-radius: 50%;
  animation: knowledge-spin 0.8s linear infinite;
}

@keyframes knowledge-spin {
  to { transform: rotate(360deg); }
}

.knowledge-status-text {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: rgba(220, 220, 220, 0.92);
}

.knowledge-depth-switch {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  padding: 4px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.knowledge-depth-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 4px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: rgba(180, 190, 200, 0.95);
  cursor: pointer;
}

.knowledge-depth-btn.active {
  border-color: rgba(63, 185, 80, 0.45);
  background: rgba(63, 185, 80, 0.12);
  color: rgba(200, 245, 210, 0.98);
}

.knowledge-depth-label {
  font-size: 12px;
  font-weight: 600;
}

.knowledge-depth-hint {
  font-size: 10px;
  opacity: 0.75;
}

.knowledge-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.knowledge-btn {
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(200, 210, 220, 0.96);
  font-size: 12px;
  cursor: pointer;
}

.knowledge-btn--primary {
  border-color: rgba(63, 185, 80, 0.45);
  background: rgba(63, 185, 80, 0.14);
  color: rgba(200, 245, 210, 0.98);
  font-weight: 600;
}

.knowledge-btn--ghost {
  background: transparent;
}

.knowledge-btn--danger {
  border-color: rgba(248, 81, 73, 0.45);
  color: rgba(255, 180, 175, 0.96);
}

.knowledge-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.knowledge-hint,
.knowledge-meta {
  margin: 0;
  font-size: 11px;
  color: rgba(139, 148, 158, 0.92);
}

.knowledge-loading {
  padding: 16px;
  text-align: center;
  color: rgba(139, 148, 158, 0.92);
  font-size: 12px;
}

.knowledge-empty-card {
  padding: 20px 14px;
  border-radius: 10px;
  border: 1px dashed rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.02);
}

.knowledge-empty-title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  color: rgba(220, 225, 230, 0.96);
}

.knowledge-empty-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(139, 148, 158, 0.95);
}

.knowledge-empty-card--main {
  margin: 24px;
}

.knowledge-sidebar-hint {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 11px;
  line-height: 1.5;
  color: rgba(160, 170, 180, 0.95);
  background: rgba(63, 185, 80, 0.06);
  border: 1px solid rgba(63, 185, 80, 0.18);
}

.knowledge-main-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  height: 38px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(11, 18, 32, 0.5);
}

.knowledge-main-head-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.knowledge-main-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: rgba(220, 225, 230, 0.96);
}

.knowledge-main-badge {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 214, 130, 0.96);
  background: rgba(210, 153, 34, 0.14);
  border: 1px solid rgba(210, 153, 34, 0.25);
}

.knowledge-panel--main .knowledge-toc {
  padding: 10px 16px 0;
  flex-shrink: 0;
}

.knowledge-toc {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.knowledge-toc-item {
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(180, 190, 200, 0.95);
  font-size: 11px;
  cursor: pointer;
}

.knowledge-body {
  font-size: 12px;
  line-height: 1.55;
  overflow: auto;
  min-height: 0;
  flex: 1;
}

.knowledge-panel--main .knowledge-body {
  padding: 16px 24px 24px;
  font-size: 14px;
  line-height: 1.65;
}

.knowledge-markdown :deep(h1),
.knowledge-markdown :deep(h2),
.knowledge-markdown :deep(h3) {
  margin: 16px 0 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
}

.knowledge-markdown :deep(h1) { font-size: 1.35em; }
.knowledge-markdown :deep(h2) { font-size: 1.15em; }
.knowledge-markdown :deep(h3) { font-size: 1.05em; }

.knowledge-markdown :deep(p) {
  margin: 8px 0;
}

.knowledge-markdown :deep(ul),
.knowledge-markdown :deep(ol) {
  margin: 8px 0;
  padding-left: 22px;
}

.knowledge-markdown :deep(table) {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 13px;
}

.knowledge-markdown :deep(th),
.knowledge-markdown :deep(td) {
  padding: 8px 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  text-align: left;
  white-space: nowrap;
}

.knowledge-markdown :deep(th) {
  background: rgba(255, 255, 255, 0.06);
  font-weight: 600;
}

.knowledge-markdown :deep(code) {
  cursor: pointer;
  background: rgba(255, 255, 255, 0.1);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 0.9em;
}

.knowledge-markdown :deep(pre) {
  background: rgba(0, 0, 0, 0.3);
  padding: 10px 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 10px 0;
}

.knowledge-panel--main .knowledge-editor {
  flex: 1;
  margin: 16px;
  min-height: 0;
  font-size: 13px;
}

.knowledge-panel--main .knowledge-tools {
  margin: 0 16px;
  flex-shrink: 0;
}

.knowledge-panel--main .knowledge-followup {
  padding: 12px 16px 16px;
  flex-shrink: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(11, 18, 32, 0.35);
}

.knowledge-editor {
  width: 100%;
  min-height: 280px;
  resize: vertical;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.25);
  color: rgba(220, 225, 230, 0.96);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
}

.knowledge-tools {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.knowledge-tool-item {
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: rgba(160, 170, 180, 0.95);
}

.knowledge-tool-name {
  font-weight: 600;
  color: rgba(190, 200, 210, 0.95);
}

.knowledge-tool-summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.knowledge-followup {
  display: flex;
  gap: 6px;
  margin-top: auto;
}

.knowledge-followup-input {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.2);
  color: rgba(220, 225, 230, 0.96);
  font-size: 12px;
}
</style>
