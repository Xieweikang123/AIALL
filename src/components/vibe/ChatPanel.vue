<template>
  <div class="chat-panel" :style="chatPanelStyle">
    <div class="chat-header">
      <div class="chat-header-left">
        <div class="chat-mode-switch">
          <button
            type="button"
            class="chat-mode-btn"
            :class="{ active: chatMode === 'ask' }"
            @click="$emit('update:chatMode', 'ask')"
          >
            Ask
          </button>
          <button
            type="button"
            class="chat-mode-btn"
            :class="{ active: chatMode === 'build' }"
            @click="$emit('update:chatMode', 'build')"
          >
            Build
          </button>
        </div>
        <div class="chat-status">
          <span v-if="configReady" class="chat-status-dot ready"></span>
          <span v-else class="chat-status-dot"></span>
          <span class="chat-status-text">{{ aiConfigStatusText }}</span>
        </div>
      </div>
      <div class="chat-header-right">
        <button
          type="button"
          class="ghost tiny"
          :disabled="chatSending"
          @click="$emit('start-new-session')"
        >
          新建会话
        </button>
        <div ref="sessionPickerRef" class="session-picker-wrap">
          <button
            type="button"
            class="ghost tiny"
            :disabled="chatSending || !sessionList.length"
            @click="$emit('toggle-session-picker')"
          >
            会话 ({{ sessionList.length }})
          </button>
          <div v-if="sessionPickerOpen" class="session-picker-dropdown">
            <div class="session-picker-header">
              <span class="session-picker-title">{{ sessionPickerTitle }}</span>
            </div>
            <div class="session-picker-list">
              <div
                v-for="(session, index) in sessionList"
                :key="session.id"
                class="session-picker-item"
                :class="{ active: session.id === activeSessionId }"
                @click="$emit('switch-session', session.id)"
              >
                <span class="session-picker-item-title">{{ session.title }}</span>
                <span class="session-picker-item-meta">{{ session.messageCount }} 条消息</span>
                <button
                  type="button"
                  class="ghost tiny session-picker-item-delete"
                  @click.stop="$emit('remove-session', session.id)"
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div ref="chatScrollRef" class="chat-messages" @scroll="onChatScroll">
      <div v-if="!chatMessages.length" class="chat-empty">
        <div class="chat-empty-icon">💬</div>
        <div class="chat-empty-text">{{ chatPlaceholder }}</div>
      </div>
      <template v-else>
        <div
          v-for="message in chatMessages"
          :key="message.id"
          class="chat-message"
          :class="[`role-${message.role}`, { streaming: message.streaming }]"
        >
          <div class="chat-message-avatar">
            {{ message.role === 'user' ? '👤' : '🤖' }}
          </div>
          <div class="chat-message-content">
            <div class="chat-message-text" v-html="formatMessageContent(message.content)"></div>
            <div v-if="message.tools?.length" class="chat-message-tools">
              <div
                v-for="tool in message.tools"
                :key="tool.id"
                class="chat-message-tool"
                :class="{ running: tool.running, error: !tool.ok }"
              >
                <span class="tool-icon">{{ getToolIcon(tool.name) }}</span>
                <span class="tool-label">{{ tool.label }}</span>
                <span v-if="tool.summary" class="tool-summary">{{ tool.summary }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <div class="chat-input-area">
      <div v-if="chatError" class="chat-error">
        {{ chatError }}
        <button type="button" class="ghost tiny" @click="$emit('clear-error')">
          ×
        </button>
      </div>
      <div class="chat-input-container">
        <div
          ref="chatDropZoneRef"
          class="chat-drop-zone"
          :class="{ 'drag-over': isDragging }"
          @dragenter="onChatDragEnter"
          @dragover="onChatDragOver"
          @dragleave="onChatDragLeave"
          @drop="onChatDrop"
        >
          <textarea
            ref="chatInputRef"
            v-model="chatInput"
            class="chat-input"
            :placeholder="chatPlaceholder"
            :disabled="!canSendChat"
            rows="1"
            @keydown.enter.exact.prevent="handleSendChat"
            @input="autoResizeInput"
          ></textarea>
          <div class="chat-input-actions">
            <button
              type="button"
              class="chat-send-btn"
              :disabled="!canSendChat"
              @click="handleSendChat"
            >
              <span v-if="chatSending" class="chat-send-loading">⟳</span>
              <span v-else class="chat-send-icon">↑</span>
            </button>
          </div>
        </div>
        <div class="chat-hint">{{ chatHintText }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from "vue";
import { getToolIcon } from "../../utils/toolHelpers";
import type { VibeChatMode } from "../../services/vibeAgentClient";
import type { VibeChatSessionMeta } from "../../services/vibeChatStorage";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  tools?: Array<{
    id: string;
    name: string;
    label: string;
    summary: string;
    ok: boolean;
    running?: boolean;
  }>;
}

interface QuotedMessage {
  messageId: string;
  content: string;
  role: "user" | "assistant";
}

interface Props {
  projectOpened: boolean;
  chatSending: boolean;
  chatMessages: ChatMessage[];
  chatMode: VibeChatMode;
  chatError: string;
  configReady: boolean;
  apiKeyReady: boolean;
  aiConfigStatusText: string;
  canSendChat: boolean;
  chatPlaceholder: string;
  chatHintText: string;
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
}

const props = defineProps<Props>();

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
  (e: "edit-user-message", messageId: string): void;
  (e: "undo-exchange", messageId: string): void;
  (e: "resend-from-message", messageId: string): void;
  (e: "on-message-select", event: MouseEvent, message: ChatMessage): void;
  (e: "update:quotedMessage", value: QuotedMessage | null): void;
  (e: "update:composerEmpty", value: boolean): void;
  (e: "update:chatMode", mode: VibeChatMode): void;
  (e: "clear-error"): void;
  (e: "on-chat-drag-enter", event: DragEvent): void;
  (e: "on-chat-drag-over", event: DragEvent): void;
  (e: "on-chat-drag-leave", event: DragEvent): void;
  (e: "on-chat-drop", event: DragEvent): void;
}>();

