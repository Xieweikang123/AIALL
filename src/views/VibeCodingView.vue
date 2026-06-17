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
      :chat-sending="chatSending"
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
        @update:git-panel-mode="gitPanelMode = $event"
        @update:search-query="searchQuery = $event"
        @update:search-mode="searchMode = $event"
        @handle-search="handleSearch"
        @create-new-file="createNewFile"
        @create-new-folder="createNewFolder"
        @expand-editor="expandEditor"
        @refresh-git-status="refreshGitStatus(gitIsRepo ? { showLoading: false } : undefined)"
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

        :chat-running-text="chatRunningText"
        :recoverable-assistant-msg="recoverableAssistantMsg"
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
        :show-quote-button="showQuoteButton"
        :quote-button-position="quoteButtonPosition"
        :quoted-message="quotedMessage"
        :mention-open="mentionOpen"
        :mention-results="mentionResults"
        :mention-active-index="mentionActiveIndex"
        :chat-input-focused="chatInputFocused"
        :can-switch-to-newer-session="canSwitchToNewerSession"
        :can-switch-to-older-session="canSwitchToOlderSession"
        :switching-session="switchingSession"
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
        @on-chat-drag-enter="onChatDragEnter"
        @on-chat-drag-over="onChatDragOver"
        @on-chat-drag-leave="onChatDragLeave"
        @on-chat-drop="onChatDrop"
        @switch-to-adjacent-session="switchToAdjacentSession"
        @toggle-session-picker="toggleSessionPicker"
        @start-new-session="startNewSession"
        @switch-session="switchSession"
        @copy-session-info="copySessionInfo"
        @remove-session="removeSession"
        @sync-chat-store-to-disk="syncChatStoreToDisk"
        @clear-chat="clearChat"
        @apply-example="applyExample"
        @on-chat-scroll="onChatScroll"
        @quote-selected-text="quoteSelectedText"
        @hide-quote-button="hideQuoteButton"
        @clear-pending-queue="clearPendingPromptQueue"
        @update:quoted-message="quotedMessage = $event"
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
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from "vue";
import "../styles/vibe-coding.scss";
import type { AgentLogLineItem } from "../components/AgentActivityLogStream.vue";
import { appendStatusDetail, truncateDiffPreview, cleanStatusLogText, formatCharCount, isNetworkError, fileName, genId, isActiveModelStep, hasAgentProcessSteps, shouldShowMessageBubble, entryToNode, formatToolMeta, syncRoundGroupsPatch } from "../utils/vibeHelpers";
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
import { useProjectMemory } from "../composables/useProjectMemory";
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
  inferAgentRecoveryFlags,
  isAgentMaxTurnsExhausted,
  isAgentConnectPhase,
  isAgentConnectStalled,
  isAgentRunStalled,
  isRecoverableAgentError,
  recoverableAgentErrorHint,
  resolveAgentCompletedTurns,
  resolveAgentFailureBubbleContent,
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
  clearVibeChatHistory,
  getActiveSessionSnapshot,
  getVibeChatProjectSnapshot,
  hasVibeChatHistory,
  loadVibeChatHistory,
  onStorageError,
  projectChatNeedsDiskRestore,
  restoreChatStoreFromSnapshot,
  saveVibeChatHistory,
  stripReferenceAttachments,
  stripToolSummaryFromAssistantContent,
  switchVibeChatSession,
  getActiveVibeChatSessionId,
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
  stampImageRefsAfterSync,
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
  fetchChatStoreFromDisk,
  formatFetchError,
  syncChatSession,
  syncChatStore,
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
const SYNC_STORE_DEBOUNCE_MS = 5000;
type ChatRole = "user" | "assistant";
type ChatMessage = Omit<PersistedChatMessage, "tools" | "roundGroups"> & {
  tools?: AgentToolStepFromToolHelpers[];
  roundGroups?: AgentRoundGroup[];
  status?: string;
  agentPhase?: string;
  agentTurn?: number;
  agentMaxTurns?: number;
  agentModel?: string;
  agentDetail?: string;
  streamChars?: number;
  contextChars?: number;
  agentWaitStartedAt?: number;
  streaming?: boolean;
  reverting?: boolean;
  applying?: boolean;
  agentAborted?: boolean;
  agentFailed?: boolean;
  agentRecoverable?: boolean;
  agentFailureReason?: string;
  agentRecoveryDismissed?: boolean;
  _expandedDiffs?: Record<string, boolean>;
};

type FileDiff = {
  before: string;
  after: string;
  deleted?: boolean;
  created?: boolean;
};

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

let agentAbortHandle: { abort: () => void } | null = null;
let agentRunGeneration = 0;
let saveChatTimer: ReturnType<typeof setTimeout> | null = null;
let syncStoreTimer: ReturnType<typeof setTimeout> | null = null;
let agentUiTickTimer: ReturnType<typeof setInterval> | null = null;
let autoResumeTimer: ReturnType<typeof setInterval> | null = null;
const autoResumeSecondsLeft = ref(0);
const autoResumeTargetId = ref("");
const agentUiTick = ref(0);
/** Timestamp of last meaningful agent progress (not heartbeat status). */
let agentLastProgressAt = 0;
/** When the current agent run started waiting on local connect / upload. */
let agentConnectStartedAt = 0;
let agentConnectHasImages = false;

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
const quotedMessage = ref<QuotedMessage | null>(null);
const quoteButtonPosition = ref({ x: 0, y: 0 });
const showQuoteButton = ref(false);
const openingProject = ref(false);
let switchSessionGeneration = 0;

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
const switchingSession = ref(false);
const chatError = ref("");
const searchInputRef = ref<HTMLInputElement | null>(null);
const workspaceRef = ref<HTMLElement | null>(null);
let scrollChatRaf = 0;
const CHAT_SCROLL_PIN_THRESHOLD = 80;
let chatPinnedToBottom = true;
const sessionPickerRef = ref<HTMLElement | null>(null);
const chatPanelRef = ref<InstanceType<typeof ChatPanel> | null>(null);
const syncingChatStore = ref(false);
const chatStoreSyncMessage = ref("");
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

function loadPendingQueue(): string[] {
  try {
    const raw = localStorage.getItem(PENDING_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x: unknown) => typeof x === "string") : [];
  } catch {
    return [];
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
  removeSession: removeSessionBase,
  sessionLocalFileName,
  formatSessionInfoForCopy,
} = session;

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
  session.refreshSessionList(path);
}

function toggleSessionPicker() {
  session.toggleSessionPicker(chatSending.value);
}

function closeSessionPicker() {
  session.closeSessionPicker();
}

function switchToAdjacentSession(delta: number) {
  const nextId = session.switchToAdjacentSession(delta, chatSending.value);
  if (nextId) switchSession(nextId);
}

async function removeSession(sessionId: string) {
  const ok = await confirm("确定删除此会话？");
  if (!ok) return;
  const result = removeSessionBase(sessionId, chatSending.value);
  if (result) chatMessages.value = normalizeChatMessages(result);
  refreshSessionList();
  void scrollChatToBottom(true);
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
    ? "描述需求，AI 输出修改方案（不写文件）"
    : "描述要改什么（Enter 发送，Shift+Enter 换行）",
);

