<template>
  <div class="vibe-page">
    <AppToolbar
      :project-path="projectPath"
      :loading-tree="loadingTree"
      :picking-folder="pickingFolder"
      :tree-error="treeError"
      :retry-countdown="retryCountdown"
      :project-opened="projectOpened"
      @update:project-path="projectPath = $event"
      @open-project-by-input="openProjectByInput"
      @handle-open-project="handleOpenProject"
      @refresh-tree="refreshTree"
      @clear-retry="clearRetryTimer"
      @update:tree-error="treeError = $event"
      @open-recent-project="openProjectByPath"
    />

    <ProjectSwitcherBar
      :project-list="projectHistoryList"
      :current-path="projectPath"
      :loading-tree="loadingTree"
      :picking-folder="pickingFolder"
      @switch-project="openProjectByPath"
      @remove-project="removeRecentProject"
      @open-new-project="handleOpenProject"
    />

    <main ref="workspaceRef" class="workspace" :class="{ 'no-project': !projectOpened, 'editor-collapsed': editorCollapsed }">
      <VibeWorkspaceWelcome
        :show="!projectOpened && !loadingTree"
        :loading-tree="loadingTree"
        :picking-folder="pickingFolder"
        @open-project="handleOpenProject"
      />
      <FilePanel
        :file-panel-width="filePanelWidth"
        :loading-tree="loadingTree"
        :git-panel-mode="gitPanelMode"
        :project-opened="projectOpened"
        :search-mode="searchMode"
        :search-query="searchQuery"
        :search-loading="searchLoading"
        :search-error="searchError"
        :editor-collapsed="editorCollapsed"
        :git-change-count="gitChangeCount"
        :git-unstaged-files="gitUnstagedFiles"
        :git-staged-files="gitStagedFiles"
        :session-list="sessionList"
        :active-session-id="activeSessionId"
        :active-session-title="activeSessionTitle"
        :session-picker-open="sessionPickerOpen"
        :session-picker-title="sessionPickerTitle"
        :syncing-chat-store="syncingChatStore"
        :chat-store-sync-message="chatStoreSyncMessage"
        :chat-sending="chatSending"
        :session-sending-ids="sendingSessionIdList"
        @update:git-panel-mode="gitPanelMode = $event"
        @update:search-query="searchQuery = $event"
        @update:search-mode="searchMode = $event"
        @handle-search="handleSearch"
        @create-new-file="createNewFile"
        @create-new-folder="createNewFolder"
        @expand-editor="expandEditor"
        @refresh-git-status="refreshGitStatus(gitIsRepo ? { showLoading: false } : undefined)"
        @switch-session="switchSession"
        @remove-session="removeSession"
        @start-new-session="handleStartNewSession"
        @copy-session-info="copySessionInfo"
        @sync-chat-store-to-disk="syncChatStoreToDisk"
      >

        <GitPanel
          v-if="gitPanelMode === 'git'"
          :project-opened="projectOpened"
          :git-loading="gitLoading"
          :git-is-repo="gitIsRepo"
          :git-status-known="gitStatusKnown"
          :git-error="gitError"
          :git-branch="gitBranch"
          :git-tracking-branch="gitTrackingBranch"
          :git-remotes="gitRemotes"
          :git-ahead="gitAhead"
          :git-behind="gitBehind"
          :git-stashes="gitStashes"
          :git-status="gitStatus"
          :git-staged-files="gitStagedFiles"
          :git-unstaged-files="gitUnstagedFiles"
          :can-git-commit="canGitCommit"
          :git-commit-message="gitCommitMessage"
          :git-committing="gitCommitting"
          :git-gen-step="gitGenStep"
          :git-ai-push-step="gitAiPushStep"
          :git-stash-action="gitStashAction"
          :git-stash-message="gitStashMessage"
          :git-stash-open="gitStashOpen"
          :git-staged-open="gitStagedOpen"
          :git-unstaged-open="gitUnstagedOpen"
          :git-log-open="gitLogOpen"
          :git-log-entries="gitLogEntries"
          :selected-git-files="selectedGitFiles"
          :git-diff-loading-key="gitDiffLoadingKey"
          :git-remote-action="gitRemoteAction"
          :config-ready="configReady"
          :file-watcher-active="fileWatcherActive"
          :file-watcher-connected="fileWatcherConnected"
          :expanded-git-log-entries="expandedGitLogEntries"
          @refresh="refreshGitStatus()"
          @do-fetch="doFetch"
          @do-pull="doPull"
          @do-push="doPush"
          @commit-git="commitGit"
          @generate-commit-message="generateCommitMessage"
          @ai-commit-and-push="aiCommitAndPush"
          @stage-file="stageFile"
          @unstage-file="unstageFile"
          @stage-all="stageAll"
          @unstage-all="unstageAll"
          @discard-file="discardFile"
          @discard-all="discardAll"
          @do-stash-save="doStashSave"
          @do-stash-apply="doStashApply"
          @do-stash-drop="doStashDrop"
          @update:git-stash-open="gitStashOpen = $event"
          @update:git-staged-open="gitStagedOpen = $event"
          @update:git-unstaged-open="gitUnstagedOpen = $event"
          @update:git-log-open="gitLogOpen = $event"
          @update:git-commit-message="gitCommitMessage = $event"
          @update:git-stash-message="gitStashMessage = $event"
          @toggle-git-log-entry="toggleGitLogEntry"
          @open-git-log-file="openGitLogFile"
          @on-git-file-pointer-down="onGitFilePointerDown"
          @on-git-file-contextmenu="onGitFileContextMenu"
        />

        <div v-if="gitPanelMode === 'files' && !projectOpened" class="panel-empty">
          <span class="panel-empty-icon" aria-hidden="true">📁</span>
          <p class="panel-empty-title">尚未打开项目</p>
          <p class="panel-empty-hint">点击欢迎页或顶部「打开项目」选择文件夹</p>
        </div>

        <div v-else-if="gitPanelMode === 'files' && searchMode === 'content' && contentSearchResults.length" class="file-list">
          <button
            v-for="item in contentSearchResults"
            :key="`${item.path}:${item.line}`"
            type="button"
            class="file-item content-result"
            :class="{ active: item.path === activeFilePath }"
            @click="openFile(item.path)"
          >
            <span class="file-icon">📄</span>
            <span class="file-result-body">
              <span class="file-name">{{ item.relative }}:{{ item.line }}</span>
              <span class="file-result-text">{{ item.text }}</span>
            </span>
          </button>
        </div>

        <div v-else-if="gitPanelMode === 'files' && searchMode === 'file' && searchResults.length" class="file-list">
          <div
            v-for="item in searchResults"
            :key="item.path"
            role="button"
            tabindex="0"
            class="file-item"
            :class="{ active: item.path === activeFilePath, 'file-item-draggable': !item.isDirectory }"
            @keydown.enter="openFile(item.path)"
            @keydown.space.prevent="openFile(item.path)"
            @pointerdown="onSearchResultPointerDown($event, item)"
          >
            <span class="file-icon">{{ item.isDirectory ? "📁" : "📄" }}</span>
            <span class="file-name">{{ item.name }}</span>
          </div>
        </div>

        <div v-else-if="gitPanelMode === 'files'" class="file-tree">
          <FileTreeNode
            v-for="node in fileTree"
            :key="node.path"
            :node="node"
            :active-path="activeFilePath"
            :selected-path="selectedTreePath"
            :renaming-path="renamingPath"
            :expanded-dirs="expandedDirs"
            :project-path="projectPath"
            @toggle="toggleDir"
            @open="openFile"
            @select="selectTreeItem"
            @contextmenu="showContextMenu"
            @rename="commitRename"
            @rename-cancel="cancelRename"
            @file-drag-start="onFileDragStart"
            @file-drag-move="onFileDragMove"
            @file-drag-end="onFileDragEnd"
          />
        </div>
      </FilePanel>

      <div class="resize-handle" @mousedown="startResize('file', $event)"></div>

      <EditorPanel
        :active-file-path="activeFilePath"
        :file-content="fileContent"
        :file-dirty="fileDirty"
        :file-load-error="fileLoadError"
        :active-file-diff="activeFileDiff"
        :active-file-read-only="activeFileReadOnly"
        :show-diff-mode="showDiffMode"
        :open-tabs="openTabs"
        :parent-editor-collapsed="editorCollapsed"
        :selected-code="selectedCode"
        @update:file-content="fileContent = $event"
        @switch-tab="switchTab"
        @close-tab="closeTab"
        @toggle-diff-mode="toggleDiffMode"
        @save-file="onSaveFile"
        @reload-file="reloadFile"
        @collapse-editor="collapseEditor"
        @editor-change="onEditorChange"
        @editor-select="onEditorSelect"
        @ask-ai-with-code="askAiWithCode"
      />

      <div
        v-show="!editorCollapsed"
        class="resize-handle"
        @mousedown="startResize('chat', $event)"
      ></div>

      <ChatPanel
        ref="chatPanelRef"
        :project-opened="projectOpened"
        :chat-sending="chatSending"
        :chat-messages="chatMessages"
        :chat-mode="chatMode"
        :chat-error="chatError"
        :config-ready="configReady"
        :api-key-ready="apiKeyReady"
        :ai-config-status-text="aiConfigStatusText"
        :can-send-chat="canSendChat"
        :chat-placeholder="chatPlaceholder"
        :recoverable-assistant-msg="recoverableAssistantMsg"
        :agent-running-status="agentRunningStatusText"
        :stalled-assistant-msg="stalledAssistantMsg"
        :auto-resume-seconds-left="autoResumeSecondsLeft"
        :pending-prompt-queue="pendingPromptQueue"
        :session-list="sessionList"
        :active-session-id="activeSessionId"
        :active-session-title="activeSessionTitle"
        :session-picker-open="sessionPickerOpen"
        :session-picker-title="sessionPickerTitle"
        :syncing-chat-store="syncingChatStore"
        :chat-store-sync-message="chatStoreSyncMessage"
        :is-dragging="isDragging"
        :editor-collapsed="editorCollapsed"
        :quoted-messages="quotedMessages"
        :mention-open="mentionOpen"
        :mention-results="mentionResults"
        :mention-active-index="mentionActiveIndex"
        :chat-input-focused="chatInputFocused"
        :can-switch-to-newer-session="canSwitchToNewerSession"
        :can-switch-to-older-session="canSwitchToOlderSession"
        :switching-session="switchingSession"
        :switching-project="switchingProject"
        :chat-panel-style="chatPanelStyle"
        :show-token-detail="showTokenDetail"
        :token-detail-data="tokenDetailData"
        :total-token-usage="totalTokenUsage"
        :project-memory-open="projectMemoryOpen"
        :project-memory-draft="projectMemoryDraft"
        :project-memory-loading="projectMemoryLoading"
        :project-memory-saving="projectMemorySaving"
        :project-memory-message="projectMemoryMessage"
        :project-memory-max-chars="projectMemoryMaxChars"
        :project-memory-has-content="projectMemoryHasContent"
        :agent-suggestions="activeAgentSuggestions"
        @on-chat-drag-enter="onChatDragEnter"
        @on-chat-drag-over="onChatDragOver"
        @on-chat-drag-leave="onChatDragLeave"
        @on-chat-drop="onChatDrop"
        @switch-to-adjacent-session="switchToAdjacentSession"
        @toggle-session-picker="toggleSessionPicker"
        @start-new-session="handleStartNewSession"
        @switch-session="switchSession"
        @copy-session-info="copySessionInfo"
        @remove-session="removeSession"
        @sync-chat-store-to-disk="syncChatStoreToDisk"
        @clear-chat="clearChat"
        @apply-example="applyExample"
        @apply-suggestion="handleAgentSuggestion"
        @on-chat-scroll="onChatScroll"
        @clear-pending-queue="clearPendingPromptQueue"
        @update:quoted-messages="quotedMessages = $event"
        @on-composer-field-keydown="onComposerFieldKeydown"
        @select-mention="selectMention"
        @on-chat-input-box-mousedown="onChatInputBoxMouseDown"
        @update:chat-mode="chatMode = $event"
        @cancel-auto-resume="cancelAutoResume"
        @force-recover-stalled-run="forceRecoverStalledRun"
        @resume-agent-run="resumeAgentRun"
        @stop-agent="stopAgent"
        @send-chat="sendChat"
        @update:show-token-detail="showTokenDetail = $event"
        @open-project-memory="openProjectMemoryEditor"
        @close-project-memory="closeProjectMemoryEditor"
        @save-project-memory="saveProjectMemoryDraft"
        @update:project-memory-draft="projectMemoryDraft = $event"
      >
        <template #messages>
          <VibeChatMessages />
        </template>
        <template #composer>
          <ChatComposerEditor
            ref="composerRef"
            class="chat-composer-editor"
            :placeholder="chatSending ? '输入新指令将打断当前任务…' : chatPlaceholder"
            :disabled="!configReady || !projectOpened"
            @mention-change="onComposerMentionChange"
            @enter-send="sendChat"
            @update:empty="composerEmpty = $event"
            @focus="chatInputFocused = true"
            @blur="chatInputFocused = false"
          />
        </template>
      </ChatPanel>
    </main>

    <Teleport to="body">
      <ConfirmPopup />
      <InputPrompt />
      <div
        v-if="fileDragGhost"
        class="file-drag-ghost"
        :style="{ left: fileDragGhost.x + 12 + 'px', top: fileDragGhost.y + 12 + 'px' }"
      >
        @ {{ fileDragGhost.relative }}
      </div>
      <div v-if="contextMenu.show" class="ctx-overlay" @click="hideContextMenu" @contextmenu.prevent="hideContextMenu">
        <div class="ctx-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @click.stop>
          <button
            v-if="contextMenuTargetIsFile"
            type="button"
            class="ctx-item"
            @click="contextMenuAttachToChat"
          >
            引用到对话
          </button>
          <div v-if="contextMenuTargetIsFile" class="ctx-sep" />
          <button type="button" class="ctx-item" @click="contextMenuCreateFile">+ 新建文件</button>
          <button type="button" class="ctx-item" @click="contextMenuCreateFolder">+ 新建文件夹</button>
          <div class="ctx-sep" />
          <button type="button" class="ctx-item" @click="contextMenuRename">重命名</button>
          <button type="button" class="ctx-item danger" @click="contextMenuDelete">删除</button>
        </div>
      </div>
      <div v-if="gitFileContextMenu.show" class="ctx-overlay" @click="hideGitFileContextMenu" @contextmenu.prevent="hideGitFileContextMenu">
        <div class="ctx-menu" :style="{ left: gitFileContextMenu.x + 'px', top: gitFileContextMenu.y + 'px' }" @click.stop>
          <button type="button" class="ctx-item" @click="gitFileCopyName">复制文件名</button>
        </div>
      </div>
      <button
        v-if="showQuoteButton"
        ref="quoteButtonRef"
        type="button"
        class="quote-floating"
        :style="{ left: quoteButtonPosition.x + 'px', top: quoteButtonPosition.y + 'px' }"
        @mousedown.stop.prevent="quoteSelectedText"
      >
        <span class="quote-icon">❝</span> 引用
      </button>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from "vue";
