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
      <FilePanel
        :file-panel-width="filePanelWidth"
        :git-panel-mode="gitPanelMode"
        :project-opened="projectOpened"
        :search-mode="searchMode"
        :search-query="searchQuery"
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

        <div v-if="gitPanelMode === 'git'" class="git-panel">
          <div v-if="!projectOpened" class="panel-empty">请先打开项目文件夹</div>
          <div v-else-if="gitLoading" class="panel-empty">加载中…</div>
          <div v-else-if="gitIsRepo" class="git-panel-content">
            <div class="git-header">
              <!-- 第一行：分支名 + 操作按钮 -->
              <div class="git-header-row git-branch-row">
                <div class="git-branch-info">
                  <span class="git-branch-icon" aria-hidden="true">⎇</span>
                  <span class="git-branch-name" :title="gitBranch">{{ gitBranch }}</span>
                  <span v-if="gitTrackingBranch" class="git-tracking-badge" :title="'跟踪: ' + gitTrackingBranch">
                    ⟶ {{ gitTrackingBranch.replace(/^[^/]+\//, '') }}
                  </span>
                </div>
                <button type="button" class="ghost tiny" :disabled="gitLoading" @click="() => refreshGitStatus()">刷新</button>
                <span
                  v-if="fileWatcherActive"
                  class="file-watcher-dot"
                  :class="{ connected: fileWatcherConnected }"
                  :title="fileWatcherConnected ? '文件监控已连接' : '文件监控重连中…'"
                />
              </div>
              <!-- 第二行：同步操作 -->
              <div v-if="gitRemotes.length" class="git-header-row git-sync-row">
                <div class="git-sync-info">
                  <span class="git-sync-stat" :class="{ ahead: gitAhead > 0, behind: gitBehind > 0 }">
                    <span class="git-sync-arrow">↑</span>{{ gitAhead }}
                  </span>
                  <span class="git-sync-stat" :class="{ ahead: gitAhead > 0, behind: gitBehind > 0 }">
                    <span class="git-sync-arrow">↓</span>{{ gitBehind }}
                  </span>
                </div>
                <div class="git-remote-actions">
                  <button type="button" class="ghost tiny" :disabled="!!gitRemoteAction" @click="doFetch">
                    {{ gitRemoteAction === 'fetch' ? '…' : 'Fetch' }}
                  </button>
                  <button type="button" class="ghost tiny" :disabled="!!gitRemoteAction" @click="doPull">
                    {{ gitRemoteAction === 'pull' ? '…' : 'Pull' }}
                  </button>
                  <button type="button" class="ghost tiny" :disabled="!!gitRemoteAction" @click="doPush">
                    {{ gitRemoteAction === 'push' ? '…' : 'Push' }}
                  </button>
                </div>
              </div>
            </div>

            <!-- Stash 区域 -->
            <div class="git-stash-section">
              <div class="git-stash-header">
                <div class="git-stash-title-row">
                  <span class="git-stash-icon">📦</span>
                  <span class="git-stash-title">贮藏</span>
                  <span v-if="gitStashes.length" class="git-stash-count">{{ gitStashes.length }}</span>
                </div>
                <div class="git-stash-save-row">
                  <input
                    v-model="gitStashMessage"
                    class="git-stash-msg-input"
                    type="text"
                    placeholder="贮藏信息（可选）"
                    :disabled="!!gitStashAction"
                    @keydown.enter="doStashSave"
                  />
                  <button
                    type="button"
                    class="ghost tiny stash-save-btn"
                    :disabled="!!gitStashAction"
                    @click="doStashSave"
                  >
                    {{ gitStashAction === 'save' ? '…' : '贮藏' }}
                  </button>
                </div>
              </div>
              <div v-if="gitStashes.length" class="git-stash-list">
                <div class="git-stash-list-header">
                  <button type="button" class="git-section-toggle" @click="gitStashOpen = !gitStashOpen">
                    <span class="git-section-chevron">{{ gitStashOpen ? "▾" : "▸" }}</span>
                    <span class="git-stash-list-title">贮藏列表</span>
                  </button>
                </div>
                <div v-if="gitStashOpen" class="git-stash-list-content">
                  <div v-for="stash in gitStashes" :key="stash.index" class="git-stash-item">
                    <span class="git-stash-label">{{ 'stash@{' + stash.index + '}' }}</span>
                    <span class="git-stash-msg">{{ stash.message }}</span>
                    <div class="git-stash-actions">
                      <button
                        type="button"
                        class="ghost tiny"
                        :disabled="!!gitStashAction"
                        @click="doStashApply(stash.index)"
                        title="应用贮藏（保留贮藏）"
                      >
                        {{ gitStashAction === 'apply-' + stash.index ? '…' : 'Apply' }}
                      </button>
                      <button
                        type="button"
                        class="ghost tiny danger"
                        :disabled="!!gitStashAction"
                        @click="doStashDrop(stash.index)"
                        title="移除此贮藏（不应用）"
                      >
                        {{ gitStashAction === 'drop-' + stash.index ? '…' : 'Drop' }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div v-else-if="gitStashAction === 'list'" class="git-stash-empty">加载中…</div>
              <div v-else class="git-stash-empty">暂无贮藏</div>
            </div>

            <div v-if="gitError" class="git-error">{{ gitError }}</div>
            <div class="git-commit-box">
              <textarea
                v-model="gitCommitMessage"
                class="git-commit-input"
                rows="2"
                placeholder="提交信息…"
                :disabled="gitCommitting || !!gitGenStep || !!gitAiPushStep"
                @keydown.ctrl.enter="() => { if (!gitAiPushStep) commitGit() }"
                @keydown.meta.enter="() => { if (!gitAiPushStep) commitGit() }"
              />
              <div class="git-commit-actions">
                <button
                  type="button"
                  class="secondary small git-commit-ai"
                  :disabled="gitCommitting || !!gitGenStep || !!gitAiPushStep || !gitStagedFiles.length || !configReady"
                  @click="generateCommitMessage"
                >
                  {{ gitGenStep || "✦ AI 生成" }}
                </button>
                <button
                  type="button"
                  class="small"
                  :class="canGitCommit ? 'primary' : 'secondary'"
                  :disabled="!canGitCommit || !!gitAiPushStep"
                  @click="commitGit"
                >
                  {{ gitCommitting ? "提交中…" : `提交 (${gitStagedFiles.length})` }}
                </button>
              </div>
              <div class="git-ai-push-sep"></div>
              <button
                type="button"
                class="primary small git-ai-push"
                :disabled="gitCommitting || !!gitGenStep || !!gitAiPushStep || !gitStagedFiles.length || !configReady"
                @click="aiCommitAndPush"
              >
                {{ gitAiPushStep || "✦ AI 一键推送" }}
              </button>
            </div>
            <div class="git-scroll-area">
              <div v-if="!gitStatus.length" class="panel-empty">无本地改动</div>
              <template v-else>
                <div v-if="gitStagedFiles.length" class="git-section">
                  <div class="git-section-head">
                    <button type="button" class="git-section-toggle" @click="gitStagedOpen = !gitStagedOpen">
                      <span class="git-section-chevron">{{ gitStagedOpen ? "▾" : "▸" }}</span>
                      <span class="git-section-title">已暂存 ({{ gitStagedFiles.length }})</span>
                    </button>
                    <button type="button" class="ghost tiny" @click="unstageAll">取消全部</button>
                  </div>
                  <div v-if="gitStagedOpen" class="git-file-list">
                      <div
                        v-for="file in gitStagedFiles"
                        :key="file.path"
                        class="git-file-item"
                        :class="{ active: selectedGitFile === gitWorkingTreeDiffKey(file.path, file.staged), loading: gitDiffLoadingKey === gitWorkingTreeDiffKey(file.path, file.staged), 'file-item-draggable': true }"
                        @pointerdown="onGitFilePointerDown($event, file.path, file.staged)"
                      >
                      <span class="git-file-check" @pointerdown.stop @click.stop="unstageFile(file.path)">✓</span>
                      <span
                        class="git-file-status"
                        :style="{ color: gitStatusColor(file.status) }"
                      >
                        {{ gitStatusIcon(file.status) }}
                      </span>
                      <span class="git-file-path" :title="file.path">{{ file.path }}</span>
                    </div>
                  </div>
                </div>
                <div v-if="gitUnstagedFiles.length" class="git-section">
                  <div class="git-section-head">
                    <button type="button" class="git-section-toggle" @click="gitUnstagedOpen = !gitUnstagedOpen">
                      <span class="git-section-chevron">{{ gitUnstagedOpen ? "▾" : "▸" }}</span>
                      <span class="git-section-title">未暂存 ({{ gitUnstagedFiles.length }})</span>
                    </button>
                    <div class="git-section-actions">
                      <button type="button" class="ghost tiny" @click="stageAll">全部暂存</button>
                      <button type="button" class="ghost tiny danger" @click="discardAll($event)">丢弃全部</button>
                    </div>
                  </div>
                  <div v-if="gitUnstagedOpen" class="git-file-list">
                      <div
                        v-for="file in gitUnstagedFiles"
                        :key="file.path"
                        class="git-file-item"
                        :class="{ active: selectedGitFile === gitWorkingTreeDiffKey(file.path, file.staged), loading: gitDiffLoadingKey === gitWorkingTreeDiffKey(file.path, file.staged), 'file-item-draggable': true }"
                        @pointerdown="onGitFilePointerDown($event, file.path, file.staged)"
                      >
                      <span class="git-file-check" @pointerdown.stop @click.stop="stageFile(file.path)">+</span>
                      <span
                        class="git-file-status"
                        :style="{ color: gitStatusColor(file.status) }"
                      >
                        {{ gitStatusIcon(file.status) }}
                      </span>
                      <span class="git-file-path" :title="file.path">{{ file.path }}</span>
                      <button type="button" class="ghost tiny danger git-file-btn" title="丢弃更改" @pointerdown.stop @click.stop="discardFile(file.path, $event)">✕</button>
                    </div>
                  </div>
                </div>
              </template>
              <div class="git-log-section">
                <button type="button" class="ghost tiny git-log-toggle" @click="gitLogOpen = !gitLogOpen">
                  {{ gitLogOpen ? "▾" : "▸" }} 提交历史
                </button>
                <div v-if="gitLogOpen" class="git-log-list">
                  <div v-if="!gitLogEntries.length" class="panel-empty">无历史</div>
                  <div v-for="entry in gitLogEntries" :key="entry.hash" class="git-log-item">
                    <button type="button" class="git-log-entry-head" @click="toggleGitLogEntry(entry.hash)">
                      <span class="git-log-chevron">{{ isGitLogEntryOpen(entry.hash) ? "▾" : "▸" }}</span>
                      <span class="git-log-hash">{{ entry.shortHash }}</span>
                      <span class="git-log-msg" :title="entry.message">{{ entry.message }}</span>
                      <span class="git-log-count">{{ entry.files.length }}</span>
                    </button>
                    <div v-if="isGitLogEntryOpen(entry.hash)" class="git-log-detail">
                      <div v-if="entry.message.includes('\n')" class="git-log-full-msg">{{ entry.message }}</div>
                      <div class="git-log-files">
                      <button
                        v-for="file in entry.files"
                        :key="`${entry.hash}:${file.oldPath || ''}:${file.path}`"
                        type="button"
                        class="git-log-file"
                        :class="{ loading: gitDiffLoadingKey === gitHistoryDiffKey(entry.hash, file.path, file.oldPath) }"
                        :title="file.oldPath ? `${file.oldPath} → ${file.path}` : file.path"
                        @click="openGitLogFile(entry, file)"
                      >
                        <span class="git-file-status" :style="{ color: gitStatusColor(file.status) }">
                          {{ gitStatusIcon(file.status) }}
                        </span>
                        <span class="git-file-path">{{ file.oldPath ? `${file.oldPath} → ${file.path}` : file.path }}</span>
                      </button>
                    </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-else-if="gitError" class="panel-empty git-panel-fetch-error">
            <p>获取 Git 状态失败</p>
            <p class="git-fetch-error-detail">{{ gitError }}</p>
            <button type="button" class="secondary small" @click="() => refreshGitStatus()">重试</button>
          </div>
          <div v-else-if="gitStatusKnown" class="panel-empty">当前目录不是 Git 仓库</div>
          <div v-else class="panel-empty">加载中…</div>
        </div>

        <div v-if="gitPanelMode === 'files' && !projectOpened" class="panel-empty">请先打开项目文件夹</div>

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
        @save-file="saveFile"
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

      <aside
        ref="chatDropZoneRef"
        class="chat-panel"
        :class="{ 'chat-expanded': editorCollapsed, 'drag-over': isDragging }"
        @dragenter="onChatDragEnter"
        @dragover="onChatDragOver"
        @dragleave="onChatDragLeave"
        @drop="onChatDrop"
        :style="chatPanelStyle"
      >
        <div class="panel-head">
          <div class="panel-head-left">
            <span class="panel-label">AI 助手</span>
            <div ref="sessionPickerRef" class="session-picker-wrap">
              <div class="session-picker-row">
                <button
                  v-if="sessionList.length > 1"
                  type="button"
                  class="session-nav-btn"
                  :disabled="!projectOpened || chatSending || !canSwitchToNewerSession"
                  title="较新的会话 (Ctrl+Alt+↑)"
                  @click="switchToAdjacentSession(-1)"
                >
                  ‹
                </button>
                <button
                  type="button"
                  class="session-picker-trigger"
                  :class="{ open: sessionPickerOpen }"
                  :disabled="!projectOpened || chatSending"
                  :title="sessionPickerTitle"
                  @click="toggleSessionPicker"
                >
                  <span class="session-picker-title">{{ activeSessionTitle || "新会话" }}</span>
                  <span class="session-picker-chevron" aria-hidden="true">▾</span>
                </button>
                <button
                  v-if="sessionList.length > 1"
                  type="button"
                  class="session-nav-btn"
                  :disabled="!projectOpened || chatSending || !canSwitchToOlderSession"
                  title="较旧的会话 (Ctrl+Alt+↓)"
                  @click="switchToAdjacentSession(1)"
                >
                  ›
                </button>
              </div>
              <div v-if="sessionPickerOpen" class="session-picker-dropdown">
                <div class="session-picker-head">
                  <span class="session-picker-head-title">会话记录</span>
                  <button
                    type="button"
                    class="ghost small session-picker-new"
                    :disabled="chatSending"
                    @click="startNewSession"
                  >
                    + 新会话
                  </button>
                </div>
                <div v-if="chatStoreSyncMessage" class="history-sync-message">{{ chatStoreSyncMessage }}</div>
                <div v-if="!sessionList.length" class="history-empty">当前项目还没有会话记录</div>
                <ul v-else class="history-list session-picker-list">
                  <li
                    v-for="s in sessionList"
                    :key="s.id"
                    class="history-item"
                    :class="{ active: s.id === activeSessionId }"
                  >
                    <button type="button" class="history-item-main" @click="switchSession(s.id)">
                      <span class="history-item-title">{{ s.title }}</span>
                      <span class="history-item-meta">
                        {{ formatSessionTime(s.updatedAt) }} · {{ s.messageCount }} 条
                      </span>
                    </button>
                    <button
                      type="button"
                      class="ghost small history-copy"
                      :disabled="chatSending"
                      title="复制会话信息（便于粘贴给 AI 排查）"
                      @click.stop="copySessionInfo(s)"
                    >
                      复制
                    </button>
                    <button
                      type="button"
                      class="ghost small history-delete"
                      :disabled="chatSending"
                      title="删除此会话"
                      @click.stop="removeSession(s.id)"
                    >
                      删除
                    </button>
                  </li>
                </ul>
                <div class="session-picker-foot">
                  <button
                    type="button"
                    class="ghost small session-picker-sync"
                    :disabled="chatSending || syncingChatStore || !projectOpened"
                    @click="syncChatStoreToDisk"
                  >
                    {{ syncingChatStore ? "同步中…" : "同步到本地" }}
                  </button>
                  <span class="session-picker-hint">Ctrl+Alt+↑↓ 切换</span>
                </div>
              </div>
            </div>
          </div>
          <div class="panel-head-right">
            <button
              type="button"
              class="ghost small"
              :disabled="!projectOpened || chatSending"
              @click="startNewSession"
              title="新会话 (Ctrl+Shift+N)"
            >
              新会话
            </button>
            <button
              v-if="chatMessages.length"
              type="button"
              class="ghost small"
              :disabled="chatSending"
              @click="clearChat"
            >
              清空
            </button>
            <span class="panel-meta" :class="{ warn: !configReady || !apiKeyReady }">
              {{ aiConfigStatusText }}
            </span>
          </div>
        </div>

        <div ref="chatScrollRef" class="chat-scroll" @scroll="onChatScroll">
          <div v-if="!chatMessages.length" class="chat-empty">
            <div class="chat-empty-icon" aria-hidden="true">🤖</div>
            <p class="chat-empty-title">AI 编程助手</p>
            <p class="chat-empty-desc">Agent 会探索项目；Build 模式下每次文件修改会立即写入磁盘。输入 <code>@</code> 可引用文件。</p>
            <div class="chips">
              <button type="button" class="chip" :disabled="chatSending" @click="applyExample('解释这个项目是做什么的')">
                解释项目
              </button>
              <button type="button" class="chip" :disabled="chatSending" @click="applyExample('解释这段代码在做什么')">
                解释代码
              </button>
              <button type="button" class="chip" :disabled="chatSending" @click="applyExample('帮我优化这段代码，并给出修改后的完整代码')">
                优化代码
              </button>
              <button type="button" class="chip" :disabled="chatSending" @click="applyExample('找出潜在 bug 并修复')">
                修复 bug
              </button>
            </div>
          </div>

          <div v-else class="msg-list">
            <div v-for="m in chatMessages" :key="m.id" class="msg" :class="m.role" @mouseup="onMessageSelect($event, m)">
              <div class="msg-avatar" aria-hidden="true">{{ m.role === "user" ? "你" : "AI" }}</div>
              <div class="msg-body">
              <div class="msg-head">
                <div class="msg-role">{{ m.role === "user" ? "你" : "Agent" }}</div>
                <div v-if="!chatSending" class="msg-toolbar">
                  <button v-if="m.role === 'user'" type="button" class="ghost small" title="编辑此消息" @click="editUserMessage(m.id)">
                    编辑
                  </button>
                  <button type="button" class="ghost small" title="删除本条问答" @click="undoExchange(m.id, $event)">
                    撤销
                  </button>
                  <button
                    v-if="m.role === 'user'"
                    type="button"
                    class="ghost small"
                    title="从此问题重新生成"
                    :disabled="!configReady || !projectOpened"
                    @click="resendFromMessage(m.id)"
                  >
                    重发
                  </button>
                  <button
                    v-if="canResumeAgentRun(m)"
                    type="button"
                    class="ghost small resume-btn"
                    title="从断点继续运行，保留已完成步骤"
                    :disabled="!configReady || !projectOpened || chatSending"
                    @click="resumeAgentRun(m.id)"
                  >
                    恢复运行
                  </button>
                </div>
              </div>
              <div
                v-if="m.role === 'assistant' && isAssistantStalled(m)"
                class="agent-recovery-banner agent-stall-banner"
              >
                <span class="agent-recovery-text">运行似乎已卡住（长时间无进展），可停止或恢复运行。</span>
                <div class="agent-recovery-actions">
                  <button type="button" class="secondary compact" @click="stopAgent">停止</button>
                  <button
                    type="button"
                    class="secondary compact"
                    :disabled="!configReady || !projectOpened"
                    @click="forceRecoverStalledRun(m.id)"
                  >
                    恢复运行
                  </button>
                </div>
              </div>
              <div
                v-else-if="m.role === 'assistant' && canResumeAgentRun(m)"
                class="agent-recovery-banner"
              >
                <span class="agent-recovery-text">
                  {{ recoverableAgentErrorHint(m, m.agentFailureReason || m.content || '连接中断') }}
                </span>
                <button
                  type="button"
                  class="secondary compact"
                  :disabled="!configReady || !projectOpened || chatSending"
                  @click="resumeAgentRun(m.id)"
                >
                  恢复运行
                </button>
              </div>
              <AgentMessage
                v-if="m.role === 'assistant' && hasAgentActivity(m)"
                :msg="m"
                :is-agent-running="isAgentRunning"
                :agent-ui-tick="agentUiTick"
                :patch-assistant-msg="patchAssistantMsg"
                :schedule-persist-chat="schedulePersistChat"
                :message-display-content="messageDisplayContent"
                :show-jump="chainJumpVisible[m.id]"
                @jump-latest="jumpChainToLatest(m.id)"
              />
              <div
                v-if="m.role === 'user' && userMessageImages(m).length"
                class="msg-user-images"
              >
                <img
                  v-for="(url, imageIdx) in userMessageImages(m)"
                  :key="`${m.id}-img-${imageIdx}`"
                  :src="url"
                  alt="发送的图片"
                  class="msg-user-image"
                  loading="lazy"
                />
              </div>
              <ChatMarkdown
                v-if="shouldShowMessageBubble(m)"
                class="msg-answer"
                :class="{
                  'msg-answer--streaming': m.role === 'assistant' && isAgentRunning(m),
                  'msg-answer--final': m.role === 'assistant' && !isAgentRunning(m),
                }"
                :content="messageDisplayContent(m)"
                :streaming="m.role === 'assistant' && !!m.streaming && isAgentRunning(m)"
              />
              <div
                v-if="
                  m.role === 'assistant' &&
                  !messageDisplayContent(m) &&
                  (m.status || isAgentRunning(m)) &&
                  !(isAgentRunning(m) && hasAgentActivity(m))
                "
                class="msg-status"
              >
                <span v-if="isAgentRunning(m)" class="status-pulse" aria-hidden="true" />
                <span class="msg-status-text">
                  {{ agentStatusDisplay(m) || (m.chatMode === 'ask' ? '思考中…' : 'Agent 运行中…') }}
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
                      :disabled="!projectOpened"
                      @click="previewAgentFile(m.id, relPath)"
                    >
                      编辑器预览
                    </button>
                    <button
                      type="button"
                      class="ghost small diff-toggle-btn"
                      @click="m._expandedDiffs = m._expandedDiffs || {}; m._expandedDiffs[relPath] = !m._expandedDiffs[relPath]"
                    >
                      {{ m._expandedDiffs?.[relPath] ? '收起' : '展开' }}
                    </button>
                  </div>
                  <div class="inline-diff-wrap" :class="{ open: m._expandedDiffs?.[relPath] }">
                    <div class="inline-diff-col">
                      <div class="inline-diff-label">修改前</div>
                      <pre class="trace-pre compact">{{ truncateDiffPreview(m.turnFileDiffs[relPath].before || "（空 / 新文件）") }}</pre>
                    </div>
                    <div class="inline-diff-col">
                      <div class="inline-diff-label">{{ m.turnFileDiffs[relPath].deleted ? "删除后" : "修改后" }}</div>
                      <pre class="trace-pre compact">{{ truncateDiffPreview(m.turnFileDiffs[relPath].deleted ? "（文件已删除）" : m.turnFileDiffs[relPath].after) }}</pre>
                    </div>
                  </div>
                </div>
              </div>
              <div
                v-if="
                  m.role === 'assistant' &&
                  !m.streaming &&
                  (m.writtenFiles?.length)
                "
                class="msg-actions"
              >
                <span
                  v-if="m.writtenFiles?.length && !m.reverted && !m.rejected && m.chatMode === 'build'"
                  class="applied-badge"
                >
                  已写入 {{ m.writtenFiles.length }} 个文件
                </span>

                <span v-else-if="m.reverted" class="reverted-badge">已回滚</span>
                <span v-else-if="m.rejected" class="rejected-badge">已拒绝</span>
              </div>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="showQuoteButton"
          ref="quoteButtonRef"
          class="quote-floating"
          :style="{ left: quoteButtonPosition.x + 'px', top: quoteButtonPosition.y + 'px' }"
          @mousedown.prevent="quoteSelectedText"
          @mouseleave="hideQuoteButton"
        >
          <span class="quote-icon">❝</span> 引用
        </div>

        <footer class="chat-composer">
          <div v-if="pendingPromptQueue.length" class="pending-queue">
            <div class="pending-queue-head">
              <span>排队中 {{ pendingPromptQueue.length }} 条消息</span>
              <button type="button" class="ghost small" @click="clearPendingPromptQueue">清空队列</button>
            </div>
            <ol class="pending-queue-list">
              <li v-for="(q, qi) in pendingPromptQueue" :key="qi">{{ q }}</li>
            </ol>
          </div>
          <div v-if="quotedMessage" class="quoted-preview">
            <div class="quoted-preview-header">
              <span class="quoted-preview-label">
                <span class="quoted-preview-icon">❝</span>
                引用 {{ quotedMessage.role === "assistant" ? "Agent" : "你" }}
              </span>
              <button type="button" class="quoted-preview-close" @click="quotedMessage = null">×</button>
            </div>
            <div class="quoted-preview-body">{{ quotedMessage.content }}</div>
          </div>
          <div class="chat-input-field" @keydown.capture="onComposerFieldKeydown">
            <div v-if="mentionOpen && mentionResults.length" class="mention-dropdown">
              <button
                v-for="(item, idx) in mentionResults"
                :key="item.path"
                type="button"
                class="mention-item"
                :class="{ active: idx === mentionActiveIndex }"
                @mousedown.prevent="selectMention(item)"
              >
                <span class="mention-item-name">{{ item.name }}</span>
                <span class="mention-item-path">{{ item.relative }}</span>
              </button>
            </div>
            <div class="chat-input-box" :class="{ focused: chatInputFocused }" @mousedown="onChatInputBoxMouseDown">
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
            </div>
          </div>
          <div class="chat-bottom">
            <div class="chat-status-row">
              <span v-if="autoResumeSecondsLeft > 0" class="chat-recovery-hint chat-auto-resume-hint">
                {{ autoResumeSecondsLeft }}s 后自动恢复（可取消）
              </span>
              <span v-else-if="stalledAssistantMsg" class="chat-recovery-hint chat-stall-hint">
                运行似乎已卡住
              </span>
              <span v-else-if="recoverableAssistantMsg && !chatSending" class="chat-recovery-hint">
                Agent 已中断，可恢复
              </span>
              <span v-else-if="chatError" class="chat-error">{{ chatError }}</span>
              <span v-else-if="chatSending" class="chat-running">{{ chatRunningText }}</span>
              <span v-else class="chat-hint">{{ chatHintText }}</span>
            </div>
            <div class="chat-action-row">
              <div class="chat-mode-switch" role="group" aria-label="对话模式">
                <button
                  type="button"
                  class="mode-btn"
                  :class="{ active: chatMode === 'ask' }"
                  :disabled="chatSending"
                  @click="chatMode = 'ask'"
                >
                  Ask
                </button>
                <button
                  type="button"
                  class="mode-btn"
                  :class="{ active: chatMode === 'build' }"
                  :disabled="chatSending"
                  @click="chatMode = 'build'"
                >
                  Build
                </button>
              </div>
              <div class="chat-actions">
                <button
                  v-if="autoResumeSecondsLeft > 0"
                  type="button"
                  class="secondary"
                  @click="cancelAutoResume"
                >
                  取消恢复
                </button>
                <button
                  v-if="stalledAssistantMsg"
                  type="button"
                  class="secondary resume-bottom-btn"
                  :disabled="!configReady || !projectOpened"
                  @click="forceRecoverStalledRun(stalledAssistantMsg.id)"
                >
                  恢复运行
                </button>
                <button
                  v-else-if="recoverableAssistantMsg && !chatSending"
                  type="button"
                  class="secondary resume-bottom-btn"
                  :disabled="!configReady || !projectOpened"
                  @click="resumeAgentRun(recoverableAssistantMsg.id)"
                >
                  {{ autoResumeSecondsLeft > 0 ? "立即恢复" : "恢复运行" }}
                </button>
                <button v-if="chatSending" type="button" class="secondary" @click="stopAgent">停止</button>
                <button type="button" class="primary send-btn" :disabled="!canSendChat" @click="sendChat">
                  {{ chatSending ? "打断并发送" : "发送" }}
                </button>
              </div>
            </div>
          </div>
        </footer>
      </aside>
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
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import "../styles/vibe-coding.scss";
import AgentActivityLogStream, {
  type AgentLogLineItem,
} from "../components/AgentActivityLogStream.vue";
import AgentMessage from "../components/AgentMessage.vue";
import ChatComposerEditor from "../components/ChatComposerEditor.vue";
import ChatMarkdown from "../components/ChatMarkdown.vue";
import CodeMonacoDiffEditor from "../components/CodeMonacoDiffEditor.vue";
import CodeMonacoEditor from "../components/CodeMonacoEditor.vue";
import ConfirmPopup from "../components/ConfirmPopup.vue";
import InputPrompt from "../components/InputPrompt.vue";
import FileTreeNode, { type TreeNode } from "../components/FileTreeNode.vue";
import AppToolbar from "../components/vibe/AppToolbar.vue";
import ProjectSwitcherBar from "../components/vibe/ProjectSwitcherBar.vue";
import FilePanel from "../components/vibe/FilePanel.vue";
import GitPanel from "../components/vibe/GitPanel.vue";
import EditorPanel from "../components/vibe/EditorPanel.vue";
import ChatPanel from "../components/vibe/ChatPanel.vue";
import { useConfirm } from "../composables/useConfirm";
import { useFileDrag } from "../composables/useFileDrag";
import { useGitPanel, type GitFileDiff } from "../composables/useGitPanel";
import { useInputPrompt } from "../composables/useInputPrompt";
import { useSessionManager } from "../composables/useSessionManager";
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
const PANEL_WIDTH_KEY = "vibe-coding-panel-widths";
const EDITOR_COLLAPSED_KEY = "vibe-coding-editor-collapsed";
const CHAT_MODE_KEY = "vibe-coding-chat-mode";
const PENDING_QUEUE_KEY = "vibe-coding-pending-queue";
const GIT_PANEL_MODE_KEY = "vibe-coding-git-panel-mode";
const SYNC_STORE_DEBOUNCE_MS = 5000;
const FILE_MIN_WIDTH = 180;
const FILE_MAX_WIDTH = 500;
const CHAT_MIN_WIDTH = 260;
const CHAT_MAX_WIDTH = 1200;
const EDITOR_MIN_WIDTH = 280;
const RESIZE_HANDLES_WIDTH = 8;
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

function hasAgentProcessSteps(msg: ChatMessage): boolean {
  return Boolean(
    msg.tools?.length ||
      msg.roundGroups?.some(
        (group) => group.turn > 0 && ((group.toolIds?.length ?? 0) > 0 || group.modelSteps.length > 0),
      ),
  );
}

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
const loadingTree = ref(false);
const pickingFolder = ref(false);
const treeError = ref("");
const retryCountdown = ref(0);
let retryTimer: ReturnType<typeof setInterval> | null = null;
let retryAbort: AbortController | null = null;

function isNetworkError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return /failed to fetch|networkerror|network error|fetcherror|load failed/.test(msg);
}

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
const fileTree = ref<TreeNode[]>([]);
const expandedDirs = ref<Set<string>>(new Set());

type OpenTab = {
  path: string;
  content: string;
  dirty: boolean;
};

type SearchMode = "file" | "content";

const openTabs = ref<OpenTab[]>([]);
const activeFilePath = ref("");
const selectedTreePath = ref("");
const fileContent = ref("");
const fileDirty = ref(false);
const fileLoadError = ref("");
const fileDiffs = ref<Record<string, FileDiff>>({});
const readOnlyFileKeys = ref<Set<string>>(new Set());
const showDiffMode = ref(false);
const editorRef = ref<InstanceType<typeof CodeMonacoEditor> | null>(null);
const selectedCode = ref("");

interface QuotedMessage {
  messageId: string;
  content: string;
  role: "user" | "assistant";
}

const pendingQuote = ref<QuotedMessage | null>(null);
const quotedMessage = ref<QuotedMessage | null>(null);
const quoteButtonPosition = ref({ x: 0, y: 0 });
const showQuoteButton = ref(false);
const quoteButtonRef = ref<HTMLElement | null>(null);

const searchQuery = ref("");
const searchMode = ref<SearchMode>("file");
const searchResults = ref<Array<{ name: string; path: string; isDirectory: boolean }>>([]);
const contentSearchResults = ref<GrepMatch[]>([]);

function loadChatMode(): VibeChatMode {
  try {
    const saved = localStorage.getItem(CHAT_MODE_KEY);
    return saved === "ask" ? "ask" : "build";
  } catch {
    return "build";
  }
}

const chatMode = ref<VibeChatMode>(loadChatMode());
const chatMessages = ref<ChatMessage[]>([]);
const chatSending = ref(false);
const chatError = ref("");
const chatScrollRef = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
const workspaceRef = ref<HTMLElement | null>(null);
let scrollChatRaf = 0;
const CHAT_SCROLL_PIN_THRESHOLD = 80;
let chatPinnedToBottom = true;
const sessionPickerRef = ref<HTMLElement | null>(null);
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
  gitStagedOpen, gitUnstagedOpen, expandedGitLogEntries, selectedGitFile,
  gitDiffLoadingKey, gitDiffContentCache, gitRemotes, gitTrackingBranch,
  gitAhead, gitBehind, gitRemoteLoading, gitRemoteAction, gitStashes, gitStashOpen,
  gitStashAction, gitStashMessage, gitAiPushStep,
  gitStagedFiles, gitUnstagedFiles, gitChangeCount, canGitCommit,
  clearGitDiffCache, evictOldestCacheEntry, gitStagingInProgress, gitLastStagingAt, gitStatusIcon, gitStatusColor,
  isGitLogEntryOpen, toggleGitLogEntry, gitHistoryDiffKey, gitWorkingTreeDiffKey,
  resetGitPanelState, refreshGitStatus, commitGit, stageFile, unstageFile,
  stageAll, unstageAll, discardFile, discardAll,
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

function removeSession(sessionId: string) {
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
              !change.path.includes("node_modules") &&
              !change.path.includes(".aiall\\logs") &&
              !change.path.includes(".aiall/logs") &&
              !change.path.includes(".aiall\\vibe-chat-sessions") &&
              !change.path.includes(".aiall/vibe-chat-sessions")
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

const contextMenuTargetIsFile = computed(() => {
  const node = findNode(fileTree.value, contextMenu.value.path);
  return Boolean(node && !node.isDirectory);
});
const renamingPath = ref("");

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
    ? "提问、解释代码（拖动文件到右侧或 @ 引用，Enter 发送）"
    : "描述要改什么（拖动文件到右侧或 @ 引用，Enter 发送，Shift+Enter 换行）",
);

const chatHintText = computed(() =>
  chatMode.value === "ask"
    ? "Ask 模式 · 按住文件拖到 AI 面板 · 或输入 @ 引用"
    : "Build 模式 · 按住文件拖到 AI 面板 · 或输入 @ 引用",
);

const chatRunningText = computed(() =>
  chatMode.value === "ask"
    ? "思考中… · 发送新消息将打断"
    : "Agent 运行中… · 发送新消息将打断",
);

const recoverableAssistantMsg = computed(() => {
  if (chatSending.value) return null;
  for (let i = chatMessages.value.length - 1; i >= 0; i -= 1) {
    const m = chatMessages.value[i]!;
    if (m.role === "assistant" && canResumeAgentRun(m)) return m;
  }
  return null;
});

const stalledAssistantMsg = computed(() => {
  if (!chatSending.value || agentLastProgressAt <= 0) return null;
  void agentUiTick.value;
  if (!isAgentRunStalled(agentLastProgressAt, chatSending.value)) return null;
  const msg = findRunningAssistantMsg();
  if (!msg || !hasRecoverableAgentProgress(msg)) return null;
  return msg;
});

function isAssistantStalled(msg: ChatMessage): boolean {
  return Boolean(stalledAssistantMsg.value && stalledAssistantMsg.value.id === msg.id);
}

const activeFileDiff = computed(() => getFileDiff(activeFilePath.value));
const activeFileReadOnly = computed(() => readOnlyFileKeys.value.has(normalizePathKey(activeFilePath.value)));

const activeAssistantMsgId = computed(() => {
  for (let i = chatMessages.value.length - 1; i >= 0; i -= 1) {
    const m = chatMessages.value[i];
    if (m.role === "assistant") return m.id;
  }
  return "";
});

function loadPanelWidths(): { file: number; chat: number } {
  try {
    const raw = localStorage.getItem(PANEL_WIDTH_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        file: typeof parsed.file === "number" ? parsed.file : 280,
        chat: typeof parsed.chat === "number" ? parsed.chat : 360,
      };
    }
  } catch { /* ignore */ }
  return { file: 280, chat: 360 };
}

function savePanelWidths() {
  try {
    localStorage.setItem(PANEL_WIDTH_KEY, JSON.stringify({ file: filePanelWidth.value, chat: chatPanelWidth.value }));
  } catch { /* ignore */ }
}

function loadEditorCollapsed(): boolean {
  try {
    return localStorage.getItem(EDITOR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveEditorCollapsed() {
  try {
    localStorage.setItem(EDITOR_COLLAPSED_KEY, editorCollapsed.value ? "1" : "0");
  } catch {
    // ignore
  }
}

const savedWidths = loadPanelWidths();
const filePanelWidth = ref(savedWidths.file);
const chatPanelWidth = ref(savedWidths.chat);
const editorCollapsed = ref(loadEditorCollapsed());

const chatPanelStyle = computed(() => {
  if (editorCollapsed.value) {
    return { flex: "1", minWidth: `${CHAT_MIN_WIDTH}px`, width: "auto" };
  }
  return { width: `${chatPanelWidth.value}px`, flexShrink: "0" };
});

function getWorkspaceWidth(): number {
  return workspaceRef.value?.clientWidth || window.innerWidth;
}

function getChatPanelMaxWidth(): number {
  const workspace = getWorkspaceWidth();
  if (editorCollapsed.value) {
    return Math.max(CHAT_MIN_WIDTH, workspace - filePanelWidth.value - RESIZE_HANDLES_WIDTH - 24);
  }
  const byRatio = Math.floor(workspace * 0.78);
  const byEditor = workspace - filePanelWidth.value - EDITOR_MIN_WIDTH - RESIZE_HANDLES_WIDTH;
  return Math.max(CHAT_MIN_WIDTH, Math.min(CHAT_MAX_WIDTH, byRatio, byEditor));
}
const isResizing = ref(false);
let resizeType: "file" | "chat" | null = null;
let startX = 0;
let startWidth = 0;

function startResize(type: "file" | "chat", e: MouseEvent) {
  e.preventDefault();
  isResizing.value = true;
  resizeType = type;
  startX = e.clientX;
  startWidth = type === "file" ? filePanelWidth.value : chatPanelWidth.value;
  document.addEventListener("mousemove", onResize);
  document.addEventListener("mouseup", stopResize);
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
}

function onResize(e: MouseEvent) {
  if (!isResizing.value || !resizeType) return;
  const delta = e.clientX - startX;
  if (resizeType === "file") {
    filePanelWidth.value = Math.min(Math.max(FILE_MIN_WIDTH, startWidth + delta), FILE_MAX_WIDTH);
  } else {
    chatPanelWidth.value = Math.min(Math.max(CHAT_MIN_WIDTH, startWidth - delta), getChatPanelMaxWidth());
  }
}

function stopResize() {
  isResizing.value = false;
  resizeType = null;
  savePanelWidths();
  document.removeEventListener("mousemove", onResize);
  document.removeEventListener("mouseup", stopResize);
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}

onBeforeUnmount(() => {
  document.removeEventListener("mousemove", onResize);
  document.removeEventListener("mouseup", stopResize);
});

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

function genId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fileName(p: string) {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || p;
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

function collapseEditor() {
  editorCollapsed.value = true;
  saveEditorCollapsed();
}

function expandEditor() {
  editorCollapsed.value = false;
  saveEditorCollapsed();
}

function syncEditorPanelForOpenFiles() {
  if (!activeFilePath.value && projectOpened.value) {
    collapseEditor();
  }
}

function phaseBadgeLabel(phase?: string): string {
  switch (phase) {
    case "connecting_local":
    case "stream_connected":
    case "connected":
      return "连接";
    case "reconnecting":
      return "重连";
    case "preparing":
    case "starting":
    case "building_context":
      return "准备";
    case "compacting_context":
      return "上下文";
    case "vision_first_turn":
      return "读图";
    case "vision_first_turn_done":
    case "vision_first_turn_skipped":
      return "读图";
    case "waiting_model":
    case "thinking":
    case "retrying_model":
    case "sending_request":
      return "模型";
    case "streaming_model":
      return "输出";
    case "planning_tools":
      return "规划";
    case "executing_tool":
    case "executing_tools":
      return "工具";
    case "summarizing_tools":
      return "整理";
    case "continuing":
      return "续跑";
    case "aborted":
      return "停止";
    default:
      return "";
  }
}

function appendStatusDetail(base: string, detail?: string): string {
  const extra = detail?.trim();
  return extra ? `${base} · ${extra}` : base;
}

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function computeDiffHtml(before: string, after: string, maxLines = 80): { htmlBefore: string; htmlAfter: string } {
  const aLines = before.split("\n");
  const bLines = after.split("\n");
  const maxLen = Math.max(aLines.length, bLines.length);
  const aResult: string[] = [];
  const bResult: string[] = [];
  for (let i = 0; i < maxLen && (aResult.length < maxLines || bResult.length < maxLines); i++) {
    const aLine = i < aLines.length ? aLines[i] : undefined;
    const bLine = i < bLines.length ? bLines[i] : undefined;
    if (aLine === undefined) {
      aResult.push(`<span class="diff-line diff-add">${escapeHtml(bLine!)}</span>`);
      bResult.push(`<span class="diff-line diff-add">${escapeHtml(bLine!)}</span>`);
    } else if (bLine === undefined) {
      aResult.push(`<span class="diff-line diff-del">${escapeHtml(aLine)}</span>`);
      bResult.push(`<span class="diff-line diff-del">${escapeHtml(aLine)}</span>`);
    } else if (aLine === bLine) {
      aResult.push(`<span class="diff-line">${escapeHtml(aLine)}</span>`);
      bResult.push(`<span class="diff-line">${escapeHtml(bLine)}</span>`);
    } else {
      aResult.push(`<span class="diff-line diff-del">${escapeHtml(aLine)}</span>`);
      bResult.push(`<span class="diff-line diff-add">${escapeHtml(bLine)}</span>`);
    }
  }
  const tail = maxLen > maxLines ? `\n<span class="diff-overflow">… 共 ${aLines.length} / ${bLines.length} 行</span>` : "";
  return {
    htmlBefore: aResult.join("\n") + tail,
    htmlAfter: bResult.join("\n") + tail,
  };
}

function truncateDiffPreview(text: string, max = 1200): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…（共 ${text.length} 字符）`;
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
  if (msg.status) {
    if (
      msg.agentWaitStartedAt &&
      (msg.agentPhase === "waiting_model" ||
        msg.agentPhase === "sending_request" ||
        msg.agentPhase === "retrying_model") &&
      !msg.agentDetail
    ) {
      const elapsed = Math.max(0, Math.floor((Date.now() - msg.agentWaitStartedAt) / 1000));
      return `${msg.status} · 已等待 ${elapsed}s`;
    }
    return msg.status;
  }
  return msg.agentPhase ? formatAgentStatus({ phase: msg.agentPhase, detail: msg.agentDetail }, true) : "正在运行…";
}

function agentActiveModel(msg: ChatMessage): string {
  return msg.agentModel || msg.agentContext?.model || "";
}

function statusLogPhaseClass(text: string): string {
  if (text.includes("连接") || text.includes("已连接")) return "phase-connecting";
  if (text.includes("扫描") || text.includes("项目上下文") || text.includes("准备问答") || text.includes("组装")) return "phase-context";
  if (text.includes("压缩") || text.includes("准备模型上下文")) return "phase-compacting";
  if (text.includes("发送模型请求") || text.includes("等待模型") || text.includes("重试")) return "phase-model";
  if (text.includes("模型输出") || text.includes("规划工具")) return "phase-streaming";
  if (text.includes("执行") && text.includes("工具")) return "phase-tool";
  if (text.includes("整理")) return "phase-summarize";
  if (text.includes("停止")) return "phase-aborted";
  return "phase-default";
}

function cleanStatusLogText(text: string): string {
  return text
    .replace(/^正在/, "")
    .replace(/…$/, "")
    .replace(/\.\.\.\s*$/, "")
    .trim();
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

function roundGroupSetupLabel(group: AgentRoundGroupView): string {
  return group.turn === 0 ? "准备阶段" : `第 ${group.turn} 轮`;
}

function shouldShowMessageBubble(msg: ChatMessage): boolean {
  if (msg.role === "user") {
    return Boolean(msg.content?.trim() || userMessageImages(msg).length);
  }
  if (hasAgentActivity(msg)) return false;
  return Boolean(messageDisplayContent(msg));
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

function isActiveModelStep(msg: ChatMessage, group: AgentRoundGroupView, step: { phase: string }): boolean {
  return isAgentRunning(msg) && !!group.active && msg.agentPhase === step.phase;
}

function modelStepPhaseLabel(phase: string): string {
  switch (phase) {
    case "compacting_context":
      return "上下文";
    case "sending_request":
      return "请求";
    case "waiting_model":
    case "retrying_model":
      return "等待";
    case "streaming_model":
      return "输出";
    case "planning_tools":
      return "规划";
    case "summarizing_tools":
      return "整理";
    case "connecting_local":
    case "stream_connected":
    case "connected":
    case "reconnecting":
      return "连接";
    case "preparing":
    case "starting":
    case "building_context":
      return "准备";
    default:
      return "步骤";
  }
}

function isRoundGroupComplete(msg: ChatMessage, group: AgentRoundGroupView): boolean {
  if (isAgentRunning(msg) && group.active) return false;
  if (group.tools.some((tool) => tool.running)) return false;
  return true;
}

function liveModelStepText(msg: ChatMessage, group: AgentRoundGroupView, step: { text: string; phase: string }): string {
  void agentUiTick.value;
  const base = cleanStatusLogText(step.text);
  if (!isActiveModelStep(msg, group, step)) return base;
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

function syncRoundGroupsPatch(msg: ChatMessage): Pick<ChatMessage, "roundGroups"> {
  return {
    roundGroups: msg.roundGroups?.map((group) => ({
      ...group,
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
}

function formatContextChars(chars: number): string {
  if (chars >= 10_000) return `${(chars / 10_000).toFixed(1)} 万字符`;
  if (chars >= 1000) return `${(chars / 1000).toFixed(1)}k 字符`;
  return `${chars} 字符`;
}

function turnMessageRoleLabel(role: string): string {
  switch (role) {
    case "system":
      return "系统";
    case "user":
      return "用户";
    case "assistant":
      return "助手";
    case "tool":
      return "工具结果";
    default:
      return role;
  }
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
  const target = event.target as Node;
  if (projectHistoryOpen.value) {
    const el = projectHistoryRef.value;
    if (el && !el.contains(target)) closeProjectHistory();
  }
  if (sessionPickerOpen.value) {
    const el = sessionPickerRef.value;
    if (el && !el.contains(target)) closeSessionPicker();
  }
  if (showQuoteButton.value) {
    const btn = quoteButtonRef.value;
    if (btn && btn.contains(target)) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      hideQuoteButtonNow();
    }
  }
}

function hideQuoteButtonNow() {
  showQuoteButton.value = false;
  pendingQuote.value = null;
}

function formatSessionTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
  void (async () => {
    const project = projectPath.value.trim();
    await ensureProjectChatLoadedFromDisk(project, sessionId);
    const messages = switchVibeChatSession(project, sessionId);
    chatMessages.value = normalizeChatMessages(messages);
    activeSessionId.value = sessionId;
    chatError.value = "";
    refreshSessionList();
    closeSessionPicker();
    maybeAutoResumeLastRecoverableAssistant();
    await scrollChatToBottom(true);
  })();
}

async function copyText(text: string) {
  const value = String(text ?? "");
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand("copy");
    } finally {
      document.body.removeChild(textarea);
    }
  }
}

let sessionCopyHintTimer: ReturnType<typeof setTimeout> | null = null;

async function copySessionInfo(session: VibeChatSessionMeta) {
  const project = projectPath.value.trim();
  if (!project) return;
  await copyText(formatSessionInfoForCopy(session, project));
  if (sessionCopyHintTimer) clearTimeout(sessionCopyHintTimer);
  chatStoreSyncMessage.value = `已复制「${session.title}」的会话信息`;
  sessionCopyHintTimer = setTimeout(() => {
    sessionCopyHintTimer = null;
    if (chatStoreSyncMessage.value.startsWith("已复制「")) {
      chatStoreSyncMessage.value = "";
    }
  }, 2500);
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
    chatStoreSyncMessage.value = `已同步 ${result.sessionCount ?? sessionList.value.length} 条会话到 ${result.path || ".aiall/vibe-chat-sessions"}`;
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
      chatStoreSyncMessage.value = `已同步 ${result.sessionCount ?? sessionList.value.length} 条会话到 ${result.path || ".aiall/vibe-chat-sessions"}`;
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

function clearChat() {
  if (chatSending.value) return;
  chatMessages.value = [];
  chatError.value = "";
  pendingPromptQueue.value = [];
  persistPendingQueue();
  if (projectPath.value.trim()) {
    clearVibeChatHistory(projectPath.value.trim());
    refreshSessionList();
  }
}

function entryToNode(entry: FileEntry): TreeNode {
  return { ...entry, children: entry.isDirectory ? [] : undefined, loaded: !entry.isDirectory };
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

  const t0 = performance.now();
  const timings: string[] = [];
  const log = (label: string) => {
    const ms = Math.round(performance.now() - t0);
    timings.push(`${label}: ${ms}ms`);
  };

  const flushLog = (result: string) => {
    const line = `[${new Date().toISOString()}] ${normalized} | ${result}`;
    console.log(`[TAB-PERF] ${line}`);
    // 写磁盘
    try {
      const blob = new Blob([line + "\n"], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      // 不用下载，用 fetch 写到后端
    } catch {}
    fetch("/backend/vibe/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "tab-perf.log", line }),
    }).catch(() => {});
  };

  const previousPath = projectPath.value.trim();
  if (projectOpened.value && previousPath && previousPath !== normalized) {
    pendingPromptQueue.value = [];
    persistPendingQueue();
    // 取消之前的 sync，避免磁盘 I/O 争用
    cancelPendingSync();
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
      log(`chat-fetch-disk(${diskStore.ok ? "ok" : "fail"}, ${diskStore.data?.sessions?.length || 0}sessions)`);
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
  }
}

function openProjectByInput() {
  void openProjectByPath(projectPath.value);
}

async function refreshTree() {
  if (!projectOpened.value) return;
  const normalized = projectPath.value.trim();
  if (!normalized) return;
  try {
    fileTree.value = await autoRetryWithCountdown(
      () => loadDirChildren(normalized),
      {
        onRetry: (remaining, attempt, max) => {
          treeError.value = `刷新目录失败，正在重试… ${remaining}s (${attempt}/${max})`;
        },
      },
    );
    treeError.value = "";
  } catch (e) {
    treeError.value = formatFetchError(e, "刷新目录失败");
  }
}

async function openGitLogFile(entry: GitLogEntry, file: GitLogFile) {
  if (!projectOpened.value) return;
  gitError.value = "";
  const cacheKey = gitHistoryDiffKey(entry.hash, file.path, file.oldPath);
  const cached = gitDiffContentCache.value[cacheKey];
  try {
    let diff = cached;
    if (!diff) {
      gitDiffLoadingKey.value = cacheKey;
      const result = await fetchGitCommitFileDiff(projectPath.value.trim(), entry.hash, file.path, file.oldPath);
      if (!result.ok) {
        gitError.value = result.error || "获取提交文件 diff 失败";
        return;
      }
      diff = { before: result.before, after: result.after, deleted: file.status === "D" };
      gitDiffContentCache.value = { ...gitDiffContentCache.value, [cacheKey]: diff };
      evictOldestCacheEntry();
    }

    const displayPath = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
    const previewPath = `git-history://${entry.shortHash}/${displayPath}`;
    const nextReadOnly = new Set(readOnlyFileKeys.value);
    nextReadOnly.add(normalizePathKey(previewPath));
    readOnlyFileKeys.value = nextReadOnly;
    await openDiffPreview(previewPath, diff, { readOnly: true });
  } catch (e) {
    gitError.value = e instanceof Error ? e.message : "获取提交文件 diff 失败";
  } finally {
    if (gitDiffLoadingKey.value === cacheKey) gitDiffLoadingKey.value = "";
  }
}

let diffAbortController: AbortController | null = null;

async function showGitFileDiff(filePath: string, staged = false) {
  if (!projectOpened.value) return;
  if (diffAbortController) diffAbortController.abort();
  const cacheKey = gitWorkingTreeDiffKey(filePath, staged);
  selectedGitFile.value = cacheKey;
  gitError.value = "";
  const previewPath = gitWorkingTreePreviewPath(filePath, staged);
  const cached = gitDiffContentCache.value[cacheKey];
  try {
    let diff = cached;
    if (!diff) {
      gitDiffLoadingKey.value = cacheKey;
      const controller = new AbortController();
      diffAbortController = controller;
      const result = await fetchGitDiffContent(projectPath.value.trim(), filePath, staged, controller.signal);
      if (controller.signal.aborted) return;
      if (!result.ok) {
        if (result.error !== "已取消") gitError.value = result.error || "获取 diff 失败";
        return;
      }
      diff = { before: result.before, after: result.after };
      gitDiffContentCache.value = { ...gitDiffContentCache.value, [cacheKey]: diff };
      evictOldestCacheEntry();
    }
    await openDiffPreview(previewPath, diff, { readOnly: staged });
  } catch (e) {
    if (!(e instanceof DOMException && e.name === "AbortError")) {
      gitError.value = e instanceof Error ? e.message : "获取 diff 失败";
    }
  } finally {
    diffAbortController = null;
    if (gitDiffLoadingKey.value === cacheKey) gitDiffLoadingKey.value = "";
  }
}

function gitWorkingTreePreviewPath(filePath: string, staged = false): string {
  if (!staged) return resolveFullPathFromRel(filePath);
  return `git-index://${filePath}`;
}

function isVirtualSchemePath(path: string): boolean {
  return path.startsWith("git-index://") || path.startsWith("git-history://");
}

function displayFilePath(path: string): string {
  if (!path) return "";
  if (path.startsWith("git-index://")) return path.slice("git-index://".length);
  if (path.startsWith("git-history://")) {
    const rest = path.slice("git-history://".length);
    const slash = rest.indexOf("/");
    return slash >= 0 ? rest.slice(slash + 1) : rest;
  }
  return path;
}

async function openDiffPreview(path: string, diff: FileDiff, options?: { readOnly?: boolean }) {
  if (!await ensureCanLeaveCurrentTab()) return;
  syncActiveTabToCache();
  if (options?.readOnly) {
    const nextReadOnly = new Set(readOnlyFileKeys.value);
    nextReadOnly.add(normalizePathKey(path));
    readOnlyFileKeys.value = nextReadOnly;
  }
  expandEditor();
  setFileDiff(path, diff);
  selectedTreePath.value = options?.readOnly ? "" : path;
  activeFilePath.value = path;
  fileContent.value = diff.after;
  fileDirty.value = false;
  fileLoadError.value = "";
  showDiffMode.value = true;

  const cached = findOpenTab(path);
  if (cached) {
    cached.content = diff.after;
    cached.dirty = false;
  } else {
    openTabs.value.push({ path, content: diff.after, dirty: false });
  }
}

async function toggleDir(dirPath: string) {
  const expanded = expandedDirs.value;
  if (expanded.has(dirPath)) {
    expanded.delete(dirPath);
    expandedDirs.value = new Set(expanded);
    return;
  }

  expanded.add(dirPath);
  expandedDirs.value = new Set(expanded);

  const node = findNode(fileTree.value, dirPath);
  if (node && node.isDirectory && !node.loaded) {
    try {
      node.children = await loadDirChildren(dirPath);
      node.loaded = true;
    } catch {
      node.children = [];
    }
  }
}

function findNode(nodes: TreeNode[], targetPath: string): TreeNode | null {
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    if (node.children?.length) {
      const found = findNode(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

function normalizePathKey(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

function joinProjectPath(base: string, relative: string): string {
  const rel = relative.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel) return base;
  if (/^[a-zA-Z]:/.test(rel)) return rel;
  const baseNorm = base.replace(/\\/g, "/").replace(/\/$/, "");
  return `${baseNorm}/${rel}`;
}

function resolveFullPathFromRel(rel: string): string {
  const joined = joinProjectPath(projectPath.value, rel);
  const key = normalizePathKey(joined);
  const node = findNodeByKey(fileTree.value, key);
  return node?.path || joined;
}

function findNodeByKey(nodes: TreeNode[], key: string): TreeNode | null {
  for (const node of nodes) {
    if (normalizePathKey(node.path) === key) return node;
    if (node.children?.length) {
      const found = findNodeByKey(node.children, key);
      if (found) return found;
    }
  }
  return null;
}

function setFileDiff(path: string, diff: FileDiff) {
  fileDiffs.value = { ...fileDiffs.value, [normalizePathKey(path)]: diff };
}

function getFileDiff(path: string): FileDiff | null {
  if (!path) return null;
  return fileDiffs.value[normalizePathKey(path)] || null;
}

function parentDirForCreate(): string {
  const sel = selectedTreePath.value || activeFilePath.value || projectPath.value;
  const node = findNode(fileTree.value, sel);
  if (node?.isDirectory) return sel;
  const norm = sel.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx > 0 ? norm.slice(0, idx) : projectPath.value;
}

function selectTreeItem(path: string) {
  selectedTreePath.value = path;
}

function toggleDiffMode() {
  if (!activeFileDiff.value) return;
  showDiffMode.value = !showDiffMode.value;
}

function storeFileDiff(relPath: string, before: string, after: string, deleted?: boolean) {
  const full = resolveFullPathFromRel(relPath);
  setFileDiff(full, { before, after, deleted });
}

async function syncEditorAfterAgentFileChange(relPath: string, diff: FileDiff) {
  await refreshTree();
  const fullPath = resolveFullPathFromRel(relPath);
  if (diff.deleted) {
    removeOpenTabForPath(fullPath);
    return;
  }
  const tab = findOpenTab(fullPath);
  if (tab) {
    tab.content = diff.after;
    tab.dirty = false;
  }
  if (normalizePathKey(activeFilePath.value) === normalizePathKey(fullPath)) {
    fileContent.value = diff.after;
    fileDirty.value = false;
  }
}

function findOpenTab(path: string): OpenTab | undefined {
  return openTabs.value.find((tab) => tab.path === path);
}

function syncActiveTabToCache() {
  if (!activeFilePath.value) return;
  const tab = findOpenTab(activeFilePath.value);
  if (!tab) return;
  tab.content = fileContent.value;
  tab.dirty = fileDirty.value;
}

async function ensureCanLeaveCurrentTab(): Promise<boolean> {
  if (!fileDirty.value || !activeFilePath.value) return true;
  const name = fileName(activeFilePath.value);
  const choice = await confirm(`「${name}」未保存。确定保存？\n\n确定 = 保存后切换\n取消 = 留在当前文件`);
  if (choice) {
    await saveFile();
    return !fileDirty.value;
  }
  return false;
}

function switchTab(path: string) {
  if (path === activeFilePath.value) return;
  if (readOnlyFileKeys.value.has(normalizePathKey(path))) {
    void switchReadOnlyTab(path);
    return;
  }
  void openFile(path);
}

async function switchReadOnlyTab(path: string) {
  const canLeave = await ensureCanLeaveCurrentTab();
  if (!canLeave) return;
  syncActiveTabToCache();
  const tab = findOpenTab(path);
  if (!tab) return;
  activeFilePath.value = path;
  fileContent.value = tab.content;
  fileDirty.value = false;
  fileLoadError.value = "";
  selectedTreePath.value = "";
  showDiffMode.value = Boolean(getFileDiff(path));
}

async function closeTab(path: string) {
  const tab = findOpenTab(path);
  if (!tab) return;

  if (tab.dirty) {
    const name = fileName(path);
    const save = await confirm(`「${name}」未保存。确定保存？\n\n确定 = 保存后关闭\n取消 = 留在当前文件`);
    if (save) {
      if (activeFilePath.value !== path) {
        syncActiveTabToCache();
        activeFilePath.value = path;
        fileContent.value = tab.content;
        fileDirty.value = tab.dirty;
      }
      await saveFile();
      if (fileDirty.value) return;
    } else {
      return;
    }
  }

  const idx = openTabs.value.findIndex((item) => item.path === path);
  if (idx < 0) return;
  openTabs.value.splice(idx, 1);
  if (readOnlyFileKeys.value.has(normalizePathKey(path))) {
    const nextReadOnly = new Set(readOnlyFileKeys.value);
    nextReadOnly.delete(normalizePathKey(path));
    readOnlyFileKeys.value = nextReadOnly;
    const nextDiffs = { ...fileDiffs.value };
    delete nextDiffs[normalizePathKey(path)];
    fileDiffs.value = nextDiffs;
  }

  if (activeFilePath.value !== path) return;

  const nextTab = openTabs.value[idx] || openTabs.value[idx - 1];
  if (nextTab) {
    activeFilePath.value = nextTab.path;
    fileContent.value = nextTab.content;
    fileDirty.value = nextTab.dirty;
    fileLoadError.value = "";
    showDiffMode.value = readOnlyFileKeys.value.has(normalizePathKey(nextTab.path)) && Boolean(getFileDiff(nextTab.path));
    selectedTreePath.value = showDiffMode.value ? "" : nextTab.path;
    return;
  }

  activeFilePath.value = "";
  fileContent.value = "";
  fileDirty.value = false;
  fileLoadError.value = "";
  showDiffMode.value = false;
  syncEditorPanelForOpenFiles();
}

function updateOpenTabPath(from: string, to: string) {
  const tab = findOpenTab(from);
  if (tab) tab.path = to;
}

async function createNewFile() {
  if (!projectOpened.value) return;
  const name = await inputPrompt.prompt("新建文件（可含子目录，如 src/utils/helper.ts）", {
    defaultValue: "new-file.ts",
  });
  if (!name) return;
  const target = joinProjectPath(parentDirForCreate(), name.trim());
  const result = await createItem(target, false, "");
  if (!result.ok) {
    treeError.value = result.error || "创建失败";
    return;
  }
  treeError.value = "";
  await refreshTree();
  selectedTreePath.value = target;
  await openFile(target);
}

async function createNewFolder() {
  if (!projectOpened.value) return;
  const name = await inputPrompt.prompt("新建文件夹（可含子目录）", {
    defaultValue: "new-folder",
  });
  if (!name) return;
  const target = joinProjectPath(parentDirForCreate(), name.trim());
  const result = await createItem(target, true);
  if (!result.ok) {
    treeError.value = result.error || "创建失败";
    return;
  }
  treeError.value = "";
  selectedTreePath.value = target;
  await refreshTree();
  await toggleDir(target);
}

async function renameSelectedItem() {
  const from = selectedTreePath.value;
  if (!from) return;
  renamingPath.value = from;
}

async function commitRename(path: string, newName: string) {
  renamingPath.value = "";
  const from = path;
  const parent = from.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
  const to = joinProjectPath(parent, newName);
  const result = await renameItem(from, to);
  if (!result.ok) {
    treeError.value = result.error || "重命名失败";
    return;
  }
  treeError.value = "";
  if (activeFilePath.value === from) {
    activeFilePath.value = to;
    const fromDiff = getFileDiff(from);
    if (fromDiff) {
      setFileDiff(to, fromDiff);
      const next = { ...fileDiffs.value };
      delete next[normalizePathKey(from)];
      fileDiffs.value = next;
    }
  }
  updateOpenTabPath(from, to);
  selectedTreePath.value = to;
  await refreshTree();
}

function cancelRename() {
  renamingPath.value = "";
}

async function deleteSelectedItem() {
  const target = selectedTreePath.value;
  if (!target) return;
  const root = projectPath.value.replace(/\\/g, "/").replace(/\/$/, "");
  const normalized = target.replace(/\\/g, "/");
  if (normalized === root) {
    treeError.value = "不能删除项目根目录";
    return;
  }
  if (!await confirm(`确定删除「${fileName(target)}」？`)) return;

  const result = await deleteItem(target);
  if (!result.ok) {
    treeError.value = result.error || "删除失败";
    return;
  }
  treeError.value = "";
  const tabIdx = openTabs.value.findIndex((tab) => tab.path === target);
  if (tabIdx >= 0) openTabs.value.splice(tabIdx, 1);
  if (activeFilePath.value === target) {
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
  if (getFileDiff(target)) {
    const next = { ...fileDiffs.value };
    delete next[normalizePathKey(target)];
    fileDiffs.value = next;
  }
  selectedTreePath.value = projectPath.value;
  await refreshTree();
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

async function openFile(filePath: string, options?: { force?: boolean; skipUnsavedCheck?: boolean }) {
  if (!options?.skipUnsavedCheck && activeFilePath.value && activeFilePath.value !== filePath) {
    const canLeave = await ensureCanLeaveCurrentTab();
    if (!canLeave) return;
    syncActiveTabToCache();
  } else {
    syncActiveTabToCache();
  }

  expandEditor();
  showDiffMode.value = false;
  fileLoadError.value = "";
  selectedTreePath.value = filePath;

  const cached = findOpenTab(filePath);
  if (cached && !options?.force) {
    activeFilePath.value = filePath;
    fileContent.value = cached.content;
    fileDirty.value = cached.dirty;
    return;
  }

  activeFilePath.value = filePath;
  fileDirty.value = false;

  if (isVirtualSchemePath(filePath)) {
    fileContent.value = cached?.content || "";
    fileLoadError.value = cached ? "" : "预览文件不可直接读取";
    return;
  }

  const result = await readFile(filePath);
  if (!result.ok) {
    fileContent.value = "";
    fileLoadError.value = result.error || "读取失败";
    if (cached) {
      cached.content = "";
      cached.dirty = false;
    }
    return;
  }

  fileContent.value = result.content;
  if (cached) {
    cached.content = result.content;
    cached.dirty = false;
  } else {
    openTabs.value.push({ path: filePath, content: result.content, dirty: false });
  }
}

async function reloadFile() {
  if (!activeFilePath.value) return;
  if (activeFileReadOnly.value) return;
  await openFile(activeFilePath.value, { force: true, skipUnsavedCheck: true });
}

async function saveFile() {
  if (!activeFilePath.value) return;
  if (activeFileReadOnly.value) return;
  const result = await writeFile(activeFilePath.value, fileContent.value);
  if (!result.ok) {
    fileLoadError.value = result.error || "保存失败";
    return;
  }
  fileDirty.value = false;
  fileLoadError.value = "";
  const tab = findOpenTab(activeFilePath.value);
  if (tab) {
    tab.content = fileContent.value;
    tab.dirty = false;
  }
}

async function handleSearch() {
  const q = searchQuery.value.trim();
  if (!q || !projectPath.value.trim()) {
    searchResults.value = [];
    contentSearchResults.value = [];
    return;
  }

  if (searchMode.value === "content") {
    const result = await grepContent(projectPath.value.trim(), q);
    contentSearchResults.value = result.ok ? result.results : [];
    searchResults.value = [];
    if (!result.ok && result.error) treeError.value = result.error;
    return;
  }

  const result = await searchFiles(projectPath.value.trim(), q);
  searchResults.value = result.ok ? result.results : [];
  contentSearchResults.value = [];
}

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

watch(searchQuery, (val) => {
  if (!val.trim()) {
    searchResults.value = [];
    contentSearchResults.value = [];
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

function onEditorChange() {
  if (activeFileReadOnly.value) return;
  fileDirty.value = true;
  const tab = findOpenTab(activeFilePath.value);
  if (tab) tab.dirty = true;
}

function onEditorSelect(text: string) {
  selectedCode.value = text.trim();
}

function askAiWithCode() {
  if (!selectedCode.value) return;
  const raw = activeFilePath.value || "";
  const filePath = displayFilePath(raw) || "未知文件";
  composerRef.value?.setPlainText(
    `请帮我分析以下代码（${filePath}）：\n\n\`\`\`\n${selectedCode.value}\n\`\`\``,
  );
  selectedCode.value = "";
}

function onMessageSelect(event: MouseEvent, message: ChatMessage) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) {
    showQuoteButton.value = false;
    return;
  }

  const selectedText = selection.toString().trim();
  if (!selectedText) {
    showQuoteButton.value = false;
    return;
  }

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  
  pendingQuote.value = {
    messageId: message.id,
    content: selectedText,
    role: message.role,
  };
  
  quoteButtonPosition.value = {
    x: rect.left + rect.width / 2,
    y: rect.top - 10,
  };
  
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
    if (!showQuoteButton.value) return;
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
  const fullPath = resolveFullPathFromRel(relativePath);
  startPathDrag(fullPath, fileName(relativePath), e, () => {
    void showGitFileDiff(relativePath, staged);
  }, chatDropZoneRef.value);
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

function formatToolMeta(
  name: string,
  args: Record<string, unknown>,
): { name: string; icon: string; title: string; detail: string; label: string } {
  const path = String(args.path ?? "").trim();
  const pattern = String(args.pattern ?? "").trim();
  const query = String(args.query ?? "").trim();

  if (name === "read_file") {
    const offset = Number(args.offset) || 1;
    const limit = Math.min(800, Math.max(1, Number(args.limit) || 500));
    const detail = path ? `${path} · 行 ${offset}–${offset + limit - 1}` : "";
    return { name, icon: "📄", title: "读取文件", detail, label: detail ? `读取文件 ${detail}` : "读取文件" };
  }
  if (name === "write_file") {
    const content = typeof args.content === "string" ? args.content : "";
    const detail = path ? `${path}${content ? ` · ${content.length} 字符` : ""}` : "";
    return { name, icon: "✏️", title: "写入文件", detail, label: detail ? `写入文件 ${detail}` : "写入文件" };
  }
  if (name === "patch_file") {
    const detail = path || "";
    return { name, icon: "🔧", title: "局部修改", detail, label: detail ? `局部修改 ${detail}` : "局部修改" };
  }
  if (name === "delete_file") {
    const detail = path || "";
    return { name, icon: "🗑️", title: "删除文件", detail, label: detail ? `删除文件 ${detail}` : "删除文件" };
  }
  if (name === "list_dir") {
    const detail = path || "项目根目录";
    return { name, icon: "📁", title: "浏览目录", detail, label: `浏览目录 ${detail}` };
  }
  if (name === "grep") {
    const detail = pattern ? `「${pattern}」` : "";
    return { name, icon: "🔍", title: "搜索代码", detail, label: detail ? `搜索代码 ${detail}` : "搜索代码" };
  }
  if (name === "search_files") {
    const detail = query ? `「${query}」` : "";
    return { name, icon: "🔎", title: "搜索文件", detail, label: detail ? `搜索文件 ${detail}` : "搜索文件" };
  }

  return { name, icon: "⚙️", title: name, detail: "", label: name };
}

function activeFileRelativePath(): string {
  if (!activeFilePath.value || !projectPath.value) return "";
  const root = projectPath.value.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
  const full = activeFilePath.value.replace(/\\/g, "/").toLowerCase();
  if (!full.startsWith(root)) return "";
  return full.slice(root.length).replace(/^\//, "");
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
  if (e.key === "Escape") {
    // 优先关闭最顶层弹窗（按z-index层级从高到低）
    if (contextMenu.value.show) {
      e.preventDefault();
      hideContextMenu();
    } else if (sessionPickerOpen.value) {
      e.preventDefault();
      closeSessionPicker();
    } else if (mentionOpen.value) {
      e.preventDefault();
      mentionOpen.value = false;
    } else if (projectHistoryOpen.value) {
      e.preventDefault();
      projectHistoryOpen.value = false;
    }
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

onMounted(() => {
  reloadAiConfig();
  refreshProjectHistoryList();
  // #region agent log
  console.log('[DBG][TAB][onMounted] projectHistoryList', { count: projectHistoryList.value.length, items: projectHistoryList.value.map(p => p.displayName) });
  nextTick(() => {
    const barEl = document.querySelector('.project-switcher-bar');
    const vibePage = document.querySelector('.vibe-page');
    console.log('[DBG][TAB][onMounted] DOM check', {
      hasBar: !!barEl,
      barDisplay: barEl ? window.getComputedStyle(barEl).display : null,
      barVisibility: barEl ? window.getComputedStyle(barEl).visibility : null,
      barHeight: barEl ? barEl.getBoundingClientRect().height : null,
      vibePageChildren: vibePage ? vibePage.children.length : null,
      childTags: vibePage ? Array.from(vibePage.children).map(c => c.tagName + '.' + c.className.split(' ')[0]) : null,
    });
  });
  // #endregion
  pendingPromptQueue.value = loadPendingQueue();
  loadSavedProject();
  chatPanelWidth.value = Math.min(chatPanelWidth.value, getChatPanelMaxWidth());
  window.addEventListener("focus", onWindowFocus);
  window.addEventListener("dragend", onWindowDragEnd);
  document.addEventListener("click", onDocumentClick);
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
  document.removeEventListener("click", onDocumentClick);
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
  cancelAutoResume();
  persistChatNow();
  stopFileWatcherForProject();
  
  // Best-effort: give pending disk syncs a brief window to complete.
  // This won't block unmount (onBeforeUnmount must be sync), but ensures
  // the async sync chain is at least kicked off and may complete in time.
  void (async () => {
    const startTime = Date.now();
    const maxWaitMs = 500;
    while (syncingChatStore.value && Date.now() - startTime < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  })();
});
</script>

<style scoped>
:global(body) {
  margin: 0;
  background: radial-gradient(900px 520px at 18% 8%, rgba(31, 111, 235, 0.16), transparent 62%),
    radial-gradient(900px 560px at 92% 0%, rgba(130, 80, 223, 0.18), transparent 60%),
    #0b1220;
  color: rgba(255, 255, 255, 0.92);
}

:global(::-webkit-scrollbar) {
  width: 6px;
  height: 6px;
}

:global(::-webkit-scrollbar-track) {
  background: transparent;
}

:global(::-webkit-scrollbar-thumb) {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
  transition: background 200ms ease;
}

:global(::-webkit-scrollbar-thumb:hover) {
  background: rgba(255, 255, 255, 0.28);
}

:global(::-webkit-scrollbar-corner) {
  background: transparent;
}

.vibe-page {
  --bg: #0b1220;
  --panel: rgba(17, 24, 39, 0.72);
  --panel-2: rgb(2, 6, 23);
  --text: rgba(255, 255, 255, 0.92);
  --muted: rgba(255, 255, 255, 0.7);
  --text-dim: rgba(255, 255, 255, 0.55);
  --border: rgba(255, 255, 255, 0.12);
  --primary: #1f6feb;
  --danger: #ff4d5e;
  --ok: #1a7f37;

  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  overscroll-behavior: none;
}

.app-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 2px 16px;
  border-bottom: none;
  background: rgba(11, 18, 32, 0.92);
  backdrop-filter: blur(12px);
  flex-shrink: 0;
  min-height: 32px;
}

.toolbar-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.brand-icon {
  font-size: 16px;
  line-height: 1;
}

.title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.2px;
  white-space: nowrap;
}

.toolbar-project {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  flex-basis: 420px;
  min-width: 0;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  flex-shrink: 0;
}

.path-input {
  flex: 1;
  min-width: 120px;
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  outline: none;
  transition: border-color 180ms ease, background 180ms ease, box-shadow 180ms ease;
}

.path-input:focus {
  border-color: rgba(31, 111, 235, 0.5);
  background: rgba(255, 255, 255, 0.06);
  box-shadow: 0 0 0 3px rgba(31, 111, 235, 0.08);
}

.path-input::placeholder {
  color: rgba(255, 255, 255, 0.4);
}

.toolbar-error {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: min(360px, 42vw);
  padding: 4px 8px 4px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 77, 94, 0.35);
  background: rgba(255, 77, 94, 0.12);
  flex-shrink: 1;
  min-width: 0;
}

.toolbar-error-countdown {
  flex-shrink: 0;
  font-size: 13px;
  line-height: 1;
  color: rgba(255, 180, 186, 0.9);
  animation: countdown-spin 1.2s linear infinite;
}

@keyframes countdown-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.toolbar-error-text {
  font-size: 11px;
  line-height: 1.35;
  color: rgba(255, 180, 186, 0.95);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toolbar-error-dismiss {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: rgba(255, 180, 186, 0.85);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.toolbar-error-dismiss:hover {
  background: rgba(255, 255, 255, 0.08);
}

.project-history-wrap {
  position: relative;
  flex-shrink: 0;
}

.project-history-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  width: min(420px, calc(100vw - 40px));
  max-height: 360px;
  display: flex;
  flex-direction: column;
  background: #111827;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  overflow: hidden;
  backdrop-filter: blur(16px);
}

.project-history-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.project-history-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.project-history-desc {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--muted);
}

.project-history-empty {
  font-size: 12px;
  color: var(--muted);
  text-align: center;
  padding: 20px 12px;
}

.project-history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  display: grid;
  gap: 6px;
}

.project-history-item {
  display: flex;
  align-items: stretch;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
}

.project-history-item.active {
  border-color: rgba(31, 111, 235, 0.45);
  background: rgba(31, 111, 235, 0.1);
}

.project-history-item-main {
  flex: 1;
  min-width: 0;
  text-align: left;
  background: transparent;
  border: none;
  color: inherit;
  padding: 10px 12px;
  cursor: pointer;
}

.project-history-item-title {
  display: block;
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-history-item-path {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: rgba(145, 190, 255, 0.75);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-history-item-meta {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--muted);
}

.project-history-delete {
  align-self: center;
  margin-right: 6px;
  flex-shrink: 0;
}

.workspace {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

.workspace.no-project {
  opacity: 0.85;
}

.workspace.editor-collapsed .chat-panel.chat-expanded {
  flex: 1;
  width: auto !important;
  min-width: 260px;
  border-left: none;
}

.file-panel,
.editor-panel,
.chat-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow-x: clip;
}

.file-panel {
  background: rgba(11, 18, 32, 0.4);
  border-right: 1px solid var(--border);
  overflow: hidden;
}

.git-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.file-panel-tabs {
  display: flex;
  gap: 8px;
  margin-right: 8px;
}

.file-panel-tab {
  padding: 5px 14px;
  font-size: 13px;
  background: transparent;
  color: var(--text-dim);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 150ms ease;
  position: relative;
  font-weight: 500;
}

.file-panel-tab:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
}

.file-panel-tab.active {
  color: var(--text);
  background: rgba(31, 111, 235, 0.22);
  font-weight: 600;
  box-shadow: 0 0 0 1px rgba(31, 111, 235, 0.4);
}

.git-badge {
  margin-left: 4px;
  padding: 0 6px;
  font-size: 12px;
  font-weight: 600;
  background: rgba(31, 111, 235, 0.45);
  color: #fff;
  border-radius: 8px;
  line-height: 18px;
}

.git-badge-staged {
  background: rgba(115, 218, 202, 0.45);
}

.git-panel-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.git-scroll-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 8px;
}

.git-header {
  border-bottom: 1px solid var(--border);
}

.git-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  font-size: 14px;
}

.git-header-row + .git-header-row {
  padding-top: 0;
  padding-bottom: 10px;
}

/* ---- 分支行 ---- */
.git-branch-row {
  gap: 8px;
}

.file-watcher-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #f7768e;
  flex-shrink: 0;
  transition: background 0.3s;
}

.file-watcher-dot.connected {
  background: #9ece6a;
}

.git-branch-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.git-branch-icon {
  color: var(--text-dim);
  flex-shrink: 0;
  font-size: 15px;
}

.git-branch-name {
  color: #7aa2f7;
  font-family: monospace;
  font-weight: 600;
  font-size: 13px;
  padding: 3px 8px;
  background: rgba(122, 162, 247, 0.1);
  border: 1px solid rgba(122, 162, 247, 0.15);
  border-radius: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: background 0.2s ease;
}

.git-branch-name:hover {
  background: rgba(122, 162, 247, 0.18);
}

.git-tracking-badge {
  font-family: monospace;
  font-size: 11px;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.7;
  transition: opacity 0.15s;
  cursor: default;
}

.git-tracking-badge:hover {
  opacity: 1;
}

/* ---- 同步行 ---- */
.git-sync-row {
  gap: 12px;
}

.git-sync-info {
  display: flex;
  align-items: center;
  gap: 6px;
}

.git-sync-stat {
  font-family: monospace;
  font-size: 12px;
  color: var(--text-dim);
  flex-shrink: 0;
  padding: 3px 7px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.04);
  display: inline-flex;
  align-items: center;
  gap: 2px;
  transition: all 0.2s ease;
}

.git-sync-arrow {
  font-size: 11px;
  opacity: 0.6;
}

.git-sync-stat.active,
.git-sync-stat.ahead {
  color: #7aa2f7;
  font-weight: 600;
  background: rgba(122, 162, 247, 0.12);
}

.git-sync-stat.ahead .git-sync-arrow,
.git-sync-stat.active .git-sync-arrow {
  opacity: 1;
}

.git-sync-stat.behind {
  color: #e0af68;
  font-weight: 600;
  background: rgba(224, 175, 104, 0.12);
}

.git-sync-stat.behind .git-sync-arrow {
  opacity: 1;
}

.git-remote-actions {
  display: flex;
  gap: 6px;
}

/* ---- Stash 区域 ---- */
.git-stash-section {
  border-top: 1px solid var(--border);
}

.git-stash-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  font-size: 14px;
}

.git-stash-title-row {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

.git-stash-icon {
  font-size: 13px;
  line-height: 1;
}

.git-stash-title {
  color: var(--text);
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.3px;
}

.git-stash-count {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-dim);
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 5px;
  border-radius: 8px;
  line-height: 1.4;
}

.git-stash-save-row {
  display: flex;
  gap: 5px;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.git-stash-msg-input {
  flex: 1;
  min-width: 0;
  padding: 3px 7px;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  outline: none;
  transition: border-color 180ms ease;
}

.git-stash-msg-input:focus {
  border-color: rgba(31, 111, 235, 0.5);
}

.git-stash-msg-input::placeholder {
  color: var(--text-dim);
}

.stash-save-btn {
  font-size: 10px !important;
  padding: 3px 8px !important;
  flex-shrink: 0;
}

.git-stash-list {
  display: flex;
  flex-direction: column;
}

.git-stash-list-header {
  display: flex;
  align-items: center;
  padding: 4px 14px;
  border-top: 1px solid var(--border);
}

.git-stash-list-title {
  font-size: 11px;
  color: var(--text-dim);
  font-weight: 500;
}

.git-stash-list-content {
  display: flex;
  flex-direction: column;
}

.git-stash-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 14px;
  font-size: 12px;
  border-top: 1px solid var(--border);
  transition: background 0.15s ease;
}

.git-stash-item:hover {
  background: rgba(255, 255, 255, 0.03);
}

.git-stash-label {
  color: #bb9af7;
  font-family: monospace;
  font-size: 10px;
  font-weight: 500;
  flex-shrink: 0;
  padding: 1px 5px;
  background: rgba(187, 154, 247, 0.08);
  border: 1px solid rgba(187, 154, 247, 0.12);
  border-radius: 3px;
  line-height: 1.4;
}

.git-stash-msg {
  color: var(--text-dim);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}

.git-stash-actions {
  display: flex;
  gap: 3px;
  flex-shrink: 0;
  opacity: 0.4;
  transition: opacity 0.2s ease;
}

.git-stash-item:hover .git-stash-actions {
  opacity: 1;
}

.git-stash-empty {
  padding: 5px 14px 8px;
  font-size: 11px;
  color: var(--text-dim);
  opacity: 0.35;
  font-style: italic;
  letter-spacing: 0.2px;
}

.git-error {
  padding: 6px 14px;
  font-size: 12px;
  color: #f7768e;
  background: rgba(247, 118, 142, 0.08);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 6px;
}

.git-error::before {
  content: '⚠';
  font-size: 12px;
  flex-shrink: 0;
}

.git-commit-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-top: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.02);
}

.git-commit-input {
  width: 100%;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.45;
  font-family: inherit;
  resize: vertical;
  min-height: 48px;
  max-height: 120px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  outline: none;
  transition: border-color 180ms ease, box-shadow 180ms ease;
  box-sizing: border-box;
}

.git-commit-input:focus {
  border-color: rgba(31, 111, 235, 0.5);
  box-shadow: 0 0 0 2px rgba(31, 111, 235, 0.1);
}

.git-commit-input::placeholder {
  color: var(--text-dim);
}

.git-commit-actions {
  display: flex;
  gap: 6px;
}

.git-commit-actions button {
  flex: 1;
  min-width: 0;
  font-weight: 500;
}

.git-ai-push {
  width: 100%;
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.5px;
  border-radius: 6px;
  transition: all 200ms ease;
  position: relative;
  overflow: hidden;
}

.git-ai-push:not(:disabled)::before {
  content: "";
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);
  transition: left 500ms ease;
}

.git-ai-push:not(:disabled):hover::before {
  left: 100%;
}

.git-ai-push:not(:disabled):hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(31, 111, 235, 0.3);
}

.git-ai-push:not(:disabled):active {
  transform: translateY(0);
  box-shadow: 0 2px 6px rgba(31, 111, 235, 0.2);
}

.git-ai-push-sep {
  height: 1px;
  background: var(--border);
  margin: 8px 0;
  opacity: 0.6;
}

.git-commit-ai:not(:disabled) {
  color: #9eceff;
  border-color: rgba(31, 111, 235, 0.35);
  background: rgba(31, 111, 235, 0.1);
}

.git-commit-ai:not(:disabled):hover {
  background: rgba(31, 111, 235, 0.18);
  color: #c0d9ff;
}

.git-file-list {
  flex: 1;
  overflow-y: auto;
  padding: 2px 0;
}

.git-file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  cursor: pointer;
  transition: background 120ms ease;
  min-width: 0;
}