const chatInput = ref("");
const chatScrollRef = ref<HTMLElement | null>(null);
const chatInputRef = ref<HTMLTextAreaElement | null>(null);
const chatDropZoneRef = ref<HTMLElement | null>(null);
const sessionPickerRef = ref<HTMLElement | null>(null);

const chatPanelStyle = computed(() => {
  return { flex: "1", minWidth: "260px" };
});

function formatMessageContent(content: string): string {
  // 简单的Markdown渲染
  return content
    .replace(/\n/g, "<br>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`(.*?)`/g, "<code>$1</code>");
}

function handleSendChat() {
  if (!props.canSendChat || props.chatSending) return;
  emit("send-chat");
  chatInput.value = "";
  autoResizeInput();
}

function autoResizeInput() {
  const el = chatInputRef.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
}

function onChatScroll() {
  // 处理滚动事件
}

function onChatDragEnter(e: DragEvent) {
  emit("on-chat-drag-enter", e);
}

function onChatDragOver(e: DragEvent) {
  emit("on-chat-drag-over", e);
}

function onChatDragLeave(e: DragEvent) {
  emit("on-chat-drag-leave", e);
}

function onChatDrop(e: DragEvent) {
  emit("on-chat-drop", e);
}
</script>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border-left: 1px solid var(--border-color);
  overflow: hidden;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.chat-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.chat-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chat-mode-switch {
  display: flex;
  gap: 2px;
  background: var(--bg-tertiary);
  border-radius: 4px;
  padding: 2px;
}

.chat-mode-btn {
  padding: 4px 8px;
  font-size: 11px;
  border: none;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 3px;
}

.chat-mode-btn:hover {
  color: var(--text-primary);
}

.chat-mode-btn.active {
  background: var(--accent-color);
  color: white;
}

.chat-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-secondary);
}

