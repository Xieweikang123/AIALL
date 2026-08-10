<template>
  <div class="msg-list" :class="{ 'msg-list--live-run': ctx.chatSending.value }">
    <button
      v-if="hiddenMessageCount > 0"
      type="button"
      class="ghost small load-earlier-btn"
      @click="showAllMessages = true"
    >
      显示较早的 {{ hiddenMessageCount }} 条消息
    </button>
    <div
      v-for="m in visibleMessages"
      :key="m.id"
      v-memo="[messageMemoKey(m)]"
      class="msg"
    :class="[
      m.role,
      {
        'msg--live': m.role === 'assistant' && ctx.isAgentRunning(m),
        'msg--live-waiting':
          m.role === 'assistant' && ctx.isAgentRunning(m) && !ctx.hasAgentActivity(m),
        'msg--agent-done': m.role === 'assistant' && !ctx.isAgentRunning(m) && ctx.hasAgentActivity(m),
      },
    ]"
    :data-message-id="m.id"
    @mouseup="ctx.onMessageSelect($event, m)"
    @dblclick="ctx.onMessageDoubleClick($event, m)"
  >
    <div class="msg-avatar" aria-hidden="true">{{ m.role === "user" ? "你" : "AI" }}</div>
    <div class="msg-body">
      <div class="msg-head">
        <div class="msg-head-left">
          <div class="msg-role">{{ m.role === "user" ? "你" : "Agent" }}</div>
          <span v-if="m.role === 'assistant' && m.chatMode" class="msg-mode-badge" :class="`msg-mode-badge--${m.chatMode}`">
            {{ chatModeLabel(m.chatMode) }}
          </span>
        </div>
        <div
          v-if="!ctx.chatSending.value || ctx.isAgentRunning(m)"
          class="msg-toolbar"
        >
          <button
            v-if="(m.role === 'user' || (m.role === 'assistant' && !ctx.isAgentRunning(m)))"
            type="button"
            class="ghost small"
            title="复制此消息"
            @click="ctx.copyText(ctx.messageDisplayContent(m))"
          >
            复制
          </button>
          <button
            v-if="ctx.canExecutePlanMessage(m)"
            type="button"
            class="ghost small plan-exec-btn"
            title="按此方案开始改代码"
            @click="ctx.executePlanFromMessage(m.id)"
          >
            执行方案
          </button>
          <button v-if="m.role === 'user'" type="button" class="ghost small" title="编辑此消息" @click="ctx.editUserMessage(m.id)">
            编辑
          </button>
          <button v-if="m.role === 'user'" type="button" class="ghost small" title="删除本条问答" @click="ctx.undoExchange(m.id, $event)">
            撤销
          </button>
          <button
            v-if="m.role === 'user'"
            type="button"
            class="ghost small"
            title="从此问题重新生成"
            :disabled="!ctx.configReady.value || !ctx.projectOpened.value"
            @click="ctx.resendFromMessage(m.id)"
          >
            重发
          </button>
          <button
            v-if="ctx.canResumeAgentRun(m) && !ctx.isPartialWrittenRunInterrupt(m) && !ctx.isAgentRunning(m)"
            type="button"
            class="ghost small resume-btn"
            title="从断点继续运行，保留已完成步骤"
            :disabled="!ctx.configReady.value || !ctx.projectOpened.value || ctx.chatSending.value"
            @click="ctx.resumeAgentRun(m.id)"
          >
            {{ ctx.resolveAgentResumeButtonLabel(m) }}
          </button>
        </div>
      </div>
      <div
        v-if="m.role === 'assistant' && ctx.isAssistantStalled(m)"
        class="agent-recovery-banner agent-stall-banner"
      >
        <span class="agent-recovery-text">运行似乎已卡住，可停止或恢复。</span>
        <div class="agent-recovery-actions">
          <button type="button" class="secondary compact" @click="ctx.stopAgent()">停止</button>
          <button
            type="button"
            class="secondary compact"
            :disabled="!ctx.configReady.value || !ctx.projectOpened.value"
            @click="ctx.forceRecoverStalledRun(m.id)"
          >
            恢复运行
          </button>
        </div>
      </div>
      <div
        v-else-if="m.role === 'assistant' && ctx.canResumeAgentRun(m) && !ctx.isAgentRunning(m)"
        class="agent-recovery-banner"
      >
        <span class="agent-recovery-text">
          {{
            ctx.isPartialWrittenRunInterrupt(m)
              ? '运行中断，可从中断处继续。'
              : ctx.recoverableAgentErrorHint(m, m.agentFailureReason || m.content || '连接中断')
          }}
        </span>
        <button
          type="button"
          class="secondary compact"
          :disabled="!ctx.configReady.value || !ctx.projectOpened.value || ctx.chatSending.value"
          @click="ctx.resumeAgentRun(m.id)"
        >
          {{ ctx.resolveAgentResumeButtonLabel(m) }}
        </button>
      </div>
      <div
        v-if="m.role === 'assistant' && ctx.isAgentRunning(m)"
        class="msg-live-toolbar"
      >
        <AgentLiveStatusRail
          v-if="!ctx.hasAgentActivity(m)"
          :status-line="agentRunningLabel(m)"
          :waiting-model="isMessageWaitingModel(m)"
          shimmer
          variant="banner"
        />
      </div>
      <AgentMessage
        v-if="m.role === 'assistant' && ctx.hasAgentActivity(m)"
        :msg="m"
        :is-agent-running="ctx.isAgentRunning"
        :agent-status-display="ctx.agentStatusDisplay"
        :agent-live-revision="ctx.isAgentRunning(m) ? ctx.agentLiveRevision.value : 0"
        :patch-assistant-msg="ctx.patchAssistantMsg"
        :schedule-persist-chat="ctx.schedulePersistChat"
        :message-display-content="ctx.messageDisplayContent"
        :resolve-live-agent-source="ctx.resolveLiveAgentSource"
        :show-jump="ctx.chainJumpVisible[m.id]"
        :can-execute-plan="ctx.canExecutePlanMessage(m)"
        :can-resume="ctx.canResumeAgentRun(m) && !ctx.isAgentRunning(m)"
        :resume-label="ctx.resolveAgentResumeButtonLabel(m)"
        :bind-status-log-scroll="ctx.bindStatusLogScroll"
        :on-status-log-scroll="ctx.onStatusLogScroll"
        @execute-plan="ctx.executePlanFromMessage(m.id)"
        @select-option="(option) => ctx.handleAiOptionSelect(option, m)"
        @jump-latest="ctx.jumpChainToLatest(m.id)"
        @open-file="(path) => ctx.previewAgentFile(m.id, path)"
        @open-plan-file="ctx.openPlanFileInEditor(m.planFilePath)"
        @resume="ctx.resumeAgentRun(m.id)"
      />
      <div
        v-if="m.role === 'user' && ctx.userMessageImages(m).length"
        class="msg-user-images"
      >
        <img
          v-for="(url, imageIdx) in ctx.userMessageImages(m)"
          :key="`${m.id}-img-${imageIdx}`"
          :src="url"
          alt="发送的图片"
          class="msg-user-image"
          loading="lazy"
          @error="hideBrokenUserImage"
          @click="openImageViewer(url, '发送的图片')"
        />
      </div>
      <ProjectReportBlock
        v-if="ctx.shouldShowMessageBubble(m, ctx.hasAgentActivity(m))"
        :content="ctx.messageDisplayContent(m)"
        :chat-mode="m.chatMode"
        :streaming="m.role === 'assistant' && ctx.isAgentRunning(m)"
        @open-file="(path) => ctx.previewAgentFile(m.id, path)"
      >
        <PlanDocumentBlock
          :content="ctx.messageDisplayContent(m)"
          :chat-mode="m.chatMode"
          :streaming="m.role === 'assistant' && ctx.isAgentRunning(m)"
          :can-execute="ctx.canExecutePlanMessage(m)"
          :plan-file-path="m.planFilePath"
          :plan-panel-active="ctx.planPanelActive.value && ctx.planPanelMessageId.value === m.id && ctx.planWorkspaceOpen.value"
          :enhance-layout="m.role === 'assistant' && !ctx.isAgentRunning(m)"
          :external-view="shouldUsePlanExternalView(ctx.messageDisplayContent(m), m)"
          @execute="ctx.executePlanFromMessage(m.id)"
          @open-plan-file="ctx.openPlanFileInEditor(m.planFilePath)"
          @focus-panel="ctx.focusPlanPanel(m.id)"
        >
          <ChatMarkdown
            v-if="!shouldUsePlanExternalView(ctx.messageDisplayContent(m), m)"
            class="msg-answer"
            :class="{
              'msg-answer--streaming': m.role === 'assistant' && ctx.isAgentRunning(m),
              'msg-answer--final': m.role === 'assistant' && !ctx.isAgentRunning(m),
            }"
            :content="planMarkdownContent(ctx.messageDisplayContent(m), m.role === 'assistant' && ctx.isAgentRunning(m))"
            :streaming="m.role === 'assistant' && ctx.isAgentRunning(m)"
            :interactive="m.role === 'assistant' && !ctx.isAgentRunning(m)"
            @select-option="(option) => ctx.handleAiOptionSelect(option, m)"
          />
        </PlanDocumentBlock>
      </ProjectReportBlock>

      <div
        v-if="m.role === 'assistant' && m.turnFileDiffs && Object.keys(m.turnFileDiffs).length"
        class="inline-diff-list"
      >
        <div v-if="Object.keys(m.turnFileDiffs).length > 1" class="inline-diff-list-head">
          变更文件 · {{ Object.keys(m.turnFileDiffs).length }}
        </div>
        <div
          v-for="relPath in Object.keys(m.turnFileDiffs)"
          :key="relPath"
          class="inline-diff-card"
          :class="{ 'inline-diff-card--open': ctx.isDiffExpanded(m.id, relPath) }"
        >
          <div
            class="inline-diff-head"
            role="button"
            tabindex="0"
            :aria-expanded="ctx.isDiffExpanded(m.id, relPath)"
            @click="ctx.toggleExpandedDiff(m.id, relPath)"
            @keydown.enter.prevent="ctx.toggleExpandedDiff(m.id, relPath)"
            @keydown.space.prevent="ctx.toggleExpandedDiff(m.id, relPath)"
          >
            <span class="inline-diff-chevron" aria-hidden="true">
              {{ ctx.isDiffExpanded(m.id, relPath) ? "▾" : "▸" }}
            </span>
            <span class="inline-diff-path" :title="relPath">{{ shortDiffPath(relPath) }}</span>
            <span v-if="m.turnFileDiffs[relPath].deleted" class="inline-diff-tag delete">删除</span>
            <span v-else class="inline-diff-tag modify">修改</span>
            <div class="inline-diff-actions" @click.stop>
              <button
                type="button"
                class="inline-diff-action"
                :disabled="!ctx.projectOpened.value"
                title="在编辑器中预览"
                @click="ctx.previewAgentFile(m.id, relPath)"
              >
                预览
              </button>
            </div>
          </div>
          <div class="inline-diff-wrap" :class="{ open: ctx.isDiffExpanded(m.id, relPath) }">
            <div class="inline-diff-cols">
              <div class="inline-diff-col">
                <div class="inline-diff-label">修改前</div>
                <pre class="trace-pre compact">{{ ctx.truncateDiffPreview(m.turnFileDiffs[relPath].before || "（空 / 新文件）") }}</pre>
              </div>
              <div class="inline-diff-col">
                <div class="inline-diff-label">{{ m.turnFileDiffs[relPath].deleted ? "删除后" : "修改后" }}</div>
                <pre class="trace-pre compact">{{ ctx.truncateDiffPreview(m.turnFileDiffs[relPath].deleted ? "（文件已删除）" : (m.turnFileDiffs[relPath].after || "")) }}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div
        v-if="
          m.role === 'assistant' &&
          !ctx.isAgentRunning(m) &&
          !m.streaming &&
          (m.pendingApproval || m.writtenFiles?.length || m.reverted || m.rejected)
        "
        class="msg-actions"
      >
        <span
          v-if="m.pendingApproval && m.turnFileDiffs"
          class="pending-badge"
        >
          {{ ctx.formatPendingApprovalLabel(m.turnFileDiffs, m.agentAborted) }}
        </span>
        <div v-if="m.pendingApproval" class="turn-review-actions">
          <button
            type="button"
            class="secondary compact"
            :disabled="ctx.chatSending.value || !ctx.projectOpened.value || m.applying"
            @click="ctx.acceptAgentTurn(m.id)"
          >
            {{ m.applying ? "确认中…" : "接受修改" }}
          </button>
          <button
            type="button"
            class="ghost compact"
            :disabled="ctx.chatSending.value || !ctx.projectOpened.value || m.reverting"
            @click="ctx.rejectAgentTurn(m.id, $event)"
          >
            {{ m.reverting ? "回滚中…" : "拒绝" }}
          </button>
        </div>
        <span
          v-else-if="m.writtenFiles?.length && !m.reverted && !m.rejected && (m.chatMode === 'build' || m.chatMode === 'auto' || m.chatMode === 'plan')"
          class="applied-badge"
        >
          已写入 {{ m.writtenFiles.length }} 个文件
        </span>
        <button
          v-if="m.writtenFiles?.length && !m.pendingApproval && !m.reverted && !m.rejected && (m.chatMode === 'build' || m.chatMode === 'auto')"
          type="button"
          class="ghost compact"
          :disabled="ctx.chatSending.value || !ctx.projectOpened.value || m.reverting"
          @click="ctx.revertAgentTurn(m.id, $event)"
        >
          {{ m.reverting ? "回滚中…" : "回滚" }}
        </button>
        <span v-else-if="m.reverted" class="reverted-badge">已回滚</span>
        <span v-else-if="m.rejected" class="rejected-badge">已拒绝</span>
      </div>
      <div
        v-if="
          m.role === 'assistant' &&
          m.agentAborted &&
          !ctx.isAgentRunning(m) &&
          !ctx.canResumeAgentRun(m)
        "
        class="agent-recovery-banner agent-abort-banner"
      >
        <span class="agent-recovery-text">运行已中断：{{ ctx.agentAbortDisplayReason(m) }}</span>
      </div>
    </div>
  </div>

    <div
      v-if="awaitingAssistantPlaceholder"
      class="msg assistant pending-assistant-hint"
    >
      <div class="msg-avatar" aria-hidden="true">AI</div>
      <div class="msg-body">
        <div class="msg-head">
          <div class="msg-role">Agent</div>
        </div>
        <div class="msg-status">
          <span class="status-pulse" aria-hidden="true" />
          <span class="msg-status-text">正在启动 Agent…</span>
        </div>
      </div>
    </div>

    <div
      v-else-if="orphanedUserReply"
      class="msg assistant orphaned-reply-hint"
    >
      <div class="msg-avatar" aria-hidden="true">AI</div>
      <div class="msg-body">
        <div class="msg-head">
          <div class="msg-role">Agent</div>
        </div>
        <div class="agent-recovery-banner">
          <span class="agent-recovery-text">
            Agent 未回复（可能因连接中断或切换会话导致）。请点击上方用户消息的「重发」重新提问。
          </span>
        </div>
      </div>
    </div>

    <div class="chat-scroll-anchor" aria-hidden="true" />
  </div>

  <!-- 图片查看器模态框 -->
  <Teleport to="body">
    <Transition name="image-viewer-fade">
      <div
        v-if="viewerOpen"
        ref="viewerOverlay"
        class="image-viewer-overlay"
        tabindex="-1"
        @click="handleBackdropClick"
        @keydown="handleImageKeydown"
      >
        <div class="image-viewer-container" @click.stop>
          <button class="image-viewer-close" @click="closeImageViewer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
          <img
            :src="viewerUrl"
            class="image-viewer-image"
            :alt="viewerAlt"
            @click.stop
          />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from "vue";
