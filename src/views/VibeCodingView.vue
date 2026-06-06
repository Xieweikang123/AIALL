<template>
  <div class="vibe-page">
    <header class="app-toolbar">
      <div class="toolbar-brand">
        <span class="brand-icon" aria-hidden="true">⚡</span>
        <h1 class="title">Vibe Coding</h1>
      </div>
      <div class="toolbar-project">
        <input
          v-model="projectPath"
          class="path-input"
          type="text"
          placeholder="输入项目路径，或点击「打开项目」"
          @keydown.enter="openProjectByInput"
        />
        <button type="button" class="primary compact" :disabled="pickingFolder || loadingTree" @click="handleOpenProject">
          {{ pickingFolder ? "选择…" : loadingTree ? "加载中" : "打开项目" }}
        </button>
        <button type="button" class="secondary compact" :disabled="!projectPath.trim()" @click="refreshTree" title="刷新文件树">↻</button>
      </div>
      <div class="toolbar-actions">
        <div ref="projectHistoryRef" class="project-history-wrap">
          <button
            type="button"
            class="ghost small"
            :disabled="loadingTree || pickingFolder"
            @click="toggleProjectHistory"
          >
            最近
          </button>
        <div v-if="projectHistoryOpen" class="project-history-dropdown">
          <div class="project-history-head">
            <div>
              <h3 class="project-history-title">最近打开的项目</h3>
              <p class="project-history-desc">点击可快速重新打开</p>
            </div>
            <button
              v-if="projectHistoryList.length"
              type="button"
              class="ghost small"
              @click="clearRecentProjects"
            >
              清空
            </button>
          </div>
          <div v-if="!projectHistoryList.length" class="project-history-empty">还没有打开过项目</div>
          <ul v-else class="project-history-list">
            <li
              v-for="item in projectHistoryList"
              :key="item.path"
              class="project-history-item"
              :class="{ active: isCurrentProject(item.path) }"
            >
              <button
                type="button"
                class="project-history-item-main"
                :disabled="loadingTree || pickingFolder"
                @click="openRecentProject(item.path)"
              >
                <span class="project-history-item-title">{{ item.displayName }}</span>
                <span class="project-history-item-path" :title="item.path">{{ item.path }}</span>
                <span class="project-history-item-meta">{{ formatSessionTime(item.lastOpenedAt) }}</span>
              </button>
              <button
                type="button"
                class="ghost small project-history-delete"
                title="从历史中移除"
                @click="removeRecentProject(item.path, $event)"
              >
                移除
              </button>
            </li>
          </ul>
        </div>
        </div>
        <span v-if="treeError" class="bar-error" :title="treeError">!</span>
        <router-link class="ghost small link-btn" to="/chat">AI 对话</router-link>
        <router-link class="ghost small link-btn" to="/ai-config">配置</router-link>
      </div>
    </header>

    <main ref="workspaceRef" class="workspace" :class="{ 'no-project': !projectOpened, 'editor-collapsed': editorCollapsed }">
      <aside class="file-panel" :style="{ width: filePanelWidth + 'px' }">
        <div class="file-panel-head">
          <div class="file-panel-row file-panel-top-row">
            <div class="file-panel-tabs" role="group">
              <button
                type="button"
                class="file-panel-tab"
                :class="{ active: gitPanelMode === 'files' }"
                @click="gitPanelMode = 'files'"
              >
                文件
              </button>
              <button
                type="button"
                class="file-panel-tab"
                :class="{ active: gitPanelMode === 'git' }"
                :disabled="!projectOpened"
                @click="gitPanelMode = 'git'; refreshGitStatus()"
              >
                Git
                <span v-if="gitStagedFiles.length" class="git-badge git-badge-staged">{{ gitStagedFiles.length }}</span>
                <span v-if="gitUnstagedFiles.length" class="git-badge">{{ gitUnstagedFiles.length }}</span>
              </button>
            </div>
            <div v-if="projectOpened && gitPanelMode === 'files'" class="file-toolbar">
              <button type="button" class="icon-btn" title="新建文件" @click="createNewFile">+</button>
              <button type="button" class="icon-btn" title="新建文件夹" @click="createNewFolder">📁</button>
              <span v-if="editorCollapsed" class="toolbar-sep" />
              <button
                v-if="editorCollapsed"
                type="button"
                class="icon-btn"
                title="展开编辑器"
                @click="expandEditor"
              >
                ◧
              </button>
            </div>
          </div>
          <div v-if="gitPanelMode === 'files'" class="file-panel-row file-panel-search-row">
            <div class="search-mode-switch" role="group" aria-label="搜索模式">
              <button
                type="button"
                class="search-mode-btn"
                :class="{ active: searchMode === 'file' }"
                :disabled="!projectOpened"
                @click="searchMode = 'file'"
              >
                文件
              </button>
              <button
                type="button"
                class="search-mode-btn"
                :class="{ active: searchMode === 'content' }"
                :disabled="!projectOpened"
                @click="searchMode = 'content'"
              >
                内容
              </button>
            </div>
            <input
              ref="searchInputRef"
              v-model="searchQuery"
              class="search-input"
              type="text"
              :placeholder="searchMode === 'file' ? '搜索文件名…' : '搜索代码内容…'"
              :disabled="!projectOpened"
              @keydown.enter="handleSearch"
            />
          </div>
        </div>

        <div v-if="gitPanelMode === 'git'">
          <div v-if="!projectOpened" class="panel-empty">请先打开项目文件夹</div>
          <div v-else-if="gitLoading" class="panel-empty">加载中…</div>
          <div v-else-if="!gitIsRepo" class="panel-empty">当前目录不是 Git 仓库</div>
          <div v-else class="git-panel-content">
            <div class="git-branch-bar">
              <span class="git-branch-icon">⎇</span>
              <span class="git-branch-name">{{ gitBranch }}</span>
              <button type="button" class="ghost tiny" :disabled="gitLoading" @click="refreshGitStatus">刷新</button>
            </div>
            <div v-if="gitRemotes.length" class="git-remote-bar">
              <div class="git-remote-info">
                <span class="git-remote-label">↑{{ gitAhead }} ↓{{ gitBehind }}</span>
                <span v-if="gitTrackingBranch" class="git-remote-tracking">{{ gitTrackingBranch }}</span>
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
            <div v-if="gitError" class="git-error">{{ gitError }}</div>
            <div class="git-commit-box">
              <input
                v-model="gitCommitMessage"
                class="git-commit-input"
                type="text"
                placeholder="提交信息…"
                :disabled="gitCommitting || !!gitGenStep"
                @keydown.enter="commitGit"
              />
              <div class="git-commit-actions">
                <button
                  type="button"
                  class="ghost small"
                  :disabled="gitCommitting || !!gitGenStep || !gitStagedFiles.length"
                  @click="generateCommitMessage"
                >
                  {{ gitGenStep || "AI 生成" }}
                </button>
                <button
                  type="button"
                  class="primary small"
                  :disabled="gitCommitting || !gitCommitMessage.trim() || !gitStagedFiles.length"
                  @click="commitGit"
                >
                  {{ gitCommitting ? "提交中…" : `提交 (${gitStagedFiles.length})` }}
                </button>
              </div>
            </div>
            <div v-if="!gitStatus.length" class="panel-empty">无本地改动</div>
            <template v-else>
              <div v-if="gitStagedFiles.length" class="git-section">
                <div class="git-section-head">
                  <span class="git-section-title">已暂存 ({{ gitStagedFiles.length }})</span>
                  <button type="button" class="ghost tiny" @click="unstageAll">取消全部</button>
                </div>
                <div class="git-file-list">
                  <div
                    v-for="file in gitStagedFiles"
                    :key="file.path"
                    class="git-file-item"
                    :class="{ active: selectedGitFile === file.path }"
                    @click="showGitFileDiff(file.path)"
                  >
                    <span class="git-file-check" @click.stop="unstageFile(file.path)">✓</span>
                    <span
                      class="git-file-status"
                      :style="{ color: gitStatusColor(file.status) }"
                    >
                      {{ gitStatusIcon(file.status) }}
                    </span>
                    <span class="git-file-path" :title="file.path">{{ file.path }}</span>
                    <button type="button" class="ghost tiny git-file-btn" title="取消暂存" @click.stop="unstageFile(file.path)">−</button>
                  </div>
                </div>
              </div>
              <div v-if="gitUnstagedFiles.length" class="git-section">
                <div class="git-section-head">
                  <span class="git-section-title">未暂存 ({{ gitUnstagedFiles.length }})</span>
                  <div class="git-section-actions">
                    <button type="button" class="ghost tiny" @click="stageAll">全部暂存</button>
                    <button type="button" class="ghost tiny danger" @click="discardAll">丢弃全部</button>
                  </div>
                </div>
                <div class="git-file-list">
                  <div
                    v-for="file in gitUnstagedFiles"
                    :key="file.path"
                    class="git-file-item"
                    :class="{ active: selectedGitFile === file.path }"
                    @click="showGitFileDiff(file.path)"
                  >
                    <span class="git-file-check" @click.stop="stageFile(file.path)">+</span>
                    <span
                      class="git-file-status"
                      :style="{ color: gitStatusColor(file.status) }"
                    >
                      {{ gitStatusIcon(file.status) }}
                    </span>
                    <span class="git-file-path" :title="file.path">{{ file.path }}</span>
                    <button type="button" class="ghost tiny git-file-btn" title="暂存" @click.stop="stageFile(file.path)">+</button>
                    <button type="button" class="ghost tiny danger git-file-btn" title="丢弃更改" @click.stop="discardFile(file.path)">✕</button>
                  </div>
                </div>
              </div>
            </template>
            <div class="git-log-section">
              <button type="button" class="ghost tiny" style="width:100%;text-align:left" @click="gitLogOpen = !gitLogOpen">
                {{ gitLogOpen ? "▾" : "▸" }} 提交历史
              </button>
              <div v-if="gitLogOpen" class="git-log-list">
                <div v-if="!gitLogEntries.length" class="panel-empty">无历史</div>
                <div v-for="entry in gitLogEntries" :key="entry.hash" class="git-log-item">
                  <span class="git-log-hash">{{ entry.shortHash }}</span>
                  <span class="git-log-msg">{{ entry.message }}</span>
                </div>
              </div>
            </div>
          </div>
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
      </aside>

      <div class="resize-handle" @mousedown="startResize('file', $event)"></div>

      <section v-show="!editorCollapsed" class="editor-panel">
        <div class="editor-header">
          <div v-if="openTabs.length" class="editor-tabs">
            <button
              v-for="tab in openTabs"
              :key="tab.path"
              type="button"
              class="editor-tab"
              :class="{ active: tab.path === activeFilePath, dirty: tab.dirty }"
              :title="tab.path"
              @click="switchTab(tab.path)"
            >
              <span class="editor-tab-name">{{ fileName(tab.path) }}</span>
              <span v-if="tab.dirty" class="editor-tab-dot" aria-hidden="true">•</span>
              <span
                class="editor-tab-close"
                role="button"
                tabindex="0"
                title="关闭"
                @click.stop="closeTab(tab.path)"
                @keydown.enter.stop.prevent="closeTab(tab.path)"
              >
                ×
              </span>
            </button>
          </div>
          <div v-else class="editor-header-title">未打开文件</div>
          <div class="editor-header-actions">
            <button
              v-if="activeFileDiff"
              type="button"
              class="ghost tiny"
              @click="toggleDiffMode"
            >
              {{ showDiffMode ? "编辑" : "对比" }}
            </button>
            <span v-if="fileDirty && !showDiffMode" class="dirty-badge">未保存</span>
            <button
              type="button"
              class="ghost tiny"
              :disabled="!activeFilePath || !fileDirty || showDiffMode"
              @click="saveFile"
            >
              保存
            </button>
            <button type="button" class="ghost tiny" :disabled="!activeFilePath || showDiffMode" @click="reloadFile">
              重载
            </button>
            <button type="button" class="ghost tiny" title="收起编辑器" @click="collapseEditor">收起</button>
          </div>
        </div>

        <div v-if="!activeFilePath" class="editor-empty">
          <div class="editor-empty-icon" aria-hidden="true">📂</div>
          <p class="editor-empty-title">从左侧选择文件开始编辑</p>
          <p class="editor-empty-hint">支持多标签、Diff 对比、Ctrl+S 保存</p>
          <button type="button" class="secondary compact" @click="collapseEditor">收起编辑器</button>
        </div>

        <div v-else-if="fileLoadError" class="editor-empty error">{{ fileLoadError }}</div>

        <CodeMonacoDiffEditor
          v-else-if="showDiffMode && activeFileDiff"
          class="code-editor"
          :original="activeFileDiff.before"
          :modified="activeFileDiff.after"
          :file-path="activeFilePath"
        />

        <CodeMonacoEditor
          ref="editorRef"
          v-else
          v-model="fileContent"
          class="code-editor"
          :file-path="activeFilePath"
          @change="onEditorChange"
          @save="saveFile"
          @select="onEditorSelect"
        />
        <div v-if="selectedCode" class="ask-ai-floating" @click="askAiWithCode">
          💬 问 AI
        </div>
      </section>

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
          <span class="panel-title">AI 助手</span>
          <div class="panel-head-right">
            <button
              type="button"
              class="ghost small"
              :disabled="!projectOpened || chatSending"
              @click="openHistory"
            >
              历史
            </button>
            <button
              type="button"
              class="ghost small"
              :disabled="!projectOpened || chatSending"
              @click="startNewSession"
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

        <div v-if="historyOpen" class="history-overlay" @click.self="historyOpen = false">
          <div class="history-panel">
            <div class="history-head">
              <div>
                <h3 class="history-title">会话记录</h3>
                <p class="history-desc">按项目保存，可切换或新建会话。</p>
              </div>
              <button type="button" class="ghost small" @click="historyOpen = false">关闭</button>
            </div>
            <button
              type="button"
              class="secondary history-new"
              :disabled="chatSending"
              @click="startNewSession"
            >
              + 新会话
            </button>
            <div v-if="!sessionList.length" class="history-empty">当前项目还没有会话记录</div>
            <ul v-else class="history-list">
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
                  class="ghost small history-delete"
                  :disabled="chatSending"
                  title="删除此会话"
                  @click="removeSession(s.id)"
                >
                  删除
                </button>
              </li>
            </ul>
          </div>
        </div>

        <div ref="chatScrollRef" class="chat-scroll">
          <div v-if="!chatMessages.length" class="chat-empty">
            <div class="chat-empty-icon" aria-hidden="true">🤖</div>
            <p class="chat-empty-title">AI 编程助手</p>
            <p class="chat-empty-desc">Agent 会探索项目；Build 模式修改需你确认后才落盘。输入 <code>@</code> 可引用文件。</p>
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
                  <button type="button" class="ghost small" title="删除本条问答" @click="undoExchange(m.id)">
                    撤销
                  </button>
                  <button
                    type="button"
                    class="ghost small"
                    title="从此问题重新生成"
                    :disabled="!configReady || !projectOpened"
                    @click="resendFromMessage(m.id)"
                  >
                    重发
                  </button>
                </div>
              </div>
              <div
                v-if="m.role === 'assistant' && hasAgentActivity(m)"
                class="agent-activity"
                :class="{ collapsed: !isActivityExpanded(m) }"
              >
                <button
                  type="button"
                  class="agent-activity-toggle"
                  :disabled="isAgentRunning(m)"
                  :aria-expanded="isActivityExpanded(m)"
                  @click="toggleActivityExpanded(m)"
                >
                  <span class="agent-activity-chevron" aria-hidden="true">
                    {{ isActivityExpanded(m) ? "▼" : "▶" }}
                  </span>
                  <span class="agent-activity-title">{{ m.chatMode === "ask" ? "Ask 执行过程" : "Agent 执行过程" }}</span>
                  <span v-if="isAgentRunning(m)" class="agent-activity-hint">运行中…</span>
                  <span v-else-if="!isActivityExpanded(m)" class="agent-activity-summary">
                    {{ activitySummary(m) }}
                  </span>
                </button>
                <div v-show="isActivityExpanded(m)" class="agent-activity-body">
                  <div v-if="m.status || m.agentTurn" class="agent-status-bar">
                    <span v-if="isAgentRunning(m)" class="status-pulse" aria-hidden="true" />
                    <span v-if="m.agentPhase" class="agent-phase-badge">{{ phaseBadgeLabel(m.agentPhase) }}</span>
                    <span v-if="m.status" class="agent-status-text">{{ m.status }}</span>
                    <span v-if="m.agentTurn && m.agentMaxTurns" class="agent-turn-pill">
                      第 {{ m.agentTurn }}/{{ m.agentMaxTurns }} 轮
                    </span>
                    <span v-else-if="m.totalTurns" class="agent-turn-pill">共 {{ m.totalTurns }} 轮</span>
                  </div>
                  <details v-if="m.agentContext" class="trace-block" open>
                    <summary class="trace-block-title">上下文（系统提示 + 历史 + 项目）</summary>
                    <div class="trace-block-body">
                      <div class="trace-meta">
                        模式 {{ m.agentContext.mode === "ask" ? "Ask" : "Build" }}
                        <span v-if="m.agentContext.model"> · 模型 {{ m.agentContext.model }}</span>
                        <span v-if="m.agentContext.openFile"> · 当前文件 {{ m.agentContext.openFile }}</span>
                        <span v-if="m.agentContext.maxTurns"> · 最多 {{ m.agentContext.maxTurns }} 轮</span>
                      </div>
                      <details class="trace-nested">
                        <summary>系统提示词</summary>
                        <pre class="trace-pre">{{ m.agentContext.systemPrompt }}</pre>
                      </details>
                      <details v-if="m.agentContext.history.length" class="trace-nested">
                        <summary>对话历史（{{ m.agentContext.history.length }} 条）</summary>
                        <div
                          v-for="(h, hi) in m.agentContext.history"
                          :key="hi"
                          class="trace-history-item"
                        >
                          <span class="trace-history-role">{{ h.role === "user" ? "你" : "助手" }}</span>
                          <pre class="trace-pre compact">{{ h.content }}</pre>
                        </div>
                      </details>
                      <details v-if="m.agentContext.projectContext" class="trace-nested">
                        <summary>注入的项目上下文</summary>
                        <pre class="trace-pre">{{ m.agentContext.projectContext }}</pre>
                      </details>
                    </div>
                  </details>
                  <details v-if="m.statusLog?.length" class="trace-block" open>
                    <summary class="trace-block-title">阶段日志（{{ m.statusLog.length }}）</summary>
                    <ol class="status-log">
                      <li v-for="(line, si) in m.statusLog" :key="si">{{ line }}</li>
                    </ol>
                  </details>
                  <details v-if="m.turnTraces?.length" class="trace-block" open>
                    <summary class="trace-block-title">轮次中间输出（{{ m.turnTraces.length }}）</summary>
                    <div v-for="(trace, ti) in m.turnTraces" :key="ti" class="turn-trace-item">
                      <div class="turn-trace-head">
                        第 {{ trace.turn }} 轮
                        <span v-if="trace.maxTurns">/ {{ trace.maxTurns }}</span>
                        <span v-if="trace.hasToolCalls"> · 随后调用工具</span>
                      </div>
                      <pre class="trace-pre compact">{{ trace.assistantText }}</pre>
                    </div>
                  </details>
                  <ol v-if="m.tools?.length" class="tool-timeline">
                    <li
                      v-for="step in m.tools"
                      :key="step.id"
                      class="tool-item"
                      :class="{
                        running: step.running,
                        fail: !step.ok && !step.running,
                        done: !step.running && step.ok,
                      }"
                    >
                      <div class="tool-item-icon" aria-hidden="true">{{ step.icon || "⚙️" }}</div>
                      <div class="tool-item-body">
                        <div class="tool-item-head">
                          <span class="tool-item-title">{{ step.title || step.label }}</span>
                          <span class="tool-item-state">
                            {{ step.running ? "执行中" : step.ok ? "完成" : "失败" }}
                          </span>
                        </div>
                        <div v-if="step.detail" class="tool-item-detail">{{ step.detail }}</div>
                        <div v-if="step.summary && !step.running" class="tool-item-summary">{{ step.summary }}</div>
                        <details
                          v-if="formatToolArgsPreview(step.name, step.args || {})"
                          class="tool-item-expand"
                        >
                          <summary>暂存参数</summary>
                          <pre class="trace-pre compact">{{ formatToolArgsPreview(step.name, step.args || {}) }}</pre>
                        </details>
                        <details v-if="step.fullResult && !step.running" class="tool-item-expand" open>
                          <summary>完整返回</summary>
                          <pre class="trace-pre compact">{{ step.fullResult }}</pre>
                        </details>
                      </div>
                    </li>
                  </ol>
                </div>
              </div>
              <div
                v-if="m.role === 'assistant' && !m.content && (m.status || isAgentRunning(m))"
                class="msg-status"
              >
                <span v-if="isAgentRunning(m)" class="status-pulse" aria-hidden="true" />
                <span class="msg-status-text">
                  {{ m.status || (m.chatMode === 'ask' ? '思考中…' : 'Agent 运行中…') }}
                </span>
              </div>
              <pre v-if="m.content && m.streaming" class="msg-streaming">{{ m.content }}<span v-if="isAgentRunning(m)" class="stream-cursor" aria-hidden="true">▍</span></pre>
              <ChatMarkdown v-else-if="m.content" :content="m.content" @apply-block="(idx: number) => applyCodeBlock(extractCodeBlocks(m.content)[idx])" />
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
                  </div>
                  <details class="inline-diff-details" open>
                    <summary>变更内容</summary>
                    <div class="inline-diff-cols">
                      <div class="inline-diff-col">
                        <div class="inline-diff-label">修改前</div>
                        <pre class="trace-pre compact">{{ truncateDiffPreview(m.turnFileDiffs[relPath].before || "（空 / 新文件）") }}</pre>
                      </div>
                      <div class="inline-diff-col">
                        <div class="inline-diff-label">{{ m.turnFileDiffs[relPath].deleted ? "删除后" : "修改后" }}</div>
                        <pre class="trace-pre compact">{{ truncateDiffPreview(m.turnFileDiffs[relPath].deleted ? "（文件将删除）" : m.turnFileDiffs[relPath].after) }}</pre>
                      </div>
                    </div>
                  </details>
                </div>
              </div>
              <div
                v-if="
                  m.role === 'assistant' &&
                  !m.streaming &&
                  (m.pendingApproval || m.writtenFiles?.length || extractCodeBlocks(m.content).length)
                "
                class="msg-actions"
              >
                <template v-if="m.pendingApproval && m.turnFileDiffs">
                  <span class="pending-badge">{{ formatPendingApprovalLabel(m.turnFileDiffs) }}</span>
                  <button
                    type="button"
                    class="primary small-action"
                    :disabled="!projectOpened || chatSending || m.reverting"
                    @click="acceptAgentTurn(m.id)"
                  >
                    {{ m.reverting ? "应用中…" : "接受全部" }}
                  </button>
                  <button
                    type="button"
                    class="ghost"
                    :disabled="chatSending || m.reverting"
                    @click="rejectAgentTurn(m.id)"
                  >
                    拒绝
                  </button>
                  <button
                    v-for="relPath in Object.keys(m.turnFileDiffs)"
                    :key="relPath"
                    type="button"
                    class="ghost"
                    :disabled="!projectOpened"
                    @click="previewAgentFile(m.id, relPath)"
                  >
                    预览 {{ relPath }}
                  </button>
                </template>
                <button
                  v-else-if="m.writtenFiles?.length && m.turnFileDiffs && !m.reverted && !m.rejected"
                  type="button"
                  class="ghost danger"
                  :disabled="!projectOpened || chatSending || m.reverting"
                  @click="revertAgentTurn(m.id)"
                >
                  {{ m.reverting ? "回滚中…" : `回滚本轮修改（${m.writtenFiles.length} 个文件）` }}
                </button>
                <span v-else-if="m.reverted" class="reverted-badge">已回滚</span>
                <span v-else-if="m.rejected" class="rejected-badge">已拒绝</span>
              </div>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="showQuoteButton"
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
              <button type="button" class="ghost small" @click="pendingPromptQueue = []">清空队列</button>
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
            <div class="chat-input-box" :class="{ focused: chatInputFocused }">
              <ChatComposerEditor
                ref="composerRef"
                class="chat-composer-editor"
                :placeholder="chatPlaceholder"
                :disabled="chatSending"
                @mention-change="onComposerMentionChange"
                @enter-send="sendChat"
                @update:empty="composerEmpty = $event"
                @focus="chatInputFocused = true"
                @blur="chatInputFocused = false"
              />
            </div>
          </div>
          <div class="chat-bottom">
            <span v-if="chatError" class="chat-error">{{ chatError }}</span>
            <span v-else-if="chatSending" class="chat-running">{{ chatRunningText }}</span>
            <span v-else class="chat-hint">{{ chatHintText }}</span>
            <div class="chat-actions">
              <button v-if="chatSending" type="button" class="secondary" @click="stopAgent">停止</button>
              <button type="button" class="primary" :disabled="chatSending || !canSendChat" @click="sendChat">
                {{ chatSending ? "运行中…" : "发送" }}
              </button>
            </div>
          </div>
        </footer>
      </aside>
    </main>

    <Teleport to="body">
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import ChatComposerEditor from "../components/ChatComposerEditor.vue";
import ChatMarkdown from "../components/ChatMarkdown.vue";
import CodeMonacoDiffEditor from "../components/CodeMonacoDiffEditor.vue";
import CodeMonacoEditor from "../components/CodeMonacoEditor.vue";
import FileTreeNode, { type TreeNode } from "../components/FileTreeNode.vue";
import { loadAiChatBaseFromStorage } from "../services/aiLocalConfig";
import {
  clearVibeChatHistory,
  createVibeChatSession,
  deleteVibeChatSession,
  getActiveVibeChatSessionId,
  listVibeChatSessions,
  loadVibeChatHistory,
  onStorageError,
  saveVibeChatHistory,
  switchVibeChatSession,
  type PersistedChatMessage,
  type VibeChatSessionMeta,
} from "../services/vibeChatStorage";
import {
  runVibeAgentSse,
  type VibeAgentSseEvent,
  type VibeChatHistoryMessage,
  type VibeChatMode,
} from "../services/vibeAgentClient";
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
  writeFile,
  type FileEntry,
  type GrepMatch,
} from "../services/vibeCodingClient";
import {
  fetchGitStatus,
  fetchGitDiff,
  fetchGitDiffContent,
  commitGitChanges,
  fetchGitLog,
  stageGitFiles,
  unstageGitFiles,
  discardGitFiles,
  generateCommitMessage as generateCommitMessageApi,
  fetchGitRemotes,
  gitFetchRemote,
  gitPullRemote,
  gitPushRemote,
  type GitStatusFile,
  type GitLogEntry,
  type GitRemoteInfo,
} from "../services/vibeGitClient";

