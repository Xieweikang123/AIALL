import { nextTick, reactive, type ComputedRef, type Ref } from "vue";
import { isScrollNearBottom, scrollElementToBottom } from "../utils/scrollViewport";

export type UseAgentChainScrollDeps = {
  scrollChatToBottom: (force?: boolean) => Promise<void>;
  chatSending: Ref<boolean>;
  activeAssistantMsgId: ComputedRef<string>;
};

export type UseAgentChainScroll = {
  chainJumpVisible: Record<string, boolean>;
  bindStatusLogScroll: (el: HTMLElement | null, msgId: string) => void;
  onChainViewportScroll: (msgId: string) => void;
  jumpChainToLatest: (msgId: string) => void;
  scrollStatusLogToBottomInternal: (msgId: string) => void;
};

export function useAgentChainScroll(deps: UseAgentChainScrollDeps): UseAgentChainScroll {
  const { scrollChatToBottom, chatSending, activeAssistantMsgId } = deps;
  const statusLogScrollRefs = new Map<string, HTMLElement>();
  const chainScrollPinned = new Map<string, boolean>();
  const chainJumpVisible = reactive<Record<string, boolean>>({});

  function onChainViewportScroll(msgId: string) {
    const el = statusLogScrollRefs.get(msgId);
    if (!el) return;
    const nearBottom = isScrollNearBottom(el);
    chainScrollPinned.set(msgId, nearBottom);
    chainJumpVisible[msgId] = !nearBottom && el.scrollHeight > el.clientHeight + 8;
  }

  function jumpChainToLatest(msgId: string) {
    const el = statusLogScrollRefs.get(msgId);
    if (el && el.scrollHeight > el.clientHeight + 8) {
      scrollElementToBottom(el, "smooth");
    }
    void scrollChatToBottom(true);
    chainScrollPinned.set(msgId, true);
    chainJumpVisible[msgId] = false;
  }

  function scrollStatusLogToBottomInternal(msgId: string) {
    void nextTick(() => {
      const el = statusLogScrollRefs.get(msgId);
      if (!el) return;
      if (chainScrollPinned.get(msgId) ?? true) {
        el.scrollTop = el.scrollHeight;
      }
      onChainViewportScroll(msgId);
    });
  }

  function bindStatusLogScroll(el: HTMLElement | null, msgId: string) {
    if (el) {
      statusLogScrollRefs.set(msgId, el);
      if (!chainScrollPinned.has(msgId)) chainScrollPinned.set(msgId, true);
      if (chatSending.value && msgId === activeAssistantMsgId.value) {
        scrollStatusLogToBottomInternal(msgId);
      } else {
        onChainViewportScroll(msgId);
      }
    } else {
      statusLogScrollRefs.delete(msgId);
      chainScrollPinned.delete(msgId);
      delete chainJumpVisible[msgId];
    }
  }

  return {
    chainJumpVisible,
    bindStatusLogScroll,
    onChainViewportScroll,
    jumpChainToLatest,
    scrollStatusLogToBottomInternal,
  };
}
