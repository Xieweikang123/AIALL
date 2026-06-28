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
          <div
            v-if="!hasKnowledge"
            class="knowledge-depth-switch"
            role="group"
            aria-label="探索深度"
          >
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
              v-if="!hasKnowledge"
              type="button"
              class="knowledge-btn knowledge-btn--primary"
              :disabled="!exploreReady || exploreRun.running || knowledgeLoading"
              @click="emit('start-explore', depth)"
            >
              开始构建知识库
            </button>
            <button
              v-if="hasKnowledge"
              type="button"
              class="knowledge-btn"
              :disabled="!exploreReady || exploreRun.running"
              @click="emit('continue-explore')"
            >
              继续探索
            </button>
            <button
              v-if="hasKnowledge && gapSections.length && !editing"
              type="button"
              class="knowledge-btn knowledge-btn--accent"
              :disabled="!exploreReady || exploreRun.running"
              @click="fillUnexplored"
            >
              补全未探索（{{ gapSections.length }}）
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

      <div
        v-if="knowledgeOverview && (hasKnowledge || exploreRun.running) && showToolbar"
        class="knowledge-stats-card"
        aria-label="知识库概况"
      >
        <p class="knowledge-stats-title">概况</p>
        <div class="knowledge-stats-grid">
          <div class="knowledge-stat">
            <span class="knowledge-stat-label">探索覆盖</span>
            <span class="knowledge-stat-value">{{ coverageLabel }}</span>
          </div>
          <div class="knowledge-stat">
            <span class="knowledge-stat-label">字数</span>
            <span class="knowledge-stat-value">{{ formatKnowledgeSize(knowledgeOverview.charCount) }}</span>
          </div>
          <div v-if="knowledgeOverview.sectionCount > 0" class="knowledge-stat">
            <span class="knowledge-stat-label">章节</span>
            <span class="knowledge-stat-value">{{ knowledgeOverview.sectionCount }} 节</span>
          </div>
          <div v-if="gapSectionCount > 0" class="knowledge-stat knowledge-stat--warn">
            <span class="knowledge-stat-label">待补</span>
            <span class="knowledge-stat-value">{{ gapSectionCount }} 节</span>
          </div>
        </div>
        <div
          v-if="knowledgeOverview.coveragePercent != null"
          class="knowledge-coverage-bar"
          role="progressbar"
          :aria-valuenow="knowledgeOverview.coveragePercent"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="`探索覆盖 ${knowledgeOverview.coveragePercent}%`"
        >
          <div
            class="knowledge-coverage-fill"
            :style="{ width: `${knowledgeOverview.coveragePercent}%` }"
          />
        </div>
        <p class="knowledge-stats-foot">
          <template v-if="knowledgeMeta.exploreRounds">第 {{ knowledgeMeta.exploreRounds }} 轮探索</template>
          <template v-if="knowledgeMeta.lastExploredAt">
            <template v-if="knowledgeMeta.exploreRounds"> · </template>
            {{ formatTime(knowledgeMeta.lastExploredAt) }}
          </template>
          <template v-if="knowledgeMeta.gitHead"> · {{ shortGitRef(knowledgeMeta.gitHead) }}</template>
          <template v-if="knowledgeOverview.supplementCount">
            · {{ knowledgeOverview.supplementCount }} 条补充
          </template>
        </p>
      </div>

      <div
        v-if="hasKnowledge && updateHistory.length > 0"
        class="knowledge-update-history"
        aria-label="更新日志"
      >
        <p class="knowledge-update-history-title">更新日志</p>
        <div class="knowledge-update-history-list">
          <div
            v-for="(entry, index) in updateHistory"
            :key="index"
            class="knowledge-update-history-entry"
          >
            <span class="knowledge-update-history-time">{{ formatTime(entry.timestamp) }}</span>
            <span class="knowledge-update-history-charcount">{{ formatKnowledgeSize(entry.charCount) }}</span>
            <span class="knowledge-update-history-round">第 {{ entry.exploreRounds }} 轮</span>
            <span v-if="entry.gitHead" class="knowledge-update-history-git">{{ shortGitRef(entry.gitHead) }}</span>
          </div>
        </div>
      </div>

      <p v-if="knowledgeStale" class="knowledge-stale-hint" role="status">
        知识库基于提交 {{ shortGitRef(knowledgeMeta.gitHead!) }}，当前 {{ shortGitRef(currentGitHead!) }}，代码可能已变更
      </p>

      <div
        v-if="showChangesCard"
        class="knowledge-changes-card"
        aria-label="自上次探索以来的代码变更"
      >
        <div class="knowledge-changes-head">
          <p class="knowledge-changes-title">
            <template v-if="knowledgeChangesLoading">正在检测变更…</template>
            <template v-else-if="changesSummary">{{ changesSummary }}</template>
            <template v-else>代码可能已变更</template>
          </p>
          <button
            type="button"
            class="knowledge-btn knowledge-btn--accent knowledge-changes-action"
            :disabled="!exploreReady || exploreRun.running || knowledgeChangesLoading"
            @click="emit('explore-changes')"
          >
            {{ exploreChangesLabel }}
          </button>
        </div>
        <ul v-if="shownChangedFiles.length" class="knowledge-changes-list">
          <li v-for="file in shownChangedFiles" :key="file">
            <button type="button" class="knowledge-changes-file" @click="emit('open-file', file)">
              {{ file }}
            </button>
          </li>
        </ul>
        <p v-if="hiddenChangedFileCount > 0" class="knowledge-changes-more">
          另有 {{ hiddenChangedFileCount }} 个文件未列出
        </p>
      </div>

      <div v-if="layout === 'sidebar' && knowledgeLoading" class="knowledge-loading">加载中…</div>

      <div
        v-else-if="layout === 'sidebar' && !hasKnowledge && !exploreRun.running"
        class="knowledge-empty-card"
      >
        <p class="knowledge-empty-title">项目知识库</p>
        <p class="knowledge-empty-desc">只读探索整个项目，生成一份可浏览、可增量更新的结构化知识库。</p>
      </div>
    </template>

    <template v-if="showContent">
      <header class="knowledge-main-head">
        <h2 class="knowledge-main-title">项目知识库</h2>
        <span v-if="knowledgeOverview && (hasKnowledge || exploreRun.running)" class="knowledge-main-stats">
          {{ formatKnowledgeSize(knowledgeOverview.charCount) }}
          <template v-if="knowledgeOverview.coveragePercent != null">
            · 覆盖 {{ knowledgeOverview.coveragePercent }}%
          </template>
        </span>
        <span v-if="exploreRun.running" class="knowledge-main-badge knowledge-main-badge--pulse">
          {{ hasKnowledge ? "更新中" : "构建中" }}
        </span>
        <div class="knowledge-main-head-actions">
          <button
            v-if="hasKnowledge && !exploreRun.running && !editing"
            type="button"
            class="knowledge-btn knowledge-btn--ghost"
            title="复制知识库全文"
            @click="copySavedBody"
          >
            复制
          </button>
          <button
            v-if="hasKnowledge"
            type="button"
            class="knowledge-btn knowledge-btn--ghost"
            title="在编辑器打开 .aiall/project-knowledge.md"
            @click="emit('open-source')"
          >
            源文件
          </button>
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

      <div
        v-if="layout === 'main' && (knowledgeMessage || knowledgeStale || showChangesCard)"
        class="knowledge-main-alerts"
      >
        <p v-if="knowledgeMessage" class="knowledge-hint" role="status">{{ knowledgeMessage }}</p>
        <p v-if="knowledgeStale" class="knowledge-stale-hint" role="status">
          知识库基于提交 {{ shortGitRef(knowledgeMeta.gitHead!) }}，当前 {{ shortGitRef(currentGitHead!) }}，代码可能已变更
        </p>
        <div
          v-if="showChangesCard"
          class="knowledge-changes-card knowledge-changes-card--main"
          aria-label="自上次探索以来的代码变更"
        >
          <div class="knowledge-changes-head">
            <p class="knowledge-changes-title">
              <template v-if="knowledgeChangesLoading">正在检测变更…</template>
              <template v-else-if="changesSummary">{{ changesSummary }}</template>
              <template v-else>代码可能已变更</template>
            </p>
            <button
              type="button"
              class="knowledge-btn knowledge-btn--accent knowledge-changes-action"
              :disabled="!exploreReady || exploreRun.running || knowledgeChangesLoading"
              @click="emit('explore-changes')"
            >
              {{ exploreChangesLabel }}
            </button>
          </div>
          <ul v-if="shownChangedFiles.length" class="knowledge-changes-list">
            <li v-for="file in shownChangedFiles" :key="file">
              <button type="button" class="knowledge-changes-file" @click="emit('open-file', file)">
                {{ file }}
              </button>
            </li>
          </ul>
          <p v-if="hiddenChangedFileCount > 0" class="knowledge-changes-more">
            另有 {{ hiddenChangedFileCount }} 个文件未列出
          </p>
        </div>
      </div>

      <div v-if="knowledgeLoading && !exploreRun.running" class="knowledge-loading">加载中…</div>

      <div
        v-else-if="!hasKnowledge && !exploreRun.running"
        class="knowledge-empty-card knowledge-empty-card--main"
      >
        <p class="knowledge-empty-title">尚未构建知识库</p>
        <p class="knowledge-empty-desc">在左侧选择探索深度并点击「开始构建知识库」。</p>
      </div>

      <template v-else>
        <div class="knowledge-content-shell">
          <aside
            v-if="!editing && tocSections.length > 0"
            class="knowledge-toc-sidebar"
            aria-label="知识库目录"
          >
            <div class="knowledge-toc-search">
              <input
                v-model="searchQuery"
                class="knowledge-toc-search-input"
                type="search"
                placeholder="搜索章节…"
                aria-label="搜索知识库"
              />
            </div>
            <nav ref="tocNavRef" class="knowledge-toc-nav">
              <button
                v-for="section in filteredTocSections"
                :key="section.id"
                type="button"
                class="knowledge-toc-nav-item"
                :data-section-id="section.id"
                :class="{
                  active: activeSectionId === section.id,
                  'is-unexplored': unexploredSet.has(section.title),
                }"
                :style="{ paddingLeft: `${8 + (section.level - 1) * 10}px` }"
                @click="scrollToSection(section.id)"
              >
                {{ section.title }}
              </button>
              <p v-if="searchQuery.trim() && !filteredTocSections.length" class="knowledge-toc-empty">
                无匹配章节
              </p>
            </nav>
            <button
              v-if="gapSections.length && !exploreRun.running"
              type="button"
              class="knowledge-toc-fill-btn"
              :disabled="!exploreReady"
              @click="fillUnexplored"
            >
              补全未探索（{{ gapSections.length }}）
            </button>
          </aside>

          <div class="knowledge-content-main">
            <div ref="bodyScrollRef" class="knowledge-body-scroll" @scroll="onBodyScroll">
              <template v-if="!editing">
                <template v-if="showIncrementalLiveLayout">
                  <div
                    ref="bodyRef"
                    class="knowledge-body knowledge-markdown knowledge-body--saved"
                    :class="{ 'knowledge-body--saved-dim': liveDisplayHtml }"
                    v-html="savedDisplayHtml"
                    @click="onBodyClick"
                  />

                  <div
                    v-if="exploreRun.assistantText.trim()"
                    class="knowledge-stream-preview"
                    role="status"
                    aria-live="polite"
                  >
                    <p class="knowledge-stream-preview-label">
                      <span class="knowledge-status-spinner" aria-hidden="true" />
                      {{ liveUpdateLabel }}
                    </p>
                    <div
                      class="knowledge-body knowledge-markdown knowledge-stream-preview-body knowledge-body--streaming"
                      v-html="liveDisplayHtml"
                    />
                  </div>

                  <div
                    v-else-if="exploreRun.running"
                    class="knowledge-stream-waiting"
                    role="status"
                  >
                    <span class="knowledge-status-spinner" aria-hidden="true" />
                    正在阅读项目代码，更新内容将显示在下方…
                  </div>
                </template>

                <template v-else>
                  <div
                    v-if="exploreRun.running && !hasKnowledge && !displayHtml"
                    class="knowledge-stream-waiting knowledge-stream-waiting--initial"
                    role="status"
                  >
                    <span class="knowledge-status-spinner" aria-hidden="true" />
                    正在探索项目结构，知识库内容即将出现…
                  </div>
                  <div
                    v-else
                    ref="bodyRef"
                    class="knowledge-body knowledge-markdown"
                    :class="{ 'knowledge-body--streaming': exploreRun.running }"
                    v-html="displayHtml"
                    @click="onBodyClick"
                  />
                </template>
              </template>

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
            </div>

            <div
              v-if="hasKnowledge && !editing"
              class="knowledge-followup"
              :class="{ 'knowledge-followup--busy': exploreRun.running }"
            >
              <div v-if="exploreRun.running" class="knowledge-followup-status" role="status">
                <span class="knowledge-status-spinner" aria-hidden="true" />
                <span class="knowledge-followup-status-text">
                  <template v-if="pendingFollowUpText">
                    正在处理：{{ pendingFollowUpText }}
                  </template>
                  <template v-else>
                    {{ exploreRun.statusDetail || "正在更新知识库…" }}
                  </template>
                  <template v-if="exploreRun.maxTurns">
                    · {{ exploreRun.turn }}/{{ exploreRun.maxTurns }}
                  </template>
                </span>
                <button
                  type="button"
                  class="knowledge-btn knowledge-btn--danger knowledge-btn--compact"
                  @click="emit('stop-explore')"
                >
                  停止
                </button>
              </div>
              <div v-if="quotedExcerpt && !exploreRun.running" class="knowledge-quoted-preview">
                <div class="knowledge-quoted-header">
                  <span class="knowledge-quoted-label">
                    <span aria-hidden="true">❝</span> 引用段落
                  </span>
                  <button
                    type="button"
                    class="knowledge-quoted-close"
                    aria-label="移除引用"
                    @click="clearQuotedExcerpt"
                  >
                    ×
                  </button>
                </div>
                <p class="knowledge-quoted-body">{{ quotedExcerptPreview }}</p>
              </div>
              <div class="knowledge-followup-row">
                <button
                  v-if="!exploreRun.running"
                  type="button"
                  class="knowledge-btn knowledge-btn--ghost knowledge-btn--quote"
                  :disabled="!bodySelectionText"
                  title="将当前选中的正文引用到追问框"
                  @mousedown.prevent
                  @click="quoteCurrentSelection"
                >
                  引用选中
                </button>
                <input
                  ref="followUpInputRef"
                  v-model="followUpDraft"
                  class="knowledge-followup-input"
                  type="text"
                  :placeholder="followUpPlaceholder"
                  :disabled="!exploreReady || exploreRun.running"
                  @compositionstart="followUpComposing = true"
                  @compositionend="followUpComposing = false"
                  @keydown="onFollowUpKeydown"
                />
                <button
                  type="button"
                  class="knowledge-btn"
                  :disabled="!exploreReady || !canSubmitFollowUp || exploreRun.running"
                  @click="() => submitFollowUp()"
                >
                  追问
                </button>
              </div>
              <div v-if="!exploreRun.running" class="knowledge-followup-chips">
                <span class="knowledge-followup-chips-label">快捷追问</span>
                <button
                  v-for="chip in followUpChips"
                  :key="chip"
                  type="button"
                  class="knowledge-followup-chip"
                  :disabled="!exploreReady"
                  @click="submitFollowUpChip(chip)"
                >
                  {{ chip }}
                </button>
              </div>
            </div>
          </div>
        </div>
        <p v-if="actionHint" class="knowledge-action-hint" role="status">{{ actionHint }}</p>
      </template>
    </template>

    <Teleport v-if="layout === 'main'" to="body">
      <button
        v-if="showKnowledgeQuoteButton"
        type="button"
        class="quote-floating knowledge-quote-floating"
        :style="{ left: `${knowledgeQuoteButtonPos.x}px`, top: `${knowledgeQuoteButtonPos.y}px` }"
        @mousedown.stop.prevent="quoteSelectedExcerpt"
      >
        <span class="quote-icon" aria-hidden="true">❝</span> 引用追问
      </button>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  EXPLORE_QUICK_FOLLOWUP_CHIPS,
  buildExploreUnexploredPrompt,
  buildKnowledgeQuoteFollowUpPrompt,
  type ExploreDepth,
} from "../../services/agentExplore";
import type { KnowledgeExploreRunState } from "../../composables/useProjectKnowledge";
import {
  KNOWLEDGE_CHANGES_LIST_MAX,
  summarizeKnowledgeChanges,
} from "../../services/knowledgeGitChanges";
import type { ProjectKnowledgeMeta } from "../../services/vibeProjectKnowledgeClient";
import {
  computeKnowledgeOverview,
  findGapSectionTitles,
  formatKnowledgeSize,
  highlightHtmlText,
  injectReportHeadingIds,
  isKnowledgeMarkdownFilePath,
  parseKnowledgeTocSections,
} from "../../services/projectReportDisplay";
import { renderMarkdown, renderMarkdownLite } from "../../utils/renderMarkdown";
import { createStreamingMarkdownThrottle } from "../../utils/streamingMarkdownThrottle";
import { prepareStreamingMarkdownForRender } from "../../utils/streamingMarkdownTrim";

