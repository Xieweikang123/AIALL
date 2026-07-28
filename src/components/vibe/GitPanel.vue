<template>
  <div class="git-panel">
    <div v-if="!projectOpened" class="panel-empty">
      <span class="panel-empty-icon" aria-hidden="true">⎇</span>
      <p class="panel-empty-title">尚未打开项目</p>
      <p class="panel-empty-hint">打开项目后可查看 Git 状态与变更</p>
    </div>
    <div v-else-if="gitLoading && !gitStatusKnown" class="panel-empty">
      <span class="panel-loading-spinner panel-empty-spinner" aria-hidden="true" />
      <p class="panel-empty-title">正在加载 Git 状态…</p>
    </div>
    <div v-else-if="gitIsRepo" class="git-panel-content">
      <div class="git-header git-section-card">
        <div class="git-header-row git-branch-row">
          <div ref="branchSelectorRef" class="git-branch-selector-container">
            <button
              type="button"
              class="git-branch-info-btn"
              :class="{ 'git-branch-info-btn--open': branchDropdownOpen }"
              @click="toggleBranchDropdown"
              title="切换/管理分支"
            >
              <span class="git-branch-icon" aria-hidden="true">⎇</span>
              <span class="git-branch-name">{{ gitBranch }}</span>
              <span class="git-branch-chevron" aria-hidden="true">▾</span>
            </button>
            <span
              v-if="gitTrackingBranch && gitTrackingShortName() !== gitBranch"
              class="git-tracking-badge"
              :title="'跟踪: ' + gitTrackingBranch"
            >
              ⟶ {{ gitTrackingShortName() }}
            </span>

            <!-- Dropdown Menu -->
            <div v-if="branchDropdownOpen" class="git-branch-dropdown">
              <div class="git-branch-search-box">
                <input
                  v-model="branchSearchQuery"
                  type="text"
                  class="git-branch-search-input"
                  placeholder="搜索分支..."
                  @click.stop
                />
              </div>

              <!-- Create new branch section -->
              <div class="git-branch-create-box" @click.stop>
                <input
                  v-model="newBranchName"
                  type="text"
                  class="git-branch-create-input"
                  placeholder="新分支名称..."
                  @keyup.enter="handleCreateBranch"
                />
                <button
                  type="button"
                  class="git-branch-create-btn"
                  title="以此 HEAD 新建分支"
                  @click="handleCreateBranch"
                >
                  新建
                </button>
              </div>

              <div class="git-branch-list">
                <!-- Local Branches -->
                <div class="git-branch-group-label">本地分支</div>
                <div v-if="!filteredLocalBranches.length" class="git-branch-empty">
                  未找到匹配分支
                </div>
                <div
                  v-for="b in filteredLocalBranches"
                  :key="b.name"
                  class="git-branch-item"
                  :class="{ active: b.isCurrent }"
                  @click="handleSelectBranch(b)"
                >
                  <span class="git-branch-item-name" :title="b.name">{{ b.name }}</span>
                  <div class="git-branch-item-actions">
                    <span v-if="b.isCurrent" class="git-branch-active-indicator">✓</span>
                    <button
                      v-else
                      type="button"
                      class="git-branch-delete-btn"
                      title="删除本地分支"
                      @click="handleDeleteBranch(b.name, $event)"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <!-- Remote Branches -->
                <div class="git-branch-group-label">远程分支</div>
                <div v-if="!filteredRemoteBranches.length" class="git-branch-empty">
                  未找到匹配分支
                </div>
                <div
                  v-for="b in filteredRemoteBranches"
                  :key="b.name"
                  class="git-branch-item git-branch-item--remote"
                  @click="handleSelectBranch(b)"
                >
                  <span class="git-branch-item-name" :title="b.name">{{ b.name }}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="git-header-actions">
            <button
              type="button"
              class="ghost tiny"
              :class="{ active: stashSectionOpen }"
              title="贮藏工作区修改"
              @click="emit('update:gitStashSectionOpen', !stashSectionOpen)"
            >
              📦 贮藏<span v-if="gitStashes.length" class="git-stash-btn-count">{{ gitStashes.length }}</span>
            </button>
            <button type="button" class="ghost tiny" :disabled="gitLoading" @click="$emit('refresh')">刷新</button>
            <span
              v-if="fileWatcherActive"
              class="file-watcher-dot"
              :class="{ connected: fileWatcherConnected }"
              :title="fileWatcherConnected ? '文件监控已连接' : '文件监控重连中…'"
            />
          </div>
        </div>
        <div v-if="gitRemotes.length" class="git-header-row git-sync-row">
          <div class="git-sync-info">
            <span class="git-sync-stat" :class="{ ahead: gitAhead > 0 }">
              <span class="git-sync-arrow">↑</span>{{ gitAhead }}
            </span>
            <span class="git-sync-stat" :class="{ behind: gitBehind > 0 }">
              <span class="git-sync-arrow">↓</span>{{ gitBehind }}
            </span>
          </div>
          <div class="git-remote-actions">
            <button type="button" class="git-remote-btn" :disabled="!!gitRemoteAction" @click="$emit('do-fetch')">
              {{ gitRemoteAction === 'fetch' ? '…' : 'Fetch' }}
            </button>
            <button type="button" class="git-remote-btn" :disabled="!!gitRemoteAction" @click="$emit('do-pull')">
              {{ gitRemoteAction === 'pull' ? '…' : 'Pull' }}
            </button>
            <button type="button" class="git-remote-btn" :disabled="!!gitRemoteAction" @click="$emit('do-push')">
              {{ gitRemoteAction === 'push' ? '…' : 'Push' }}
            </button>
          </div>
        </div>
        <GitAheadCommits
          :ahead="gitAhead"
          :open="gitAheadCommitsOpen"
          :loading="gitAheadCommitsLoading"
          :commits="gitAheadCommits"
          @update:open="$emit('update:gitAheadCommitsOpen', $event)"
        />
      </div>

      <GitStashPanel
        :section-open="stashSectionOpen"
        :stashes="gitStashes"
        :stash-message="gitStashMessage"
        :stash-action="gitStashAction"
        :list-open="gitStashOpen"
        @update:section-open="$emit('update:gitStashSectionOpen', $event)"
        @update:list-open="$emit('update:gitStashOpen', $event)"
        @update:stash-message="$emit('update:gitStashMessage', $event)"
        @save="$emit('do-stash-save')"
        @apply="(index) => $emit('do-stash-apply', index)"
        @drop="(index) => $emit('do-stash-drop', index)"
      />

      <div v-if="gitError" class="git-error">{{ gitError }}</div>
      <div class="git-work-area" :class="{ 'git-work-area--log-open': gitLogOpen }">
        <!-- 当前更改 (工作区折叠组) -->
        <div class="git-local-section" :class="{ 'git-local-section--collapsed': gitLogOpen && !localChangesOpen }">
          <button
            v-if="gitLogOpen"
            type="button"
            class="git-local-toggle"
            @click="emit('update:gitLocalChangesOpen', !localChangesOpen)"
          >
            <span class="git-section-chevron">{{ localChangesOpen ? "▾" : "▸" }}</span>
            <span>当前更改</span>
            <span v-if="gitStatus.length > 0" class="git-local-count-badge">{{ gitStatus.length }}</span>
          </button>

          <div
            v-show="!gitLogOpen || localChangesOpen"
            class="git-local-content"
            :class="{ 'git-local-content--batch-open': batchSectionOpen }"
          >
            <div v-show="!batchSectionOpen">
              <GitCommitBox
                :message="gitCommitMessage"
                :committing="gitCommitting"
                :gen-step="gitGenStep"
                :ai-push-step="gitAiPushStep"
                :staged-count="gitStagedFiles.length"
                :config-ready="configReady"
                :can-commit="canGitCommit"
                :conflict-count="0"
                :loading="gitLoading"
                :advanced-action="null"
                @update:message="$emit('update:gitCommitMessage', $event)"
                @commit="$emit('commit-git')"
                @generate-message="$emit('generate-commit-message')"
                @ai-push="$emit('ai-commit-and-push')"
              />
            </div>
            <div
              v-show="!batchSectionOpen"
              class="git-changes-wrap"
              :class="{ 'git-changes-wrap--compact': !hasExpandedFileList }"
            >
              <div v-if="!gitStatus.length" class="git-changes-empty">
                <span class="git-changes-empty-icon" aria-hidden="true">✓</span>
                <span>工作区干净，无本地改动</span>
              </div>
              <template v-else>
                <div v-if="gitStagedFiles.length" class="git-section">
                  <div class="git-section-head">
                    <button type="button" class="git-section-toggle" @click="$emit('update:gitStagedOpen', !gitStagedOpen)">
                      <span class="git-section-chevron">{{ gitStagedOpen ? "▾" : "▸" }}</span>
                      <span class="git-section-title">已暂存 ({{ gitStagedFiles.length }})</span>
                    </button>
                    <button type="button" class="ghost tiny" @click="$emit('unstage-all')">取消全部</button>
                  </div>
                </div>
                <div v-if="gitUnstagedFiles.length" class="git-section">
                  <div class="git-section-head">
                    <button type="button" class="git-section-toggle" @click="$emit('update:gitUnstagedOpen', !gitUnstagedOpen)">
                      <span class="git-section-chevron">{{ gitUnstagedOpen ? "▾" : "▸" }}</span>
                      <span class="git-section-title">未暂存 ({{ gitUnstagedFiles.length }})</span>
                    </button>
                    <div class="git-section-actions">
                      <button type="button" class="ghost tiny" @click="$emit('stage-all')">全部暂存</button>
                      <button type="button" class="ghost tiny danger" @click="$emit('discard-all', $event)">丢弃全部</button>
                    </div>
                  </div>
                </div>
                <div
                  v-if="hasExpandedFileList"
                  class="git-changes-list-scroll"
                >
                  <div v-if="gitStagedFiles.length && gitStagedOpen" class="git-file-list">
                    <GitFileTreeNode
                      v-for="node in gitStagedTree"
                      :key="node.path"
                      :node="node"
                      staged
                      :expanded-dirs="gitTreeExpandedDirs"
                      :selected-git-files="selectedGitFiles"
                      :git-diff-loading-key="gitDiffLoadingKey"
                      @toggle-dir="toggleGitTreeDir"
                      @unstage-file="$emit('unstage-file', $event)"
                      @pointer-down="(event, path, isStaged) => $emit('on-git-file-pointer-down', event, path, isStaged)"
                      @contextmenu="(event, path) => $emit('on-git-file-contextmenu', event, path)"
                      @open-file="(path) => $emit('open-file', path)"
                    />
                  </div>
                  <div v-if="gitUnstagedFiles.length && gitUnstagedOpen" class="git-file-list">
                    <GitFileTreeNode
                      v-for="node in gitUnstagedTree"
                      :key="`unstaged:${node.path}`"
                      :node="node"
                      :staged="false"
                      :expanded-dirs="gitTreeExpandedDirs"
                      :selected-git-files="selectedGitFiles"
                      :git-diff-loading-key="gitDiffLoadingKey"
                      @toggle-dir="toggleGitTreeDir"
                      @stage-file="$emit('stage-file', $event)"
                      @discard-file="(path, event) => $emit('discard-file', path, event)"
                      @pointer-down="(event, path, isStaged) => $emit('on-git-file-pointer-down', event, path, isStaged)"
                      @contextmenu="(event, path) => $emit('on-git-file-contextmenu', event, path)"
                      @open-file="(path) => $emit('open-file', path)"
                    />
                  </div>
                </div>
              </template>
            </div>
            <div
              v-if="batchGroups && batchGroups.length > 0"
              class="git-batch-section git-section-card"
              :class="{
                'git-batch-section--open': batchSectionOpen,
                'git-batch-section--grouping': aiBatchGrouping,
                'git-batch-section--ai': batchGroupsFromAi,
              }"
            >
              <div class="git-section-head git-batch-head">
                <button
                  type="button"
                  class="git-section-toggle git-batch-toggle"
                  @click="$emit('update:batchSectionOpen', !batchSectionOpen)"
                >
                  <span class="git-section-chevron">{{ batchSectionOpen ? "▾" : "▸" }}</span>
                  <span class="git-section-title">分批提交</span>
                  <span class="git-batch-count">{{ batchGroups.length }}</span>
                  <span v-if="batchGroupsFromAi" class="git-batch-ai-tag">AI</span>
                </button>
                <button
                  type="button"
                  class="secondary small git-ai-batch-btn"
                  :class="{ 'git-ai-batch-btn--loading': aiBatchGrouping }"
                  :disabled="aiBatchGrouping || batchCommittingIndex !== null || !configReady"
                  :title="!configReady ? '请先配置 AI 模型' : 'AI 按功能模块智能分组'"
                  @click="$emit('ai-batch-groups')"
                >
                  <span v-if="aiBatchGrouping" class="panel-loading-spinner git-ai-batch-spinner" aria-hidden="true" />
                  {{ aiBatchGrouping ? (aiBatchGroupingStep || "分析中…") : "AI 划分" }}
                </button>
              </div>
              <p v-if="!batchSectionOpen" class="git-batch-collapsed-hint">
                {{ batchTotalFiles }} 个文件 · {{ batchReadyCount }}/{{ batchGroups.length }} 组已填写说明
              </p>
              <div v-if="batchSectionOpen" class="git-batch-body">
                <div v-if="aiBatchGrouping" class="git-batch-loading">
                  <span class="panel-loading-spinner git-batch-loading-spinner" aria-hidden="true" />
                  <span class="git-batch-loading-text">{{ aiBatchGroupingStep || "正在分析文件变更…" }}</span>
                </div>
                <div class="git-batch-toolbar">
                  <span class="git-batch-toolbar-hint">
                    {{ batchTotalFiles }} 个文件 · {{ batchReadyCount }}/{{ batchGroups.length }} 组就绪
                  </span>
                  <button
                    type="button"
                    class="small git-batch-all-btn"
                    :class="canCommitAllBatches ? 'primary' : 'secondary'"
                    :disabled="batchCommittingIndex !== null || !canCommitAllBatches"
                    :title="canCommitAllBatches ? '按顺序提交全部分组' : (!batchGroupsFromAi ? '请先进行 AI 划分再全部提交' : '请先为每组填写提交说明')"
                    @click="$emit('commit-all-batches', [...batchMessages])"
                  >
                    <template v-if="batchCommittingIndex !== null">
                      提交中 {{ batchCommittingIndex + 1 }}/{{ batchGroups.length }}…
                    </template>
                    <template v-else>
                      全部提交
                    </template>
                  </button>
                </div>
                <div
                  v-if="batchCommittingIndex !== null"
                  class="git-batch-progress"
                  role="progressbar"
                  :aria-valuenow="batchCommittingIndex + 1"
                  :aria-valuemin="1"
                  :aria-valuemax="batchGroups.length"
                >
                  <div
                    class="git-batch-progress-bar"
                    :style="{ width: `${((batchCommittingIndex + 1) / batchGroups.length) * 100}%` }"
                  />
                </div>
                <div class="git-batch-groups">
                  <div
                    v-for="(group, i) in batchGroups"
                    :key="`${group.dir}-${i}`"
                    class="git-batch-group"
                    :class="{
                      'git-batch-group--busy': batchCommittingIndex === i,
                      'git-batch-group--done': batchCommittingIndex !== null && batchCommittingIndex > i,
                      'git-batch-group--ready': !!batchMessages[i]?.trim(),
                    }"
                    :style="{ '--batch-accent': batchGroupAccent(i) }"
                  >
                    <div class="git-batch-group-header">
                      <span class="git-batch-group-index">{{ i + 1 }}</span>
                      <span class="git-batch-group-dir" :title="batchGroupTitle(group)">{{ batchGroupTitle(group) }}</span>
                      <span class="git-batch-group-count">{{ group.files.length }} 文件</span>
                      <span v-if="batchCommittingIndex === i" class="git-batch-group-status">提交中</span>
                      <span v-else-if="!batchMessages[i]?.trim()" class="git-batch-group-status git-batch-group-status--warn">待填写</span>
                    </div>
                    <div class="git-batch-group-files">
                      <div
                        v-for="f in visibleBatchFiles(group, i)"
                        :key="f.path"
                        class="git-batch-file"
                        :title="f.path"
                      >
                        <span class="git-file-status" :class="gitStatusClass(f.status)">{{ gitStatusIcon(f.status) }}</span>
                        <span class="git-file-path" :title="f.path">
                          <span class="git-file-path-name">{{ splitGitFilePath(f.path).name }}</span>
                          <span v-if="splitGitFilePath(f.path).dir" class="git-file-path-dir">{{ splitGitFilePath(f.path).dir }}</span>
                        </span>
                      </div>
                    </div>
                    <button
                      v-if="group.files.length > BATCH_FILES_PREVIEW"
                      type="button"
                      class="git-batch-files-toggle"
                      @click="toggleBatchGroupFiles(i)"
                    >
                      {{ isBatchGroupExpanded(i) ? "收起文件列表" : `展开其余 ${group.files.length - BATCH_FILES_PREVIEW} 个文件` }}
                    </button>
                    <div class="git-batch-group-commit">
                      <textarea
                        :value="batchMessages[i]"
                        class="git-batch-msg-input"
                        rows="2"
                        placeholder="提交说明…"
                        :disabled="batchCommittingIndex !== null"
                        @input="onBatchMessageInput(i, ($event.target as HTMLTextAreaElement).value)"
                      />
                      <button
                        type="button"
                        class="small git-batch-commit-btn"
                        :class="batchMessages[i]?.trim() ? 'primary' : 'secondary'"
                        :disabled="batchCommittingIndex !== null || !batchMessages[i]?.trim()"
                        @click="$emit('commit-batch-group', i, batchMessages[i] || '')"
                      >
                        {{ batchCommittingIndex === i ? "提交中…" : "提交" }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="git-log-section git-section-card" :class="{ 'git-log-section--open': gitLogOpen }">
          <button type="button" class="git-log-toggle" @click="$emit('update:gitLogOpen', !gitLogOpen)">
            <span class="git-section-chevron">{{ gitLogOpen ? "▾" : "▸" }}</span>
            <span>提交历史</span>
            <span v-if="gitLogEntries.length" class="git-log-section-count">{{ gitLogEntries.length }}</span>
          </button>
          <!-- Git 历史搜索框 -->
          <div
            v-if="gitLogOpen"
            class="git-log-search-container"
            :class="{ 'git-log-search-container--loading': gitLogSearchActive }"
          >
            <span v-if="gitLogSearchActive" class="panel-loading-spinner git-log-search-spinner" aria-hidden="true" />
            <span v-else class="git-log-search-icon">🔍</span>
            <input
              type="text"
              class="git-log-search-input"
              placeholder="搜索提交信息、哈希或作者..."
              v-model="searchVal"
              :disabled="gitLogSearchLoading"
              @keyup.enter="$emit('search-git-log', searchVal)"
            />
            <button
              v-if="searchVal && !gitLogSearchActive"
              type="button"
              class="git-log-search-clear"
              @click="clearSearch"
              title="清除搜索"
            >
              ✕
            </button>
          </div>

          <div
            v-if="gitLogOpen"
            class="git-log-list"
            :class="{ 'git-log-list--searching': gitLogSearchLoading }"
            @scroll="handleLogScroll"
          >
            <div v-if="gitLogSearchLoading && !gitLogEntries.length" class="git-log-searching-hint">
              <span class="panel-loading-spinner git-log-search-hint-spinner" aria-hidden="true" />
              <span>正在搜索…</span>
            </div>
            <div v-else-if="!gitLogEntries.length" class="git-log-empty">
              {{ gitLogSearchQuery ? "未找到匹配的提交记录" : "无历史" }}
            </div>
            <div v-for="entry in gitLogEntries" :key="entry.hash" class="git-log-item" @contextmenu="onGitLogContextMenu($event, entry)">
              <button type="button" class="git-log-entry-head" @click="$emit('toggle-git-log-entry', entry.hash)">
                <span class="git-log-chevron">{{ isGitLogEntryOpen(entry.hash) ? "▾" : "▸" }}</span>
                <span class="git-log-hash">{{ entry.shortHash }}</span>
                <span v-if="entry.refs && entry.refs.length" class="git-log-refs">
                  <span
                    v-for="ref in entry.refs"
                    :key="ref.name"
                    class="git-log-ref"
                    :class="'git-log-ref--' + ref.type"
                    :title="ref.type + ': ' + ref.name"
                  >
                    <span v-if="ref.type === 'tag'" class="git-ref-icon">🏷️</span>
                    <span v-else-if="ref.type === 'head'" class="git-ref-icon">⎇</span>
                    {{ ref.name }}
                  </span>
                </span>
                <span class="git-log-msg" :title="entry.message">{{ entry.message }}</span>
                <span class="git-log-date" :title="entry.date">{{ formatDate(entry.date) }}</span>
                <span class="git-log-count">{{ entry.files.length }}</span>
              </button>
              <div v-if="isGitLogEntryOpen(entry.hash)" class="git-log-detail">
                <div class="git-log-meta-expanded">
                  <span class="git-log-meta-item"><span class="git-log-meta-label">作者:</span> {{ entry.author }}</span>
                  <span class="git-log-meta-item"><span class="git-log-meta-label">日期:</span> {{ formatFullDate(entry.date) }}</span>
                </div>
                <div v-if="entry.message.includes('\n')" class="git-log-full-msg">{{ entry.message }}</div>
                <div class="git-log-files">
                  <button
                    v-for="file in entry.files"
                    :key="`${entry.hash}:${file.oldPath || ''}:${file.path}`"
                    type="button"
                    class="git-log-file"
                    :class="{ loading: gitDiffLoadingKey === gitHistoryDiffKey(entry.hash, file.path, file.oldPath) }"
                    :title="file.oldPath ? `${file.oldPath} → ${file.path}` : file.path"
                    @click="$emit('open-git-log-file', entry, file)"
                  >
                    <span class="git-file-status" :class="gitStatusClass(file.status)">
                      {{ gitStatusIcon(file.status) }}
                    </span>
                    <span class="git-file-path">{{ file.oldPath ? `${file.oldPath} → ${file.path}` : file.path }}</span>
                  </button>
                </div>
              </div>
            </div>
            <!-- 加载更多按钮 -->
            <div v-if="gitLogEntries.length && hasMoreGitLog" class="git-log-more-container">
              <button
                type="button"
                class="secondary small git-log-more-btn"
                :disabled="gitLogLoadingMore"
                @click="$emit('load-more-git-log')"
              >
                <span v-if="gitLogLoadingMore" class="panel-loading-spinner git-log-more-spinner" aria-hidden="true" />
                {{ gitLogLoadingMore ? "正在加载…" : "加载更多" }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else-if="gitError" class="panel-empty git-panel-fetch-error">
      <p>获取 Git 状态失败</p>
      <p class="git-fetch-error-detail">{{ gitError }}</p>
      <button type="button" class="secondary small" @click="$emit('refresh')">重试</button>
    </div>
    <div v-else-if="gitStatusKnown" class="panel-empty">当前目录不是 Git 仓库</div>
    <div v-else class="panel-empty shimmer-text--fast">加载中…</div>
  </div>

  <!-- 提交历史右键菜单 -->
  <Teleport to="body">
    <div v-if="gitLogContextMenu.show" class="ctx-overlay" @click="hideGitLogContextMenu" @contextmenu.prevent="hideGitLogContextMenu">
      <div
        class="ctx-menu git-log-ctx-menu"
        :style="{ left: gitLogContextMenu.x + 'px', top: gitLogContextMenu.y + 'px' }"
        @click.stop
      >
        <button type="button" class="ctx-item" @click="gitLogCtxCopyHash">复制提交哈希</button>
        <div class="ctx-sep" />
        <button type="button" class="ctx-item" @click="gitLogCtxCherryPick">拣选 (cherry-pick)</button>
        <button type="button" class="ctx-item" @click="gitLogCtxRevert">还原 (revert)</button>
        <div class="ctx-sep" />
        <button type="button" class="ctx-item" @click="gitLogCtxReset('soft')">重置到此提交 (soft)</button>
        <button type="button" class="ctx-item" @click="gitLogCtxReset('mixed')">重置到此提交 (mixed)</button>
        <button type="button" class="ctx-item" @click="gitLogCtxReset('hard')">重置到此提交 (hard)</button>
        <div class="ctx-sep" />
        <button type="button" class="ctx-item" @click="gitLogCtxCreateTag">在此创建标签</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from "vue";
import type { GitRemoteInfo, GitBranchInfo } from "../../services/vibeGitClient";
import type { BatchGroup } from "../../composables/useGitPanel";
import GitFileTreeNode from "./GitFileTreeNode.vue";
import GitAheadCommits from "./GitAheadCommits.vue";
import GitStashPanel from "./GitStashPanel.vue";
import GitCommitBox from "./GitCommitBox.vue";
import { buildGitFileTree, collectGitFolderPaths } from "../../utils/gitFileTree";

interface GitStash {
  index: number | string;
  message: string;
}

interface GitFile {
  path: string;
  status: string;
  staged: boolean;
}

interface GitRef {
  name: string;
  type: "head" | "local" | "remote" | "tag" | "other";
}

interface GitLogEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
  files: GitLogFile[];
  refs?: GitRef[];
}

interface GitLogFile {
  path: string;
  oldPath?: string;
  status: string;
}

interface Props {
  projectOpened: boolean;
  gitLoading: boolean;
  gitIsRepo: boolean;
  gitStatusKnown: boolean;
  gitError: string;
  gitBranch: string;
  gitBranches: GitBranchInfo[];
  gitTrackingBranch: string;
  gitRemotes: GitRemoteInfo[];
  gitAhead: number;
  gitBehind: number;
  gitStashes: GitStash[];
  gitStatus: unknown[];
  gitStagedFiles: GitFile[];
  gitUnstagedFiles: GitFile[];
  canGitCommit: boolean;
  gitCommitMessage: string;
  gitCommitting: boolean;
  gitGenStep: string;
  gitAiPushStep: string;
  gitStashAction: string;
  gitStashMessage: string;
  gitStashOpen: boolean;
  gitStagedOpen: boolean;
  gitUnstagedOpen: boolean;
  gitLogOpen: boolean;
  gitLogEntries: GitLogEntry[];
  gitLogSearchQuery: string;
  selectedGitFiles: string[];
  gitDiffLoadingKey: string;
  gitRemoteAction: string;
  configReady: boolean;
  fileWatcherActive: boolean;
  fileWatcherConnected: boolean;
  expandedGitLogEntries: Set<string>;
  batchGroups?: BatchGroup[];
  batchGroupsFromAi?: boolean;
  batchMessages: string[];
  batchSectionOpen: boolean;
  batchCommittingIndex: number | null;
  aiBatchGrouping: boolean;
  aiBatchGroupingStep: string;
  gitAheadCommits: GitLogEntry[];
  gitAheadCommitsOpen: boolean;
  gitAheadCommitsLoading: boolean;
  hasMoreGitLog: boolean;
  gitLogLoadingMore: boolean;
  gitLogSearchLoading: boolean;
  gitLocalChangesOpen: boolean;
  gitStashSectionOpen: boolean;
}

const props = defineProps<Props>();

const stashSectionOpen = computed(() => props.gitStashSectionOpen);
const localChangesOpen = computed(() => props.gitLocalChangesOpen);
const gitTreeExpandedDirs = ref<Set<string>>(new Set());

const emit = defineEmits<{
  (e: "refresh"): void;
  (e: "do-fetch"): void;
  (e: "do-pull"): void;
  (e: "do-push"): void;
  (e: "commit-git"): void;
  (e: "generate-commit-message"): void;
  (e: "ai-commit-and-push"): void;
  (e: "stage-file", path: string): void;
  (e: "unstage-file", path: string): void;
  (e: "stage-all"): void;
  (e: "unstage-all"): void;
  (e: "discard-file", path: string, event: MouseEvent): void;
  (e: "discard-all", event: MouseEvent): void;
  (e: "do-stash-save"): void;
  (e: "do-stash-apply", index: number): void;
  (e: "do-stash-drop", index: number): void;
  (e: "update:gitStashOpen", value: boolean): void;
  (e: "update:gitStagedOpen", value: boolean): void;
  (e: "update:gitUnstagedOpen", value: boolean): void;
  (e: "update:gitLogOpen", value: boolean): void;
  (e: "update:gitAheadCommitsOpen", value: boolean): void;
  (e: "update:gitCommitMessage", value: string): void;
  (e: "update:gitStashMessage", value: string): void;
  (e: "toggle-git-log-entry", hash: string): void;
  (e: "open-git-log-file", entry: GitLogEntry, file: GitLogFile): void;
  (e: "open-file", path: string): void;
  (e: "on-git-file-pointer-down", event: PointerEvent, path: string, staged: boolean): void;
  (e: "on-git-file-contextmenu", event: MouseEvent, path: string): void;
  (e: "do-cherry-pick", hash: string): void;
  (e: "do-revert-commit", hash: string): void;
  (e: "do-create-tag-at", hash: string): void;
  (e: "reset-to-commit", hash: string, mode: string, shortHash: string): void;
  (e: "commit-batch-group", index: number, message: string): void;
  (e: "commit-all-batches", messages: string[]): void;
  (e: "ai-batch-groups"): void;
  (e: "update:batchMessages", messages: string[]): void;
  (e: "update:batchSectionOpen", open: boolean): void;
  (e: "update:gitLocalChangesOpen", open: boolean): void;
  (e: "update:gitStashSectionOpen", open: boolean): void;
  (e: "load-more-git-log"): void;
  (e: "search-git-log", query: string): void;
  (e: "checkout-branch", branchName: string): void;
  (e: "create-branch", branchName: string): void;
  (e: "delete-branch", branchName: string): void;
}>();

const gitStagedTree = computed(() => buildGitFileTree(props.gitStagedFiles));
const gitUnstagedTree = computed(() => buildGitFileTree(props.gitUnstagedFiles));

const hasExpandedFileList = computed(
  () =>
    (props.gitStagedOpen && props.gitStagedFiles.length > 0)
    || (props.gitUnstagedOpen && props.gitUnstagedFiles.length > 0),
);

function toggleGitTreeDir(path: string) {
  const next = new Set(gitTreeExpandedDirs.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  gitTreeExpandedDirs.value = next;
}

watch(
  () => [
    props.gitStagedFiles.map((f) => f.path).join("\n"),
    props.gitUnstagedFiles.map((f) => f.path).join("\n"),
  ],
  () => {
    const folderPaths = new Set([
      ...collectGitFolderPaths(gitStagedTree.value),
      ...collectGitFolderPaths(gitUnstagedTree.value),
    ]);
    const next = new Set(gitTreeExpandedDirs.value);
    for (const path of folderPaths) next.add(path);
    for (const path of next) {
      if (!folderPaths.has(path)) next.delete(path);
    }
    gitTreeExpandedDirs.value = next;
  },
  { immediate: true },
);

const BATCH_FILES_PREVIEW = 4;
const BATCH_GROUP_ACCENTS = ["#58a6ff", "#3fb950", "#d29922", "#bc8cff", "#f778ba", "#79c0ff"];

const expandedBatchGroups = ref<Set<number>>(new Set());

const batchTotalFiles = computed(() =>
  (props.batchGroups ?? []).reduce((sum, g) => sum + g.files.length, 0),
);

const batchReadyCount = computed(() =>
  props.batchMessages.filter((m) => m?.trim()).length,
);

const canCommitAllBatches = computed(() => {
  const n = props.batchGroups?.length ?? 0;
  if (!n || props.batchCommittingIndex !== null) return false;
  if (!props.batchGroupsFromAi) return false;
  return props.batchMessages.length === n && props.batchMessages.every((m) => m?.trim());
});

function batchGroupTitle(group: BatchGroup): string {
  return props.batchGroupsFromAi ? group.dir : `${group.dir}/`;
}

function batchGroupAccent(index: number): string {
  return BATCH_GROUP_ACCENTS[index % BATCH_GROUP_ACCENTS.length];
}

function isBatchGroupExpanded(index: number): boolean {
  return expandedBatchGroups.value.has(index);
}

function toggleBatchGroupFiles(index: number) {
  const next = new Set(expandedBatchGroups.value);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  expandedBatchGroups.value = next;
}

function visibleBatchFiles(group: BatchGroup, index: number) {
  if (isBatchGroupExpanded(index) || group.files.length <= BATCH_FILES_PREVIEW) {
    return group.files;
  }
  return group.files.slice(0, BATCH_FILES_PREVIEW);
}

watch(
  () => props.batchGroups?.map((g) => `${g.dir}:${g.files.length}`).join("|"),
  () => {
    expandedBatchGroups.value = new Set();
  },
);

watch(
  () => props.gitLogOpen,
  (open) => {
    if (open) {
      emit("update:gitStashSectionOpen", false);
      emit("update:batchSectionOpen", false);
      emit("update:gitLocalChangesOpen", false);
    }
  },
);

watch(
  () => props.gitLocalChangesOpen,
  (open) => {
    if (open) {
      emit("update:gitLogOpen", false);
    }
  },
);

function onBatchMessageInput(index: number, value: string) {
  const next = [...props.batchMessages];
  next[index] = value;
  emit("update:batchMessages", next);
}

const searchVal = ref(props.gitLogSearchQuery || "");
const searchPending = ref(false);
let searchTimeout: ReturnType<typeof setTimeout> | null = null;

const gitLogSearchActive = computed(() => searchPending.value || props.gitLogSearchLoading);

watch(() => props.gitLogSearchQuery, (val) => {
  const next = val || "";
  if (searchVal.value !== next) {
    searchVal.value = next;
  }
});

watch(() => props.gitLogSearchLoading, (loading) => {
  if (!loading) searchPending.value = false;
});

watch(searchVal, (newVal) => {
  const trimmed = newVal.trim();
  if (trimmed === (props.gitLogSearchQuery || "")) {
    searchPending.value = false;
    return;
  }
  searchPending.value = true;
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }
  searchTimeout = setTimeout(() => {
    emit("search-git-log", newVal);
  }, 300);
});

function clearSearch() {
  searchPending.value = false;
  searchVal.value = "";
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }
  emit("search-git-log", "");
}