import "../styles/vibe-coding.scss";
import { appendStatusDetail, truncateDiffPreview, cleanStatusLogText, formatCharCount, isNetworkError, fileName, genId, hasAgentProcessSteps, entryToNode, formatToolMeta, syncRoundGroupsPatch } from "../utils/vibeHelpers";
import { debugLog } from "../utils/debugLog";
import { sessionDiag } from "../utils/sessionDiagLog";
import ChatComposerEditor from "../components/ChatComposerEditor.vue";
import ConfirmPopup from "../components/ConfirmPopup.vue";
import InputPrompt from "../components/InputPrompt.vue";
import FileTreeNode, { type TreeNode } from "../components/FileTreeNode.vue";
import AppToolbar from "../components/vibe/AppToolbar.vue";
import ProjectSwitcherBar from "../components/vibe/ProjectSwitcherBar.vue";
import FilePanel from "../components/vibe/FilePanel.vue";
import GitPanel from "../components/vibe/GitPanel.vue";
import EditorPanel from "../components/vibe/EditorPanel.vue";
import ChatPanel from "../components/vibe/ChatPanel.vue";
import VibeChatMessages from "../components/vibe/VibeChatMessages.vue";
import VibeWorkspaceWelcome from "../components/vibe/VibeWorkspaceWelcome.vue";
import { vibeChatMessageContextKey, type VibeChatMessageContext } from "../composables/vibeChatMessageContext";
import { useConfirm } from "../composables/useConfirm";
import { useFileDrag } from "../composables/useFileDrag";
import { usePanelLayout } from "../composables/usePanelLayout";
import { useGitPanel, type GitFileDiff } from "../composables/useGitPanel";
import { useInputPrompt } from "../composables/useInputPrompt";
import { useEditorPanel } from "../composables/useEditorPanel";
import { useSessionManager } from "../composables/useSessionManager";
import { useChatSessionStore } from "../composables/useChatSessionStore";
import { useSessionMessageCache } from "../composables/useSessionMessageCache";
import { useProjectMemory } from "../composables/useProjectMemory";
import { useAgentRun, type ChatMessage } from "../composables/useAgentRun";
import { parseAgentSuggestions, type AgentSuggestion } from "../services/agentSuggestions";
import type { TurnFileDiff } from "../types/vibeChat";
import { ESCAPE_DISMISS_PRIORITY, registerEscapeDismiss } from "../composables/useEscapeDismiss";
import {
  buildAgentPromptForProfile,
  enrichAgentUserPrompt,
  resolveAgentMaxTurns,
  resolveAgentResumeRunProfile,
  resolveResumeMaxTurns,
  resolveAgentRunProfile,
  shapeAgentHistoryForProfile,
} from "../services/agentRunProfile";
import {
  AGENT_SILENT_CONTINUE_DELAY_MS,
  AGENT_SILENT_CONTINUE_MAX,
  agentStallRecoveryReason,
  agentConnectStallMessage,
  buildAgentMaxTurnsExhaustedMessage,
  buildAgentResumePrompt,
  buildSilentContinueStatusLog,
  canResumeAgentRun,
  hasRecoverableAgentProgress,
  HMR_INTERRUPT_REASON,
  inferAgentRecoveryFlags,
  isPartialWrittenRunInterrupt,
  isAgentMaxTurnsExhausted,
  isAgentConnectPhase,
  isAgentConnectStalled,
  isAgentRunStalled,
  isRecoverableAgentError,
  recoverableAgentErrorHint,
  resolveAgentCompletedTurns,
  resolveAgentFailureBubbleContent,
  resolveAgentResumeButtonLabel,
  shouldSilentAutoContinue,
  resolveAutoResumeSeconds,
} from "../services/agentRecovery";
import {
  persistAgentRunForHmr,
  popPendingAgentRun,
  clearPendingAgentRun,
  registerHmrPreReloadHook,
  type PendingAgentRun,
} from "../services/agentHmrRecovery";
import { compressImageDataUrlsForAgent } from "../services/imageCompress";
import { loadAiChatBaseFromStorage } from "../services/aiLocalConfig";
import {
  buildAgentHistoryFromMessages,
  getSessionDiagSnapshot,
  onStorageError,
  saveVibeChatHistory,
  stripReferenceAttachments,
  stripToolSummaryFromAssistantContent,
  updateVibeChatSessionStatus,
  type PersistedChatMessage,
  type VibeChatSessionMeta,
} from "../services/vibeChatStorage";
import {
  hydrateChatMessagesImages,
  hydrateChatMessageImages,
  chatMessagesNeedImageHydration,
  resolveChatMessageImageUrls,
  resolveImagesForAgentTurn,
} from "../services/vibeChatImageStore";
import {
  isDeleteNotFoundError,
  resolveAgentDoneFileAction,
} from "../services/vibeAgentTurnApply";
import {
  runVibeAgentSse,
  type VibeAgentSseEvent,
  type VibeChatHistoryMessage,
  type VibeChatMode,
} from "../services/vibeAgentClient";
import {
  buildAgentRoundGroupViews,
  recordAgentRoundNarrative,
  recordAgentRoundRequest,
  recordAgentRoundResponse,
  recordAgentRoundStatus,
  recordAgentRoundStreamDelta,
  recordAgentRoundToolStart,
  type AgentRoundGroup,
  type AgentRoundGroupView,
} from "../services/agentRoundGroups";
import {
  buildCursorAgentFeed,
  computeExplorationStats,
  computeLineDelta,
  cursorActionClass,
  formatCollapsedStepsSummary,
  formatCursorActionLabel,
  formatExplorationSummary,
  getRecentFeedActions,
  getRunningFeedAction,
  buildCursorAgentTimeline,
  shouldUseCompactAgentFeed as shouldUseCompactAgentFeedByCount,
  type CursorAgentTimeline,
  type CursorFeedProcessBlock,
} from "../services/agentCursorFeed";
import { type AgentToolStep as AgentToolStepFromToolHelpers } from "../utils/toolHelpers";

import {
  filterDuplicateFeedThoughts,
  finalizeAssistantBubbleContent,
  mergeAssistantTurnText,
  resolveAssistantBubbleContent,
} from "../services/agentMessageDisplay";
import { findLastAssistantContentInMessages } from "../services/agentContinuation";
import { isScrollNearBottom, scrollElementToBottom } from "../utils/scrollViewport";
import { truncatePromptAttachment } from "../utils/truncatePromptAttachment";
import {
  messagePreviewLength,
  shouldCollapseRequestMessage,
} from "../services/agentNarrativeSegments";
import {
  addProjectToHistory,
  clearProjectHistory,
  listProjectHistory,
  removeProjectFromHistory,
  type ProjectHistoryEntry,
} from "../services/vibeProjectHistory";
import {
  createItem,
  deleteItem,
  grepContent,
  listDirectory,
  pickProjectFolder,
  readFile,
  renameItem,
  searchFiles,
  formatFetchError,
  writeFile,
  type FileEntry,
  type GrepMatch,
} from "../services/vibeCodingClient";
import {
  fetchGitDiffContent,
  fetchGitCommitFileDiff,
  fetchGitLog,
  type GitLogEntry,
  type GitLogFile,
} from "../services/vibeGitClient";
import {
  startFileWatcher,
  stopFileWatcher,
  connectFileWatcherStream,
  disconnectFileWatcherStream,
  type FileChangeEvent,
} from "../services/fileWatcherClient";

const { confirm } = useConfirm();
const inputPrompt = useInputPrompt();

const git = useGitPanel(
  () => projectPath.value.trim(),
  () => projectOpened.value,
  () => aiConfig.value,
  () => configReady.value,
  confirm,
  () => void refreshTree(),
);
const session = useSessionManager(() => projectPath.value.trim());
const fileDrag = useFileDrag(
  () => projectPath.value.trim(),
  (ref) => composerRef.value?.insertFileRef(ref),
  (file) => composerRef.value?.insertDroppedFile(file),
);

const STORAGE_KEY = "vibe-coding-project";
const CHAT_MODE_KEY = "vibe-coding-chat-mode";
const PENDING_QUEUE_KEY = "vibe-coding-pending-queue";
const GIT_PANEL_MODE_KEY = "vibe-coding-git-panel-mode";
type ChatRole = "user" | "assistant";
type FileDiff = TurnFileDiff;

type AgentStatusData = Extract<VibeAgentSseEvent, { type: "status" }>["data"] & {
  toolTitle?: string;
  toolDetail?: string;
  retryAttempt?: number;
  retryMaxAttempts?: number;
  retryError?: string;
};

function normalizeChatMessages(messages: PersistedChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    const normalized: ChatMessage = {
      ...m,
      activityExpanded:
        m.activityExpanded ??
        (m.role === "assistant" && hasAgentProcessSteps(m)),
      activityDetailed:
        m.activityDetailed ?? (m.role === "assistant" && hasAgentProcessSteps(m)),
      tools: m.tools?.map((t) => ({
        id: t.id,
        name: t.name || "",
        icon: t.icon || "⚙️",
        title: t.title || t.label,
        detail: t.detail || "",
        label: t.label,
        summary: t.summary,
        ok: t.ok,
        turn: t.turn,
        fullResult: t.fullResult,
        args: t.args,
      })),
      roundGroups: m.roundGroups?.map((group) => ({
        turn: group.turn,
        maxTurns: group.maxTurns,
        narrative: group.narrative,
        modelSteps: group.modelSteps.map((step) => ({ ...step })),
        toolIds: [...group.toolIds],
        request: group.request
          ? { ...group.request, messages: group.request.messages.map((message) => ({ ...message })) }
          : undefined,
        response: group.response
          ? { ...group.response, toolCalls: group.response.toolCalls.map((call) => ({ ...call })) }
          : undefined,
      })),
    };

    if (m.role === "assistant") {
      const inferred = inferAgentRecoveryFlags(normalized);
      if (inferred) {
        normalized.agentFailed = inferred.agentFailed;
        normalized.agentRecoverable = inferred.agentRecoverable;
        normalized.agentFailureReason = inferred.agentFailureReason;
        normalized.agentRecoveryDismissed = false;
        normalized.content = resolveAgentFailureBubbleContent(normalized);
        normalized.activityExpanded = normalized.activityExpanded || true;
      }
    }

    return normalized;
  });
}

