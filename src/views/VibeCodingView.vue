<template>
  <div class="vibe-page">
    <div v-if="!isDesktopRuntime" class="vibe-web-banner" role="status">
      当前为浏览器预览：Agent / Git / 文件读写仅桌面版可用。请运行 <code>npm run dev</code> 启动 Tauri。
    </div>
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
      @open-folder-in-explorer="openCurrentFolderInExplorer"
      @test-notification="testNotification"
    />

    <main
      ref="workspaceRef"
      class="workspace"
      :class="{
        'no-project': !projectOpened,
        'editor-collapsed': editorCollapsed,
        'chat-collapsed': chatCollapsed,
        'file-panel-collapsed': filePanelCollapsed,
        'git-foreground': gitPanelInForeground,
      }"
    >
      <VibeWorkspaceWelcome
        :show="!projectOpened && !loadingTree"
        :loading-tree="loadingTree"
        :picking-folder="pickingFolder"
        :config-ready="configReady"
        :api-key-ready="apiKeyReady"
        @open-project="handleOpenProject"
        @open-ai-config="openAiConfigPage"
      />
      <FilePanel
        :file-panel-width="filePanelWidth"
        :loading-tree="loadingTree"
        :git-panel-mode="gitPanelMode"
        :project-panel-view="projectPanelView"
        :project-opened="projectOpened"
        :editor-collapsed="editorCollapsed"
        :chat-collapsed="chatCollapsed"
        :file-panel-collapsed="filePanelCollapsed"
        :git-change-count="gitChangeCount"
        :git-unstaged-files="gitUnstagedFiles"
        :git-staged-files="gitStagedFiles"
        :review-attention-count="reviewAttentionBadgeCount"
        :session-list="sessionList"
        :active-session-id="activeSessionId"
        :session-sending-ids="sendingSessionIdList"
        :syncing-chat-store="syncingChatStore"
        :chat-store-sync-message="chatStoreSyncMessage"
        @update:git-panel-mode="gitPanelMode = $event"
        @update:project-panel-view="projectPanelView = $event"
        @open-quick-search="openQuickSearch"
        @create-new-file="createNewFile"
        @create-new-folder="createNewFolder"
        @collapse-all-dirs="collapseAllDirs"
        @expand-editor="expandEditor"
        @expand-chat="expandChat"
        @collapse-file-panel="collapseFilePanel"
        @expand-file-panel="expandFilePanel"
        @refresh-git-status="refreshGitStatus(gitStatusKnown ? { showLoading: false } : undefined)"
        @switch-session="handleSwitchSession"
        @remove-session="removeSession"
        @start-new-session="handleStartNewSession"
        @copy-session-info="copySessionInfo"
        @copy-session-name-path="copySessionNamePath"
        @sync-chat-store-to-disk="syncChatStoreToDisk"
      >

        <GitPanel
          v-if="gitPanelMode === 'git' && !gitPanelInForeground"
          :project-opened="projectOpened"
          :git-loading="gitLoading"
          :git-is-repo="gitIsRepo"
          :git-status-known="gitStatusKnown"
          :git-repos="gitRepos"
          :git-active-repo-path="gitActiveRepoPath || projectPath"
          :git-head-commit="gitHeadCommit"
          :git-error="gitError"
          :git-secondary-hint="gitSecondaryHint"
          :git-branch="gitBranch"
          :git-branches="gitBranches"
          :git-tracking-branch="gitTrackingBranch"
          :git-remotes="gitRemotes"
          :git-selected-remote="gitSelectedRemote"
          :git-ahead="gitAhead"
          :git-behind="gitBehind"
          :git-staged-count="gitStagedFiles.length"
          :git-unstaged-count="gitUnstagedFiles.length"
          :git-conflict-count="gitConflictedFiles.length"
          :git-log-author-filter="gitLogAuthorFilter"
          :git-log-branch-filter="gitLogBranchFilter"
          :git-log-path-filter="gitLogPathFilter"
          :git-log-since="gitLogSince"
          :git-log-until="gitLogUntil"
          :git-stashes="gitStashes"
          :git-status="gitStatus"
          :git-staged-files="gitStagedFiles"
          :git-unstaged-files="gitUnstagedFiles"
          :git-conflicted-files="gitConflictedFiles"
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
          :git-untracked-open="gitUntrackedOpen"
          :git-log-open="gitLogOpen"
          :git-log-entries="gitLogEntries"
          :git-log-search-query="gitLogSearchQuery"
          :git-log-all-branches="gitLogAllBranches"
          :has-more-git-log="hasMoreGitLog"
          :git-log-loading-more="gitLogLoadingMore"
          :git-log-search-loading="gitLogSearchLoading"
          :selected-git-files="selectedGitFiles"
          :git-diff-loading-key="gitDiffLoadingKey"
          :git-remote-action="gitRemoteAction"
          :config-ready="configReady"
          :file-watcher-active="fileWatcherActive"
          :file-watcher-connected="fileWatcherConnected"
          :expanded-git-log-entries="expandedGitLogEntries"
          :batch-groups="batchGroups"
          :batch-groups-from-ai="batchGroupsFromAi"
          :batch-messages="batchMessages"
          :batch-section-open="batchSectionOpen"
          :batch-committing-index="batchCommittingIndex"
          :ai-batch-grouping="aiBatchGrouping"
          :ai-batch-grouping-step="aiBatchGroupingStep"

          :git-ahead-commits="gitAheadCommits"
          :git-ahead-commits-open="gitAheadCommitsOpen"
          :git-ahead-commits-loading="gitAheadCommitsLoading"
          :git-behind-commits="gitBehindCommits"
          :git-behind-commits-open="gitBehindCommitsOpen"
          :git-behind-commits-loading="gitBehindCommitsLoading"
          :git-stash-section-open="gitStashSectionOpen"
          :git-local-changes-open="gitLocalChangesOpen"
          :git-ignored-local-files="gitIgnoredLocalFiles"
          :git-ignored-local-open="gitIgnoredLocalOpen"
          :git-advanced-open="gitAdvancedOpen"
          :git-advanced-action="gitAdvancedAction"
          :git-merge-in-progress="gitMergeInProgress"
          :git-rebase-in-progress="gitRebaseInProgress"
          :git-merge-target="gitMergeTarget"
          :git-rebase-onto="gitRebaseOnto"
          :git-tag-name-input="gitTagNameInput"
          :git-tags="gitTags"
          :git-submodules="gitSubmodules"
          @refresh="refreshGitStatus()"
          @switch-git-repo="switchGitRepo"
          @do-fetch="doFetch"
          @do-pull="doPull"
          @do-push="doPush"
          @open-remote="openGitRemote"
          @commit-git="commitGit"
          @generate-commit-message="generateCommitMessage"
          @ai-commit-and-push="aiCommitAndPush"
          @stage-file="stageFile"
          @unstage-file="unstageFile"
          @stage-dir="stageDir"
          @unstage-dir="unstageDir"
          @discard-dir="discardDir"
          @stage-all="stageAll"
          @stage-untracked="stageUntracked"
          @unstage-all="unstageAll"
          @stage-selected="stageSelectedFiles"
          @unstage-selected="unstageSelectedFiles"
          @discard-selected="discardSelectedFiles"
          @stage-selected-with="stageSelectedWith"
          @unstage-selected-with="unstageSelectedWith"
          @discard-selected-with="discardSelectedWith"
          @clear-selection="clearGitSelection"
          @discard-file="discardFile"
          @discard-all="discardAll"
          @unignore-file="unignoreSelectedFiles"
          @resolve-conflict="resolveConflict"
          @open-conflict-file="openConflictFile"
          @do-stash-save="doStashSave"
          @do-stash-apply="doStashApply"
          @do-stash-pop="doStashPop"
          @do-stash-drop="doStashDrop"
          @update:git-stash-open="gitStashOpen = $event"
          @update:git-staged-open="gitStagedOpen = $event"
          @update:git-unstaged-open="gitUnstagedOpen = $event"
          @update:git-untracked-open="gitUntrackedOpen = $event"
          @update:git-log-open="gitLogOpen = $event"
          @update:git-log-all-branches="setGitLogAllBranches"
          @update:git-log-branch-filter="setGitLogBranchFilter"
          @update-git-log-filters="setGitLogFilters"
          @load-more-git-log="loadMoreGitLog"
          @search-git-log="searchGitLog"
          @update:git-ahead-commits-open="gitAheadCommitsOpen = $event"
          @update:git-behind-commits-open="gitBehindCommitsOpen = $event"
          @update:git-stash-section-open="gitStashSectionOpen = $event"
          @update:git-local-changes-open="gitLocalChangesOpen = $event"
          @update:git-ignored-local-open="gitIgnoredLocalOpen = $event"
          @update:git-commit-message="gitCommitMessage = $event"
          @update:git-stash-message="gitStashMessage = $event"
          @toggle-git-log-entry="toggleGitLogEntry"
          @open-git-log-file="openGitLogFile"
          @reset-to-commit="(hash, mode, shortHash, event) => doResetCommit(hash, mode, shortHash, event)"
          @do-merge="doMerge"
          @do-merge-abort="doMergeAbort"
          @do-rebase="doRebase"
          @do-rebase-abort="doRebaseAbort"
          @do-cherry-pick="doCherryPick"
          @do-revert-commit="doRevertCommit"
          @do-create-tag="doCreateTag"
          @do-create-tag-at="(hash, event) => doCreateTag(undefined, hash, event)"
          @do-create-branch-at="doCreateBranchAt"
          @do-delete-tag="doDeleteTag"
          @do-submodule-update="doSubmoduleUpdate"
          @update:git-selected-remote="gitSelectedRemote = $event"
          @update:git-advanced-open="gitAdvancedOpen = $event"
          @update:git-merge-target="gitMergeTarget = $event"
          @update:git-rebase-onto="gitRebaseOnto = $event"
          @update:git-tag-name-input="gitTagNameInput = $event"
          @on-git-file-pointer-down="onGitFilePointerDown"
          @on-git-file-contextmenu="onGitFileContextMenu"
          @commit-batch-group="commitBatchGroup"
          @commit-all-batches="commitAllBatches"
          @ai-batch-groups="generateAiBatchGroups"
          @update:batch-messages="batchMessages = $event"
          @update:batch-section-open="batchSectionOpen = $event"
          @checkout-branch="(name) => checkoutBranch(name)"
          @create-branch="createBranch"
          @delete-branch="deleteBranch"
          @focus-git-panel="focusGitPanel"
          @open-file="openFile"
        />

        <div v-if="gitPanelMode === 'files' && !projectOpened" class="panel-empty">
          <span class="panel-empty-icon" aria-hidden="true">📁</span>
          <p class="panel-empty-title">尚未打开项目</p>
          <p class="panel-empty-hint">点击欢迎页或顶部「打开项目」选择文件夹</p>
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

        <KnowledgePanel
          v-else-if="gitPanelMode === 'project' && projectPanelView === 'knowledge'"
          layout="sidebar"
          :project-opened="projectOpened"
          :config-ready="configReady"
          :api-key-ready="apiKeyReady"
          :has-knowledge="knowledgeHasContent"
          :knowledge-draft="knowledgeDraft"
          :knowledge-meta="knowledgeMeta"
          :knowledge-loading="knowledgeLoading"
          :knowledge-saving="knowledgeSaving"
          :knowledge-message="knowledgeMessage"
          :editing="knowledgeEditing"
          :display-body="knowledgeDisplayBody"
          :saved-body="knowledgeBody"
          :current-git-head="gitHeadCommit"
          :explore-run="knowledgeExploreRun"
          :knowledge-changed-files="knowledgeChangedFiles"
          :knowledge-changes-loading="knowledgeChangesLoading"
          :knowledge-changes-available="knowledgeChangesAvailable"
          @start-explore="(depth) => void startKnowledgeExplore(depth)"
          @continue-explore="() => void continueKnowledgeExplore()"
          @explore-changes="() => void exploreKnowledgeChanges()"
          @stop-explore="stopKnowledgeExplore"
          @begin-edit="beginKnowledgeEdit"
          @cancel-edit="cancelKnowledgeEdit"
          @save-draft="() => void saveKnowledgeDraft()"
          @follow-up="(text) => void sendKnowledgeFollowUp(text)"
          @open-file="openKnowledgeFile"
          @open-source="openKnowledgeSourceFile"
          @expand-chat="expandChat"
          @update:draft="knowledgeDraft = $event"
        />

        <ProjectArchitectReviewPanel
          v-else-if="gitPanelMode === 'project' && projectPanelView === 'health'"
          :project-opened="projectOpened"
          :review-ready="configReady && apiKeyReady"
          :review-loading="reviewLoading"
          :review-message="reviewMessage"
          :has-review="reviewHasContent"
          :review-meta="reviewMeta"
          :review-verdict="reviewVerdict"
          :review-run="reviewRun"
          :changed-file-count="reviewContext?.changedFiles?.length ?? 0"
          :commit-count="reviewContext?.recentCommits?.length ?? 0"
          :review-history="reviewHistory"
          :review-history-loading="reviewHistoryLoading"
          :review-history-detail-loading="reviewHistoryDetailLoading"
          :review-history-message="reviewHistoryMessage"
          :active-history-review="activeHistoryReview"
          @start-review="() => void startArchitectReview()"
          @stop-review="stopArchitectReview"
          @open-source="openArchitectReviewSourceFile"
          @load-history="() => void loadReviewHistory()"
          @view-history="(entry) => void viewHistoryReview(entry)"
          @delete-history="(entry, event) => void deleteHistoryReview(entry, event)"
          @clear-history-view="clearHistoryReview"
        />

        <ProjectCodeMapPanel
          v-else-if="gitPanelMode === 'project' && projectPanelView === 'map'"
          :project-opened="projectOpened"
          :has-document="codeMapHasDocument"
          :loading="codeMapLoading"
          :building="codeMapBuilding"
          :annotating="codeMapAnnotating"
          :message="codeMapMessage"
          :error="codeMapError"
          :generated-at-label="codeMapGeneratedAtLabel"
          :node-count="codeMapDocument?.nodes.length ?? 0"
          :edge-count="codeMapDocument?.edges.length ?? 0"
          :truncated-count="codeMapDocument?.truncatedCount ?? 0"
          :annotate-enabled="codeMapAnnotateEnabled"
          :annotate-ready="configReady && apiKeyReady"
          :is-stale="codeMapIsStale"
          @update:annotate-enabled="codeMapAnnotateEnabled = $event"
          @generate="() => void generateCodeMap()"
          @annotate="() => void runCodeMapAnnotate(undefined, { force: true })"
          @reset-layout="() => void resetCodeMapLayout()"
        />

      </FilePanel>

      <div
        v-show="projectOpened && !filePanelCollapsed"
        class="resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整文件面板宽度"
        tabindex="0"
        @mousedown="startResize('file', $event)"
        @keydown="onResizeKeydown('file', $event)"
      ></div>

      <EditorPanel
        v-if="openTabs.length > 0 && !planPanelInForeground && !gitPanelInForeground && (gitPanelMode !== 'project' || (projectPanelView !== 'knowledge' && projectPanelView !== 'health' && projectPanelView !== 'fix' && projectPanelView !== 'map'))"
        ref="editorPanelRef"
        :active-file-path="activeFilePath"
        :file-content="fileContent"
        :file-dirty="fileDirty"
        :file-load-error="fileLoadError"
        :active-file-diff="activeFileDiff"
        :active-file-read-only="activeFileReadOnly"
        :show-diff-mode="showDiffMode"
        :open-tabs="openTabs"
        :parent-editor-collapsed="editorCollapsed"
        :chat-collapsed="chatCollapsed"
        :can-go-back="canGoBack"
        :can-go-forward="canGoForward"
        :hunk-action-mode="editorHunkActionMode"
        :hunk-actions="editorHunkActions"
        :hunk-busy-index="editorHunkBusyIndex"
        @update:file-content="fileContent = $event"
        @switch-tab="switchTab"
        @close-tab="closeTab"
        @toggle-diff-mode="toggleDiffMode"
        @open-source-file="onOpenSourceFile"
        @save-file="onSaveFile"
        @reload-file="reloadFile"
        @collapse-editor="collapseEditor"
        @expand-chat="expandChat"
        @editor-change="onEditorChange"
        @editor-select="onEditorSelect"
        @hunk-action="onEditorHunkAction"
        @reorder-tabs="({ fromIndex, toIndex }) => reorderTabs(fromIndex, toIndex)"
        @close-other-tabs="closeOtherTabs"
        @close-right-tabs="closeRightTabs"
        @close-all-tabs="closeAllTabs"
        @navigate-back="navigateBack"
        @navigate-forward="navigateForward"
        @new-scratch="() => void openScratchTab()"
      />

      <section
        v-show="gitPanelMode === 'project' && projectPanelView === 'knowledge' && projectOpened && !planWorkspaceOpen"
        class="editor-panel knowledge-main-panel"
        aria-label="项目知识库"
      >
        <KnowledgePanel
          layout="main"
          :chat-collapsed="chatCollapsed"
          :project-opened="projectOpened"
          :config-ready="configReady"
          :api-key-ready="apiKeyReady"
          :has-knowledge="knowledgeHasContent"
          :knowledge-draft="knowledgeDraft"
          :knowledge-meta="knowledgeMeta"
          :knowledge-loading="knowledgeLoading"
          :knowledge-saving="knowledgeSaving"
          :knowledge-message="knowledgeMessage"
          :editing="knowledgeEditing"
          :display-body="knowledgeDisplayBody"
          :saved-body="knowledgeBody"
          :current-git-head="gitHeadCommit"
          :explore-run="knowledgeExploreRun"
          :knowledge-changed-files="knowledgeChangedFiles"
          :knowledge-changes-loading="knowledgeChangesLoading"
          :knowledge-changes-available="knowledgeChangesAvailable"
          @start-explore="(depth) => void startKnowledgeExplore(depth)"
          @continue-explore="() => void continueKnowledgeExplore()"
          @explore-changes="() => void exploreKnowledgeChanges()"
          @stop-explore="stopKnowledgeExplore"
          @begin-edit="beginKnowledgeEdit"
          @cancel-edit="cancelKnowledgeEdit"
          @save-draft="() => void saveKnowledgeDraft()"
          @follow-up="(text) => void sendKnowledgeFollowUp(text)"
          @open-file="openKnowledgeFile"
          @open-source="openKnowledgeSourceFile"
          @expand-chat="expandChat"
          @update:draft="knowledgeDraft = $event"
        />
      </section>

      <section
        v-show="gitPanelMode === 'project' && projectPanelView === 'health' && projectOpened && !planWorkspaceOpen"
        class="editor-panel knowledge-main-panel"
        aria-label="项目架构评审"
      >
        <ArchitectReviewMainPanel
          :chat-collapsed="chatCollapsed"
          :has-review="reviewHasContent"
          :review-loading="reviewLoading"
          :review-message="reviewMessage"
          :display-body="reviewDisplayBody"
          :review-verdict="reviewVerdict"
          :review-run="reviewRun"
          :review-history-detail-loading="reviewHistoryDetailLoading"
          @open-source="openArchitectReviewSourceFile"
          @expand-chat="expandChat"
        />
      </section>

      <section
        v-show="gitPanelMode === 'project' && projectPanelView === 'map' && projectOpened && !planWorkspaceOpen"
        class="editor-panel knowledge-main-panel"
        aria-label="项目架构图"
      >
        <CodeMapMainPanel
          :chat-collapsed="chatCollapsed"
          :document="codeMapDocument"
          :positions="codeMapPositions"
          :collapsed-ids="codeMapCollapsedIds"
          :selected-node-id="codeMapSelectedNodeId"
          :selected-node="codeMapSelectedNode"
          :related-edges="codeMapRelatedEdges"
          :has-document="codeMapHasDocument"
          :loading="codeMapLoading"
          :building="codeMapBuilding"
          :annotating="codeMapAnnotating"
          :message="codeMapMessage"
          :error="codeMapError"
          :generated-at-label="codeMapGeneratedAtLabel"
          :layout-epoch="codeMapLayoutEpoch"
          :focus-node-id="codeMapFocusNodeId"
          :focus-epoch="codeMapFocusEpoch"
          :is-stale="codeMapIsStale"
          @select="selectCodeMapNode"
          @toggle-collapse="toggleCodeMapCollapsed"
          @node-moved="updateCodeMapPosition"
          @open-file="openCodeMapFile"
          @explain-node="explainCodeMapNode"
          @reset-layout="() => void resetCodeMapLayout()"
          @export-mermaid="exportCodeMapMermaid"
          @export-svg="() => void exportCodeMapAsSvg()"
          @expand-chat="expandChat"
          @generate="() => void generateCodeMap()"
        />
      </section>

      <section
        v-show="gitPanelMode === 'project' && projectPanelView === 'fix' && projectOpened && !planWorkspaceOpen"
        class="editor-panel knowledge-main-panel"
        aria-label="测试修复"
      >
        <AutoBugFixPanel
          :project-opened="projectOpened"
          :phase="autoBugFixPhase"
          :running="autoBugFixRunning"
          :error="autoBugFixError"
          :scan-result="autoBugFixScan"
          :verify-result="autoBugFixVerify"
          :baseline-verify="autoBugFixBaselineVerify"
          :post-fix-verify="autoBugFixPostFixVerify"
          :verify-comparison="autoBugFixVerifyComparison"
          :last-summary="autoBugFixSummary"
          v-model:include-warnings="autoBugFixIncludeWarnings"
          v-model:include-logic-review="autoBugFixIncludeLogicReview"
          :show-resume="autoBugFixShowResume"
          :show-stop="autoBugFixCanStop"
          :interrupted-hint="autoBugFixInterruptedHint"
          @start="() => void startAutoBugFixFlow({ includeWarnings: autoBugFixIncludeWarnings, includeLogicReview: autoBugFixIncludeLogicReview })"
          @scan-only="() => void runAutoBugFixScanOnly()"
          @verify-only="() => void runAutoBugFixVerifyOnly()"
          @open-git="openGitPanelFromAutoFix"
          @resume-agent="resumeAutoBugFixFromPanel"
          @stop-fix="stopAutoBugFixFromPanel"
        />
      </section>

      <section
        ref="planPanelSectionRef"
        v-show="planWorkspaceOpen && projectOpened && (openTabs.length === 0 || planPanelInForeground)"
        class="editor-panel plan-main-panel"
        aria-label="修改方案"
        @mouseup="onPlanPanelMouseUp"
        @dblclick="onPlanPanelDoubleClick"
      >
        <PlanMainPanel
          :content="planPanelContent"
          :streaming="planPanelStreaming"
          :plan-file-path="planPanelFilePath"
          :can-execute="planPanelCanExecute"
          :chat-collapsed="chatCollapsed"
          @execute="executePlanFromMessage(planPanelMessageId)"
          @close="closePlanPanel()"
          @open-plan-file="openPlanFileInEditor(planPanelFilePath)"
          @expand-chat="expandChat"
          @content-scroll="hideQuoteButtonNow"
        />
      </section>

      <section
        v-show="gitPanelInForeground && projectOpened"
        class="editor-panel git-foreground-panel"
        aria-label="Git 聚焦"
      >
        <div class="git-foreground-header">
          <button type="button" class="ghost tiny" @click="closeGitPanel()" title="退出 Git 聚焦 (Esc)">
            ← 返回编辑器
          </button>
          <span class="git-foreground-title">Git 变更</span>
        </div>
        <GitPanel
          :project-opened="projectOpened"
          :git-loading="gitLoading"
          :git-is-repo="gitIsRepo"
          :git-status-known="gitStatusKnown"
          :git-repos="gitRepos"
          :git-active-repo-path="gitActiveRepoPath || projectPath"
          :git-head-commit="gitHeadCommit"
          :git-error="gitError"
          :git-secondary-hint="gitSecondaryHint"
          :git-branch="gitBranch"
          :git-branches="gitBranches"
          :git-tracking-branch="gitTrackingBranch"
          :git-remotes="gitRemotes"
          :git-selected-remote="gitSelectedRemote"
          :git-ahead="gitAhead"
          :git-behind="gitBehind"
          :git-staged-count="gitStagedFiles.length"
          :git-unstaged-count="gitUnstagedFiles.length"
          :git-conflict-count="gitConflictedFiles.length"
          :git-log-author-filter="gitLogAuthorFilter"
          :git-log-branch-filter="gitLogBranchFilter"
          :git-log-path-filter="gitLogPathFilter"
          :git-log-since="gitLogSince"
          :git-log-until="gitLogUntil"
          :git-stashes="gitStashes"
          :git-status="gitStatus"
          :git-staged-files="gitStagedFiles"
          :git-unstaged-files="gitUnstagedFiles"
          :git-conflicted-files="gitConflictedFiles"
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
          :git-untracked-open="gitUntrackedOpen"
          :git-log-open="gitLogOpen"
          :git-log-entries="gitLogEntries"
          :git-log-search-query="gitLogSearchQuery"
          :git-log-all-branches="gitLogAllBranches"
          :has-more-git-log="hasMoreGitLog"
          :git-log-loading-more="gitLogLoadingMore"
          :git-log-search-loading="gitLogSearchLoading"
          :selected-git-files="selectedGitFiles"
          :git-diff-loading-key="gitDiffLoadingKey"
          :git-remote-action="gitRemoteAction"
          :config-ready="configReady"
          :file-watcher-active="fileWatcherActive"
          :file-watcher-connected="fileWatcherConnected"
          :expanded-git-log-entries="expandedGitLogEntries"
          :batch-groups="batchGroups"
          :batch-groups-from-ai="batchGroupsFromAi"
          :batch-messages="batchMessages"
          :batch-section-open="batchSectionOpen"
          :batch-committing-index="batchCommittingIndex"
          :ai-batch-grouping="aiBatchGrouping"
          :ai-batch-grouping-step="aiBatchGroupingStep"

          :git-ahead-commits="gitAheadCommits"
          :git-ahead-commits-open="gitAheadCommitsOpen"
          :git-ahead-commits-loading="gitAheadCommitsLoading"
          :git-behind-commits="gitBehindCommits"
          :git-behind-commits-open="gitBehindCommitsOpen"
          :git-behind-commits-loading="gitBehindCommitsLoading"
          :git-stash-section-open="gitStashSectionOpen"
          :git-local-changes-open="gitLocalChangesOpen"
          :git-ignored-local-files="gitIgnoredLocalFiles"
          :git-ignored-local-open="gitIgnoredLocalOpen"
          :git-advanced-open="gitAdvancedOpen"
          :git-advanced-action="gitAdvancedAction"
          :git-merge-in-progress="gitMergeInProgress"
          :git-rebase-in-progress="gitRebaseInProgress"
          :git-merge-target="gitMergeTarget"
          :git-rebase-onto="gitRebaseOnto"
          :git-tag-name-input="gitTagNameInput"
          :git-tags="gitTags"
          :git-submodules="gitSubmodules"
          @refresh="refreshGitStatus()"
          @switch-git-repo="switchGitRepo"
          @do-fetch="doFetch"
          @do-pull="doPull"
          @do-push="doPush"
          @open-remote="openGitRemote"
          @commit-git="commitGit"
          @generate-commit-message="generateCommitMessage"
          @ai-commit-and-push="aiCommitAndPush"
          @stage-file="stageFile"
          @unstage-file="unstageFile"
          @stage-dir="stageDir"
          @unstage-dir="unstageDir"
          @discard-dir="discardDir"
          @stage-all="stageAll"
          @stage-untracked="stageUntracked"
          @unstage-all="unstageAll"
          @stage-selected="stageSelectedFiles"
          @unstage-selected="unstageSelectedFiles"
          @discard-selected="discardSelectedFiles"
          @stage-selected-with="stageSelectedWith"
          @unstage-selected-with="unstageSelectedWith"
          @discard-selected-with="discardSelectedWith"
          @clear-selection="clearGitSelection"
          @discard-file="discardFile"
          @discard-all="discardAll"
          @unignore-file="unignoreSelectedFiles"
          @resolve-conflict="resolveConflict"
          @open-conflict-file="openConflictFile"
          @do-stash-save="doStashSave"
          @do-stash-apply="doStashApply"
          @do-stash-pop="doStashPop"
          @do-stash-drop="doStashDrop"
          @update:git-stash-open="gitStashOpen = $event"
          @update:git-staged-open="gitStagedOpen = $event"
          @update:git-unstaged-open="gitUnstagedOpen = $event"
          @update:git-untracked-open="gitUntrackedOpen = $event"
          @update:git-log-open="gitLogOpen = $event"
          @update:git-log-all-branches="setGitLogAllBranches"
          @update:git-log-branch-filter="setGitLogBranchFilter"
          @update-git-log-filters="setGitLogFilters"
          @load-more-git-log="loadMoreGitLog"
          @search-git-log="searchGitLog"
          @update:git-ahead-commits-open="gitAheadCommitsOpen = $event"
          @update:git-behind-commits-open="gitBehindCommitsOpen = $event"
          @update:git-stash-section-open="gitStashSectionOpen = $event"
          @update:git-local-changes-open="gitLocalChangesOpen = $event"
          @update:git-ignored-local-open="gitIgnoredLocalOpen = $event"
          @update:git-commit-message="gitCommitMessage = $event"
          @update:git-stash-message="gitStashMessage = $event"
          @toggle-git-log-entry="toggleGitLogEntry"
          @open-git-log-file="openGitLogFile"
          @reset-to-commit="(hash, mode, shortHash, event) => doResetCommit(hash, mode, shortHash, event)"
          @do-merge="doMerge"
          @do-merge-abort="doMergeAbort"
          @do-rebase="doRebase"
          @do-rebase-abort="doRebaseAbort"
          @do-cherry-pick="doCherryPick"
          @do-revert-commit="doRevertCommit"
          @do-create-tag="doCreateTag"
          @do-create-tag-at="(hash, event) => doCreateTag(undefined, hash, event)"
          @do-create-branch-at="doCreateBranchAt"
          @do-delete-tag="doDeleteTag"
          @do-submodule-update="doSubmoduleUpdate"
          @update:git-selected-remote="gitSelectedRemote = $event"
          @update:git-advanced-open="gitAdvancedOpen = $event"
          @update:git-merge-target="gitMergeTarget = $event"
          @update:git-rebase-onto="gitRebaseOnto = $event"
          @update:git-tag-name-input="gitTagNameInput = $event"
          @on-git-file-pointer-down="onGitFilePointerDown"
          @on-git-file-contextmenu="onGitFileContextMenu"
          @commit-batch-group="commitBatchGroup"
          @commit-all-batches="commitAllBatches"
          @ai-batch-groups="generateAiBatchGroups"
          @update:batch-messages="batchMessages = $event"
          @update:batch-section-open="batchSectionOpen = $event"
          @checkout-branch="(name) => checkoutBranch(name)"
          @create-branch="createBranch"
          @delete-branch="deleteBranch"
          @open-file="openFile"
        />
      </section>

      <div
        v-show="!editorCollapsed && !chatCollapsed && !noActiveEditor"
        class="resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整聊天面板宽度"
        tabindex="0"
        @mousedown="startResize('chat', $event)"
        @keydown="onResizeKeydown('chat', $event)"
      ></div>

      <ChatPanel
        v-show="!chatCollapsed"
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
        :agent-run-stage-label="agentRunStageLabelText"
        :pending-approval="agentPendingApproval"
        :stalled-assistant-msg="stalledAssistantMsg"
        :auto-resume-seconds-left="autoResumeSecondsLeft"
        :pending-prompt-queue="pendingPromptQueue"
        :session-list="sessionList"
        :active-session-id="activeSessionId"
        :active-session-title="activeSessionTitle"
        :chat-store-sync-message="chatStoreSyncMessage"
        :is-dragging="isDragging"
        :editor-collapsed="editorCollapsed"
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
        :project-memory-tab="projectMemoryTab"
        :project-memory-draft="projectMemoryDraft"
        :project-memory-loading="projectMemoryLoading"
        :project-memory-saving="projectMemorySaving"
        :project-memory-message="projectMemoryMessage"
        :project-memory-max-chars="projectMemoryMaxChars"
        :project-memory-has-content="projectMemoryHasContent"
        :project-skills-list="projectSkillsList"
        :project-exploration-list="projectExplorationList"
        :project-skills-loading="projectSkillsLoading"
        :selected-skill-slug="selectedSkillSlug"
        :skill-draft-title="skillDraftTitle"
        :skill-draft-kind="skillDraftKind"
        :skill-draft-body="skillDraftBody"
        :skill-detail-loading="skillDetailLoading"
        :skill-saving="skillSaving"
        :selected-exploration-id="selectedExplorationId"
        :exploration-content="explorationContent"
        :exploration-detail-loading="explorationDetailLoading"
        :memory-suggest-saving="memorySuggestSaving"
        :pending-memory-proposals="pendingMemoryProposals"
        :pending-skill-proposals="pendingSkillProposals"
        :agent-suggestions="activeAgentSuggestions"
        :active-session-provider-id="activeSessionProviderId"
        :provider-options="providerOptions"
        :global-model-name="aiConfig.model"
        @update:activeSessionProviderId="setActiveSessionProvider"
        @on-chat-drag-enter="onChatDragEnter"
        @on-chat-drag-over="onChatDragOver"
        @on-chat-drag-leave="onChatDragLeave"
        @on-chat-drop="onChatDrop"
        @switch-to-adjacent-session="switchToAdjacentSession"
        @start-new-session="handleStartNewSession"
        @expand-editor="expandEditor"
        @collapse-chat="collapseChat"
        @switch-session="handleSwitchSession"
        @open-session-list="gitPanelMode = 'sessions'"
        @copy-session-info="copySessionInfo"
        @copy-session-name-path="copySessionNamePath"
        @remove-session="removeSession"
        @clear-chat="clearChat"
        @apply-example="applyExample"
        @open-project="handleOpenProject"
        @open-ai-config="openAiConfigPage"
        @open-project-view="openProjectPanelView"
        @apply-suggestion="handleAgentSuggestion"
        @on-chat-scroll="onChatScroll"
        @scroll-to-bottom="scrollChatToBottom(true)"
        @clear-pending-queue="clearPendingPromptQueue"
        @on-composer-field-keydown="onComposerFieldKeydown"
        @select-mention="selectMention"
        @on-chat-input-box-mousedown="onChatInputBoxMouseDown"
        @update:chat-mode="chatMode = $event"
        @cancel-auto-resume="cancelAutoResume"
        @force-recover-stalled-run="forceRecoverStalledRun"
        @resume-agent-run="resumeAgentRun"
        @pause-agent="pauseAgent"
        @stop-agent="stopAgent"
        @send-chat="sendChat"
        @update:show-token-detail="showTokenDetail = $event"
        @open-project-memory="openProjectMemoryEditor"
        @close-project-memory="closeProjectMemoryEditor"
        @update:project-memory-tab="setProjectMemoryTab"
        @select-project-skill="selectProjectSkill"
        @select-project-exploration="selectProjectExploration"
        @save-project-memory="saveProjectMemoryDraft"
        @save-project-skill="saveProjectSkillDraft"
        @update:project-memory-draft="projectMemoryDraft = $event"
        @update:skill-draft-body="skillDraftBody = $event"
        @confirm-memory-proposal="confirmPendingMemoryProposal"
        @dismiss-memory-proposal="dismissPendingMemoryProposal"
        @confirm-skill-proposal="confirmPendingSkillProposal"
        @dismiss-skill-proposal="dismissPendingSkillProposal"
      >
        <template #messages>
          <VibeChatMessages />
        </template>
        <template #composer>
          <ChatComposerEditor
            ref="composerRef"
            class="chat-composer-editor"
            :placeholder="chatSending ? '输入新指令将打断当前任务…' : chatPlaceholder"
            :disabled="!configReady || !apiKeyReady || !projectOpened || !isDesktopRuntime"
            :draft-key="composerDraftKey"
            :project-path="projectPath"
            @mention-change="onComposerMentionChange"
            @enter-send="sendChat"
            @update:empty="composerEmpty = $event"
            @image-error="onComposerImageError"
            @focus="chatInputFocused = true"
            @blur="chatInputFocused = false"
          />
        </template>
      </ChatPanel>

      <button
        v-if="chatCollapsed && projectOpened"
        type="button"
        class="chat-expand-rail"
        title="展开 AI 助手"
        aria-label="展开 AI 助手"
        @click="expandChat"
      >
        <span class="chat-expand-rail-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
            <path d="M12 12 4 7.5m8 4.5 8-4.5M12 12v9" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          </svg>
        </span>
        <span class="chat-expand-rail-label">AI 助手</span>
      </button>
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
          <button type="button" class="ctx-item" @click="contextMenuAttachToChat">引用到对话</button>
          <div class="ctx-sep" />
          <button type="button" class="ctx-item" @click="contextMenuCopyRelativePath">复制相对路径</button>
          <button type="button" class="ctx-item" @click="contextMenuCopyFullPath">复制完整路径</button>
          <button type="button" class="ctx-item" @click="contextMenuRevealInFolder">在文件管理器中显示</button>
          <div class="ctx-sep" />
          <button type="button" class="ctx-item" @click="contextMenuCreateFile">+ 新建文件</button>
          <button type="button" class="ctx-item" @click="contextMenuCreateFolder">+ 新建文件夹</button>
          <div class="ctx-sep" />
          <button type="button" class="ctx-item" @click="contextMenuRename">重命名</button>
          <button type="button" class="ctx-item danger" @click="contextMenuDelete">删除</button>
        </div>
      </div>
      <div v-if="gitFileContextMenu.show" class="ctx-overlay" @click="hideGitFileContextMenu" @contextmenu.prevent="hideGitFileContextMenu">
        <div class="ctx-menu" :style="{ left: gitFileContextMenu.x + 'px', top: gitFileContextMenu.y + 'px' }" @click.stop>
          <button
            v-if="gitFileCtxCanStage"
            type="button"
            class="ctx-item"
            @click="gitFileCtxStage"
          >
            暂存选中
          </button>
          <button
            v-if="gitFileCtxCanUnstage"
            type="button"
            class="ctx-item"
            @click="gitFileCtxUnstage"
          >
            取消暂存
          </button>
          <button
            v-if="gitFileCtxCanDiscard"
            type="button"
            class="ctx-item danger"
            @click="gitFileCtxDiscard"
          >
            丢弃更改
          </button>
          <button
            v-if="gitFileCtxCanIgnore"
            type="button"
            class="ctx-item"
            @click="gitFileCtxIgnore"
          >
            忽略本地改动
          </button>
          <button
            v-if="gitFileCtxCanUnignore"
            type="button"
            class="ctx-item"
            @click="gitFileCtxUnignore"
          >
            恢复跟踪
          </button>
          <div v-if="gitFileCtxCanStage || gitFileCtxCanUnstage || gitFileCtxCanDiscard || gitFileCtxCanIgnore || gitFileCtxCanUnignore" class="ctx-sep" />
          <button type="button" class="ctx-item" @click="gitFileOpenInEditor">打开文件</button>
          <button type="button" class="ctx-item" @click="gitFileRevealInFolder">在文件管理器中显示</button>
          <div class="ctx-sep" />
          <button type="button" class="ctx-item" @click="gitFileCopyName">复制文件名</button>
          <button type="button" class="ctx-item" @click="gitFileCopyFullPath">复制完整路径</button>
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

    <!-- 站内通知横幅已移除：仅使用 Tauri 原生通知（invoke('send_notification')） -->

    <QuickSearchModal
      :open="quickSearchOpen"
      :project-opened="projectOpened"
      :project-path="projectPath"
      :session-list="sessionList"
      :active-session-id="activeSessionId"
      :get-live-session-messages="getLiveSessionMessagesForSearch"
      @close="quickSearchOpen = false"
      @open-file="onQuickSearchOpenFile"
      @open-session="onQuickSearchOpenSession"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import "../styles/vibe-coding.scss";