const props = withDefaults(
  defineProps<{
    projectOpened: boolean;
    configReady: boolean;
    apiKeyReady?: boolean;
    hasKnowledge: boolean;
    knowledgeDraft: string;
    knowledgeMeta: ProjectKnowledgeMeta;
    knowledgeLoading: boolean;
    knowledgeSaving: boolean;
    knowledgeMessage: string;
    editing: boolean;
    displayBody: string;
    savedBody: string;
    exploreRun: KnowledgeExploreRunState;
    currentGitHead?: string;
    knowledgeChangedFiles?: string[];
    knowledgeChangesLoading?: boolean;
    knowledgeChangesAvailable?: boolean;
    /** sidebar: controls only; main: readable content; full: legacy single-panel layout */
    layout?: "sidebar" | "main" | "full";
    chatCollapsed?: boolean;
  }>(),
  { layout: "full", chatCollapsed: false, currentGitHead: "", savedBody: "", apiKeyReady: true, knowledgeChangedFiles: () => [], knowledgeChangesLoading: false, knowledgeChangesAvailable: false },
);

const exploreReady = computed(() => props.configReady && props.apiKeyReady);

const updateHistory = computed(() => {
  const history = props.knowledgeMeta.updateHistory;
  if (!history || !Array.isArray(history)) return [];
  return [...history].reverse();
});

