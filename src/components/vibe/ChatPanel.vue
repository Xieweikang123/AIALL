<template>
  <aside
    ref="chatDropZoneRef"
    class="chat-panel"
    :class="{ 'chat-expanded': editorCollapsed, 'drag-over': isDragging }"
    aria-label="AI 助手"
    @dragenter="$emit('on-chat-drag-enter', $event)"
    @dragover="$emit('on-chat-drag-over', $event)"
    @dragleave="$emit('on-chat-drag-leave', $event)"
    @drop="$emit('on-chat-drop', $event)"
    :style="panelStyle"
  >
    <div class="panel-head">
      <div class="panel-head-left">
        <span class="panel-label">AI 助手</span>
        <div ref="sessionPickerRef" class="session-picker-wrap">
          <div class="session-picker-row">
            <button
              v-if="sessionList.length > 1"
              type="button"
              class="session-nav-btn"
              :disabled="!projectOpened || !canSwitchToNewerSession"
              title="较新的会话 (Ctrl+Alt+↑)"
              @click="$emit('switch-to-adjacent-session', -1)"
            >
              ‹
            </button>
            <span class="session-picker-title">{{ activeSessionTitle || "新会话" }}</span>
            <button
              v-if="sessionList.length > 1"
              type="button"
              class="session-nav-btn"
              :disabled="!projectOpened || !canSwitchToOlderSession"
              title="较旧的会话 (Ctrl+Alt+↓)"
              @click="$emit('switch-to-adjacent-session', 1)"
            >
              ›
            </button>
          </div>
        </div>
      </div>
      <div class="panel-head-right">
        <button
          type="button"
          class="ghost small project-memory-btn"
          :class="{ active: projectMemoryHasContent }"
          :disabled="!projectOpened"
          title="项目记忆、Skills 与探索归档"
          @click="$emit('open-project-memory')"
        >
          记忆
        </button>
        <button
          type="button"
          class="ghost small"
          :disabled="!projectOpened"
          @click="$emit('start-new-session')"
          title="新会话 (Ctrl+Shift+N)"
        >
          新会话
        </button>
        <button
          v-if="chatMessages.length"
          type="button"
          class="ghost small"
          :disabled="chatSending"
          @click="$emit('clear-chat')"
        >
          清空
        </button>
        <span class="panel-meta" :class="{ warn: !configReady || !apiKeyReady }">
          {{ aiConfigStatusText }}
        </span>
      </div>
    </div>

    <div ref="chatScrollRef" class="chat-scroll" @scroll="$emit('on-chat-scroll')">
      <div v-if="switchingProject" class="chat-switching">
        <span class="chat-switching-spinner" aria-hidden="true">⟳</span>
        <span class="shimmer-text--fast">正在加载项目…</span>
      </div>
      <div v-else-if="switchingSession" class="chat-switching">
        <span class="chat-switching-spinner" aria-hidden="true">⟳</span>
        <span class="shimmer-text--fast">正在加载会话…</span>
      </div>
      <div v-else-if="!chatMessages.length" class="chat-empty">
        <div class="chat-empty-visual" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.2" opacity="0.35" />
            <path d="M8 10h8M8 14h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.5" />
          </svg>
        </div>
        <p class="chat-empty-title">AI 编程助手</p>
        <p class="chat-empty-desc">Ask 只读问答；Plan 先出方案再确认执行；Build 直接探索并改代码。输入 <code>@</code> 引用文件。</p>
        <div class="chips">
          <button type="button" class="chip" :disabled="chatSending" @click="$emit('apply-example', '解释这个项目是做什么的')">
            解释项目
          </button>
          <button type="button" class="chip" :disabled="chatSending" @click="$emit('apply-example', '解释这段代码在做什么')">
            解释代码
          </button>
          <button type="button" class="chip" :disabled="chatSending" @click="$emit('apply-example', '帮我优化这段代码，并给出修改后的完整代码')">
            优化代码
          </button>
          <button type="button" class="chip" :disabled="chatSending" @click="$emit('apply-example', '找出潜在 bug 并修复')">
            修复 bug
          </button>
        </div>
      </div>

      <div v-else class="msg-list">
        <slot name="messages"></slot>
      </div>
    </div>

    <div v-if="pendingMemoryProposals.length || pendingSkillProposals.length" class="memory-proposal-banner">
      <div
        v-for="proposal in pendingMemoryProposals"
        :key="proposal.id"
        class="memory-proposal-item"
      >
        <span class="memory-proposal-text">
          Agent 提议写入 <strong>## {{ proposal.section }}</strong>：{{ proposal.content }}
        </span>
        <div class="memory-proposal-actions">
          <button
            type="button"
            class="ghost small"
            @click="$emit('dismiss-memory-proposal', proposal.id)"
          >
            忽略
          </button>
          <button
            type="button"
            class="primary small"
            :disabled="memorySuggestSaving"
            @click="$emit('confirm-memory-proposal', proposal.id)"
          >
            写入
          </button>
        </div>
      </div>
      <div
        v-for="proposal in pendingSkillProposals"
        :key="proposal.id"
        class="memory-proposal-item"
      >
        <span class="memory-proposal-text">
          Agent 提议 skill <strong>{{ proposal.slug }}</strong>（{{ proposal.kind }}）：{{ proposal.title }}
        </span>
        <div class="memory-proposal-actions">
          <button
            type="button"
            class="ghost small"
            @click="$emit('dismiss-skill-proposal', proposal.id)"
          >
            忽略
          </button>
          <button
            type="button"
            class="primary small"
            :disabled="memorySuggestSaving"
            @click="$emit('confirm-skill-proposal', proposal.id)"
          >
            写入
          </button>
        </div>
      </div>
    </div>

    <footer class="chat-composer">
      <div v-if="pendingPromptQueue.length" class="pending-queue">
        <div class="pending-queue-head">
          <span>待发送 {{ pendingPromptQueue.length }} 条消息</span>
          <button type="button" class="ghost small" @click="$emit('clear-pending-queue')">取消</button>
        </div>
        <ol class="pending-queue-list">
          <li v-for="(q, qi) in pendingPromptQueue" :key="qi">{{ q }}</li>
        </ol>
      </div>
      <div v-if="agentSuggestions.length && !chatSending" class="agent-suggestion-chips">
        <span class="agent-suggestion-label">建议操作</span>
        <button
          v-for="(suggestion, index) in agentSuggestions"
          :key="`${suggestion.label}-${index}`"
          type="button"
          class="chip agent-suggestion-chip"
          @click="$emit('apply-suggestion', suggestion)"
        >
          {{ suggestion.label }}
        </button>
      </div>
    <div
      v-if="quotedMessages.length"
      class="quoted-preview-stack"
    >
      <div
        v-for="(q, quoteIndex) in quotedMessages"
        :key="`${q.messageId}-${quoteIndex}`"
        class="quoted-preview"
      >
        <div class="quoted-preview-header">
          <span class="quoted-preview-label">
            <span class="quoted-preview-icon">❝</span>
            引用 {{ q.role === "assistant" ? "Agent" : "你" }}
          </span>
          <button type="button" class="quoted-preview-close" @click="removeQuotedMessage(quoteIndex)">×</button>
        </div>
        <div class="quoted-preview-body">{{ q.content }}</div>
      </div>
    </div>
      <div class="chat-input-field" @keydown.capture="$emit('on-composer-field-keydown', $event)">
        <div v-if="mentionOpen && mentionResults.length" class="mention-dropdown">
          <button
            v-for="(item, idx) in mentionResults"
            :key="item.path"
            type="button"
            class="mention-item"
            :class="{ active: idx === mentionActiveIndex }"
            @mousedown.prevent="$emit('select-mention', item)"
          >
            <span class="mention-item-name">{{ item.name }}</span>
            <span class="mention-item-path">{{ item.relative }}</span>
          </button>
        </div>
        <div class="chat-input-box" :class="{ focused: chatInputFocused }" @mousedown="$emit('on-chat-input-box-mousedown')">
          <slot name="composer"></slot>
        </div>
      </div>
      <div class="chat-bottom">
        <div class="chat-status-row">
          <span v-if="autoResumeSecondsLeft > 0" class="chat-recovery-hint chat-auto-resume-hint">
            {{ autoResumeSecondsLeft }}s 后自动恢复（可取消）
          </span>
          <span v-else-if="stalledAssistantMsg" class="chat-recovery-hint chat-stall-hint">
            运行似乎已卡住
          </span>
          <!-- 重复状态已由消息列表内的 footer 展示，此处隐藏避免冗余 -->
          <span v-else-if="recoverableAssistantMsg && !chatSending" class="chat-recovery-hint">
            Agent 已中断，可恢复
          </span>
          <span v-else-if="chatError" class="chat-error">{{ chatError }}</span>

        </div>
        <div class="chat-action-row">
          <button
            v-if="totalTokenUsage"
            type="button"
            class="token-usage-btn"
            :class="{ open: showTokenDetail }"
            :title="showTokenDetail ? '收起用量详情' : '查看用量详情'"
            @click="$emit('update:showTokenDetail', !showTokenDetail)"
          >
            {{ totalTokenUsage }}
          </button>
          <div v-if="showTokenDetail && tokenDetailData" class="token-detail-popover">
            <div class="token-detail-row">
              <span>助手回复</span>
              <span>{{ tokenDetailData.assistantCount }} 条</span>
            </div>
            <div v-if="tokenDetailData.totalStreamChars > 0" class="token-detail-row">
              <span>累计输出</span>
              <span>{{ formatCharCount(tokenDetailData.totalStreamChars) }}</span>
            </div>
            <div v-if="tokenDetailData.maxContextChars > 0" class="token-detail-row">
              <span>最大上下文</span>
              <span>{{ formatCharCount(tokenDetailData.maxContextChars) }}</span>
            </div>
            <div class="token-detail-row">
              <span>消息总数</span>
              <span>{{ tokenDetailData.totalMessages }}</span>
            </div>
          </div>
          <div class="chat-mode-switch" role="group" aria-label="对话模式">
            <button
              type="button"
              class="mode-btn"
              :class="{ active: chatMode === 'ask' }"
              :disabled="chatSending"
              title="只读探索，自然语言答疑"
              @click="$emit('update:chatMode', 'ask')"
            >
              Ask
            </button>
            <button
              type="button"
              class="mode-btn"
              :class="{ active: chatMode === 'plan' }"
              :disabled="chatSending"
              title="先输出结构化修改方案，确认后再执行"
              @click="$emit('update:chatMode', 'plan')"
            >
              Plan
            </button>
            <button
              type="button"
              class="mode-btn"
              :class="{ active: chatMode === 'build' }"
              :disabled="chatSending"
              title="直接探索并修改文件，无需先出方案"
              @click="$emit('update:chatMode', 'build')"
            >
              Build
            </button>
          </div>
          <div class="chat-actions">
            <button
              v-if="autoResumeSecondsLeft > 0"
              type="button"
              class="secondary"
              @click="$emit('cancel-auto-resume')"
            >
              取消恢复
            </button>
            <button
              v-if="stalledAssistantMsg"
              type="button"
              class="secondary resume-bottom-btn"
              :disabled="!configReady || !projectOpened"
              @click="$emit('force-recover-stalled-run', stalledAssistantMsg.id)"
            >
              恢复运行
            </button>
            <button
              v-else-if="recoverableAssistantMsg && !chatSending"
              type="button"
              class="secondary resume-bottom-btn"
              :disabled="!configReady || !projectOpened"
              @click="$emit('resume-agent-run', recoverableAssistantMsg.id)"
            >
              {{ autoResumeSecondsLeft > 0 ? "立即继续" : recoverableResumeLabel }}
            </button>
            <button v-if="chatSending" type="button" class="secondary" @click="$emit('stop-agent')">停止</button>
            <button type="button" class="primary send-btn" :disabled="!canSendChat" @click="$emit('send-chat')">
              {{ chatSending ? "打断并发送" : "发送" }}
            </button>
          </div>
        </div>
      </div>
    </footer>

    <div
      v-if="projectMemoryOpen"
      class="project-memory-overlay"
      @mousedown.self="$emit('close-project-memory')"
    >
      <div
        class="project-memory-dialog"
        :class="{ wide: projectMemoryTab !== 'memory' }"
        role="dialog"
        aria-labelledby="project-memory-title"
      >
        <div class="project-memory-head">
          <div>
            <h3 id="project-memory-title" class="project-memory-title">项目 AI 数据</h3>
            <p class="project-memory-desc">
              记忆、Skills 与探索归档均存于 .aiall/；保存后 Ask / Plan / Build 会自动注入 Agent。
            </p>
          </div>
          <button
            type="button"
            class="ghost small project-memory-close"
            @click="$emit('close-project-memory')"
          >
            ×
          </button>
        </div>

        <div class="project-memory-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            class="project-memory-tab"
            :class="{ active: projectMemoryTab === 'memory' }"
            :aria-selected="projectMemoryTab === 'memory'"
            @click="$emit('update:projectMemoryTab', 'memory')"
          >
            记忆
          </button>
          <button
            type="button"
            role="tab"
            class="project-memory-tab"
            :class="{ active: projectMemoryTab === 'skills' }"
            :aria-selected="projectMemoryTab === 'skills'"
            @click="$emit('update:projectMemoryTab', 'skills')"
          >
            Skills
            <span v-if="projectSkillsList.length" class="project-memory-tab-count">{{
              projectSkillsList.length
            }}</span>
          </button>
          <button
            type="button"
            role="tab"
            class="project-memory-tab"
            :class="{ active: projectMemoryTab === 'exploration' }"
            :aria-selected="projectMemoryTab === 'exploration'"
            @click="$emit('update:projectMemoryTab', 'exploration')"
          >
            探索归档
            <span v-if="projectExplorationList.length" class="project-memory-tab-count">{{
              projectExplorationList.length
            }}</span>
          </button>
        </div>

        <div v-if="projectMemoryTab === 'memory'" class="project-memory-pane">
          <div v-if="projectMemoryLoading" class="project-memory-status shimmer-text--fast">加载中…</div>
          <textarea
            v-else
            class="project-memory-editor"
            :value="projectMemoryDraft"
            :maxlength="projectMemoryMaxChars"
            placeholder="# 项目记忆&#10;&#10;## 术语 / ## 导航 / ## 偏好"
            @input="$emit('update:projectMemoryDraft', ($event.target as HTMLTextAreaElement).value)"
          />
        </div>

        <div v-else-if="projectMemoryTab === 'skills'" class="project-memory-split-pane">
          <div v-if="projectSkillsLoading" class="project-memory-status shimmer-text--fast">加载中…</div>
          <template v-else>
            <ul v-if="projectSkillsList.length" class="project-memory-list">
              <li
                v-for="item in projectSkillsList"
                :key="item.slug"
                class="project-memory-list-item"
                :class="{ active: item.slug === selectedSkillSlug }"
              >
                <button type="button" class="project-memory-list-btn" @click="$emit('select-project-skill', item.slug)">
                  <span class="project-memory-list-title">{{ item.title }}</span>
                  <span class="project-memory-list-meta">{{ item.kind }} · {{ item.slug }}</span>
                </button>
              </li>
            </ul>
            <div v-else class="project-memory-status">暂无 Skill</div>
            <div class="project-memory-detail">
              <div v-if="skillDetailLoading" class="project-memory-status shimmer-text--fast">加载中…</div>
              <template v-else-if="selectedSkillSlug">
                <div class="project-memory-detail-head">
                  <strong>{{ skillDraftTitle }}</strong>
                  <span class="project-memory-list-meta">{{ skillDraftKind }} · {{ selectedSkillSlug }}</span>
                </div>
                <textarea
                  class="project-memory-editor project-memory-editor-detail"
                  :value="skillDraftBody"
                  @input="$emit('update:skillDraftBody', ($event.target as HTMLTextAreaElement).value)"
                />
              </template>
              <div v-else class="project-memory-status">选择左侧 Skill 查看内容</div>
            </div>
          </template>
        </div>

        <div v-else class="project-memory-split-pane">
          <div v-if="projectSkillsLoading" class="project-memory-status shimmer-text--fast">加载中…</div>
          <template v-else>
            <ul v-if="projectExplorationList.length" class="project-memory-list">
              <li
                v-for="item in projectExplorationList"
                :key="item.id"
                class="project-memory-list-item"
                :class="{ active: item.id === selectedExplorationId }"
              >
                <button
                  type="button"
                  class="project-memory-list-btn"
                  @click="$emit('select-project-exploration', item.id)"
                >
                  <span class="project-memory-list-title">{{ formatExplorationLabel(item) }}</span>
                  <span class="project-memory-list-meta">
                    读 {{ item.readCount }} · 写 {{ item.writtenCount }}
                  </span>
                </button>
              </li>
            </ul>
            <div v-else class="project-memory-status">暂无探索归档</div>
            <div class="project-memory-detail">
              <div v-if="explorationDetailLoading" class="project-memory-status shimmer-text--fast">加载中…</div>
              <div v-else-if="selectedExplorationId" class="project-memory-readonly exploration-markdown" v-html="explorationContentHtml"></div>
              <div v-else class="project-memory-status">选择左侧快照查看内容</div>
            </div>
          </template>
        </div>

        <div class="project-memory-foot">
          <span v-if="projectMemoryTab === 'memory'" class="project-memory-counter">
            {{ projectMemoryDraft.length }} / {{ projectMemoryMaxChars }}
          </span>
          <span v-else-if="projectMemoryTab === 'skills' && selectedSkillSlug" class="project-memory-counter">
            {{ skillDraftBody.length }} 字
          </span>
          <span v-else class="project-memory-counter">&nbsp;</span>
          <span v-if="projectMemoryMessage" class="project-memory-message">{{ projectMemoryMessage }}</span>
          <div class="project-memory-actions">
            <button type="button" class="ghost small" @click="$emit('close-project-memory')">关闭</button>
            <button
              v-if="projectMemoryTab === 'memory'"
              type="button"
              class="primary small"
              :disabled="projectMemorySaving || projectMemoryLoading"
              @click="$emit('save-project-memory')"
            >
              {{ projectMemorySaving ? "保存中…" : "保存" }}
            </button>
            <button
              v-else-if="projectMemoryTab === 'skills' && selectedSkillSlug"
              type="button"
              class="primary small"
              :disabled="skillSaving || skillDetailLoading"
              @click="$emit('save-project-skill')"
            >
              {{ skillSaving ? "保存中…" : "保存 Skill" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, withDefaults, type CSSProperties } from "vue";
import type { VibeChatMode } from "../../services/vibeAgentClient";
import type { AgentSuggestion } from "../../services/agentSuggestions";
import type { PendingMemoryProposal } from "../../services/projectMemoryProposal";
import type { PendingSkillProposal } from "../../services/projectSkillProposal";
import type { ExplorationIndexEntry, SkillIndexEntry, SkillKind } from "../../services/projectSkills";
import type { ProjectMemoryTab } from "../../composables/useProjectMemory";
import type { VibeChatSessionMeta } from "../../services/vibeChatStorage";
import { formatCharCount } from "../../utils/vibeHelpers";
import { resolveAgentResumeButtonLabel } from "../../services/agentRecovery";
import { renderMarkdown } from "../../utils/renderMarkdown";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  status?: string;
  agentPhase?: string;
  chatMode?: string;
}

