<template>
  <div class="vibe-page">
    <header class="page-head">
      <div class="head-left">
        <h1 class="title">Vibe Coding</h1>
        <p class="desc">打开项目文件夹，浏览代码，用 AI 对话改代码、问问题。</p>
      </div>
      <div class="head-actions">
        <router-link class="secondary link-btn" to="/chat">AI 对话</router-link>
        <router-link class="secondary link-btn" to="/ai-config">AI 配置</router-link>
      </div>
    </header>

    <section class="project-bar">
      <input
        v-model="projectPath"
        class="path-input"
        type="text"
        placeholder="可在此输入路径，或点击「打开项目」在弹窗地址栏输入"
        @keydown.enter="openProjectByInput"
      />
      <button type="button" class="primary" :disabled="pickingFolder || loadingTree" @click="handleOpenProject">
        {{ pickingFolder ? "选择文件夹…" : loadingTree ? "加载中..." : "打开项目" }}
      </button>
      <button type="button" class="secondary" :disabled="!projectPath.trim()" @click="refreshTree">刷新</button>
      <div ref="projectHistoryRef" class="project-history-wrap">
        <button
          type="button"
          class="ghost small"
          :disabled="loadingTree || pickingFolder"
          @click="toggleProjectHistory"
        >
          最近项目
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
      <span v-if="treeError" class="bar-error">{{ treeError }}</span>
    </section>

    <main ref="workspaceRef" class="workspace" :class="{ 'no-project': !projectOpened, 'editor-collapsed': editorCollapsed }">
      <aside class="file-panel" :style="{ width: filePanelWidth + 'px' }">
        <div class="panel-head file-panel-head">
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
              <span v-if="gitStatus.length" class="git-badge">{{ gitStatus.length }}</span>
            </button>
          </div>
          <div v-if="projectOpened && gitPanelMode === 'files'" class="file-toolbar">
            <button type="button" class="ghost tiny" title="新建文件" @click="createNewFile">+文件</button>
            <button type="button" class="ghost tiny" title="新建文件夹" @click="createNewFolder">+目录</button>
            <button type="button" class="ghost tiny" title="重命名" :disabled="!selectedTreePath" @click="renameSelectedItem">
              重命名
            </button>
            <button type="button" class="ghost tiny danger" title="删除" :disabled="!selectedTreePath" @click="deleteSelectedItem">
              删除
            </button>
          </div>
          <button
            v-if="editorCollapsed && gitPanelMode === 'files'"
            type="button"
            class="ghost small"
            title="展开编辑器"
            @click="expandEditor"
          >
            编辑器
          </button>
          <div v-if="gitPanelMode === 'files'" class="search-mode-switch" role="group" aria-label="搜索模式">
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
            v-if="gitPanelMode === 'files'"
            ref="searchInputRef"
            v-model="searchQuery"
            class="search-input"
            type="text"
            :placeholder="searchMode === 'file' ? '搜索文件名…' : '搜索代码内容…'"
            :disabled="!projectOpened"
            @keydown.enter="handleSearch"
          />
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
            <div v-if="gitError" class="git-error">{{ gitError }}</div>
            <div class="git-commit-box">
              <input
                v-model="gitCommitMessage"
                class="git-commit-input"
                type="text"
                placeholder="提交信息…"
                :disabled="gitCommitting || gitGenerating"
                @keydown.enter="commitGit"
              />
              <button
                type="button"
                class="ghost small"
                :disabled="gitCommitting || gitGenerating || !gitStatus.length"
                @click="generateCommitMessage"
              >
                {{ gitGenerating ? "生成中…" : "AI 生成" }}
              </button>
              <button
                type="button"
                class="primary small"
                :disabled="gitCommitting || !gitCommitMessage.trim()"
                @click="commitGit"
              >
                {{ gitCommitting ? "提交中…" : "提交" }}
              </button>
            </div>
            <div v-if="!gitStatus.length" class="panel-empty">无本地改动</div>
            <div v-else class="git-file-list">
              <div
                v-for="file in gitStatus"
                :key="file.path"
                class="git-file-item"
                :class="{ active: selectedGitFile === file.path }"
                @click="showGitFileDiff(file.path)"
              >
                <span
                  class="git-file-status"
                  :style="{ color: gitStatusColor(file.status) }"
                >
                  {{ gitStatusIcon(file.status) }}
                </span>
                <span class="git-file-path" :title="file.path">{{ file.path }}</span>
              </div>
            </div>
            <div v-if="selectedGitFile && gitDiffPatch" class="git-diff-panel">
              <div class="git-diff-header">
                <span class="git-diff-title">{{ selectedGitFile }}</span>
                <button type="button" class="ghost tiny" @click="selectedGitFile = ''; gitDiffPatch = ''">关闭</button>
              </div>
              <pre class="git-diff-content">{{ gitDiffPatch }}</pre>
            </div>
          </div>
        </div>

        <div v-if="!projectOpened" class="panel-empty">请先打开项目文件夹</div>

        <div v-else-if="searchMode === 'content' && contentSearchResults.length" class="file-list">
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

        <div v-else-if="searchMode === 'file' && searchResults.length" class="file-list">
          <button
            v-for="item in searchResults"
            :key="item.path"
            type="button"
            class="file-item"
            :class="{ active: item.path === activeFilePath }"
            @click="openFile(item.path)"
          >
            <span class="file-icon">{{ item.isDirectory ? "📁" : "📄" }}</span>
            <span class="file-name">{{ item.name }}</span>
          </button>
        </div>

        <div v-else class="file-tree">
          <FileTreeNode
            v-for="node in fileTree"
            :key="node.path"
            :node="node"
            :active-path="activeFilePath"
            :selected-path="selectedTreePath"
            :renaming-path="renamingPath"
            :expanded-dirs="expandedDirs"
            @toggle="toggleDir"
            @open="openFile"
            @select="selectTreeItem"
            @contextmenu="showContextMenu"
            @rename="commitRename"
            @rename-cancel="cancelRename"
          />
        </div>
      </aside>

      <div class="resize-handle" @mousedown="startResize('file', $event)"></div>

      <section v-show="!editorCollapsed" class="editor-panel">
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
        <div class="panel-head">
          <span class="panel-title">{{ activeFilePath ? fileName(activeFilePath) : "未打开文件" }}</span>
          <div class="panel-actions">
            <button
              v-if="activeFileDiff"
              type="button"
              class="secondary"
              @click="toggleDiffMode"
            >
              {{ showDiffMode ? "编辑" : "对比" }}
            </button>
            <span v-if="fileDirty && !showDiffMode" class="dirty-badge">未保存</span>
            <button
              type="button"
              class="secondary"
              :disabled="!activeFilePath || !fileDirty || showDiffMode"
              @click="saveFile"
            >
              保存
            </button>
            <button type="button" class="secondary" :disabled="!activeFilePath || showDiffMode" @click="reloadFile">
              重新加载
            </button>
            <button type="button" class="ghost small" title="收起编辑器" @click="collapseEditor">收起</button>
          </div>
        </div>

        <div v-if="!activeFilePath" class="editor-empty">
          <p>从左侧选择文件开始编辑</p>
          <button type="button" class="secondary" @click="collapseEditor">收起编辑器</button>
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

      <aside class="chat-panel" :class="{ 'chat-expanded': editorCollapsed }" :style="chatPanelStyle">
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
            <p>Agent 会探索项目；Build 模式修改需你确认后才落盘。输入 <code>@</code> 可引用文件。</p>
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
                v-if="m.role === 'assistant' && m.chatMode !== 'ask' && hasAgentActivity(m)"
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
                  <span class="agent-activity-title">Agent 执行过程</span>
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
                  </div>
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
                v-if="
                  m.role === 'assistant' &&
                  !m.streaming &&
                  (m.pendingApproval || m.writtenFiles?.length || extractCodeBlocks(m.content).length)
                "
                class="msg-actions"
              >
                <template v-if="m.pendingApproval && m.turnFileDiffs">
                  <span class="pending-badge">待确认 {{ Object.keys(m.turnFileDiffs).length }} 个文件修改</span>
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

        <div
          v-if="showQuoteButton"
          class="quote-floating"
          :style="{ left: quoteButtonPosition.x + 'px', top: quoteButtonPosition.y + 'px' }"
          @mousedown.prevent="quoteSelectedText"
          @mouseleave="hideQuoteButton"
        >
          <span class="quote-icon">❝</span> 引用
        </div>

        <footer
          class="chat-composer"
          :class="{ 'drag-over': isDragging }"
          @dragenter.prevent="onDragEnter"
          @dragover.prevent="onDragOver"
          @dragleave.prevent="onDragLeave"
          @drop.prevent="onDrop"
        >
          <div v-if="droppedFiles.length || referencedFiles.length" class="dropped-files">
            <span
              v-for="(file, idx) in droppedFiles"
              :key="`drop-${idx}`"
              class="dropped-file-tag"
            >
              📄 {{ file.name }}
              <button type="button" class="drop-file-remove" @click="removeDroppedFile(idx)">×</button>
            </span>
            <span
              v-for="(file, idx) in referencedFiles"
              :key="`ref-${file.path}`"
              class="dropped-file-tag ref-tag"
            >
              @ {{ file.relative }}
              <button type="button" class="drop-file-remove" @click="removeReferencedFile(idx)">×</button>
            </span>
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
          <textarea
            ref="chatInputRef"
            v-model="chatInput"
            class="chat-input"
            rows="3"
            :placeholder="chatPlaceholder"
            @input="onChatInput"
            @keydown="onChatKeydown"
          />
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
      <div v-if="contextMenu.show" class="ctx-overlay" @click="hideContextMenu" @contextmenu.prevent="hideContextMenu">
        <div class="ctx-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @click.stop>
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
  commitGitChanges,
  fetchGitLog,
  stageGitFiles,
  unstageGitFiles,
  discardGitFiles,
  type GitStatusFile,
  type GitLogEntry,
} from "../services/vibeGitClient";