const knowledgeStale = computed(() => {
  const saved = props.knowledgeMeta.gitHead?.trim();
  const current = props.currentGitHead?.trim();
  return Boolean(saved && current && saved !== current);
});

const showChangesCard = computed(
  () => props.hasKnowledge && props.knowledgeChangesAvailable && !props.exploreRun.running,
);

const shownChangedFiles = computed(
  () => (props.knowledgeChangedFiles ?? []).slice(0, KNOWLEDGE_CHANGES_LIST_MAX),
);

const hiddenChangedFileCount = computed(() => {
  const total = props.knowledgeChangedFiles?.length ?? 0;
  return Math.max(0, total - shownChangedFiles.value.length);
});

const changesSummary = computed(() =>
  summarizeKnowledgeChanges(props.knowledgeChangedFiles ?? [], {
    knowledgeStale: knowledgeStale.value,
  }),
);

const exploreChangesLabel = computed(() =>
  (props.knowledgeChangedFiles?.length ?? 0) > 0 ? "针对变更探索" : "继续探索更新",
);

const emit = defineEmits<{
  (e: "start-explore", depth: ExploreDepth): void;
  (e: "continue-explore"): void;
  (e: "explore-changes"): void;
  (e: "stop-explore"): void;
  (e: "begin-edit"): void;
  (e: "cancel-edit"): void;
  (e: "save-draft"): void;
  (e: "follow-up", text: string): void;
  (e: "open-file", path: string): void;
  (e: "open-source"): void;
  (e: "expand-chat"): void;
  (e: "update:draft", value: string): void;
}>();

