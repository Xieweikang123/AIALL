import { nextTick, ref, watch, type Ref } from "vue";
import type EditorPanel from "../components/vibe/EditorPanel.vue";
import type ChatPanel from "../components/vibe/ChatPanel.vue";
import type { VibeChatMessage } from "../types/vibeChat";
import type { PersistedChatMessage } from "../services/vibeChatStorage";
import { scrollToMessageWithin } from "../utils/scrollViewport";

export interface UseVibeQuickSearchOptions {
  activeSessionId: Ref<string>;
  chatMessages: Ref<VibeChatMessage[]>;
  switchingSession: Ref<boolean>;
  getSessionMessages: (sessionId: string) => VibeChatMessage[] | undefined;
  switchSession: (sessionId: string) => void;
  expandChat: () => void;
  openFile: (filePath: string) => Promise<void>;
  chatPanelRef: Ref<InstanceType<typeof ChatPanel> | null>;
  editorPanelRef: Ref<InstanceType<typeof EditorPanel> | null>;
  /** 目标消息可能被「显示较早消息」窗口挡在 DOM 之外，跳转前先全量渲染。 */
  revealAllMessages?: () => void;
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

  function findMessageEl(host: HTMLElement, messageId: string): HTMLElement | null {
    const escaped =
      typeof CSS !== "undefined" && "escape" in CSS
        ? CSS.escape(messageId)
        : messageId.replace(/"/g, '\\"');
    const found = host.querySelector(`[data-message-id="${escaped}"]`);
    return found instanceof HTMLElement ? found : null;
  }

  async function scrollChatToMessage(messageId: string) {
    if (!messageId.trim()) return;
    // 跳历史前先解除跟随：否则运行中的内容一长高就把视口拽回底部（表现为「跳了又弹回」）。
    options.chatPanelRef.value?.detachFollowForJump?.();
    await nextTick();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    const host = options.chatPanelRef.value?.chatScrollRef;
    if (!host) return;

    // 目标消息可能在「显示较早消息」窗口外，DOM 里还没渲染；先展开全量再重试一次。
    let el = findMessageEl(host, messageId);
    if (!el) {
      options.revealAllMessages?.();
      await nextTick();
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      el = findMessageEl(host, messageId);
    }
    if (!el) return;

    const highlight = () => {
      el?.classList.add("msg--search-highlight");
      window.setTimeout(() => {
        el?.classList.remove("msg--search-highlight");
      }, 2200);
    };

    // 不用 scrollIntoView({ block: "center" })：它不保证目标块整体可见，
    // 且滚动过程中离屏过程 feed 展开 / markdown / 图片异步撑高会让位置漂移。
    // 这里按「目标块顶对齐视口靠上处」算 scrollTop，并在随后的几帧内校正。
    const applyScroll = () => {
      const current = findMessageEl(host, messageId);
      if (!current) return;
      const hostRect = host.getBoundingClientRect();
      const elRect = current.getBoundingClientRect();
      const elementTop = elRect.top - hostRect.top + host.scrollTop;
      host.scrollTop = scrollToMessageWithin({
        scrollTop: host.scrollTop,
        clientHeight: host.clientHeight,
        scrollHeight: host.scrollHeight,
        elementTop,
        elementHeight: elRect.height,
      });
    };

    applyScroll();
    highlight();
    // 布局异步变化（延迟渲染 / 图片 / markdown）后再校正几次；用户一旦手动滚动就停。
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      host.removeEventListener("wheel", cancel);
      host.removeEventListener("touchstart", cancel);
    };
    host.addEventListener("wheel", cancel, { passive: true });
    host.addEventListener("touchstart", cancel, { passive: true });
    for (const delay of [50, 150, 320, 600]) {
      window.setTimeout(() => {
        if (!cancelled) applyScroll();
      }, delay);
    }
    window.setTimeout(cancel, 700);
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
      options.expandChat();
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
    scrollChatToMessage,
  };
}
