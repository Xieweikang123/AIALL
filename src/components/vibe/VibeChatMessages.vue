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
    :class="m.role"
    :data-message-id="m.id"
    @mouseup="ctx.onMessageSelect($event, m)"
    @dblclick="ctx.onMessageDoubleClick($event, m)"
  >
    <div class="msg-avatar" aria-hidden="true">{{ m.role === "user" ? "你" : "AI" }}</div>
    <div class="msg-body">
      <div class="msg-head">
        <div class="msg-role">{{ m.role === "user" ? "你" : "Agent" }}</div>
        <div v-if="!ctx.chatSending.value" class="msg-toolbar">
          <button
            v-if="ctx.canExecutePlanMessage(m)"
            type="button"
            class="ghost small plan-exec-btn"
            title="按此方案开始改代码"
            @click="ctx.executePlanFromMessage(m.id)"
          >
            执行方案
          </button>
          <button type="button" class="ghost small" title="复制此消息" @click="ctx.copyText(ctx.messageDisplayContent(m))">
            复制
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
            v-if="ctx.canResumeAgentRun(m) && !ctx.isPartialWrittenRunInterrupt(m)"
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
        <span class="agent-recovery-text">运行似乎已卡住（长时间无进展），可停止或恢复运行。</span>
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
        v-else-if="m.role === 'assistant' && ctx.canResumeAgentRun(m) && !ctx.isPartialWrittenRunInterrupt(m) && !ctx.isAgentRunning(m)"
        class="agent-recovery-banner"
      >
        <span class="agent-recovery-text">
          {{ ctx.recoverableAgentErrorHint(m, m.agentFailureReason || m.content || '连接中断') }}
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
        @execute-plan="ctx.executePlanFromMessage(m.id)"
        @select-option="(option) => ctx.handleAiOptionSelect(option, m)"
        @jump-latest="ctx.jumpChainToLatest(m.id)"
        @open-file="(path) => ctx.previewAgentFile(m.id, path)"
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
      <PlanDocumentBlock
        v-if="ctx.shouldShowMessageBubble(m, ctx.hasAgentActivity(m))"
        :content="ctx.messageDisplayContent(m)"
        :chat-mode="m.chatMode"
        :streaming="m.role === 'assistant' && ctx.isAgentRunning(m)"
        :can-execute="ctx.canExecutePlanMessage(m)"
        :enhance-layout="m.role === 'assistant' && !ctx.isAgentRunning(m)"
        @execute="ctx.executePlanFromMessage(m.id)"
      >
        <ChatMarkdown
          class="msg-answer"
          :class="{
            'msg-answer--streaming': m.role === 'assistant' && ctx.isAgentRunning(m),
            'msg-answer--final': m.role === 'assistant' && !ctx.isAgentRunning(m),
          }"
          :content="planMarkdownContent(m)"
          :streaming="m.role === 'assistant' && ctx.isAgentRunning(m)"
          :interactive="m.role === 'assistant' && !ctx.isAgentRunning(m)"
          @select-option="(option) => ctx.handleAiOptionSelect(option, m)"
        />
      </PlanDocumentBlock>
      <div
        v-if="m.role === 'assistant' && ctx.canResumeAgentRun(m) && ctx.isPartialWrittenRunInterrupt(m) && !ctx.isAgentRunning(m)"
        class="agent-recovery-footer"
      >
        <button
          type="button"
          class="secondary compact"
          :disabled="!ctx.configReady.value || !ctx.projectOpened.value || ctx.chatSending.value"
          @click="ctx.resumeAgentRun(m.id)"
        >
          继续
        </button>
      </div>
      <div
        v-if="
          m.role === 'assistant' &&
          ctx.isAgentRunning(m) &&
          !ctx.hasAgentActivity(m)
        "
        class="msg-status"
      >
        <span v-if="ctx.isAgentRunning(m)" class="status-pulse" aria-hidden="true" />
        <span class="msg-status-text">
          {{
            ctx.agentStatusDisplay(m) ||
            (m.chatMode === 'ask'
              ? '思考中…'
              : m.chatMode === 'plan' && ctx.isAgentRunning(m) && ctx.planExecutionActive.value
                ? '执行方案中…'
                : m.chatMode === 'plan'
                  ? '规划中…'
                  : 'Agent 运行中…')
          }}
        </span>
      </div>
      <div
        v-if="m.role === 'assistant' && m.turnFileDiffs && Object.keys(m.turnFileDiffs).length"
        class="inline-diff-list"
      >
        <div
          v-for="relPath in Object.keys(m.turnFileDiffs)"
          :key="relPath"
          class="inline-diff-card"
        >
          <div class="inline-diff-head">
            <span class="inline-diff-path">{{ relPath }}</span>
            <span v-if="m.turnFileDiffs[relPath].deleted" class="inline-diff-tag delete">删除</span>
            <span v-else class="inline-diff-tag modify">修改</span>
            <button
              type="button"
              class="ghost small"
              :disabled="!ctx.projectOpened.value"
              @click="ctx.previewAgentFile(m.id, relPath)"
            >
              编辑器预览
            </button>
            <button
              type="button"
              class="ghost small diff-toggle-btn"
              @click="ctx.toggleExpandedDiff(m.id, relPath)"
            >
              {{ ctx.isDiffExpanded(m.id, relPath) ? '收起' : '展开' }}
            </button>
          </div>
          <div class="inline-diff-wrap" :class="{ open: ctx.isDiffExpanded(m.id, relPath) }">
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
      <div
        v-if="
          m.role === 'assistant' &&
          !ctx.isAgentRunning(m) &&
          !m.streaming &&
          (m.writtenFiles?.length)
        "
        class="msg-actions"
      >
        <span
          v-if="m.writtenFiles?.length && !m.reverted && !m.rejected && (m.chatMode === 'build' || m.chatMode === 'plan')"
          class="applied-badge"
        >
          已写入 {{ m.writtenFiles.length }} 个文件
        </span>
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
import ChatMarkdown from "../ChatMarkdown.vue";
import PlanDocumentBlock from "../PlanDocumentBlock.vue";
import { enrichPlanMarkdownForDisplay } from "../../services/planDocumentDisplay";
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
    return [m.id, "running-lite", ctx.agentLiveRevision.value];
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

function planMarkdownContent(msg: VibeChatMessageItem): string {
  const raw = ctx.messageDisplayContent(msg);
  const whileStreaming = msg.role === "assistant" && ctx.isAgentRunning(msg);
  return enrichPlanMarkdownForDisplay(raw, { whileStreaming });
}
</script>