interface QuotedMessage {
  messageId: string;
  content: string;
  role: "user" | "assistant";
}

interface MentionItem {
  name: string;
  path: string;
  relative: string;
}

interface TokenDetailData {
  assistantCount: number;
  totalStreamChars: number;
  maxContextChars: number;
  totalMessages: number;
}

interface Props {
  chatPanelStyle?: CSSProperties;
  projectOpened: boolean;
  chatSending: boolean;
  switchingSession?: boolean;
  switchingProject?: boolean;
  chatMessages: ChatMessage[];
  chatMode: VibeChatMode;
  chatError: string;
  configReady: boolean;
  apiKeyReady: boolean;
  aiConfigStatusText: string;
  canSendChat: boolean;
  chatPlaceholder: string;
  recoverableAssistantMsg: ChatMessage | null;
  agentRunningStatus?: string;
  stalledAssistantMsg: ChatMessage | null;
  autoResumeSecondsLeft: number;
  pendingPromptQueue: string[];
  sessionList: VibeChatSessionMeta[];
  activeSessionId: string;
  activeSessionTitle: string;
  sessionPickerOpen: boolean;
  sessionPickerTitle: string;
  syncingChatStore: boolean;
  chatStoreSyncMessage: string;
  isDragging: boolean;
  editorCollapsed: boolean;
  quotedMessages: QuotedMessage[];
  mentionOpen: boolean;
  mentionResults: MentionItem[];
  mentionActiveIndex: number;
  chatInputFocused: boolean;
  canSwitchToNewerSession: boolean;
  canSwitchToOlderSession: boolean;
  totalTokenUsage?: string;
  showTokenDetail?: boolean;
  tokenDetailData?: TokenDetailData | null;
  projectMemoryOpen?: boolean;
  projectMemoryTab?: ProjectMemoryTab;
  projectMemoryDraft?: string;
  projectMemoryLoading?: boolean;
  projectMemorySaving?: boolean;
  projectMemoryMessage?: string;
  projectMemoryMaxChars?: number;
  projectMemoryHasContent?: boolean;
  projectSkillsList?: SkillIndexEntry[];
  projectExplorationList?: ExplorationIndexEntry[];
  projectSkillsLoading?: boolean;
  selectedSkillSlug?: string;
  skillDraftTitle?: string;
  skillDraftKind?: SkillKind;
  skillDraftBody?: string;
  skillDetailLoading?: boolean;
  skillSaving?: boolean;
  selectedExplorationId?: string;
  explorationContent?: string;
  explorationDetailLoading?: boolean;
  memorySuggestSaving?: boolean;
  pendingMemoryProposals?: PendingMemoryProposal[];
  pendingSkillProposals?: PendingSkillProposal[];
  agentSuggestions?: AgentSuggestion[];
}