const depth = ref<ExploreDepth>("standard");
const followUpDraft = ref("");
const followUpComposing = ref(false);
const pendingFollowUpText = ref("");
const quotedExcerpt = ref("");
const pendingSelectionText = ref("");
const bodySelectionText = ref("");
const showKnowledgeQuoteButton = ref(false);
const knowledgeQuoteButtonPos = ref({ x: 0, y: 0 });
const followUpInputRef = ref<HTMLInputElement | null>(null);
let selectionQuoteTimer: ReturnType<typeof setTimeout> | null = null;
let quoteHiddenAt = 0;
const searchQuery = ref("");
const actionHint = ref("");
const activeSectionId = ref("");
const bodyRef = ref<HTMLElement | null>(null);
const bodyScrollRef = ref<HTMLElement | null>(null);
const tocNavRef = ref<HTMLElement | null>(null);
let actionHintTimer: ReturnType<typeof setTimeout> | null = null;
let suppressScrollActiveSection = false;

const depthOptions: Array<{ id: ExploreDepth; label: string; hint: string }> = [
  { id: "quick", label: "快速", hint: "8 轮" },
  { id: "standard", label: "标准", hint: "16 轮" },
  { id: "deep", label: "深入", hint: "24 轮" },
];

/** Dynamic chips: prepend "补全未探索" when there are unexplored sections. */
const followUpChips = computed(() => {
  const base = [...EXPLORE_QUICK_FOLLOWUP_CHIPS];
  if (gapSections.value.length > 0) {
    return [`补全未探索（${gapSections.value.length}）`, ...base] as string[];
  }
  return base as string[];
});

const FOLLOWUP_STATUS_PREVIEW_MAX = 48;
const QUOTED_EXCERPT_PREVIEW_MAX = 160;
const QUOTE_BUTTON_EST_WIDTH = 108;
const QUOTE_BUTTON_EST_HEIGHT = 32;

const quoteSelectionEnabled = computed(() => props.layout === "main");

const followUpPlaceholder = computed(() => {
  if (props.exploreRun.running) return "完成后可继续追问…";
  if (quotedExcerpt.value.trim()) return "针对引用段落提问（可直接发送核实）…";
  return "针对知识库追问，或选中正文后引用…";
});

const canSubmitFollowUp = computed(
  () => Boolean(followUpDraft.value.trim() || quotedExcerpt.value.trim()),
);

const quotedExcerptPreview = computed(() => {
  const text = quotedExcerpt.value.trim();
  if (text.length <= QUOTED_EXCERPT_PREVIEW_MAX) return text;
  return `${text.slice(0, QUOTED_EXCERPT_PREVIEW_MAX)}…`;
});

function previewFollowUpStatus(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= FOLLOWUP_STATUS_PREVIEW_MAX) return trimmed;
  return `${trimmed.slice(0, FOLLOWUP_STATUS_PREVIEW_MAX)}…`;
}

const showToolbar = computed(
  () => props.layout === "sidebar" || props.layout === "full",
);
const showContent = computed(
  () => props.layout === "main" || props.layout === "full",
);

/** TOC / coverage stats use saved body during incremental explore streaming. */
const tocSourceBody = computed(() => {
  if (props.exploreRun.running && props.hasKnowledge) {
    return (props.savedBody || props.displayBody).trim();
  }
  return props.displayBody;
});

const tocSections = computed(() => parseKnowledgeTocSections(tocSourceBody.value));
const gapSections = computed(() => findGapSectionTitles(tocSourceBody.value));
const unexploredSet = computed(() => new Set(gapSections.value));

const overviewSourceBody = computed(() => {
  if (props.editing) return props.knowledgeDraft;
  if (props.exploreRun.running && props.hasKnowledge) {
    return (props.savedBody || props.displayBody).trim();
  }
  if (props.exploreRun.running) return props.displayBody;
  if (props.hasKnowledge) return props.savedBody || props.displayBody;
  return "";
});

const knowledgeOverview = computed(() => {
  const body = overviewSourceBody.value.trim();
  if (!body) return null;
  return computeKnowledgeOverview(body);
});

const gapSectionCount = computed(() => {
  const o = knowledgeOverview.value;
  if (!o) return 0;
  return o.unexploredSections + o.pendingSections;
});

const coverageLabel = computed(() => {
  const o = knowledgeOverview.value;
  if (!o) return "—";
  if (o.sectionCount === 0) {
    return o.charCount > 0 ? "未分章节" : "—";
  }
  const parts = [`${o.coveredSections}/${o.sectionCount} 章`];
  if (o.coveragePercent != null) parts.push(`${o.coveragePercent}%`);
  return parts.join(" · ");
});

const filteredTocSections = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return tocSections.value;
  return tocSections.value.filter((s) => s.title.toLowerCase().includes(q));
});

/** When search narrows results, auto-scroll body to the first matching section. */
watch(
  () => filteredTocSections.value,
  (sections) => {
    if (!searchQuery.value.trim()) return;
    if (!sections.length) return;
    void nextTick(() => scrollToSection(sections[0]!.id));
  },
);

const showIncrementalLiveLayout = computed(
  () => props.exploreRun.running && props.hasKnowledge && !props.editing,
);