const STORAGE_KEY = "vibe-coding-project";
const PANEL_WIDTH_KEY = "vibe-coding-panel-widths";
const EDITOR_COLLAPSED_KEY = "vibe-coding-editor-collapsed";
const CHAT_MODE_KEY = "vibe-coding-chat-mode";
const PENDING_QUEUE_KEY = "vibe-coding-pending-queue";
const FILE_MIN_WIDTH = 180;
const FILE_MAX_WIDTH = 500;
const CHAT_MIN_WIDTH = 260;
const CHAT_MAX_WIDTH = 1200;
const EDITOR_MIN_WIDTH = 280;
const RESIZE_HANDLES_WIDTH = 8;
type ChatRole = "user" | "assistant";
type AgentToolStep = {
  id: string;
  name: string;
  icon: string;
  title: string;
  detail: string;
  label: string;
  summary: string;
  ok: boolean;
  running?: boolean;
  fullResult?: string;
  args?: Record<string, unknown>;
};
type ChatMessage = Omit<PersistedChatMessage, "tools"> & {
  tools?: AgentToolStep[];
  status?: string;
  agentPhase?: string;
  agentTurn?: number;
  agentMaxTurns?: number;
  streaming?: boolean;
  reverting?: boolean;
};

type FileDiff = {
  before: string;
  after: string;
  deleted?: boolean;
};