.chat-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-tertiary);
}

.chat-status-dot.ready {
  background: var(--success-color);
}

.session-picker-wrap {
  position: relative;
}

.session-picker-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  width: 300px;
  max-height: 400px;
  overflow-y: auto;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  margin-top: 4px;
}

.session-picker-header {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
}

.session-picker-title {
  font-size: 12px;
  font-weight: 500;
}

.session-picker-list {
  padding: 4px;
}

.session-picker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 4px;
  cursor: pointer;
}

.session-picker-item:hover {
  background: var(--bg-tertiary);
}

.session-picker-item.active {
  background: var(--bg-tertiary);
}

.session-picker-item-title {
  flex: 1;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-picker-item-meta {
  font-size: 10px;
  color: var(--text-secondary);
}

.session-picker-item-delete {
  opacity: 0;
  transition: opacity 0.15s;
}

.session-picker-item:hover .session-picker-item-delete {
  opacity: 1;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.chat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  color: var(--text-secondary);
}

.chat-empty-icon {
  font-size: 48px;
}

.chat-empty-text {
  font-size: 14px;
  text-align: center;
  max-width: 300px;
  line-height: 1.5;
}

.chat-message {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.chat-message.role-user {
  flex-direction: row-reverse;
}

.chat-message-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}

.chat-message-content {
  max-width: 80%;
  min-width: 0;
}

.chat-message.role-user .chat-message-content {
  background: var(--accent-color);
  color: white;
  border-radius: 12px 12px 4px 12px;
  padding: 10px 14px;
}

.chat-message.role-assistant .chat-message-content {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border-radius: 12px 12px 12px 4px;
  padding: 10px 14px;
}

.chat-message.streaming .chat-message-content {
  border-bottom: 2px solid var(--accent-color);
}

.chat-message-text {
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
}

.chat-message-text :deep(code) {
  background: rgba(0, 0, 0, 0.1);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: monospace;
  font-size: 12px;
}

.chat-message-tools {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.chat-message-tool {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 4px;
  font-size: 11px;
}

.chat-message-tool.running {
  opacity: 0.7;
}

.chat-message-tool.error {
  background: rgba(248, 81, 73, 0.1);
  color: var(--error-color);
}

.tool-icon {
  font-size: 12px;
}

.tool-label {
  color: var(--text-secondary);
}

.tool-summary {
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-input-area {
  border-top: 1px solid var(--border-color);
  padding: 12px;
}

.chat-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  margin-bottom: 8px;
  background: var(--error-bg);
  border: 1px solid var(--error-border);
  border-radius: 4px;
  color: var(--error-text);
  font-size: 12px;
}

.chat-input-container {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chat-drop-zone {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  transition: border-color 0.15s, background 0.15s;
}

.chat-drop-zone.drag-over {
  border-color: var(--accent-color);
  background: rgba(88, 166, 255, 0.05);
}

.chat-input {
  flex: 1;
  min-height: 20px;
  max-height: 150px;
  padding: 4px 0;
  border: none;
  background: none;
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.5;
  resize: none;
  outline: none;
}

.chat-input::placeholder {
  color: var(--text-tertiary);
}

.chat-input:disabled {
  opacity: 0.5;
}

.chat-input-actions {
  display: flex;
  align-items: center;
}

.chat-send-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: var(--accent-color);
  color: white;
  border-radius: 50%;
  cursor: pointer;
  transition: background 0.15s;
}

.chat-send-btn:hover {
  background: var(--accent-hover);
}

.chat-send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.chat-send-loading {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.chat-send-icon {
  font-size: 14px;
}

.chat-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  text-align: center;
}

.ghost {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
}

.ghost:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ghost.tiny {
  padding: 2px 6px;
  font-size: 11px;
}
</style>
