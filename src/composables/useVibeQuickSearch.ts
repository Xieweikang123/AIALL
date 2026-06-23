import { nextTick, ref, watch, type Ref } from "vue";
import type EditorPanel from "../components/vibe/EditorPanel.vue";
import type ChatPanel from "../components/vibe/ChatPanel.vue";
import type { ChatMessage } from "./useAgentRun";
import type { PersistedChatMessage } from "../services/vibeChatStorage";

export interface UseVibeQuickSearchOptions {
  activeSessionId: Ref<string>;
  chatMessages: Ref<ChatMessage[]>;
  switchingSession: Ref<boolean>;
  getSessionMessages: (sessionId: string) => ChatMessage[] | undefined;
  switchSession: (sessionId: string) => void;
  openFile: (filePath: string) => Promise<void>;
  chatPanelRef: Ref<InstanceType<typeof ChatPanel> | null>;
  editorPanelRef: Ref<InstanceType<typeof EditorPanel> | null>;
}

export function useVibeQuickSearch(options: UseVibeQuickSearchOptions) {
  const quickSearchOpen = ref(false);

  function getLiveSessionMessagesForSearch(sessionId: string): PersistedChatMessage[] | undefined {
    if (sessionId === options.activeSessionId.value && options.chatMessages.value.length) {
      return options.chatMessages.value;
    }
    const cached = options.getSessionMessages(sessionId);
    return cached?.length ? cached : undefined;
  }

  async function scrollChatToMessage(messageId: string) {
    if (!messageId.trim()) return;
    await nextTick();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    const host = options.chatPanelRef.value?.chatScrollRef;
    if (!host) return;
    const escaped =
      typeof CSS !== "undefined" && "escape" in CSS
        ? CSS.escape(messageId)
        : messageId.replace(/"/g, '\\"');
    const el = host.querySelector(`[data-message-id="${escaped}"]`);
    if (!(el instanceof HTMLElement)) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("msg--search-highlight");
    window.setTimeout(() => {
      el.classList.remove("msg--search-highlight");
    }, 2200);
  }

  function waitUntilSwitchingSessionDone(): Promise<void> {
    if (!options.switchingSession.value) return Promise.resolve();
    return new Promise((resolve) => {
      const stop = watch(options.switchingSession, (busy) => {
        if (!busy) {
          stop();
          resolve();
        }
      });
    });
  }

  async function onQuickSearchOpenFile(payload: { path: string; line?: number }) {
    await options.openFile(payload.path);
    if (payload.line && payload.line > 0) {
      await nextTick();
      await options.editorPanelRef.value?.revealLineInEditor(payload.line);
    }
  }

  async function onQuickSearchOpenSession(payload: { sessionId: string; messageId?: string }) {
    if (payload.sessionId && payload.sessionId !== options.activeSessionId.value) {
      options.switchSession(payload.sessionId);
      await waitUntilSwitchingSessionDone();
    }
    if (payload.messageId) {
      await scrollChatToMessage(payload.messageId);
    }
  }

  function openQuickSearch() {
    quickSearchOpen.value = true;
  }

  return {
    quickSearchOpen,
    openQuickSearch,
    getLiveSessionMessagesForSearch,
    onQuickSearchOpenFile,
    onQuickSearchOpenSession,
  };
}