import { appendStatusDetail, assistantTransientUiClearPatch, truncateDiffPreview, cleanStatusLogText, CHAT_SCROLL_BOTTOM_THRESHOLD, formatCharCount, isNetworkError, fileName, genId, hasAgentProcessSteps, entryToNode, formatToolMeta, syncRoundGroupsPatch, inferEditorTabKind, displayFilePath } from "../utils/vibeHelpers";
import { gitFileSelectionKey, parseGitFileSelectionKey, gitFileListScopeIsStaged, type GitFileListScope } from "../utils/gitHelpers";
import { appendDebugLogFile, debugLog, setDebugLogProjectRoot } from "../utils/debugLog";
import { lsGet, lsGetJson, lsSet, lsSetJson, lsRemove } from "../utils/localStorageSafe";
import { dismissBlockingOverlays, registerOverlayDismissDeps, scanDomBlockingOverlays } from "../utils/dismissBlockingOverlays";
import { sessionDiag } from "../utils/sessionDiagLog";
import { normalizePath, normalizeProjectPath as normalizeProjectPathUtil } from "../utils/normalizePath";
import ChatComposerEditor, { COMPOSER_PENDING_DRAFT_KEY } from "../components/ChatComposerEditor.vue";
import ConfirmPopup from "../components/ConfirmPopup.vue";
import InputPrompt from "../components/InputPrompt.vue";
import FileTreeNode, { type TreeNode } from "../components/FileTreeNode.vue";
import AppToolbar from "../components/vibe/AppToolbar.vue";
import FilePanel from "../components/vibe/FilePanel.vue";
import GitPanel from "../components/vibe/GitPanel.vue";
import KnowledgePanel from "../components/vibe/KnowledgePanel.vue";
import ProjectArchitectReviewPanel from "../components/vibe/ProjectArchitectReviewPanel.vue";
import ArchitectReviewMainPanel from "../components/vibe/ArchitectReviewMainPanel.vue";
import ProjectCodeMapPanel from "../components/vibe/ProjectCodeMapPanel.vue";
import CodeMapMainPanel from "../components/vibe/CodeMapMainPanel.vue";
import PlanMainPanel from "../components/vibe/PlanMainPanel.vue";
import EditorPanel from "../components/vibe/EditorPanel.vue";
import ChatPanel from "../components/vibe/ChatPanel.vue";
import VibeChatMessages from "../components/vibe/VibeChatMessages.vue";
import VibeWorkspaceWelcome from "../components/vibe/VibeWorkspaceWelcome.vue";
import QuickSearchModal from "../components/vibe/QuickSearchModal.vue";
import { vibeChatMessageContextKey, type VibeChatMessageContext } from "../composables/vibeChatMessageContext";
import { useConfirm } from "../composables/useConfirm";
import { useFileDrag } from "../composables/useFileDrag";
import { usePanelLayout } from "../composables/usePanelLayout";
import { useGitPanel, type GitFileDiff } from "../composables/useGitPanel";
import { useInputPrompt } from "../composables/useInputPrompt";
import { useEditorPanel } from "../composables/useEditorPanel";
import { useSessionManager } from "../composables/useSessionManager";
import { useChatSessionStore } from "../composables/useChatSessionStore";
import { useVibeQuickSearch } from "../composables/useVibeQuickSearch";
import { useVibeGlobalShortcuts } from "../composables/useVibeGlobalShortcuts";
import { useProjectMemory } from "../composables/useProjectMemory";
import { useProjectKnowledge } from "../composables/useProjectKnowledge";
import { useProjectArchitectReview } from "../composables/useProjectArchitectReview";
import { useCodeMap } from "../composables/useCodeMap";
import { useAutoBugFix } from "../composables/useAutoBugFix";
import { buildExplainNodePrompt } from "../../shared/codeMapAnnotate";
import { codeMapToMermaid, downloadTextFile, exportCodeMapSvg } from "../utils/codeMapToMermaid";
import AutoBugFixPanel from "../components/vibe/AutoBugFixPanel.vue";
import { usePlanPanel } from "../composables/usePlanPanel";
import { useMessageQuote } from "../composables/useMessageQuote";
import { useChatMention } from "../composables/useChatMention";
import { restoreChatScrollPosition, useWorkspaceUiPersistence } from "../composables/useWorkspaceUiPersistence";
import { PROJECT_ARCHITECT_REVIEW_REL_PATH } from "../services/vibeProjectArchitectReviewClient";
import { PROJECT_KNOWLEDGE_REL_PATH } from "../services/vibeProjectKnowledgeClient";
import { isTauriEnv, tauriInvoke } from "../services/tauriInvoke";
import { agentRunStageLabel, resolveAgentRunStage } from "../services/agentRunLiveState";
import { distillExplorationRun } from "../services/explorationDistill";
import {
  ensurePlanFileBeforeExecution,
  extractPlanContentFromStoredMessage,
  isPlanDocumentPath,
} from "../services/planFile";
import { useAgentRun } from "../composables/useAgentRun";
import type { VibeChatMessage } from "../types/vibeChat";
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
  resolveResumeOriginalUserPrompt,
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
import { loadAiChatBaseFromStorage, loadPersistedAiConfigFromStorage } from "../services/aiLocalConfig";
import {
  buildAgentHistoryFromMessages,
  getSessionDiagSnapshot,
  getSessionTitle,
  onStorageError,
  saveVibeChatHistory,
  stripReferenceAttachments,
  stripToolSummaryFromAssistantContent,
  updateVibeChatSessionStatus,
  vibeChatSessionDiskFilePath,
  type PersistedChatMessage,
  type VibeChatSessionMeta,
} from "../services/vibeChatStorage";
import {
  hydrateChatMessagesImages,
  hydrateChatMessageImages,
  chatMessagesNeedImageHydration,
  resolveChatMessageImageUrls,
} from "../services/vibeChatImageStore";
import {
  isDeleteNotFoundError,
  formatPendingApprovalLabel,
} from "../services/vibeAgentTurnApply";
import { revertTurnFileDiffs } from "../services/agentTurnRevert";
import {
  type VibeChatHistoryMessage,
  type VibeChatMode,
} from "../services/vibeAgentClient";