const projectPath = ref("");
const projectOpened = ref(false);

const {
  projectMemoryOpen,
  projectMemoryDraft,
  projectMemoryLoading,
  projectMemorySaving,
  projectMemoryMessage,
  projectMemoryMaxChars,
  projectMemoryHasContent,
  openProjectMemoryEditor,
  closeProjectMemoryEditor,
  saveProjectMemoryDraft,
} = useProjectMemory(projectPath, projectOpened);
const loadingTree = ref(false);
const pickingFolder = ref(false);
const treeError = ref("");
const retryCountdown = ref(0);
let retryTimer: ReturnType<typeof setInterval> | null = null;
let retryAbort: AbortController | null = null;

function clearRetryTimer() {
  if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
  retryCountdown.value = 0;
  if (retryAbort) { retryAbort.abort(); retryAbort = null; }
}

async function autoRetryWithCountdown<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number; delayMs?: number; onRetry?: (remaining: number, attempt: number, max: number) => void } = {}
): Promise<T> {
  const { maxRetries = 3, delayMs = 2000, onRetry } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      clearRetryTimer();
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isNetworkError(e) || attempt >= maxRetries) throw e;
      // Start countdown
      let remaining = Math.ceil(delayMs / 1000);
      retryCountdown.value = remaining;
      onRetry?.(remaining, attempt + 1, maxRetries);
      await new Promise<void>((resolve) => {
        retryTimer = setInterval(() => {
          remaining--;
          if (remaining <= 0) {
            clearRetryTimer();
            resolve();
          } else {
            retryCountdown.value = remaining;
            onRetry?.(remaining, attempt + 1, maxRetries);
          }
        }, 1000);
      });
    }
  }
  throw lastErr;
}
type SearchMode = "file" | "content";

interface QuotedMessage {
  messageId: string;
  content: string;
  role: "user" | "assistant";
}

const pendingQuote = ref<QuotedMessage | null>(null);
const quotedMessages = ref<QuotedMessage[]>([]);
const quoteButtonPosition = ref({ x: 0, y: 0 });
const showQuoteButton = ref(false);
const quoteButtonRef = ref<HTMLElement | null>(null);
const openingProject = ref(false);
const searchQuery = ref("");
const searchLoading = ref(false);
const searchError = ref("");
const searchMode = ref<SearchMode>("file");
const searchResults = ref<Array<{ name: string; path: string; isDirectory: boolean }>>([]);
const contentSearchResults = ref<GrepMatch[]>([]);

function loadChatMode(): VibeChatMode {
  try {
    const saved = localStorage.getItem(CHAT_MODE_KEY);
    if (saved === "ask" || saved === "plan") return saved;
    return "build";
  } catch {
    return "build";
  }
}

const chatMode = ref<VibeChatMode>(loadChatMode());
const chatMessages = ref<ChatMessage[]>([]);
const chatSending = ref(false);
// ── 按会话独立的发送状态 ──
const sendingSessionIds = reactive(new Set<string>());
const sessionMessageCache = useSessionMessageCache<ChatMessage>();
let agentRunSessionId = "";

const sendingSessionIdList = computed(() => [...sendingSessionIds]);

function isSessionSending(sessionId: string): boolean {
  return sendingSessionIds.has(sessionId);
}

function syncActiveChatSending() {
  chatSending.value = sendingSessionIds.has(activeSessionId.value);
}

function beginAgentRunSession(sessionId: string) {
  if (!sessionId) return;
  agentRunSessionId = sessionId;
  sendingSessionIds.add(sessionId);
  sessionMessageCache.snapshot(sessionId, chatMessages.value);
  syncActiveChatSending();
}

function endAgentRunSession(sessionId?: string) {
  const sid = (sessionId || agentRunSessionId).trim();
  if (sid) sendingSessionIds.delete(sid);
  if (!sessionId || sid === agentRunSessionId) agentRunSessionId = "";
  syncActiveChatSending();
}

function getAgentRunSessionId(): string {
  return agentRunSessionId;
}

function persistAgentRunSession() {
  const sid = agentRunSessionId;
  const project = projectPath.value.trim();
  if (!sid || !project || sid === activeSessionId.value) return;
  const cached = sessionMessageCache.get(sid);
  if (cached?.length) {
    saveVibeChatHistory(project, cached, sid, { touchTimestamp: false });
  }
}
const switchingProject = ref(false);
const chatError = ref("");
const searchInputRef = ref<HTMLInputElement | null>(null);
const workspaceRef = ref<HTMLElement | null>(null);
let scrollChatRaf = 0;
const CHAT_SCROLL_PIN_THRESHOLD = 80;
let chatPinnedToBottom = true;
const sessionPickerRef = ref<HTMLElement | null>(null);
const chatPanelRef = ref<InstanceType<typeof ChatPanel> | null>(null);
const pendingPromptQueue = ref<string[]>([]);
function persistPendingQueue() {
  try {
    if (pendingPromptQueue.value.length) {
      localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(pendingPromptQueue.value));
    } else {
      localStorage.removeItem(PENDING_QUEUE_KEY);
    }
  } catch {
    // ignore
  }
}

import { type ReferencedFile } from "../composables/useFileDrag";

interface ProjectFileItem {
  name: string;
  path: string;
  relative: string;
}

const composerRef = ref<InstanceType<typeof ChatComposerEditor> | null>(null);
const composerEmpty = ref(true);
const dismissedSuggestionMsgId = ref<string | null>(null);
const chatDropZoneRef = ref<HTMLElement | null>(null);
const chatInputFocused = ref(false);
function onChatInputBoxMouseDown() {
  composerRef.value?.focus();
}
const mentionOpen = ref(false);
const mentionQuery = ref("");
const mentionActiveIndex = ref(0);
const mentionRemoteResults = ref<ProjectFileItem[]>([]);
let mentionSearchTimer: ReturnType<typeof setTimeout> | null = null;
const projectHistoryOpen = ref(false);
const projectHistoryList = ref<ProjectHistoryEntry[]>([]);
const projectHistoryRef = ref<HTMLElement | null>(null);

// Git panel composable
const {
  gitPanelMode, gitStatus, gitBranch, gitIsRepo, gitStatusKnown, gitLoading, gitError,
  gitCommitMessage, gitCommitting, gitGenStep, gitLogEntries, gitLogOpen,
  gitStagedOpen, gitUnstagedOpen, expandedGitLogEntries, selectedGitFiles,
  gitDiffLoadingKey, gitDiffContentCache, gitRemotes, gitTrackingBranch,
  gitAhead, gitBehind, gitRemoteLoading, gitRemoteAction, gitStashes, gitStashOpen,
  gitStashAction, gitStashMessage, gitAiPushStep,
  gitStagedFiles, gitUnstagedFiles, gitChangeCount, canGitCommit,
  clearGitDiffCache, evictOldestCacheEntry, gitStagingInProgress, gitLastStagingAt, gitStatusIcon, gitStatusColor,
  isGitLogEntryOpen, toggleGitLogEntry, gitHistoryDiffKey, gitWorkingTreeDiffKey,
  resetGitPanelState, refreshGitStatus, commitGit, stageFile, unstageFile,
  stageAll, unstageAll, discardFile, discardAll,
  stageSelectedFiles, unstageSelectedFiles, discardSelectedFiles, toggleGitFileSelection, clearGitSelection,
  generateCommitMessage, aiCommitAndPush, refreshGitRemotes,
  doFetch, doPull, doPush,
  refreshGitStashes, doStashSave, doStashApply, doStashDrop,
} = git;

// Session manager composable
const {
  sessionPickerOpen,
  activeSessionId,
  sessionList,
  activeSessionTitle,
  activeSessionIndex,
  canSwitchToNewerSession,
  canSwitchToOlderSession,
  sessionPickerTitle,
  sessionLocalFileName,
  formatSessionInfoForCopy,
  setActiveSession,
} = session;

// 切换会话时，恢复目标会话的发送状态到 chatSending
watch(activeSessionId, () => {
  syncActiveChatSending();
});

const chatSessionHooks: {
  onAfterSwitch?: () => void;
  scrollToBottom?: (force?: boolean) => void | Promise<void>;
} = {};

const chatSession = useChatSessionStore({
  projectPath: () => projectPath.value.trim(),
  chatMessages,
  chatError,
  chatSending: () => chatSending.value,
  session,
  normalizeMessages: normalizeChatMessages,
  confirm,
  onBeforeSessionSwitch: (fromSessionId, messages) => {
    sessionMessageCache.snapshot(fromSessionId, messages);
  },
  resolveSessionMessages: (sessionId, diskMessages) => {
    const cached = sessionMessageCache.get(sessionId);
    return cached?.length ? cached : normalizeChatMessages(diskMessages);
  },
  onAfterSwitch: () => chatSessionHooks.onAfterSwitch?.(),
  scrollToBottom: (force) => chatSessionHooks.scrollToBottom?.(force),
});

const {
  switchingSession,
  syncingChatStore,
  chatStoreSyncMessage,
  persistChatNow,
  schedulePersistChat,
  cancelPendingChatPersistence,
  flushChatStoreToDisk,
  startNewSession,
  switchSession,
  removeSession,
  syncChatStoreToDisk,
  loadProjectChatState,
  resetUiForProjectSwitch,
  clearProjectChat,
} = chatSession;

// File drag composable
const {
  isDragging,
  fileDragGhost,
  buildReferencedFile,
  canAcceptChatDrag,
  acceptChatFileDrag,
  attachFileToChat,
  startPathDrag,
  onChatDragEnter: onChatDragEnterBase,
  onChatDragOver: onChatDragOverBase,
  onChatDragLeave: onChatDragLeaveBase,
  onChatDrop: onChatDropBase,
  onWindowDragEnd,
  onDocumentDragOverCapture: onDocumentDragOverCaptureBase,
  onDocumentDropCapture: onDocumentDropCaptureBase,
} = fileDrag;

// Session convenience functions
function refreshSessionList(path?: string) {
  const p = path ?? projectPath.value.trim();
  const beforeIds = p ? sessionList.value.map((s) => s.id) : [];
  session.refreshSessionList(path);
  if (!p) return;
  const afterIds = sessionList.value.map((s) => s.id);
  const added = afterIds.filter((id) => !beforeIds.includes(id));
  if (added.length) {
    sessionDiag("ui:refresh-session-list:added", {
      projectPath: p,
      addedSessionIds: added,
      listSessionIds: afterIds,
      local: getSessionDiagSnapshot(p),
    });
  }
}

function toggleSessionPicker() {
  session.toggleSessionPicker();
}

function closeSessionPicker() {
  session.closeSessionPicker();
}

function switchToAdjacentSession(delta: number) {
  const nextId = session.switchToAdjacentSession(delta);
  if (nextId) switchSession(nextId);
}

function onChatDragEnter(e: DragEvent) {
  onChatDragEnterBase(e);
}
function onChatDragOver(e: DragEvent) {
  onChatDragOverBase(e);
}
function onChatDragLeave(e: DragEvent) {
  onChatDragLeaveBase(e, chatDropZoneRef.value);
}
function onChatDrop(e: DragEvent) {
  onChatDropBase(e, chatDropZoneRef.value);
}
function onDocumentDragOverCapture(e: DragEvent) {
  onDocumentDragOverCaptureBase(e, chatDropZoneRef.value);
}
function onDocumentDropCapture(e: DragEvent) {
  onDocumentDropCaptureBase(e, chatDropZoneRef.value);
}

// File watcher state
const fileWatcherActive = ref(false);
const fileWatcherConnected = ref(false);
const fileWatcherCleanup = ref<(() => void) | null>(null);
let gitRefreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleGitStatusRefreshFromWatcher() {
  if (gitRefreshDebounceTimer) clearTimeout(gitRefreshDebounceTimer);
  gitRefreshDebounceTimer = setTimeout(() => {
    gitRefreshDebounceTimer = null;
    refreshGitStatus({ showLoading: false });
  }, 300);
}