const chatRunningText = computed(() =>
  chatMode.value === "ask"
    ? "思考中… · 发送新消息将打断"
    : chatMode.value === "plan"
    ? "规划中… · 发送新消息将打断"
    : "Agent 运行中… · 发送新消息将打断",
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

const stalledAssistantMsg = ref<ChatMessage | null>(null);

function refreshStalledAssistantMsg() {
  if (!chatSending.value || agentLastProgressAt <= 0) {
    stalledAssistantMsg.value = null;
    return;
  }
  if (!isAgentRunStalled(agentLastProgressAt, chatSending.value)) {
    stalledAssistantMsg.value = null;
    return;
  }
  const msg = findRunningAssistantMsg();
  if (!msg || !hasRecoverableAgentProgress(msg)) {
    stalledAssistantMsg.value = null;
    return;
  }
  stalledAssistantMsg.value = msg;
}

function isAssistantStalled(msg: ChatMessage): boolean {
  return Boolean(stalledAssistantMsg.value && stalledAssistantMsg.value.id === msg.id);
}

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

function formatAgentStatus(data: AgentStatusData, compact = false): string {
  const { phase, turn, maxTurns, openFile, model, toolTitle, toolDetail, detail } = data;

  if (phase === "connecting_local") return "正在连接本地服务（127.0.0.1:37891）…";
  if (phase === "stream_connected") return "本地服务已连接，等待 Agent 启动…";
  if (phase === "connected") return "本地 Agent 服务已就绪，正在启动任务…";
  if (phase === "reconnecting") {
    const retryHint = data.retryAttempt && data.retryMaxAttempts
      ? `（第 ${data.retryAttempt}/${data.retryMaxAttempts - 1} 次）`
      : "";
    return `正在重连${retryHint}…`;
  }
  if (phase === "building_context") {
    return appendStatusDetail("正在扫描项目上下文…", detail);
  }
  if (phase === "compacting_context") {
    return appendStatusDetail("正在压缩并准备模型上下文…", detail);
  }
  if (phase === "vision_first_turn") {
    return appendStatusDetail("正在查看附图并描述所见…", detail);
  }
  if (phase === "vision_first_turn_done") {
    return appendStatusDetail("读图完成，开始定位与修改…", detail);
  }
  if (phase === "vision_first_turn_skipped") {
    return appendStatusDetail("读图描述不足，继续执行任务…", detail);
  }
  if (phase === "sending_request") {
    return appendStatusDetail("正在发送模型请求…", detail);
  }
  if (phase === "preparing" || phase === "starting") {
    if (chatMode.value === "ask") {
      return openFile
        ? appendStatusDetail(`正在准备问答上下文（当前文件：${openFile}）…`, detail)
        : appendStatusDetail("正在准备问答上下文…", detail);
    }
    if (chatMode.value === "plan") {
      return openFile
        ? appendStatusDetail(`正在准备规划上下文（当前文件：${openFile}）…`, detail)
        : appendStatusDetail("正在准备规划上下文…", detail);
    }
    return openFile
      ? appendStatusDetail(`正在组装 Agent 上下文与工具定义（当前文件：${openFile}）…`, detail)
      : appendStatusDetail("正在组装 Agent 上下文与工具定义…", detail);
  }
  if (phase === "streaming_model") {
    if (compact) return appendStatusDetail("模型输出中…", detail);
    const modelHint = model ? ` · ${model}` : "";
    const turnHint = turn ? `（第 ${turn} 轮${modelHint}）` : modelHint;
    return appendStatusDetail(`模型输出中${turnHint}`, detail);
  }
  if (phase === "planning_tools") {
    if (compact) return appendStatusDetail("模型规划工具…", detail);
    const modelHint = model ? ` · ${model}` : "";
    const turnHint = turn ? `（第 ${turn} 轮${modelHint}）` : modelHint;
    return appendStatusDetail(`模型规划工具${turnHint}`, detail);
  }
  if (phase === "waiting_model" || phase === "thinking") {
    if (compact) return appendStatusDetail("正在等待模型响应…", detail);
    const modelHint = model ? ` · ${model}` : "";
    const turnHint = turn
      ? maxTurns
        ? `（第 ${turn}/${maxTurns} 轮${modelHint}）`
        : `（第 ${turn} 轮${modelHint}）`
      : modelHint;
    return appendStatusDetail(`正在等待模型响应${turnHint}…`, detail);
  }
  if (phase === "retrying_model") {
    const modelHint = model ? ` · ${model}` : "";
    const turnHint = turn
      ? maxTurns
        ? `（第 ${turn}/${maxTurns} 轮${modelHint}）`
        : `（第 ${turn} 轮${modelHint}）`
      : modelHint;
    const retryHint =
      data.retryAttempt && data.retryMaxAttempts
        ? `，第 ${data.retryAttempt}/${data.retryMaxAttempts - 1} 次重试`
        : "";
    const reason = data.retryError ? `：${data.retryError}` : "";
    return appendStatusDetail(`模型请求失败${reason}，正在重试${turnHint}${retryHint}…`, detail);
  }
  if (phase === "executing_tool") {
    return toolDetail ? `正在执行：${toolTitle}（${toolDetail}）` : `正在执行：${toolTitle}…`;
  }
  if (phase === "executing_tools") return "正在执行工具调用…";
  if (phase === "summarizing_tools") return "正在整理工具结果，准备下一轮推理…";
  if (phase === "continuing") return appendStatusDetail("任务较长，自动续跑下一段…", detail);
  if (phase === "finished") return "";
  if (phase === "aborted") return "已停止运行";
  return "";
}

function touchAgentProgress() {
  agentLastProgressAt = Date.now();
}

function startAgentUiTick() {
  stopAgentUiTick();
  touchAgentProgress();
  agentConnectStartedAt = Date.now();
  agentUiTickTimer = setInterval(() => {
    agentUiTick.value += 1;
    refreshStalledAssistantMsg();
    checkAgentStall();
  }, 1000);
}

function checkAgentStall() {
  if (!chatSending.value) return;
  const msg = findRunningAssistantMsg();
  if (!msg) return;

  if (
    isAgentConnectStalled(agentConnectStartedAt, msg.agentPhase, true) &&
    isAgentConnectPhase(msg.agentPhase)
  ) {
    abortAgentConnectStall(msg);
    return;
  }

  if (agentLastProgressAt <= 0) return;
  if (!isAgentRunStalled(agentLastProgressAt, true)) return;
  if (!hasRecoverableAgentProgress(msg)) return;
  recoverAgentRunFromStall(msg, agentStallRecoveryReason());
}

function abortAgentConnectStall(msg: ChatMessage) {
  agentAbortHandle?.abort();
  agentAbortHandle = null;
  chatSending.value = false;
  agentConnectStartedAt = 0;
  agentLastProgressAt = 0;
  clearPendingAgentRun();
  stopAgentUiTick();
  const reason = agentConnectStallMessage(agentConnectHasImages);
  chatError.value = reason;
  msg.agentFailed = true;
  msg.agentRecoverable = true;
  msg.agentFailureReason = reason;
  patchAssistantMsg(msg.id, {
    agentFailed: true,
    agentRecoverable: true,
    agentFailureReason: reason,
    agentPhase: undefined,
    status: reason,
  });
  // Update session status to failed
  if (activeSessionId.value && projectPath.value.trim()) {
    updateVibeChatSessionStatus(projectPath.value.trim(), activeSessionId.value, "failed");
  }
  persistChatNow();
}

function cancelAutoResume() {
  if (autoResumeTimer) {
    clearInterval(autoResumeTimer);
    autoResumeTimer = null;
  }
  autoResumeSecondsLeft.value = 0;
  autoResumeTargetId.value = "";
}

function startAutoResumeCountdown(assistantMsgId: string, errorMessage: string) {
  const msg = chatMessages.value.find((m) => m.id === assistantMsgId);
  if (!msg || !canResumeAgentRun(msg)) return;

  autoResumeTargetId.value = assistantMsgId;
  autoResumeSecondsLeft.value = resolveAutoResumeSeconds(
    errorMessage || msg.agentFailureReason || "",
  );
  autoResumeTimer = setInterval(() => {
    if (autoResumeSecondsLeft.value <= 1) {
      const targetId = autoResumeTargetId.value;
      cancelAutoResume();
      if (targetId && !chatSending.value) void resumeAgentRun(targetId);
      return;
    }
    autoResumeSecondsLeft.value -= 1;
  }, 1000);
}

function scheduleAutoResume(assistantMsgId: string, errorMessage = "") {
  cancelAutoResume();
  if (!assistantMsgId || !configReady.value || !projectOpened.value) return;

  const run = () => {
    if (!assistantMsgId || chatSending.value || !configReady.value || !projectOpened.value) return;
    startAutoResumeCountdown(assistantMsgId, errorMessage);
  };

  // error 事件里 applyRecoverableAgentFailure 早于 chatSending=false，需延后一拍再倒计时
  if (chatSending.value) {
    queueMicrotask(run);
    return;
  }
  run();
}

function maybeAutoResumeLastRecoverableAssistant() {
  if (chatSending.value || !configReady.value || !projectOpened.value) return;
  for (let i = chatMessages.value.length - 1; i >= 0; i -= 1) {
    const m = chatMessages.value[i]!;
    if (m.role === "assistant" && canResumeAgentRun(m)) {
      const reason = m.agentFailureReason || "";
      if (reason && shouldSilentAutoContinue(reason)) {
        trySilentContinue(m, reason);
      }
      return;
    }
  }
}

function prepareAssistantForSilentContinue(assistantMsg: ChatMessage) {
  for (const tool of assistantMsg.tools || []) {
    if (tool.running) tool.running = false;
  }
  assistantMsg.streaming = false;
  assistantMsg.agentPhase = undefined;
  assistantMsg.status = "";
}

function trySilentContinue(assistantMsg: ChatMessage, reason: string): boolean {
  if (!shouldSilentAutoContinue(reason)) return false;
  const count = assistantMsg.agentContinueCount ?? 0;
  if (count >= AGENT_SILENT_CONTINUE_MAX) return false;
  if (!configReady.value || !projectOpened.value) return false;
  if (!resolveOriginalUserPrompt(assistantMsg.id)) return false;

  prepareAssistantForSilentContinue(assistantMsg);
  assistantMsg.agentContinueCount = count + 1;
  chatError.value = "";
  appendStatusLog(assistantMsg, buildSilentContinueStatusLog(reason, assistantMsg.agentContinueCount));
  patchAssistantMsg(assistantMsg.id, {
    agentContinueCount: assistantMsg.agentContinueCount,
    streaming: false,
    agentPhase: undefined,
    status: "",
    statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
    activityExpanded: true,
    activityDetailed: true,
    tools: assistantMsg.tools ? [...assistantMsg.tools] : undefined,
    ...syncRoundGroupsPatch(assistantMsg),
  });

  window.setTimeout(() => {
    if (!chatSending.value) void resumeAgentRun(assistantMsg.id, { silent: true });
  }, AGENT_SILENT_CONTINUE_DELAY_MS);
  return true;
}

function handleRecoverableInterruption(
  assistantMsg: ChatMessage,
  reason: string,
  options?: { logStatus?: boolean },
) {
  if (trySilentContinue(assistantMsg, reason)) return;
  applyRecoverableAgentFailure(assistantMsg, reason, options);
}

function applyRecoverableAgentFailure(
  assistantMsg: ChatMessage,
  message: string,
  options?: { logStatus?: boolean },
) {
  const recoverable = isRecoverableAgentError(message);
  assistantMsg.agentFailed = true;
  assistantMsg.agentRecoverable = recoverable;
  assistantMsg.agentFailureReason = message;
  assistantMsg.agentRecoveryDismissed = false;
  assistantMsg.streaming = false;

  const progressContent = resolveAgentFailureBubbleContent(assistantMsg);
  assistantMsg.content = progressContent;
  if (options?.logStatus !== false) {
    appendStatusLog(
      assistantMsg,
      recoverable ? `连接中断：${message}（可恢复运行）` : `错误：${message}`,
    );
  }
  if (recoverable) {
    assistantMsg.activityExpanded = true;
    assistantMsg.totalTurns = resolveAgentCompletedTurns(assistantMsg);
  }

  chatError.value = recoverable
    ? recoverableAgentErrorHint(assistantMsg, message)
    : message;

  patchAssistantMsg(assistantMsg.id, {
    agentFailed: true,
    agentRecoverable: recoverable,
    agentFailureReason: message,
    agentRecoveryDismissed: false,
    content: assistantMsg.content,
    streaming: false,
    activityExpanded: recoverable ? true : assistantMsg.activityExpanded,
    totalTurns: assistantMsg.totalTurns,
    statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
    ...syncRoundGroupsPatch(assistantMsg),
  });

  cancelAutoResume();
}

function recoverAgentRunFromStall(assistantMsg: ChatMessage, reason: string) {
  agentRunGeneration += 1;
  clearStreamDeltaBuffer();
  stopAgentUiTick();
  agentAbortHandle?.abort();
  agentAbortHandle = null;
  agentLastProgressAt = 0;
  chatSending.value = false;
  handleRecoverableInterruption(assistantMsg, reason);
  persistChatNow();
  void scrollChatToBottom();
}

function forceRecoverStalledRun(assistantMsgId: string) {
  const msg = chatMessages.value.find((m) => m.id === assistantMsgId);
  if (!msg || msg.role !== "assistant") return;
  if (chatSending.value && msg.id === activeAssistantMsgId.value) {
    recoverAgentRunFromStall(msg, agentStallRecoveryReason());
    return;
  }
  if (canResumeAgentRun(msg)) {
    void resumeAgentRun(assistantMsgId);
  }
}

function stopAgentUiTick() {
  if (agentUiTickTimer) {
    clearInterval(agentUiTickTimer);
    agentUiTickTimer = null;
  }
  stalledAssistantMsg.value = null;
}

const STREAM_DELTA_FLUSH_MS = 80;
const STREAM_SCROLL_THROTTLE_MS = 120;
let streamDeltaFlushTimer: ReturnType<typeof setTimeout> | null = null;
let streamScrollTimer: ReturnType<typeof setTimeout> | null = null;
let pendingStreamDelta: { msgId: string; assistantMsg: ChatMessage; pending: string } | null = null;

function scheduleStreamScroll() {
  if (!chatSending.value || !chatPinnedToBottom) return;
  if (streamScrollTimer) return;
  streamScrollTimer = setTimeout(() => {
    streamScrollTimer = null;
    void scrollChatToBottom();
  }, STREAM_SCROLL_THROTTLE_MS);
}

function flushPendingStreamDelta() {
  if (streamDeltaFlushTimer) {
    clearTimeout(streamDeltaFlushTimer);
    streamDeltaFlushTimer = null;
  }
  if (!pendingStreamDelta?.pending) return;

  const { msgId, assistantMsg } = pendingStreamDelta;
  const delta = pendingStreamDelta.pending;
  pendingStreamDelta.pending = "";

  const turn = assistantMsg.agentTurn ?? 1;
  assistantMsg.roundGroups = recordAgentRoundStreamDelta(
    assistantMsg.roundGroups,
    turn,
    delta,
    assistantMsg.agentMaxTurns,
  );
  assistantMsg.streamChars = (assistantMsg.streamChars || 0) + delta.length;
  assistantMsg.streaming = true;
  patchAssistantMsg(msgId, {
    streaming: true,
    streamChars: assistantMsg.streamChars,
    ...syncRoundGroupsPatch(assistantMsg),
  });
  if (isAgentRunning(assistantMsg)) scrollStatusLogToBottom(msgId);
  scheduleStreamScroll();
}

function enqueueStreamDelta(msgId: string, assistantMsg: ChatMessage, delta: string) {
  if (!pendingStreamDelta || pendingStreamDelta.msgId !== msgId) {
    flushPendingStreamDelta();
    pendingStreamDelta = { msgId, assistantMsg, pending: "" };
  }
  pendingStreamDelta.pending += delta;
  if (streamDeltaFlushTimer) return;
  streamDeltaFlushTimer = setTimeout(() => {
    streamDeltaFlushTimer = null;
    flushPendingStreamDelta();
  }, STREAM_DELTA_FLUSH_MS);
}

function clearStreamDeltaBuffer() {
  flushPendingStreamDelta();
  pendingStreamDelta = null;
}

function setAgentStatus(msg: ChatMessage, phase: string, extra?: Partial<AgentStatusData>, options?: { log?: boolean }) {
  const prevPhase = msg.agentPhase;
  msg.agentPhase = phase;
  if (extra?.detail !== undefined) msg.agentDetail = extra.detail;
  if (extra?.streamChars !== undefined) msg.streamChars = extra.streamChars;
  if (extra?.contextChars !== undefined) msg.contextChars = extra.contextChars;
  if (extra?.turn) msg.agentTurn = extra.turn;
  if (extra?.maxTurns) msg.agentMaxTurns = extra.maxTurns;
  if (extra?.model) msg.agentModel = extra.model;
  if (phase === "waiting_model" || phase === "sending_request" || phase === "retrying_model") {
    if (!msg.agentWaitStartedAt) msg.agentWaitStartedAt = Date.now();
  } else if (phase === "streaming_model" || phase === "planning_tools" || phase === "executing_tool") {
    msg.agentWaitStartedAt = undefined;
  }
  const statusText = formatAgentStatus({ phase, ...extra, turn: msg.agentTurn, maxTurns: msg.agentMaxTurns, model: msg.agentModel || extra?.model });
  msg.status = statusText;
  const shouldLog = options?.log ?? phase !== prevPhase;
  if (shouldLog) appendStatusLog(msg, statusText);
}

function isAgentRunning(msg: ChatMessage): boolean {
  return chatSending.value && msg.id === activeAssistantMsgId.value;
}

function shouldCollapseFeed(msg: ChatMessage): boolean {
  if (isAgentRunning(msg)) return false;
  if (isActivityExpanded(msg)) return false;
  return true;
}

function hasAgentActivity(msg: ChatMessage): boolean {
  return Boolean(
    msg.agentContext ||
      msg.roundGroups?.length ||
      msg.statusLog?.length ||
      msg.turnTraces?.length ||
      msg.status ||
      msg.tools?.length ||
      msg.agentTurn ||
      msg.totalTurns,
  );
}

function appendStatusLog(msg: ChatMessage, line: string) {
  const text = line.trim();
  if (!text) return;
  if (!msg.statusLog) msg.statusLog = [];
  const last = msg.statusLog[msg.statusLog.length - 1];
  if (last !== text) msg.statusLog.push(text);
}

const statusLogScrollRefs = new Map<string, HTMLElement>();
const chainScrollPinned = new Map<string, boolean>();
const chainJumpVisible = reactive<Record<string, boolean>>({});
const expandedDiffs = reactive<Record<string, Record<string, boolean>>>({});

function toggleExpandedDiff(messageId: string, relPath: string) {
  if (!expandedDiffs[messageId]) expandedDiffs[messageId] = {};
  expandedDiffs[messageId][relPath] = !expandedDiffs[messageId][relPath];
}

function isDiffExpanded(messageId: string, relPath: string): boolean {
  return Boolean(expandedDiffs[messageId]?.[relPath]);
}

function bindStatusLogScroll(el: HTMLElement | null, msgId: string) {
  if (el) {
    statusLogScrollRefs.set(msgId, el);
    if (!chainScrollPinned.has(msgId)) chainScrollPinned.set(msgId, true);
    if (chatSending.value && msgId === activeAssistantMsgId.value) {
      scrollStatusLogToBottom(msgId);
    } else {
      onChainViewportScroll(msgId);
    }
  } else {
    statusLogScrollRefs.delete(msgId);
    chainScrollPinned.delete(msgId);
    delete chainJumpVisible[msgId];
  }
}

function onChainViewportScroll(msgId: string) {
  const el = statusLogScrollRefs.get(msgId);
  if (!el) return;
  const nearBottom = isScrollNearBottom(el);
  chainScrollPinned.set(msgId, nearBottom);
  chainJumpVisible[msgId] = !nearBottom && el.scrollHeight > el.clientHeight + 8;
}

function jumpChainToLatest(msgId: string) {
  const el = statusLogScrollRefs.get(msgId);
  if (!el) return;
  scrollElementToBottom(el, "smooth");
  chainScrollPinned.set(msgId, true);
  chainJumpVisible[msgId] = false;
}

function scrollStatusLogToBottom(msgId: string) {
  void nextTick(() => {
    const el = statusLogScrollRefs.get(msgId);
    if (!el) return;
    if (chainScrollPinned.get(msgId) ?? true) {
      el.scrollTop = el.scrollHeight;
    }
    onChainViewportScroll(msgId);
  });
}

function isActivityExpanded(msg: ChatMessage): boolean {
  if (isAgentRunning(msg)) return true;
  return msg.activityExpanded === true;
}

function collapseAgentActivity(msg: ChatMessage) {
  msg.activityExpanded = false;
  patchAssistantMsg(msg.id, { activityExpanded: false });
  schedulePersistChat();
}

function cursorAgentFeed(msg: ChatMessage) {
  void agentUiTick.value;
  let agentDetail = msg.agentDetail || msg.status;
  if (
    isAgentRunning(msg) &&
    isAgentConnectPhase(msg.agentPhase) &&
    agentConnectStartedAt > 0
  ) {
    const elapsed = Math.max(0, Math.floor((Date.now() - agentConnectStartedAt) / 1000));
    const base =
      msg.agentDetail ||
      (msg.agentPhase === "connecting_local" ? "连接本地服务" : "启动 Agent");
    agentDetail = `${base} · ${elapsed}s`;
  }
  const bubble = messageDisplayContent(msg);
  const items = buildCursorAgentFeed({
    groups: agentRoundGroupViews(msg),
    isRunning: isAgentRunning(msg),
    agentPhase: msg.agentPhase,
    agentDetail,
    answerPreview: bubble,
    streaming: Boolean(msg.streaming && isAgentRunning(msg)),
  });
  return filterDuplicateFeedThoughts(items, bubble, {
    suppressAllWhenBubble: isAgentRunning(msg),
  });
}

function cursorAgentFeedBlocks(msg: ChatMessage): CursorFeedProcessBlock[] {
  return cursorAgentTimeline(msg).processBlocks;
}

function cursorAgentTimeline(msg: ChatMessage): CursorAgentTimeline {
  const detailed = isActivityDetailed(msg);
  return buildCursorAgentTimeline(cursorAgentFeed(msg), messageDisplayContent(msg), {
    keepVisible: detailed ? 8 : 6,
    collapseAfter: detailed ? 10 : 5,
    compactWhileRunning: isAgentRunning(msg) && detailed,
    streaming: isAgentRunning(msg),
  });
}

function timelineAnswerContent(msg: ChatMessage): string {
  if (msg.role !== "assistant" || !hasAgentActivity(msg)) return "";
  return messageDisplayContent(msg);
}

function cursorAgentFeedAnswer(msg: ChatMessage) {
  void agentUiTick.value;
  return cursorAgentTimeline(msg).answer;
}

function isActivityDetailed(msg: ChatMessage): boolean {
  return msg.activityDetailed === true;
}

function shouldUseCompactAgentFeed(msg: ChatMessage): boolean {
  const stepCount = msg.tools?.length ?? 0;
  return shouldUseCompactAgentFeedByCount(stepCount, isAgentRunning(msg), isActivityDetailed(msg));
}

function toggleActivityDetailed(msg: ChatMessage) {
  msg.activityDetailed = true;
  patchAssistantMsg(msg.id, { activityDetailed: true });
  schedulePersistChat();
}

function collapseActivityDetailed(msg: ChatMessage) {
  msg.activityDetailed = false;
  patchAssistantMsg(msg.id, { activityDetailed: false });
  schedulePersistChat();
}

function cursorCompactExplorationSummary(msg: ChatMessage): string {
  const stats = computeExplorationStats(msg.tools ?? []);
  return formatExplorationSummary(stats, isAgentRunning(msg));
}

function cursorCompactRunningAction(msg: ChatMessage) {
  const action = getRunningFeedAction(cursorAgentFeed(msg));
  return action?.step ?? null;
}

function cursorCompactRecentActions(msg: ChatMessage) {
  void agentUiTick.value;
  return getRecentFeedActions(cursorAgentFeed(msg)).recent;
}

function compactLogItems(msg: ChatMessage): AgentLogLineItem[] {
  void agentUiTick.value;
  return cursorCompactRecentActions(msg).map((item) => ({
    key: item.key,
    label: formatCursorActionLabel(item.step),
    state: cursorActionClass(item.step) as AgentLogLineItem["state"],
  }));
}

function cursorCompactHiddenCount(msg: ChatMessage): number {
  void agentUiTick.value;
  return getRecentFeedActions(cursorAgentFeed(msg)).hiddenCount;
}

function cursorCompactLiveStatus(msg: ChatMessage): string | null {
  void agentUiTick.value;
  if (!isAgentRunning(msg)) return null;
  if (cursorCompactRunningAction(msg)) return null;
  if (timelineAnswerContent(msg) && (msg.streaming || msg.agentPhase === "streaming_model" || msg.agentPhase === "planning_tools")) {
    return null;
  }

  if (msg.agentPhase === "streaming_model" || msg.agentPhase === "planning_tools") {
    return msg.streamChars && msg.streamChars > 0
      ? `思考中 · 已生成 ${msg.streamChars} 字`
      : "思考中…";
  }

  const parts: string[] = [];
  const waitingModel =
    msg.agentPhase === "waiting_model" ||
    msg.agentPhase === "sending_request" ||
    msg.agentPhase === "retrying_model";
  if (msg.agentPhase === "compacting_context") parts.push("压缩上下文…");
  else if (msg.agentPhase === "summarizing_tools") parts.push("整理工具结果…");
  else if (msg.agentPhase === "executing_tool" || msg.agentPhase === "executing_tools") return null;
  else if (waitingModel) parts.push("等待模型响应…");
  else parts.push("整合信息中…");

  if (msg.agentTurn) parts.push(`第 ${msg.agentTurn} 轮`);
  if (msg.agentWaitStartedAt && waitingModel) {
    const elapsed = Math.max(0, Math.floor((Date.now() - msg.agentWaitStartedAt) / 1000));
    parts.push(`已等待 ${elapsed}s`);
    if (elapsed > 45) parts.push("模型较慢，可取消后 @ 具体文件重试");
  } else if (msg.agentDetail?.trim()) {
    parts.push(msg.agentDetail.trim());
  }
  return parts.join(" · ");
}

function hasAgentDebugDetails(msg: ChatMessage): boolean {
  return Boolean(
    msg.agentContext ||
      msg.roundGroups?.some((group) => group.turn > 0 && (group.request || group.response || group.modelSteps.length)),
  );
}

function cursorActivitySummary(msg: ChatMessage): string {
  const actions = msg.tools?.length ?? 0;
  const last = msg.tools?.[msg.tools.length - 1];
  if (last && !last.running) {
    return `展开过程 · ${actions} 步 · ${formatCursorActionLabel(last)}`;
  }
  if (actions > 0) return `展开过程 · ${actions} 步`;
  if (msg.totalTurns) return `展开过程 · ${msg.totalTurns} 轮`;
  return "展开过程";
}

function toggleActivityExpanded(msg: ChatMessage) {
  msg.activityExpanded = !msg.activityExpanded;
  patchAssistantMsg(msg.id, { activityExpanded: msg.activityExpanded });
  schedulePersistChat();
}

function activitySummary(msg: ChatMessage): string {
  const toolCount = msg.tools?.length ?? 0;
  const parts: string[] = [];
  if (msg.totalTurns) parts.push(`${msg.totalTurns} 轮`);
  if (toolCount > 0) {
    const failed = msg.tools?.filter((t) => !t.ok).length ?? 0;
    parts.push(failed > 0 ? `${toolCount} 个工具（${failed} 失败）` : `${toolCount} 个工具`);
  }
  if (msg.turnFileDiffs && Object.keys(msg.turnFileDiffs).length) {
    parts.push(`${Object.keys(msg.turnFileDiffs).length} 个文件变更`);
  }
  return parts.length ? parts.join(" · ") : "查看执行过程";
}

function agentRunningHint(msg: ChatMessage): string {
  if (msg.streamChars && msg.streamChars > 0) return `${msg.streamChars} 字`;
  if (msg.agentDetail) return msg.agentDetail;
  if (msg.agentTurn && msg.agentMaxTurns) return `${msg.agentTurn}/${msg.agentMaxTurns}`;
  if (msg.agentTurn) return `第 ${msg.agentTurn} 轮`;
  return "运行中…";
}

function agentStatusDisplay(msg: ChatMessage): string {
  void agentUiTick.value;
  let statusText = "";
  if (msg.status) {
    if (
      msg.agentWaitStartedAt &&
      (msg.agentPhase === "waiting_model" ||
        msg.agentPhase === "sending_request" ||
        msg.agentPhase === "retrying_model") &&
      !msg.agentDetail
    ) {
      const elapsed = Math.max(0, Math.floor((Date.now() - msg.agentWaitStartedAt) / 1000));
      statusText = `${msg.status} · 已等待 ${elapsed}s`;
    } else {
      statusText = msg.status;
    }
  } else {
    statusText = msg.agentPhase ? formatAgentStatus({ phase: msg.agentPhase, detail: msg.agentDetail }, true) : "正在运行…";
  }
  
  // Append token usage info
  const tokenInfo: string[] = [];
  if (msg.streamChars && msg.streamChars > 0) {
    tokenInfo.push(`${msg.streamChars} 字输出`);
  }
  if (msg.contextChars && msg.contextChars > 0) {
    tokenInfo.push(`${formatCharCount(msg.contextChars)} 上下文`);
  }
  if (tokenInfo.length > 0) {
    statusText += ` · ${tokenInfo.join(" · ")}`;
  }
  
  return statusText;
}

function agentActiveModel(msg: ChatMessage): string {
  return msg.agentModel || msg.agentContext?.model || "";
}

function agentRoundGroupViews(msg: ChatMessage): AgentRoundGroupView[] {
  void agentUiTick.value;
  return buildAgentRoundGroupViews({
    roundGroups: msg.roundGroups,
    turnTraces: msg.turnTraces,
    statusLog: msg.statusLog,
    tools: msg.tools,
    activeTurn: isAgentRunning(msg) ? msg.agentTurn : undefined,
    activePhase: isAgentRunning(msg) ? msg.agentPhase : undefined,
  });
}

function userMessageImages(msg: ChatMessage): string[] {
  return resolveChatMessageImageUrls(
    projectPath.value.trim(),
    msg,
    activeSessionId.value || undefined,
  );
}

async function ensureProjectChatLoadedFromDisk(project: string, sessionId?: string): Promise<void> {
  if (!project.trim() || !projectChatNeedsDiskRestore(project, sessionId)) return;
  const diskStore = await fetchChatStoreFromDisk(project, { loadMessages: true });
  if (!diskStore.ok || !diskStore.data.sessions.length) return;
  restoreChatStoreFromSnapshot(diskStore.data);
}

async function applyChatMessageImageHydration(messages: PersistedChatMessage[]): Promise<ChatMessage[]> {
  const project = projectPath.value.trim();
  if (!project || !chatMessagesNeedImageHydration(messages)) {
    return normalizeChatMessages(messages);
  }
  const hydrated = await hydrateChatMessagesImages(project, messages);
  return normalizeChatMessages(hydrated);
}

function messageDisplayContent(msg: ChatMessage): string {
  if (msg.role === "user") {
    const text = stripReferenceAttachments(msg.content || "").trim();
    if (text) return text;
    if (userMessageImages(msg).length) return "";
    if (msg.imageCount && msg.imageCount > 0) return `（已发送 ${msg.imageCount} 张图片）`;
    return msg.content?.trim() || "";
  }
  if (canResumeAgentRun(msg)) return resolveAgentFailureBubbleContent(msg);
  return finalizeAssistantBubbleContent(msg);
}

function isRoundGroupComplete(msg: ChatMessage, group: AgentRoundGroupView): boolean {
  if (isAgentRunning(msg) && group.active) return false;
  if (group.tools.some((tool) => tool.running)) return false;
  return true;
}

function liveModelStepText(msg: ChatMessage, group: AgentRoundGroupView, step: { text: string; phase: string }): string {
  void agentUiTick.value;
  const base = cleanStatusLogText(step.text);
  if (!isActiveModelStep(group, step)) return base;
  if (msg.agentDetail?.trim()) return `${base} · ${msg.agentDetail.trim()}`;
  if (
    (step.phase === "waiting_model" || step.phase === "sending_request" || step.phase === "retrying_model") &&
    msg.agentWaitStartedAt
  ) {
    const elapsed = Math.max(0, Math.floor((Date.now() - msg.agentWaitStartedAt) / 1000));
    return `${base} · 已等待 ${elapsed}s`;
  }
  return base;
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
    if (target.closest('.quote-floating')) return;
    hideQuoteButtonNow();
  }
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
registerEscapeDismiss(
  () => Boolean(quotedMessage.value),
  () => {
    quotedMessage.value = null;
  },
  ESCAPE_DISMISS_PRIORITY.QUOTED_PREVIEW,
);

function startNewSession() {
  if (chatSending.value || !projectPath.value.trim()) return;
  persistChatNow();
  activeSessionId.value = "";
  chatMessages.value = [];
  chatError.value = "";
  refreshSessionList();
  activeSessionId.value = "";
  closeSessionPicker();
  void scrollChatToBottom(true);
  void nextTick(() => composerRef.value?.focus());
}

function switchSession(sessionId: string) {
  if (chatSending.value || !projectPath.value.trim()) return;
  if (sessionId === activeSessionId.value) {
    closeSessionPicker();
    return;
  }
  persistChatNow();
  const gen = ++switchSessionGeneration;
  switchingSession.value = true;
  void (async () => {
    try {
      const project = projectPath.value.trim();
      await ensureProjectChatLoadedFromDisk(project, sessionId);
      if (gen !== switchSessionGeneration) return;
      const messages = switchVibeChatSession(project, sessionId);
      chatMessages.value = normalizeChatMessages(messages);
      activeSessionId.value = sessionId;
      chatError.value = "";
      refreshSessionList();
      closeSessionPicker();
      maybeAutoResumeLastRecoverableAssistant();
      await scrollChatToBottom(true);
    } finally {
      if (gen === switchSessionGeneration) switchingSession.value = false;
    }
  })();
}

function debugLog(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  fetch("/backend/vibe/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "debug-copy.log", line }),
  }).catch(() => {});
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

async function syncChatStoreToDisk() {
  const path = projectPath.value.trim();
  if (!path || syncingChatStore.value) return;
  persistChatNow(path);
  syncingChatStore.value = true;
  chatError.value = "";
  chatStoreSyncMessage.value = "正在同步会话到本地...";
  try {
    const result = await syncChatStore(path, getVibeChatProjectSnapshot(path));
    if (!result.ok) {
      chatStoreSyncMessage.value = result.error || "同步会话到本地失败";
      return;
    }
      chatStoreSyncMessage.value = `已同步 ${result.sessionCount ?? sessionList.value.length} 条会话到 ${result.path || "本地目录"}`;
  } finally {
    syncingChatStore.value = false;
  }
}

function scheduleSyncChatStore(path: string) {
  if (syncStoreTimer) clearTimeout(syncStoreTimer);
  syncStoreTimer = setTimeout(() => {
    syncStoreTimer = null;
    void flushChatStoreToDisk(path, { quiet: true });
  }, SYNC_STORE_DEBOUNCE_MS);
}

function cancelPendingSync() {
  // 取消延迟的 sync
  if (syncStoreTimer) {
    clearTimeout(syncStoreTimer);
    syncStoreTimer = null;
  }
}

function persistChatNow(path = projectPath.value.trim(), options?: { flushStore?: boolean }) {
  if (!path) return;
  const isEmptyDraft = !activeSessionId.value && !chatMessages.value.length;
  const result = saveVibeChatHistory(path, chatMessages.value, activeSessionId.value);
  if (result.sessionId) activeSessionId.value = result.sessionId;
  refreshSessionList(path);
  const sessionId = result.sessionId;
  // 延迟执行，不阻塞后续操作
  setTimeout(() => {
    (async () => {
      if (sessionId) {
        const snapshot = getActiveSessionSnapshot(path, sessionId);
        if (snapshot) {
          await syncChatSession(path, sessionId, snapshot, { activeSessionId: activeSessionId.value || sessionId });
          if (activeSessionId.value === sessionId && projectPath.value.trim() === path) {
            chatMessages.value = normalizeChatMessages(
              stampImageRefsAfterSync(sessionId, chatMessages.value),
            );
          }
        }
      }
      if (options?.flushStore) {
        if (syncStoreTimer) {
          clearTimeout(syncStoreTimer);
          syncStoreTimer = null;
        }
        await flushChatStoreToDisk(path, { quiet: true });
      } else {
        scheduleSyncChatStore(path);
      }
    })();
  }, 100);
  if (isEmptyDraft) activeSessionId.value = "";
}

async function flushChatStoreToDisk(path: string, options?: { quiet?: boolean }) {
  if (!path || syncingChatStore.value) return;
  syncingChatStore.value = true;
  try {
    const result = await syncChatStore(path, getVibeChatProjectSnapshot(path));
    if (!result.ok) {
      if (!options?.quiet) {
        chatStoreSyncMessage.value = result.error || "同步会话到本地失败";
      } else {
        chatError.value = result.error || "会话未能写入项目目录，请检查后端服务是否运行";
      }
      return;
    }
    if (!options?.quiet) {
    chatStoreSyncMessage.value = `已同步 ${result.sessionCount ?? sessionList.value.length} 条会话到 ${result.path || "本地目录"}`;
    }
  } finally {
    syncingChatStore.value = false;
  }
}

function clearPendingPromptQueue() {
  pendingPromptQueue.value = [];
  persistPendingQueue();
}

function schedulePersistChat() {
  if (!projectPath.value.trim()) return;
  if (chatSending.value) return;
  if (saveChatTimer) clearTimeout(saveChatTimer);
  saveChatTimer = setTimeout(() => {
    saveChatTimer = null;
    persistChatNow();
  }, 400);
}

async function clearChat() {
  if (chatSending.value) return;
  if (chatMessages.value.length > 0) {
    const ok = await confirm("确定清空所有聊天记录？");
    if (!ok) return;
  }
  chatMessages.value = [];
  chatError.value = "";
  pendingPromptQueue.value = [];
  persistPendingQueue();
  if (projectPath.value.trim()) {
    clearVibeChatHistory(projectPath.value.trim());
    refreshSessionList();
  }
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

  if (chatSending.value) {
    interruptAgentRun();
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
    cancelPendingSync();
    if (saveChatTimer) {
      clearTimeout(saveChatTimer);
      saveChatTimer = null;
    }
    persistChatNow(previousPathForPersist, { flushStore: true });
  }
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
    let loaded = loadVibeChatHistory(normalized);
    log(`chat-load-local(${loaded.length}sessions)`);
    if (!loaded.length) {
      const diskStore = await fetchChatStoreFromDisk(normalized, { loadMessages: true });
      log(`chat-fetch-disk(${diskStore.ok ? "ok" : "fail"}, ${diskStore.ok ? diskStore.data.sessions.length : 0}sessions)`);
      if (diskStore.ok && diskStore.data.sessions.length) {
        restoreChatStoreFromSnapshot(diskStore.data);
        loaded = loadVibeChatHistory(normalized);
        log(`chat-after-restore(${loaded.length}sessions)`);
      }
    }
    log(`chat-done(${Math.round(performance.now() - tChat0)}ms)`);


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

    chatMessages.value = normalizeChatMessages(loaded);
    activeSessionId.value = getActiveVibeChatSessionId(normalized);
    refreshSessionList(normalized);
    log("set-chat");

    Promise.all([
      refreshGitStatus(),
      startFileWatcherForProject(normalized),
    ]).catch(() => {});

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

function onMessageSelect(event: MouseEvent, message: ChatMessage) {
  if (event.detail <= 1 && Date.now() - quoteHiddenAt < 150) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) {
    return;
  }

  const selectedText = selection.toString().trim();
  if (!selectedText) {
    return;
  }

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  
  pendingQuote.value = {
    messageId: message.id,
    content: selectedText,
    role: message.role,
  };
  
  const btnWidth = 70;
  const btnHeight = 28;
  const margin = 8;
  let x = rect.left + rect.width / 2 - btnWidth / 2;
  let y = rect.top - btnHeight - margin;
  if (y < margin) y = rect.bottom + margin;
  if (x < margin) x = margin;
  if (x + btnWidth > window.innerWidth - margin) x = window.innerWidth - btnWidth - margin;
  
  quoteButtonPosition.value = { x, y };
  
  showQuoteButton.value = true;
}

function quoteSelectedText() {
  if (!pendingQuote.value) return;
  
  quotedMessage.value = pendingQuote.value;
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

function hideQuoteButton() {
  setTimeout(() => {
    showQuoteButton.value = false;
  }, 200);
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

function patchAssistantMsg(msgId: string, patch: Partial<ChatMessage>) {
  const idx = chatMessages.value.findIndex((m) => m.id === msgId);
  if (idx < 0) return;
  chatMessages.value[idx] = { ...chatMessages.value[idx], ...patch };
}

function handleAgentEvent(event: VibeAgentSseEvent, assistantMsg: ChatMessage, runGen: number) {
  if (runGen !== agentRunGeneration) return;
  const msgId = assistantMsg.id;

  const isProgressEvent =
    event.type === "status" ||
    event.type === "turn_request" ||
    event.type === "turn_response" ||
    event.type === "turn_trace" ||
    event.type === "tool_start" ||
    event.type === "tool_end" ||
    event.type === "file_diff" ||
    event.type === "message_delta" ||
    event.type === "message" ||
    event.type === "agent_context" ||
    event.type === "error";
  if (isProgressEvent) touchAgentProgress();

  if (event.type === "agent_context") {
    assistantMsg.agentContext = event.data;
    patchAssistantMsg(msgId, { agentContext: event.data });
    return;
  }

  if (event.type === "turn_request") {
    assistantMsg.roundGroups = recordAgentRoundRequest(
      assistantMsg.roundGroups,
      event.data.turn,
      {
        model: event.data.model,
        contextMessages: event.data.contextMessages,
        contextChars: event.data.contextChars,
        messages: event.data.messages,
      },
      event.data.maxTurns,
    );
    patchAssistantMsg(msgId, syncRoundGroupsPatch(assistantMsg));
    if (isAgentRunning(assistantMsg)) scrollStatusLogToBottom(msgId);
    return;
  }

  if (event.type === "turn_response") {
    assistantMsg.roundGroups = recordAgentRoundResponse(
      assistantMsg.roundGroups,
      event.data.turn,
      {
        assistantText: event.data.assistantText,
        toolCalls: event.data.toolCalls,
        hasToolCalls: event.data.hasToolCalls,
        isFinal: event.data.isFinal,
      },
      event.data.maxTurns,
    );
    const turnText = stripToolSummaryFromAssistantContent(event.data.assistantText || "");
    if (turnText) {
      assistantMsg.content = mergeAssistantTurnText(assistantMsg.content || "", turnText);
    }
    assistantMsg.streaming = false;
    if (event.data.isFinal) {
      assistantMsg.agentPhase = undefined;
      assistantMsg.status = "";
    }
    patchAssistantMsg(msgId, {
      ...syncRoundGroupsPatch(assistantMsg),
      content: assistantMsg.content,
      streaming: assistantMsg.streaming,
      ...(event.data.isFinal ? { agentPhase: undefined, status: "" } : {}),
    });
    if (isAgentRunning(assistantMsg)) scrollStatusLogToBottom(msgId);
    return;
  }

  if (event.type === "turn_trace") {
    if (!assistantMsg.turnTraces) assistantMsg.turnTraces = [];
    assistantMsg.turnTraces.push({ ...event.data });
    assistantMsg.roundGroups = recordAgentRoundNarrative(
      assistantMsg.roundGroups,
      event.data.turn,
      event.data.assistantText,
      event.data.maxTurns,
    );
    patchAssistantMsg(msgId, {
      turnTraces: [...assistantMsg.turnTraces],
      ...syncRoundGroupsPatch(assistantMsg),
    });
    if (isAgentRunning(assistantMsg)) scrollStatusLogToBottom(msgId);
    return;
  }

  if (event.type === "status") {
    const { phase } = event.data;
    if (phase && !isAgentConnectPhase(phase)) {
      agentConnectStartedAt = 0;
    }
    const prevPhase = assistantMsg.agentPhase;
    setAgentStatus(assistantMsg, phase, event.data, { log: phase !== prevPhase });
    assistantMsg.roundGroups = recordAgentRoundStatus(
      assistantMsg.roundGroups,
      phase,
      assistantMsg.status || "",
      assistantMsg.agentTurn ?? event.data.turn,
      assistantMsg.agentMaxTurns ?? event.data.maxTurns,
    );
    patchAssistantMsg(msgId, {
      agentPhase: assistantMsg.agentPhase,
      status: assistantMsg.status,
      agentDetail: assistantMsg.agentDetail,
      streamChars: assistantMsg.streamChars,
      contextChars: assistantMsg.contextChars,
      agentWaitStartedAt: assistantMsg.agentWaitStartedAt,
      statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
      agentTurn: assistantMsg.agentTurn,
      agentMaxTurns: assistantMsg.agentMaxTurns,
      agentModel: assistantMsg.agentModel,
      ...syncRoundGroupsPatch(assistantMsg),
      ...(phase === "finished" ? { agentPhase: undefined, streaming: false, agentWaitStartedAt: undefined } : {}),
    });
    if (isAgentRunning(assistantMsg)) scrollStatusLogToBottom(msgId);
    if (phase === "aborted") {
      clearStreamDeltaBuffer();
      assistantMsg.agentAborted = true;
      const abortTurn = assistantMsg.agentTurn ?? 1;
      assistantMsg.roundGroups = recordAgentRoundResponse(
        assistantMsg.roundGroups,
        abortTurn,
        { assistantText: "", toolCalls: [], hasToolCalls: false, isFinal: false },
        assistantMsg.agentMaxTurns,
      );
      patchAssistantMsg(msgId, {
        agentAborted: true,
        ...syncRoundGroupsPatch(assistantMsg),
      });
      stopAgentUiTick();
      chatSending.value = false;
      // Update session status to interrupted
      if (activeSessionId.value && projectPath.value.trim()) {
        updateVibeChatSessionStatus(projectPath.value.trim(), activeSessionId.value, "interrupted");
      }
      persistChatNow();
      if (pendingPromptQueue.value.length) {
        const next = pendingPromptQueue.value.shift()!;
        persistPendingQueue();
        void runAgentTurn(next, { skipUserBubble: true });
      }
    }
    void scrollChatToBottom();
    return;
  }

  if (event.type === "tool_start") {
    if (!assistantMsg.tools) assistantMsg.tools = [];
    const meta = formatToolMeta(event.data.name, event.data.args);
    const toolTurn = assistantMsg.agentTurn ?? 1;
    assistantMsg.tools.push({
      id: event.data.id,
      ...meta,
      args: { ...event.data.args },
      summary: "",
      ok: true,
      running: true,
      turn: toolTurn,
    });
    assistantMsg.roundGroups = recordAgentRoundToolStart(assistantMsg.roundGroups, event.data.id, toolTurn);
    setAgentStatus(assistantMsg, "executing_tool", {
      toolTitle: meta.title,
      toolDetail: meta.detail,
      turn: assistantMsg.agentTurn,
      maxTurns: assistantMsg.agentMaxTurns,
    });
    patchAssistantMsg(msgId, {
      tools: [...assistantMsg.tools],
      status: assistantMsg.status,
      statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
      agentPhase: assistantMsg.agentPhase,
      ...syncRoundGroupsPatch(assistantMsg),
    });
    if (isAgentRunning(assistantMsg)) scrollStatusLogToBottom(msgId);
    void scrollChatToBottom();
    return;
  }

  if (event.type === "file_diff") {
    const relPath = event.data.path;
    const diff = { before: event.data.before, after: event.data.after, deleted: event.data.deleted, created: event.data.created };
    storeFileDiff(relPath, diff.before, diff.after, diff.deleted);
    if (!assistantMsg.turnFileDiffs) assistantMsg.turnFileDiffs = {};
    assistantMsg.turnFileDiffs[relPath] = diff;
    const normalizedPath = relPath.replace(/\\/g, "/");
    const writeStep = [...(assistantMsg.tools || [])].reverse().find((tool) => {
      if (tool.name !== "write_file") return false;
      const toolPath = String(tool.args?.path ?? tool.detail.split(" · ")[0] ?? "").replace(/\\/g, "/");
      return toolPath === normalizedPath;
    });
    if (writeStep) {
      writeStep.lineDelta = computeLineDelta(diff.before, diff.after, diff.created);
    }
    patchAssistantMsg(msgId, {
      turnFileDiffs: { ...assistantMsg.turnFileDiffs },
      tools: assistantMsg.tools ? [...assistantMsg.tools] : undefined,
    });
    void syncEditorAfterAgentFileChange(relPath, diff);
    void scrollChatToBottom();
    return;
  }

  if (event.type === "tool_end") {
    const step = assistantMsg.tools?.find((t) => t.id === event.data.id);
    if (step) {
      step.running = false;
      step.ok = event.data.ok;
      step.summary = event.data.summary;
      if (event.data.result) step.fullResult = event.data.result;
    }
    const pending = assistantMsg.tools?.some((t) => t.running);
    setAgentStatus(assistantMsg, pending ? "executing_tools" : "summarizing_tools", {
      turn: assistantMsg.agentTurn,
      maxTurns: assistantMsg.agentMaxTurns,
    });
    patchAssistantMsg(msgId, {
      tools: assistantMsg.tools ? [...assistantMsg.tools] : undefined,
      status: assistantMsg.status,
      statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
      agentPhase: assistantMsg.agentPhase,
    });
    if (isAgentRunning(assistantMsg)) scrollStatusLogToBottom(msgId);
    void scrollChatToBottom();
    return;
  }

  if (event.type === "message_delta") {
    const delta = event.data.delta || "";
    if (!delta) return;
    enqueueStreamDelta(msgId, assistantMsg, delta);
    return;
  }

  if (event.type === "message") {
    clearStreamDeltaBuffer();
    const cleanText = stripToolSummaryFromAssistantContent(event.data.text);
    assistantMsg.content = mergeAssistantTurnText(assistantMsg.content || "", cleanText);
    assistantMsg.streaming = false;
    assistantMsg.status = "";
    assistantMsg.agentPhase = undefined;
    patchAssistantMsg(msgId, {
      content: cleanText,
      streaming: false,
      status: "",
      agentPhase: undefined,
    });
    persistChatNow();
    void scrollChatToBottom();
    return;
  }

  if (event.type === "error") {
    clearStreamDeltaBuffer();
    stopAgentUiTick();
    agentLastProgressAt = 0;
    chatSending.value = false;
    if (trySilentContinue(assistantMsg, event.data.message)) {
      persistChatNow();
      void scrollChatToBottom();
      return;
    }
    applyRecoverableAgentFailure(assistantMsg, event.data.message);
    persistChatNow();
    void scrollChatToBottom();

    const recoverable = isRecoverableAgentError(event.data.message);
    if (!recoverable && pendingPromptQueue.value.length) {
      const next = pendingPromptQueue.value.shift()!;
      persistPendingQueue();
      void runAgentTurn(next, { skipUserBubble: true });
    }
    return;
  }

  if (event.type === "done") {
    clearStreamDeltaBuffer();
    stopAgentUiTick();
    agentLastProgressAt = 0;
    chatSending.value = false;
    agentAbortHandle = null;
    assistantMsg.streaming = false;
    clearPendingAgentRun();

    if (assistantMsg.agentFailed) {
      const completedTurns = resolveCompletedTurns(event.data.turns, assistantMsg);
      if (!assistantMsg.totalTurns) assistantMsg.totalTurns = completedTurns;
      patchAssistantMsg(msgId, {
        streaming: false,
        totalTurns: assistantMsg.totalTurns,
        ...syncRoundGroupsPatch(assistantMsg),
      });
      persistChatNow();
      void scrollChatToBottom();
      if (pendingPromptQueue.value.length) {
        const next = pendingPromptQueue.value.shift()!;
        persistPendingQueue();
        void runAgentTurn(next, { skipUserBubble: true });
      }
      return;
    }

    const completedTurns = resolveCompletedTurns(event.data.turns, assistantMsg);
    const wasAborted = !!assistantMsg.agentAborted;
    
    // Update session status to completed if agent completed successfully
    if (!wasAborted && !assistantMsg.agentFailed && activeSessionId.value && projectPath.value.trim()) {
      updateVibeChatSessionStatus(projectPath.value.trim(), activeSessionId.value, "completed");
    }
    const hasRunningTools = assistantMsg.tools?.some((t) => t.running);
    const hadProgress = hasRecoverableAgentProgress(assistantMsg);
    const incompleteRun =
      !wasAborted &&
      hadProgress &&
      (hasRunningTools || (completedTurns === 0 && event.data.turns === 0));
    const maxTurnsExhausted =
      !wasAborted &&
      !assistantMsg.agentFailed &&
      isAgentMaxTurnsExhausted(assistantMsg, completedTurns);

    if (incompleteRun) {
      if (trySilentContinue(assistantMsg, "连接中断（运行未完成）")) {
        if (!assistantMsg.totalTurns) {
          assistantMsg.totalTurns = resolveAgentCompletedTurns(assistantMsg);
        }
        patchAssistantMsg(msgId, {
          streaming: false,
          totalTurns: assistantMsg.totalTurns,
          ...syncRoundGroupsPatch(assistantMsg),
        });
        persistChatNow();
        void scrollChatToBottom();
        return;
      }
      handleRecoverableInterruption(assistantMsg, "连接中断（运行未完成）", { logStatus: true });
      if (!assistantMsg.totalTurns) {
        assistantMsg.totalTurns = resolveAgentCompletedTurns(assistantMsg);
      }
      patchAssistantMsg(msgId, {
        streaming: false,
        totalTurns: assistantMsg.totalTurns,
        ...syncRoundGroupsPatch(assistantMsg),
      });
      persistChatNow();
      void scrollChatToBottom();
      if (pendingPromptQueue.value.length) {
        const next = pendingPromptQueue.value.shift()!;
        persistPendingQueue();
        void runAgentTurn(next, { skipUserBubble: true });
      }
      return;
    }

    if (maxTurnsExhausted) {
      const reason = buildAgentMaxTurnsExhaustedMessage(assistantMsg.agentMaxTurns ?? completedTurns);
      if (trySilentContinue(assistantMsg, reason)) {
        assistantMsg.totalTurns = completedTurns;
        patchAssistantMsg(msgId, { totalTurns: completedTurns, ...syncRoundGroupsPatch(assistantMsg) });
        persistChatNow();
        void scrollChatToBottom();
        return;
      }
      handleRecoverableInterruption(assistantMsg, reason, { logStatus: true });
      assistantMsg.totalTurns = completedTurns;
      patchAssistantMsg(msgId, { totalTurns: completedTurns, ...syncRoundGroupsPatch(assistantMsg) });
      persistChatNow();
      void scrollChatToBottom();
      if (pendingPromptQueue.value.length) {
        const next = pendingPromptQueue.value.shift()!;
        persistPendingQueue();
        void runAgentTurn(next, { skipUserBubble: true });
      }
      return;
    }

    assistantMsg.totalTurns = completedTurns;
    appendStatusLog(
      assistantMsg,
      wasAborted ? `已停止（共 ${completedTurns} 轮）` : `完成（共 ${completedTurns} 轮）`,
    );

    const turnFileDiffPaths = assistantMsg.turnFileDiffs
      ? Object.keys(assistantMsg.turnFileDiffs)
      : [];
    const fileAction = resolveAgentDoneFileAction({
      chatMode: assistantMsg.chatMode ?? "build",
      wasAborted,
      serverPendingFiles: event.data.pendingFiles || [],
      serverWrittenFiles: event.data.writtenFiles || [],
      turnFileDiffPaths,
    });

    assistantMsg.pendingApproval = fileAction.pendingApproval;
    assistantMsg.writtenFiles = fileAction.writtenFiles;
    assistantMsg.agentFailed = false;
    assistantMsg.agentRecoverable = false;
    assistantMsg.agentFailureReason = undefined;
    assistantMsg.agentRecoveryDismissed = true;
    assistantMsg.agentContinueCount = undefined;

    assistantMsg.status = "";
    assistantMsg.agentPhase = undefined;
    assistantMsg.content = finalizeAssistantBubbleContent({
      ...assistantMsg,
      wasAborted,
      writtenFiles: fileAction.writtenFiles,
    });
    assistantMsg.activityExpanded = Boolean(assistantMsg.content?.trim());
    patchAssistantMsg(msgId, {
      status: "",
      agentPhase: undefined,
      streaming: false,
      activityExpanded: assistantMsg.activityExpanded,
      content: assistantMsg.content,
      totalTurns: assistantMsg.totalTurns,
      statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
      ...syncRoundGroupsPatch(assistantMsg),
      writtenFiles: assistantMsg.writtenFiles,
      pendingApproval: assistantMsg.pendingApproval,
      agentAborted: assistantMsg.agentAborted || undefined,
      agentFailed: undefined,
      agentRecoverable: undefined,
      agentFailureReason: undefined,
      agentRecoveryDismissed: true,
      agentContinueCount: undefined,
    });
    persistChatNow(undefined, { flushStore: true });

    if (fileAction.writtenFiles?.length) {
      if (assistantMsg.turnFileDiffs) {
        clearTurnFileDiffsFromStore(assistantMsg.turnFileDiffs);
      }
      void handleAgentWrittenFiles(fileAction.writtenFiles);
    }
    void scrollChatToBottom();

    if (pendingPromptQueue.value.length) {
      const next = pendingPromptQueue.value.shift()!;
      persistPendingQueue();
      void runAgentTurn(next, { skipUserBubble: true });
    }
  }
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

function clearTurnFileDiffsFromStore(turnFileDiffs: Record<string, FileDiff>) {
  const next = { ...fileDiffs.value };
  for (const relPath of Object.keys(turnFileDiffs)) {
    const fullPath = resolveFullPathFromRel(relPath);
    delete next[normalizePathKey(fullPath)];
  }
  fileDiffs.value = next;
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

function findRunningAssistantMsg(): ChatMessage | null {
  if (!chatSending.value) return null;
  const id = activeAssistantMsgId.value;
  if (!id) return null;
  return chatMessages.value.find((m) => m.id === id) ?? null;
}

function interruptAgentRun(options?: { logStatus?: boolean }) {
  cancelAutoResume();
  clearPendingAgentRun();
  agentRunGeneration += 1;
  agentLastProgressAt = 0;
  const running = findRunningAssistantMsg();
  if (running) {
    running.agentAborted = true;
    running.streaming = false;
    if (options?.logStatus !== false) {
      appendStatusLog(running, "已被新指令打断");
      setAgentStatus(running, "aborted", undefined, { log: false });
    }
    patchAssistantMsg(running.id, {
      agentAborted: true,
      streaming: false,
      status: running.status,
      statusLog: running.statusLog ? [...running.statusLog] : undefined,
    });
  }
  clearStreamDeltaBuffer();
  stopAgentUiTick();
  agentAbortHandle?.abort();
  agentAbortHandle = null;
  chatSending.value = false;
}

function stopAgent() {
  interruptAgentRun();
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

function editUserMessage(messageId: string) {
  if (chatSending.value) return;
  const userIdx = resolveUserMessageIndex(messageId);
  if (userIdx < 0) return;

  const userMsg = chatMessages.value[userIdx];
  const userText = stripReferenceAttachments(userMsg.content).trim();
  const images = userMsg.imageDataUrls?.filter(Boolean) ?? [];
  
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

function findLastAssistantContent(): string | undefined {
  return [...chatMessages.value].reverse().find((m) => m.role === "assistant" && m.content.trim())?.content;
}

function buildAgentHistory(
  currentPrompt: string,
  profile: ReturnType<typeof resolveAgentRunProfile>,
): VibeChatHistoryMessage[] {
  const base = buildAgentHistoryFromMessages(chatMessages.value);
  return shapeAgentHistoryForProfile(base, profile, currentPrompt);
}

function resolveCompletedTurns(reported: number, msg: ChatMessage): number {
  if (reported > 0) return reported;
  return resolveAgentCompletedTurns(msg);
}

function findLastUserMessage(): { content: string } | null {
  for (let i = chatMessages.value.length - 1; i >= 0; i -= 1) {
    const m = chatMessages.value[i];
    if (m.role === "user") return { content: m.content };
  }
  return null;
}

function tryResumeHmrInterruptedRun(): void {
  const pending = popPendingAgentRun();
  if (!pending) return;
  // 如果已经有活跃的 Agent 运行，不恢复
  if (chatSending.value || agentAbortHandle) return;
  // 如果项目路径不匹配，不恢复
  const currentProject = projectPath.value.trim();
  if (pending.projectPath && pending.projectPath !== currentProject) return;
  const prompt = (pending.request?.prompt as string) || "";
  if (!prompt) return;
  // 如果配置尚未就绪，不恢复
  if (!configReady.value || !projectOpened.value) return;

  // 恢复运行：显示提示并自动重发
  chatError.value = "检测到之前因页面刷新中断的 Agent 运行，正在恢复…";
  void runAgentTurn(prompt);
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

async function resumeAgentRun(assistantMsgId: string, options?: { silent?: boolean }) {
  cancelAutoResume();
  if (chatSending.value || !configReady.value || !projectOpened.value) return;

  const assistantIdx = chatMessages.value.findIndex((m) => m.id === assistantMsgId);
  if (assistantIdx < 0) return;

  const assistantMsg = chatMessages.value[assistantIdx];
  if (!options?.silent && !canResumeAgentRun(assistantMsg)) return;
  if (options?.silent && !hasRecoverableAgentProgress(assistantMsg)) return;

  const originalPrompt = resolveOriginalUserPrompt(assistantMsgId);
  if (!originalPrompt) return;

  const failureReason =
    assistantMsg.agentFailureReason ||
    inferAgentRecoveryFlags(assistantMsg)?.agentFailureReason ||
    "连接中断";
  const resumePrompt = buildAgentResumePrompt(assistantMsg, originalPrompt, failureReason);
  const mode = assistantMsg.chatMode ?? chatMode.value;
  const runProfile = resolveAgentResumeRunProfile(
    assistantMsg,
    originalPrompt,
    mode,
    findLastAssistantContent(),
  );

  reloadAiConfig();
  clearStreamDeltaBuffer();
  chatSending.value = true;
  chatError.value = "";
  resetChatScrollPin();
  startAgentUiTick();

  assistantMsg.agentFailed = false;
  assistantMsg.agentRecoverable = false;
  assistantMsg.agentFailureReason = undefined;
  assistantMsg.agentRecoveryDismissed = true;
  assistantMsg.agentAborted = false;
  assistantMsg.streaming = false;
  const resumedContent = resolveAssistantBubbleContent({ ...assistantMsg, content: "" });
  if (resumedContent) assistantMsg.content = resumedContent;
  assistantMsg.activityExpanded = true;
  assistantMsg.activityDetailed = true;
  assistantMsg.agentPhase = "connecting_local";
  assistantMsg.status = formatAgentStatus({ phase: "connecting_local" });
  appendStatusLog(
    assistantMsg,
    options?.silent
      ? `继续执行（自动续跑 ${assistantMsg.agentContinueCount ?? 1}/${AGENT_SILENT_CONTINUE_MAX}）…`
      : "正在恢复运行…",
  );
  assistantMsg.roundGroups = recordAgentRoundStatus(
    assistantMsg.roundGroups,
    "connecting_local",
    assistantMsg.status || "",
  );
  patchAssistantMsg(assistantMsgId, {
    agentFailed: false,
    agentRecoverable: false,
    agentFailureReason: undefined,
    agentRecoveryDismissed: true,
    content: assistantMsg.content,
    agentAborted: false,
    streaming: false,
    activityExpanded: true,
    activityDetailed: true,
    agentPhase: assistantMsg.agentPhase,
    status: assistantMsg.status,
    statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
    ...syncRoundGroupsPatch(assistantMsg),
  });
  persistChatNow();
  await scrollChatToBottom(true);

  const history = shapeAgentHistoryForProfile(
    buildAgentHistoryForResume(assistantMsgId),
    runProfile,
    resumePrompt,
  );

  agentAbortHandle?.abort();
  agentAbortHandle = null;
  const runGen = ++agentRunGeneration;
  agentAbortHandle = runVibeAgentSse(
    {
      prompt: resumePrompt,
      history,
      projectPath: projectPath.value.trim(),
      endpoint: aiConfig.value.endpoint,
      apiKey: aiConfig.value.apiKey,
      model: aiConfig.value.model,
      mode,
      maxTurns: resolveResumeMaxTurns(mode, runProfile, resolveAgentCompletedTurns(assistantMsg)),
      openFilePath: activeFilePath.value || undefined,
      runProfile: runProfile.kind === "execute_plan" ? runProfile : undefined,
    },
    (event) => handleAgentEvent(event, assistantMsg, runGen),
  );
}

async function runAgentTurn(
  userText: string,
  options?: {
    skipUserBubble?: boolean;
    resumeAssistantMsg?: ChatMessage;
    referencedFiles?: string[];
    imageDataUrls?: string[];
    userBubbleContent?: string;
  },
) {
  const rawPrompt = userText.trim();
  const project = projectPath.value.trim();
  const imageSources = options && 'imageDataUrls' in options
    ? (options.imageDataUrls ?? [])
    : await resolveImagesForAgentTurn(project, chatMessages.value);
  const compressedImages = imageSources.length
    ? await compressImageDataUrlsForAgent(imageSources)
    : undefined;
  const hasImages = Boolean(compressedImages?.length);
  if ((!rawPrompt && !hasImages) || !configReady.value || !projectOpened.value) return;

  agentConnectHasImages = hasImages;

  const lastAssistant = findLastAssistantContent();
  const mode = chatMode.value;
  const runProfile = resolveAgentRunProfile({
    prompt: rawPrompt,
    mode,
    lastAssistantContent: lastAssistant,
    referencedFiles: options?.referencedFiles,
  });
  const prompt = buildAgentPromptForProfile(
    enrichAgentUserPrompt(rawPrompt, {
      lastAssistantContent: lastAssistant,
      hasImages,
    }),
    runProfile,
  );

  reloadAiConfig();
  clearStreamDeltaBuffer();
  chatSending.value = true;
  chatError.value = "";
  resetChatScrollPin();
  startAgentUiTick();

  const history = buildAgentHistory(rawPrompt, runProfile);

  let assistantMsg: ChatMessage;
  if (options?.resumeAssistantMsg) {
    assistantMsg = options.resumeAssistantMsg;
  } else {
    if (!options?.skipUserBubble) {
      chatMessages.value.push({
        id: genId(),
        role: "user",
        content: options?.userBubbleContent ?? stripReferenceAttachments(rawPrompt),
        imageDataUrls: compressedImages?.length ? [...compressedImages] : undefined,
      });
    }
    assistantMsg = {
      id: genId(),
      role: "assistant",
      content: "",
      chatMode: mode,
      tools: [],
      roundGroups: [],
      activityExpanded: true,
      activityDetailed: true,
      agentPhase: "connecting_local",
      agentDetail: hasImages ? "上传图片中…" : undefined,
      status: formatAgentStatus({
        phase: "connecting_local",
        detail: hasImages ? "上传图片中…" : undefined,
      }),
    };
    chatMessages.value.push(assistantMsg);
    assistantMsg.roundGroups = recordAgentRoundStatus(
      assistantMsg.roundGroups,
      "connecting_local",
      assistantMsg.status || "",
    );
    persistChatNow();
    await scrollChatToBottom(true);
  }

  agentAbortHandle?.abort();
  agentAbortHandle = null;
  const runGen = ++agentRunGeneration;
  const agentRequest = {
    prompt,
    history,
    projectPath: projectPath.value.trim(),
    endpoint: aiConfig.value.endpoint,
    apiKey: aiConfig.value.apiKey,
    model: aiConfig.value.model,
    mode,
    maxTurns: resolveAgentMaxTurns(mode, runProfile),
    openFilePath: activeFilePath.value || undefined,
    runProfile: runProfile.kind === "execute_plan" ? runProfile : undefined,
    imageDataUrls: compressedImages?.length ? compressedImages : undefined,
  };
  // 持久化请求状态，以便 HMR 重载后恢复
  persistAgentRunForHmr({
    request: agentRequest as unknown as Record<string, unknown>,
    projectPath: agentRequest.projectPath,
    sessionId: activeSessionId.value || undefined,
  });
  agentAbortHandle = runVibeAgentSse(
    agentRequest,
    (event) => handleAgentEvent(event, assistantMsg, runGen),
  );
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

function handleAiOptionSelect(option: { index: number; label: string; fullText: string }) {
  const userText = option.fullText;
  if (!userText) return;

  if (chatSending.value) {
    chatMessages.value.push({
      id: genId(),
      role: "user",
      content: userText,
    });
    pendingPromptQueue.value.push(userText);
    persistPendingQueue();
    persistChatNow();
    void scrollChatToBottom(true);
    return;
  }

  void runAgentTurn(userText, { userBubbleContent: userText });
}

async function sendChat() {
  if (!canSendChat.value) return;
  const composer = composerRef.value;
  if (!composer) return;

  const payload = composer.extractPayload();
  composer.clear();
  mentionOpen.value = false;

  const userText = payload.text.trim();
  const imageDataUrls = payload.imageDataUrls.filter(Boolean);
  let fullPrompt = userText || (imageDataUrls.length ? "请结合附带的图片回答。" : "请结合引用的文件回答。");

  let bubbleText = userText;
  if (quotedMessage.value) {
    const prefix = quotedMessage.value.role === "assistant" ? "Agent" : "你";
    const quotedContent = `> ${prefix}: ${quotedMessage.value.content.replace(/\n/g, "\n> ")}`;
    fullPrompt = `${quotedContent}\n\n${fullPrompt}`;
    bubbleText = `${quotedContent}\n\n${userText}`;
    quotedMessage.value = null;
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
    pendingPromptQueue.value.push(fullPrompt);
    persistPendingQueue();
    persistChatNow();
    void scrollChatToBottom(true);
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
  copyText,
  editUserMessage,
  undoExchange,
  resendFromMessage,
  canResumeAgentRun,
  resumeAgentRun,
  isAssistantStalled,
  stopAgent,
  forceRecoverStalledRun,
  recoverableAgentErrorHint,
  hasAgentActivity,
  isAgentRunning,
  patchAssistantMsg,
  schedulePersistChat,
  messageDisplayContent,
  jumpChainToLatest,
  userMessageImages,
  shouldShowMessageBubble,
  handleAiOptionSelect,
  agentStatusDisplay,
  previewAgentFile,
  truncateDiffPreview,
  toggleExpandedDiff,
  isDiffExpanded,
} as VibeChatMessageContext);

onMounted(() => {
  reloadAiConfig();
  refreshProjectHistoryList();
  pendingPromptQueue.value = loadPendingQueue();
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
    if (chatSending.value && agentAbortHandle) {
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
  agentAbortHandle?.abort();
  clearStreamDeltaBuffer();
  stopResize();
  if (scrollChatRaf) cancelAnimationFrame(scrollChatRaf);
  if (saveChatTimer) clearTimeout(saveChatTimer);
  if (streamDeltaFlushTimer) clearTimeout(streamDeltaFlushTimer);
  if (streamScrollTimer) clearTimeout(streamScrollTimer);
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  if (mentionSearchTimer) clearTimeout(mentionSearchTimer);
  if (gitRefreshDebounceTimer) clearTimeout(gitRefreshDebounceTimer);
  stopAgentUiTick();
  clearRetryTimer();
  if (syncStoreTimer) {
    clearTimeout(syncStoreTimer);
    syncStoreTimer = null;
  }
  if (sessionCopyHintTimer) {
    clearTimeout(sessionCopyHintTimer);
    sessionCopyHintTimer = null;
  }
  cancelAutoResume();
  persistChatNow(undefined, { flushStore: true });
  stopFileWatcherForProject();
});
</script>