type AgentStatusData = Extract<VibeAgentSseEvent, { type: "status" }>["data"] & {
  toolTitle?: string;
  toolDetail?: string;
};

function normalizeChatMessages(messages: PersistedChatMessage[]): ChatMessage[] {
  return messages.map((m) => ({
    ...m,
    activityExpanded: m.activityExpanded ?? (m.role === "assistant" && Boolean(m.tools?.length || m.agentContext)),
    tools: m.tools?.map((t) => ({
      id: t.id,
      name: t.name || "",
      icon: t.icon || "⚙️",
      title: t.title || t.label,
      detail: t.detail || "",
      label: t.label,
      summary: t.summary,
      ok: t.ok,
      fullResult: t.fullResult,
      args: t.args,
    })),
  }));
}

let agentAbortHandle: { abort: () => void } | null = null;
let saveChatTimer: ReturnType<typeof setTimeout> | null = null;

const projectPath = ref("");
const projectOpened = ref(false);
const loadingTree = ref(false);
const pickingFolder = ref(false);
const treeError = ref("");
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
const historyOpen = ref(false);
const activeSessionId = ref("");
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

interface ReferencedFile {
  name: string;
  path: string;
  relative: string;
}

interface ProjectFileItem {
  name: string;
  path: string;
  relative: string;
}

