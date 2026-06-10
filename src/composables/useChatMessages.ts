import { ref, computed, nextTick, type Ref } from "vue";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  status?: string;
  agentPhase?: string;
  agentTurn?: number;
  agentMaxTurns?: number;
  agentModel?: string;
  agentDetail?: string;
  streamChars?: number;
  contextChars?: number;
  agentWaitStartedAt?: number;
  reverting?: boolean;
  applying?: boolean;
  agentAborted?: boolean;
  agentFailed?: boolean;
  agentRecoverable?: boolean;
  agentFailureReason?: string;
  agentRecoveryDismissed?: boolean;
  agentContinueCount?: number;
  activityExpanded?: boolean;
  activityDetailed?: boolean;
  tools?: Array<{
    id: string;
    name?: string;
    icon?: string;
    title?: string;
    label?: string;
    detail?: string;
    summary?: string;
    ok?: boolean;
    running?: boolean;
    turn?: number;
    fullResult?: unknown;
    args?: unknown;
  }>;
  roundGroups?: unknown[];
  statusLog?: string[];
  turnTraces?: unknown[];
  turnFileDiffs?: Record<string, { before: string; after: string; deleted?: boolean }>;
  writtenFiles?: string[];
  reverted?: boolean;
  rejected?: boolean;
  chatMode?: string;
  agentContext?: { model?: string };
  totalTurns?: number;
  imageCount?: number;
  _expandedDiffs?: Record<string, boolean>;
}

export function useChatMessages(
  projectPath: Ref<string>,
  activeSessionId: Ref<string | null>
) {
  const chatMessages = ref<ChatMessage[]>([]);
  const chatSending = ref(false);
  const chatError = ref("");
  const chatScrollRef = ref<HTMLElement | null>(null);

  const CHAT_SCROLL_PIN_THRESHOLD = 80;
  let chatPinnedToBottom = true;
  let scrollChatRaf = 0;

  function normalizeChatMessages(messages: any[]): ChatMessage[] {
    return messages.map((m) => ({
      ...m,
      activityExpanded: m.activityExpanded ?? false,
      activityDetailed: m.activityDetailed ?? false,
    })) as ChatMessage[];
  }

  function appendMessage(message: ChatMessage) {
    chatMessages.value.push(message);
  }

  function updateMessage(id: string, updates: Partial<ChatMessage>) {
    const msg = chatMessages.value.find((m) => m.id === id);
    if (msg) {
      Object.assign(msg, updates);
    }
  }

  function removeMessage(id: string) {
    const index = chatMessages.value.findIndex((m) => m.id === id);
    if (index !== -1) {
      chatMessages.value.splice(index, 1);
    }
  }

  function clearMessages() {
    chatMessages.value = [];
  }

  function findMessage(id: string): ChatMessage | undefined {
    return chatMessages.value.find((m) => m.id === id);
  }

  function findRunningAssistantMsg(): ChatMessage | undefined {
    for (let i = chatMessages.value.length - 1; i >= 0; i--) {
      const m = chatMessages.value[i];
      if (m.role === "assistant" && m.streaming) return m;
    }
    return undefined;
  }

  function getActiveAssistantMsgId(): string {
    for (let i = chatMessages.value.length - 1; i >= 0; i--) {
      const m = chatMessages.value[i];
      if (m.role === "assistant") return m.id;
    }
    return "";
  }

  function messageDisplayContent(msg: ChatMessage): string {
    if (msg.role === "user") {
      return msg.content?.trim() || "";
    }
    return msg.content?.trim() || "";
  }

  function isChatNearBottom(): boolean {
    const el = chatScrollRef.value;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= CHAT_SCROLL_PIN_THRESHOLD;
  }

  function onChatScroll() {
    chatPinnedToBottom = isChatNearBottom();
  }

  function resetChatScrollPin() {
    chatPinnedToBottom = true;
  }

  async function scrollChatToBottom(force = false) {
    if (force) {
      resetChatScrollPin();
    } else if (!chatSending.value) {
      return;
    } else if (!chatPinnedToBottom) {
      return;
    }
    await nextTick();
    if (scrollChatRaf) cancelAnimationFrame(scrollChatRaf);
    scrollChatRaf = requestAnimationFrame(() => {
      const el = chatScrollRef.value;
      if (el) el.scrollTop = el.scrollHeight;
      scrollChatRaf = 0;
    });
  }

  return {
    chatMessages,
    chatSending,
    chatError,
    chatScrollRef,
    normalizeChatMessages,
    appendMessage,
    updateMessage,
    removeMessage,
    clearMessages,
    findMessage,
    findRunningAssistantMsg,
    getActiveAssistantMsgId,
    messageDisplayContent,
    onChatScroll,
    scrollChatToBottom,
    resetChatScrollPin,
  };
}