.git-file-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.git-file-status {
  font-family: monospace;
  font-size: 12px;
  font-weight: 700;
  width: 14px;
  text-align: center;
  flex-shrink: 0;
}

.git-file-path {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
  unicode-bidi: plaintext;
}

.git-file-item.active {
  background: rgba(31, 111, 235, 0.15);
}

.git-file-item.loading,
.git-log-file.loading {
  cursor: wait;
  opacity: 0.72;
}

.git-file-item.loading .git-file-path::after,
.git-log-file.loading .git-file-path::after {
  content: "加载中";
  margin-left: 8px;
  color: var(--text-dim);
  font-size: 12px;
}

.git-file-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-dim);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 120ms ease;
  line-height: 1;
}

.git-file-check:hover {
  background: rgba(31, 111, 235, 0.2);
  border-color: rgba(31, 111, 235, 0.4);
  color: #7aa2f7;
}

.git-file-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0 !important;
  font-size: 14px !important;
  border-radius: 5px !important;
  border: 1px solid transparent !important;
  background: transparent !important;
  color: var(--muted) !important;
  opacity: 0.6;
  transition: all 120ms ease;
  flex-shrink: 0;
}

.git-file-item:hover .git-file-btn {
  opacity: 1;
}

.git-file-btn:hover:not(:disabled) {
  background: rgba(31, 111, 235, 0.18) !important;
  color: #7aa2f7 !important;
  border-color: rgba(31, 111, 235, 0.3) !important;
}