const liveUpdateLabel = computed(() => {
  switch (props.exploreRun.intent) {
    case "section_fill":
      return "正在补全章节（预览，完成后合并写入）";
    case "changes":
      return "正在根据代码变更更新（预览，完成后合并写入）";
    case "continue":
      return "正在扩展知识库（预览，完成后合并写入）";
    case "followup":
      return "正在处理追问（预览，完成后合并写入）";
    case "rebuild":
      return "正在重新构建（预览，完成后写入磁盘）";
    default:
      return "正在生成更新（预览，完成后写入磁盘）";
  }
});

const displayHtml = ref("");
const savedDisplayHtml = ref("");
const liveDisplayHtml = ref("");
const stickScrollToBottom = ref(true);
const SCROLL_BOTTOM_THRESHOLD = 64;

function buildFinalKnowledgeHtml(body: string, sections = tocSections.value): string {
  if (!body.trim()) return "";
  const html = injectReportHeadingIds(renderMarkdown(body), sections);
  return highlightHtmlText(html, searchQuery.value);
}

function buildStreamingKnowledgeHtml(body: string, sections = tocSections.value): string {
  if (!body.trim()) return "";
  const prepared = prepareStreamingMarkdownForRender(body);
  const html = injectReportHeadingIds(renderMarkdownLite(prepared), sections);
  return highlightHtmlText(html, searchQuery.value);
}

const streamingMarkdownThrottle = createStreamingMarkdownThrottle(undefined, (text) => {
  displayHtml.value = buildStreamingKnowledgeHtml(text);
});

const liveStreamingThrottle = createStreamingMarkdownThrottle(undefined, (text) => {
  liveDisplayHtml.value = buildStreamingKnowledgeHtml(text);
});

function refreshSavedDisplayHtml() {
  const body = (props.savedBody || "").trim();
  savedDisplayHtml.value = body ? buildFinalKnowledgeHtml(body) : "";
}

function scrollBodyToBottom(force = false) {
  const el = bodyScrollRef.value;
  if (!el) return;
  if (!force && !stickScrollToBottom.value) return;
  el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
}

function refreshDisplayHtml() {
  if (props.editing) {
    displayHtml.value = "";
    savedDisplayHtml.value = "";
    liveDisplayHtml.value = "";
    return;
  }

  if (showIncrementalLiveLayout.value) {
    displayHtml.value = "";
    refreshSavedDisplayHtml();
    const live = props.exploreRun.assistantText;
    if (live.trim()) {
      liveStreamingThrottle.pushSource(live, true);
    } else {
      liveDisplayHtml.value = "";
      liveStreamingThrottle.pushSource("", false);
    }
    return;
  }

  savedDisplayHtml.value = "";
  liveDisplayHtml.value = "";
  liveStreamingThrottle.pushSource("", false);

  const body = props.displayBody;
  const streaming = props.exploreRun.running;
  if (!body.trim()) {
    displayHtml.value = "";
    streamingMarkdownThrottle.dispose();
    return;
  }
  if (streaming) {
    streamingMarkdownThrottle.pushSource(body, true);
    return;
  }
  streamingMarkdownThrottle.pushSource(body, false);
  displayHtml.value = buildFinalKnowledgeHtml(body);
}

watch(
  () => [
    props.displayBody,
    props.savedBody,
    props.exploreRun.running,
    props.exploreRun.assistantText,
    props.exploreRun.intent,
    props.hasKnowledge,
    props.editing,
    searchQuery.value,
    tocSections.value,
  ] as const,
  () => refreshDisplayHtml(),
  { immediate: true },
);

watch(
  () => props.exploreRun.running,
  (running, wasRunning) => {
    if (running && !wasRunning) {
      stickScrollToBottom.value = true;
    }
    if (wasRunning && !running) {
      followUpDraft.value = "";
      pendingFollowUpText.value = "";
      void nextTick(() => scrollBodyToBottom(true));
    }
  },
);

watch(
  () => [displayHtml.value, liveDisplayHtml.value, props.exploreRun.running] as const,
  ([, , running]) => {
    if (!running) return;
    void nextTick(() => scrollBodyToBottom());
  },
);

watch(
  () => [props.displayBody, props.editing, displayHtml.value, savedDisplayHtml.value] as const,
  () => {
    void nextTick(() => updateActiveSectionFromScroll());
  },
);

onMounted(() => {
  void nextTick(() => updateActiveSectionFromScroll());
  if (!quoteSelectionEnabled.value) return;
  document.addEventListener("mouseup", onDocumentMouseUpForQuote);
  document.addEventListener("selectionchange", onSelectionChangeForQuote);
  document.addEventListener("mousedown", onDocumentMouseDownForQuote);
});

onBeforeUnmount(() => {
  streamingMarkdownThrottle.dispose();
  liveStreamingThrottle.dispose();
  if (actionHintTimer) clearTimeout(actionHintTimer);
  if (selectionQuoteTimer) clearTimeout(selectionQuoteTimer);
  if (!quoteSelectionEnabled.value) return;
  document.removeEventListener("mouseup", onDocumentMouseUpForQuote);
  document.removeEventListener("selectionchange", onSelectionChangeForQuote);
  document.removeEventListener("mousedown", onDocumentMouseDownForQuote);
});

const recentTools = computed(() => props.exploreRun.tools.slice(-6).reverse());

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function shortGitRef(ref: string): string {
  const trimmed = ref.trim();
  if (trimmed.length <= 10) return trimmed;
  return trimmed.slice(0, 7);
}

function showActionHint(text: string) {
  actionHint.value = text;
  if (actionHintTimer) clearTimeout(actionHintTimer);
  actionHintTimer = setTimeout(() => {
    actionHint.value = "";
  }, 2200);
}

function scrollToSection(sectionId: string) {
  const scrollRoot = bodyScrollRef.value;
  const root = bodyRef.value;
  if (!scrollRoot || !root) return;
  const target = root.querySelector(`#${sectionId}`);
  if (!(target instanceof HTMLElement)) return;
  activeSectionId.value = sectionId;
  suppressScrollActiveSection = true;
  const scrollTop =
    target.getBoundingClientRect().top
    - scrollRoot.getBoundingClientRect().top
    + scrollRoot.scrollTop;
  scrollRoot.scrollTo({ top: Math.max(0, scrollTop - 8), behavior: "auto" });
  requestAnimationFrame(() => { suppressScrollActiveSection = false; });
}

function scrollActiveTocIntoView(sectionId: string) {
  const nav = tocNavRef.value;
  if (!nav) return;
  const btn = nav.querySelector(`[data-section-id="${sectionId}"]`);
  if (btn instanceof HTMLElement) {
    btn.scrollIntoView({ block: "nearest" });
  }
}