import AgentMessage from "../AgentMessage.vue";
import AgentLiveStatusRail from "../AgentLiveStatusRail.vue";
import ChatMarkdown from "../ChatMarkdown.vue";
import { isAgentWaitingModelPhase } from "../../services/agentCompactStatus";
import PlanDocumentBlock from "../PlanDocumentBlock.vue";
import ProjectReportBlock from "../ProjectReportBlock.vue";
import { enrichPlanMarkdownForDisplay } from "../../services/planDocumentDisplay";
import { shouldUsePlanExternalView } from "../../services/planFile";
import { vibeChatMessageContextKey, type VibeChatMessageItem } from "../../composables/vibeChatMessageContext";
import { isAwaitingAssistantPlaceholder, isOrphanedUserReply } from "../../utils/vibeHelpers";

const injectedCtx = inject(vibeChatMessageContextKey);
if (!injectedCtx) {
  throw new Error("VibeChatMessages requires vibeChatMessageContext");
}
const ctx = injectedCtx;

const MESSAGE_WINDOW = 80;
const showAllMessages = ref(true);

watch(
  () => ctx.chatMessages.value[0]?.id ?? "",
  () => {
    showAllMessages.value = true;
  },
);

watch(
  () => ctx.chatMessages.value.length,
  (count, prev) => {
    if (count > MESSAGE_WINDOW && prev <= MESSAGE_WINDOW) {
      showAllMessages.value = false;
    }
  },
);