.git-file-btn.danger {
  color: var(--muted) !important;
  border-color: transparent !important;
}

.git-file-btn.danger:hover:not(:disabled) {
  background: rgba(255, 77, 94, 0.15) !important;
  color: #ff6b7a !important;
  border-color: rgba(255, 77, 94, 0.3) !important;
}

.git-section {
  border-bottom: 1px solid var(--border);
}

.git-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 14px;
  background: rgba(255, 255, 255, 0.025);
  position: sticky;
  top: 0;
  z-index: 2;
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border);
}

.git-section-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  color: inherit;
  font: inherit;
  text-align: left;
}

.git-section-toggle:hover .git-section-title {
  color: var(--text);
}

.git-section-chevron {
  flex-shrink: 0;
  width: 12px;
  font-size: 11px;
  color: var(--text-dim);
  line-height: 1;
}

.git-section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
  letter-spacing: 0.02em;
  text-transform: uppercase;
  flex-shrink: 0;
}

.git-section-actions {
  display: flex;
  gap: 4px;
}

button.ghost.danger {
  color: #f7768e;
}

button.ghost.danger:hover:not(:disabled) {
  background: rgba(247, 118, 142, 0.12);
  color: #ff9a9a;
}

.git-log-section {
  border-top: 1px solid var(--border);
  margin-top: 8px;
  padding-top: 4px;
}