async function startFileWatcherForProject(projectPath: string) {
  try {
    const result = await startFileWatcher(projectPath);
    if (result.ok) {
      fileWatcherActive.value = true;
      fileWatcherCleanup.value = connectFileWatcherStream(
        (changes) => {
          const guard1 = gitStagingInProgress.value;
          const guard2 = Date.now() - gitLastStagingAt.value < 500;
          if (guard1 || guard2) {
            return;
          }
          const relevantChanges = changes.filter(
            (change) =>
              !change.path.includes(".git") &&
              !change.path.includes("node_modules")
          );
          if (relevantChanges.length > 0) {
            scheduleGitStatusRefreshFromWatcher();
          }
        },
        (error) => {
          console.error("File watcher stream error:", error);
        },
        (connected) => {
          fileWatcherConnected.value = connected;
        },
      );
    }
  } catch (e) {
    console.error("Failed to start file watcher:", e);
  }
}

async function stopFileWatcherForProject() {
  if (fileWatcherCleanup.value) {
    fileWatcherCleanup.value();
    fileWatcherCleanup.value = null;
  }
  try {
    await stopFileWatcher();
    fileWatcherActive.value = false;
  } catch (e) {
    console.error("Failed to stop file watcher:", e);
  }
}

const contextMenu = ref({ show: false, x: 0, y: 0, path: "" });
const gitFileContextMenu = ref({ show: false, x: 0, y: 0, path: "" });

const contextMenuTargetIsFile = computed(() => {
  const node = findNode(fileTree.value, contextMenu.value.path);
  return Boolean(node && !node.isDirectory);
});
const aiConfig = ref({ endpoint: "", apiKey: "", model: "", providerName: "" });

const configReady = computed(() => Boolean(aiConfig.value.endpoint.trim()) && Boolean(aiConfig.value.model.trim()));
const apiKeyReady = computed(() => Boolean(aiConfig.value.apiKey.trim()));
const modelNameForDisplay = computed(() => {
  const model = aiConfig.value.model.trim() || "（未设置）";
  const provider = aiConfig.value.providerName.trim();
  return provider ? `${provider} / ${model}` : model;
});
const aiConfigStatusText = computed(() => {
  if (!configReady.value) return "未配置模型";
  if (!apiKeyReady.value) return `${modelNameForDisplay.value}（未保存 API Key）`;
  return modelNameForDisplay.value;
});
const canSendChat = computed(
  () => !composerEmpty.value && configReady.value && projectOpened.value,
);

const chatPlaceholder = computed(() =>
  chatMode.value === "ask"
    ? "提问、解释代码"
    : chatMode.value === "plan"
    ? "描述需求 → AI 输出方案 → 确认后执行（可点「执行方案」或回复「执行方案」）"
    : "描述要改什么（Enter 发送，Shift+Enter 换行）",
);

const totalTokenUsage = computed(() => {
  let totalStreamChars = 0;
  let totalContextChars = 0;
  let hasTokenData = false;
  
  for (const msg of chatMessages.value) {
    if (msg.role === "assistant") {
      if (msg.streamChars && msg.streamChars > 0) {
        totalStreamChars += msg.streamChars;
        hasTokenData = true;
      }
      if (msg.contextChars && msg.contextChars > 0) {
        totalContextChars = Math.max(totalContextChars, msg.contextChars);
        hasTokenData = true;
      }
    }
  }
  
  if (!hasTokenData) return "";
  
  const parts: string[] = [];
  if (totalStreamChars > 0) {
    parts.push(`${formatCharCount(totalStreamChars)} 输出`);
  }
  if (totalContextChars > 0) {
    parts.push(`${formatCharCount(totalContextChars)} 上下文`);
  }
  return parts.join(" · ");
});

const showTokenDetail = ref(false);

const tokenDetailData = computed(() => {
  let totalStreamChars = 0;
  let maxContextChars = 0;
  let assistantCount = 0;
  
  for (const msg of chatMessages.value) {
    if (msg.role === "assistant") {
      assistantCount++;
      if (msg.streamChars && msg.streamChars > 0) {
        totalStreamChars += msg.streamChars;
      }
      if (msg.contextChars && msg.contextChars > 0) {
        maxContextChars = Math.max(maxContextChars, msg.contextChars);
      }
    }
  }
  
  if (assistantCount === 0) return null;
  
  return {
    assistantCount,
    totalStreamChars,
    maxContextChars,
    totalMessages: chatMessages.value.length,
  };
});

const recoverableAssistantMsg = computed(() => {
  if (chatSending.value) return null;
  for (let i = chatMessages.value.length - 1; i >= 0; i -= 1) {
    const m = chatMessages.value[i]!;
    if (m.role === "assistant" && canResumeAgentRun(m)) return m;
  }
  return null;
});

const activeAssistantMsgId = computed(() => {
  for (let i = chatMessages.value.length - 1; i >= 0; i -= 1) {
    const m = chatMessages.value[i];
    if (m.role === "assistant") return m.id;
  }
  return "";
});

const {
  filePanelWidth,
  chatPanelWidth,
  editorCollapsed,
  chatPanelStyle,
  startResize,
  stopResize,
  collapseEditor,
  expandEditor,
  getChatPanelMaxWidth,
} = usePanelLayout(workspaceRef);

function reloadAiConfig() {
  const cfg = loadAiChatBaseFromStorage();
  if (cfg) {
    aiConfig.value = {
      endpoint: cfg.endpoint,
      apiKey: cfg.apiKey,
      model: cfg.model,
      providerName: cfg.providerName || "",
    };
    return;
  }
  aiConfig.value = { endpoint: "", apiKey: "", model: "", providerName: "" };
}

function loadSavedProject() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    projectPath.value = saved;
    void openProjectByPath(saved);
  }
}

function isChatNearBottom(): boolean {
  const el = chatPanelRef.value?.chatScrollRef;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= CHAT_SCROLL_PIN_THRESHOLD;
}

function onChatScroll() {
  chatPinnedToBottom = isChatNearBottom();
  // 滚动时隐藏引用按钮，避免 fixed 定位与选区脱节
  if (showQuoteButton.value) hideQuoteButtonNow();
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
    const el = chatPanelRef.value?.chatScrollRef;
    if (el) el.scrollTop = el.scrollHeight;
    scrollChatRaf = 0;
  });
}

const {
  fileTree, expandedDirs, openTabs, activeFilePath, selectedTreePath,
  fileContent, fileDirty, fileLoadError, fileDiffs, readOnlyFileKeys,
  showDiffMode, selectedCode, renamingPath, activeFileDiff, activeFileReadOnly,
  refreshTree, openFile, saveFile, reloadFile, closeTab, switchTab,
  switchReadOnlyTab, createNewFile, createNewFolder, commitRename, cancelRename,
  deleteSelectedItem, showGitFileDiff, openGitLogFile, openDiffPreview,
  toggleDiffMode, toggleDir, findNode, findNodeByKey, normalizePathKey,
  joinProjectPath, resolveFullPathFromRel, storeFileDiff, getFileDiff, setFileDiff,
  findOpenTab, syncActiveTabToCache, ensureCanLeaveCurrentTab, ensureCanLeaveAllOpenTabs,
  syncEditorPanelForOpenFiles, parentDirForCreate, selectTreeItem,
  onEditorChange, onEditorSelect,   askAiWithCode, activeFileRelativePath,
  syncEditorAfterAgentFileChange,
} = useEditorPanel({
  projectPath,
  projectOpened,
  aiConfig,
  configReady,
  confirm,
  inputPrompt,
  composerRef,
  gitError,
  gitDiffContentCache,
  gitDiffLoadingKey,
  evictOldestCacheEntry,
  gitHistoryDiffKey,
  gitWorkingTreeDiffKey,
  treeError,
  collapseEditor,
  expandEditor,
  autoRetryWithCountdown,
});

async function applyChatMessageImageHydration(messages: PersistedChatMessage[]): Promise<ChatMessage[]> {
  const project = projectPath.value.trim();
  if (!project || !chatMessagesNeedImageHydration(messages)) {
    return normalizeChatMessages(messages);
  }
  const hydrated = await hydrateChatMessagesImages(project, messages);
  return normalizeChatMessages(hydrated);
}

function refreshProjectHistoryList() {
  projectHistoryList.value = listProjectHistory();
}

function isCurrentProject(path: string): boolean {
  const current = projectPath.value.trim();
  if (!current || !path.trim()) return false;
  const norm = (p: string) => p.trim().replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
  return norm(current) === norm(path);
}

function toggleProjectHistory() {
  projectHistoryOpen.value = !projectHistoryOpen.value;
  if (projectHistoryOpen.value) refreshProjectHistoryList();
}

function closeProjectHistory() {
  projectHistoryOpen.value = false;
}

function openRecentProject(path: string) {
  closeProjectHistory();
  void openProjectByPath(path);
}

function removeRecentProject(path: string, event?: MouseEvent) {
  event?.stopPropagation();
  removeProjectFromHistory(path);
  refreshProjectHistoryList();
}

function clearRecentProjects() {
  clearProjectHistory();
  refreshProjectHistoryList();
}

function onDocumentClick(event: MouseEvent) {
  const target = event.target as Element;
  if (projectHistoryOpen.value) {
    const el = projectHistoryRef.value;
    if (el && !el.contains(target)) closeProjectHistory();
  }
  if (sessionPickerOpen.value) {
    const el = chatPanelRef.value?.sessionPickerRef ?? sessionPickerRef.value;
    if (el && !el.contains(target)) closeSessionPicker();
  }
  if (showQuoteButton.value) {
    if (eventComposedPathIncludes(event, ".quote-floating")) return;
    hideQuoteButtonNow();
  }
}

function eventComposedPathIncludes(event: MouseEvent, selector: string): boolean {
  return event.composedPath().some(
    (node) => node instanceof Element && Boolean(node.closest(selector)),
  );
}

function clampQuoteButtonPosition(x: number, y: number, btnWidth: number, btnHeight: number) {
  const margin = 8;
  return {
    x: Math.max(margin, Math.min(x, window.innerWidth - btnWidth - margin)),
    y: Math.max(margin, Math.min(y, window.innerHeight - btnHeight - margin)),
  };
}

/** 选区包围盒在多行时会横跨整行宽度；优先用最后一行的 client rect 锚定按钮。 */
function selectionRectUsable(rect: DOMRect): boolean {
  return rect.width > 0 || rect.height > 0;
}

/** 判断 rect 是否包含指定点（视口坐标） */
function rectContainsPoint(rect: DOMRect, px: number, py: number): boolean {
  return px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom;
}

function getSelectionFocusRect(selection: Selection): DOMRect | null {
  const { focusNode, focusOffset } = selection;
  if (!focusNode) return null;

  const focusRange = document.createRange();
  try {
    focusRange.setStart(focusNode, focusOffset);
    focusRange.collapse(true);
  } catch {
    return null;
  }

  const focusRects = focusRange.getClientRects();
  for (let i = focusRects.length - 1; i >= 0; i--) {
    const rect = focusRects[i];
    if (rect.width > 0 || rect.height > 0) return rect;
  }

  const collapsed = focusRange.getBoundingClientRect();
  if (collapsed.width > 0 || collapsed.height > 0) return collapsed;

  const endRange = selection.getRangeAt(0).cloneRange();
  endRange.collapse(false);
  const endRects = endRange.getClientRects();
  if (endRects.length > 0) return endRects[endRects.length - 1];
  return endRange.getBoundingClientRect();
}

function getSelectionAnchorRect(selection: Selection): DOMRect | null {
  const range = selection.getRangeAt(0);
  const lineRects = Array.from(range.getClientRects()).filter(selectionRectUsable);
  if (lineRects.length > 0) {
    // 优先取第一行 rect，使引用按钮始终在选区顶部附近，
    // 避免多行选区时按钮出现在最后一行导致与选区视觉分离
    return lineRects[0]!;
  }

  const focusRect = getSelectionFocusRect(selection);
  if (focusRect && selectionRectUsable(focusRect)) return focusRect;

  const bounds = range.getBoundingClientRect();
  if (selectionRectUsable(bounds)) return bounds;
  return null;
}