const composerRef = ref<InstanceType<typeof ChatComposerEditor> | null>(null);
const composerEmpty = ref(true);
const chatDropZoneRef = ref<HTMLElement | null>(null);
const chatInputFocused = ref(false);
const mentionOpen = ref(false);
const mentionQuery = ref("");
const mentionActiveIndex = ref(0);
const mentionRemoteResults = ref<ProjectFileItem[]>([]);
let mentionSearchTimer: ReturnType<typeof setTimeout> | null = null;
const isDragging = ref(false);
const fileDragGhost = ref<{ relative: string; x: number; y: number } | null>(null);
let dragCounter = 0;
const sessionList = ref<VibeChatSessionMeta[]>([]);
const projectHistoryOpen = ref(false);
const projectHistoryList = ref<ProjectHistoryEntry[]>([]);
const projectHistoryRef = ref<HTMLElement | null>(null);

const gitPanelMode = ref<"files" | "git">("files");
const gitStatus = ref<GitStatusFile[]>([]);
const gitBranch = ref("");
const gitIsRepo = ref(false);
const gitLoading = ref(false);
const gitError = ref("");
const gitCommitMessage = ref("");
const gitCommitting = ref(false);
const gitGenStep = ref("");
const gitLogEntries = ref<GitLogEntry[]>([]);
const gitLogOpen = ref(false);
const selectedGitFile = ref("");
const gitRemotes = ref<GitRemoteInfo[]>([]);
const gitTrackingBranch = ref("");
const gitAhead = ref(0);
const gitBehind = ref(0);
const gitRemoteLoading = ref(false);
const gitRemoteAction = ref("");

const gitStagedFiles = computed(() => gitStatus.value.filter((f) => f.staged));
const gitUnstagedFiles = computed(() => gitStatus.value.filter((f) => !f.staged));

const contextMenu = ref({ show: false, x: 0, y: 0, path: "" });

const contextMenuTargetIsFile = computed(() => {
  const node = findNode(fileTree.value, contextMenu.value.path);
  return Boolean(node && !node.isDirectory);
});
const renamingPath = ref("");

const aiConfig = ref({ endpoint: "", apiKey: "", model: "" });

const configReady = computed(() => Boolean(aiConfig.value.endpoint.trim()) && Boolean(aiConfig.value.model.trim()));
const apiKeyReady = computed(() => Boolean(aiConfig.value.apiKey.trim()));
const modelNameForDisplay = computed(() => aiConfig.value.model.trim() || "（未设置）");
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
  chatMode.value === "ask" ? "思考中…" : "Agent 运行中…",
);

const activeFileDiff = computed(() => getFileDiff(activeFilePath.value));

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
    aiConfig.value = cfg;
    return;
  }
  aiConfig.value = { endpoint: "", apiKey: "", model: "" };
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

async function scrollChatToBottom(force = false) {
  if (!force && !chatSending.value) return;
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
    case "preparing":
    case "starting":
      return "准备";
    case "waiting_model":
    case "thinking":
      return "模型";
    case "executing_tool":
    case "executing_tools":
      return "工具";
    case "summarizing_tools":
      return "整理";
    case "aborted":
      return "停止";
    default:
      return "";
  }
}

function formatAgentStatus(data: AgentStatusData): string {
  const { phase, turn, maxTurns, openFile, model, toolTitle, toolDetail } = data;

  if (phase === "connecting_local") return "正在连接本地服务（127.0.0.1:37891）…";
  if (phase === "stream_connected") return "本地服务已连接，等待 Agent 启动…";
  if (phase === "connected") return "本地 Agent 服务已就绪，正在启动任务…";
  if (phase === "preparing" || phase === "starting") {
    if (chatMode.value === "ask") {
      return openFile ? `正在准备问答上下文（当前文件：${openFile}）…` : "正在准备问答上下文…";
    }
    return openFile
      ? `正在组装 Agent 上下文与工具定义（当前文件：${openFile}）…`
      : "正在组装 Agent 上下文与工具定义…";
  }
  if (phase === "waiting_model" || phase === "thinking") {
    const modelHint = model ? ` · ${model}` : "";
    const turnHint = turn && maxTurns ? `（第 ${turn}/${maxTurns} 轮${modelHint}）` : modelHint;
    return `正在等待模型响应${turnHint}…`;
  }
  if (phase === "executing_tool") {
    return toolDetail ? `正在执行：${toolTitle}（${toolDetail}）` : `正在执行：${toolTitle}…`;
  }
  if (phase === "executing_tools") return "正在执行工具调用…";
  if (phase === "summarizing_tools") return "正在整理工具结果，准备下一轮推理…";
  if (phase === "finished") return "";
  if (phase === "aborted") return "已停止运行";
  return "";
}

function setAgentStatus(msg: ChatMessage, phase: string, extra?: Partial<AgentStatusData>) {
  msg.agentPhase = phase;
  const statusText = formatAgentStatus({ phase, ...extra });
  msg.status = statusText;
  appendStatusLog(msg, statusText);
  if (extra?.turn) msg.agentTurn = extra.turn;
  if (extra?.maxTurns) msg.agentMaxTurns = extra.maxTurns;
}

function isAgentRunning(msg: ChatMessage): boolean {
  return chatSending.value && msg.id === activeAssistantMsgId.value;
}