.git-log-toggle {
  width: 100%;
  justify-content: flex-start;
  text-align: left;
  border-radius: 4px;
  border: none !important;
  padding: 8px 10px !important;
  font-size: 12px !important;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--text-dim) !important;
  transition: all 150ms ease;
}

.git-log-toggle:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06) !important;
  color: var(--text) !important;
}

.git-log-item {
  display: flex;
  flex-direction: column;
  font-size: 12px;
}

.git-log-item:hover {
  background: rgba(255, 255, 255, 0.03);
}

.git-log-entry-head {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 7px 14px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.git-log-entry-head:hover {
  background: rgba(255, 255, 255, 0.04);
}

.git-log-chevron {
  width: 10px;
  color: var(--text-dim);
  flex-shrink: 0;
}

.git-log-hash {
  font-family: monospace;
  color: #7aa2f7;
  flex-shrink: 0;
}

.git-log-msg {
  flex: 1;
  min-width: 0;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-log-count {
  flex-shrink: 0;
  min-width: 18px;
  padding: 1px 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-dim);
  font-size: 11px;
  text-align: center;
}

.git-log-detail {
  padding: 0 0 5px 27px;
}

.git-log-full-msg {
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text);
  font-size: 12px;
  line-height: 1.5;
  padding: 8px 12px;
  margin-bottom: 4px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
}