const props = withDefaults(defineProps<Props>(), {
  switchingSession: false,
  switchingProject: false,
  totalTokenUsage: "",
  showTokenDetail: false,
  tokenDetailData: null,
  projectMemoryOpen: false,
  projectMemoryTab: "memory",
  projectMemoryDraft: "",
  projectMemoryLoading: false,
  projectMemorySaving: false,
  projectMemoryMessage: "",
  projectMemoryMaxChars: 3500,
  projectMemoryHasContent: false,
  projectSkillsList: () => [],
  projectExplorationList: () => [],
  projectSkillsLoading: false,
  selectedSkillSlug: "",
  skillDraftTitle: "",
  skillDraftKind: "heuristic",
  skillDraftBody: "",
  skillDetailLoading: false,
  skillSaving: false,
  selectedExplorationId: "",
  explorationContent: "",
  explorationDetailLoading: false,
  memorySuggestSaving: false,
  pendingMemoryProposals: () => [],
  pendingSkillProposals: () => [],
  quotedMessages: () => [],
  agentRunningStatus: "",
  agentSuggestions: () => [],
});

const panelStyle = computed(() => {
  if (props.chatPanelStyle && Object.keys(props.chatPanelStyle).length > 0) {
    return props.chatPanelStyle;
  }
  if (props.editorCollapsed) {
    return { flex: "1", minWidth: "260px", width: "auto" };
  }
  return { width: "360px", flexShrink: "0" };
});