const STORAGE_KEY = "vibe-coding-project";
const PANEL_WIDTH_KEY = "vibe-coding-panel-widths";
const EDITOR_COLLAPSED_KEY = "vibe-coding-editor-collapsed";
const CHAT_MODE_KEY = "vibe-coding-chat-mode";
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
};
type ChatMessage = Omit<PersistedChatMessage, "tools"> & {
  tools?: AgentToolStep[];
  chatMode?: VibeChatMode;
  status?: string;
  agentPhase?: string;
  agentTurn?: number;
  agentMaxTurns?: number;
  activityExpanded?: boolean;
  streaming?: boolean;
  reverting?: boolean;
  pendingApproval?: boolean;
  rejected?: boolean;
};

type FileDiff = {
  before: string;
  after: string;
};

type AgentStatusData = Extract<VibeAgentSseEvent, { type: "status" }>["data"] & {
  toolTitle?: string;
  toolDetail?: string;
};

function normalizeChatMessages(messages: PersistedChatMessage[]): ChatMessage[] {
  return messages.map((m) => ({
    ...m,
    tools: m.tools?.map((t) => ({
      id: t.id,
      name: t.name || "",
      icon: t.icon || "⚙️",
      title: t.title || t.label,
      detail: t.detail || "",
      label: t.label,
      summary: t.summary,
      ok: t.ok,
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
const chatInput = ref("");
const chatMessages = ref<ChatMessage[]>([]);
const chatSending = ref(false);
const chatError = ref("");
const chatScrollRef = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
const workspaceRef = ref<HTMLElement | null>(null);
let scrollChatRaf = 0;
const historyOpen = ref(false);
const activeSessionId = ref("");
const pendingPrompts: string[] = [];

interface DroppedFile {
  name: string;
  path: string;
  content: string;
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

const droppedFiles = ref<DroppedFile[]>([]);
const referencedFiles = ref<ReferencedFile[]>([]);
const chatInputRef = ref<HTMLTextAreaElement | null>(null);
const mentionOpen = ref(false);
const mentionQuery = ref("");
const mentionActiveIndex = ref(0);
const mentionRemoteResults = ref<ProjectFileItem[]>([]);
let mentionSearchTimer: ReturnType<typeof setTimeout> | null = null;
const isDragging = ref(false);
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
const gitGenerating = ref(false);
const gitLogEntries = ref<GitLogEntry[]>([]);
const selectedGitFile = ref("");
const gitDiffPatch = ref("");

const contextMenu = ref({ show: false, x: 0, y: 0, path: "" });
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
  () =>
    (Boolean(chatInput.value.trim()) || droppedFiles.value.length > 0 || referencedFiles.value.length > 0) &&
    configReady.value &&
    projectOpened.value,
);

const chatPlaceholder = computed(() =>
  chatMode.value === "ask"
    ? "提问、解释代码（输入 @ 引用文件，Enter 发送）"
    : "描述要改什么（输入 @ 引用文件，Enter 发送，Shift+Enter 换行）",
);

const chatHintText = computed(() =>
  chatMode.value === "ask"
    ? "Ask 模式 · 含项目结构，不改文件 · 输入 @ 引用文件"
    : "Build 模式 · 修改需确认后落盘 · 输入 @ 引用文件",
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
  msg.status = formatAgentStatus({ phase, ...extra });
  if (extra?.turn) msg.agentTurn = extra.turn;
  if (extra?.maxTurns) msg.agentMaxTurns = extra.maxTurns;
}

function isAgentRunning(msg: ChatMessage): boolean {
  return chatSending.value && msg.id === activeAssistantMsgId.value;
}

function hasAgentActivity(msg: ChatMessage): boolean {
  if (msg.chatMode === "ask") return false;
  return Boolean(msg.status || msg.tools?.length || msg.agentTurn);
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
}

function activitySummary(msg: ChatMessage): string {
  const toolCount = msg.tools?.length ?? 0;
  if (toolCount > 0) {
    const failed = msg.tools?.filter((t) => !t.ok).length ?? 0;
    return failed > 0 ? `已执行 ${toolCount} 个工具（${failed} 个失败）` : `已执行 ${toolCount} 个工具`;
  }
  if (msg.agentTurn && msg.agentMaxTurns) return `共 ${msg.agentMaxTurns} 轮`;
  return "查看执行过程";
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
  } catch (e) {
    gitError.value = e instanceof Error ? e.message : "获取 Git 状态失败";
  } finally {
    gitLoading.value = false;
  }
}

async function commitGit() {
  if (!projectOpened.value || !gitCommitMessage.value.trim()) return;
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

async function generateCommitMessage() {
  if (!projectOpened.value || !gitStatus.value.length) return;
  if (!configReady.value) {
    gitError.value = "请先配置 AI 模型";
    return;
  }
  gitGenerating.value = true;
  gitError.value = "";
  try {
    const diffResult = await fetchGitDiff(projectPath.value.trim());
    if (!diffResult.ok) {
      gitError.value = diffResult.error || "获取 diff 失败";
      return;
    }
    const diffText = diffResult.patch || "";
    if (!diffText.trim()) {
      gitError.value = "没有可提交的变更";
      return;
    }
    const fileList = gitStatus.value.map((f) => `${f.status}: ${f.path}`).join("\n");
    const prompt = `你是一个 Git 提交信息生成器。根据以下文件变更生成一条简洁的中文提交信息（一行，不超过 72 个字符）。

变更文件列表：
${fileList}

Diff 内容：
${diffText.slice(0, 8000)}

要求：
- 使用中文
- 简明扼要描述做了什么
- 不要加前缀如 "feat:" 或 "fix:"，直接描述变更内容
- 不要加引号或句号`;

    const endpoint = aiConfig.value.endpoint.trim();
    const url = endpoint.replace(/\/+$/, "") + (endpoint.endsWith("/chat/completions") ? "" : "/chat/completions");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(aiConfig.value.apiKey.trim() ? { Authorization: `Bearer ${aiConfig.value.apiKey.trim()}` } : {}),
      },
      body: JSON.stringify({
        model: aiConfig.value.model.trim(),
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 100,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      gitError.value = `AI 请求失败：HTTP ${response.status}${errText ? ` - ${errText.slice(0, 200)}` : ""}`;
      return;
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim() || "";
    if (!content) {
      gitError.value = "AI 未返回内容";
      return;
    }
    gitCommitMessage.value = content.replace(/^["'"']|["'"']$/g, "").trim();
  } catch (e) {
    gitError.value = e instanceof Error ? e.message : "AI 生成提交信息失败";
  } finally {
    gitGenerating.value = false;
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
  try {
    const result = await fetchGitDiff(projectPath.value.trim(), filePath);
    if (result.ok) {
      gitDiffPatch.value = result.patch;
    } else {
      gitDiffPatch.value = result.error || "获取 diff 失败";
    }
  } catch (e) {
    gitDiffPatch.value = e instanceof Error ? e.message : "获取 diff 失败";
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

function storeFileDiff(relPath: string, before: string, after: string) {
  const full = resolveFullPathFromRel(relPath);
  setFileDiff(full, { before, after });
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
  chatInput.value = `请帮我分析以下代码（${filePath}）：\n\n\`\`\`\n${selectedCode.value}\n\`\`\``;
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
    chatInputRef.value?.focus();
  });
}

function hideQuoteButton() {
  setTimeout(() => {
    showQuoteButton.value = false;
  }, 200);
}

function applyExample(text: string) {
  chatInput.value = text;
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

function updateMentionState() {
  const el = chatInputRef.value;
  const value = chatInput.value;
  const pos = el?.selectionStart ?? value.length;
  const before = value.slice(0, pos);
  const match = /(^|\s)@([^\s@]*)$/.exec(before);
  if (match) {
    mentionOpen.value = true;
    mentionQuery.value = match[2];
    mentionActiveIndex.value = 0;
    scheduleMentionSearch();
    return;
  }
  mentionOpen.value = false;
  mentionQuery.value = "";
  mentionRemoteResults.value = [];
}

function onChatInput() {
  updateMentionState();
}

function removeMentionQueryFromInput() {
  const el = chatInputRef.value;
  const value = chatInput.value;
  const pos = el?.selectionStart ?? value.length;
  const before = value.slice(0, pos);
  const after = value.slice(pos);
  const match = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!match) return;
  const prefix = before.slice(0, match.index + (match[1] ? match[1].length : 0));
  chatInput.value = `${prefix}${after}`.replace(/\s{2,}/g, " ");
  mentionOpen.value = false;
  mentionQuery.value = "";
}

function selectMention(item: ProjectFileItem) {
  if (!referencedFiles.value.some((f) => f.path === item.path)) {
    referencedFiles.value.push({
      name: item.name,
      path: item.path,
      relative: item.relative,
    });
  }
  removeMentionQueryFromInput();
  void nextTick(() => chatInputRef.value?.focus());
}

function removeReferencedFile(idx: number) {
  referencedFiles.value.splice(idx, 1);
}

function onChatKeydown(e: KeyboardEvent) {
  if (mentionOpen.value && mentionResults.value.length) {
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
      const item = mentionResults.value[mentionActiveIndex.value];
      if (item) selectMention(item);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      mentionOpen.value = false;
      return;
    }
  }

  if (e.key !== "Enter" || e.shiftKey) return;
  e.preventDefault();
  void sendChat();
}

function onDragOver(e: DragEvent) {
  isDragging.value = true;
}

function onDragEnter(e: DragEvent) {
  dragCounter++;
  isDragging.value = true;
}

function onDragLeave(e: DragEvent) {
  dragCounter--;
  if (dragCounter <= 0) {
    isDragging.value = false;
    dragCounter = 0;
  }
}

async function onDrop(e: DragEvent) {
  isDragging.value = false;
  dragCounter = 0;

  const files = e.dataTransfer?.files;
  if (!files || !files.length) return;

  for (const file of Array.from(files)) {
    const path = (file as any).path || "";
    if (!path) continue;

    try {
      const result = await readFile(path);
      if (result.ok) {
        droppedFiles.value.push({
          name: file.name,
          path,
          content: result.content,
        });
      }
    } catch {
      // ignore unreadable files
    }
  }
}

function removeDroppedFile(idx: number) {
  droppedFiles.value.splice(idx, 1);
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
    const detail = path || "";
    return { name, icon: "✏️", title: "暂存修改", detail, label: detail ? `暂存修改 ${detail}` : "暂存修改" };
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

  if (event.type === "status") {
    const { phase } = event.data;
    setAgentStatus(assistantMsg, phase, event.data);
    patchAssistantMsg(msgId, {
      agentPhase: assistantMsg.agentPhase,
      status: assistantMsg.status,
      agentTurn: assistantMsg.agentTurn,
      agentMaxTurns: assistantMsg.agentMaxTurns,
      ...(phase === "finished" ? { agentPhase: undefined, streaming: false } : {}),
    });
    if (phase === "aborted") {
      chatSending.value = false;
      collapseAgentActivity(assistantMsg);
      patchAssistantMsg(msgId, { activityExpanded: false });

      if (pendingPrompts.length) {
        const next = pendingPrompts.shift()!;
        void runAgentTurn(next);
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
      agentPhase: assistantMsg.agentPhase,
    });
    void scrollChatToBottom(true);
    return;
  }

  if (event.type === "file_diff") {
    const relPath = event.data.path;
    const diff = { before: event.data.before, after: event.data.after };
    storeFileDiff(relPath, diff.before, diff.after);
    if (!assistantMsg.turnFileDiffs) assistantMsg.turnFileDiffs = {};
    assistantMsg.turnFileDiffs[relPath] = diff;
    patchAssistantMsg(msgId, { turnFileDiffs: { ...assistantMsg.turnFileDiffs } });
    return;
  }

  if (event.type === "tool_end") {
    const step = assistantMsg.tools?.find((t) => t.id === event.data.id);
    if (step) {
      step.running = false;
      step.ok = event.data.ok;
      step.summary = event.data.summary;
    }
    const pending = assistantMsg.tools?.some((t) => t.running);
    setAgentStatus(assistantMsg, pending ? "executing_tools" : "summarizing_tools", {
      turn: assistantMsg.agentTurn,
      maxTurns: assistantMsg.agentMaxTurns,
    });
    patchAssistantMsg(msgId, {
      tools: assistantMsg.tools ? [...assistantMsg.tools] : undefined,
      status: assistantMsg.status,
      agentPhase: assistantMsg.agentPhase,
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
    assistantMsg.status = "";
    patchAssistantMsg(msgId, { streaming: true, content: nextContent, status: "" });
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
    void scrollChatToBottom(true);
    return;
  }

  if (event.type === "error") {
    chatError.value = event.data.message;
    const content = assistantMsg.content || event.data.message;
    assistantMsg.content = content;
    collapseAgentActivity(assistantMsg);
    patchAssistantMsg(msgId, { content, activityExpanded: false });
    void scrollChatToBottom(true);
    chatSending.value = false;

    if (pendingPrompts.length) {
      const next = pendingPrompts.shift()!;
      void runAgentTurn(next);
    }
    return;
  }

  if (event.type === "done") {
    chatSending.value = false;
    agentAbortHandle = null;
    assistantMsg.status = "";
    assistantMsg.agentPhase = undefined;
    assistantMsg.streaming = false;

    const pending = event.data.pendingFiles || [];
    if (pending.length && assistantMsg.turnFileDiffs && Object.keys(assistantMsg.turnFileDiffs).length) {
      assistantMsg.pendingApproval = true;
      assistantMsg.writtenFiles = [...pending];
    } else {
      assistantMsg.pendingApproval = false;
      assistantMsg.writtenFiles = event.data.writtenFiles?.length ? [...event.data.writtenFiles] : undefined;
    }

    collapseAgentActivity(assistantMsg);
    patchAssistantMsg(msgId, {
      status: "",
      agentPhase: undefined,
      streaming: false,
      activityExpanded: false,
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

    if (pendingPrompts.length) {
      const next = pendingPrompts.shift()!;
      void runAgentTurn(next);
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
      const existing = await readFile(fullPath);
      const writeResult = existing.ok
        ? await writeFile(fullPath, diff.after)
        : await createItem(fullPath, false, diff.after);
      if (!writeResult.ok) throw new Error(writeResult.error || `写入 ${relPath} 失败`);
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
    void handleAgentWrittenFiles(applied);
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
      if (!diff.before && diff.after) {
        const result = await deleteItem(fullPath);
        if (!result.ok) throw new Error(result.error || `删除 ${relPath} 失败`);
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

async function runAgentTurn(userText: string) {
  const prompt = userText.trim();
  if (!prompt || !configReady.value || !projectOpened.value) return;

  reloadAiConfig();
  chatSending.value = true;
  chatError.value = "";

  const history = buildAgentHistory();

  chatMessages.value.push({ id: genId(), role: "user", content: prompt });
  const mode = chatMode.value;
  const assistantMsg: ChatMessage = {
    id: genId(),
    role: "assistant",
    content: "",
    chatMode: mode,
    tools: mode === "build" ? [] : undefined,
    activityExpanded: mode === "build",
    agentPhase: "connecting_local",
    status: formatAgentStatus({ phase: "connecting_local" }),
  };
  chatMessages.value.push(assistantMsg);
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

async function buildReferencedFileSection(): Promise<string> {
  if (!referencedFiles.value.length) return "";
  const chunks: string[] = [];
  for (const file of referencedFiles.value) {
    const result = await readFile(file.path);
    if (result.ok) {
      chunks.push(`--- ${file.relative} ---\n${result.content}`);
    } else {
      chunks.push(`--- ${file.relative} ---\n（读取失败：${result.error || "未知错误"}）`);
    }
  }
  return chunks.join("\n\n");
}

async function sendChat() {
  if (!canSendChat.value) return;
  const userText = chatInput.value.trim();
  chatInput.value = "";
  mentionOpen.value = false;

  let fullPrompt = userText || "请结合引用的文件回答。";
  
  if (quotedMessage.value) {
    const prefix = quotedMessage.value.role === "assistant" ? "Agent" : "你";
    const quotedContent = `> ${prefix}: ${quotedMessage.value.content.replace(/\n/g, "\n> ")}`;
    fullPrompt = `${quotedContent}\n\n${fullPrompt}`;
    quotedMessage.value = null;
  }
  
  const refSection = await buildReferencedFileSection();
  const dropSection = droppedFiles.value.length
    ? droppedFiles.value.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n")
    : "";

  const sections = [refSection, dropSection].filter(Boolean);
  if (sections.length) {
    fullPrompt = `${fullPrompt}\n\n## 参考文件\n\n${sections.join("\n\n")}`;
  }

  droppedFiles.value = [];
  referencedFiles.value = [];

  if (chatSending.value) {
    pendingPrompts.push(fullPrompt);
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
  if (e.key === "Escape" && historyOpen.value) {
    e.preventDefault();
    historyOpen.value = false;
  }
}

watch(chatMode, (mode) => {
  try {
    localStorage.setItem(CHAT_MODE_KEY, mode);
  } catch {
    // ignore
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
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onGlobalKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("focus", onWindowFocus);
  document.removeEventListener("click", onDocumentClick);
  document.removeEventListener("keydown", onGlobalKeydown);
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

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 16px 24px 14px;
  border-bottom: 1px solid var(--border);
  background: rgba(11, 18, 32, 0.8);
  backdrop-filter: blur(10px);
}

.head-left {
  flex-shrink: 0;
}

.title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.3px;
}

.desc {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}

.head-actions {
  display: flex;
  gap: 8px;
}

.project-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  background: rgba(11, 18, 32, 0.6);
  flex-wrap: wrap;
}

.path-input {
  flex: 1;
  min-width: 200px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 9px 14px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  outline: none;
  transition: border-color 180ms ease, background 180ms ease, box-shadow 180ms ease;
}

.path-input:focus {
  border-color: rgba(31, 111, 235, 0.5);
  background: rgba(255, 255, 255, 0.06);
}

.path-input::placeholder {
  color: rgba(255, 255, 255, 0.4);
}

.bar-error {
  color: var(--danger);
  font-size: 12px;
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
  border-radius: 12px;
  padding: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  overflow: hidden;
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
  border-radius: 8px;
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
}

.file-panel-tabs {
  display: flex;
  gap: 2px;
  margin-right: 8px;
}

.file-panel-tab {
  padding: 5px 12px;
  font-size: 12px;
  background: transparent;
  color: var(--text-dim);
  border: none;
  border-radius: 6px;
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
  font-size: 10px;
  font-weight: 600;
  background: rgba(31, 111, 235, 0.45);
  color: #fff;
  border-radius: 8px;
  line-height: 17px;
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
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}

.git-branch-icon {
  color: var(--text-dim);
}

.git-branch-name {
  color: #7aa2f7;
  font-family: monospace;
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
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.git-commit-input {
  flex: 1;
  padding: 7px 12px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  outline: none;
  transition: border-color 180ms ease;
}

.git-commit-input:focus {
  border-color: rgba(31, 111, 235, 0.5);
}

.git-commit-input::placeholder {
  color: var(--text-dim);
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
  padding: 6px 12px;
  cursor: pointer;
  transition: background 100ms ease;
}

.git-file-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.git-file-status {
  font-family: monospace;
  font-size: 12px;
  font-weight: 600;
  width: 14px;
  text-align: center;
}

.git-file-path {
  font-size: 12px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-file-item.active {
  background: rgba(31, 111, 235, 0.15);
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
  background: rgba(2, 6, 23, 0.35);
  flex: 1;
  min-width: 0;
  position: relative;
}

.ask-ai-floating {
  position: absolute;
  bottom: 16px;
  right: 16px;
  padding: 8px 16px;
  background: rgba(31, 111, 235, 0.9);
  color: white;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  z-index: 10;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  transition: background 200ms ease, transform 200ms ease;
}

.ask-ai-floating:hover {
  background: rgba(31, 111, 235, 1);
  transform: translateY(-2px);
}

.quote-floating {
  position: fixed;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  background: rgba(2, 6, 23, 0.92);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 11px;
  color: var(--text);
  cursor: pointer;
  z-index: 1000;
  transform: translate(-50%, -100%);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  transition: all 150ms ease;
  white-space: nowrap;
  backdrop-filter: blur(8px);
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
  flex-wrap: wrap;
  gap: 8px;
}

.file-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
}

button.ghost.tiny {
  padding: 4px 8px;
  font-size: 11px;
  border-radius: 6px;
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
  border-radius: 8px;
  padding: 4px 0;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
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
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
  color: rgba(255, 255, 255, 0.92);
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
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
  padding: 10px 14px;
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
  border-radius: 12px;
  padding: 12px;
  overflow: hidden;
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
  border-radius: 8px;
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
  padding: 3px 8px;
  font-size: 11px;
  flex-shrink: 0;
}

.panel-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.panel-meta {
  font-size: 11px;
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
  padding: 1px 6px;
  background: rgba(240, 198, 116, 0.15);
  border-radius: 4px;
}

.search-mode-switch {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--border);
}

.search-mode-btn {
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.55);
  border-radius: 5px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 150ms ease;
}

.search-mode-btn.active {
  background: rgba(31, 111, 235, 0.25);
  color: #aad0ff;
}

.search-input {
  width: 130px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 5px 10px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  outline: none;
  transition: border-color 180ms ease, background 180ms ease, width 200ms ease;
}

.search-input:focus {
  border-color: rgba(31, 111, 235, 0.5);
  background: rgba(255, 255, 255, 0.06);
  width: 180px;
}

.search-input::placeholder {
  color: rgba(255, 255, 255, 0.4);
}

.panel-empty,
.editor-empty,
.chat-empty {
  padding: 24px 14px;
  color: var(--muted);
  font-size: 13px;
  text-align: center;
}

.editor-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  flex: 1;
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
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
  transition: background 100ms ease;
}

.file-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.file-item.active {
  background: rgba(31, 111, 235, 0.18);
  color: #aad0ff;
}

.file-icon {
  font-size: 14px;
  width: 18px;
  text-align: center;
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
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-tabs {
  display: flex;
  align-items: stretch;
  gap: 2px;
  padding: 6px 8px 0;
  overflow-x: auto;
  border-bottom: 1px solid var(--border);
  background: rgba(17, 24, 39, 0.35);
}

.editor-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 180px;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.72);
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
  transition: all 150ms ease;
}

.editor-tab:hover {
  background: rgba(255, 255, 255, 0.07);
}

.editor-tab.active {
  background: rgba(31, 111, 235, 0.18);
  border-color: rgba(31, 111, 235, 0.35);
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
  border: none;
  resize: none;
  padding: 14px 16px;
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
  overflow: auto;
  padding: 12px;
}

.msg-list {
  display: grid;
  gap: 12px;
}

.msg {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
}

.msg.user {
  border-color: rgba(31, 111, 235, 0.3);
  background: rgba(31, 111, 235, 0.06);
}

.msg.assistant {
  background: rgba(255, 255, 255, 0.03);
}

.msg-role {
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.msg.user .msg-role {
  color: #91beff;
}

.msg.assistant .msg-role {
  color: #b392f0;
}

.msg-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.55;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
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
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(46, 160, 67, 0.15);
  border: 1px solid rgba(46, 160, 67, 0.28);
}

.rejected-badge {
  font-size: 11px;
  color: rgba(255, 180, 180, 0.9);
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(248, 81, 73, 0.12);
  border: 1px solid rgba(248, 81, 73, 0.28);
}

.pending-badge {
  font-size: 11px;
  color: #f0c674;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(240, 198, 116, 0.12);
  border: 1px solid rgba(240, 198, 116, 0.28);
}

button.primary.small-action {
  padding: 5px 12px;
  font-size: 12px;
}

.file-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.file-item.active {
  background: rgba(31, 111, 235, 0.2);
  color: #aad0ff;
}

.file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.code-editor {
  flex: 1;
  min-height: 0;
}

.chat-scroll {
  flex: 1;
  overflow: auto;
  padding: 10px 12px;
}

.msg-list {
  display: grid;
  gap: 10px;
}

.msg {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px;
}

.msg.user {
  border-color: rgba(31, 111, 235, 0.35);
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

.msg-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0.72;
  transition: opacity 120ms ease;
}

.msg:hover .msg-toolbar,
.msg:focus-within .msg-toolbar {
  opacity: 1;
}

.msg-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.5;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.msg-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
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
  background: rgba(31, 111, 235, 0.2);
  border-color: rgba(31, 111, 235, 0.4);
}

.chat-mode-switch {
  display: inline-flex;
  gap: 4px;
  margin-bottom: 10px;
  padding: 3px;
  border-radius: 8px;
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
  padding: 12px;
  background: rgba(11, 18, 32, 0.5);
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

.mention-dropdown {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: calc(100% - 4px);
  z-index: 12;
  max-height: 220px;
  overflow: auto;
  display: grid;
  gap: 2px;
  padding: 6px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
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
  border-radius: 6px;
  padding: 8px 10px;
  cursor: pointer;
}

.mention-item:hover,
.mention-item.active {
  background: rgba(31, 111, 235, 0.14);
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

.dropped-file-tag.ref-tag {
  background: rgba(179, 146, 240, 0.18);
  border-color: rgba(179, 146, 240, 0.32);
}

.chat-composer.drag-over {
  background: rgba(31, 111, 235, 0.15);
  border-top-color: rgba(31, 111, 235, 0.6);
}

.dropped-files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.dropped-file-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: rgba(31, 111, 235, 0.2);
  border: 1px solid rgba(31, 111, 235, 0.3);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text);
}

.drop-file-remove {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  padding: 0 2px;
  font-size: 14px;
  line-height: 1;
}

.drop-file-remove:hover {
  color: rgba(255, 255, 255, 0.9);
}

.chat-input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  font-size: 13px;
  resize: vertical;
  min-height: 72px;
  outline: none;
  transition: border-color 180ms ease, background 180ms ease, box-shadow 180ms ease;
}

.chat-input:focus {
  border-color: rgba(31, 111, 235, 0.5);
  background: rgba(255, 255, 255, 0.06);
  box-shadow: 0 0 0 3px rgba(31, 111, 235, 0.08);
}

.chat-input::placeholder {
  color: rgba(255, 255, 255, 0.4);
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
  border-radius: 10px;
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
  font-size: 11px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.5);
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
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(31, 111, 235, 0.18);
  color: #91beff;
  border: 1px solid rgba(31, 111, 235, 0.28);
}

.agent-phase-badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 2px 7px;
  border-radius: 6px;
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
  padding: 8px 10px;
  border-radius: 8px;
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
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
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
  color: rgba(255, 255, 255, 0.85);
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  transition: all 180ms ease;
}

.link-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}
</style>