.git-log-files {
  padding: 0 0 5px 27px;
}

.git-log-file {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 5px 12px 5px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.git-log-file:hover {
  background: rgba(31, 111, 235, 0.12);
}

.git-diff-panel {
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  max-height: 40%;
  overflow: hidden;
}

.git-diff-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.03);
}

.git-diff-title {
  font-size: 11px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-diff-content {
  flex: 1;
  overflow: auto;
  margin: 0;
  padding: 8px 12px;
  font-family: monospace;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text);
  white-space: pre;
  tab-size: 4;
}

.editor-panel {
  display: flex;
  flex-direction: column;
  background: rgba(2, 6, 23, 0.35);
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
}

.ask-ai-floating {
  position: absolute;
  bottom: 16px;
  right: 16px;
  padding: 8px 18px;
  background: rgba(31, 111, 235, 0.9);
  color: white;
  border-radius: 10px;
  font-size: 13px;
  cursor: pointer;
  z-index: 10;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  transition: all 180ms ease;
}

.ask-ai-floating:hover {
  background: rgba(31, 111, 235, 1);
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
}

.quote-floating {
  position: fixed;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  background: rgba(2, 6, 23, 0.92);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 11px;
  color: var(--text);
  cursor: pointer;
  z-index: 1000;
  transform: translate(-50%, -100%);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  transition: all 180ms ease;
  white-space: nowrap;
  backdrop-filter: blur(10px);
}