const recoverableResumeLabel = computed(() => {
  const msg = props.recoverableAssistantMsg;
  if (!msg) return "恢复运行";
  return resolveAgentResumeButtonLabel(msg);
});

function formatExplorationLabel(item: ExplorationIndexEntry): string {
  const stamp = item.createdAt?.trim();
  if (!stamp) return item.id;
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return item.id;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const explorationContentHtml = computed(() => {
  if (!props.explorationContent) return "";
  return renderMarkdown(props.explorationContent);
});

const emit = defineEmits<{
  (e: "send-chat"): void;
  (e: "stop-agent"): void;
  (e: "resume-agent-run", messageId: string): void;
  (e: "force-recover-stalled-run", messageId: string): void;
  (e: "cancel-auto-resume"): void;
  (e: "start-new-session"): void;
  (e: "switch-session", sessionId: string): void;
  (e: "remove-session", sessionId: string): void;
  (e: "toggle-session-picker"): void;
  (e: "switch-to-adjacent-session", delta: number): void;
  (e: "sync-chat-store-to-disk"): void;
  (e: "clear-pending-queue"): void;
  (e: "apply-example", text: string): void;
  (e: "apply-suggestion", suggestion: AgentSuggestion): void;
  (e: "copy-session-info", session: VibeChatSessionMeta): void;
  (e: "clear-chat"): void;
  (e: "on-composer-field-keydown", event: KeyboardEvent): void;
  (e: "on-chat-input-box-mousedown"): void;
  (e: "select-mention", item: MentionItem): void;
  (e: "on-chat-scroll"): void;
  (e: "on-chat-drag-enter", event: DragEvent): void;
  (e: "on-chat-drag-over", event: DragEvent): void;
  (e: "on-chat-drag-leave", event: DragEvent): void;
  (e: "on-chat-drop", event: DragEvent): void;
  (e: "update:chatMode", mode: VibeChatMode): void;
  (e: "update:quotedMessages", value: QuotedMessage[]): void;
  (e: "update:showTokenDetail", value: boolean): void;
  (e: "update:projectMemoryDraft", value: string): void;
  (e: "open-project-memory"): void;
  (e: "close-project-memory"): void;
  (e: "update:projectMemoryTab", value: ProjectMemoryTab): void;
  (e: "update:projectMemoryDraft", value: string): void;
  (e: "update:skillDraftBody", value: string): void;
  (e: "select-project-skill", slug: string): void;
  (e: "select-project-exploration", id: string): void;
  (e: "save-project-memory"): void;
  (e: "save-project-skill"): void;
  (e: "confirm-memory-proposal", id: string): void;
  (e: "dismiss-memory-proposal", id: string): void;
  (e: "confirm-skill-proposal", id: string): void;
  (e: "dismiss-skill-proposal", id: string): void;
  (e: "test-notification"): void;
}>();

const chatScrollRef = ref<HTMLElement | null>(null);
const sessionPickerRef = ref<HTMLElement | null>(null);
const chatDropZoneRef = ref<HTMLElement | null>(null);

defineExpose({ sessionPickerRef, chatScrollRef });

function removeQuotedMessage(index: number) {
  const next = props.quotedMessages.filter((_, i) => i !== index);
  emit("update:quotedMessages", next);
}

function handleSessionPickerOutsideClick(e: MouseEvent) {
  if (!props.sessionPickerOpen) return;
  const wrap = sessionPickerRef.value;
  if (wrap && !wrap.contains(e.target as Node)) {
    emit("toggle-session-picker");
  }
}

onMounted(() => {
  document.addEventListener("mousedown", handleSessionPickerOutsideClick, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", handleSessionPickerOutsideClick, true);
});

function formatSessionTime(timestamp: number | string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return String(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return "刚刚";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m 前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}h 前`;
  const days = Math.floor(hour / 24);
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  return date.toLocaleDateString();
}
</script>

<style scoped>
.chat-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  background: transparent;
  overflow: hidden;
}

.chat-panel.drag-over {
  box-shadow: inset 0 0 0 2px rgba(88, 166, 255, 0.45);
  background: rgba(31, 111, 235, 0.06);
}

.chat-panel.chat-expanded {
  flex: 1;
  min-width: 260px;
}

.panel-head-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  overflow: hidden;
}

.session-picker-wrap {
  position: relative;
}

.session-picker-row {
  display: flex;
  align-items: center;
  gap: 2px;
}

.session-nav-btn {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: rgba(139, 148, 158, 0.6);
  cursor: pointer;
  border-radius: 4px;
  font-size: 12px;
  transition: background 0.15s, color 0.15s;
}

.session-nav-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.9);
}

.session-nav-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.session-picker-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  font-size: 12px;
  max-width: 180px;
}

.session-picker-trigger:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.18);
}

.session-picker-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.session-picker-trigger.open {
  border-color: rgba(88, 166, 255, 0.5);
}

.session-picker-chevron {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.6);
}

.session-picker-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  width: 320px;
  max-height: 400px;
  overflow-y: auto;
  background: rgba(22, 27, 34, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 1000;
  margin-top: 4px;
  backdrop-filter: blur(12px);
}

.session-picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.session-picker-head-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
}

.history-sync-message {
  padding: 6px 12px;
  font-size: 11px;
  color: #d29922;
  background: rgba(210, 153, 34, 0.1);
}

.history-empty {
  padding: 16px 12px;
  text-align: center;
  font-size: 12px;
  color: rgba(139, 148, 158, 0.6);
}

.history-list {
  list-style: none;
  margin: 0;
  padding: 6px 6px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 10px;
  border-radius: 10px;
  transition: background 0.15s;
}

.history-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.history-item.active {
  background: rgba(88, 166, 255, 0.15);
}

.history-item-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 8px 10px;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  text-align: left;
  min-width: 0;
}

.history-item-main:hover {
  background: rgba(255, 255, 255, 0.04);
}

.history-item-title {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
}

.history-item-meta {
  font-size: 11px;
  color: rgba(139, 148, 158, 0.7);
  line-height: 1.3;
}

.history-copy,
.history-delete {
  opacity: 0.4;
  transition: all 0.15s ease;
  border-radius: 6px;
  padding: 3px;
}

.history-item:hover .history-copy,
.history-item:hover .history-delete {
  opacity: 0.8;
}

.history-item:hover .history-copy:hover,
.history-item:hover .history-delete:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.08);
}

.session-picker-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.session-picker-hint {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.5);
}

.chat-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: clip;
  padding: 16px;
}

.chat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 10px;
  text-align: center;
  padding: 24px 20px;
}

.chat-empty-visual {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(31, 111, 235, 0.15), rgba(130, 80, 223, 0.12));
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #91beff;
  margin-bottom: 4px;
}

.chat-empty-title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.2px;
  color: rgba(255, 255, 255, 0.92);
  margin: 0;
}

.chat-empty-desc {
  font-size: 12px;
  color: rgba(139, 148, 158, 0.85);
  max-width: 280px;
  line-height: 1.55;
  margin: 0;
}

.chat-empty-desc code {
  background: rgba(255, 255, 255, 0.08);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: #91beff;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 12px;
}

.chip {
  padding: 6px 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.78);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.chip:hover:not(:disabled) {
  background: rgba(88, 166, 255, 0.1);
  border-color: rgba(88, 166, 255, 0.28);
  color: #c9e4ff;
}

.chip:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.agent-suggestion-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(31, 111, 235, 0.22);
  background: rgba(31, 111, 235, 0.06);
}

.agent-suggestion-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  flex-shrink: 0;
}

.agent-suggestion-chip {
  margin: 0;
}

.chat-composer {
  flex-shrink: 0;
  padding: 0 12px 12px;
}

.pending-queue {
  margin-bottom: 10px;
  border: 1px solid rgba(210, 153, 34, 0.35);
  border-radius: 8px;
  background: rgba(210, 153, 34, 0.08);
}

.pending-queue-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  color: #d29922;
  border-bottom: 1px solid rgba(210, 153, 34, 0.2);
}

.pending-queue-list {
  margin: 0;
  padding: 8px 10px 8px 24px;
  font-size: 11px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.75);
  max-height: 100px;
  overflow: auto;
}

.chat-input-field {
  position: relative;
}

.mention-dropdown {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  max-height: 200px;
  overflow-y: auto;
  background: rgba(22, 27, 34, 0.95);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.3);
  margin-bottom: 4px;
}

.mention-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  width: 100%;
  text-align: left;
}

.mention-item:hover,
.mention-item.active {
  background: rgba(88, 166, 255, 0.15);
}

.mention-item-name {
  font-size: 12px;
  font-weight: 500;
}

.mention-item-path {
  font-size: 11px;
  color: rgba(139, 148, 158, 0.6);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-input-box {
  display: flex;
  align-items: stretch;
  gap: 8px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(22, 27, 34, 0.8);
  backdrop-filter: blur(8px);
  transition: border-color 0.15s, background 0.15s;
  min-height: 56px;
}

.chat-input-box.focused {
  border-color: rgba(88, 166, 255, 0.5);
  background: rgba(22, 27, 34, 1);
}

.chat-bottom {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
  padding-bottom: 4px;
}

.chat-status-row {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 0;
  min-width: 0;
}

.chat-error {
  font-size: 11px;
  color: #f85149;
}

.chat-recovery-hint {
  font-size: 11px;
  color: #79c0ff;
}

.chat-action-row {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.chat-mode-switch {
  display: flex;
  gap: 2px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  padding: 2px;
}

.mode-btn {
  padding: 4px 10px;
  font-size: 12px;
  border: none;
  background: none;
  color: rgba(139, 148, 158, 0.8);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.mode-btn:hover:not(:disabled) {
  color: rgba(255, 255, 255, 0.9);
}

.mode-btn.active {
  background: linear-gradient(135deg, rgba(255, 213, 79, 0.25), rgba(255, 213, 79, 0.15));
  color: #ffd54f;
  box-shadow: 0 1px 3px rgba(255, 213, 79, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.mode-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.chat-actions {
  display: flex;
  gap: 6px;
}

.resume-bottom-btn {
  border: 1px solid rgba(88, 166, 255, 0.45);
  background: rgba(88, 166, 255, 0.12);
  color: rgba(180, 215, 255, 0.95);
}

.resume-bottom-btn:hover:not(:disabled) {
  background: rgba(88, 166, 255, 0.2);
}

.send-btn {
  min-width: 80px;
  transition: all 200ms ease;
}

.send-btn:not(:disabled):hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(31, 111, 235, 0.3);
}

.send-btn:not(:disabled):active {
  transform: translateY(0);
}

.chat-switching {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 16px;
  color: rgba(255, 255, 255, 0.55);
  font-size: 13px;
}

.chat-switching-spinner {
  display: inline-block;
  animation: chat-switch-spin 0.9s linear infinite;
}

@keyframes chat-switch-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.token-usage-btn {
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.55);
  border-radius: 6px;
  padding: 1px 6px;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.15s, background 0.15s;
}

.token-usage-btn:hover,
.token-usage-btn.open {
  color: rgba(255, 255, 255, 0.85);
  background: rgba(255, 255, 255, 0.08);
}

.token-detail-popover {
  position: absolute;
  left: 0;
  bottom: calc(100% + 6px);
  z-index: 20;
  min-width: 180px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(15, 22, 35, 0.98);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.token-detail-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.72);
  padding: 3px 0;
}

.project-memory-btn.active {
  color: rgba(120, 190, 255, 0.95);
  border-color: rgba(120, 190, 255, 0.35);
}

.project-memory-overlay {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(6, 10, 18, 0.72);
  backdrop-filter: blur(2px);
  max-height: 100%;
  overflow: hidden;
}

.project-memory-dialog {
  width: min(100%, 440px);
  max-height: calc(100% - 32px);
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 20px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(15, 22, 35, 0.98);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.project-memory-dialog.wide {
  width: min(100%, 640px);
}

.project-memory-tabs {
  display: flex;
  gap: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.project-memory-tab {
  appearance: none;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.62);
  font-size: 13px;
  padding: 7px 12px;
  border-radius: 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: color 0.15s, background 0.15s;
}

.project-memory-tab.active {
  color: rgba(140, 190, 255, 0.98);
  background: rgba(88, 166, 255, 0.12);
}

.project-memory-tab-count {
  min-width: 16px;
  padding: 0 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  font-size: 10px;
  line-height: 16px;
}

.project-memory-pane,
.project-memory-split-pane {
  display: flex;
  flex-direction: column;
  min-height: 240px;
  max-height: min(52vh, 420px);
}

.project-memory-split-pane {
  display: grid;
  grid-template-rows: 1fr;
  grid-template-columns: minmax(140px, 38%) 1fr;
  gap: 10px;
  min-height: 280px;
  max-height: min(52vh, 420px);
}

.project-memory-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  min-height: 0;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.15);
}

.project-memory-list-item + .project-memory-list-item {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.project-memory-list-item.active .project-memory-list-btn {
  background: rgba(88, 166, 255, 0.14);
}

.project-memory-list-btn {
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  padding: 8px 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.project-memory-list-title {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.9);
  line-height: 1.35;
}

.project-memory-list-meta {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
}

.project-memory-detail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.project-memory-detail-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.88);
}

.project-memory-editor-detail {
  flex: 1;
  min-height: 220px;
}

.project-memory-readonly {
  flex: 1;
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(0, 0, 0, 0.22);
  color: rgba(255, 255, 255, 0.86);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.exploration-markdown {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  white-space: normal;
}

.exploration-markdown h1,
.exploration-markdown h2,
.exploration-markdown h3 {
  margin: 12px 0 8px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
}

.exploration-markdown h1 {
  font-size: 16px;
}

.exploration-markdown h2 {
  font-size: 14px;
}

.exploration-markdown h3 {
  font-size: 13px;
}

.exploration-markdown p {
  margin: 6px 0;
}

.exploration-markdown ul,
.exploration-markdown ol {
  margin: 6px 0;
  padding-left: 20px;
}

.exploration-markdown li {
  margin: 3px 0;
}

.exploration-markdown code {
  background: rgba(255, 255, 255, 0.1);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
}

.exploration-markdown pre {
  background: rgba(0, 0, 0, 0.3);
  padding: 8px 10px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 8px 0;
}

.exploration-markdown pre code {
  background: none;
  padding: 0;
  font-size: 11px;
}

.exploration-markdown strong {
  color: rgba(255, 255, 255, 0.95);
  font-weight: 600;
}

.exploration-markdown blockquote {
  border-left: 3px solid rgba(88, 166, 255, 0.5);
  margin: 8px 0;
  padding: 4px 12px;
  color: rgba(255, 255, 255, 0.7);
}

.project-memory-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.project-memory-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
}

.project-memory-desc {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.55);
}

.project-memory-close {
  flex-shrink: 0;
  font-size: 16px;
  line-height: 1;
  padding: 4px 10px;
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.6);
  transition: color 0.15s, background 0.15s;
}

.project-memory-close:hover {
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.08);
}

.project-memory-editor {
  flex: 1;
  width: 100%;
  min-height: 220px;
  box-sizing: border-box;
  resize: vertical;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(0, 0, 0, 0.2);
  color: rgba(255, 255, 255, 0.88);
  padding: 12px 14px;
  font-size: 12px;
  line-height: 1.6;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.project-memory-editor:focus {
  outline: none;
  border-color: rgba(120, 190, 255, 0.45);
}

.project-memory-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding-top: 4px;
}

.project-memory-counter {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  white-space: nowrap;
}

.project-memory-message {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  line-height: 1.4;
  color: rgba(120, 220, 160, 0.9);
}

.project-memory-actions {
  margin-left: auto;
  display: flex;
  gap: 10px;
  flex-shrink: 0;
}

.project-memory-status {
  padding: 24px 0;
  text-align: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
}

.memory-proposal-banner {
  margin: 0 10px 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(88, 166, 255, 0.1);
  border: 1px solid rgba(88, 166, 255, 0.22);
}

.memory-proposal-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}

.memory-proposal-item + .memory-proposal-item {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.memory-proposal-text {
  color: rgba(255, 255, 255, 0.85);
  line-height: 1.45;
}

.memory-proposal-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.test-notify-btn {
  font-size: 13px;
  padding: 2px 6px;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.15s;
}
.test-notify-btn:hover {
  opacity: 1;
}
</style>