const hiddenMessageCount = computed(() => {
  if (showAllMessages.value) return 0;
  return Math.max(0, ctx.chatMessages.value.length - MESSAGE_WINDOW);
});

const visibleMessages = computed(() => {
  const messages = ctx.chatMessages.value;
  if (showAllMessages.value || messages.length <= MESSAGE_WINDOW) return messages;
  return messages.slice(messages.length - MESSAGE_WINDOW);
});

function messageMemoKey(m: VibeChatMessageItem): unknown[] {
  if (ctx.isAgentRunning(m)) {
    return [
      m.id,
      "running-lite",
      ctx.agentLiveRevision.value,
      m.streamChars ?? 0,
      m.agentPhase,
      m.content?.length ?? 0,
    ];
  }
  return [
    m.id,
    m.content,
    m.reverted,
    m.rejected,
    m.writtenFiles?.length ?? 0,
    m.agentFailed,
    m.agentRecoverable,
    Object.keys(m.turnFileDiffs ?? {}).length,
  ];
}

const orphanedUserReply = computed(() =>
  isOrphanedUserReply(ctx.chatMessages.value, ctx.chatSending.value),
);

const awaitingAssistantPlaceholder = computed(() =>
  isAwaitingAssistantPlaceholder(ctx.chatMessages.value, ctx.chatSending.value),
);