.quote-floating:hover {
  background: rgba(31, 111, 235, 0.2);
  border-color: rgba(31, 111, 235, 0.5);
  color: rgba(255, 255, 255, 0.95);
  transform: translate(-50%, -100%) translateY(-2px);
  box-shadow: 0 6px 20px rgba(31, 111, 235, 0.3);
}

.quote-icon {
  font-size: 13px;
  line-height: 1;
}

.chat-panel {
  position: relative;

  border-left: 1px solid var(--border);
}

.resize-handle {
  width: 4px;
  cursor: col-resize;
  background: transparent;
  transition: background 150ms ease;
  flex-shrink: 0;
}

.resize-handle:hover {
  background: rgba(31, 111, 235, 0.4);
}

.resize-handle:active {
  background: rgba(31, 111, 235, 0.6);
}

@media (max-width: 980px) {
  .workspace {
    flex-direction: column;
  }

  .file-panel {
    width: 100% !important;
    height: 200px;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }

  .resize-handle {
    width: 100%;
    height: 4px;
    cursor: row-resize;
  }

  .chat-panel {
    width: 100% !important;
    height: 280px;
    border-left: none;
    border-top: 1px solid var(--border);
  }

  .editor-panel {
    flex: 1;
  }
}

@media (max-width: 1100px) and (min-width: 981px) {
  .file-panel {
    min-width: 220px;
  }

  .chat-panel {
    min-width: 300px;
  }

  .toolbar-project {
    flex-basis: 360px;
  }
}

@media (max-width: 720px) {
  .app-toolbar {
    align-items: stretch;
    padding: 8px 10px;
  }

  .toolbar-project,
  .toolbar-actions {
    flex-basis: 100%;
  }

  .toolbar-actions {
    justify-content: flex-start;
  }

  .workspace {
    flex-direction: column;
  }

  .file-panel {
    width: 100% !important;
    height: 200px;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }

  .chat-panel {
    width: 100% !important;
    height: 300px;
    border-left: none;
    border-top: 1px solid var(--border);
  }

  .panel-head {
    align-items: flex-start;
  }

  .panel-head-right,
  .chat-actions {
    justify-content: flex-start;
  }

  .chat-action-row {
    flex-wrap: wrap;
  }

  .editor-header {
    align-items: stretch;
  }

  .editor-header-actions {
    border-left: none;
    border-top: 1px solid var(--border);
    flex-basis: 100%;
  }
}

.file-panel-head {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  background: rgba(17, 24, 39, 0.4);
  flex-shrink: 0;
}

.file-panel-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.file-panel-top-row {
  justify-content: space-between;
}

.file-panel-search-row {
  gap: 8px;
}

.file-panel-tabs {
  flex-shrink: 0;
}

.file-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: all 120ms ease;
  flex-shrink: 0;
}

.icon-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
  border-color: var(--border);
}

.icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.icon-btn.danger:hover:not(:disabled) {
  background: rgba(255, 80, 80, 0.12);
  color: #ffb4b4;
  border-color: rgba(255, 120, 120, 0.35);
}

.toolbar-sep {
  width: 1px;
  height: 14px;
  background: var(--border);
  margin: 0 2px;
  flex-shrink: 0;
}

button.ghost.tiny {
  padding: 5px 10px;
  font-size: 12px;
  border-radius: 6px;
  white-space: nowrap;
}

button.ghost.danger {
  color: #ff9a9a;
  border-color: rgba(255, 120, 120, 0.35);
}

button.ghost.danger:hover:not(:disabled) {
  background: rgba(255, 80, 80, 0.12);
  color: #ffb4b4;
}

.ctx-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
}

.ctx-menu {
  position: fixed;
  min-width: 160px;
  background: #1a2236;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 10px;
  padding: 4px 0;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(12px);
}

.ctx-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 14px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.92);
  background: none;
  border: none;
  cursor: pointer;
  transition: background 100ms ease;
}

.ctx-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.ctx-item.danger {
  color: #ff9a9a;
}

.ctx-item.danger:hover {
  background: rgba(255, 80, 80, 0.12);
  color: #ffb4b4;
}

.ctx-sep {
  height: 1px;
  margin: 4px 0;
  background: rgba(255, 255, 255, 0.1);
}

.msg-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0 2px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.62);
  line-height: 1.5;
}

.msg-status-text {
  flex: 1;
  min-width: 0;
}

.msg-answer {
  margin: 0;
  max-width: 100%;
  min-width: 0;
}

.msg-user-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 8px;
  max-width: 100%;
}

.msg-user-image {
  display: block;
  max-width: min(220px, 100%);
  max-height: 180px;
  object-fit: contain;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(0, 0, 0, 0.25);
}

.msg-answer--final,
.msg-answer--streaming {
  position: relative;
  z-index: 0;
  margin-top: 8px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.035);
}

.msg-answer--streaming {
  border-color: rgba(145, 190, 255, 0.22);
  background: rgba(31, 111, 235, 0.06);
}

.msg-answer--final :deep(.msg-markdown) {
  font-size: 14px;
  line-height: 1.7;
}

.msg-answer--streaming :deep(.msg-markdown) {
  font-size: 13px;
  line-height: 1.65;
}

.cursor-timeline-answer {
  margin: 0;
  max-width: 100%;
  min-width: 0;
}

.cursor-timeline-answer--inline.msg-answer--final,
.cursor-timeline-answer--inline.msg-answer--streaming {
  margin-top: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 0;
}

.cursor-agent-feed-shell:has(.cursor-timeline-answer--inline) .cursor-agent-feed-viewport {
  mask-image: none;
  -webkit-mask-image: none;
}

.msg-streaming {
  margin: 0;
  padding: 0;
  max-width: 100%;
  min-width: 0;
  font-size: 13px;
  line-height: 1.65;
  overflow-wrap: anywhere;
  word-break: break-word;
  color: rgba(255, 255, 255, 0.92);
  background: transparent;
  border: none;
  border-radius: 0;
  font-family: inherit;
}

.stream-cursor {
  display: inline-block;
  width: 7px;
  height: 15px;
  margin-left: 2px;
  vertical-align: -2px;
  overflow: hidden;
  color: #91beff;
  background: #91beff;
  animation: stream-blink 1s step-end infinite;
}

@keyframes stream-blink {
  50% {
    opacity: 0;
  }
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: rgba(17, 24, 39, 0.4);
  min-width: 0;
  overflow-x: clip;
}

.panel-head-right {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
}

.history-sync-message {
  margin: -2px 0 10px;
  padding: 8px 10px;
  border: 1px solid rgba(31, 111, 235, 0.22);
  border-radius: 8px;
  background: rgba(31, 111, 235, 0.08);
  color: rgba(255, 255, 255, 0.78);
  font-size: 11px;
  line-height: 1.5;
  word-break: break-all;
}

.history-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--muted);
  text-align: center;
  padding: 24px 12px;
}

.history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-x: hidden;
  overflow-y: auto;
  display: grid;
  gap: 6px;
}

.history-item {
  display: flex;
  align-items: stretch;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
}

.history-item.active {
  border-color: rgba(31, 111, 235, 0.45);
  background: rgba(31, 111, 235, 0.1);
}

.history-item-main {
  flex: 1;
  min-width: 0;
  text-align: left;
  background: transparent;
  border: none;
  color: inherit;
  padding: 10px 12px;
  cursor: pointer;
}

.history-item-title {
  display: block;
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-item-meta {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-copy,
.history-delete {
  align-self: center;
  flex-shrink: 0;
}

.history-delete {
  margin-right: 6px;
}

button.ghost.small,
button.secondary.small,
button.primary.small {
  padding: 7px 14px;
  font-size: 13px;
  flex-shrink: 0;
  border-radius: 6px;
}

.panel-head-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.panel-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.session-picker-wrap {
  position: relative;
  min-width: 0;
  max-width: 100%;
}

.session-picker-row {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.session-nav-btn {
  flex-shrink: 0;
  width: 22px;
  height: 24px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.45);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}

.session-nav-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.88);
  border-color: rgba(255, 255, 255, 0.08);
}

.session-nav-btn:disabled {
  opacity: 0.28;
  cursor: default;
}

.session-picker-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  padding: 3px 8px 3px 6px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.92);
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}

.session-picker-trigger:hover:not(:disabled),
.session-picker-trigger.open {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.08);
}

.session-picker-trigger:disabled {
  opacity: 0.45;
  cursor: default;
}

.session-picker-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-picker-chevron {
  flex-shrink: 0;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
  transition: transform 150ms ease;
}

.session-picker-trigger.open .session-picker-chevron {
  transform: rotate(180deg);
}

.session-picker-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 30;
  width: min(340px, calc(100vw - 48px));
  max-height: min(420px, calc(100vh - 180px));
  display: flex;
  flex-direction: column;
  background: #111827;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
  overflow: hidden;
  backdrop-filter: blur(16px);
}

.session-picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.session-picker-head-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}

.session-picker-new {
  flex-shrink: 0;
}

.session-picker-list {
  flex: 1;
  min-height: 0;
  max-height: 300px;
}

.session-picker-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  min-width: 0;
}

.session-picker-sync {
  font-size: 11px;
  padding: 4px 8px;
}

.session-picker-hint {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.panel-meta {
  font-size: 12px;
  color: var(--muted);
}

.panel-meta.warn {
  color: var(--danger);
}

.panel-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dirty-badge {
  font-size: 11px;
  color: #f0c674;
  padding: 2px 8px;
  background: rgba(240, 198, 116, 0.15);
  border-radius: 6px;
}

.search-mode-switch {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--border);
  flex-shrink: 0;
}

.search-mode-btn {
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.55);
  border-radius: 5px;
  padding: 5px 11px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 150ms ease;
}

.search-mode-btn.active {
  background: rgba(31, 111, 235, 0.25);
  color: #aad0ff;
}

.search-input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 6px 11px;
  font-size: 13px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  outline: none;
  transition: border-color 180ms ease, background 180ms ease;
}

.search-input:focus {
  border-color: rgba(31, 111, 235, 0.5);
  background: rgba(255, 255, 255, 0.06);
  box-shadow: 0 0 0 2px rgba(31, 111, 235, 0.08);
}

.search-input::placeholder {
  color: rgba(255, 255, 255, 0.4);
}

.panel-empty,
.editor-empty,
.chat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 14px;
  color: var(--muted);
  font-size: 13px;
  text-align: center;
  opacity: 0.8;
}

.git-scroll-area .panel-empty::before {
  content: "✓";
  font-size: 28px;
  color: rgba(100, 200, 150, 0.6);
  margin-bottom: 4px;
}

.git-panel-fetch-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.git-fetch-error-detail {
  margin: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  word-break: break-word;
}

.editor-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: 1;
}

.editor-empty-icon {
  font-size: 36px;
  opacity: 0.5;
  margin-bottom: 4px;
}

.editor-empty-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.75);
}

.editor-empty-hint {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--text-dim);
}

.chat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  padding: 32px 20px;
}

.chat-empty-icon {
  font-size: 32px;
  margin-bottom: 8px;
  opacity: 0.7;
}

.chat-empty-title {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
}

.chat-empty-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted);
  max-width: 320px;
}

.chat-empty-desc code {
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(31, 111, 235, 0.15);
  color: #91beff;
  font-size: 11px;
}

.editor-empty.error {
  color: var(--danger);
}

.file-list,
.file-tree {
  flex: 1;
  overflow: auto;
  padding: 4px 0;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--text);
  text-align: left;
  padding: 7px 12px;
  cursor: pointer;
  font-size: 14px;
  line-height: 1.4;
  transition: background 100ms ease;
}

.file-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.file-item.active {
  background: rgba(31, 111, 235, 0.18);
  color: #aad0ff;
}

.file-item-draggable {
  cursor: grab;
}

.file-item-draggable:active {
  cursor: grabbing;
}

.file-item-draggable {
  touch-action: none;
}

.file-icon {
  font-size: 15px;
  width: 20px;
  text-align: center;
  flex-shrink: 0;
}

.file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-item.content-result {
  align-items: flex-start;
}

.file-result-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.file-result-text {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-header {
  display: flex;
  align-items: center;
  min-height: 44px;
  border-bottom: 1px solid var(--border);
  background: rgba(17, 24, 39, 0.45);
  flex-shrink: 0;
}

.editor-header-title {
  display: flex;
  align-items: center;
  padding: 0 14px;
  font-size: 12px;
  color: var(--muted);
  flex: 1;
  min-width: 0;
  min-height: 42px;
}

.editor-header-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
  padding: 6px 8px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
}

.editor-tabs {
  display: flex;
  align-items: stretch;
  gap: 1px;
  flex: 1;
  min-width: 0;
  align-self: stretch;
  padding: 0 4px;
  overflow-x: auto;
}

.editor-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 160px;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.62);
  padding: 9px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: all 150ms ease;
  flex-shrink: 0;
}

.editor-tab:hover {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.88);
}

.editor-tab.active {
  background: rgba(31, 111, 235, 0.1);
  border-bottom-color: var(--primary);
  color: #d6e8ff;
}

.editor-tab.dirty .editor-tab-name {
  font-style: italic;
}

.editor-tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-tab-dot {
  color: #f0c674;
  font-size: 14px;
  line-height: 1;
}

.editor-tab-close {
  color: rgba(255, 255, 255, 0.45);
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
}

.editor-tab-close:hover {
  color: rgba(255, 255, 255, 0.9);
}

.code-editor {
  flex: 1;
  width: 100%;
  min-height: 0;
  border: none;
  resize: none;
  padding: 14px 18px;
  background: var(--panel-2);
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
  outline: none;
  tab-size: 2;
}

.chat-scroll {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: none;
  padding: 12px 14px;
}

.msg-list {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.msg {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  min-width: 0;
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 2px 0;
}

.msg.user {
  flex-direction: row-reverse;
}

.msg-avatar {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: -0.3px;
}

.msg.user .msg-avatar {
  background: rgba(31, 111, 235, 0.25);
  color: #91beff;
  border: 1px solid rgba(31, 111, 235, 0.35);
}

.msg.assistant .msg-avatar {
  background: rgba(179, 146, 240, 0.2);
  color: #d2b8ff;
  border: 1px solid rgba(179, 146, 240, 0.3);
}

.msg-body {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 4px 2px 8px;
}

.msg.user .msg-body {
  flex: 0 1 auto;
  max-width: min(88%, 760px);
  padding: 8px 10px;
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.06);
}

.msg.assistant .msg-body {
  padding-right: 0;
}

.msg-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.msg-role {
  font-size: 11px;
  font-weight: 700;
  color: var(--muted);
}

.msg.user .msg-role {
  color: #91beff;
}

.msg.assistant .msg-role {
  color: #b392f0;
}

.msg-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transition: opacity 120ms ease;
}

.msg:hover .msg-toolbar,
.msg:focus-within .msg-toolbar {
  opacity: 1;
}

.msg-toolbar .resume-btn {
  color: #91beff;
}

.agent-recovery-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(145, 190, 255, 0.35);
  background: rgba(31, 111, 235, 0.12);
}