async function showQuoteButtonAt(anchor: DOMRect) {
  const margin = 8;
  const bottomSafe = 80; // 底部输入面板安全距离
  const estimatedWidth = 72;
  const estimatedHeight = 32;
  const maxBottom = window.innerHeight - bottomSafe;

  let x = anchor.left + (anchor.width - estimatedWidth) / 2;
  let y = anchor.top - estimatedHeight - margin;
  // 上方空间不足时回退到下方，但不能超出底部安全区
  if (y < margin) y = anchor.bottom + margin;
  if (y + estimatedHeight > maxBottom) y = maxBottom - estimatedHeight;
  if (y < margin) y = margin;
  ({ x, y } = clampQuoteButtonPosition(x, y, estimatedWidth, estimatedHeight));
  quoteButtonPosition.value = { x, y };
  showQuoteButton.value = true;
  await nextTick();
  const btn = quoteButtonRef.value;
  if (!btn) return;
  const btnWidth = btn.offsetWidth;
  const btnHeight = btn.offsetHeight;
  x = anchor.left + (anchor.width - btnWidth) / 2;
  y = anchor.top - btnHeight - margin;
  if (y < margin) y = anchor.bottom + margin;
  if (y + btnHeight > maxBottom) y = maxBottom - btnHeight;
  if (y < margin) y = margin;
  ({ x, y } = clampQuoteButtonPosition(x, y, btnWidth, btnHeight));
  quoteButtonPosition.value = { x, y };
}

function quoteMessageKey(message: QuotedMessage): string {
  return `${message.messageId}:${message.content}`;
}

let quoteHiddenAt = 0;
function hideQuoteButtonNow() {
  showQuoteButton.value = false;
  pendingQuote.value = null;
  quoteHiddenAt = Date.now();
}

registerEscapeDismiss(() => contextMenu.value.show, hideContextMenu, ESCAPE_DISMISS_PRIORITY.CONTEXT_MENU);
registerEscapeDismiss(
  () => gitFileContextMenu.value.show,
  hideGitFileContextMenu,
  ESCAPE_DISMISS_PRIORITY.CONTEXT_MENU,
);
registerEscapeDismiss(projectMemoryOpen, closeProjectMemoryEditor, ESCAPE_DISMISS_PRIORITY.PROJECT_MEMORY);
registerEscapeDismiss(sessionPickerOpen, closeSessionPicker, ESCAPE_DISMISS_PRIORITY.SESSION_PICKER);
registerEscapeDismiss(
  mentionOpen,
  () => {
    mentionOpen.value = false;
  },
  ESCAPE_DISMISS_PRIORITY.MENTION,
);
registerEscapeDismiss(
  showTokenDetail,
  () => {
    showTokenDetail.value = false;
  },
  ESCAPE_DISMISS_PRIORITY.TOKEN_DETAIL,
);
registerEscapeDismiss(projectHistoryOpen, closeProjectHistory, ESCAPE_DISMISS_PRIORITY.PROJECT_HISTORY);
registerEscapeDismiss(showQuoteButton, hideQuoteButtonNow, ESCAPE_DISMISS_PRIORITY.QUOTE_BUTTON);
// 滚动时隐藏引用按钮，避免 fixed 定位与选区脱节
onMounted(() => {
  nextTick(() => {
    const scrollHost = chatPanelRef.value?.chatScrollRef;
    if (scrollHost) {
      scrollHost.addEventListener('scroll', () => {
        if (showQuoteButton.value) hideQuoteButtonNow();
      }, { passive: true });
    }
  });
});
registerEscapeDismiss(
  () => quotedMessages.value.length > 0,
  () => {
    quotedMessages.value = [];
  },
  ESCAPE_DISMISS_PRIORITY.QUOTED_PREVIEW,
);

function handleStartNewSession() {
  startNewSession();
  void nextTick(() => composerRef.value?.focus());
}

async function copyText(text: string): Promise<boolean> {
  const value = String(text ?? "");
  if (!value) { debugLog("copyText: empty value"); return false; }
  try {
    await navigator.clipboard.writeText(value);
    debugLog("copyText: clipboard.writeText OK");
    return true;
  } catch (e) {
    debugLog(`copyText: clipboard.writeText failed: ${e}`);
  }
  // Fallback: textarea + execCommand
  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    debugLog(`copyText: execCommand result=${ok}`);
    return ok;
  } catch (e) {
    debugLog(`copyText: execCommand failed: ${e}`);
    return false;
  }
}

let sessionCopyHintTimer: ReturnType<typeof setTimeout> | null = null;

async function copySessionInfo(session: VibeChatSessionMeta) {
  const project = projectPath.value.trim();
  debugLog(`copySessionInfo: project="${project}", sessionId="${session.id}"`);
  if (!project) {
    chatStoreSyncMessage.value = "请先打开项目";
    setTimeout(() => { chatStoreSyncMessage.value = ""; }, 2000);
    return;
  }
  const text = formatSessionInfoForCopy(session, project);
  debugLog(`copySessionInfo: text length=${text.length}`);
  if (!text) {
    chatStoreSyncMessage.value = "生成复制内容失败";
    setTimeout(() => { chatStoreSyncMessage.value = ""; }, 2000);
    return;
  }
  const ok = await copyText(text);
  debugLog(`copySessionInfo: copyText result=${ok}`);
  if (sessionCopyHintTimer) clearTimeout(sessionCopyHintTimer);
  chatStoreSyncMessage.value = ok
    ? `已复制「${session.title}」的会话信息`
    : "复制失败，请手动选择复制";
  sessionCopyHintTimer = setTimeout(() => {
    sessionCopyHintTimer = null;
    if (chatStoreSyncMessage.value.startsWith("已复制") || chatStoreSyncMessage.value === "复制失败，请手动选择复制") {
      chatStoreSyncMessage.value = "";
    }
  }, 3000);
}

function patchAssistantMsg(msgId: string, patch: Partial<ChatMessage>) {
  const apply = (list: ChatMessage[]) => {
    const idx = list.findIndex((m) => m.id === msgId);
    if (idx < 0) return false;
    list[idx] = { ...list[idx], ...patch };
    return true;
  };
  const patched = apply(chatMessages.value);
  const runSid = agentRunSessionId;
  if (runSid) {
    if (patched) sessionMessageCache.snapshot(runSid, chatMessages.value);
    else sessionMessageCache.patchMessage(runSid, msgId, patch);
  }
}

async function handleAgentWrittenFiles(files: string[]) {
  if (!files.length) return;
  await refreshTree();

  const activeRel = activeFileRelativePath();
  let handled = false;

  for (const rel of files) {
    const normalized = rel.replace(/\\/g, "/").toLowerCase();
    if (activeRel && normalized === activeRel) {
      await reloadFile();
      fileDirty.value = false;
      if (getFileDiff(activeFilePath.value)) {
        showDiffMode.value = true;
      }
      handled = true;
      break;
    }
  }

  if (!handled) {
    const firstRel = files[0];
    const full = resolveFullPathFromRel(firstRel);
    if (getFileDiff(full)) {
      await openFile(full);
      showDiffMode.value = true;
    }
  }
}

function clearTurnFileDiffsFromStore(turnFileDiffs: Record<string, FileDiff>) {
  const next = { ...fileDiffs.value };
  for (const relPath of Object.keys(turnFileDiffs)) {
    const fullPath = resolveFullPathFromRel(relPath);
    delete next[normalizePathKey(fullPath)];
  }
  fileDiffs.value = next;
}

function userMessageImages(msg: ChatMessage): string[] {
  return resolveChatMessageImageUrls(
    projectPath.value.trim(),
    msg,
    activeSessionId.value || undefined,
  );
}

function resolveAssistantOrchestrationContent(msg: ChatMessage): string {
  return finalizeAssistantBubbleContent(msg);
}

function findLastAssistantContent(): string | undefined {
  return findLastAssistantContentInMessages(chatMessages.value, resolveAssistantOrchestrationContent);
}

function buildAgentHistory(
  currentPrompt: string,
  profile: ReturnType<typeof resolveAgentRunProfile>,
): VibeChatHistoryMessage[] {
  const base = buildAgentHistoryFromMessages(chatMessages.value);
  return shapeAgentHistoryForProfile(base, profile, currentPrompt);
}

function buildAgentHistoryForResume(assistantMsgId: string): VibeChatHistoryMessage[] {
  const idx = chatMessages.value.findIndex((m) => m.id === assistantMsgId);
  if (idx < 0) return buildAgentHistoryFromMessages(chatMessages.value);
  return buildAgentHistoryFromMessages(chatMessages.value.slice(0, idx + 1));
}

function resolveOriginalUserPrompt(assistantMsgId: string): string {
  const assistantIdx = chatMessages.value.findIndex((m) => m.id === assistantMsgId);
  if (assistantIdx <= 0) return "";
  for (let i = assistantIdx - 1; i >= 0; i -= 1) {
    const msg = chatMessages.value[i];
    if (msg.role === "user") return stripReferenceAttachments(msg.content);
  }
  return "";
}

function findLastUserMessage(): { content: string } | null {
  for (let i = chatMessages.value.length - 1; i >= 0; i -= 1) {
    const m = chatMessages.value[i];
    if (m.role === "user") return { content: m.content };
  }
  return null;
}

const agent = useAgentRun({
  chatMessages,
  chatSending,
  chatMode,
  chatError,
  projectPath,
  projectOpened,
  configReady,
  aiConfig,
  activeAssistantMsgId,
  activeSessionId,
  activeFilePath,
  pendingPromptQueue,
  patchAssistantMsg,
  schedulePersistChat,
  persistChatNow,
  persistPendingQueue,
  scrollChatToBottom,
  resetChatScrollPin,
  isChatPinnedToBottom: isChatNearBottom,
  reloadAiConfig,
  handleAgentWrittenFiles,
  clearTurnFileDiffsFromStore,
  storeFileDiff,
  syncEditorAfterAgentFileChange,
  resolveUserMessageImages: userMessageImages,
  buildAgentHistory,
  buildAgentHistoryForResume,
  resolveOriginalUserPrompt,
  findLastUserMessage,
  beginAgentRunSession,
  endAgentRunSession,
  getAgentRunSessionId,
  persistAgentRunSession,
});

const {
  agentUiTick,
  chainJumpVisible,
  stalledAssistantMsg,
  autoResumeSecondsLeft,
  autoResumeTargetId,
  runAgentTurn,
  resumeAgentRun,
  stopAgent,
  interruptAgentRun,
  cancelAutoResume,
  isAgentRunning,
  isAssistantStalled,
  hasAgentActivity,
  messageDisplayContent,
  agentAbortDisplayReason,
  agentStatusDisplay,
  buildAgentRunningStatusTextForMsg,
  jumpChainToLatest,
  forceRecoverStalledRun,
  shouldShowMessageBubble,
  canExecutePlanMessage,
  executePlanFromMessage,
  planExecutionActive,
  scheduleStreamScroll,
  clearStreamDeltaBuffer,
  tryResumeHmrInterruptedRun,
  getAgentAbortHandle,
  maybeAutoResumeLastRecoverableAssistant,
  stopAgentUiTick,
} = agent;

chatSessionHooks.scrollToBottom = scrollChatToBottom;
chatSessionHooks.onAfterSwitch = maybeAutoResumeLastRecoverableAssistant;

const agentRunningStatusText = computed(() => {
  if (!chatSending.value) return "";
  for (let i = chatMessages.value.length - 1; i >= 0; i -= 1) {
    const m = chatMessages.value[i];
    if (m?.role === "assistant") return buildAgentRunningStatusTextForMsg(m);
  }
  return "Agent 运行中…";
});

function findLastCompletedAssistantMessage(): ChatMessage | undefined {
  for (let i = chatMessages.value.length - 1; i >= 0; i -= 1) {
    const msg = chatMessages.value[i];
    if (msg?.role === "assistant" && !isAgentRunning(msg)) return msg;
  }
  return undefined;
}

const activeAgentSuggestions = computed<AgentSuggestion[]>(() => {
  if (chatSending.value || !composerEmpty.value) return [];
  const msg = findLastCompletedAssistantMessage();
  if (!msg || dismissedSuggestionMsgId.value === msg.id) return [];
  if (msg.agentSuggestions?.length) return msg.agentSuggestions;
  return parseAgentSuggestions(msg.content || "").suggestions;
});

function dismissAgentSuggestions() {
  const msg = findLastCompletedAssistantMessage();
  if (msg) dismissedSuggestionMsgId.value = msg.id;
}

watch(activeSessionId, () => {
  dismissedSuggestionMsgId.value = null;
});

watch(composerEmpty, (empty) => {
  if (!empty) dismissAgentSuggestions();
});

const expandedDiffs = reactive<Record<string, Record<string, boolean>>>({});

function toggleExpandedDiff(messageId: string, relPath: string) {
  if (!expandedDiffs[messageId]) expandedDiffs[messageId] = {};
  expandedDiffs[messageId][relPath] = !expandedDiffs[messageId][relPath];
}

function isDiffExpanded(messageId: string, relPath: string): boolean {
  return Boolean(expandedDiffs[messageId]?.[relPath]);
}

function clearPendingPromptQueue() {
  pendingPromptQueue.value = [];
  persistPendingQueue();
}