// 图片查看器状态
const viewerOpen = ref(false);
const viewerUrl = ref("");
const viewerAlt = ref("");

const viewerOverlay = ref<HTMLElement>();

function openImageViewer(url: string, alt: string = "发送的图片") {
  viewerUrl.value = url;
  viewerAlt.value = alt;
  viewerOpen.value = true;
  nextTick(() => {
    viewerOverlay.value?.focus();
  });
}

function closeImageViewer() {
  viewerOpen.value = false;
  viewerUrl.value = "";
  viewerAlt.value = "";
}

function handleImageKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    closeImageViewer();
  }
}

function handleBackdropClick(e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains("image-viewer-overlay")) {
    closeImageViewer();
  }
}

function hideBrokenUserImage(event: Event) {
  const img = event.target;
  if (img instanceof HTMLImageElement) {
    img.style.display = "none";
  }
}

function planMarkdownContent(displayContent: string, whileStreaming: boolean): string {
  return enrichPlanMarkdownForDisplay(displayContent, { whileStreaming });
}

const CHAT_MODE_LABELS: Record<string, string> = {
  ask: "问答",
  build: "改代码",
  plan: "方案",
  explore: "探索",
  auto: "自动",
};

function chatModeLabel(mode: string | undefined): string {
  if (!mode) return "";
  return CHAT_MODE_LABELS[mode] ?? mode;
}