function hasAgentActivity(msg: ChatMessage): boolean {
  return Boolean(
    msg.agentContext ||
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

function formatToolArgsPreview(name: string, args: Record<string, unknown>): string {
  if (name === "write_file") {
    const path = String(args.path ?? "").trim();
    const content = typeof args.content === "string" ? args.content : "";
    const preview = content.length > 600 ? `${content.slice(0, 600)}\n…（共 ${content.length} 字符）` : content;
    return path ? `路径：${path}\n\n${preview}` : preview;
  }
  if (name === "delete_file") {
    const path = String(args.path ?? "").trim();
    return path ? `将删除：${path}` : "";
  }
  return "";
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
}

function toggleActivityExpanded(msg: ChatMessage) {
  if (isAgentRunning(msg)) return;
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

function refreshSessionList(path = projectPath.value.trim()) {
  if (!path) {
    sessionList.value = [];
    activeSessionId.value = "";
    return;
  }
  sessionList.value = listVibeChatSessions(path);
  activeSessionId.value = getActiveVibeChatSessionId(path);
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
  if (!projectHistoryOpen.value) return;
  const el = projectHistoryRef.value;
  if (el && !el.contains(event.target as Node)) {
    closeProjectHistory();
  }
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

function openHistory() {
  refreshSessionList();
  historyOpen.value = true;
}

function startNewSession() {
  if (chatSending.value || !projectPath.value.trim()) return;
  persistChatNow();
  const { id, messages } = createVibeChatSession(projectPath.value.trim());
  activeSessionId.value = id;
  chatMessages.value = normalizeChatMessages(messages);
  chatError.value = "";
  refreshSessionList();
  historyOpen.value = false;
  void scrollChatToBottom(true);
}

function switchSession(sessionId: string) {
  if (chatSending.value || !projectPath.value.trim()) return;
  persistChatNow();
  chatMessages.value = normalizeChatMessages(switchVibeChatSession(projectPath.value.trim(), sessionId));
  activeSessionId.value = sessionId;
  chatError.value = "";
  refreshSessionList();
  historyOpen.value = false;
  void scrollChatToBottom(true);
}

function removeSession(sessionId: string) {
  if (chatSending.value || !projectPath.value.trim()) return;
  chatMessages.value = normalizeChatMessages(deleteVibeChatSession(projectPath.value.trim(), sessionId));
  refreshSessionList();
  void scrollChatToBottom(true);
}

function persistChatNow(path = projectPath.value.trim()) {
  if (!path) return;
  saveVibeChatHistory(path, chatMessages.value);
  refreshSessionList(path);
}

function schedulePersistChat() {
  if (!projectPath.value.trim()) return;
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

  const previousPath = projectPath.value.trim();
  if (projectOpened.value && previousPath && previousPath !== normalized) {
    persistChatNow(previousPath);
    pendingPromptQueue.value = [];
    persistPendingQueue();
  }

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

  try {
    const items = await loadDirChildren(normalized);
    fileTree.value = items;
    expandedDirs.value = new Set([normalized]);
    projectOpened.value = true;
    projectPath.value = normalized;
    selectedTreePath.value = normalized;
    localStorage.setItem(STORAGE_KEY, normalized);
    addProjectToHistory(normalized);
    refreshProjectHistoryList();
    chatMessages.value = normalizeChatMessages(loadVibeChatHistory(normalized));
    refreshSessionList(normalized);
    refreshGitStatus();
    syncEditorPanelForOpenFiles();
    await scrollChatToBottom(true);
  } catch (e) {
    projectOpened.value = false;
    fileTree.value = [];
    treeError.value = e instanceof Error ? e.message : "打开项目失败";
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
  const current = activeFilePath.value;
  await openProjectByPath(projectPath.value.trim());
  if (current) await openFile(current);
}

async function refreshGitStatus() {
  if (!projectOpened.value) return;
  gitLoading.value = true;
  gitError.value = "";
  try {
    const result = await fetchGitStatus(projectPath.value.trim());
    if (!result.ok) {
      gitError.value = result.error || "获取 Git 状态失败";
      gitIsRepo.value = false;
      return;
    }
    gitIsRepo.value = result.isRepo;
    gitBranch.value = result.branch;
    gitStatus.value = result.files;

    if (result.isRepo) {
      refreshGitRemotes();
      if (gitLogOpen.value) {
        const logResult = await fetchGitLog(projectPath.value.trim(), 20);
        if (logResult.ok) {
          gitLogEntries.value = logResult.entries;
        }
      }
    }
  } catch (e) {
    gitError.value = e instanceof Error ? e.message : "获取 Git 状态失败";
  } finally {
    gitLoading.value = false;
  }
}

async function commitGit() {
  if (!projectOpened.value || !gitCommitMessage.value.trim()) return;
  if (!gitStagedFiles.value.length) {
    gitError.value = "请先暂存要提交的文件";
    return;
  }
  gitCommitting.value = true;
  gitError.value = "";
  try {
    const result = await commitGitChanges(projectPath.value.trim(), gitCommitMessage.value.trim());
    if (!result.ok) {
      gitError.value = result.error || "提交失败";
      return;
    }
    gitCommitMessage.value = "";
    await refreshGitStatus();
    await refreshTree();
  } catch (e) {
    gitError.value = e instanceof Error ? e.message : "提交失败";
  } finally {
    gitCommitting.value = false;
  }
}

async function stageFile(filePath: string) {
  if (!projectOpened.value) return;
  gitError.value = "";
  gitStatus.value = gitStatus.value.map((f) => (f.path === filePath ? { ...f, staged: true } : f));
  try {
    const result = await stageGitFiles(projectPath.value.trim(), [filePath]);
    if (!result.ok) {
      gitError.value = result.error || "暂存失败";
      await refreshGitStatus();
    }
  } catch (e) {
    gitError.value = e instanceof Error ? e.message : "暂存失败";
    await refreshGitStatus();
  }
}

async function unstageFile(filePath: string) {
  if (!projectOpened.value) return;
  gitError.value = "";
  gitStatus.value = gitStatus.value.map((f) => (f.path === filePath ? { ...f, staged: false } : f));
  try {
    const result = await unstageGitFiles(projectPath.value.trim(), [filePath]);
    if (!result.ok) {
      gitError.value = result.error || "取消暂存失败";
      await refreshGitStatus();
    }
  } catch (e) {
    gitError.value = e instanceof Error ? e.message : "取消暂存失败";
    await refreshGitStatus();
  }
}

async function stageAll() {
  if (!projectOpened.value) return;
  gitError.value = "";
  const filesToStage = gitUnstagedFiles.value.map((f) => f.path);
  if (!filesToStage.length) return;
  gitStatus.value = gitStatus.value.map((f) => ({ ...f, staged: true }));
  try {
    const result = await stageGitFiles(projectPath.value.trim(), []);
    if (!result.ok) {
      gitError.value = result.error || "暂存失败";
      await refreshGitStatus();
    }
  } catch (e) {
    gitError.value = e instanceof Error ? e.message : "暂存失败";
    await refreshGitStatus();
  }
}

async function unstageAll() {
  if (!projectOpened.value) return;
  gitError.value = "";
  if (!gitStagedFiles.value.length) return;
  gitStatus.value = gitStatus.value.map((f) => ({ ...f, staged: false }));
  try {
    const result = await unstageGitFiles(projectPath.value.trim(), []);
    if (!result.ok) {
      gitError.value = result.error || "取消暂存失败";
      await refreshGitStatus();
    }
  } catch (e) {
    gitError.value = e instanceof Error ? e.message : "取消暂存失败";
    await refreshGitStatus();
  }
}

async function discardFile(filePath: string) {
  if (!projectOpened.value) return;
  if (!window.confirm(`确定丢弃 ${filePath} 的更改？`)) return;
  gitError.value = "";
  try {
    const result = await discardGitFiles(projectPath.value.trim(), [filePath]);
    if (!result.ok) {
      gitError.value = result.error || "丢弃更改失败";
      return;
    }
    await refreshGitStatus();
    await refreshTree();
  } catch (e) {
    gitError.value = e instanceof Error ? e.message : "丢弃更改失败";
  }
}

async function discardAll() {
  if (!projectOpened.value) return;
  if (!window.confirm("确定丢弃所有未暂存的更改？")) return;
  gitError.value = "";
  try {
    const result = await discardGitFiles(projectPath.value.trim(), []);
    if (!result.ok) {
      gitError.value = result.error || "丢弃更改失败";
      return;
    }
    await refreshGitStatus();
    await refreshTree();
  } catch (e) {
    gitError.value = e instanceof Error ? e.message : "丢弃更改失败";
  }
}

async function generateCommitMessage() {
  if (!projectOpened.value || !gitStagedFiles.value.length) return;
  if (!configReady.value) {
    gitError.value = "请先配置 AI 模型";
    return;
  }
  gitError.value = "";
  try {
    gitGenStep.value = "获取变更…";
    await new Promise((r) => setTimeout(r, 100));

    gitGenStep.value = "AI 生成中…";
    let streamText = "";
    const result = await generateCommitMessageApi(
      projectPath.value.trim(),
      aiConfig.value.endpoint.trim(),
      aiConfig.value.apiKey.trim(),
      aiConfig.value.model.trim(),
      (delta) => {
        streamText += delta;
        gitCommitMessage.value = streamText.replace(/^["'"']|["'"']$/g, "").trim();
      },
    );
    if (!result.ok) {
      gitError.value = result.error || "AI 生成失败";
      return;
    }
    if (!result.message) {
      gitError.value = "AI 未返回内容";
      return;
    }
    gitGenStep.value = "完成 ✓";
    gitCommitMessage.value = result.message;
    await new Promise((r) => setTimeout(r, 600));
  } catch (e) {
    gitError.value = e instanceof Error ? e.message : "AI 生成提交信息失败";
  } finally {
    gitGenStep.value = "";
  }
}

function gitStatusIcon(status: string): string {
  switch (status) {
    case "modified": return "M";
    case "added": return "A";
    case "deleted": return "D";
    case "renamed": return "R";
    case "untracked": return "?";
    default: return "!";
  }
}

function gitStatusColor(status: string): string {
  switch (status) {
    case "modified": return "#e2c08c";
    case "added": return "#73daca";
    case "deleted": return "#f7768e";
    case "renamed": return "#bb9af7";
    case "untracked": return "#7aa2f7";
    default: return "#9aa5ce";
  }
}

async function showGitFileDiff(filePath: string) {
  if (!projectOpened.value) return;
  selectedGitFile.value = filePath;
  gitError.value = "";
  try {
    const result = await fetchGitDiffContent(projectPath.value.trim(), filePath);
    if (result.ok) {
      const fullPath = resolveFullPathFromRel(filePath);
      setFileDiff(fullPath, { before: result.before, after: result.after });
      await openFile(fullPath);
      showDiffMode.value = true;
    } else {
      gitError.value = result.error || "获取 diff 失败";
    }
  } catch (e) {
    gitError.value = e instanceof Error ? e.message : "获取 diff 失败";
  }
}

async function refreshGitRemotes() {
  if (!projectOpened.value || !gitIsRepo.value) return;
  gitRemoteLoading.value = true;
  try {
    const result = await fetchGitRemotes(projectPath.value.trim());
    if (result.ok) {
      gitRemotes.value = result.remotes;
      gitTrackingBranch.value = result.trackingBranch;
      gitAhead.value = result.ahead;
      gitBehind.value = result.behind;
    }
  } catch {
    // ignore
  } finally {
    gitRemoteLoading.value = false;
  }
}

async function doFetch() {
  if (!projectOpened.value) return;
  gitRemoteAction.value = "fetch";
  gitError.value = "";
  try {
    const result = await gitFetchRemote(projectPath.value.trim());
    if (!result.ok) {
      gitError.value = result.error || "Fetch 失败";
      return;
    }
    await refreshGitRemotes();
  } catch (e) {
    gitError.value = e instanceof Error ? e.message : "Fetch 失败";
  } finally {
    gitRemoteAction.value = "";
  }
}

async function doPull() {
  if (!projectOpened.value) return;
  gitRemoteAction.value = "pull";
  gitError.value = "";
  try {
    const result = await gitPullRemote(projectPath.value.trim());
    if (!result.ok) {
      gitError.value = result.error || "Pull 失败";
      return;
    }
    await refreshGitStatus();
    await refreshGitRemotes();
  } catch (e) {
    gitError.value = e instanceof Error ? e.message : "Pull 失败";
  } finally {
    gitRemoteAction.value = "";
  }
}

async function doPush() {
  if (!projectOpened.value) return;
  gitRemoteAction.value = "push";
  gitError.value = "";
  try {
    const result = await gitPushRemote(projectPath.value.trim());
    if (!result.ok) {
      gitError.value = result.error || "Push 失败";
      return;
    }
    await refreshGitRemotes();
  } catch (e) {
    gitError.value = e instanceof Error ? e.message : "Push 失败";
  } finally {
    gitRemoteAction.value = "";
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
  const choice = window.confirm(`「${name}」未保存。确定保存？\n\n确定 = 保存后切换\n取消 = 留在当前文件`);
  if (choice) {
    await saveFile();
    return !fileDirty.value;
  }
  return false;
}

function switchTab(path: string) {
  if (path === activeFilePath.value) return;
  void openFile(path);
}

async function closeTab(path: string) {
  const tab = findOpenTab(path);
  if (!tab) return;

  if (tab.dirty) {
    const name = fileName(path);
    const save = window.confirm(`「${name}」未保存。确定保存？\n\n确定 = 保存后关闭\n取消 = 留在当前文件`);
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

  if (activeFilePath.value !== path) return;

  const nextTab = openTabs.value[idx] || openTabs.value[idx - 1];
  if (nextTab) {
    activeFilePath.value = nextTab.path;
    fileContent.value = nextTab.content;
    fileDirty.value = nextTab.dirty;
    fileLoadError.value = "";
    showDiffMode.value = false;
    selectedTreePath.value = nextTab.path;
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
  const name = window.prompt("新建文件（可含子目录，如 src/utils/helper.ts）", "new-file.ts");
  if (!name?.trim()) return;
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
  const name = window.prompt("新建文件夹（可含子目录）", "new-folder");
  if (!name?.trim()) return;
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
  if (!window.confirm(`确定删除「${fileName(target)}」？`)) return;

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
  await openFile(activeFilePath.value, { force: true, skipUnsavedCheck: true });
}

async function saveFile() {
  if (!activeFilePath.value) return;
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
  fileDirty.value = true;
  const tab = findOpenTab(activeFilePath.value);
  if (tab) tab.dirty = true;
}

function onEditorSelect(text: string) {
  selectedCode.value = text.trim();
}

function askAiWithCode() {
  if (!selectedCode.value) return;
  const filePath = activeFilePath.value || "未知文件";
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

function buildReferencedFile(path: string, name: string): ReferencedFile {
  const root = projectPath.value.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
  const full = path.replace(/\\/g, "/");
  const relative =
    root && full.toLowerCase().startsWith(`${root}/`) ? full.slice(root.length + 1) : name;
  return { name, path, relative };
}

function isPointOverChatDropZone(x: number, y: number): boolean {
  const el = chatDropZoneRef.value;
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function canAcceptChatDrag(e: DragEvent): boolean {
  const types = Array.from(e.dataTransfer?.types ?? []);
  return types.includes("Files");
}

function acceptChatFileDrag(e: DragEvent) {
  if (!canAcceptChatDrag(e)) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = "copy";
  }
  isDragging.value = true;
}

function attachFileToChat(path: string, name?: string) {
  if (!projectPath.value.trim()) return;
  composerRef.value?.insertFileRef(buildReferencedFile(path, name ?? fileName(path)));
  void nextTick(() => composerRef.value?.focus());
}

function onFileDragStart(node: TreeNode, x: number, y: number) {
  const file = buildReferencedFile(node.path, node.name);
  fileDragGhost.value = { relative: file.relative, x, y };
  isDragging.value = isPointOverChatDropZone(x, y);
}

function onFileDragMove(x: number, y: number) {
  if (!fileDragGhost.value) return;
  fileDragGhost.value = { ...fileDragGhost.value, x, y };
  isDragging.value = isPointOverChatDropZone(x, y);
}

function onFileDragEnd(node: TreeNode, x: number, y: number) {
  if (isPointOverChatDropZone(x, y)) {
    attachFileToChat(node.path, node.name);
  }
  fileDragGhost.value = null;
  isDragging.value = false;
}

const FILE_DRAG_THRESHOLD_PX = 5;

function startPathDrag(path: string, name: string, e: PointerEvent, onTap: () => void) {
  if (e.button !== 0) return;
  e.preventDefault();

  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);

  const startX = e.clientX;
  const startY = e.clientY;
  let dragging = false;
  const stubNode = { path, name, isDirectory: false } as TreeNode;

  const cleanup = (ev: PointerEvent) => {
    el.releasePointerCapture(ev.pointerId);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
  };

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < FILE_DRAG_THRESHOLD_PX) return;
    if (!dragging) {
      dragging = true;
      onFileDragStart(stubNode, ev.clientX, ev.clientY);
    }
    onFileDragMove(ev.clientX, ev.clientY);
  };

  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    cleanup(ev);
    if (dragging) {
      onFileDragEnd(stubNode, ev.clientX, ev.clientY);
    } else {
      onTap();
    }
  };

  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
}

function onSearchResultPointerDown(
  e: PointerEvent,
  item: { path: string; name: string; isDirectory: boolean },
) {
  if (item.isDirectory) return;
  startPathDrag(item.path, item.name, e, () => {
    void openFile(item.path);
  });
}

function onDocumentDragOverCapture(e: DragEvent) {
  if (!isPointOverChatDropZone(e.clientX, e.clientY)) return;
  acceptChatFileDrag(e);
}

function onDocumentDropCapture(e: DragEvent) {
  if (!isPointOverChatDropZone(e.clientX, e.clientY)) return;
  if (!canAcceptChatDrag(e)) return;
  e.preventDefault();
  e.stopPropagation();
  void handleChatFileDrop(e);
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

function onChatDragEnter(e: DragEvent) {
  if (!canAcceptChatDrag(e)) return;
  dragCounter++;
  acceptChatFileDrag(e);
}

function onChatDragOver(e: DragEvent) {
  acceptChatFileDrag(e);
}

function onChatDragLeave(e: DragEvent) {
  const zone = chatDropZoneRef.value;
  const related = e.relatedTarget as Node | null;
  if (zone && related && zone.contains(related)) return;
  dragCounter--;
  if (dragCounter <= 0) {
    isDragging.value = false;
    dragCounter = 0;
  }
}

async function handleChatFileDrop(e: DragEvent) {
  isDragging.value = false;
  dragCounter = 0;

  const files = e.dataTransfer?.files;
  if (!files || !files.length) return;

  for (const file of Array.from(files)) {
    const path = (file as File & { path?: string }).path || "";
    if (!path) continue;

    try {
      const result = await readFile(path);
      if (result.ok) {
        composerRef.value?.insertDroppedFile({
          name: file.name,
          path,
          content: result.content,
        });
      }
    } catch {
      // ignore unreadable files
    }
  }

  await nextTick(() => composerRef.value?.focus());
}

function onChatDrop(e: DragEvent) {
  if (!canAcceptChatDrag(e) && !(e.dataTransfer?.files?.length)) return;
  e.preventDefault();
  e.stopPropagation();
  void handleChatFileDrop(e);
}

function onWindowDragEnd() {
  isDragging.value = false;
  dragCounter = 0;
}

function extractCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /```[\w]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1]?.trim()) blocks.push(m[1].trimEnd());
  }
  return blocks;
}

async function applyCodeBlock(code: string) {
  expandEditor();
  if (activeFilePath.value) {
    const before = fileContent.value;
    fileContent.value = code;
    fileDirty.value = true;
    setFileDiff(activeFilePath.value, { before, after: code });
    return;
  }
  if (!projectOpened.value) return;
  const rel = window.prompt("未打开文件。请输入相对路径（如 src/example.ts）", "new-file.ts");
  if (!rel?.trim()) return;
  const fullPath = resolveFullPathFromRel(rel.trim());
  const existing = await readFile(fullPath);
  const before = existing.ok ? existing.content : "";
  const writeResult = existing.ok
    ? await writeFile(fullPath, code)
    : await createItem(fullPath, false, code);
  if (!writeResult.ok) {
    treeError.value = writeResult.error || "写入失败";
    return;
  }
  treeError.value = "";
  setFileDiff(fullPath, { before, after: code });
  await refreshTree();
  const openPath = resolveFullPathFromRel(rel.trim());
  selectedTreePath.value = openPath;
  await openFile(openPath);
  showDiffMode.value = true;
  fileDirty.value = false;
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
    return { name, icon: "✏️", title: "暂存修改", detail, label: detail ? `暂存修改 ${detail}` : "暂存修改" };
  }
  if (name === "delete_file") {
    const detail = path || "";
    return { name, icon: "🗑️", title: "暂存删除", detail, label: detail ? `暂存删除 ${detail}` : "暂存删除" };
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

function handleAgentEvent(event: VibeAgentSseEvent, assistantMsg: ChatMessage) {
  const msgId = assistantMsg.id;

  if (event.type === "agent_context") {
    assistantMsg.agentContext = event.data;
    assistantMsg.activityExpanded = true;
    patchAssistantMsg(msgId, { agentContext: event.data, activityExpanded: true });
    void scrollChatToBottom(true);
    return;
  }

  if (event.type === "turn_trace") {
    if (!assistantMsg.turnTraces) assistantMsg.turnTraces = [];
    assistantMsg.turnTraces.push({ ...event.data });
    assistantMsg.activityExpanded = true;
    patchAssistantMsg(msgId, { turnTraces: [...assistantMsg.turnTraces], activityExpanded: true });
    void scrollChatToBottom(true);
    return;
  }

  if (event.type === "status") {
    const { phase } = event.data;
    setAgentStatus(assistantMsg, phase, event.data);
    patchAssistantMsg(msgId, {
      agentPhase: assistantMsg.agentPhase,
      status: assistantMsg.status,
      statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
      agentTurn: assistantMsg.agentTurn,
      agentMaxTurns: assistantMsg.agentMaxTurns,
      activityExpanded: true,
      ...(phase === "finished" ? { agentPhase: undefined, streaming: false } : {}),
    });
    if (phase === "aborted") {
      chatSending.value = false;
      persistChatNow();
      patchAssistantMsg(msgId, { activityExpanded: true });

      if (pendingPromptQueue.value.length) {
        const next = pendingPromptQueue.value.shift()!;
        void runAgentTurn(next, { skipUserBubble: true });
      }
    }
    void scrollChatToBottom(true);
    return;
  }

  if (event.type === "tool_start") {
    if (!assistantMsg.tools) assistantMsg.tools = [];
    const meta = formatToolMeta(event.data.name, event.data.args);
    assistantMsg.tools.push({
      id: event.data.id,
      ...meta,
      args: { ...event.data.args },
      summary: "",
      ok: true,
      running: true,
    });
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
      activityExpanded: true,
    });
    void scrollChatToBottom(true);
    return;
  }

  if (event.type === "file_diff") {
    const relPath = event.data.path;
    const diff = { before: event.data.before, after: event.data.after, deleted: event.data.deleted };
    storeFileDiff(relPath, diff.before, diff.after, diff.deleted);
    if (!assistantMsg.turnFileDiffs) assistantMsg.turnFileDiffs = {};
    assistantMsg.turnFileDiffs[relPath] = diff;
    assistantMsg.activityExpanded = true;
    patchAssistantMsg(msgId, { turnFileDiffs: { ...assistantMsg.turnFileDiffs }, activityExpanded: true });
    void scrollChatToBottom(true);
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
      activityExpanded: true,
    });
    void scrollChatToBottom(true);
    return;
  }

  if (event.type === "message_delta") {
    const delta = event.data.delta || "";
    if (!delta) return;
    const nextContent = `${assistantMsg.content || ""}${delta}`;
    assistantMsg.streaming = true;
    assistantMsg.content = nextContent;
    patchAssistantMsg(msgId, { streaming: true, content: nextContent });
    void scrollChatToBottom(true);
    return;
  }

  if (event.type === "message") {
    assistantMsg.content = event.data.text;
    assistantMsg.streaming = false;
    assistantMsg.status = "";
    assistantMsg.agentPhase = undefined;
    patchAssistantMsg(msgId, {
      content: event.data.text,
      streaming: false,
      status: "",
      agentPhase: undefined,
    });
    persistChatNow();
    void scrollChatToBottom(true);
    return;
  }

  if (event.type === "error") {
    chatError.value = event.data.message;
    const content = assistantMsg.content || event.data.message;
    assistantMsg.content = content;
    appendStatusLog(assistantMsg, `错误：${event.data.message}`);
    patchAssistantMsg(msgId, {
      content,
      activityExpanded: true,
      statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
    });
    persistChatNow();
    void scrollChatToBottom(true);
    chatSending.value = false;

    if (pendingPromptQueue.value.length) {
      const next = pendingPromptQueue.value.shift()!;
      void runAgentTurn(next, { skipUserBubble: true });
    }
    return;
  }

  if (event.type === "done") {
    chatSending.value = false;
    agentAbortHandle = null;
    assistantMsg.streaming = false;
    assistantMsg.totalTurns = event.data.turns;
    appendStatusLog(assistantMsg, `完成（共 ${event.data.turns} 轮）`);

    const pending = event.data.pendingFiles || [];
    if (pending.length && assistantMsg.turnFileDiffs && Object.keys(assistantMsg.turnFileDiffs).length) {
      assistantMsg.pendingApproval = true;
      assistantMsg.writtenFiles = [...pending];
    } else {
      assistantMsg.pendingApproval = false;
      assistantMsg.writtenFiles = event.data.writtenFiles?.length ? [...event.data.writtenFiles] : undefined;
    }

    assistantMsg.status = "";
    assistantMsg.agentPhase = undefined;
    assistantMsg.activityExpanded = true;
    patchAssistantMsg(msgId, {
      status: "",
      agentPhase: undefined,
      streaming: false,
      activityExpanded: true,
      totalTurns: assistantMsg.totalTurns,
      statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
      writtenFiles: assistantMsg.writtenFiles,
      pendingApproval: assistantMsg.pendingApproval,
    });
    persistChatNow();

    if (!assistantMsg.pendingApproval) {
      void handleAgentWrittenFiles(event.data.writtenFiles || []);
    } else {
      const firstRel = pending[0];
      if (firstRel && assistantMsg.turnFileDiffs?.[firstRel]) {
        const full = resolveFullPathFromRel(firstRel);
        void openFile(full);
        showDiffMode.value = true;
      }
    }
    void scrollChatToBottom(true);

    if (pendingPromptQueue.value.length) {
      const next = pendingPromptQueue.value.shift()!;
      void runAgentTurn(next, { skipUserBubble: true });
    }
  }
}

function formatPendingApprovalLabel(turnFileDiffs: Record<string, FileDiff>): string {
  const entries = Object.values(turnFileDiffs);
  const deleteCount = entries.filter((diff) => diff.deleted).length;
  const modifyCount = entries.length - deleteCount;
  const parts: string[] = [];
  if (deleteCount) parts.push(`${deleteCount} 个文件删除`);
  if (modifyCount) parts.push(`${modifyCount} 个文件修改`);
  return `待确认 ${parts.join("、")}`;
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

async function acceptAgentTurn(messageId: string) {
  if (chatSending.value || !projectOpened.value) return;
  const idx = chatMessages.value.findIndex((m) => m.id === messageId);
  if (idx < 0) return;

  const msg = chatMessages.value[idx];
  if (!msg.pendingApproval || !msg.turnFileDiffs) return;

  msg.reverting = true;
  chatError.value = "";

  try {
    const applied: string[] = [];
    for (const [relPath, diff] of Object.entries(msg.turnFileDiffs)) {
      const fullPath = resolveFullPathFromRel(relPath);
      if (diff.deleted) {
        const deleteResult = await deleteItem(fullPath);
        if (!deleteResult.ok) throw new Error(deleteResult.error || `删除 ${relPath} 失败`);
        removeOpenTabForPath(fullPath);
      } else {
        const existing = await readFile(fullPath);
        const writeResult = existing.ok
          ? await writeFile(fullPath, diff.after)
          : await createItem(fullPath, false, diff.after);
        if (!writeResult.ok) throw new Error(writeResult.error || `写入 ${relPath} 失败`);
      }
      applied.push(relPath);
    }

    msg.pendingApproval = false;
    msg.reverting = false;
    msg.writtenFiles = applied;
    patchAssistantMsg(messageId, {
      pendingApproval: false,
      reverting: false,
      writtenFiles: applied,
    });
    await refreshTree();
    const toPreview = applied.filter((rel) => !msg.turnFileDiffs?.[rel]?.deleted);
    void handleAgentWrittenFiles(toPreview);
    persistChatNow();
  } catch (error) {
    msg.reverting = false;
    patchAssistantMsg(messageId, { reverting: false });
    chatError.value = error instanceof Error ? error.message : "应用修改失败";
  }
}

function rejectAgentTurn(messageId: string) {
  if (chatSending.value) return;
  const idx = chatMessages.value.findIndex((m) => m.id === messageId);
  if (idx < 0) return;

  const msg = chatMessages.value[idx];
  if (!msg.pendingApproval || !msg.turnFileDiffs) return;
  if (!window.confirm("确定拒绝本轮所有暂存修改？")) return;

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

async function revertAgentTurn(messageId: string) {
  if (chatSending.value || !projectOpened.value) return;
  const idx = chatMessages.value.findIndex((m) => m.id === messageId);
  if (idx < 0) return;

  const msg = chatMessages.value[idx];
  if (!msg.turnFileDiffs || msg.reverted || msg.pendingApproval) return;

  const fileCount = Object.keys(msg.turnFileDiffs).length;
  if (!window.confirm(`确定回滚本轮 Agent 对 ${fileCount} 个文件的修改？`)) return;

  msg.reverting = true;
  chatError.value = "";

  try {
    for (const [relPath, diff] of Object.entries(msg.turnFileDiffs)) {
      const fullPath = resolveFullPathFromRel(relPath);
      if (diff.deleted) {
        const result = await writeFile(fullPath, diff.before);
        if (!result.ok) throw new Error(result.error || `恢复 ${relPath} 失败`);
      } else if (!diff.before && diff.after) {
        const result = await deleteItem(fullPath);
        if (!result.ok) throw new Error(result.error || `删除 ${relPath} 失败`);
        removeOpenTabForPath(fullPath);
      } else {
        const result = await writeFile(fullPath, diff.before);
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

    msg.reverted = true;
    msg.reverting = false;
    patchAssistantMsg(messageId, { reverted: true, reverting: false });
    await refreshTree();
    persistChatNow();
  } catch (error) {
    msg.reverting = false;
    patchAssistantMsg(messageId, { reverting: false });
    chatError.value = error instanceof Error ? error.message : "回滚失败";
  }
}

function stopAgent() {
  agentAbortHandle?.abort();
  agentAbortHandle = null;
  chatSending.value = false;
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

function undoExchange(messageId: string) {
  if (chatSending.value) return;
  const idx = chatMessages.value.findIndex((m) => m.id === messageId);
  if (idx < 0) return;

  const { start, end } = findExchangeBounds(idx);
  chatMessages.value.splice(start, end - start + 1);
  chatError.value = "";
  persistChatNow();
  void scrollChatToBottom();
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

  const userText = chatMessages.value[userIdx].content.trim();
  if (!userText) return;

  chatMessages.value = chatMessages.value.slice(0, userIdx);
  chatError.value = "";
  persistChatNow();
  await runAgentTurn(userText);
}

function buildAgentHistory(): VibeChatHistoryMessage[] {
  return chatMessages.value
    .slice(0, -2)
    .filter(
      (m): m is ChatMessage & { role: "user" | "assistant" } =>
        (m.role === "user" || m.role === "assistant") && Boolean(m.content.trim()),
    )
    .map((m) => ({ role: m.role, content: m.content.trim() }));
}

async function runAgentTurn(userText: string, options?: { skipUserBubble?: boolean }) {
  const prompt = userText.trim();
  if (!prompt || !configReady.value || !projectOpened.value) return;

  reloadAiConfig();
  chatSending.value = true;
  chatError.value = "";

  const history = buildAgentHistory();

  if (!options?.skipUserBubble) {
    chatMessages.value.push({ id: genId(), role: "user", content: prompt });
  }
  const mode = chatMode.value;
  const assistantMsg: ChatMessage = {
    id: genId(),
    role: "assistant",
    content: "",
    chatMode: mode,
    tools: [],
    activityExpanded: true,
    agentPhase: "connecting_local",
    status: formatAgentStatus({ phase: "connecting_local" }),
  };
  chatMessages.value.push(assistantMsg);
  persistChatNow();
  await scrollChatToBottom(true);

  agentAbortHandle?.abort();
  agentAbortHandle = runVibeAgentSse(
    {
      prompt,
      history,
      projectPath: projectPath.value.trim(),
      endpoint: aiConfig.value.endpoint,
      apiKey: aiConfig.value.apiKey,
      model: aiConfig.value.model,
      mode,
      openFilePath: activeFilePath.value || undefined,
    },
    (event) => handleAgentEvent(event, assistantMsg),
  );
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
      chunks.push(`### 📄 ${file.relative}\n\`\`\`\n${result.content}\n\`\`\``);
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
  let fullPrompt = userText || "请结合引用的文件回答。";

  if (quotedMessage.value) {
    const prefix = quotedMessage.value.role === "assistant" ? "Agent" : "你";
    const quotedContent = `> ${prefix}: ${quotedMessage.value.content.replace(/\n/g, "\n> ")}`;
    fullPrompt = `${quotedContent}\n\n${fullPrompt}`;
    quotedMessage.value = null;
  }

  const refSection = await buildReferencedFileSection(payload.refs);
  const dropSection = payload.drops.length
    ? payload.drops.map((f) => `### 📄 ${f.name}\n\`\`\`\n${f.content}\n\`\`\``).join("\n\n")
    : "";

  const sections = [refSection, dropSection].filter(Boolean);
  if (sections.length) {
    fullPrompt = `${fullPrompt}\n\n## 📎 参考文件\n\n${sections.join("\n\n")}`;
  }

  if (chatSending.value) {
    pendingPromptQueue.value.push(fullPrompt);
    chatMessages.value.push({ id: genId(), role: "user", content: fullPrompt });
    persistChatNow();
    void scrollChatToBottom(true);
    return;
  }

  await runAgentTurn(fullPrompt);
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
  if (e.key === "Escape") {
    // 优先关闭最顶层弹窗（按z-index层级从高到低）
    if (contextMenu.value.show) {
      e.preventDefault();
      hideContextMenu();
    } else if (historyOpen.value) {
      e.preventDefault();
      historyOpen.value = false;
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
    if (chatSending.value) void scrollChatToBottom(true);
  },
  { deep: true },
);

onMounted(() => {
  reloadAiConfig();
  refreshProjectHistoryList();
  loadSavedProject();
  chatPanelWidth.value = Math.min(chatPanelWidth.value, getChatPanelMaxWidth());
  window.addEventListener("focus", onWindowFocus);
  window.addEventListener("dragend", onWindowDragEnd);
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onGlobalKeydown);
  document.addEventListener("dragover", onDocumentDragOverCapture, true);
  document.addEventListener("drop", onDocumentDropCapture, true);
  onStorageError((msg) => {
    chatError.value = msg;
  });
});

onBeforeUnmount(() => {
  fileDragGhost.value = null;
  window.removeEventListener("focus", onWindowFocus);
  window.removeEventListener("dragend", onWindowDragEnd);
  document.removeEventListener("click", onDocumentClick);
  document.removeEventListener("keydown", onGlobalKeydown);
  document.removeEventListener("dragover", onDocumentDragOverCapture, true);
  document.removeEventListener("drop", onDocumentDropCapture, true);
  agentAbortHandle?.abort();
  stopResize();
  if (scrollChatRaf) cancelAnimationFrame(scrollChatRaf);
  if (saveChatTimer) clearTimeout(saveChatTimer);
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  if (mentionSearchTimer) clearTimeout(mentionSearchTimer);
  persistChatNow();
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
  background: var(--bg);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
}

.app-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  background: rgba(11, 18, 32, 0.92);
  backdrop-filter: blur(12px);
  flex-shrink: 0;
  min-height: 44px;
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
  min-width: 0;
}

.toolbar-actions {
  display: flex;
  align-items: center;
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

.bar-error {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(255, 77, 94, 0.2);
  color: var(--danger);
  font-size: 12px;
  font-weight: 700;
  cursor: help;
  flex-shrink: 0;
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
}

.file-panel {
  background: rgba(11, 18, 32, 0.4);
  border-right: 1px solid var(--border);
  overflow: hidden;
}

.file-panel-tabs {
  display: flex;
  gap: 2px;
  margin-right: 8px;
}

.file-panel-tab {
  padding: 6px 13px;
  font-size: 13px;
  background: transparent;
  color: var(--text-dim);
  border: none;
  border-radius: 5px;
  cursor: pointer;
  transition: all 150ms ease;
  position: relative;
}

.file-panel-tab:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
}

.file-panel-tab.active {
  color: var(--text);
  background: rgba(31, 111, 235, 0.22);
}

.git-badge {
  margin-left: 4px;
  padding: 0 6px;
  font-size: 11px;
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
  height: calc(100% - 40px);
  overflow: hidden;
}

.git-branch-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}

.git-branch-icon {
  color: var(--text-dim);
}

.git-branch-name {
  color: #7aa2f7;
  font-family: monospace;
}

.git-remote-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}

.git-remote-info {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-dim);
}

.git-remote-label {
  font-family: monospace;
  font-size: 11px;
}

.git-remote-tracking {
  color: #9aa5ce;
  font-family: monospace;
}

.git-remote-actions {
  display: flex;
  gap: 4px;
}

.git-error {
  padding: 8px 12px;
  font-size: 12px;
  color: #f7768e;
  background: rgba(247, 118, 142, 0.1);
  border-bottom: 1px solid var(--border);
}

.git-commit-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.git-commit-input {
  width: 100%;
  padding: 6px 10px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  outline: none;
  transition: border-color 180ms ease;
  box-sizing: border-box;
}

.git-commit-input:focus {
  border-color: rgba(31, 111, 235, 0.5);
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
}

.git-file-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.git-file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  cursor: pointer;
  transition: background 120ms ease;
}

.git-file-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.git-file-status {
  font-family: monospace;
  font-size: 12px;
  font-weight: 600;
  width: 14px;
  text-align: center;
}

.git-file-path {
  font-size: 13px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-file-item.active {
  background: rgba(31, 111, 235, 0.15);
}

.git-file-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 3px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-dim);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 120ms ease;
}

.git-file-check:hover {
  background: rgba(31, 111, 235, 0.2);
  border-color: rgba(31, 111, 235, 0.4);
  color: #7aa2f7;
}

.git-file-btn {
  padding: 2px 4px !important;
  font-size: 11px !important;
  opacity: 0;
  transition: opacity 120ms ease;
}

.git-file-item:hover .git-file-btn {
  opacity: 1;
}

.git-section {
  border-bottom: 1px solid var(--border);
}

.git-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.03);
}