async function clearChat() {
  if (chatSending.value) return;
  if (chatMessages.value.length > 0) {
    const ok = await confirm("确定清空所有聊天记录？");
    if (!ok) return;
  }
  pendingPromptQueue.value = [];
  persistPendingQueue();
  clearProjectChat();
}

async function loadDirChildren(dirPath: string): Promise<TreeNode[]> {
  const result = await listDirectory(dirPath);
  if (!result.ok) throw new Error(result.error || "读取目录失败");
  return result.items.map(entryToNode);
}

async function openProjectByPath(dirPath: string) {
  const normalized = dirPath.trim();
  if (!normalized) {
    treeError.value = "请输入项目路径";
    return;
  }

  const normalizeProjectPath = (p: string) =>
    p.trim().replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();

  const previousPath = projectPath.value.trim();
  if (
    projectOpened.value &&
    previousPath &&
    normalizeProjectPath(previousPath) === normalizeProjectPath(normalized)
  ) {
    return;
  }

  if (!(await ensureCanLeaveAllOpenTabs())) return;

  const t0 = performance.now();
  const timings: string[] = [];
  const log = (label: string) => {
    const ms = Math.round(performance.now() - t0);
    timings.push(`${label}: ${ms}ms`);
  };

  const flushLog = (result: string) => {
    const line = `[${new Date().toISOString()}] ${normalized} | ${result}`;
    fetch("/backend/vibe/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "tab-perf.log", line }),
    }).catch(() => {});
  };

  const previousPathForPersist = projectPath.value.trim();
  if (projectOpened.value && previousPathForPersist) {
    pendingPromptQueue.value = [];
    persistPendingQueue();
    cancelPendingChatPersistence();
    for (const sid of [...sendingSessionIds]) {
      const cached = sessionMessageCache.get(sid);
      if (cached?.length) {
        saveVibeChatHistory(previousPathForPersist, cached, sid, { touchTimestamp: false });
      }
    }
    persistChatNow(previousPathForPersist, { flushStore: true });
  }
  if (sendingSessionIds.size) interruptAgentRun();
  sessionMessageCache.clearAll();
  sendingSessionIds.clear();
  agentRunSessionId = "";
  chatSending.value = false;
  log("persist-prev");

  loadingTree.value = true;
  treeError.value = "";
  searchQuery.value = "";
  searchResults.value = [];
  contentSearchResults.value = [];
  openTabs.value = [];
  activeFilePath.value = "";
  fileContent.value = "";
  fileDirty.value = false;
  fileLoadError.value = "";
  showDiffMode.value = false;
  resetGitPanelState();
  resetUiForProjectSwitch();
  log("reset-state");

  try {
    // 串行执行，避免浏览器连接池阻塞
    const tDir0 = performance.now();
    log("dir-start");
    const items = await autoRetryWithCountdown(
      () => loadDirChildren(normalized),
      {
        onRetry: (remaining, attempt, max) => {
          treeError.value = `打开项目失败，正在重试… ${remaining}s (${attempt}/${max})`;
        },
      },
    );
    log(`dir-done(${items.length}items, ${Math.round(performance.now() - tDir0)}ms)`);
    const dirs = items.filter(i => i.isDirectory).length;
    const files = items.filter(i => !i.isDirectory).length;
    log(`dir-stats(${dirs}dirs, ${files}files)`);

    const tChat0 = performance.now();
    log(`chat-check`);

    treeError.value = "";
    fileTree.value = items;
    expandedDirs.value = new Set([normalized]);
    projectOpened.value = true;
    projectPath.value = normalized;
    selectedTreePath.value = normalized;
    localStorage.setItem(STORAGE_KEY, normalized);
    addProjectToHistory(normalized);
    refreshProjectHistoryList();
    log("set-state");

    switchingProject.value = true;
    try {
      const chatState = await loadProjectChatState(normalized);
      setActiveSession(chatState.activeSessionId);
      chatMessages.value = normalizeChatMessages(chatState.messages);
      refreshSessionList(normalized);
      log(`chat-active(${chatState.activeSessionId}, ${chatState.messages.length}msgs)`);
    } finally {
      switchingProject.value = false;
    }

    loadingTree.value = false;
    void refreshGitStatus();
    log(`chat-done(${Math.round(performance.now() - tChat0)}ms)`);

    void startFileWatcherForProject(normalized).catch(() => {});

    syncEditorPanelForOpenFiles();
    maybeAutoResumeLastRecoverableAssistant();
    await scrollChatToBottom(true);
    log("final");

    flushLog(`total=${Math.round(performance.now() - t0)}ms | ${timings.join(" → ")}`);
  } catch (e) {
    projectOpened.value = false;
    fileTree.value = [];
    treeError.value = formatFetchError(e, "打开项目失败（已重试）");
    flushLog(`FAILED total=${Math.round(performance.now() - t0)}ms | ${timings.join(" → ")}`);
  } finally {
    loadingTree.value = false;
    switchingProject.value = false;
  }
}

async function handleOpenProject() {
  if (openingProject.value) return;
  openingProject.value = true;
  pickingFolder.value = true;
  treeError.value = "";

  try {
    const picked = await pickProjectFolder(projectPath.value.trim());
    if (picked.cancelled) return;
    if (!picked.ok || !picked.path) {
      treeError.value = picked.error || "未选择文件夹";
      return;
    }
    await openProjectByPath(picked.path);
  } finally {
    pickingFolder.value = false;
    openingProject.value = false;
  }
}

function openProjectByInput() {
  void openProjectByPath(projectPath.value);
}

async function renameSelectedItem() {
  const from = selectedTreePath.value;
  if (!from) return;
  renamingPath.value = from;
}

function showContextMenu(path: string, x: number, y: number) {
  selectedTreePath.value = path;
  const menuW = 180;
  const menuH = 160;
  const clampedX = Math.min(x, window.innerWidth - menuW);
  const clampedY = Math.min(y, window.innerHeight - menuH);
  contextMenu.value = { show: true, x: Math.max(0, clampedX), y: Math.max(0, clampedY), path };
}

function hideContextMenu() {
  contextMenu.value.show = false;
}

function contextMenuCreateFile() {
  const dir = contextMenu.value.path;
  const node = findNode(fileTree.value, dir);
  const parent = node?.isDirectory ? dir : dir.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
  selectedTreePath.value = parent;
  hideContextMenu();
  void createNewFile();
}

function contextMenuCreateFolder() {
  const dir = contextMenu.value.path;
  const node = findNode(fileTree.value, dir);
  const parent = node?.isDirectory ? dir : dir.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
  selectedTreePath.value = parent;
  hideContextMenu();
  void createNewFolder();
}

function contextMenuAttachToChat() {
  const path = contextMenu.value.path;
  const node = findNode(fileTree.value, path);
  hideContextMenu();
  if (!path || node?.isDirectory) return;
  attachFileToChat(path, node?.name);
}

function contextMenuRename() {
  selectedTreePath.value = contextMenu.value.path;
  renamingPath.value = contextMenu.value.path;
  hideContextMenu();
}

function contextMenuDelete() {
  selectedTreePath.value = contextMenu.value.path;
  hideContextMenu();
  void deleteSelectedItem();
}

async function handleSearch() {
  const q = searchQuery.value.trim();
  if (!q || !projectPath.value.trim()) {
    searchResults.value = [];
    contentSearchResults.value = [];
    searchError.value = "";
    searchLoading.value = false;
    return;
  }

  searchLoading.value = true;
  searchError.value = "";

  try {
    if (searchMode.value === "content") {
      const result = await grepContent(projectPath.value.trim(), q);
      contentSearchResults.value = result.ok ? result.results : [];
      searchResults.value = [];
      if (!result.ok && result.error) searchError.value = result.error;
      return;
    }

    const result = await searchFiles(projectPath.value.trim(), q);
    searchResults.value = result.ok ? result.results : [];
    contentSearchResults.value = [];
    if (!result.ok && result.error) searchError.value = result.error;
  } finally {
    searchLoading.value = false;
  }
}

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

watch(searchQuery, (val) => {
  if (!val.trim()) {
    searchResults.value = [];
    contentSearchResults.value = [];
    searchError.value = "";
    searchLoading.value = false;
    return;
  }
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    void handleSearch();
  }, 300);
});

watch(searchMode, () => {
  if (searchQuery.value.trim()) void handleSearch();
});

function shouldIgnoreQuoteSelectEvent(event: MouseEvent): boolean {
  if (event.detail <= 1 && Date.now() - quoteHiddenAt < 150) return true;
  const target = event.target;
  return target instanceof Element
    && Boolean(target.closest(".msg-toolbar, .agent-recovery-actions, .agent-recovery-footer, .inline-diff-head, .msg-actions, .ai-option-buttons"));
}

function tryShowQuoteButtonFromSelection(message: ChatMessage): void {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) {
    return;
  }

  const selectedText = selection.toString().trim();
  if (!selectedText) return;

  const anchor = getSelectionAnchorRect(selection);
  if (!anchor || !selectionRectUsable(anchor)) return;

  pendingQuote.value = {
    messageId: message.id,
    content: selectedText,
    role: message.role,
  };

  void showQuoteButtonAt(anchor);
}

function onMessageSelect(event: MouseEvent, message: ChatMessage) {
  if (shouldIgnoreQuoteSelectEvent(event)) return;
  // 双击/三击时选区在 mouseup 时尚未就绪，推迟到 microtask（dblclick 也会再触发一次）
  if (event.detail >= 2) {
    queueMicrotask(() => tryShowQuoteButtonFromSelection(message));
    return;
  }
  tryShowQuoteButtonFromSelection(message);
}

function onMessageDoubleClick(event: MouseEvent, message: ChatMessage) {
  if (shouldIgnoreQuoteSelectEvent(event)) return;
  tryShowQuoteButtonFromSelection(message);
}

function quoteSelectedText() {
  if (!pendingQuote.value) return;

  const next = pendingQuote.value;
  const key = quoteMessageKey(next);
  if (!quotedMessages.value.some((item) => quoteMessageKey(item) === key)) {
    quotedMessages.value = [...quotedMessages.value, next];
  }
  pendingQuote.value = null;
  showQuoteButton.value = false;

  const selection = window.getSelection();
  if (selection) {
    selection.removeAllRanges();
  }

  nextTick(() => {
    composerRef.value?.focus();
  });
}

let selectionChangeTimer: ReturnType<typeof setTimeout> | null = null;
function onSelectionChange() {
  if (!showQuoteButton.value) return;
  if (selectionChangeTimer) clearTimeout(selectionChangeTimer);
  selectionChangeTimer = setTimeout(() => {
    selectionChangeTimer = null;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      hideQuoteButtonNow();
    }
  }, 120);
}

function applyExample(text: string) {
  composerRef.value?.setPlainText(text);
}

function collectProjectFiles(nodes: TreeNode[], base = projectPath.value): ProjectFileItem[] {
  const items: ProjectFileItem[] = [];
  const root = base.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();

  function walk(list: TreeNode[]) {
    for (const node of list) {
      if (node.isDirectory) {
        if (node.children?.length) walk(node.children);
        continue;
      }
      const full = node.path.replace(/\\/g, "/");
      const relative = full.toLowerCase().startsWith(`${root}/`)
        ? full.slice(root.length + 1)
        : fileName(full);
      items.push({ name: node.name, path: node.path, relative });
    }
  }

  walk(nodes);
  return items;
}

const allProjectFiles = computed(() => collectProjectFiles(fileTree.value));

const mentionResults = computed(() => {
  if (!mentionOpen.value || !projectOpened.value) return [];
  const q = mentionQuery.value.trim().toLowerCase();
  if (q && mentionRemoteResults.value.length) {
    return mentionRemoteResults.value.slice(0, 12);
  }
  return allProjectFiles.value
    .filter((item) => {
      if (!q) return true;
      return item.relative.toLowerCase().includes(q) || item.name.toLowerCase().includes(q);
    })
    .slice(0, 12);
});

async function refreshMentionRemoteResults(query: string) {
  if (!projectPath.value.trim()) {
    mentionRemoteResults.value = [];
    return;
  }
  const result = await searchFiles(projectPath.value.trim(), query);
  if (!result.ok) {
    mentionRemoteResults.value = [];
    return;
  }
  const root = projectPath.value.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
  mentionRemoteResults.value = result.results
    .filter((item) => !item.isDirectory)
    .map((item) => {
      const full = item.path.replace(/\\/g, "/");
      const relative = full.toLowerCase().startsWith(`${root}/`)
        ? full.slice(root.length + 1)
        : item.name;
      return { name: item.name, path: item.path, relative };
    });
}