import { isScrollNearBottom, scheduleScrollContainerToBottom, scrollContainerToBottom, scrollElementToBottom } from "../utils/scrollViewport";
import { truncatePromptAttachment } from "../utils/truncatePromptAttachment";
import {
  addProjectToHistory,
  listProjectHistory,
  removeProjectFromHistory,
  type ProjectHistoryEntry,
} from "../services/vibeProjectHistory";
import {
  createItem,
  deleteItem,
  listDirectory,
  openProjectFolderInExplorer,
  pickProjectFolder,
  readFile,
  formatFetchError,
  writeFile,
  type FileEntry,
} from "../services/vibeCodingClient";
import {
  fetchGitDiffContent,
  fetchGitCommitFileDiff,
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
import { useAgentNotification } from "../composables/useAgentNotification";
import { useFileWatcher } from "../composables/useFileWatcher";

const { confirm, confirmUnsaved, dismissPendingOverlay: dismissPendingConfirm, show: confirmShow } = useConfirm();
const inputPrompt = useInputPrompt();
const router = useRouter();
const isDesktopRuntime = computed(() => isTauriEnv());

function openAiConfigPage() {
  void router.push("/ai-config");
}

const quoteButtonRef = ref<HTMLElement | null>(null);
const planPanelSectionRef = ref<HTMLElement | null>(null);
const composerRef = ref<InstanceType<typeof ChatComposerEditor> | null>(null);
const composerEmpty = ref(true);

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

// 站内通知横幅已移除：仅使用 Tauri 原生通知（invoke('send_notification')）
const PENDING_QUEUE_KEY = "vibe-coding-pending-queue";
type ChatRole = "user" | "assistant";
type FileDiff = TurnFileDiff;

function normalizeChatMessages(
  messages: PersistedChatMessage[],
  options?: { stripTransientUi?: boolean },
): VibeChatMessage[] {
  return messages.map((m) => {
    const normalized: VibeChatMessage = {
      ...m,
      activityExpanded:
        m.activityExpanded ??
        (m.role === "assistant" && hasAgentProcessSteps(m)),
      activityDetailed: m.activityDetailed === true,
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

    if (m.role === "assistant" && options?.stripTransientUi) {
      Object.assign(normalized, assistantTransientUiClearPatch());
      const inferred = inferAgentRecoveryFlags(normalized);
      if (inferred) {
        normalized.agentFailed = inferred.agentFailed;
        normalized.agentRecoverable = inferred.agentRecoverable;
        normalized.agentFailureReason = inferred.agentFailureReason;
        normalized.agentFailureDetail = inferred.agentFailureDetail;
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
  projectMemoryTab,
  projectMemoryDraft,
  projectMemoryLoading,
  projectMemorySaving,
  projectMemoryMessage,
  projectMemoryMaxChars,
  projectMemoryHasContent,
  projectSkillsList,
  projectExplorationList,
  projectSkillsLoading,
  selectedSkillSlug,
  skillDraftTitle,
  skillDraftKind,
  skillDraftBody,
  skillDetailLoading,
  skillSaving,
  selectedExplorationId,
  explorationContent,
  explorationDetailLoading,
  memorySuggestSaving,
  pendingMemoryProposals,
  pendingSkillProposals,
  openProjectMemoryEditor,
  closeProjectMemoryEditor,
  setProjectMemoryTab,
  selectProjectSkill,
  selectProjectExploration,
  saveProjectMemoryDraft,
  saveProjectSkillDraft,
  applyExplorationDistillSilently,
  addPendingMemoryProposal,
  addPendingSkillProposal,
  confirmPendingMemoryProposal,
  confirmPendingSkillProposal,
  dismissPendingMemoryProposal,
  dismissPendingSkillProposal,
  trackMemoryUsageAfterRun,
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

const openingProject = ref(false);

function loadChatMode(): VibeChatMode {
  const saved = lsGet(CHAT_MODE_KEY);
  if (saved === "ask" || saved === "plan" || saved === "auto") return saved;
  return "auto";
}

const chatMode = ref<VibeChatMode>(loadChatMode());
const chatSending = ref(false);
const sendingSessionIdList = ref<string[]>([]);

function isSessionSending(sessionId: string): boolean {
  return sendingSessionIdList.value.includes(sessionId);
}

function syncActiveChatSending() {
  chatSending.value = sendingSessionIdList.value.includes(activeSessionId.value);
}

function beginAgentRunSession(sessionId: string) {
  if (!sessionId) return;
  dismissBlockingOverlays("agent-run-start");
  if (!sendingSessionIdList.value.includes(sessionId)) {
    sendingSessionIdList.value = [...sendingSessionIdList.value, sessionId];
  }
  syncActiveChatSending();
}

function snapshotAgentRunSession(_sessionId: string) {
  // Registry holds live messages; no separate snapshot needed.
}

// ── 系统通知（Agent 完成时） ──
const { notifyAgentDoneIfNeeded, testNotification } = useAgentNotification(
  (sessionId) => {
    const project = projectPath.value.trim();
    return (project ? getSessionTitle(project, sessionId) : undefined) || sessionId;
  },
);

function endAgentRunSession(sessionId?: string, silent = false) {
  const sid = (sessionId || "").trim();
  if (!sid) return;
  sendingSessionIdList.value = sendingSessionIdList.value.filter(id => id !== sid);
  syncActiveChatSending();
  if (!sendingSessionIdList.value.length) {
    dismissBlockingOverlays("agent-run-end");
  }
  if (!silent) notifyAgentDoneIfNeeded(sid);
}

const switchingProject = ref(false);
let projectSwitchGeneration = 0;
const chatError = ref("");
const editorPanelRef = ref<InstanceType<typeof EditorPanel> | null>(null);
const workspaceRef = ref<HTMLElement | null>(null);
let scrollChatRaf = 0;
let chatPinnedToBottom = true;
let chatScrollPersistTimer = 0;
const restoringWorkspaceUi = ref(false);
const chatPanelRef = ref<InstanceType<typeof ChatPanel> | null>(null);
const pendingPromptQueue = ref<string[]>([]);
function persistPendingQueue() {
  if (pendingPromptQueue.value.length) {
    lsSetJson(PENDING_QUEUE_KEY, pendingPromptQueue.value);
  } else {
    lsRemove(PENDING_QUEUE_KEY);
  }
}

import { type ReferencedFile } from "../composables/useFileDrag";

const dismissedSuggestionMsgId = ref<string | null>(null);
function getChatDropZoneEl(): HTMLElement | null {
  return chatPanelRef.value?.chatDropZoneRef ?? null;
}
const chatInputFocused = ref(false);
function onChatInputBoxMouseDown() {
  composerRef.value?.focus();
}
const projectHistoryList = ref<ProjectHistoryEntry[]>([]);

// Git panel composable
const {
  gitBranches, checkoutBranch, createBranch, deleteBranch, resolveConflict,
  doMerge, doMergeAbort, doRebase, doRebaseAbort, doCherryPick, doRevertCommit,
  doCreateTag, doDeleteTag, doSubmoduleUpdate,
  gitPanelMode, projectPanelView, gitStatus, gitBranch, gitHeadCommit, gitIsRepo, gitStatusKnown, gitLoading, gitError,
  gitRepos, gitActiveRepoPath, refreshGitRepos, switchGitRepo,
  gitSecondaryHint,
  gitCommitMessage, gitCommitting, gitGenStep, gitLogEntries, gitLogOpen,
  gitLogCount, gitLogSearchQuery, gitLogAllBranches, gitLogBranchFilter, gitLogAuthorFilter, gitLogPathFilter, gitLogSince, gitLogUntil, hasMoreGitLog, gitLogLoadingMore, gitLogSearchLoading, loadMoreGitLog,
  searchGitLog, setGitLogAllBranches, setGitLogBranchFilter, setGitLogFilters,
  gitStagedOpen, gitUnstagedOpen, gitUntrackedOpen, expandedGitLogEntries, selectedGitFiles,
  gitStashSectionOpen, gitLocalChangesOpen, gitIgnoredLocalFiles, gitIgnoredLocalOpen,
  gitDiffLoadingKey, gitDiffContentCache, gitRemotes, gitSelectedRemote, gitTrackingBranch,
  gitAhead, gitBehind, gitRemoteLoading, gitRemoteAction, gitStashes, gitStashOpen,
  gitStashAction, gitStashMessage, gitAiPushStep,
  gitAheadCommits, gitAheadCommitsOpen, gitAheadCommitsLoading,
  gitBehindCommits, gitBehindCommitsOpen, gitBehindCommitsLoading,
  gitMergeInProgress, gitRebaseInProgress, gitAdvancedOpen, gitAdvancedAction,
  gitTags, gitSubmodules, gitTagNameInput, gitMergeTarget, gitRebaseOnto,
  gitStagedFiles, gitUnstagedFiles, gitConflictedFiles, gitChangeCount, canGitCommit,
  gitModifiedFiles,
  gitHunkTargetFile, gitHunks, gitStagedHunks, gitHunkStagingIndex, gitHunkUnstagingIndex,
  clearGitDiffCache, evictOldestCacheEntry, gitStagingInProgress, gitLastStagingAt, gitStatusIcon, gitStatusColor,
  isGitLogEntryOpen, toggleGitLogEntry, gitHistoryDiffKey, gitWorkingTreeDiffKey,
  resetGitPanelState, refreshGitStatus, commitGit, stageFile, unstageFile,
  stageAll, stageUntracked, unstageAll, discardFile, discardAll, stageDir, unstageDir, discardDir,
  stageHunk,
  unstageHunk,
  stageSelectedFiles, unstageSelectedFiles, discardSelectedFiles, toggleGitFileSelection, clearGitSelection,
  ignoreSelectedFiles, unignoreSelectedFiles,
  generateCommitMessage, aiCommitAndPush, refreshGitRemotes, refreshGitAheadCommits, refreshGitBehindCommits,
  doFetch, doPull, doPush,
  doResetCommit,
  refreshGitStashes, doStashSave, doStashApply, doStashPop, doStashDrop,
  batchGroups, batchGroupsFromAi, batchMessages, batchSectionOpen, batchCommittingIndex, commitBatchGroup, commitAllBatches,
  aiBatchGrouping, aiBatchGroupingStep, generateAiBatchGroups, flushBatchDraftPersist,
} = git;

function openProjectPanelView(view: "knowledge" | "health" | "map" | "fix") {
  gitPanelMode.value = "project";
  projectPanelView.value = view;
}

function doCreateBranchAt(hash: string) {
  const name = globalThis.prompt("在此提交创建分支：");
  if (name) createBranch(name, hash);
}

function openGitRemote(url: string) {
  if (!url) return;
  if (isTauriEnv()) {
    void tauriInvoke("system_open_url", { url }).catch(() => {
      window.open(url, "_blank", "noopener,noreferrer");
    });
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

// Session manager composable
const {
  activeSessionId,
  sessionList,
  activeSessionTitle,
  activeSessionIndex,
  canSwitchToNewerSession,
  canSwitchToOlderSession,
  sessionLocalFileName,
  formatSessionInfoForCopy,
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
  chatError,
  chatSending: () => chatSending.value,
  session,
  normalizeMessages: (msgs) => normalizeChatMessages(msgs, { stripTransientUi: true }),
  confirm,
  resolveSessionMessages: (sessionId, diskMessages) =>
    normalizeChatMessages(diskMessages, { stripTransientUi: true }),
  persistComposerDraft: () => composerRef.value?.saveDraftNow?.(),
  onAfterSwitch: () => chatSessionHooks.onAfterSwitch?.(),
  scrollToBottom: (force) => chatSessionHooks.scrollToBottom?.(force),
  isSwitchingProject: () => switchingProject.value,
});

const {
  activeMessages: chatMessages,
  switchingSession,
  syncingChatStore,
  chatStoreSyncMessage,
  activateSession,
  bindSessionMessages,
  getSessionMessages,
  patchSessionMessage,
  persistSessionNow,
  persistChatNow,
  schedulePersistChat,
  schedulePersistDuringAgentRun,
  cancelPendingChatPersistence,
  ensureSessionForSend,
  startNewSession,
  switchSession,
  removeSession,
  syncChatStoreToDisk,
  loadProjectChatState,
  resetUiForProjectSwitch,
  clearProjectChat,
  activeSessionProviderId,
  setActiveSessionProvider,
} = chatSession;

function persistAgentRunSession(sessionId: string) {
  const sid = sessionId.trim();
  const project = projectPath.value.trim();
  if (!sid || !project || sid === activeSessionId.value) return;
  persistSessionNow(sid, project, { touchTimestamp: false });
}

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
  // 项目切换中：没有显式路径时跳过，避免异步间隙被旧项目路径重新填充 sessionList
  if (switchingProject.value && !path) return;
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

function switchToAdjacentSession(delta: number) {
  const nextId = session.switchToAdjacentSession(delta);
  if (nextId) {
    expandChat();
    switchSession(nextId);
  }
}

function handleSwitchSession(sessionId: string) {
  expandChat();
  switchSession(sessionId);
}

function onChatDragEnter(e: DragEvent) {
  onChatDragEnterBase(e);
}
function onChatDragOver(e: DragEvent) {
  onChatDragOverBase(e);
}
function onChatDragLeave(e: DragEvent) {
  onChatDragLeaveBase(e, getChatDropZoneEl());
}
function onChatDrop(e: DragEvent) {
  onChatDropBase(e, getChatDropZoneEl());
}
function onDocumentDragOverCapture(e: DragEvent) {
  onDocumentDragOverCaptureBase(e, getChatDropZoneEl());
}
function onDocumentDropCapture(e: DragEvent) {
  onDocumentDropCaptureBase(e, getChatDropZoneEl());
}

// File watcher state — refreshTree wired after useEditorPanel (see fileWatcherTreeRefresh)
const fileWatcherTreeRefresh = { fn: (() => {}) as () => void | Promise<void> };
const {
  fileWatcherActive,
  fileWatcherConnected,
  startFileWatcherForProject,
  stopFileWatcherForProject,
} = useFileWatcher({
  refreshTree: () => fileWatcherTreeRefresh.fn(),
  isProjectKnowledgeFilePath,
  onKnowledgeFileChanged: () => {
    scheduleKnowledgeReloadFromDisk();
  },
  gitStagingInProgress: () => gitStagingInProgress.value,
  gitLastStagingAt: () => gitLastStagingAt.value,
  gitRefreshPaused: () => aiBatchGrouping.value,
});

const contextMenu = ref({ show: false, x: 0, y: 0, path: "" });
const gitFileContextMenu = ref({ show: false, x: 0, y: 0, path: "", scope: "modified" as GitFileListScope });

const aiConfig = ref({ endpoint: "", apiKey: "", model: "", providerName: "" });
const providerOptions = ref<Array<{ id: string; name: string; model: string }>>([]);

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
  if (activeSessionProviderId.value) {
    const pinned = providerOptions.value.find((p) => p.id === activeSessionProviderId.value);
    if (pinned) return `${pinned.name} / ${pinned.model}（本会话）`;
  }
  return modelNameForDisplay.value;
});
const canSendChat = computed(
  () =>
    !composerEmpty.value
    && configReady.value
    && apiKeyReady.value
    && projectOpened.value
    && isDesktopRuntime.value,
);

const {
  knowledgeBody,
  knowledgeDraft,
  knowledgeMeta,
  knowledgeLoading,
  knowledgeSaving,
  knowledgeMessage,
  editing: knowledgeEditing,
  hasKnowledge: knowledgeHasContent,
  displayBody: knowledgeDisplayBody,
  exploreRun: knowledgeExploreRun,
  knowledgeChangedFiles,
  knowledgeChangesLoading,
  knowledgeChangesAvailable,
  loadKnowledge,
  saveKnowledgeDraft,
  beginEdit: beginKnowledgeEdit,
  cancelEdit: cancelKnowledgeEdit,
  startKnowledgeExplore,
  continueKnowledgeExplore,
  exploreKnowledgeChanges,
  sendKnowledgeFollowUp,
  stopKnowledgeExplore,
  leaveProjectKnowledge,
} = useProjectKnowledge({
  projectPath,
  projectOpened,
  configReady,
  apiKeyReady,
  aiConfig,
  gitHead: gitHeadCommit,
});

const {
  reviewMeta,
  reviewLoading,
  reviewMessage,
  reviewContext,
  reviewRun,
  hasReview: reviewHasContent,
  reviewVerdict,
  reviewAttentionCount,
  displayBody: reviewDisplayBody,
  loadReview,
  startArchitectReview,
  stopArchitectReview,
  onProjectClosed: onReviewProjectClosed,
  onProjectPathChanged: onReviewProjectPathChanged,
  // History
  reviewHistory,
  reviewHistoryLoading,
  reviewHistoryDetailLoading,
  reviewHistoryMessage,
  activeHistoryReview,
  loadReviewHistory,
  viewHistoryReview,
  deleteHistoryReview,
  clearHistoryReview,
} = useProjectArchitectReview({
  projectPath,
  projectOpened,
  configReady,
  apiKeyReady,
  aiConfig,
  gitHead: gitHeadCommit,
  confirm,
});

const {
  document: codeMapDocument,
  positions: codeMapPositions,
  collapsedIds: codeMapCollapsedIds,
  selectedNodeId: codeMapSelectedNodeId,
  selectedNode: codeMapSelectedNode,
  relatedEdges: codeMapRelatedEdges,
  hasDocument: codeMapHasDocument,
  generatedAtLabel: codeMapGeneratedAtLabel,
  loading: codeMapLoading,
  building: codeMapBuilding,
  annotating: codeMapAnnotating,
  message: codeMapMessage,
  error: codeMapError,
  annotateEnabled: codeMapAnnotateEnabled,
  layoutEpoch: codeMapLayoutEpoch,
  isStale: codeMapIsStale,
  focusNodeId: codeMapFocusNodeId,
  focusEpoch: codeMapFocusEpoch,
  loadCached: loadCodeMapCached,
  generate: generateCodeMap,
  runAnnotate: runCodeMapAnnotate,
  selectNode: selectCodeMapNode,
  toggleCollapsed: toggleCodeMapCollapsed,
  updatePosition: updateCodeMapPosition,
  resetLayout: resetCodeMapLayout,
  onProjectPathChanged: onCodeMapProjectPathChanged,
} = useCodeMap({
  projectPath,
  gitHead: gitHeadCommit,
  configReady,
  aiConfig: () => ({
    endpoint: aiConfig.value.endpoint,
    apiKey: aiConfig.value.apiKey,
    model: aiConfig.value.model,
  }),
});

const reviewAttentionBadgeCount = computed(() => reviewAttentionCount.value);

function openCodeMapFile(relPath: string) {
  const root = normalizePath(projectPath.value);
  const rel = relPath.replace(/^[/\\]+/, "").replace(/^\.$/, "");
  if (!rel) return;
  void openFile(`${root}/${rel}`);
}

function explainCodeMapNode() {
  const node = codeMapSelectedNode.value;
  if (!node) return;
  expandChat();
  composerRef.value?.setPlainText(buildExplainNodePrompt(node));
  void nextTick(() => composerRef.value?.focus());
}

function exportCodeMapMermaid() {
  const doc = codeMapDocument.value;
  if (!doc) return;
  downloadTextFile("code-map.mmd", codeMapToMermaid(doc), "text/plain");
}

async function exportCodeMapAsSvg() {
  const doc = codeMapDocument.value;
  if (!doc) return;
  try {
    await exportCodeMapSvg(doc);
  } catch {
    codeMapError.value = "导出 SVG 失败";
  }
}

function openArchitectReviewSourceFile() {
  const root = normalizePath(projectPath.value);
  void openFile(`${root}/${PROJECT_ARCHITECT_REVIEW_REL_PATH}`);
}

function normalizeKnowledgePathKey(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

function isProjectKnowledgeFilePath(filePath: string): boolean {
  const root = normalizePath(projectPath.value);
  if (!root || !filePath.trim()) return false;
  const expected = normalizeKnowledgePathKey(`${root}/${PROJECT_KNOWLEDGE_REL_PATH}`);
  const normalized = normalizeKnowledgePathKey(filePath.replace(/\\/g, "/"));
  return normalized === expected || normalized.endsWith(`/${PROJECT_KNOWLEDGE_REL_PATH.toLowerCase()}`);
}

function scheduleKnowledgeReloadFromDisk() {
  if (knowledgeExploreRun.value.running || knowledgeEditing.value) return;
  void loadKnowledge();
}

function openKnowledgeFile(relPath: string) {
  const root = normalizePath(projectPath.value);
  void openFile(`${root}/${relPath.replace(/^[/\\]+/, "")}`);
}

function openKnowledgeSourceFile() {
  openKnowledgeFile(PROJECT_KNOWLEDGE_REL_PATH);
}

watch([gitPanelMode, projectPanelView, projectOpened], ([mode, view, opened]) => {
  if (!opened || mode !== "project") return;
  if (view === "knowledge") void loadKnowledge();
  if (view === "health") {
    void loadReview();
    void loadReviewHistory();
  }
  if (view === "map") void loadCodeMapCached();
});

watch(projectPath, () => {
  onReviewProjectPathChanged();
  onCodeMapProjectPathChanged();
  if (gitPanelMode.value === "project" && projectPanelView.value === "knowledge" && projectOpened.value) void loadKnowledge();
  if (gitPanelMode.value === "project" && projectPanelView.value === "health" && projectOpened.value) {
    void loadReview();
    void loadReviewHistory();
  }
  if (gitPanelMode.value === "project" && projectPanelView.value === "map" && projectOpened.value) {
    void loadCodeMapCached();
  }
});

watch(
  () => `${projectOpened.value}|${projectPath.value.trim()}|${activeSessionId.value}|${chatMessages.value.length}`,
  () => {
    restoreAutoBugFixPanelIfNeeded();
  },
);

/** 无活跃会话时输入框草稿用固定 key，仅存 localStorage */
const composerDraftKey = computed(
  () => activeSessionId.value || COMPOSER_PENDING_DRAFT_KEY,
);

const chatPlaceholder = computed(() =>
  chatMode.value === "auto"
    ? "自动识别意图，智能切换模式（Enter 发送，Shift+Enter 换行）"
    : chatMode.value === "ask"
    ? "提问、解释代码"
    : chatMode.value === "plan"
    ? "描述需求 → AI 输出方案 → 确认后执行（可点「执行方案」或回复「执行方案」）"
    : "描述要改什么（Enter 发送，Shift+Enter 换行）",
);

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
    if (m.role !== "assistant") continue;
    if (canResumeAgentRun(m) && resolveResumeOriginalUserPrompt(chatMessages.value, m.id)) return m;
    break;
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
  chatCollapsed,
  filePanelCollapsed,
  startResize,
  stopResize,
  onResizeKeydown,
  collapseEditor,
  expandEditor,
  collapseChat,
  expandChat,
  collapseFilePanel,
  expandFilePanel,
  getChatPanelMaxWidth,
  CHAT_MIN_WIDTH,
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
  } else {
    aiConfig.value = { endpoint: "", apiKey: "", model: "", providerName: "" };
  }
  const persisted = loadPersistedAiConfigFromStorage();
  providerOptions.value = (persisted?.providers || [])
    .filter((p) => p.model?.trim())
    .map((p) => ({ id: p.id, name: p.name.trim() || "默认供应商", model: p.model.trim() }));
}

/** Resolve the AI provider pinned to a session; null = use global config. */
function resolveSessionAiConfigForSession(sessionId: string) {
  const sid = sessionId.trim();
  if (!sid) return null;
  const meta = sessionList.value.find((s) => s.id === sid);
  const providerId = meta?.providerId?.trim();
  if (!providerId) return null;
  const persisted = loadPersistedAiConfigFromStorage();
  const provider = persisted?.providers.find((p) => p.id === providerId);
  if (!provider?.endpoint?.trim() || !provider?.model?.trim()) return null;
  return {
    endpoint: provider.endpoint.trim(),
    apiKey: provider.apiKey,
    model: provider.model.trim(),
    providerName: provider.name.trim() || "默认供应商",
  };
}

function loadSavedProject() {
  const saved = lsGet(STORAGE_KEY);
  if (saved) {
    projectPath.value = saved;
    setDebugLogProjectRoot(saved);
    void openProjectByPath(saved);
  }
}

function isChatNearBottom(): boolean {
  const el = chatPanelRef.value?.chatScrollRef;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= CHAT_SCROLL_BOTTOM_THRESHOLD;
}

function onChatScroll() {
  chatPinnedToBottom = isChatNearBottom();
  if (chatScrollPersistTimer) window.clearTimeout(chatScrollPersistTimer);
  chatScrollPersistTimer = window.setTimeout(() => {
    chatScrollPersistTimer = 0;
    workspaceUi.persistNow();
  }, 150);
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
    scrollChatRaf = requestAnimationFrame(() => {
      const el = chatPanelRef.value?.chatScrollRef;
      if (!el) {
        scrollChatRaf = 0;
        return;
      }

      if (force) {
        scheduleScrollContainerToBottom(() => chatPanelRef.value?.chatScrollRef ?? null, { behavior: "auto" });
      } else {
        scrollContainerToBottom(el, "auto");
      }
      scrollChatRaf = 0;
    });
  });
}

const {
  fileTree, expandedDirs, openTabs, activeFilePath, selectedTreePath,
  fileContent, fileDirty, fileLoadError, fileDiffs, readOnlyFileKeys,
  showDiffMode, renamingPath, activeFileDiff, activeFileReadOnly,
  refreshTree, openFile: openFileCore, saveFile, reloadFile, closeTab, switchTab,
  switchReadOnlyTab, createNewFile, createNewFolder, openScratchTab, commitRename, cancelRename,
  deleteSelectedItem, showGitFileDiff: showGitFileDiffCore, openGitLogFile: openGitLogFileCore, openDiffPreview,
  toggleDiffMode, toggleDir, findNode, findNodeByKey, normalizePathKey,
  joinProjectPath, resolveFullPathFromRel, storeFileDiff, getFileDiff, setFileDiff,
  findOpenTab, syncActiveTabToCache, ensureCanLeaveCurrentTab, ensureCanLeaveAllOpenTabs,
  syncEditorPanelForOpenFiles, parentDirForCreate, selectTreeItem,
  onEditorChange, activeFileRelativePath,
  syncEditorAfterAgentFileChange,
  closeOtherTabs, closeRightTabs, closeAllTabs,
  navigateBack, navigateForward, canGoBack, canGoForward,
  reorderTabs,
  persistEditorWorkspace, restoreEditorWorkspace, reloadExpandedDirChildren,
  prepareEditorWorkspaceProjectSwitch, finishEditorWorkspaceProjectSwitch,
} = useEditorPanel({
  projectPath,
  projectOpened,
  aiConfig,
  configReady,
  confirm,
  confirmUnsaved,
  inputPrompt,
  composerRef,
  editorPanelRef,
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

fileWatcherTreeRefresh.fn = refreshTree;

const {
  mentionOpen,
  mentionActiveIndex,
  mentionResults,
  onComposerMentionChange,
  onComposerFieldKeydown,
  selectMention,
} = useChatMention({
  projectPath,
  projectOpened,
  fileTree,
  insertFileRef: (item) => {
    composerRef.value?.insertFileRef(item);
  },
  focusComposer: () => {
    composerRef.value?.focus();
  },
});

const planWorkspaceOpen = ref(false);
const planPanelInForeground = ref(false);
let planPanelApi: ReturnType<typeof import("../composables/usePlanPanel").usePlanPanel> | null = null;

const gitPanelInForeground = ref(false);

function dismissPlanPanelForeground() {
  planPanelInForeground.value = false;
}

async function openFile(path: string, options?: Parameters<typeof openFileCore>[1]) {
  dismissPlanPanelForeground();
  dismissGitPanelForeground();
  return openFileCore(path, options);
}

function gitVirtualToRealPath(path: string): string {
  if (path.startsWith("git-index://")) {
    return resolveFullPathFromRel(path.slice("git-index://".length));
  }
  if (path.startsWith("git-history://")) {
    const rest = path.slice("git-history://".length);
    const slash = rest.indexOf("/");
    const rel = slash >= 0 ? rest.slice(slash + 1) : rest;
    return resolveFullPathFromRel(rel);
  }
  return path;
}

function onOpenSourceFile(path: string) {
  void openFile(gitVirtualToRealPath(path));
}

async function showGitFileDiff(filePath: string, staged = false) {
  dismissPlanPanelForeground();
  dismissGitPanelForeground();
  return showGitFileDiffCore(filePath, staged);
}

const activeGitDiffContext = computed(() => {
  if (!showDiffMode.value || !activeFilePath.value || !activeFileDiff.value) return null;
  const path = activeFilePath.value;
  const tab = openTabs.value.find((t) => t.path === path);
  const kind = tab?.kind ?? inferEditorTabKind(path);
  if (kind === "git-history" || path.startsWith("git-history://")) return null;

  if (kind === "git-staged" || path.startsWith("git-index://")) {
    const relative = path.startsWith("git-index://")
      ? path.slice("git-index://".length)
      : displayFilePath(path);
    return { relative, staged: true as const };
  }

  // Working-tree diffs: absolute path + kind "git-change" (or recovered via git status).
  const root = normalizePath(projectPath.value).replace(/\/$/, "");
  const norm = normalizePath(path);
  let relative = "";
  if (root && norm.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    relative = norm.slice(root.length + 1);
  } else if (kind === "git-change") {
    relative = displayFilePath(path);
  } else {
    return null;
  }

  const inGit =
    gitModifiedFiles.value.some((f) => f.path === relative)
    || gitStagedFiles.value.some((f) => f.path === relative);
  if (kind === "git-change" || inGit) {
    return { relative, staged: false as const };
  }
  return null;
});

const editorHunkActionMode = computed(() => {
  const ctx = activeGitDiffContext.value;
  if (!ctx) return null;
  return ctx.staged ? "unstage" : "stage";
});

const editorHunkActions = computed(() => {
  const ctx = activeGitDiffContext.value;
  if (!ctx) return [];
  const list = ctx.staged ? gitStagedHunks.value : gitHunks.value;
  return list.map((h) => ({ index: h.index, header: h.header }));
});

const editorHunkBusyIndex = computed(() => {
  const ctx = activeGitDiffContext.value;
  if (!ctx) return null;
  return ctx.staged ? gitHunkUnstagingIndex.value : gitHunkStagingIndex.value;
});

watch(activeGitDiffContext, (ctx) => {
  if (!ctx?.relative) return;
  const key = gitFileSelectionKey(ctx.relative, ctx.staged);
  if (selectedGitFiles.value.length === 1 && selectedGitFiles.value[0] === key) return;
  selectedGitFiles.value = [key];
});

async function onEditorHunkAction(index: number) {
  const ctx = activeGitDiffContext.value;
  if (!ctx) return;
  const beforeError = gitError.value;
  gitError.value = "";
  if (ctx.staged) await unstageHunk(ctx.relative, index);
  else await stageHunk(ctx.relative, index);
  if (gitError.value && gitError.value !== beforeError) {
    // Action failed — keep current diff; status/hunks already refreshed inside stage/unstage
    return;
  }

  clearGitDiffCache();
  const stillRelevant = ctx.staged
    ? gitStagedFiles.value.some((f) => f.path === ctx.relative)
    : gitModifiedFiles.value.some((f) => f.path === ctx.relative);

  if (stillRelevant) {
    await showGitFileDiff(ctx.relative, ctx.staged);
  } else if (activeFilePath.value) {
    await closeTab(activeFilePath.value);
  }
}

function openConflictFile(relativePath: string) {
  const root = normalizePath(projectPath.value);
  if (!root || !relativePath) return;
  void openFile(`${root}/${relativePath.replace(/^[/\\]+/, "")}`);
}

async function openGitLogFile(...args: Parameters<typeof openGitLogFileCore>) {
  dismissPlanPanelForeground();
  dismissGitPanelForeground();
  return openGitLogFileCore(...args);
}

const noActiveEditor = computed(() => {
  if (planWorkspaceOpen.value) return false;
  if (gitPanelInForeground.value) return false;
  const isProjectView = gitPanelMode.value === "project" &&
    (projectPanelView.value === "knowledge"
      || projectPanelView.value === "health"
      || projectPanelView.value === "fix"
      || projectPanelView.value === "map");

  if (isProjectView) {
    return !projectOpened.value;
  }

  return openTabs.value.length === 0;
});

const chatPanelStyle = computed(() => {
  if (editorCollapsed.value || noActiveEditor.value) {
    return { flex: "1", minWidth: `${CHAT_MIN_WIDTH}px`, width: "auto" };
  }
  return { width: `${chatPanelWidth.value}px`, flexShrink: "0" };
});

const {
  quickSearchOpen,
  openQuickSearch,
  getLiveSessionMessagesForSearch,
  onQuickSearchOpenFile,
  onQuickSearchOpenSession,
} = useVibeQuickSearch({
  activeSessionId,
  chatMessages,
  switchingSession,
  getSessionMessages,
  switchSession,
  expandChat,
  openFile,
  chatPanelRef,
  editorPanelRef,
});

useVibeGlobalShortcuts({
  openQuickSearch,
  saveFile: () => { void saveFile(); },
  switchToAdjacentSession,
  startNewSession,
  navigateBack,
  navigateForward,
  toggleFilePanel: filePanelCollapsed.value ? expandFilePanel : collapseFilePanel,
});

async function applyVibeChatMessageImageHydration(messages: PersistedChatMessage[]): Promise<VibeChatMessage[]> {
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
  return normalizeProjectPathUtil(current) === normalizeProjectPathUtil(path);
}

function removeRecentProject(path: string, event?: MouseEvent) {
  event?.stopPropagation();
  removeProjectFromHistory(path);
  refreshProjectHistoryList();
}

registerEscapeDismiss(() => contextMenu.value.show, hideContextMenu, ESCAPE_DISMISS_PRIORITY.CONTEXT_MENU);
registerEscapeDismiss(
  () => gitFileContextMenu.value.show,
  hideGitFileContextMenu,
  ESCAPE_DISMISS_PRIORITY.CONTEXT_MENU,
);
registerEscapeDismiss(projectMemoryOpen, closeProjectMemoryEditor, ESCAPE_DISMISS_PRIORITY.PROJECT_MEMORY);
registerEscapeDismiss(gitPanelInForeground, closeGitPanel, ESCAPE_DISMISS_PRIORITY.PROJECT_MEMORY - 1);
registerEscapeDismiss(
  showTokenDetail,
  () => {
    showTokenDetail.value = false;
  },
  ESCAPE_DISMISS_PRIORITY.TOKEN_DETAIL,
);
registerEscapeDismiss(
  () => chatSending.value,
  () => stopAgent(),
  ESCAPE_DISMISS_PRIORITY.AGENT_RUN,
);
registerEscapeDismiss(
  () =>
    scanDomBlockingOverlays().length > 0 ||
    confirmShow.value ||
    inputPrompt.show.value ||
    quickSearchOpen.value ||
    contextMenu.value.show ||
    projectMemoryOpen.value,
  () => dismissBlockingOverlays("escape"),
  ESCAPE_DISMISS_PRIORITY.MODAL + 5,
);

function handleStartNewSession() {
  expandChat();
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

async function copySessionNamePath(session: VibeChatSessionMeta) {
  const diskFile = vibeChatSessionDiskFilePath(session.id);
  const text = `${session.title}\n${diskFile}`;
  debugLog(`copySessionNamePath: title="${session.title}", path="${diskFile}"`);
  const ok = await copyText(text);
  if (sessionCopyHintTimer) clearTimeout(sessionCopyHintTimer);
  chatStoreSyncMessage.value = ok
    ? `已复制「${session.title}」的会话名和路径`
    : "复制失败，请手动选择复制";
  sessionCopyHintTimer = setTimeout(() => {
    sessionCopyHintTimer = null;
    if (chatStoreSyncMessage.value.startsWith("已复制") || chatStoreSyncMessage.value === "复制失败，请手动选择复制") {
      chatStoreSyncMessage.value = "";
    }
  }, 3000);
}

function patchAssistantMsg(msgId: string, patch: Partial<VibeChatMessage>, sessionId?: string) {
  if (patch.content !== undefined) {
    debugLog("[VibeCodingView] patchAssistantMsg content", {
      msgId: msgId.slice(0, 20),
      contentLen: patch.content.length,
      content: patch.content.slice(0, 80),
      hasRoundGroups: !!patch.roundGroups,
    });
  }

  const sid = (sessionId || activeSessionId.value).trim();
  const isActive = sid === activeSessionId.value;
  const apply = (list: VibeChatMessage[]) => {
    const idx = list.findIndex((m) => m.id === msgId);
    if (idx < 0) return false;
    Object.assign(list[idx]!, patch);
    return true;
  };
  if (isActive) {
    apply(chatMessages.value);
  } else if (sid && sendingSessionIdList.value.includes(sid)) {
    patchSessionMessage(sid, msgId, patch);
  }
}

async function handleAgentWrittenFiles(files: string[]) {
  if (!files.length) return;
  await refreshTree();
}

async function openPlanFileInEditor(relPath?: string) {
  dismissPlanPanelForeground();
  const rel = relPath?.trim();
  if (!rel) return;
  const root = projectPath.value.trim();
  if (!root) return;

  if (rel && isPlanDocumentPath(rel.replace(/\\/g, "/"))) {
    const normalizedRel = rel.replace(/\\/g, "/");
    const planMsg =
      chatMessages.value.find(
        (m) => m.role === "assistant" && m.planFilePath?.replace(/\\/g, "/") === normalizedRel,
      )
      ?? [...chatMessages.value].reverse().find(
        (m) => m.role === "assistant" && m.chatMode === "plan",
      );
    const planText = planMsg
      ? extractPlanContentFromStoredMessage(planMsg, planMsg.content || "").trim()
      : "";
    if (planText && planMsg?.id) {
      const ensured = await ensurePlanFileBeforeExecution(
        root,
        planText,
        planMsg.id,
        planMsg.planFilePath || rel,
      );
      if (ensured.planFilePath && planMsg.planFilePath !== ensured.planFilePath) {
        planMsg.planFilePath = ensured.planFilePath;
        patchAssistantMsg(planMsg.id, { planFilePath: ensured.planFilePath });
        planPanelApi?.patchFilePath(ensured.planFilePath, planMsg.id);
      }
    }
  }

  await refreshTree();
  const normalized = rel.replace(/\\/g, "/");
  const full = /^[a-zA-Z]:[/\\]/.test(normalized) || normalized.startsWith("/")
    ? normalized
    : `${root}/${normalized.replace(/^[/\\]+/, "")}`;
  await openFile(full);
}

function clearTurnFileDiffsFromStore(turnFileDiffs: Record<string, FileDiff>) {
  const next = { ...fileDiffs.value };
  for (const relPath of Object.keys(turnFileDiffs)) {
    const fullPath = resolveFullPathFromRel(relPath);
    delete next[normalizePathKey(fullPath)];
  }
  fileDiffs.value = next;
}

function userMessageImages(msg: VibeChatMessage): string[] {
  return resolveChatMessageImageUrls(
    projectPath.value.trim(),
    msg,
    activeSessionId.value || undefined,
  );
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
  return resolveResumeOriginalUserPrompt(chatMessages.value, assistantMsgId);
}

function findLastUserMessage(): {
  content: string;
  imageDataUrls?: string[];
} | null {
  for (let i = chatMessages.value.length - 1; i >= 0; i -= 1) {
    const m = chatMessages.value[i];
    if (m.role === "user") {
      return {
        content: m.content,
        imageDataUrls: m.imageDataUrls?.filter(Boolean)?.length
          ? [...m.imageDataUrls.filter(Boolean)]
          : undefined,
      };
    }
  }
  return null;
}

const autoBugFixLifecycle = {
  onAgentSettled: (_msg?: import("../types/vibeChat").VibeChatMessage) => {},
  onAgentInterrupted: (_reason?: string) => {},
  persistNow: () => {},
  tryRestore: () => false,
};

const agent = useAgentRun({
  chatMessages,
  chatSending,
  chatMode,
  chatError,
  projectPath,
  projectOpened,
  configReady,
  aiConfig,
  resolveSessionAiConfig: resolveSessionAiConfigForSession,
  activeAssistantMsgId,
  activeSessionId,
  activeFilePath,
  pendingPromptQueue,
  patchAssistantMsg,
  schedulePersistChat,
  schedulePersistDuringAgentRun,
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
  refreshTree,
  resolveUserMessageImages: userMessageImages,
  buildAgentHistory,
  buildAgentHistoryForResume,
  resolveOriginalUserPrompt,
  findLastUserMessage,
  beginAgentRunSession,
  endAgentRunSession,
  persistAgentRunSession,
  snapshotAgentRunSession,
  onAgentRunSettled: (msg) => {
    refreshSessionList();
    autoBugFixLifecycle.onAgentSettled(msg);
    const msgIndex = chatMessages.value.findIndex((m) => m.id === msg.id);
    let hadAttachedImage = false;
    for (let i = msgIndex - 1; i >= 0; i -= 1) {
      const prior = chatMessages.value[i];
      if (prior?.role === "user") {
        hadAttachedImage = Boolean(
          prior.imageDataUrls?.length || prior.imageRefs?.length || prior.imageCount,
        );
        break;
      }
    }
    const distill = distillExplorationRun({
      tools: msg.tools,
      writtenFiles: msg.writtenFiles,
      agentAborted: msg.agentAborted,
      agentFailed: msg.agentFailed,
      chatMode: msg.chatMode,
      totalTurns: msg.agentTurn,
      hadAttachedImage,
      assistantText: msg.content,
    });
    if (distill.offer) void applyExplorationDistillSilently(distill);
    if (msg.content) void trackMemoryUsageAfterRun(msg.content);
  },
  onMemoryProposal: (_msgId, proposal) => {
    addPendingMemoryProposal(proposal);
  },
  onSkillProposal: (_msgId, proposal) => {
    addPendingSkillProposal(proposal);
  },
  onPlanFileReady: (path, msgId) => {
    planPanelApi?.patchFilePath(path, msgId);
  },
});

const {
  agentLiveRevision,
  chainJumpVisible,
  stalledAssistantMsg,
  autoResumeSecondsLeft,
  autoResumeTargetId,
  runAgentTurn,
  runAutoBugFixAgent,
  resumeAgentRun,
  stopAgent,
  pauseAgent,
  interruptAgentRun,
  cancelAutoResume,
  isAgentRunning,
  isAssistantStalled,
  hasAgentActivity,
  messageDisplayContent,
  resolveLiveAgentSource,
  findLastAssistantContent,
  agentAbortDisplayReason,
  agentStatusDisplay,
  buildAgentRunningStatusTextForMsg,
  jumpChainToLatest,
  bindStatusLogScroll,
  onChainViewportScroll,
  forceRecoverStalledRun,
  shouldShowMessageBubble,
  canExecutePlanMessage,
  executePlanFromMessage,
  planExecutionActive,
  scheduleStreamScroll,
  clearStreamDeltaBuffer,
  tryResumeHmrInterruptedRun,
  getAgentAbortHandle,
  getActiveLiveContextChars,
  maybeAutoResumeLastRecoverableAssistant,
  stopAgentUiTick,
  hasActiveAgentRun,
} = agent;

const autoBugFix = useAutoBugFix(projectPath, projectOpened, activeSessionId, {
  startAgent: (params) => runAutoBugFixAgent(params),
  startNewSession,
  switchSession,
  getSessionMessages,
  expandChat,
  switchGitPanel: () => {
    gitPanelMode.value = "git";
  },
  stopFixAgent: (sessionId: string) => {
    const sid = sessionId.trim();
    if (sid && sid !== activeSessionId.value.trim()) {
      switchSession(sid);
    }
    interruptAgentRun({ reason: "已终止扫描修复" });
  },
});

const {
  phase: autoBugFixPhase,
  error: autoBugFixError,
  running: autoBugFixRunning,
  scanResult: autoBugFixScan,
  verifyResult: autoBugFixVerify,
  baselineVerify: autoBugFixBaselineVerify,
  postFixVerify: autoBugFixPostFixVerify,
  verifyComparison: autoBugFixVerifyComparison,
  lastSummary: autoBugFixSummary,
  includeWarnings: autoBugFixIncludeWarnings,
  includeLogicReview: autoBugFixIncludeLogicReview,
  assistantMsgId: autoBugFixAssistantMsgId,
  interruptedHint: autoBugFixInterruptedHint,
  canStopFix: autoBugFixCanStop,
  startAutoBugFix: startAutoBugFixFlow,
  runScanOnly: runAutoBugFixScanOnly,
  runVerifyOnly: runAutoBugFixVerifyOnly,
  persistNow: persistAutoBugFixNow,
  tryRestoreFromStorage: tryRestoreAutoBugFixFromStorage,
  cancelAutoBugFix: stopAutoBugFixFlow,
} = autoBugFix;

autoBugFixLifecycle.onAgentSettled = (msg) => autoBugFix.onAgentSettled(msg);
autoBugFixLifecycle.onAgentInterrupted = (reason) => autoBugFix.onAgentInterrupted(reason);
autoBugFixLifecycle.persistNow = () => autoBugFix.persistNow();
autoBugFixLifecycle.tryRestore = () => tryRestoreAutoBugFixFromStorage(chatMessages.value);

const autoBugFixShowResume = computed(() => {
  if (!autoBugFixAssistantMsgId.value) return false;
  const msg = chatMessages.value.find((m) => m.id === autoBugFixAssistantMsgId.value);
  return Boolean(msg && canResumeAgentRun(msg));
});

function stopAutoBugFixFromPanel() {
  stopAutoBugFixFlow();
}

function restoreAutoBugFixPanelIfNeeded() {
  if (!projectOpened.value || !projectPath.value.trim()) return;
  tryRestoreAutoBugFixFromStorage(chatMessages.value);
  // Tab 由 localStorage（vibe-coding-git-panel-mode）恢复，不在此覆盖
  if (
    gitPanelMode.value === "project"
    && projectPanelView.value === "fix"
    && editorCollapsed.value
  ) {
    expandEditor();
  }
}

function resumeAutoBugFixFromPanel() {
  const msgId = autoBugFixAssistantMsgId.value;
  if (!msgId) return;
  expandChat();
  void resumeAgentRun(msgId);
}

function openGitPanelFromAutoFix() {
  gitPanelMode.value = "git";
}

const planPanel = usePlanPanel({
  chatMessages,
  chatSending,
  agentLiveRevision,
  projectPath,
  projectOpened,
  activeSessionId,
  messageDisplayContent,
  isAgentRunning,
  canExecutePlanMessage,
  expandEditor,
  shouldSkipLayoutEffects: () => restoringWorkspaceUi.value,
});
planPanelApi = planPanel;

const {
  active: planPanelActive,
  content: planPanelContent,
  streaming: planPanelStreaming,
  messageId: planPanelMessageId,
  planFilePath: planPanelFilePath,
  canExecute: planPanelCanExecute,
  userDismissed: planUserDismissed,
  pinnedMessageId: planPinnedMessageId,
  focusPanel: focusPlanPanelBase,
  closePanel: closePlanPanelBase,
} = planPanel;

const {
  quoteButtonPosition,
  showQuoteButton,
  hideQuoteButtonNow,
  quoteSelectedText,
  onMessageSelect,
  onMessageDoubleClick,
  onPlanPanelMouseUp,
  onPlanPanelDoubleClick,
  onEditorSelect,
} = useMessageQuote({
  quoteButtonRef,
  getChatScrollEl: () => chatPanelRef.value?.chatScrollRef,
  expandChat,
  focusComposer: () => {
    composerRef.value?.focus();
  },
  planPanelMessageId,
  planWorkspaceOpen,
  activeFilePath,
  activeFileRelativePath,
  onQuoteReady: (content, filePath) => {
    composerRef.value?.insertQuote(content, filePath);
  },
});

const workspaceUi = useWorkspaceUiPersistence({
  projectPath,
  projectOpened,
  expandedDirs,
  selectedTreePath,
  showDiffMode,
  getChatScrollTop: () => chatPanelRef.value?.chatScrollRef?.scrollTop ?? 0,
  getChatPinnedToBottom: () => chatPinnedToBottom,
  setChatPinnedToBottom: (pinned) => {
    chatPinnedToBottom = pinned;
  },
  git: {
    gitLogOpen,
    gitStagedOpen,
    gitUnstagedOpen,
    gitUntrackedOpen,
    gitStashOpen,
    gitAheadCommitsOpen,
    gitBehindCommitsOpen,
    batchSectionOpen,
    gitStashSectionOpen,
    gitLocalChangesOpen,
    selectedGitFiles,
    expandedGitLogEntries,
    gitLogSearchQuery,
    gitLogAllBranches,
  },
  planPanelInForeground,
  planPanelActive,
  planUserDismissed,
  planPinnedMessageId,
  quickSearchOpen,
  restoringRef: restoringWorkspaceUi,
});

/** 一键折叠文件树：仅保留项目根目录展开 */
function collapseAllDirs() {
  const normalized = projectPath.value.trim();
  expandedDirs.value = new Set(normalized ? [normalized] : []);
  workspaceUi.persistNow();
}

async function restoreWorkspaceLayoutAfterOpen(savedUiHint: Awaited<ReturnType<typeof workspaceUi.restoreLayoutState>> = null) {
  const normalized = projectPath.value.trim();
  const savedUi = savedUiHint ?? await workspaceUi.restoreLayoutState();
  if (!savedUi?.expandedDirs?.length) {
    expandedDirs.value = new Set([normalized]);
  }
  if (openTabs.value.length === 0) {
    selectedTreePath.value = savedUi?.selectedTreePath || normalized;
  }
  await reloadExpandedDirChildren();
  await restoreEditorWorkspace();
  syncEditorPanelForOpenFiles();
  if (savedUi?.selectedTreePath && openTabs.value.length === 0) {
    selectedTreePath.value = savedUi.selectedTreePath;
  }
  if (savedUi?.planPanelActive && !savedUi.planUserDismissed) {
    await planPanel.syncFromChat({ force: true });
  }
  restoreChatScrollPosition(
    savedUi,
    () => chatPanelRef.value?.chatScrollRef,
    () => { void scrollChatToBottom(true); },
  );
  return savedUi;
}

function focusPlanPanel(messageId?: string) {
  planPanelInForeground.value = true;
  focusPlanPanelBase(messageId);
}

function closePlanPanel() {
  planPanelInForeground.value = false;
  closePlanPanelBase();
  if (openTabs.value.length === 0) {
    collapseEditor();
  }
}

function focusGitPanel() {
  gitPanelInForeground.value = true;
}

function closeGitPanel() {
  gitPanelInForeground.value = false;
}

function dismissGitPanelForeground() {
  gitPanelInForeground.value = false;
}

watch(
  planPanelActive,
  (open) => {
    planWorkspaceOpen.value = open;
    if (!open) planPanelInForeground.value = false;
  },
  { immediate: true },
);

const totalTokenUsage = computed(() => {
  let totalStreamChars = 0;
  let maxContextChars = 0;
  let hasTokenData = false;

  for (const msg of chatMessages.value) {
    if (msg.role === "assistant") {
      if (msg.streamChars && msg.streamChars > 0) {
        totalStreamChars += msg.streamChars;
        hasTokenData = true;
      }
      if (msg.contextChars && msg.contextChars > 0) {
        maxContextChars = Math.max(maxContextChars, msg.contextChars);
        hasTokenData = true;
      }
    }
  }

  void agentLiveRevision.value;
  const currentRunContextChars = chatSending.value ? getActiveLiveContextChars() : 0;

  if (!hasTokenData && !currentRunContextChars) return "";

  const parts: string[] = [];
  if (totalStreamChars > 0) {
    parts.push(`${formatCharCount(totalStreamChars)} 输出`);
  }
  const contextChars = chatSending.value && currentRunContextChars > 0
    ? currentRunContextChars
    : maxContextChars;
  if (contextChars > 0) {
    parts.push(`${formatCharCount(contextChars)} ${chatSending.value ? "本轮上下文" : "峰值上下文"}`);
  }
  return parts.join(" · ");
});

chatSessionHooks.scrollToBottom = scrollChatToBottom;
chatSessionHooks.onAfterSwitch = maybeAutoResumeLastRecoverableAssistant;

const agentRunningStatusText = computed(() => {
  if (!chatSending.value) return "";
  for (let i = chatMessages.value.length - 1; i >= 0; i -= 1) {
    const m = chatMessages.value[i];
    if (m?.role !== "assistant") continue;
    if (isAgentRunning(m)) return buildAgentRunningStatusTextForMsg(m);
    return buildAgentRunningStatusTextForMsg(m);
  }
  return "";
});

const agentRunStageLabelText = computed(() => {
  for (let i = chatMessages.value.length - 1; i >= 0; i -= 1) {
    const m = chatMessages.value[i];
    if (m?.role !== "assistant") continue;
    if (isAgentRunning(m)) {
      return agentRunStageLabel(
        resolveAgentRunStage({ phase: m.agentPhase || "", toolTitle: m.status }),
      );
    }
    if (m.pendingApproval) return "等待确认";
    if (chatSending.value) return "思考中";
    break;
  }
  return "";
});

const agentPendingApproval = computed(() => {
  if (chatSending.value) return false;
  for (let i = chatMessages.value.length - 1; i >= 0; i -= 1) {
    const m = chatMessages.value[i];
    if (m?.role !== "assistant") continue;
    return Boolean(m.pendingApproval);
  }
  return false;
});

function findLastCompletedAssistantMessage(): VibeChatMessage | undefined {
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

  const previousPath = projectPath.value.trim();
  if (
    projectOpened.value &&
    previousPath &&
    normalizeProjectPathUtil(previousPath) === normalizeProjectPathUtil(normalized)
  ) {
    treeError.value = "已在当前项目中";
    return;
  }

  if (!(await ensureCanLeaveAllOpenTabs())) return;

  const gen = ++projectSwitchGeneration;

  const t0 = performance.now();
  const timings: string[] = [];
  const log = (label: string) => {
    const ms = Math.round(performance.now() - t0);
    timings.push(`${label}: ${ms}ms`);
  };

  const flushLog = (result: string) => {
    if (!isTauriEnv()) return;
    const line = `[${new Date().toISOString()}] ${normalized} | ${result}`;
    appendDebugLogFile("tab-perf.log", line, normalized);
  };

  const previousPathForPersist = projectPath.value.trim();
  switchingProject.value = true;
  if (projectOpened.value && previousPathForPersist) {
    pendingPromptQueue.value = [];
    persistPendingQueue();
    cancelPendingChatPersistence();
    for (const sid of sendingSessionIdList.value) {
      persistSessionNow(sid, previousPathForPersist, { touchTimestamp: false });
    }
    persistChatNow(previousPathForPersist, { flushStore: true });
  }
  if (sendingSessionIdList.value.length) interruptAgentRun();
  sendingSessionIdList.value = [];
  chatSending.value = false;
  leaveProjectKnowledge();
  onReviewProjectClosed();
  log("persist-prev");
  if (projectOpened.value && previousPathForPersist) {
    workspaceUi.persistNow();
    persistEditorWorkspace();
  }
  prepareEditorWorkspaceProjectSwitch();

  loadingTree.value = true;
  treeError.value = "";
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

    if (gen !== projectSwitchGeneration) return;
    const tChat0 = performance.now();
    log(`chat-check`);

    treeError.value = "";
    fileTree.value = items;
    projectOpened.value = true;
    projectPath.value = normalized;
    setDebugLogProjectRoot(normalized);
    lsSet(STORAGE_KEY, normalized);
    addProjectToHistory(normalized);
    refreshProjectHistoryList();
    log("set-state");

    const savedUi = await workspaceUi.restoreLayoutState();
    if (!savedUi?.expandedDirs?.length) {
      expandedDirs.value = new Set([normalized]);
    }
    if (openTabs.value.length === 0) {
      selectedTreePath.value = savedUi?.selectedTreePath || normalized;
    }
    await reloadExpandedDirChildren();

    // 切换项目时重置 UI 状态，清除旧项目的会话缓存
    resetUiForProjectSwitch(previousPathForPersist);

    const chatState = await loadProjectChatState(normalized);
    if (gen !== projectSwitchGeneration) return;

    activateSession(
      chatState.activeSessionId,
      normalizeChatMessages(chatState.messages, { stripTransientUi: true }),
    );
    refreshSessionList(normalized);

    log(`chat-active(${chatState.activeSessionId}, ${chatState.messages.length}msgs)`);

    loadingTree.value = false;
    void refreshGitStatus();
    void refreshGitRepos();
    log(`chat-done(${Math.round(performance.now() - tChat0)}ms)`);

    void startFileWatcherForProject(normalized, () => refreshGitStatus({ showLoading: false })).catch(() => {});

    await restoreWorkspaceLayoutAfterOpen(savedUi);
    maybeAutoResumeLastRecoverableAssistant();
    tryResumeHmrInterruptedRun();

    log("final");

    flushLog(`total=${Math.round(performance.now() - t0)}ms | ${timings.join(" → ")}`);
  } catch (e) {
    if (gen === projectSwitchGeneration) {
      projectOpened.value = false;
      fileTree.value = [];
    }
    treeError.value = formatFetchError(e, "打开项目失败（已重试）");
    flushLog(`FAILED total=${Math.round(performance.now() - t0)}ms | ${timings.join(" → ")}`);
  } finally {
    loadingTree.value = false;
    switchingProject.value = false;
    if (gen === projectSwitchGeneration) {
      finishEditorWorkspaceProjectSwitch();
    }
  }
}

async function handleOpenProject() {
  if (openingProject.value) return;
  openingProject.value = true;
  pickingFolder.value = true;
  treeError.value = "";

  try {
    const currentPath = projectPath.value.trim();
    // 切换项目时，打开父目录而不是当前项目目录，方便选择其他项目
    const initialDir = currentPath ? currentPath.replace(/[\\/][^\\/]+$/, "") : currentPath;
    const picked = await pickProjectFolder(initialDir);
    if (picked.cancelled) return;
    if (!picked.ok || !picked.path) {
      treeError.value = picked.error || "未选择文件夹";
      return;
    }
    await openProjectByPath(picked.path);
  } catch (e) {
    treeError.value = formatFetchError(e, "切换项目失败");
  } finally {
    pickingFolder.value = false;
    openingProject.value = false;
  }
}

async function openCurrentFolderInExplorer() {
  const folder = projectPath.value.trim();
  if (!folder || !projectOpened.value) return;
  const result = await openProjectFolderInExplorer(folder);
  if (!result.ok && result.error) {
    treeError.value = result.error;
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
  const menuW = 200;
  const menuH = 340;
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
  if (!path) return;
  attachFileToChat(path, node?.name);
}

function contextMenuCopyRelativePath() {
  const path = contextMenu.value.path;
  hideContextMenu();
  if (!path) return;
  const node = findNode(fileTree.value, path);
  const ref = buildReferencedFile(path, node?.name ?? fileName(path));
  void copyText(ref.relative);
}

function contextMenuCopyFullPath() {
  const path = contextMenu.value.path;
  hideContextMenu();
  if (!path) return;
  void copyText(path);
}

function contextMenuRevealInFolder() {
  const path = contextMenu.value.path;
  hideContextMenu();
  if (!path) return;
  import("@tauri-apps/plugin-opener").then(({ revealItemInDir }) =>
    revealItemInDir(path).catch(() => {}),
  );
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

function applyExample(text: string) {
  composerRef.value?.setPlainText(text);
}

function onComposerImageError(message: string) {
  chatError.value = message;
}

function onGitFilePointerDown(e: PointerEvent, relativePath: string, listScope: GitFileListScope = "modified") {
  // 跳过文件夹条目（以 / 结尾），文件夹无需获取 diff
  if (relativePath.endsWith('/')) return

  const shiftKey = e.shiftKey;
  const ctrlKey = e.ctrlKey || e.metaKey;
  const staged = gitFileListScopeIsStaged(listScope);
  
  if (shiftKey || ctrlKey) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  toggleGitFileSelection(relativePath, shiftKey, ctrlKey, listScope);
  
  if (!shiftKey && !ctrlKey) {
    const fullPath = resolveFullPathFromRel(relativePath);
    startPathDrag(fullPath, fileName(relativePath), e, () => {
      void showGitFileDiff(relativePath, staged);
    }, getChatDropZoneEl());
  }
}

function onGitFileContextMenu(e: MouseEvent, path: string, listScope: GitFileListScope = "modified") {
  // 右键未选中该分区条目时，改为只选中该分区文件；已在多选内则保持选择
  const staged = gitFileListScopeIsStaged(listScope);
  const key = gitFileSelectionKey(path, staged);
  if (!selectedGitFiles.value.includes(key)) {
    selectedGitFiles.value = [key];
  }
  const selected = selectedGitFiles.value
    .map((k) => parseGitFileSelectionKey(k))
    .filter((x): x is { path: string; staged: boolean } => !!x);
  const itemCount =
    1
    + (selected.some((s) => !s.staged && gitUnstagedFiles.value.some((f) => f.path === s.path)) ? 2 : 0)
    + (selected.some((s) => s.staged && gitStagedFiles.value.some((f) => f.path === s.path)) ? 1 : 0)
    + (listScope === "ignored-local" ? 1 : 0);
  const menuW = 160;
  const menuH = Math.min(40 + itemCount * 32, 200);
  const clampedX = Math.min(e.clientX, window.innerWidth - menuW);
  const clampedY = Math.min(e.clientY, window.innerHeight - menuH);
  gitFileContextMenu.value = { show: true, x: Math.max(0, clampedX), y: Math.max(0, clampedY), path, scope: listScope };
}

function hideGitFileContextMenu() {
  gitFileContextMenu.value.show = false;
}

const gitFileCtxCanStage = computed(() =>
  selectedGitFiles.value.some((key) => {
    const parsed = parseGitFileSelectionKey(key);
    return !!parsed && !parsed.staged && gitUnstagedFiles.value.some((f) => f.path === parsed.path);
  }),
);
const gitFileCtxCanUnstage = computed(() =>
  selectedGitFiles.value.some((key) => {
    const parsed = parseGitFileSelectionKey(key);
    return !!parsed && parsed.staged && gitStagedFiles.value.some((f) => f.path === parsed.path);
  }),
);
const gitFileCtxCanDiscard = computed(() => gitFileCtxCanStage.value);
const gitFileCtxCanIgnore = computed(() =>
  gitFileContextMenu.value.scope === "ignored-local"
    ? false
    : selectedGitFiles.value.some((key) => {
        const parsed = parseGitFileSelectionKey(key);
        return (
          !!parsed &&
          !parsed.staged &&
          gitModifiedFiles.value.some((f) => f.path === parsed.path)
        );
      }),
);
const gitFileCtxCanUnignore = computed(() =>
  gitFileContextMenu.value.scope === "ignored-local"
    ? gitIgnoredLocalFiles.value.some((p) => p === gitFileContextMenu.value.path)
    : selectedGitFiles.value.some((key) => {
        const parsed = parseGitFileSelectionKey(key);
        return !!parsed && gitIgnoredLocalFiles.value.includes(parsed.path);
      }),
);

async function gitFileCtxIgnore() {
  hideGitFileContextMenu();
  await ignoreSelectedFiles();
}

async function gitFileCtxUnignore() {
  hideGitFileContextMenu();
  await unignoreSelectedFiles();
}

function gitFileCopyName() {
  const path = gitFileContextMenu.value.path;
  void copyText(fileName(path));
  hideGitFileContextMenu();
}

function gitFileCopyFullPath() {
  const relPath = gitFileContextMenu.value.path;
  const fullPath = resolveFullPathFromRel(relPath);
  void copyText(fullPath);
  hideGitFileContextMenu();
}

function gitFileRevealInFolder() {
  const relPath = gitFileContextMenu.value.path;
  const fullPath = resolveFullPathFromRel(relPath);
  hideGitFileContextMenu();
  if (fullPath) {
    import("@tauri-apps/plugin-opener").then(({ revealItemInDir }) =>
      revealItemInDir(fullPath).catch(() => {}),
    );
  }
}

function gitFileOpenInEditor() {
  const relPath = gitFileContextMenu.value.path;
  const fullPath = resolveFullPathFromRel(relPath);
  hideGitFileContextMenu();
  if (fullPath) void openFile(fullPath);
}

async function gitFileCtxStage() {
  hideGitFileContextMenu();
  await stageSelectedFiles();
}

async function gitFileCtxUnstage() {
  hideGitFileContextMenu();
  await unstageSelectedFiles();
}

async function gitFileCtxDiscard(event: MouseEvent) {
  hideGitFileContextMenu();
  await discardSelectedFiles(event);
}

// 多选时点击单个文件的操作按钮 → 批量处理（选中集合 ∪ 点击的文件）
function stageSelectedWith(path: string) {
  void stageSelectedFiles(path);
}

function unstageSelectedWith(path: string) {
  void unstageSelectedFiles(path);
}

function discardSelectedWith(path: string, event: MouseEvent) {
  void discardSelectedFiles(path, event);
}

async function onSaveFile() {
  const savedPath = activeFilePath.value;
  const ok = await saveFile();
  if (ok && isProjectKnowledgeFilePath(savedPath)) {
    scheduleKnowledgeReloadFromDisk();
  }
}

function onFileDragStart(node: TreeNode, x: number, y: number) {
  fileDrag.onFileDragStart(node, x, y, getChatDropZoneEl());
}
function onFileDragMove(x: number, y: number) {
  fileDrag.onFileDragMove(x, y, getChatDropZoneEl());
}
function onFileDragEnd(node: TreeNode, x: number, y: number) {
  fileDrag.onFileDragEnd(node, x, y, getChatDropZoneEl());
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

  patchAssistantMsg(messageId, { applying: true, reverting: false });
  chatError.value = "";
  try {
    clearTurnFileDiffsFromStore(msg.turnFileDiffs);
    patchAssistantMsg(messageId, {
      pendingApproval: false,
      applying: false,
      writtenFiles: msg.writtenFiles ?? Object.keys(msg.turnFileDiffs),
    });
    persistChatNow();
    await refreshGitStatus({ showLoading: false });
  } catch (error) {
    patchAssistantMsg(messageId, { applying: false });
    chatError.value = error instanceof Error ? error.message : "确认修改失败";
  }
}

async function rejectAgentTurn(messageId: string, event?: MouseEvent) {
  if (chatSending.value || !projectOpened.value) return;
  const msg = chatMessages.value.find((m) => m.id === messageId);
  if (!msg?.pendingApproval || !msg.turnFileDiffs) return;
  if (!await confirm("确定拒绝本轮所有修改并回滚文件？", event)) return;

  patchAssistantMsg(messageId, { reverting: true });
  chatError.value = "";
  try {
    await revertTurnFileDiffs({
      turnFileDiffs: msg.turnFileDiffs,
      projectPath: projectPath.value,
      resolveFullPathFromRel,
      removeOpenTabForPath,
      clearFileDiffForPath: (fullPath) => {
        const key = normalizePathKey(fullPath);
        if (fileDiffs.value[key]) {
          const next = { ...fileDiffs.value };
          delete next[key];
          fileDiffs.value = next;
        }
      },
      reloadOpenFile: async (fullPath) => {
        if (activeFilePath.value && normalizePathKey(activeFilePath.value) === normalizePathKey(fullPath)) {
          await openFile(fullPath);
          showDiffMode.value = false;
        }
      },
    });
    clearTurnFileDiffsFromStore(msg.turnFileDiffs);
    showDiffMode.value = false;
    patchAssistantMsg(messageId, {
      pendingApproval: false,
      rejected: true,
      reverting: false,
      writtenFiles: undefined,
    });
    persistChatNow();
    await refreshTree();
    await refreshGitStatus({ showLoading: false });
  } catch (error) {
    patchAssistantMsg(messageId, { reverting: false });
    chatError.value = error instanceof Error ? error.message : "拒绝修改失败";
  }
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
  const msg = chatMessages.value.find((m) => m.id === messageId);
  if (!msg?.turnFileDiffs || msg.reverted || msg.pendingApproval) return;

  const fileCount = Object.keys(msg.turnFileDiffs).length;
  if (!await confirm(`确定回滚本轮 Agent 对 ${fileCount} 个文件的修改？`, event)) return;

  patchAssistantMsg(messageId, { reverting: true });
  chatError.value = "";

  try {
    await revertTurnFileDiffs({
      turnFileDiffs: msg.turnFileDiffs,
      projectPath: projectPath.value,
      resolveFullPathFromRel,
      removeOpenTabForPath,
      clearFileDiffForPath: (fullPath) => {
        const key = normalizePathKey(fullPath);
        if (fileDiffs.value[key]) {
          const next = { ...fileDiffs.value };
          delete next[key];
          fileDiffs.value = next;
        }
      },
      reloadOpenFile: async (fullPath) => {
        if (activeFilePath.value && normalizePathKey(activeFilePath.value) === normalizePathKey(fullPath)) {
          await openFile(fullPath);
          showDiffMode.value = false;
        }
      },
    });

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
    while (
      end + 1 < chatMessages.value.length
      && chatMessages.value[end + 1]?.role === "assistant"
    ) {
      end += 1;
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
  }).catch((err: unknown) => {
    debugLog("confirm failed:", err);
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

  chatMessages.value.splice(userIdx);
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
    const node =
      findNode(fileTree.value, file.path)
      || findNodeByKey(fileTree.value, normalizePathKey(file.path));
    chunks.push(`### ${node?.isDirectory ? "📁" : "📄"} ${file.relative}`);
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
    const node =
      findNode(fileTree.value, file.path)
      || findNodeByKey(fileTree.value, normalizePathKey(file.path));
    if (node?.isDirectory) {
      chunks.push(`### 📁 ${file.relative}`);
      continue;
    }
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
    ensureSessionForSend();
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

  ensureSessionForSend();
  void runAgentTurn(userText, runOptions);
}

function handleAiOptionSelect(
  option: { index: number; label: string; fullText: string; action?: "implement" },
  msg?: VibeChatMessage,
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
    ensureSessionForSend();
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

  ensureSessionForSend();
  void runAgentTurn(userText, runOptions);
}

function restoreComposerPayload(
  composer: InstanceType<typeof ChatComposerEditor>,
  payload: ReturnType<InstanceType<typeof ChatComposerEditor>["extractPayload"]>,
) {
  const text = payload.text.trim();
  composer.setPlainText(text);
  for (const url of payload.imageDataUrls) {
    if (url) composer.insertImage(url);
  }
  for (const ref of payload.refs) {
    if (ref.path) composer.insertFileRef(ref);
  }
  for (const drop of payload.drops) {
    composer.insertDroppedFile(drop);
  }
}

async function sendChat() {
  if (!canSendChat.value) return;
  dismissAgentSuggestions();
  const composer = composerRef.value;
  if (!composer) return;

  const payload = composer.extractPayload();
  mentionOpen.value = false;

  const userText = payload.text.trim();
  const imageDataUrls = payload.imageDataUrls.filter(Boolean);
  let fullPrompt = userText || (imageDataUrls.length ? "请结合附带的图片回答。" : "请结合引用的文件回答。");

  let bubbleText = userText;

  let composerCleared = false;
  try {
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

    // 无活跃会话时仅在发送瞬间创建 chat-store 会话，不打字建会话
    let sendSessionId = activeSessionId.value.trim();
    if (!sendSessionId) {
      sendSessionId = ensureSessionForSend();
      if (!sendSessionId) return;
    }

    if (activeSessionId.value !== sendSessionId) {
      chatError.value = "会话已切换，发送已取消";
      return;
    }

    const runOptions = {
      referencedFiles: payload.refs.map((r) => r.relative || r.path).filter(Boolean),
      imageDataUrls,
      userBubbleContent: bubbleText,
      sessionId: sendSessionId,
    };

    composer.clear();
    composerCleared = true;

    let started = false;
    if (chatSending.value) {
      chatMessages.value.push({
        id: genId(),
        role: "user",
        content: bubbleText || (imageDataUrls.length ? "（附图）" : ""),
        imageDataUrls: imageDataUrls.length ? [...imageDataUrls] : undefined,
      });
      interruptAgentRun();
      persistChatNow(undefined, { sessionId: sendSessionId });
      void scrollChatToBottom(true);
      started = await runAgentTurn(fullPrompt, { ...runOptions, skipUserBubble: true });
    } else {
      started = await runAgentTurn(fullPrompt, runOptions);
    }

    if (!started) {
      restoreComposerPayload(composer, payload);
    }
  } catch (error) {
    if (composerCleared) {
      restoreComposerPayload(composer, payload);
    }
    chatError.value = error instanceof Error ? error.message : "发送失败";
  }
}

function onWindowFocus() {
  dismissBlockingOverlays("window-focus");
  reloadAiConfig();
}

function onBeforeUnload() {
  if (chatSending.value && getAgentAbortHandle()) {
    const lastUser = findLastUserMessage();
    if (lastUser) {
      persistAgentRunForHmr({
        request: {
          prompt: lastUser.content,
          ...(lastUser.imageDataUrls?.length
            ? { imageDataUrls: lastUser.imageDataUrls }
            : {}),
        },
        projectPath: projectPath.value.trim(),
        sessionId: activeSessionId.value || undefined,
      });
    }
  }
  flushBatchDraftPersist();
  workspaceUi.persistNow();
  persistEditorWorkspace();
  autoBugFixLifecycle.persistNow();
}

watch(chatMode, (mode) => {
  if (mode === "explore") return;
  lsSet(CHAT_MODE_KEY, mode);
});

watch(gitAheadCommitsOpen, (open) => {
  if (open && projectOpened.value && gitIsRepo.value && gitAhead.value > 0 && !gitAheadCommits.value.length) {
    void refreshGitAheadCommits();
  }
});

watch(gitBehindCommitsOpen, (open) => {
  if (open && projectOpened.value && gitIsRepo.value && gitBehind.value > 0 && !gitBehindCommits.value.length) {
    void refreshGitBehindCommits();
  }
});

watch(
  () => {
    if (chatSending.value) return "";
    return chatMessages.value.map((m) => `${m.id}:${m.content?.length ?? 0}`).join("|");
  },
  () => {
    if (switchingProject.value || switchingSession.value) return;
    schedulePersistChat();
  },
);

watch(
  () => {
    if (!chatSending.value) return "";
    const last = chatMessages.value[chatMessages.value.length - 1];
    if (!last) return "";
    const activeNarrative =
      last.roundGroups?.find((g) => g.turn === last.agentTurn)?.narrative ??
      last.roundGroups?.filter((g) => g.turn > 0).at(-1)?.narrative ??
      "";
    return [
      agentLiveRevision.value,
      last.agentPhase ?? "",
      last.status ?? "",
      last.content?.length ?? 0,
      last.streamChars ?? 0,
      activeNarrative.length,
      last.tools?.length ?? 0,
    ].join("|");
  },
  () => {
    if (chatSending.value) scheduleStreamScroll();
  },
  { flush: "post" },
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
    const sid = activeSessionId.value.trim();
    if (!sid) return;
    const token = ++chatImageHydrateToken;
    void (async () => {
      const next = await applyVibeChatMessageImageHydration(chatMessages.value);
      if (token !== chatImageHydrateToken) return;
      if (activeSessionId.value.trim() !== sid) return;
      const live = getSessionMessages(sid);
      if (!live?.length || live !== chatMessages.value) return;
      for (let i = 0; i < next.length; i += 1) {
        const patch = next[i];
        if (!patch?.id) continue;
        const idx = live.findIndex((m) => m.id === patch.id);
        if (idx >= 0) Object.assign(live[idx]!, patch);
      }
    })();
  },
);

provide(vibeChatMessageContextKey, {
  chatMessages,
  chatSending,
  agentLiveRevision,
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
  pauseAgent,
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
  resolveLiveAgentSource,
  jumpChainToLatest,
  bindStatusLogScroll,
  onStatusLogScroll: onChainViewportScroll,
  userMessageImages,
  shouldShowMessageBubble,
  handleAiOptionSelect,
  previewAgentFile,
  acceptAgentTurn,
  rejectAgentTurn,
  revertAgentTurn,
  formatPendingApprovalLabel,
  truncateDiffPreview,
  toggleExpandedDiff,
  isDiffExpanded,
  canExecutePlanMessage,
  executePlanFromMessage,
  planExecutionActive,
  openPlanFileInEditor,
  planPanelActive,
  planPanelMessageId,
  planWorkspaceOpen,
  focusPlanPanel,
} as VibeChatMessageContext);

function reconcileOrphanedAgentSendingState() {
  dismissBlockingOverlays("mount-reconcile");
  hideGitFileContextMenu();

  const orphaned = sendingSessionIdList.value.filter((sid) => !hasActiveAgentRun(sid));

  if (!sendingSessionIdList.value.length) return;
  for (const sid of orphaned) {
    endAgentRunSession(sid, true);
  }
}

onMounted(() => {
  registerOverlayDismissDeps({
    dismissConfirm: dismissPendingConfirm,
    dismissInput: () => inputPrompt.dismissPendingOverlay(),
    hideContextMenu,
    hideGitFileContextMenu,
    closeProjectMemory: closeProjectMemoryEditor,
    closeQuickSearch: () => {
      quickSearchOpen.value = false;
    },
  });
  reconcileOrphanedAgentSendingState();
  reloadAiConfig();
  refreshProjectHistoryList();
  const savedQueue = lsGetJson<string[]>(PENDING_QUEUE_KEY);
  pendingPromptQueue.value = Array.isArray(savedQueue)
    ? savedQueue.filter((item) => typeof item === "string" && item.trim())
    : [];
  loadSavedProject();
  chatPanelWidth.value = Math.min(chatPanelWidth.value, getChatPanelMaxWidth());
  window.addEventListener("focus", onWindowFocus);
  window.addEventListener("beforeunload", onBeforeUnload);
  window.addEventListener("dragend", onWindowDragEnd);
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
          request: {
            prompt: lastUser.content,
            ...(lastUser.imageDataUrls?.length
              ? { imageDataUrls: lastUser.imageDataUrls }
              : {}),
          },
          projectPath: projectPath.value.trim(),
          sessionId: activeSessionId.value || undefined,
        });
      }
    }
  });
  // 页面加载后检查是否有因 HMR 中断的 Agent 运行（项目打开后由 openProjectByPath 触发恢复）
  nextTick(() => {
    restoreAutoBugFixPanelIfNeeded();
  });
});

onBeforeUnmount(() => {
  fileDragGhost.value = null;
  window.removeEventListener("focus", onWindowFocus);
  window.removeEventListener("beforeunload", onBeforeUnload);
  window.removeEventListener("dragend", onWindowDragEnd);
  document.removeEventListener("dragover", onDocumentDragOverCapture, true);
  document.removeEventListener("drop", onDocumentDropCapture, true);
  if (chatSending.value && getAgentAbortHandle()) {
    autoBugFixLifecycle.onAgentInterrupted(HMR_INTERRUPT_REASON);
    interruptAgentRun({ reason: HMR_INTERRUPT_REASON });
  } else {
    getAgentAbortHandle()?.abort();
  }
  clearStreamDeltaBuffer();
  stopResize();
  if (scrollChatRaf) cancelAnimationFrame(scrollChatRaf);
  cancelPendingChatPersistence();
  stopAgentUiTick();
  clearRetryTimer();
  if (sessionCopyHintTimer) {
    clearTimeout(sessionCopyHintTimer);
    sessionCopyHintTimer = null;
  }
  cancelAutoResume();
  workspaceUi.persistNow();
  autoBugFixLifecycle.persistNow();
  persistEditorWorkspace();
  persistChatNow(undefined, { flushStore: true });
  stopFileWatcherForProject();
});
</script>