onUnmounted(() => {
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }
});

function isGitLogEntryOpen(hash: string): boolean {
  return props.expandedGitLogEntries.has(hash);
}

function gitWorkingTreeDiffKey(path: string, staged: boolean): string {
  return `${staged ? 'staged' : 'unstaged'}:${path}`;
}

function gitHistoryDiffKey(hash: string, path: string, oldPath?: string): string {
  return `history:${hash}:${oldPath || ''}:${path}`;
}

function splitGitFilePath(filePath: string): { dir: string; name: string } {
  const normalized = filePath.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  if (slash === -1) return { dir: "", name: normalized };
  return { dir: normalized.slice(0, slash), name: normalized.slice(slash + 1) };
}

function gitStatusIcon(status: string): string {
  switch (status) {
    case "A":
    case "added": return "A";
    case "M":
    case "modified": return "M";
    case "D":
    case "deleted": return "D";
    case "R":
    case "renamed": return "R";
    case "C":
    case "copied": return "C";
    default: return "?";
  }
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "刚刚";
    if (diffMins < 60) return `${diffMins}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    if (diffDays < 7) return `${diffDays}天前`;

    return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

function formatFullDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function handleLogScroll(event: Event) {
  const target = event.target as HTMLElement;
  if (!target) return;
  const threshold = 25;
  const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight <= threshold;
  if (isAtBottom && props.hasMoreGitLog && !props.gitLogLoadingMore && !props.gitLogSearchLoading) {
    emit("load-more-git-log");
  }
}

function gitTrackingShortName(): string {
  return props.gitTrackingBranch.replace(/^[^/]+\//, "");
}

const branchDropdownOpen = ref(false);
const branchSearchQuery = ref("");
const newBranchName = ref("");

const filteredLocalBranches = computed(() => {
  const query = branchSearchQuery.value.toLowerCase().trim();
  const locals = props.gitBranches.filter(b => !b.isRemote);
  if (!query) return locals;
  return locals.filter(b => b.name.toLowerCase().includes(query));
});

const filteredRemoteBranches = computed(() => {
  const query = branchSearchQuery.value.toLowerCase().trim();
  const remotes = props.gitBranches.filter(b => b.isRemote);
  if (!query) return remotes;
  return remotes.filter(b => b.name.toLowerCase().includes(query));
});

function toggleBranchDropdown() {
  branchDropdownOpen.value = !branchDropdownOpen.value;
  if (branchDropdownOpen.value) {
    branchSearchQuery.value = "";
    newBranchName.value = "";
  }
}

function handleSelectBranch(branch: GitBranchInfo) {
  emit("checkout-branch", branch.name);
  branchDropdownOpen.value = false;
}

function handleCreateBranch() {
  const name = newBranchName.value.trim();
  if (!name) return;
  emit("create-branch", name);
  newBranchName.value = "";
  branchDropdownOpen.value = false;
}

function handleDeleteBranch(branchName: string, event: Event) {
  event.stopPropagation();
  emit("delete-branch", branchName);
}

// --- 提交历史右键菜单 ---
interface GitLogCtxMenu {
  show: boolean;
  x: number;
  y: number;
  hash: string;
  shortHash: string;
}

const gitLogContextMenu = ref<GitLogCtxMenu>({ show: false, x: 0, y: 0, hash: "", shortHash: "" });

function onGitLogContextMenu(event: MouseEvent, entry: GitLogEntry) {
  event.preventDefault();
  const menuW = 200;
  const menuH = 200;
  const clampedX = Math.min(event.clientX, window.innerWidth - menuW);
  const clampedY = Math.min(event.clientY, window.innerHeight - menuH);
  gitLogContextMenu.value = {
    show: true,
    x: Math.max(0, clampedX),
    y: Math.max(0, clampedY),
    hash: entry.hash,
    shortHash: entry.shortHash,
  };
}

function hideGitLogContextMenu() {
  gitLogContextMenu.value.show = false;
}

function gitLogCtxCherryPick() {
  const h = gitLogContextMenu.value.hash;
  hideGitLogContextMenu();
  if (h) emit("do-cherry-pick", h);
}

function gitLogCtxRevert() {
  const h = gitLogContextMenu.value.hash;
  hideGitLogContextMenu();
  if (h) emit("do-revert-commit", h);
}

function gitLogCtxCreateTag() {
  const h = gitLogContextMenu.value.hash;
  hideGitLogContextMenu();
  if (h) emit("do-create-tag-at", h);
}

function gitLogCtxReset(mode: string) {
  const h = gitLogContextMenu.value.hash;
  const s = gitLogContextMenu.value.shortHash;
  hideGitLogContextMenu();
  if (h) emit("reset-to-commit", h, mode, s);
}

function gitLogCtxCopyHash() {
  const h = gitLogContextMenu.value.hash;
  hideGitLogContextMenu();
  if (h) navigator.clipboard.writeText(h);
}

const branchSelectorRef = ref<HTMLElement | null>(null);
function handleGlobalClick(event: MouseEvent) {
  if (
    branchDropdownOpen.value &&
    branchSelectorRef.value &&
    !branchSelectorRef.value.contains(event.target as Node)
  ) {
    branchDropdownOpen.value = false;
  }
}

onMounted(() => {
  window.addEventListener("click", handleGlobalClick, true);
});

onUnmounted(() => {
  window.removeEventListener("click", handleGlobalClick, true);
});

function gitStatusClass(status: string): string {
  switch (status) {
    case "A":
    case "added": return "git-status-added";
    case "M":
    case "modified": return "git-status-modified";
    case "D":
    case "deleted": return "git-status-deleted";
    case "R":
    case "renamed":
    case "C":
    case "copied": return "git-status-renamed";
    default: return "git-status-unknown";
  }
}
</script>

<style src="./styles/GitPanel.scss" scoped></style>