function scheduleMentionSearch() {
  if (mentionSearchTimer) clearTimeout(mentionSearchTimer);
  const q = mentionQuery.value.trim();
  if (!q) {
    mentionRemoteResults.value = [];
    return;
  }
  mentionSearchTimer = setTimeout(() => {
    mentionSearchTimer = null;
    void refreshMentionRemoteResults(q);
  }, 200);
}

function onComposerMentionChange(payload: { open: boolean; query: string }) {
  mentionOpen.value = payload.open;
  mentionQuery.value = payload.query;
  if (payload.open) {
    mentionActiveIndex.value = 0;
    scheduleMentionSearch();
    return;
  }
  mentionRemoteResults.value = [];
}

function onComposerFieldKeydown(e: KeyboardEvent) {
  if (!mentionOpen.value || !mentionResults.value.length) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    mentionActiveIndex.value = (mentionActiveIndex.value + 1) % mentionResults.value.length;
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    mentionActiveIndex.value =
      (mentionActiveIndex.value - 1 + mentionResults.value.length) % mentionResults.value.length;
    return;
  }
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    const item = mentionResults.value[mentionActiveIndex.value];
    if (item) selectMention(item);
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    mentionOpen.value = false;
  }
}

function onSearchResultPointerDown(
  e: PointerEvent,
  item: { path: string; name: string; isDirectory: boolean },
) {
  if (item.isDirectory) return;
  startPathDrag(item.path, item.name, e, () => {
    void openFile(item.path);
  }, chatDropZoneRef.value);
}

function onGitFilePointerDown(e: PointerEvent, relativePath: string, staged = false) {
  const shiftKey = e.shiftKey;
  const ctrlKey = e.ctrlKey || e.metaKey;
  
  if (shiftKey || ctrlKey) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  toggleGitFileSelection(relativePath, shiftKey, ctrlKey);
  
  if (!shiftKey && !ctrlKey) {
    const fullPath = resolveFullPathFromRel(relativePath);
    startPathDrag(fullPath, fileName(relativePath), e, () => {
      void showGitFileDiff(relativePath, staged);
    }, chatDropZoneRef.value);
  }
}

function onGitFileContextMenu(e: MouseEvent, path: string) {
  const menuW = 160;
  const menuH = 40;
  const clampedX = Math.min(e.clientX, window.innerWidth - menuW);
  const clampedY = Math.min(e.clientY, window.innerHeight - menuH);
  gitFileContextMenu.value = { show: true, x: Math.max(0, clampedX), y: Math.max(0, clampedY), path };
}

function hideGitFileContextMenu() {
  gitFileContextMenu.value.show = false;
}

function gitFileCopyName() {
  const path = gitFileContextMenu.value.path;
  void copyText(fileName(path));
  hideGitFileContextMenu();
}

async function onSaveFile() {
  const ok = await saveFile();
  if (ok) {
    // Brief visual feedback - the dirty indicator already disappears
  }
}

function selectMention(item: ProjectFileItem) {
  composerRef.value?.insertFileRef({
    name: item.name,
    path: item.path,
    relative: item.relative,
  });
  mentionOpen.value = false;
  mentionQuery.value = "";
  void nextTick(() => composerRef.value?.focus());
}

function onFileDragStart(node: TreeNode, x: number, y: number) {
  fileDrag.onFileDragStart(node, x, y, chatDropZoneRef.value);
}
function onFileDragMove(x: number, y: number) {
  fileDrag.onFileDragMove(x, y, chatDropZoneRef.value);
}
function onFileDragEnd(node: TreeNode, x: number, y: number) {
  fileDrag.onFileDragEnd(node, x, y, chatDropZoneRef.value);
}

function removeOpenTabForPath(targetPath: string) {
  const tabIdx = openTabs.value.findIndex((tab) => tab.path === targetPath);
  if (tabIdx >= 0) openTabs.value.splice(tabIdx, 1);
  if (activeFilePath.value === targetPath) {
    const nextTab = openTabs.value[tabIdx] || openTabs.value[tabIdx - 1];
    if (nextTab) {
      activeFilePath.value = nextTab.path;
      fileContent.value = nextTab.content;
      fileDirty.value = nextTab.dirty;
    } else {
      activeFilePath.value = "";
      fileContent.value = "";
      fileDirty.value = false;
      syncEditorPanelForOpenFiles();
    }
    showDiffMode.value = false;
  }
  if (getFileDiff(targetPath)) {
    const next = { ...fileDiffs.value };
    delete next[normalizePathKey(targetPath)];
    fileDiffs.value = next;
  }
}

async function applyAgentTurnFiles(turnFileDiffs: Record<string, FileDiff>): Promise<string[]> {
  const applied: string[] = [];
  for (const [relPath, diff] of Object.entries(turnFileDiffs)) {
    const fullPath = resolveFullPathFromRel(relPath);
    if (diff.deleted) {
      const deleteResult = await deleteItem(fullPath, projectPath.value.trim());
      if (!deleteResult.ok && !isDeleteNotFoundError(deleteResult.error)) {
        throw new Error(deleteResult.error || `删除 ${relPath} 失败`);
      }
      removeOpenTabForPath(fullPath);
    } else {
      const existing = await readFile(fullPath, projectPath.value.trim());
      const writeResult = existing.ok
        ? await writeFile(fullPath, diff.after, projectPath.value.trim())
        : await createItem(fullPath, false, diff.after, projectPath.value.trim());
      if (!writeResult.ok) throw new Error(writeResult.error || `写入 ${relPath} 失败`);
    }
    applied.push(relPath);
  }
  return applied;
}

async function completeAgentTurnApplication(messageId: string) {
  const msg = chatMessages.value.find((m) => m.id === messageId);
  if (!msg?.turnFileDiffs) return;

  patchAssistantMsg(messageId, { applying: true, reverting: false });
  chatError.value = "";

  try {
    const applied = await applyAgentTurnFiles(msg.turnFileDiffs);
    clearTurnFileDiffsFromStore(msg.turnFileDiffs);
    patchAssistantMsg(messageId, {
      pendingApproval: false,
      applying: false,
      reverting: false,
      writtenFiles: applied,
    });
    persistChatNow();
    await refreshTree();
    await refreshGitStatus({ showLoading: false });
    const toPreview = applied.filter((rel) => !msg.turnFileDiffs?.[rel]?.deleted);
    void handleAgentWrittenFiles(toPreview);
  } catch (error) {
    patchAssistantMsg(messageId, { applying: false, reverting: false });
    chatError.value = error instanceof Error ? error.message : "应用修改失败";
  }
}

async function acceptAgentTurn(messageId: string) {
  if (chatSending.value || !projectOpened.value) return;
  const msg = chatMessages.value.find((m) => m.id === messageId);
  if (!msg?.pendingApproval || !msg.turnFileDiffs) return;
  await completeAgentTurnApplication(messageId);
}

async function rejectAgentTurn(messageId: string, event?: MouseEvent) {
  if (chatSending.value) return;
  const idx = chatMessages.value.findIndex((m) => m.id === messageId);
  if (idx < 0) return;

  const msg = chatMessages.value[idx];
  if (!msg.pendingApproval || !msg.turnFileDiffs) return;
  if (!await confirm("确定拒绝本轮所有暂存修改？", event)) return;

  clearTurnFileDiffsFromStore(msg.turnFileDiffs);
  msg.pendingApproval = false;
  msg.rejected = true;
  msg.writtenFiles = undefined;
  showDiffMode.value = false;
  patchAssistantMsg(messageId, {
    pendingApproval: false,
    rejected: true,
    writtenFiles: undefined,
  });
  persistChatNow();
}

function previewAgentFile(messageId: string, relPath: string) {
  const msg = chatMessages.value.find((m) => m.id === messageId);
  const diff = msg?.turnFileDiffs?.[relPath];
  if (!diff) return;
  const fullPath = resolveFullPathFromRel(relPath);
  setFileDiff(fullPath, diff);
  void openFile(fullPath);
  showDiffMode.value = true;
}

async function revertAgentTurn(messageId: string, event?: MouseEvent) {
  if (chatSending.value || !projectOpened.value) return;
  const idx = chatMessages.value.findIndex((m) => m.id === messageId);
  if (idx < 0) return;

  const msg = chatMessages.value[idx];
  if (!msg.turnFileDiffs || msg.reverted || msg.pendingApproval) return;

  const fileCount = Object.keys(msg.turnFileDiffs).length;
  if (!await confirm(`确定回滚本轮 Agent 对 ${fileCount} 个文件的修改？`, event)) return;

  patchAssistantMsg(messageId, { reverting: true });
  chatError.value = "";

  try {
    for (const [relPath, diff] of Object.entries(msg.turnFileDiffs)) {
      const fullPath = resolveFullPathFromRel(relPath);
      if (diff.deleted) {
        const result = await writeFile(fullPath, diff.before, projectPath.value.trim());
        if (!result.ok) throw new Error(result.error || `恢复 ${relPath} 失败`);
      } else if (diff.created) {
        const result = await deleteItem(fullPath, projectPath.value.trim());
        if (!result.ok) throw new Error(result.error || `删除 ${relPath} 失败`);
        removeOpenTabForPath(fullPath);
      } else {
        const result = await writeFile(fullPath, diff.before, projectPath.value.trim());
        if (!result.ok) throw new Error(result.error || `恢复 ${relPath} 失败`);
      }

      const key = normalizePathKey(fullPath);
      if (fileDiffs.value[key]) {
        const next = { ...fileDiffs.value };
        delete next[key];
        fileDiffs.value = next;
      }
      if (activeFilePath.value && normalizePathKey(activeFilePath.value) === key) {
        await openFile(fullPath);
        showDiffMode.value = false;
      }
    }

    patchAssistantMsg(messageId, { reverted: true, reverting: false });
    persistChatNow();
    await refreshTree();
    await refreshGitStatus({ showLoading: false });
  } catch (error) {
    patchAssistantMsg(messageId, { reverting: false });
    chatError.value = error instanceof Error ? error.message : "回滚失败";
  }
}

function findExchangeBounds(index: number): { start: number; end: number } {
  const msg = chatMessages.value[index];
  if (!msg) return { start: index, end: index };

  if (msg.role === "user") {
    let end = index;
    if (index + 1 < chatMessages.value.length && chatMessages.value[index + 1].role === "assistant") {
      end = index + 1;
    }
    return { start: index, end };
  }

  if (msg.role === "assistant") {
    let start = index;
    if (index > 0 && chatMessages.value[index - 1].role === "user") {
      start = index - 1;
    }
    return { start, end: index };
  }

  return { start: index, end: index };
}

function undoExchange(messageId: string, event?: MouseEvent) {
  if (chatSending.value) return;
  const idx = chatMessages.value.findIndex((m) => m.id === messageId);
  if (idx < 0) return;

  const { start, end } = findExchangeBounds(idx);
  const count = end - start + 1;
  void confirm(`确定要撤销这组对话吗？将删除其中 ${count} 条消息。`, event).then((ok) => {
    if (!ok) return;
    chatMessages.value.splice(start, count);
    chatError.value = "";
    persistChatNow();
    void scrollChatToBottom();
  });
}

async function editUserMessage(messageId: string) {
  if (chatSending.value) return;
  const userIdx = resolveUserMessageIndex(messageId);
  if (userIdx < 0) return;

  const userMsg = chatMessages.value[userIdx];
  const userText = stripReferenceAttachments(userMsg.content).trim();
  const project = projectPath.value.trim();
  const hydratedUrls = project ? await hydrateChatMessageImages(project, userMsg) : [];
  const images = userMsg.imageDataUrls?.filter(Boolean)?.length
    ? userMsg.imageDataUrls.filter(Boolean)
    : hydratedUrls;

  const { start, end } = findExchangeBounds(userIdx);
  chatMessages.value.splice(start, end - start + 1);

  composerRef.value?.setPlainText(userText);
  for (const url of images) {
    composerRef.value?.insertImage(url);
  }

  chatError.value = "";
  persistChatNow();
  void scrollChatToBottom();

  nextTick(() => composerRef.value?.focus());
}

function resolveUserMessageIndex(messageId: string): number {
  const idx = chatMessages.value.findIndex((m) => m.id === messageId);
  if (idx < 0) return -1;

  if (chatMessages.value[idx].role === "user") return idx;

  let userIdx = idx - 1;
  while (userIdx >= 0 && chatMessages.value[userIdx].role !== "user") {
    userIdx -= 1;
  }
  return userIdx;
}