.agent-recovery-text {
  flex: 1 1 200px;
  font-size: 12px;
  color: #91beff;
  line-height: 1.45;
}

.agent-recovery-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.agent-stall-banner {
  border-color: rgba(255, 196, 120, 0.45);
  background: rgba(255, 166, 87, 0.12);
}

.agent-stall-banner .agent-recovery-text {
  color: #ffc47a;
}

.chat-stall-hint {
  color: #ffc47a;
}

.msg-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.reverted-badge {
  font-size: 11px;
  color: rgba(126, 231, 135, 0.9);
  padding: 3px 10px;
  border-radius: 6px;
  background: rgba(46, 160, 67, 0.15);
  border: 1px solid rgba(46, 160, 67, 0.28);
}

.rejected-badge {
  font-size: 11px;
  color: rgba(255, 180, 180, 0.9);
  padding: 3px 10px;
  border-radius: 6px;
  background: rgba(248, 81, 73, 0.12);
  border: 1px solid rgba(248, 81, 73, 0.28);
}

.pending-badge {
  font-size: 11px;
  color: #f0c674;
  padding: 3px 10px;
  border-radius: 6px;
  background: rgba(240, 198, 116, 0.12);
  border: 1px solid rgba(240, 198, 116, 0.28);
}

.applying-badge {
  font-size: 11px;
  color: #79c0ff;
  padding: 3px 10px;
  border-radius: 6px;
  background: rgba(121, 192, 255, 0.1);
  border: 1px solid rgba(121, 192, 255, 0.28);
}

.applied-badge {
  font-size: 11px;
  color: #7ee787;
  padding: 3px 10px;
  border-radius: 6px;
  background: rgba(126, 231, 135, 0.1);
  border: 1px solid rgba(126, 231, 135, 0.28);
  animation: applied-fade-out 0.6s ease 3s forwards;
}

@keyframes applied-fade-out {
  from { opacity: 1; max-width: 200px; padding: 3px 10px; margin: 0; }
  to   { opacity: 0; max-width: 0; padding: 3px 0; margin: 0; border-width: 0; overflow: hidden; }
}

button.primary.small-action {
  padding: 5px 14px;
  font-size: 12px;
}

button.compact {
  padding: 5px 12px;
  font-size: 12px;
  border-radius: 7px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.chip {
  background: rgba(31, 111, 235, 0.12);
  color: #91beff;
  border: 1px solid rgba(31, 111, 235, 0.25);
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  transition: all 180ms ease;
}

.chip:hover:not(:disabled) {
  background: rgba(31, 111, 235, 0.22);
  border-color: rgba(31, 111, 235, 0.4);
}

.chat-mode-switch {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.mode-btn {
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.55);
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 180ms ease;
}

.mode-btn:hover:not(:disabled):not(.active) {
  color: rgba(255, 255, 255, 0.85);
  background: rgba(255, 255, 255, 0.06);
}

.mode-btn.active {
  background: rgba(31, 111, 235, 0.25);
  color: #aad0ff;
  box-shadow: inset 0 0 0 1px rgba(31, 111, 235, 0.35);
}

.mode-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.chat-composer {
  position: relative;
  flex-shrink: 0;
  min-width: 0;
  border-top: 1px solid var(--border);
  padding: 8px 12px 10px;
  overflow: hidden;

  backdrop-filter: blur(8px);
  transition: background 200ms ease, border-color 200ms ease;
}

.quoted-preview {
  margin-bottom: 10px;
  border: 1px solid rgba(179, 146, 240, 0.3);
  border-radius: 8px;
  background: rgba(179, 146, 240, 0.06);
  overflow: hidden;
}

.quoted-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: rgba(179, 146, 240, 0.1);
  border-bottom: 1px solid rgba(179, 146, 240, 0.2);
}

.quoted-preview-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  color: rgba(179, 146, 240, 0.9);
}

.quoted-preview-icon {
  font-size: 13px;
  line-height: 1;
}

.quoted-preview-close {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  padding: 0 4px;
  font-size: 16px;
  line-height: 1;
  transition: color 150ms ease;
}

.quoted-preview-close:hover {
  color: rgba(255, 255, 255, 0.9);
}

.quoted-preview-body {
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.7);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 80px;
  overflow: auto;
}

.chat-input-field {
  position: relative;
  min-width: 0;

}

.mention-dropdown {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 6px);
  z-index: 12;
  max-height: 220px;
  overflow: auto;
  display: grid;
  gap: 2px;
  padding: 6px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(12px);
}

.mention-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  text-align: left;
  background: transparent;
  color: inherit;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 8px 10px;
  cursor: pointer;
  transition: all 150ms ease;
}

.mention-item:hover,
.mention-item.active {
  background: rgba(31, 111, 235, 0.16);
  border-color: rgba(31, 111, 235, 0.28);
}

.mention-item-name {
  font-size: 12px;
  font-weight: 600;
}

.mention-item-path {
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: rgba(145, 190, 255, 0.82);
}

.file-drag-ghost {
  position: fixed;
  z-index: 10000;
  pointer-events: none;
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(179, 146, 240, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.35);
  color: #fff;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  white-space: nowrap;
}

.chat-panel.drag-over {
  outline: 2px solid rgba(31, 111, 235, 0.55);
  outline-offset: -2px;
}

.chat-panel.drag-over .chat-composer {
  background: rgba(31, 111, 235, 0.15);
  border-top-color: rgba(31, 111, 235, 0.6);
}

.chat-input-box {
  width: 100%;
  min-height: 56px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 0;

  transition: border-color 180ms ease, background 180ms ease, box-shadow 180ms ease;
  cursor: text;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.chat-input-box.focused {
  border-color: rgba(145, 190, 255, 0.58);
  background: rgba(255, 255, 255, 0.075);
  box-shadow: 0 0 0 1px rgba(145, 190, 255, 0.12), 0 12px 28px rgba(0, 0, 0, 0.18);
}

.chat-composer-editor {
  width: 100%;
  max-width: 100%;
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
}

.chat-bottom {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.chat-status-row {
  display: flex;
  align-items: center;
  min-height: 16px;
  font-size: 11px;
}

.chat-action-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.chat-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.agent-activity {
  margin-bottom: 8px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.07);
  overflow: hidden;
}

.cursor-agent-wrap {
  margin: 0 0 4px;
  padding: 2px 0;
}

.cursor-agent-folded {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  color: rgba(139, 148, 158, 0.85);
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: all 0.2s ease;
  user-select: none;
}

.cursor-agent-folded:hover {
  color: rgba(230, 237, 243, 0.92);
  background: rgba(88, 166, 255, 0.08);
  border-color: rgba(88, 166, 255, 0.2);
}

.cursor-agent-folded-icon {
  font-size: 8px;
  flex-shrink: 0;
  color: rgba(88, 166, 255, 0.6);
  transition: transform 0.2s ease;
}

.cursor-agent-folded:hover .cursor-agent-folded-icon {
  color: rgba(88, 166, 255, 0.9);
  transform: scale(1.15);
}

.cursor-agent-folded-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 320px;
}

.cursor-timeline {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 0;
}

.cursor-timeline-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cursor-timeline-controls {
  display: flex;
  gap: 6px;
  margin-bottom: 2px;
  padding: 0 0 4px;
}

.cursor-timeline-controls button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.02);
  color: rgba(139, 148, 158, 0.75);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.cursor-timeline-controls button:hover {
  color: rgba(230, 237, 243, 0.9);
  background: rgba(88, 166, 255, 0.08);
  border-color: rgba(88, 166, 255, 0.2);
}

.cursor-timeline-steps {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cursor-agent-wrap.collapsed {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 0;
  padding: 0;
}

.cursor-agent-wrap.collapsed .cursor-activity-toggle {
  align-self: flex-start;
}

.cursor-agent-wrap.running {
  margin-bottom: 6px;
}

.cursor-agent-wrap.running .cursor-agent-compact {
  max-height: min(32vh, 220px);
  padding: 6px 10px;
}

.cursor-agent-compact {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  overflow: hidden;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(1, 4, 9, 0.65);
  border: 1px solid rgba(48, 54, 61, 0.75);
}

.cursor-compact-expand {
  flex-shrink: 0;
  margin-top: 2px;
}

.cursor-compact-summary {
  margin: 0;
  flex-shrink: 0;
  font-size: 12px;
  line-height: 1.45;
  color: rgba(139, 148, 158, 0.88);
}

.cursor-agent-feed-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}

.cursor-agent-feed-shell {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-height: 0;
  border-radius: 8px;
  background: rgba(1, 4, 9, 0.92);
  border: 1px solid rgba(48, 54, 61, 0.78);
  overflow: hidden;
  transition: max-height 0.3s ease, opacity 0.3s ease;
  position: sticky;
  top: 0;
  z-index: 2;
}

.cursor-agent-feed-shell.collapsed {
  max-height: 0;
  opacity: 0;
  margin: 0;
  padding: 0;
  border: none;
}

.cursor-agent-feed-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
  padding: 6px 10px 4px;
  border-bottom: none;
  background: rgba(1, 4, 9, 0.88);
}

.cursor-agent-feed-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(139, 148, 158, 0.92);
}

.cursor-agent-feed-meta {
  font-size: 11px;
  color: rgba(88, 166, 255, 0.72);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.cursor-agent-feed-viewport-wrap {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.cursor-agent-feed-viewport {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  max-height: min(36vh, 260px);
  overflow: hidden auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.14) transparent;
  mask-image: linear-gradient(to bottom, #000 0, #000 calc(100% - 10px), transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, #000 0, #000 calc(100% - 10px), transparent 100%);
}

.cursor-agent-feed-viewport::-webkit-scrollbar {
  width: 6px;
}

.cursor-agent-feed-viewport::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
}

.cursor-agent-feed {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px 10px;
  min-height: min-content;
  min-width: 0;
}

.cursor-agent-wrap.running .cursor-agent-feed-viewport {
  max-height: min(32vh, 220px);
}

.cursor-chain-jump {
  position: absolute;
  bottom: 10px;
  left: 50%;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid rgba(88, 166, 255, 0.42);
  background: rgba(1, 8, 18, 0.92);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  color: rgba(126, 182, 255, 0.96);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transform: translateX(-50%);
  transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
}

.cursor-chain-jump:hover {
  background: rgba(14, 28, 48, 0.96);
  border-color: rgba(126, 182, 255, 0.65);
  transform: translateX(-50%) translateY(-1px);
}

.cursor-activity-collapse--inline {
  align-self: flex-start;
  margin-bottom: 2px;
  font-size: 10.5px;
  padding: 1px 6px;
}

.cursor-thought {
  margin: 0;
  padding: 2px 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: rgba(230, 237, 243, 0.82);
  word-break: break-word;
}

.cursor-thought :deep(.msg-markdown) {
  font-size: inherit;
  line-height: inherit;
  color: inherit;
}

.cursor-thought :deep(.msg-markdown p) {
  margin: 0 0 0.4em;
}

.cursor-thought :deep(.msg-markdown p:last-child) {
  margin-bottom: 0;
}

.cursor-thought :deep(.msg-markdown h1),
.cursor-thought :deep(.msg-markdown h2),
.cursor-thought :deep(.msg-markdown h3),
.cursor-thought :deep(.msg-markdown h4) {
  margin: 0.5em 0 0.3em;
  font-size: inherit;
  font-weight: 600;
  color: rgba(230, 237, 243, 0.92);
}

.cursor-thought :deep(.msg-markdown h3) {
  font-size: 1.02em;
}

.cursor-thought :deep(.msg-markdown code) {
  font-size: 0.92em;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(139, 148, 158, 0.1);
  color: rgba(230, 237, 243, 0.88);
}

.cursor-thought :deep(.msg-markdown pre) {
  margin: 0.4em 0;
  padding: 6px 8px;
  border-radius: 4px;
  background: rgba(1, 4, 9, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.04);
  overflow-x: auto;
}

.cursor-actions-block {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-left: 12px;
  border-left: 2px solid rgba(88, 166, 255, 0.12);
  min-width: 0;
  margin: 2px 0;
}

.cursor-actions-fold {
  margin: 0 0 1px;
}

.cursor-actions-fold-summary {
  list-style: none;
  font-size: 10.5px;
  line-height: 1.4;
  color: rgba(139, 148, 158, 0.75);
  cursor: pointer;
  user-select: none;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
  transition: color 0.15s ease;
}

.cursor-actions-fold-summary:hover {
  color: rgba(139, 148, 158, 0.95);
}

.cursor-actions-fold-summary::-webkit-details-marker {
  display: none;
}

.cursor-actions-fold-summary::before {
  content: "▸ ";
  font-size: 9px;
  color: rgba(139, 148, 158, 0.5);
}

.cursor-actions-fold[open] > .cursor-actions-fold-summary::before {
  content: "▾ ";
}

.cursor-actions-fold-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-top: 3px;
  padding-left: 4px;
  max-height: 120px;
  overflow: auto;
}

.cursor-action {
  margin: 0;
  padding: 1px 0;
  font-size: 11.5px;
  line-height: 1.55;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 0.01em;
  color: rgba(171, 178, 191, 0.88);
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.cursor-action.done {
  color: rgba(139, 148, 158, 0.72);
}

.cursor-action.running {
  color: rgba(126, 182, 255, 0.95);
}

.cursor-action.fail {
  color: rgba(248, 143, 143, 0.92);
}

.cursor-action.planning {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-style: normal;
  color: rgba(88, 166, 255, 0.85);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: rgba(88, 166, 255, 0.04);
  border-radius: 4px;
  margin: 2px 0;
  font-size: 11.5px;
}

.cursor-action.planning::before {
  content: "";
  width: 10px;
  height: 10px;
  border: 1.5px solid rgba(88, 166, 255, 0.25);
  border-top-color: rgba(88, 166, 255, 0.8);
  border-radius: 50%;
  animation: planning-spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes planning-spin {
  to { transform: rotate(360deg); }
}

.cursor-action-details {
  margin: 0;
}

.cursor-action-details > summary {
  list-style: none;
  cursor: pointer;
}

.cursor-action-details > summary::-webkit-details-marker {
  display: none;
}

.cursor-action-expand {
  margin: 4px 0 2px 8px;
  padding-left: 8px;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
}

/* 紧凑型工具调用样式 */
.cursor-action-compact {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  border-radius: 4px;
  transition: all 0.15s ease;
  min-width: 0;
  border: 1px solid transparent;
}

.cursor-action-compact:hover {
  background: rgba(88, 166, 255, 0.06);
  border-color: rgba(88, 166, 255, 0.1);
}

.cursor-action-compact.running {
  background: rgba(88, 166, 255, 0.04);
  border-color: rgba(88, 166, 255, 0.15);
}

.cursor-action-compact.done {
  border-color: transparent;
}

.cursor-action-compact.fail {
  border-color: rgba(248, 81, 73, 0.15);
  background: rgba(248, 81, 73, 0.04);
}

.cursor-action-icon {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  flex-shrink: 0;
  line-height: 1;
}

.cursor-action-icon.read {
  background: rgba(63, 185, 80, 0.12);
}

.cursor-action-icon.write {
  background: rgba(137, 87, 229, 0.12);
}

.cursor-action-icon.search {
  background: rgba(210, 153, 34, 0.12);
}

.cursor-action-icon.default {
  background: rgba(139, 148, 158, 0.1);
}

.cursor-action-icon.running {
  animation: tool-pulse 1.2s ease-in-out infinite;
}

.cursor-action-label {
  color: rgba(139, 148, 158, 0.82);
  flex-shrink: 0;
  font-size: 11px;
}

.cursor-action-path {
  color: rgba(88, 166, 255, 0.85);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  font-size: 11px;
}

.cursor-action-meta {
  color: rgba(139, 148, 158, 0.55);
  margin-left: auto;
  flex-shrink: 0;
  font-size: 10px;
}

.cursor-action-status {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}

.cursor-action-status.pending {
  background: rgba(72, 79, 88, 0.5);
}

.cursor-action-status.running {
  background: #58a6ff;
  animation: tool-pulse 1.2s ease-in-out infinite;
  box-shadow: 0 0 4px rgba(88, 166, 255, 0.4);
}

.cursor-action-status.done {
  background: #3fb950;
  box-shadow: 0 0 3px rgba(63, 185, 80, 0.3);
}

.cursor-action-status.fail {
  background: #f85149;
  box-shadow: 0 0 3px rgba(248, 81, 73, 0.3);
}

.cursor-action-details-compact {
  margin: 0;
  position: relative;
}

.cursor-action-expand-toggle {
  cursor: pointer;
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  color: rgba(139, 148, 158, 0.5);
  font-size: 9px;
  transition: all 0.15s ease;
}

.cursor-action-expand-toggle:hover {
  background: rgba(139, 148, 158, 0.1);
  color: rgba(139, 148, 158, 0.8);
}

.cursor-action-expand-toggle::before {
  content: "▸";
}

.cursor-action-details-compact[open] > .cursor-action-expand-toggle::before {
  content: "▾";
}

.cursor-action-expand-compact {
  margin: 2px 0 0 22px;
  padding: 4px 6px;
  background: rgba(1, 4, 9, 0.4);
  border-radius: 4px;
  border-left: 2px solid rgba(88, 166, 255, 0.1);
  font-size: 10.5px;
  max-height: 100px;
  overflow: auto;
}

.cursor-action-expand-compact pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  color: rgba(139, 148, 158, 0.82);
  line-height: 1.45;
}

@keyframes tool-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.cursor-activity-toggle,
.cursor-activity-collapse {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 4px;
  padding: 3px 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.03);
  color: rgba(255, 255, 255, 0.48);
  font-size: 11px;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
}

.cursor-activity-toggle:hover,
.cursor-activity-collapse:hover {
  color: rgba(255, 255, 255, 0.78);
  border-color: rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
}

.cursor-debug-panel {
  margin-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  padding-top: 6px;
}

