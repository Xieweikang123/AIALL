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
              :disabled="!projectOpened || chatSending || !canSwitchToNewerSession"
              title="较新的会话 (Ctrl+Alt+↑)"
              @click="$emit('switch-to-adjacent-session', -1)"
            >
              ‹
            </button>
            <button
              type="button"
              class="session-picker-trigger"
              :class="{ open: sessionPickerOpen }"
              :disabled="!projectOpened || chatSending"
              :title="sessionPickerTitle"
              @click="$emit('toggle-session-picker')"
            >
              <span class="session-picker-title">{{ activeSessionTitle || "新会话" }}</span>
              <span class="session-picker-chevron" aria-hidden="true">▾</span>
            </button>
            <button
              v-if="sessionList.length > 1"
              type="button"
              class="session-nav-btn"
              :disabled="!projectOpened || chatSending || !canSwitchToOlderSession"
              title="较旧的会话 (Ctrl+Alt+↓)"
              @click="$emit('switch-to-adjacent-session', 1)"
            >
              ›
            </button>
          </div>
          <div v-if="sessionPickerOpen" class="session-picker-dropdown">
            <div class="session-picker-head">
              <span class="session-picker-head-title">会话记录</span>
              <button
                type="button"
                class="ghost small session-picker-new"
                :disabled="chatSending"
                @click="$emit('start-new-session')"
              >
                + 新会话
              </button>
            </div>
            <div v-if="chatStoreSyncMessage" class="history-sync-message">{{ chatStoreSyncMessage }}</div>
            <div v-if="!sessionList.length" class="history-empty">当前项目还没有会话记录</div>
            <ul v-else class="history-list session-picker-list">
              <li
                v-for="s in sessionList"
                :key="s.id"
                class="history-item"
                :class="{ active: s.id === activeSessionId }"
              >
                <button type="button" class="history-item-main" @click="$emit('switch-session', s.id)">
                  <span class="history-item-title">{{ s.title }}</span>
                  <span class="history-item-meta">
                    {{ formatSessionTime(s.updatedAt) }} · {{ s.messageCount }} 条
                  </span>
                </button>
                <button
                  type="button"
                  class="ghost small history-copy"
                  :disabled="chatSending"
                  title="复制会话信息（便于粘贴给 AI 排查）"
                  @click.stop="$emit('copy-session-info', s)"
                >
                  复制
                </button>
                <button
                  type="button"
                  class="ghost small history-delete"
                  :disabled="chatSending"
                  title="删除此会话"
                  @click.stop="$emit('remove-session', s.id)"
                >
                  删除
                </button>
              </li>
            </ul>
            <div class="session-picker-foot">
              <button
                type="button"
                class="ghost small session-picker-sync"
                :disabled="chatSending || syncingChatStore || !projectOpened"
                @click="$emit('sync-chat-store-to-disk')"
              >
                {{ syncingChatStore ? "同步中…" : "同步到本地" }}
              </button>
              <span class="session-picker-hint">Ctrl+Alt+↑↓ 切换</span>
            </div>
          </div>
        </div>
      </div>
      <div class="panel-head-right">
        <button
          type="button"
          class="ghost small project-memory-btn"
          :class="{ active: projectMemoryHasContent }"
          :disabled="!projectOpened || chatSending"
          title="编辑项目记忆（AI 每次对话自动读取）"
          @click="$emit('open-project-memory')"
        >
          记忆
        </button>
        <button
          type="button"
          class="ghost small"
          :disabled="!projectOpened || chatSending"
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
        <span>正在加载项目…</span>
      </div>
      <div v-else-if="switchingSession" class="chat-switching">
        <span class="chat-switching-spinner" aria-hidden="true">⟳</span>
        <span>正在加载会话…</span>
      </div>
      <div v-else-if="!chatMessages.length" class="chat-empty">
        <div class="chat-empty-visual" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.2" opacity="0.35" />
            <path d="M8 10h8M8 14h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.5" />
          </svg>
        </div>
        <p class="chat-empty-title">AI 编程助手</p>
        <p class="chat-empty-desc">Agent 会探索项目；Build 模式下文件修改会立即写入磁盘。输入 <code>@</code> 引用文件。</p>
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

    <div
      v-if="showQuoteButton"
      ref="quoteButtonRef"
      class="quote-floating"
      :style="{ left: quoteButtonPosition.x + 'px', top: quoteButtonPosition.y + 'px' }"
      @mousedown.prevent="$emit('quote-selected-text')"
    >
      <span class="quote-icon">❝</span> 引用
    </div>

    <footer class="chat-composer">
      <div v-if="pendingPromptQueue.length" class="pending-queue">
        <div class="pending-queue-head">
          <span>排队中 {{ pendingPromptQueue.length }} 条消息</span>
          <button type="button" class="ghost small" @click="$emit('clear-pending-queue')">清空队列</button>
        </div>
        <ol class="pending-queue-list">
          <li v-for="(q, qi) in pendingPromptQueue" :key="qi">{{ q }}</li>
        </ol>
      </div>
      <div v-if="quotedMessage" class="quoted-preview">
        <div class="quoted-preview-header">
          <span class="quoted-preview-label">
            <span class="quoted-preview-icon">❝</span>
            引用 {{ quotedMessage.role === "assistant" ? "Agent" : "你" }}
          </span>
          <button type="button" class="quoted-preview-close" @click="$emit('update:quotedMessage', null)">×</button>
        </div>
        <div class="quoted-preview-body">{{ quotedMessage.content }}</div>
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
          <span v-if="autoResumeSecondsLeft > 0" class="chat-recovery-hint chat-auto-resume-hint">
            {{ autoResumeSecondsLeft }}s 后自动恢复（可取消）
          </span>
          <span v-else-if="stalledAssistantMsg" class="chat-recovery-hint chat-stall-hint">
            运行似乎已卡住
          </span>
          <span v-else-if="recoverableAssistantMsg && !chatSending" class="chat-recovery-hint">
            Agent 已中断，可恢复
          </span>
          <span v-else-if="chatError" class="chat-error">{{ chatError }}</span>
          <span v-else-if="chatSending" class="chat-running">{{ chatRunningText }}</span>

        </div>
        <div class="chat-action-row">
          <div class="chat-mode-switch" role="group" aria-label="对话模式">
            <button
              type="button"
              class="mode-btn"
              :class="{ active: chatMode === 'ask' }"
              :disabled="chatSending"
              @click="$emit('update:chatMode', 'ask')"
            >
              Ask
            </button>
            <button
              type="button"
              class="mode-btn"
              :class="{ active: chatMode === 'plan' }"
              :disabled="chatSending"
              @click="$emit('update:chatMode', 'plan')"
            >
              Plan
            </button>
            <button
              type="button"
              class="mode-btn"
              :class="{ active: chatMode === 'build' }"
              :disabled="chatSending"
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
              {{ autoResumeSecondsLeft > 0 ? "立即恢复" : "恢复运行" }}
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
      <div class="project-memory-dialog" role="dialog" aria-labelledby="project-memory-title">
        <div class="project-memory-head">
          <div>
            <h3 id="project-memory-title" class="project-memory-title">项目记忆</h3>
            <p class="project-memory-desc">
              记录编码偏好、常用命令与踩坑。保存后，Ask / Plan / Build 模式均会自动注入 Agent。
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
        <div v-if="projectMemoryLoading" class="project-memory-status">加载中…</div>
        <textarea
          v-else
          class="project-memory-editor"
          :value="projectMemoryDraft"
          :maxlength="projectMemoryMaxChars"
          placeholder="# 项目记忆&#10;&#10;例如：改 UI 优先看 src/components/vibe/；测试用 npm test。"
          @input="$emit('update:projectMemoryDraft', ($event.target as HTMLTextAreaElement).value)"
        />
        <div class="project-memory-foot">
          <span class="project-memory-counter">
            {{ projectMemoryDraft.length }} / {{ projectMemoryMaxChars }}
          </span>
          <span v-if="projectMemoryMessage" class="project-memory-message">{{ projectMemoryMessage }}</span>
          <div class="project-memory-actions">
            <button type="button" class="ghost small" @click="$emit('close-project-memory')">取消</button>
            <button
              type="button"
              class="primary small"
              :disabled="projectMemorySaving || projectMemoryLoading"
              @click="$emit('save-project-memory')"
            >
              {{ projectMemorySaving ? "保存中…" : "保存" }}
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
import type { VibeChatSessionMeta } from "../../services/vibeChatStorage";
import { formatCharCount } from "../../utils/vibeHelpers";

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

  chatRunningText: string;
  recoverableAssistantMsg: ChatMessage | null;
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
  showQuoteButton: boolean;
  quoteButtonPosition: { x: number; y: number };
  quotedMessage: QuotedMessage | null;
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
  projectMemoryDraft?: string;
  projectMemoryLoading?: boolean;
  projectMemorySaving?: boolean;
  projectMemoryMessage?: string;
  projectMemoryMaxChars?: number;
  projectMemoryHasContent?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  switchingSession: false,
  switchingProject: false,
  totalTokenUsage: "",
  showTokenDetail: false,
  tokenDetailData: null,
  projectMemoryOpen: false,
  projectMemoryDraft: "",
  projectMemoryLoading: false,
  projectMemorySaving: false,
  projectMemoryMessage: "",
  projectMemoryMaxChars: 3500,
  projectMemoryHasContent: false,
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
  (e: "copy-session-info", session: VibeChatSessionMeta): void;
  (e: "clear-chat"): void;
  (e: "quote-selected-text"): void;
  (e: "hide-quote-button"): void;
  (e: "on-composer-field-keydown", event: KeyboardEvent): void;
  (e: "on-chat-input-box-mousedown"): void;
  (e: "select-mention", item: MentionItem): void;
  (e: "on-chat-scroll"): void;
  (e: "on-chat-drag-enter", event: DragEvent): void;
  (e: "on-chat-drag-over", event: DragEvent): void;
  (e: "on-chat-drag-leave", event: DragEvent): void;
  (e: "on-chat-drop", event: DragEvent): void;
  (e: "update:chatMode", mode: VibeChatMode): void;
  (e: "update:quotedMessage", value: QuotedMessage | null): void;
  (e: "update:showTokenDetail", value: boolean): void;
  (e: "update:projectMemoryDraft", value: string): void;
  (e: "open-project-memory"): void;
  (e: "close-project-memory"): void;
  (e: "save-project-memory"): void;
}>();