function updateActiveSectionFromScroll() {
  if (suppressScrollActiveSection) return;
  const scrollRoot = bodyScrollRef.value;
  const root = bodyRef.value;
  if (!scrollRoot || !root || props.editing || !tocSections.value.length) return;

  const anchorTop = scrollRoot.getBoundingClientRect().top + 12;
  let nextId = tocSections.value[0]!.id;

  for (const section of tocSections.value) {
    const el = root.querySelector(`#${section.id}`);
    if (!(el instanceof HTMLElement)) continue;
    if (el.getBoundingClientRect().top <= anchorTop) {
      nextId = section.id;
    } else {
      break;
    }
  }

  if (nextId !== activeSectionId.value) {
    activeSectionId.value = nextId;
    scrollActiveTocIntoView(nextId);
  }
}

function onBodyScroll() {
  updateActiveSectionFromScroll();
  hideKnowledgeQuoteButton();
  const el = bodyScrollRef.value;
  if (!el || !props.exploreRun.running) return;
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
  stickScrollToBottom.value = distance <= SCROLL_BOTTOM_THRESHOLD;
}

function selectionRectUsable(rect: DOMRect): boolean {
  return rect.width > 0 || rect.height > 0;
}

function selectionWithinBody(selection: Selection, root: HTMLElement): boolean {
  if (!selection.rangeCount) return false;
  const node = selection.getRangeAt(0).commonAncestorContainer;
  const el = node.nodeType === Node.ELEMENT_NODE
    ? (node as Element)
    : node.parentElement;
  return Boolean(el && root.contains(el));
}

function getKnowledgeSelectionAnchorRect(selection: Selection): DOMRect | null {
  const range = selection.getRangeAt(0);
  const lineRects = Array.from(range.getClientRects()).filter(selectionRectUsable);
  if (lineRects.length > 0) return lineRects[0]!;

  const bounds = range.getBoundingClientRect();
  if (selectionRectUsable(bounds)) return bounds;

  const startNode = range.startContainer;
  const anchorEl = startNode.nodeType === Node.ELEMENT_NODE
    ? (startNode as Element)
    : startNode.parentElement;
  if (anchorEl) {
    const anchorRect = anchorEl.getBoundingClientRect();
    if (anchorRect.width || anchorRect.height) return anchorRect;
  }
  return null;
}

function clampKnowledgeQuoteButtonPos(x: number, y: number, width: number, height: number) {
  const margin = 8;
  const maxX = window.innerWidth - width - margin;
  const maxY = window.innerHeight - height - margin;
  return {
    x: Math.min(Math.max(margin, x), Math.max(margin, maxX)),
    y: Math.min(Math.max(margin, y), Math.max(margin, maxY)),
  };
}

function positionKnowledgeQuoteButton(anchor: DOMRect) {
  const margin = 8;
  const bottomSafe = 120;
  let x = anchor.left + (anchor.width - QUOTE_BUTTON_EST_WIDTH) / 2;
  let y = anchor.top - QUOTE_BUTTON_EST_HEIGHT - margin;
  if (y < margin) y = anchor.bottom + margin;
  const maxBottom = window.innerHeight - bottomSafe;
  if (y + QUOTE_BUTTON_EST_HEIGHT > maxBottom) y = maxBottom - QUOTE_BUTTON_EST_HEIGHT;
  knowledgeQuoteButtonPos.value = clampKnowledgeQuoteButtonPos(
    x,
    y,
    QUOTE_BUTTON_EST_WIDTH,
    QUOTE_BUTTON_EST_HEIGHT,
  );
}

function hideKnowledgeQuoteButton() {
  showKnowledgeQuoteButton.value = false;
  pendingSelectionText.value = "";
  quoteHiddenAt = Date.now();
}

function refreshBodySelection() {
  if (!quoteSelectionEnabled.value) {
    bodySelectionText.value = "";
    return;
  }
  const root = bodyRef.value;
  const selection = window.getSelection();
  if (!root || !selection || selection.isCollapsed || !selectionWithinBody(selection, root)) {
    bodySelectionText.value = "";
    return;
  }
  bodySelectionText.value = selection.toString().trim();
}

function tryShowKnowledgeQuoteButton() {
  if (!quoteSelectionEnabled.value) return;
  refreshBodySelection();
  const root = bodyRef.value;
  const selection = window.getSelection();
  if (!root || !selection || selection.isCollapsed || props.editing || props.exploreRun.running) {
    hideKnowledgeQuoteButton();
    return;
  }
  if (!selectionWithinBody(selection, root)) {
    hideKnowledgeQuoteButton();
    return;
  }
  const text = bodySelectionText.value;
  if (text.length < 2) {
    hideKnowledgeQuoteButton();
    return;
  }
  const anchor = getKnowledgeSelectionAnchorRect(selection);
  if (!anchor) {
    hideKnowledgeQuoteButton();
    return;
  }
  pendingSelectionText.value = text;
  positionKnowledgeQuoteButton(anchor);
  showKnowledgeQuoteButton.value = true;
}

function scheduleSelectionQuoteCheck() {
  if (!quoteSelectionEnabled.value) return;
  if (selectionQuoteTimer) clearTimeout(selectionQuoteTimer);
  selectionQuoteTimer = setTimeout(() => {
    selectionQuoteTimer = null;
    tryShowKnowledgeQuoteButton();
  }, 20);
}

function onDocumentMouseUpForQuote() {
  scheduleSelectionQuoteCheck();
}

function onSelectionChangeForQuote() {
  scheduleSelectionQuoteCheck();
}

function onDocumentMouseDownForQuote(event: MouseEvent) {
  if (!showKnowledgeQuoteButton.value) return;
  if (Date.now() - quoteHiddenAt < 120) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest(".knowledge-quote-floating")) return;
  if (bodyRef.value?.contains(target)) return;
  hideKnowledgeQuoteButton();
}

function quoteCurrentSelection() {
  const text = bodySelectionText.value.trim() || pendingSelectionText.value.trim();
  if (!text) return;
  quotedExcerpt.value = text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
  hideKnowledgeQuoteButton();
  bodySelectionText.value = "";
  window.getSelection()?.removeAllRanges();
  void nextTick(() => followUpInputRef.value?.focus());
  showActionHint("已引用选中段落");
}

function quoteSelectedExcerpt() {
  quoteCurrentSelection();
}

function clearQuotedExcerpt() {
  quotedExcerpt.value = "";
}