async function resendFromMessage(messageId: string) {
  if (chatSending.value || !configReady.value || !projectOpened.value) return;

  const userIdx = resolveUserMessageIndex(messageId);
  if (userIdx < 0) return;

  const userMsg = chatMessages.value[userIdx];
  const userText = stripReferenceAttachments(userMsg.content).trim();
  const project = projectPath.value.trim();
  const hydratedUrls = await hydrateChatMessageImages(project, userMsg);
  const imageDataUrls = userMsg.imageDataUrls?.filter(Boolean)?.length
    ? userMsg.imageDataUrls.filter(Boolean)
    : hydratedUrls;
  if (!userText && !imageDataUrls.length) return;

  chatMessages.value = chatMessages.value.slice(0, userIdx);
  chatError.value = "";
  persistChatNow();
  await runAgentTurn(userText || "请结合附带的图片回答。", {
    userBubbleContent: userText,
    imageDataUrls: imageDataUrls?.length ? imageDataUrls : undefined,
  });
}

function buildReferencedFilePathsSection(refs: ReferencedFile[]): string {
  if (!refs.length) return "";
  const chunks: string[] = [];
  const seen = new Set<string>();
  for (const file of refs) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    chunks.push(`### 📄 ${file.relative}`);
  }
  return chunks.join("\n\n");
}

async function buildReferencedFileSection(refs: ReferencedFile[]): Promise<string> {
  if (!refs.length) return "";
  const chunks: string[] = [];
  const seen = new Set<string>();
  for (const file of refs) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    const result = await readFile(file.path);
    if (result.ok) {
      const content = truncatePromptAttachment(result.content);
      chunks.push(`### 📄 ${file.relative}\n\`\`\`\n${content}\n\`\`\``);
    } else {
      chunks.push(`### 📄 ${file.relative}\n> ⚠️ 读取失败：${result.error || "未知错误"}`);
    }
  }
  return chunks.join("\n\n");
}

function handleAgentSuggestion(suggestion: AgentSuggestion) {
  dismissAgentSuggestions();
  const sourceMsg = findLastCompletedAssistantMessage();

  if (suggestion.action === "execute_plan" && sourceMsg && canExecutePlanMessage(sourceMsg)) {
    void executePlanFromMessage(sourceMsg.id);
    return;
  }

  const userText = suggestion.text?.trim() || suggestion.label;
  const runOptions =
    suggestion.action === "implement" && sourceMsg
      ? {
          userBubbleContent: suggestion.label,
          planAssistantContent: messageDisplayContent(sourceMsg),
        }
      : { userBubbleContent: suggestion.label || userText };

  if (chatSending.value) {
    chatMessages.value.push({
      id: genId(),
      role: "user",
      content: runOptions.userBubbleContent,
    });
    interruptAgentRun();
    persistChatNow();
    void scrollChatToBottom(true);
    void runAgentTurn(userText, { ...runOptions, skipUserBubble: true });
    return;
  }

  void runAgentTurn(userText, runOptions);
}

function handleAiOptionSelect(
  option: { index: number; label: string; fullText: string; action?: "implement" },
  msg?: ChatMessage,
) {
  const userText = option.fullText;
  if (!userText) return;
  const runOptions =
    option.action === "implement" && msg?.role === "assistant"
      ? {
          userBubbleContent: option.label,
          planAssistantContent: messageDisplayContent(msg),
        }
      : { userBubbleContent: userText };

  if (chatSending.value) {
    chatMessages.value.push({
      id: genId(),
      role: "user",
      content: runOptions.userBubbleContent,
    });
    interruptAgentRun();
    persistChatNow();
    void scrollChatToBottom(true);
    void runAgentTurn(userText, { ...runOptions, skipUserBubble: true });
    return;
  }

  void runAgentTurn(userText, runOptions);
}

async function sendChat() {
  if (!canSendChat.value) return;
  dismissAgentSuggestions();
  const composer = composerRef.value;
  if (!composer) return;

  const payload = composer.extractPayload();
  composer.clear();
  mentionOpen.value = false;

  const userText = payload.text.trim();
  const imageDataUrls = payload.imageDataUrls.filter(Boolean);
  let fullPrompt = userText || (imageDataUrls.length ? "请结合附带的图片回答。" : "请结合引用的文件回答。");

  let bubbleText = userText;
  if (quotedMessages.value.length) {
    const quotedContent = quotedMessages.value
      .map((q) => {
        const prefix = q.role === "assistant" ? "Agent" : "你";
        return `> ${prefix}: ${q.content.replace(/\n/g, "\n> ")}`;
      })
      .join("\n\n");
    fullPrompt = `${quotedContent}\n\n${fullPrompt}`;
    bubbleText = userText ? `${quotedContent}\n\n${userText}` : quotedContent;
    quotedMessages.value = [];
  }

  const refSection =
    chatMode.value === "build" &&
    resolveAgentRunProfile({
      prompt: fullPrompt,
      mode: chatMode.value,
      lastAssistantContent: findLastAssistantContent(),
      referencedFiles: payload.refs.map((r) => r.relative || r.path).filter(Boolean),
    }).kind === "execute_plan"
      ? buildReferencedFilePathsSection(payload.refs)
      : await buildReferencedFileSection(payload.refs);
  const dropSection = payload.drops.length
    ? payload.drops
        .map((f) => {
          const content = truncatePromptAttachment(f.content);
          return `### 📄 ${f.name}\n\`\`\`\n${content}\n\`\`\``;
        })
        .join("\n\n")
    : "";

  const sections = [refSection, dropSection].filter(Boolean);
  if (sections.length) {
    fullPrompt = `${fullPrompt}\n\n## 📎 参考文件\n\n${sections.join("\n\n")}`;
  }

  if (chatSending.value) {
    chatMessages.value.push({
      id: genId(),
      role: "user",
      content: bubbleText || (imageDataUrls.length ? "（附图）" : ""),
      imageDataUrls: imageDataUrls.length ? [...imageDataUrls] : undefined,
    });
    interruptAgentRun();
    persistChatNow();
    void scrollChatToBottom(true);
    await runAgentTurn(fullPrompt, {
      referencedFiles: payload.refs.map((r) => r.relative || r.path).filter(Boolean),
      imageDataUrls,
      skipUserBubble: true,
      userBubbleContent: bubbleText,
    });
    return;
  }

  await runAgentTurn(fullPrompt, {
    referencedFiles: payload.refs.map((r) => r.relative || r.path).filter(Boolean),
    imageDataUrls: imageDataUrls,
    userBubbleContent: bubbleText,
  });
}

function onWindowFocus() {
  reloadAiConfig();
}

function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === "p") {
    e.preventDefault();
    searchInputRef.value?.focus();
    searchInputRef.value?.select();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    void saveFile();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === "ArrowUp") {
    e.preventDefault();
    switchToAdjacentSession(-1);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === "ArrowDown") {
    e.preventDefault();
    switchToAdjacentSession(1);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "n" || e.key === "N")) {
    e.preventDefault();
    startNewSession();
    return;
  }
}

watch(chatMode, (mode) => {
  try {
    localStorage.setItem(CHAT_MODE_KEY, mode);
  } catch {
    // ignore
  }
});

watch(gitLogOpen, async (open) => {
  if (open && projectOpened.value && gitIsRepo.value) {
    const logResult = await fetchGitLog(projectPath.value.trim(), 20);
    if (logResult.ok) {
      gitLogEntries.value = logResult.entries;
    }
  }
});

watch(
  chatMessages,
  () => {
    schedulePersistChat();
    if (chatSending.value) scheduleStreamScroll();
  },
  { deep: true },
);

let chatImageHydrateToken = 0;
watch(
  () =>
    `${projectPath.value.trim()}|${chatMessages.value
      .map((m) =>
        m.role === "user"
          ? `${m.id}:${m.imageRefs?.length ?? 0}:${m.imageDataUrls?.length ?? 0}`
          : "",
      )
      .join(";")}`,
  () => {
    if (!projectPath.value.trim() || !chatMessagesNeedImageHydration(chatMessages.value)) return;
    const token = ++chatImageHydrateToken;
    void (async () => {
      const next = await applyChatMessageImageHydration(chatMessages.value);
      if (token !== chatImageHydrateToken) return;
      chatMessages.value = next;
    })();
  },
);

watch(gitPanelMode, (mode) => {
  localStorage.setItem(GIT_PANEL_MODE_KEY, mode);
});

provide(vibeChatMessageContextKey, {
  chatMessages,
  chatSending,
  agentUiTick,
  configReady,
  projectOpened,
  chainJumpVisible,
  expandedDiffs,
  onMessageSelect,
  onMessageDoubleClick,
  copyText,
  editUserMessage,
  undoExchange,
  resendFromMessage,
  canResumeAgentRun,
  isPartialWrittenRunInterrupt,
  resumeAgentRun,
  resolveAgentResumeButtonLabel,
  isAssistantStalled,
  stopAgent,
  forceRecoverStalledRun,
  recoverableAgentErrorHint,
  agentAbortDisplayReason,
  agentStatusDisplay,
  buildAgentRunningStatusText: buildAgentRunningStatusTextForMsg,
  hasAgentActivity,
  isAgentRunning,
  patchAssistantMsg,
  schedulePersistChat,
  messageDisplayContent,
  jumpChainToLatest,
  userMessageImages,
  shouldShowMessageBubble,
  handleAiOptionSelect,
  previewAgentFile,
  truncateDiffPreview,
  toggleExpandedDiff,
  isDiffExpanded,
  canExecutePlanMessage,
  executePlanFromMessage,
  planExecutionActive,
} as VibeChatMessageContext);

onMounted(() => {
  reloadAiConfig();
  refreshProjectHistoryList();
  pendingPromptQueue.value = [];
  persistPendingQueue();
  loadSavedProject();
  chatPanelWidth.value = Math.min(chatPanelWidth.value, getChatPanelMaxWidth());
  window.addEventListener("focus", onWindowFocus);
  window.addEventListener("dragend", onWindowDragEnd);
  document.addEventListener("mousedown", onDocumentClick, true);
  document.addEventListener("keydown", onGlobalKeydown);
  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("dragover", onDocumentDragOverCapture, true);
  document.addEventListener("drop", onDocumentDropCapture, true);
  onStorageError((msg) => {
    chatError.value = msg;
  });

  // --- HMR 恢复：注册 Vite 重载前钩子 + 检查待恢复运行 ---
  registerHmrPreReloadHook(() => {
    // 在 Vite full reload 前，如果 Agent 正在运行且尚未持久化，补充保存
    // （runAgentTurn 已在启动时持久化完整请求，此处作为兜底）
    if (chatSending.value && getAgentAbortHandle()) {
      const lastUser = findLastUserMessage();
      if (lastUser) {
        persistAgentRunForHmr({
          request: { prompt: lastUser.content },
          projectPath: projectPath.value.trim(),
          sessionId: activeSessionId.value || undefined,
        });
      }
    }
  });
  // 页面加载后检查是否有因 HMR 中断的 Agent 运行
  nextTick(() => tryResumeHmrInterruptedRun());
});

onBeforeUnmount(() => {
  fileDragGhost.value = null;
  window.removeEventListener("focus", onWindowFocus);
  window.removeEventListener("dragend", onWindowDragEnd);
  document.removeEventListener("mousedown", onDocumentClick, true);
  document.removeEventListener("keydown", onGlobalKeydown);
  document.removeEventListener("selectionchange", onSelectionChange);
  if (selectionChangeTimer) clearTimeout(selectionChangeTimer);
  document.removeEventListener("dragover", onDocumentDragOverCapture, true);
  document.removeEventListener("drop", onDocumentDropCapture, true);
  if (chatSending.value && getAgentAbortHandle()) {
    interruptAgentRun({ reason: HMR_INTERRUPT_REASON });
  } else {
    getAgentAbortHandle()?.abort();
  }
  clearStreamDeltaBuffer();
  stopResize();
  if (scrollChatRaf) cancelAnimationFrame(scrollChatRaf);
  cancelPendingChatPersistence();
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  if (mentionSearchTimer) clearTimeout(mentionSearchTimer);
  if (gitRefreshDebounceTimer) clearTimeout(gitRefreshDebounceTimer);
  stopAgentUiTick();
  clearRetryTimer();
  if (sessionCopyHintTimer) {
    clearTimeout(sessionCopyHintTimer);
    sessionCopyHintTimer = null;
  }
  cancelAutoResume();
  persistChatNow(undefined, { flushStore: true });
  stopFileWatcherForProject();
});
</script>