const chatScrollRef = ref<HTMLElement | null>(null);
const sessionPickerRef = ref<HTMLElement | null>(null);
const quoteButtonRef = ref<HTMLElement | null>(null);
const chatDropZoneRef = ref<HTMLElement | null>(null);

defineExpose({ sessionPickerRef, chatScrollRef });

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
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "今天";
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

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(22, 27, 34, 0.8);
  backdrop-filter: blur(8px);
  flex-shrink: 0;
}

.panel-head-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-head-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-label {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  letter-spacing: 0.3px;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}

.panel-meta {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.6);
}

.panel-meta.warn {
  color: #d29922;
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

.session-picker-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
  background: rgba(22, 27, 34, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 1000;
  margin-top: 4px;
  backdrop-filter: blur(12px);
}

.session-picker-dropdown::-webkit-scrollbar {
  width: 5px;
}

.session-picker-dropdown::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
}

.session-picker-dropdown::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
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
  padding: 4px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
}

.history-list::-webkit-scrollbar {
  width: 5px;
}

.history-list::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
}

.history-list::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}

.history-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px;
  border-radius: 6px;
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
  gap: 2px;
  padding: 6px 8px;
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
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
}

.history-item-meta {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.6);
}

.history-copy,
.history-delete {
  opacity: 0;
  transition: opacity 0.15s;
}