function buildFollowUpPayload(userQuestion: string): string {
  const q = userQuestion.trim();
  if (quotedExcerpt.value.trim()) {
    return buildKnowledgeQuoteFollowUpPrompt(quotedExcerpt.value, q);
  }
  return q;
}

function onBodyClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  const code = target?.closest("code");
  const text = code?.textContent?.trim();
  if (!text || !isKnowledgeMarkdownFilePath(text)) return;
  emit("open-file", text.replace(/\\/g, "/"));
}

function onFollowUpKeydown(e: KeyboardEvent) {
  if (e.key !== "Enter" || e.shiftKey) return;
  if (e.isComposing || followUpComposing.value) return;
  e.preventDefault();
  submitFollowUp();
}

function submitFollowUp(text?: string) {
  if (!props.configReady) {
    showActionHint("请先配置 AI 模型");
    return;
  }
  if (!props.apiKeyReady) {
    showActionHint("请先保存 API Key");
    return;
  }
  if (props.exploreRun.running) return;
  const userQuestion = (text ?? followUpDraft.value).trim();
  if (!userQuestion && !quotedExcerpt.value.trim()) return;
  const payload = buildFollowUpPayload(userQuestion);
  pendingFollowUpText.value = previewFollowUpStatus(
    quotedExcerpt.value.trim()
      ? `引用追问：${userQuestion || "核实补充"}`
      : userQuestion,
  );
  emit("follow-up", payload);
  followUpDraft.value = "";
  quotedExcerpt.value = "";
}

function submitFollowUpChip(chip: string) {
  if (chip.startsWith("补全未探索")) {
    fillUnexplored();
  } else {
    submitFollowUp(chip);
  }
}

function fillUnexplored() {
  const prompt = buildExploreUnexploredPrompt(gapSections.value);
  pendingFollowUpText.value = "补全未探索章节";
  emit("follow-up", prompt);
}

async function copySavedBody() {
  const text = props.savedBody.trim() || props.displayBody.trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showActionHint("已复制知识库全文");
  } catch {
    showActionHint("复制失败，请检查浏览器权限");
  }
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

.knowledge-panel--main .knowledge-content-shell {
  flex: 1;
  min-height: 0;
}

.knowledge-content-shell {
  display: flex;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.knowledge-toc-sidebar {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 196px;
  min-height: 0;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.18);
}

.knowledge-toc-search {
  flex-shrink: 0;
  padding: 10px 10px 6px;
}

.knowledge-toc-search-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(0, 0, 0, 0.22);
  color: rgba(220, 225, 230, 0.96);
  font-size: 12px;
}

.knowledge-toc-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 6px 8px;
}

.knowledge-toc-nav-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(170, 180, 190, 0.95);
  font-size: 11px;
  line-height: 1.35;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.knowledge-toc-nav-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(220, 225, 230, 0.98);
}

.knowledge-toc-nav-item.active {
  background: rgba(63, 185, 80, 0.14);
  color: rgba(200, 245, 210, 0.98);
}

.knowledge-toc-nav-item.is-unexplored {
  color: rgba(255, 214, 130, 0.92);
}

.knowledge-toc-nav-item.is-unexplored.active {
  color: rgba(255, 230, 170, 0.98);
}

.knowledge-toc-empty {
  margin: 8px 4px 0;
  font-size: 11px;
  color: rgba(139, 148, 158, 0.9);
}

.knowledge-toc-fill-btn {
  flex-shrink: 0;
  margin: 0 8px 10px;
  padding: 7px 10px;
  border-radius: 6px;
  border: 1px solid rgba(210, 153, 34, 0.4);
  background: rgba(210, 153, 34, 0.12);
  color: rgba(255, 214, 130, 0.98);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.knowledge-toc-fill-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.knowledge-content-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.knowledge-body-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
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

.knowledge-btn--accent {
  border-color: rgba(210, 153, 34, 0.45);
  background: rgba(210, 153, 34, 0.12);
  color: rgba(255, 214, 130, 0.98);
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
.knowledge-action-hint {
  margin: 0;
  font-size: 11px;
  color: rgba(139, 148, 158, 0.92);
}

.knowledge-stats-card {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.knowledge-stats-title {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 600;
  color: rgba(180, 190, 200, 0.95);
  letter-spacing: 0.02em;
}

.knowledge-stats-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 10px;
}

.knowledge-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.knowledge-stat-label {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.92);
}

.knowledge-stat-value {
  font-size: 12px;
  font-weight: 600;
  color: rgba(220, 225, 230, 0.96);
  line-height: 1.35;
}

.knowledge-stat--warn .knowledge-stat-value {
  color: rgba(255, 214, 130, 0.98);
}

.knowledge-coverage-bar {
  margin-top: 10px;
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.knowledge-coverage-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, rgba(63, 185, 80, 0.85), rgba(120, 210, 140, 0.95));
  transition: width 0.2s ease;
}

.knowledge-stats-foot {
  margin: 8px 0 0;
  font-size: 10px;
  line-height: 1.45;
  color: rgba(139, 148, 158, 0.92);
}

.knowledge-update-history {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.knowledge-update-history-title {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 600;
  color: rgba(180, 190, 200, 0.95);
  letter-spacing: 0.02em;
}

.knowledge-update-history-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 150px;
  overflow: auto;
}

.knowledge-update-history-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.35;
  color: rgba(180, 190, 200, 0.95);
}

.knowledge-update-history-entry:hover {
  background: rgba(255, 255, 255, 0.04);
}

.knowledge-update-history-time {
  color: rgba(139, 148, 158, 0.92);
  flex-shrink: 0;
}

.knowledge-update-history-charcount {
  color: rgba(200, 245, 210, 0.98);
  font-weight: 600;
  flex-shrink: 0;
}

.knowledge-update-history-round {
  color: rgba(160, 170, 180, 0.95);
  flex-shrink: 0;
}

.knowledge-update-history-git {
  color: rgba(139, 148, 158, 0.92);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  flex-shrink: 0;
}

.knowledge-main-stats {
  font-size: 11px;
  font-weight: 500;
  color: rgba(160, 170, 180, 0.95);
}

.knowledge-main-alerts {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 14px 0;
  flex-shrink: 0;
}

.knowledge-stale-hint {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 11px;
  line-height: 1.45;
  color: rgba(255, 214, 130, 0.96);
  background: rgba(210, 153, 34, 0.1);
  border: 1px solid rgba(210, 153, 34, 0.28);
}

