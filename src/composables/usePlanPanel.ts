import { ref, watch, type Ref } from "vue";
import {
  resolvePlanContentForDisplay,
  canForceOpenPlanPanel,
  qualifiesPlanPanelSync,
  assistantMessageHoldsPlanDocument,
} from "../services/planFile";
import { looksLikeStreamingPlanContent } from "../services/planDocumentDisplay";
import type { VibeChatMessage } from "../types/vibeChat";

export type PlanPanelSnapshot = {
  messageId: string;
  content: string;
  streaming: boolean;
  planFilePath?: string;
  canExecute: boolean;
};

export function usePlanPanel(options: {
  chatMessages: Ref<VibeChatMessage[]>;
  chatSending: Ref<boolean>;
  agentLiveRevision: Ref<number>;
  projectPath: Ref<string>;
  projectOpened: Ref<boolean>;
  activeSessionId: Ref<string>;
  messageDisplayContent: (msg: VibeChatMessage) => string;
  isAgentRunning: (msg: VibeChatMessage) => boolean;
  canExecutePlanMessage: (msg: VibeChatMessage) => boolean;
  expandEditor: () => void;
}) {
  const active = ref(false);
  const content = ref("");
  const streaming = ref(false);
  const messageId = ref("");
  const planFilePath = ref<string | undefined>();
  const canExecute = ref(false);
  const pinnedMessageId = ref<string | undefined>();
  const userDismissed = ref(false);
  let syncToken = 0;

  function applySnapshot(snap: PlanPanelSnapshot) {
    active.value = true;
    content.value = snap.content;
    streaming.value = snap.streaming;
    messageId.value = snap.messageId;
    planFilePath.value = snap.planFilePath;
    canExecute.value = snap.canExecute;
    options.expandEditor();
  }

  function resolvePlanMessage(): VibeChatMessage | undefined {
    if (pinnedMessageId.value) {
      const pinned = options.chatMessages.value.find((m) => m.id === pinnedMessageId.value);
      if (pinned?.role === "assistant" && pinned.chatMode === "plan") return pinned;
    }
    const running = options.chatMessages.value.find(
      (m) => m.role === "assistant" && options.isAgentRunning(m) && m.chatMode === "plan",
    );
    if (running) {
      const runningText = options.messageDisplayContent(running);
      if (
        assistantMessageHoldsPlanDocument(runningText, running)
        || looksLikeStreamingPlanContent(runningText)
      ) {
        return running;
      }
    }
    return [...options.chatMessages.value].reverse().find((m) => {
      if (m.role !== "assistant" || m.chatMode !== "plan") return false;
      return assistantMessageHoldsPlanDocument(options.messageDisplayContent(m), m);
    });
  }

  async function syncFromChat(opts?: { force?: boolean }) {
    const token = ++syncToken;
    void options.agentLiveRevision.value;
    const force = opts?.force === true;
    const msg = resolvePlanMessage();
    if (!msg) return;

    const displayed = options.messageDisplayContent(msg);
    const root = options.projectPath.value.trim();
    const text = (
      await resolvePlanContentForDisplay(root, msg, displayed)
    ).trim();

    if (token !== syncToken) return;
    if (!text) return;

    const qualifies = qualifiesPlanPanelSync(text, msg, options.isAgentRunning(msg));
    const isRunning = options.isAgentRunning(msg);
    const canForce = canForceOpenPlanPanel(text, msg);
    const shouldOpen = force ? canForce : qualifies;
    if (!shouldOpen) return;
    const isNewPlanRun = isRunning && msg.chatMode === "plan";
    if (!force && !active.value && userDismissed.value && !isNewPlanRun) return;

    applySnapshot({
      messageId: msg.id,
      content: text,
      streaming: options.isAgentRunning(msg),
      planFilePath: msg.planFilePath,
      canExecute: options.canExecutePlanMessage(msg),
    });
  }

  watch(
    () => [
      options.chatMessages.value,
      options.chatSending.value,
      options.agentLiveRevision.value,
      options.projectPath.value,
      options.projectOpened.value,
      options.activeSessionId.value,
      pinnedMessageId.value,
    ] as const,
    () => {
      void syncFromChat();
    },
    { deep: true },
  );

  watch(
    () => options.chatSending.value,
    (sending, prev) => {
      if (sending && !prev) {
        pinnedMessageId.value = undefined;
      }
      if (!sending && prev) {
        void syncFromChat();
      }
    },
  );

  function focusPanel(targetMessageId?: string) {
    userDismissed.value = false;
    if (targetMessageId) pinnedMessageId.value = targetMessageId;
    void syncFromChat({ force: true });
  }

  function closePanel() {
    active.value = false;
    userDismissed.value = true;
    pinnedMessageId.value = undefined;
  }

  function patchFilePath(path: string, mid?: string) {
    if (mid && messageId.value && mid !== messageId.value) return;
    planFilePath.value = path;
    if (!userDismissed.value) {
      void syncFromChat();
    }
  }

  return {
    active,
    content,
    streaming,
    messageId,
    planFilePath,
    canExecute,
    focusPanel,
    closePanel,
    patchFilePath,
    syncFromChat,
  };
}