.history-item:hover .history-copy,
.history-item:hover .history-delete {
  opacity: 1;
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
  padding: 16px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
}

.chat-scroll::-webkit-scrollbar {
  width: 5px;
}

.chat-scroll::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
}

.chat-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
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

.quote-floating {
  position: fixed;
  z-index: 1000;
  padding: 5px 10px;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: all 0.15s ease;
  backdrop-filter: blur(8px);
}

.quote-floating:hover {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.25);
  color: white;
}

.quote-icon {
  font-size: 13px;
  opacity: 0.8;
}

.chat-composer {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding: 12px;
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

.quoted-preview {
  margin-bottom: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
}

.quoted-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.quoted-preview-label {
  font-size: 11px;
  color: rgba(139, 148, 158, 0.8);
  display: flex;
  align-items: center;
  gap: 4px;
}

.quoted-preview-icon {
  font-size: 12px;
}

.quoted-preview-close {
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
  font-size: 14px;
}

.quoted-preview-close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.9);
}

.quoted-preview-body {
  padding: 8px 10px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  max-height: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
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
  background: #161b22;
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
  gap: 4px;
  margin-top: 4px;
}

.chat-status-row {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 20px;
  flex: 1;
  min-width: 0;
}

.chat-hint,
.chat-running {
  font-size: 11px;
  color: rgba(139, 148, 158, 0.6);
}

.chat-running {
  color: #58a6ff;
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
  padding: 6px 12px;
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
  background: rgba(88, 166, 255, 0.2);
  color: #58a6ff;
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

.ghost {
  background: none;
  border: none;
  color: rgba(139, 148, 158, 0.8);
  cursor: pointer;
  padding: 5px 10px;
  border-radius: 4px;
  font-size: 12px;
  transition: all 0.15s ease;
}

.ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.9);
}

.ghost:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ghost.small {
  padding: 2px 6px;
  font-size: 11px;
}

.primary {
  background: rgba(31, 111, 235, 0.8);
  color: white;
  transition: all 200ms ease;
}

.primary:hover:not(:disabled) {
  background: rgba(31, 111, 235, 1);
}

.primary:hover:not(:disabled) {
  background: rgba(31, 111, 235, 1);
}

.secondary {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.secondary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
}

.compact {
  padding: 4px 10px;
  font-size: 11px;
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
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
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
}

.project-memory-dialog {
  width: min(100%, 420px);
  max-height: calc(100% - 32px);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(15, 22, 35, 0.98);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
}

.project-memory-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.project-memory-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
}

.project-memory-desc {
  margin: 4px 0 0;
  font-size: 11px;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.55);
}

.project-memory-close {
  flex-shrink: 0;
  font-size: 16px;
  line-height: 1;
  padding: 2px 8px;
}

.project-memory-editor {
  flex: 1;
  min-height: 220px;
  resize: vertical;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.25);
  color: rgba(255, 255, 255, 0.88);
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.5;
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
  gap: 8px;
}

.project-memory-counter {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
}

.project-memory-message {
  flex: 1;
  font-size: 11px;
  color: rgba(120, 220, 160, 0.9);
}

.project-memory-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.project-memory-status {
  padding: 24px 0;
  text-align: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
}
</style>