function agentRunningLabel(m: VibeChatMessageItem): string {
  const live = ctx.agentStatusDisplay(m)?.trim();
  if (live) return live;
  if (m.chatMode === "explore") return "正在了解项目…";
  if (m.chatMode === "ask") return "思考中…";
  if (m.chatMode === "plan" && ctx.planExecutionActive.value) return "执行方案中…";
  if (m.chatMode === "plan") return "规划中…";
  return "Agent 运行中…";
}

function isMessageWaitingModel(m: VibeChatMessageItem): boolean {
  return isAgentWaitingModelPhase({
    agentPhase: m.agentPhase,
    statusLine: agentRunningLabel(m),
  });
}

function shortDiffPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) return normalized;
  return parts.slice(-2).join("/");
}
</script>

<style scoped>
.msg-live-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 4px;
  padding: 0 2px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
}

.msg-live-toolbar :deep(.agent-live-status--banner) {
  flex: 1;
  min-width: 0;
  margin: 0;
  border: 0;
  background: transparent;
}

.msg-live-toolbar :deep(.agent-live-status-row) {
  align-items: center;
  padding: 4px 0;
}

.msg-live-toolbar :deep(.agent-live-status-dot) {
  width: 6px;
  height: 6px;
  margin-top: 0;
  background: #6bb5a0;
  box-shadow: 0 0 6px rgba(107, 181, 160, 0.28);
}

.msg-live-toolbar :deep(.agent-live-status-line) {
  flex-wrap: nowrap;
  overflow: hidden;
}

.msg-live-toolbar :deep(.agent-live-status-phase) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 500;
  color: rgba(203, 211, 220, 0.84);
}

</style>