.cursor-debug-panel > summary {
  font-size: 11px;
  color: rgba(139, 148, 158, 0.6);
  cursor: pointer;
  user-select: none;
  transition: color 0.15s ease;
}

.cursor-debug-panel > summary:hover {
  color: rgba(139, 148, 158, 0.85);
}

.cursor-debug-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
  padding: 6px 8px;
  background: rgba(1, 4, 9, 0.3);
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.cursor-debug-round-title {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(88, 166, 255, 0.55);
  margin-bottom: 4px;
}

.cursor-debug-nested {
  margin-left: 4px;
}

.cursor-debug-nested > summary {
  font-size: 11px;
  color: rgba(139, 148, 158, 0.7);
  cursor: pointer;
  margin-bottom: 4px;
  transition: color 0.15s ease;
}

.cursor-debug-nested > summary:hover {
  color: rgba(230, 237, 243, 0.85);
}

.agent-activity.collapsed {
  background: transparent;
  border-color: transparent;
}

.agent-activity-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  background: transparent;
  border: none;
  border-radius: 0;
  color: rgba(255, 255, 255, 0.68);
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.agent-activity-toggle:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.04);
  opacity: 1;
}

.agent-activity-toggle:disabled {
  cursor: default;
  opacity: 1;
}

.agent-activity-chevron {
  width: 14px;
  flex-shrink: 0;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.55);
}

.agent-activity-title {
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.72);
}

.agent-activity-hint,
.agent-activity-summary {
  margin-left: auto;
  min-width: 0;
  font-size: 11px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-activity-hint {
  color: #91beff;
}

.agent-activity-body {
  padding: 0 10px 10px;
}

.agent-activity-body.compact {
  padding: 0 8px 8px;
}

.agent-run-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(31, 111, 235, 0.08);
  border: 1px solid rgba(88, 166, 255, 0.16);
  min-width: 0;
}

.agent-run-strip-text {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-run-turn {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.45);
}

.agent-tool-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}

.agent-tool-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 1.3;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.62);
}

.agent-tool-chip.running {
  border-color: rgba(179, 146, 240, 0.35);
  background: rgba(179, 146, 240, 0.1);
  color: rgba(255, 255, 255, 0.82);
}

.agent-tool-chip.fail {
  border-color: rgba(248, 81, 73, 0.35);
  color: #ff9a9a;
}

.agent-tool-chip-text {
  font-weight: 600;
}

.agent-tool-chip-detail {
  opacity: 0.72;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
}

.agent-tool-chip-state {
  opacity: 0.55;
}

.agent-run-mini {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 5px 8px;
  border-radius: 8px;
  background: rgba(31, 111, 235, 0.06);
  border: 1px solid rgba(88, 166, 255, 0.12);
  min-width: 0;
}

.agent-run-mini-turn {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  color: #91beff;
}

.agent-run-mini-model {
  flex-shrink: 0;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-run-mini-status {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.72);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-round-timeline {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.agent-round-group {
  position: relative;
  padding: 10px 10px 10px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.agent-round-group.active {
  border-color: rgba(88, 166, 255, 0.28);
  background: rgba(31, 111, 235, 0.05);
  box-shadow: inset 3px 0 0 rgba(88, 166, 255, 0.55);
}

.agent-round-group.setup {
  background: rgba(255, 255, 255, 0.015);
}

.agent-round-group.done:not(.setup) {
  opacity: 0.92;
}

.agent-round-head {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.42);
  margin-bottom: 8px;
}

.agent-round-max {
  font-weight: 500;
  color: rgba(255, 255, 255, 0.28);
}

.agent-round-narrative {
  margin: 0 0 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(179, 146, 240, 0.08);
  border-left: 3px solid rgba(179, 146, 240, 0.55);
  font-size: 12px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.88);
  white-space: pre-wrap;
  word-break: break-word;
}

.agent-round-section + .agent-round-section {
  margin-top: 10px;
}

.agent-round-section-label {
  margin-bottom: 6px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: rgba(255, 255, 255, 0.38);
}

.agent-round-model-steps {
  list-style: none;
  margin: 0;
  padding: 0 0 0 8px;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
}

.agent-round-model-step {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 6px;
  padding-left: 0;
}

.agent-round-model-step:last-child {
  margin-bottom: 0;
}

.agent-round-model-step .status-log-dot {
  margin-top: 5px;
}

.agent-round-step-tag {
  flex-shrink: 0;
  min-width: 34px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.5;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.55);
  text-align: center;
}

.agent-round-model-step.active .agent-round-step-tag {
  background: rgba(88, 166, 255, 0.18);
  color: #91beff;
}

.agent-round-model-step.active .status-log-text {
  color: #c8e1ff;
}

.agent-round-model-step.done:not(.active) .status-log-text {
  color: rgba(255, 255, 255, 0.58);
}

.agent-round-tools {
  margin: 0;
  padding: 0 0 0 8px;
  border-left: 1px solid rgba(255, 255, 255, 0.06);
}

.agent-round-tools .tool-item {
  margin-bottom: 5px;
}

.agent-round-tools .tool-item.done .tool-item-action {
  color: rgba(139, 148, 158, 0.78);
}

.agent-round-tools .tool-item.running .tool-item-action {
  color: rgba(126, 182, 255, 0.95);
}

.agent-round-detail {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.12);
  overflow: hidden;
}

.agent-round-detail[open] {
  border-color: rgba(88, 166, 255, 0.18);
}

.agent-round-detail-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.72);
  cursor: pointer;
  list-style: none;
}

.agent-round-detail-summary::-webkit-details-marker {
  display: none;
}

.agent-round-detail-meta {
  font-size: 10px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.42);
}

.agent-round-message-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 10px 10px;
  max-height: 280px;
  overflow: auto;
}

.agent-round-message {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding-top: 8px;
}

.agent-round-message:first-child {
  border-top: none;
  padding-top: 0;
}

.agent-round-message-head {
  margin-bottom: 4px;
}

.agent-round-message-role {
  display: inline-flex;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.07);
  color: rgba(255, 255, 255, 0.58);
}

.agent-round-response-body {
  padding: 0 10px 10px;
}

.agent-round-tool-plan {
  margin-top: 8px;
}

.tool-call-preview {
  color: rgba(126, 182, 255, 0.72);
}

.status-log-scroll-wrap.compact {
  margin: 0;
}

.status-log-scroll-wrap.compact .status-log-scroll {
  max-height: min(42vh, 360px);
}

.status-log-scroll-wrap.compact::before,
.status-log-scroll-wrap.compact::after {
  height: 16px;
}

.agent-step-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(31, 111, 235, 0.1), rgba(179, 146, 240, 0.05));
  border: 1px solid rgba(88, 166, 255, 0.22);
}

.agent-step-hero-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.agent-step-hero-text {
  min-width: 0;
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.92);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-step-hero-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.agent-model-pill {
  font-size: 10px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.1);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-step-history {
  margin: 0 0 10px;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 3px;
}

.agent-live-feed {
  margin: 0 0 10px;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 4px;
  max-height: 160px;
  overflow: auto;
}

.agent-live-feed-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.agent-live-feed-item.active {
  border-color: rgba(88, 166, 255, 0.28);
  background: rgba(31, 111, 235, 0.08);
}

.agent-live-feed-item.tool.active {
  border-color: rgba(179, 146, 240, 0.28);
  background: rgba(179, 146, 240, 0.08);
}

.agent-live-feed-dot {
  width: 6px;
  height: 6px;
  margin-top: 5px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.25);
  flex-shrink: 0;
}

.agent-live-feed-item.active .agent-live-feed-dot {
  background: #58a6ff;
  box-shadow: 0 0 8px rgba(88, 166, 255, 0.65);
  animation: agent-feed-pulse 1.2s ease-in-out infinite;
}

.agent-live-feed-item.tool.active .agent-live-feed-dot {
  background: #b392f0;
  box-shadow: 0 0 8px rgba(179, 146, 240, 0.65);
}

.agent-live-feed-text {
  min-width: 0;
  font-size: 11px;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.72);
  word-break: break-word;
}

@keyframes agent-feed-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.55;
    transform: scale(0.85);
  }
}

.agent-step-history li {
  position: relative;
  padding-left: 14px;
  font-size: 11px;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.42);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-step-history li::before {
  content: "";
  position: absolute;
  left: 2px;
  top: 6px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.22);
}

.agent-status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.status-pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #58a6ff;
  box-shadow: 0 0 0 0 rgba(88, 166, 255, 0.55);
  animation: agent-pulse 1.4s ease-out infinite;
  flex-shrink: 0;
}

@keyframes agent-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(88, 166, 255, 0.55);
  }
  70% {
    box-shadow: 0 0 0 8px rgba(88, 166, 255, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(88, 166, 255, 0);
  }
}

.agent-status-text {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.82);
}

.agent-turn-pill {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 10px;
  border-radius: 999px;
  background: rgba(31, 111, 235, 0.18);
  color: #91beff;
  border: 1px solid rgba(31, 111, 235, 0.28);
}

.agent-phase-badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 2px 8px;
  border-radius: 8px;
  background: rgba(179, 146, 240, 0.16);
  color: #d2b8ff;
  border: 1px solid rgba(179, 146, 240, 0.32);
  flex-shrink: 0;
}

.tool-timeline-block > .tool-timeline {
  padding: 0 8px 6px;
}

.tool-timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 1px;
}

.tool-item {
  list-style: none;
  margin: 0;
  padding: 0;
  border-radius: 6px;
  background: transparent;
}

.tool-item.running {
  background: rgba(31, 111, 235, 0.08);
}

.tool-item.fail:not(.running) {
  background: rgba(248, 81, 73, 0.06);
}

.tool-item-details > summary.tool-item-row {
  display: flex;
}

.tool-item-details > summary {
  list-style: none;
  cursor: pointer;
}

.tool-item-details > summary::-webkit-details-marker {
  display: none;
}

.tool-item-details > summary::after {
  content: "▸";
  flex-shrink: 0;
  margin-left: 4px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
}

.tool-item-details[open] > summary::after {
  content: "▾";
}

.tool-item-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 3px 6px;
}

.tool-item-icon {
  font-size: 11px;
  line-height: 1;
  flex-shrink: 0;
}

.tool-item-line {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-item-action {
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
}

.tool-item-target {
  margin-left: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: rgba(145, 190, 255, 0.82);
}

.tool-item-status {
  margin-left: 4px;
  color: rgba(255, 255, 255, 0.42);
}

.tool-item-status.running {
  color: #91beff;
}

.tool-item-status.fail {
  color: #ff9a9a;
}

.tool-item-expand-body {
  padding: 0 6px 4px 22px;
}

.tool-item-expand-body .trace-pre {
  max-height: 160px;
  margin: 0;
  font-size: 10px;
  line-height: 1.4;
}

.trace-block {
  margin-top: 6px;
  margin-bottom: 0;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.12);
}

.trace-block + .trace-block,
.agent-step-history + .trace-block,
.tool-timeline {
  margin-top: 8px;
}

.trace-block-title {
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.78);
  cursor: pointer;
  user-select: none;
}

.trace-block-body {
  padding: 0 10px 10px;
}

.trace-nested {
  margin-top: 6px;
  font-size: 11px;
}

.trace-nested summary {
  cursor: pointer;
  color: rgba(145, 190, 255, 0.88);
  margin-bottom: 4px;
}

.trace-meta {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
  margin-bottom: 6px;
}

.trace-pre {
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  max-width: 100%;
  max-height: 280px;
  overflow-x: hidden;
  overflow-y: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: rgba(255, 255, 255, 0.86);
}

.trace-pre.compact {
  max-height: 200px;
}

.trace-history-item {
  margin-top: 6px;
}

.trace-history-role {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  color: #91beff;
  margin-bottom: 4px;
}

.status-log-scroll-wrap {
  position: relative;
  margin: 0 8px 8px;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.status-log-scroll-wrap::before,
.status-log-scroll-wrap::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  height: 22px;
  pointer-events: none;
  z-index: 1;
}

.status-log-scroll-wrap::before {
  top: 0;
  background: linear-gradient(
    to bottom,
    rgba(10, 14, 22, 0.96) 0%,
    rgba(10, 14, 22, 0.55) 45%,
    transparent 100%
  );
}

.status-log-scroll-wrap::after {
  bottom: 0;
  background: linear-gradient(
    to top,
    rgba(10, 14, 22, 0.88) 0%,
    rgba(10, 14, 22, 0.35) 50%,
    transparent 100%
  );
}

.status-log-scroll {
  max-height: 132px;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
}

.status-log-scroll::-webkit-scrollbar {
  width: 5px;
}

.status-log-scroll::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
}

.status-log-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.28);
}

.status-log {
  margin: 0;
  padding: 10px 12px 10px 26px;
  font-size: 11px;
  line-height: 1.55;
  color: rgba(255, 255, 255, 0.72);
  list-style: decimal;
}

.status-log li {
  padding: 2px 0;
  word-break: break-word;
}

.status-log li:last-child {
  color: rgba(255, 255, 255, 0.92);
}

.status-log-timeline {
  list-style: none;
  margin: 0;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.status-log-entry {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 3px 0;
  font-size: 11px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.58);
  position: relative;
}

.status-log-entry:last-child {
  color: rgba(255, 255, 255, 0.82);
}

.status-log-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 5px;
  background: rgba(255, 255, 255, 0.25);
  position: relative;
  z-index: 1;
}

.status-log-entry:not(:last-child) .status-log-dot::after {
  content: "";
  position: absolute;
  left: 2px;
  top: 8px;
  width: 2px;
  height: calc(100% + 2px);
  background: rgba(255, 255, 255, 0.08);
}

.status-log-entry:last-child .status-log-dot::after {
  display: none;
}

.status-log-entry.phase-connecting .status-log-dot { background: #56d4dd; }
.status-log-entry.phase-context .status-log-dot { background: #57ab5a; }
.status-log-entry.phase-compacting .status-log-dot { background: #d29922; }
.status-log-entry.phase-model .status-log-dot { background: #b390f0; }
.status-log-entry.phase-streaming .status-log-dot { background: #58a6ff; }
.status-log-entry.phase-tool .status-log-dot { background: #f78166; }
.status-log-entry.phase-summarize .status-log-dot { background: #8b949e; }
.status-log-entry.phase-aborted .status-log-dot { background: #f85149; }
.status-log-entry.phase-default .status-log-dot { background: rgba(255, 255, 255, 0.3); }

.status-log-text {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.turn-trace-item {
  padding: 0 10px 8px;
}

.turn-trace-head {
  font-size: 11px;
  font-weight: 600;
  color: rgba(179, 146, 240, 0.95);
  margin-bottom: 4px;
}

.inline-diff-list {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}

.inline-diff-card {
  border: 1px solid rgba(31, 111, 235, 0.28);
  border-radius: 10px;
  background: rgba(31, 111, 235, 0.06);
  overflow: hidden;
}

.inline-diff-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.inline-diff-path {
  font-size: 12px;
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: #91beff;
}

.inline-diff-tag {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
}

.inline-diff-tag.delete {
  background: rgba(248, 81, 73, 0.15);
  color: #ff9a9a;
}

.inline-diff-tag.modify {
  background: rgba(240, 198, 116, 0.15);
  color: #f0c674;
}

.inline-diff-details {
  padding: 8px 10px 10px;
}

.inline-diff-details summary {
  font-size: 11px;
  color: rgba(145, 190, 255, 0.9);
  cursor: pointer;
  margin-bottom: 6px;
}

.inline-diff-wrap {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.28s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease;
  opacity: 0;
}
.inline-diff-wrap.open {
  max-height: 3000px;
  opacity: 1;
  margin-top: 8px;
}

.inline-diff-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

@media (max-width: 720px) {
  .inline-diff-cols {
    grid-template-columns: 1fr;
  }
}

.inline-diff-label {
  font-size: 10px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.55);
  margin-bottom: 4px;
}

.pending-queue {
  margin-bottom: 10px;
  border: 1px solid rgba(240, 198, 116, 0.35);
  border-radius: 10px;
  background: rgba(240, 198, 116, 0.08);
  overflow: hidden;
}

.pending-queue-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  color: #f0c674;
  border-bottom: 1px solid rgba(240, 198, 116, 0.2);
}

.pending-queue-list {
  margin: 0;
  padding: 8px 10px 8px 24px;
  font-size: 11px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.75);
  max-height: 100px;
  overflow: auto;
}

.chat-hint,
.chat-running {
  font-size: 11px;
  color: var(--muted);
}

.chat-running {
  color: #91beff;
}

.chat-error {
  font-size: 11px;
  color: var(--danger);
}

.chat-recovery-hint {
  font-size: 11px;
  color: rgba(121, 192, 255, 0.88);
}

.chat-actions .resume-bottom-btn {
  border: 1px solid rgba(88, 166, 255, 0.45);
  background: rgba(88, 166, 255, 0.12);
  color: rgba(180, 215, 255, 0.95);
}

.chat-actions .resume-bottom-btn:hover:not(:disabled) {
  background: rgba(88, 166, 255, 0.2);
}

button {
  border: none;
  background: var(--primary);
  color: #fff;
  border-radius: 8px;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 180ms ease;
}

button:hover:not(:disabled) {
  opacity: 0.9;
}

button.primary {
  background: var(--primary);
  font-weight: 600;
}

button.secondary {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.85);
  border: 1px solid var(--border);
}

button.secondary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
}

button.ghost {
  background: transparent;
  border: 1px solid var(--border);
  padding: 5px 12px;
  font-size: 11px;
  color: var(--muted);
}

button.ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
}

button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.link-btn {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  white-space: nowrap;
}

.link-btn.ghost {
  color: var(--muted);
}

.link-btn.ghost:hover {
  color: var(--text);
}

@media (max-width: 900px) {
  .app-toolbar {
    flex-wrap: wrap;
    padding: 8px 12px;
    gap: 8px;
  }

  .toolbar-project {
    order: 3;
    width: 100%;
  }
}
</style>