.knowledge-changes-card {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(88, 166, 255, 0.06);
  border: 1px solid rgba(88, 166, 255, 0.22);
}

.knowledge-changes-card--main {
  margin-top: 0;
}

.knowledge-changes-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.knowledge-changes-title {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.45;
  color: rgba(190, 215, 255, 0.98);
}

.knowledge-changes-action {
  flex-shrink: 0;
  white-space: nowrap;
}

.knowledge-changes-list {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 140px;
  overflow: auto;
}

.knowledge-changes-file {
  display: block;
  width: 100%;
  padding: 4px 6px;
  border: none;
  border-radius: 4px;
  background: transparent;
  text-align: left;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.35;
  color: rgba(180, 205, 245, 0.95);
  cursor: pointer;
}

.knowledge-changes-file:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(220, 235, 255, 0.98);
}

.knowledge-changes-more {
  margin: 6px 0 0;
  font-size: 10px;
  color: rgba(139, 170, 210, 0.9);
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

.knowledge-main-badge--pulse {
  animation: knowledge-badge-pulse 1.6s ease-in-out infinite;
}

@keyframes knowledge-badge-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.65; }
}

.knowledge-panel--main .knowledge-body {
  padding: 16px 24px 24px;
  font-size: 14px;
  line-height: 1.65;
}

.knowledge-markdown :deep(.knowledge-search-hit) {
  background: rgba(210, 153, 34, 0.35);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
}

.knowledge-markdown :deep(h1),
.knowledge-markdown :deep(h2),
.knowledge-markdown :deep(h3),
.knowledge-markdown :deep(h4) {
  margin: 16px 0 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
}

.knowledge-markdown :deep(h1) { font-size: 1.35em; }
.knowledge-markdown :deep(h2) { font-size: 1.15em; }
.knowledge-markdown :deep(h3) { font-size: 1.05em; }
.knowledge-markdown :deep(h4) { font-size: 1em; color: rgba(230, 236, 244, 0.92); }

.knowledge-markdown :deep(p) {
  margin: 8px 0;
}

.knowledge-markdown :deep(ul),
.knowledge-markdown :deep(ol) {
  margin: 8px 0;
  padding-left: 22px;
}

.knowledge-markdown :deep(li) {
  margin: 4px 0;
}

.knowledge-markdown :deep(li > ul),
.knowledge-markdown :deep(li > ol) {
  margin: 4px 0 2px;
}

.knowledge-markdown :deep(li > p) {
  margin: 0;
}

.knowledge-markdown :deep(strong) {
  color: rgba(240, 245, 250, 0.98);
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

.knowledge-body {
  font-size: 12px;
  line-height: 1.55;
  min-height: 0;
  user-select: text;
  cursor: text;
}

.knowledge-body--saved-dim {
  opacity: 0.82;
  transition: opacity 0.2s ease;
}

.knowledge-body--streaming::after {
  content: "";
  display: inline-block;
  width: 2px;
  height: 0.95em;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: rgba(63, 185, 80, 0.92);
  animation: knowledge-cursor-blink 1s step-end infinite;
}

@keyframes knowledge-cursor-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.knowledge-stream-waiting {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 16px 20px;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px dashed rgba(210, 153, 34, 0.32);
  background: rgba(210, 153, 34, 0.06);
  font-size: 12px;
  color: rgba(200, 210, 220, 0.92);
}

.knowledge-panel--main .knowledge-stream-waiting {
  margin: 16px 24px 24px;
}

.knowledge-stream-waiting--initial {
  min-height: 120px;
  justify-content: center;
}

.knowledge-panel--main .knowledge-editor {
  flex: 1;
  margin: 16px;
  min-height: 0;
  font-size: 13px;
}

.knowledge-stream-preview {
  margin: 8px 16px 20px;
  padding: 12px 14px 14px;
  border-radius: 10px;
  border: 1px solid rgba(88, 166, 255, 0.28);
  background: linear-gradient(
    180deg,
    rgba(88, 166, 255, 0.1) 0%,
    rgba(88, 166, 255, 0.04) 100%
  );
  box-shadow: 0 0 0 1px rgba(88, 166, 255, 0.06) inset;
}

.knowledge-panel--main .knowledge-stream-preview {
  margin: 4px 24px 24px;
}

.knowledge-stream-preview-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 10px;
  font-size: 11px;
  font-weight: 600;
  color: rgba(180, 210, 255, 0.98);
}

.knowledge-stream-preview-body {
  font-size: 13px;
  line-height: 1.6;
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
  flex-direction: column;
  gap: 8px;
  margin-top: auto;
  flex-shrink: 0;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.knowledge-followup--busy {
  border-top-color: rgba(88, 166, 255, 0.22);
  background: rgba(88, 166, 255, 0.04);
}

.knowledge-panel--main .knowledge-followup--busy {
  background: rgba(88, 166, 255, 0.07);
}

.knowledge-followup-status {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.knowledge-followup-status-text {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  line-height: 1.4;
  color: rgba(180, 200, 230, 0.96);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.knowledge-btn--compact {
  flex-shrink: 0;
  padding: 4px 10px;
  font-size: 11px;
}

.knowledge-followup-row {
  display: flex;
  gap: 6px;
}

.knowledge-btn--quote {
  flex-shrink: 0;
  white-space: nowrap;
}

.knowledge-followup-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.knowledge-followup-chips-label {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.92);
  flex-shrink: 0;
}

.knowledge-followup-chip {
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(180, 190, 200, 0.95);
  font-size: 10px;
  cursor: pointer;
  max-width: 100%;
  text-align: left;
}

.knowledge-followup-chip:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(220, 225, 230, 0.98);
}

.knowledge-followup-chip:disabled {
  opacity: 0.45;
  cursor: not-allowed;
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

.knowledge-quoted-preview {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(88, 166, 255, 0.28);
  background: rgba(88, 166, 255, 0.07);
}

.knowledge-quoted-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.knowledge-quoted-label {
  font-size: 11px;
  font-weight: 600;
  color: rgba(160, 200, 255, 0.96);
}

.knowledge-quoted-close {
  border: none;
  background: transparent;
  color: rgba(180, 190, 200, 0.9);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0 2px;
}

.knowledge-quoted-close:hover {
  color: rgba(230, 235, 240, 0.98);
}

.knowledge-quoted-body {
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
  color: rgba(190, 200, 210, 0.95);
  white-space: pre-wrap;
  max-height: 72px;
  overflow: auto;
}
</style>