.git-section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
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
}

.git-log-list {
  max-height: 200px;
  overflow-y: auto;
}

.git-log-item {
  display: flex;
  gap: 8px;
  padding: 5px 12px;
  font-size: 11px;
  cursor: default;
}

.git-log-item:hover {
  background: rgba(255, 255, 255, 0.03);
}

.git-log-hash {
  font-family: monospace;
  color: #7aa2f7;
  flex-shrink: 0;
}

.git-log-msg {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  background: rgba(11, 18, 32, 0.3);
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

@media (max-width: 1100px) {
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

@media (max-width: 720px) {
  .workspace {
    flex-direction: column;
  }

  .file-panel {
    width: 100% !important;
    height: 180px;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }

  .chat-panel {
    width: 100% !important;
    height: 240px;
    border-left: none;
    border-top: 1px solid var(--border);
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
  padding: 4px 9px;
  font-size: 11px;
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

.msg-streaming {
  margin: 0;
  padding: 10px 14px;
  max-width: 100%;
  min-width: 0;
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  color: rgba(255, 255, 255, 0.92);
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  font-family: inherit;
}

.stream-cursor {
  display: inline-block;
  color: #91beff;
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
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: rgba(17, 24, 39, 0.4);
}

.panel-head-right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.history-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  background: rgba(5, 10, 20, 0.72);
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding: 10px;
}

.history-panel {
  width: 100%;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px;
  overflow: hidden;
  backdrop-filter: blur(12px);
}

.history-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.history-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.history-desc {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--muted);
}

.history-new {
  width: 100%;
  margin-bottom: 10px;
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
  overflow: auto;
  display: grid;
  gap: 6px;
}

.history-item {
  display: flex;
  align-items: stretch;
  gap: 6px;
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
}

.history-delete {
  align-self: center;
  margin-right: 6px;
  flex-shrink: 0;
}

button.ghost.small {
  padding: 5px 12px;
  font-size: 12px;
  flex-shrink: 0;
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
  padding: 24px 14px;
  color: var(--muted);
  font-size: 14px;
  text-align: center;
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
  align-items: flex-end;
  min-height: 74px;
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
  height: 36px;
  margin-bottom: 1px;
}

.editor-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  flex-shrink: 0;
  height: 36px;
  margin-bottom: 1px;
  border-left: 1px solid var(--border);
}

.editor-tabs {
  display: flex;
  align-items: stretch;
  gap: 1px;
  flex: 1;
  min-width: 0;
  align-self: flex-end;
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
  padding: 8px 12px;
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
  overflow-x: hidden;
  overflow-y: auto;
  padding: 12px 14px;
}

.msg-list {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.msg {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  min-width: 0;
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
}

.msg-avatar {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  font-size: 10px;
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
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 12px;
}

.msg.user .msg-body {
  border-color: rgba(31, 111, 235, 0.28);
  background: rgba(31, 111, 235, 0.06);
}

.msg-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
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

.msg-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding-top: 10px;
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
  gap: 4px;
  margin-bottom: 10px;
  padding: 4px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border);
}

.mode-btn {
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.55);
  border-radius: 6px;
  padding: 5px 16px;
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
  border-top: 1px solid var(--border);
  padding: 12px 14px;
  background: rgba(11, 18, 32, 0.65);
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
  overflow: hidden;
}

.chat-input-field {
  position: relative;
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
  min-height: 44px;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.04);
  transition: border-color 180ms ease, background 180ms ease, box-shadow 180ms ease;
  cursor: text;
}

.chat-input-box.focused {
  border-color: rgba(31, 111, 235, 0.5);
  background: rgba(255, 255, 255, 0.06);
  box-shadow: 0 0 0 3px rgba(31, 111, 235, 0.08);
}

.chat-composer-editor {
  width: 100%;
}

.chat-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
}

.chat-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.agent-activity {
  margin-bottom: 10px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.agent-activity.collapsed {
  background: rgba(0, 0, 0, 0.14);
}

.agent-activity-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  background: transparent;
  border: none;
  border-radius: 0;
  color: rgba(255, 255, 255, 0.82);
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

.tool-timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}

.tool-item {
  display: flex;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.tool-item.running {
  border-color: rgba(88, 166, 255, 0.35);
  background: rgba(31, 111, 235, 0.1);
}

.tool-item.done {
  border-color: rgba(46, 160, 67, 0.28);
}

.tool-item.fail {
  border-color: rgba(248, 81, 73, 0.35);
  background: rgba(248, 81, 73, 0.08);
}

.tool-item-icon {
  font-size: 16px;
  line-height: 1.2;
  flex-shrink: 0;
  margin-top: 1px;
}

.tool-item-body {
  min-width: 0;
  flex: 1;
}

.tool-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.tool-item-title {
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
  overflow-wrap: anywhere;
  word-break: break-word;
}

.tool-item-state {
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.45);
}

.tool-item.running .tool-item-state {
  color: #91beff;
}

.tool-item.done .tool-item-state {
  color: #7ee787;
}

.tool-item.fail .tool-item-state {
  color: #ff8a8a;
}

.tool-item-detail {
  margin-top: 3px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: rgba(145, 190, 255, 0.88);
  word-break: break-all;
}

.tool-item-summary {
  margin-top: 4px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.58);
  line-height: 1.45;
}

.tool-item-expand {
  margin-top: 6px;
  font-size: 11px;
}

.tool-item-expand summary {
  cursor: pointer;
  color: rgba(145, 190, 255, 0.9);
  user-select: none;
}

.trace-block {
  margin-bottom: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.15);
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
  max-height: 280px;
  overflow: auto;
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

.status-log {
  margin: 0;
  padding: 0 10px 10px 24px;
  font-size: 11px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.72);
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
