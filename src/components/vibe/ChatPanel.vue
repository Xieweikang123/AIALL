<template>
  <aside
    ref="chatDropZoneRef"
    class="chat-panel"
    :class="{ 'chat-expanded': editorCollapsed, 'drag-over': isDragging }"
    aria-label="AI 助手"
    @dragenter="$emit('on-chat-drag-enter', $event)"
    @dragover="$emit('on-chat-drag-over', $event)"
    @dragleave="$emit('on-chat-drag-leave', $event)"
    @drop="$emit('on-chat-drop', $event)"
    :style="panelStyle"
  >
    <div class="panel-head">
      <div class="panel-head-left">
        <div class="chat-head-brand">
          <span class="chat-head-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
              <path d="M12 12 4 7.5m8 4.5 8-4.5M12 12v9" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
            </svg>
          </span>
          <div class="chat-head-text">
            <span class="panel-label">AI 助手</span>
            <div class="session-picker-row">
              <button
                v-if="sessionList.length > 1"
                type="button"
                class="session-nav-btn"
                :disabled="!projectOpened || !canSwitchToNewerSession"
                title="较新的会话 (Ctrl+Alt+↑)"
                @click="$emit('switch-to-adjacent-session', -1)"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M10 3 5 8l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <button
                type="button"
                class="session-picker-title-btn"
                :title="activeSessionTitle || '新会话'"
                @click="$emit('open-session-list')"
              >{{ activeSessionTitle || "新会话" }}</button>
              <button
                v-if="activeSessionId"
                type="button"
                class="session-nav-btn"
                title="复制会话名和路径"
                @click.stop="$emit('copy-session-name-path', sessionList.find(s => s.id === activeSessionId))"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <rect x="5.5" y="5.5" width="7" height="8" rx="1" stroke="currentColor" stroke-width="1.2"/>
                  <path d="M4.5 10.5V3.3A1.8 1.8 0 0 1 6.3 1.5H11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                </svg>
              </button>
              <button
                v-if="sessionList.length > 1"
                type="button"
                class="session-nav-btn"
                :disabled="!projectOpened || !canSwitchToOlderSession"
                title="较旧的会话 (Ctrl+Alt+↓)"
                @click="$emit('switch-to-adjacent-session', 1)"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
      <div class="panel-head-right">
        <span
          v-if="chatStoreSyncMessage"
          class="session-copy-hint"
          role="status"
          aria-live="polite"
        >{{ chatStoreSyncMessage }}</span>
        <button
          type="button"
          class="config-status-btn"
          :class="{ warn: !configReady || !apiKeyReady }"
          :title="aiConfigStatusText"
          :aria-label="aiConfigStatusText"
          @click="$emit('open-ai-config')"
        >
          <svg v-if="configReady && apiKeyReady" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.3"/>
            <path d="M5.5 8.2 7.2 9.8 10.6 6" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <svg v-else width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 2.8 14 13.2H2L8 2.8Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
            <path d="M8 6.5v3.2M8 11.4h.01" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>
          </svg>
        </button>
        <div ref="headMenuRef" class="panel-head-menu">
          <button
            type="button"
            class="icon panel-more-btn"
            :class="{ open: headMenuOpen }"
            aria-label="更多操作"
            title="更多操作"
            aria-haspopup="menu"
            :aria-expanded="headMenuOpen"
            @click="toggleHeadMenu"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="3.5" cy="8" r="1.2" fill="currentColor"/>
              <circle cx="8" cy="8" r="1.2" fill="currentColor"/>
              <circle cx="12.5" cy="8" r="1.2" fill="currentColor"/>
            </svg>
          </button>
          <Teleport to="body">
            <div
              v-if="headMenuOpen"
              class="panel-head-dropdown"
              role="menu"
              :style="{ top: headMenuTop + 'px', right: headMenuRight + 'px' }"
            >
              <button
                type="button"
                class="panel-head-menu-item"
                role="menuitem"
                :class="{ active: projectMemoryHasContent }"
                :disabled="!projectOpened"
                @click="onHeadMenuAction('memory')"
              >
                记忆
              </button>
              <button
                type="button"
                class="panel-head-menu-item"
                role="menuitem"
                :disabled="!projectOpened"
                @click="onHeadMenuAction('new-session')"
              >
                新会话
                <span class="panel-head-menu-hint">Ctrl+Shift+N</span>
              </button>
              <button
                v-if="chatMessages.length"
                type="button"
                class="panel-head-menu-item danger"
                role="menuitem"
                :disabled="chatSending"
                @click="onHeadMenuAction('clear')"
              >
                清空会话
              </button>
            </div>
          </Teleport>
        </div>
        <span class="panel-head-divider" aria-hidden="true" />
        <button
          type="button"
          class="icon panel-fold-btn"
          aria-label="收起 AI 助手"
          title="收起 AI 助手"
          @click="$emit('collapse-chat')"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M5.5 3.5 10 8l-4.5 4.5M8.5 3.5 13 8l-4.5 4.5"
              stroke="currentColor"
              stroke-width="1.35"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>

    <div class="chat-scroll-wrap">
      <div ref="chatScrollRef" class="chat-scroll" @scroll="onScroll">
      <div v-if="switchingProject" class="chat-switching">
        <span class="chat-switching-spinner" aria-hidden="true">⟳</span>
        <span class="shimmer-text--fast">正在加载项目…</span>
      </div>
      <div v-else-if="switchingSession" class="chat-switching">
        <span class="chat-switching-spinner" aria-hidden="true">⟳</span>
        <span class="shimmer-text--fast">正在加载会话…</span>
      </div>
      <div v-else-if="!chatMessages.length" class="chat-empty">
        <div class="chat-empty-visual" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.2" opacity="0.35" />
            <path d="M8 10h8M8 14h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.5" />
          </svg>
        </div>
        <template v-if="!projectOpened">
          <p class="chat-empty-title">先打开项目</p>
          <p class="chat-empty-desc">选择本地文件夹后，即可在此提问或让 Agent 改代码。</p>
          <button type="button" class="chat-empty-action" @click="$emit('open-project')">打开项目</button>
        </template>
        <template v-else-if="!configReady || !apiKeyReady">
          <p class="chat-empty-title">先配置模型</p>
          <p class="chat-empty-desc">{{ !configReady ? "前往 AI 配置填写接口与模型。" : "模型已选，请保存 API Key 后再发送。" }}</p>
          <button type="button" class="chat-empty-action" @click="$emit('open-ai-config')">去配置</button>
        </template>
        <template v-else>
          <p class="chat-empty-title">描述你要改什么</p>
          <p class="chat-empty-desc">直接输入需求即可。可用 <code>@</code> 引用文件。</p>
          <div class="chips">
            <button type="button" class="chip" :disabled="chatSending" @click="$emit('apply-example', '解释这个项目是做什么的')">
              解释项目
            </button>
            <button type="button" class="chip" :disabled="chatSending" @click="$emit('apply-example', '解释这段代码在做什么')">
              解释代码
            </button>
            <button type="button" class="chip" :disabled="chatSending" @click="$emit('apply-example', '帮我优化这段代码，并给出修改后的完整代码')">
              优化代码
            </button>
            <button type="button" class="chip" :disabled="chatSending" @click="$emit('apply-example', '找出潜在 bug 并修复')">
              修复 bug
            </button>
          </div>
          <p class="chat-empty-project-label">项目能力</p>
          <div class="chips">
            <button type="button" class="chip chip--ghost" :disabled="chatSending" @click="$emit('open-project-view', 'knowledge')">
              构建知识库
            </button>
            <button type="button" class="chip chip--ghost" :disabled="chatSending" @click="$emit('open-project-view', 'health')">
              跑架构评审
            </button>
            <button type="button" class="chip chip--ghost" :disabled="chatSending" @click="$emit('open-project-view', 'map')">
              生成架构图
            </button>
            <button type="button" class="chip chip--ghost" :disabled="chatSending" @click="$emit('open-project-view', 'fix')">
              扫描并修复
            </button>
          </div>
        </template>
      </div>

      <div v-else class="msg-list">
        <slot name="messages"></slot>
      </div>
      </div>

      <div class="chat-scroll-overlay" aria-hidden="true">
        <transition name="stb-fade">
          <button
            v-if="showScrollToBottom"
            type="button"
            class="scroll-to-bottom-btn"
            @click="scrollToBottom"
            title="回到最新消息"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </transition>
      </div>
    </div>

    <div v-if="pendingMemoryProposals.length || pendingSkillProposals.length" class="memory-proposal-banner">
      <div
        v-for="proposal in pendingMemoryProposals"
        :key="proposal.id"
        class="memory-proposal-item"
      >
        <span class="memory-proposal-text">
          Agent 提议写入 <strong>## {{ proposal.section }}</strong>：{{ proposal.content }}
        </span>
        <div class="memory-proposal-actions">
          <button
            type="button"
            class="ghost small"
            @click="$emit('dismiss-memory-proposal', proposal.id)"
          >
            忽略
          </button>
          <button
            type="button"
            class="primary small"
            :disabled="memorySuggestSaving"
            @click="$emit('confirm-memory-proposal', proposal.id)"
          >
            写入
          </button>
        </div>
      </div>
      <div
        v-for="proposal in pendingSkillProposals"
        :key="proposal.id"
        class="memory-proposal-item"
      >
        <span class="memory-proposal-text">
          Agent 提议 skill <strong>{{ proposal.slug }}</strong>（{{ proposal.kind }}）：{{ proposal.title }}
        </span>
        <div class="memory-proposal-actions">
          <button
            type="button"
            class="ghost small"
            @click="$emit('dismiss-skill-proposal', proposal.id)"
          >
            忽略
          </button>
          <button
            type="button"
            class="primary small"
            :disabled="memorySuggestSaving"
            @click="$emit('confirm-skill-proposal', proposal.id)"
          >
            写入
          </button>
        </div>
      </div>
    </div>

    <footer class="chat-composer">
      <div v-if="pendingPromptQueue.length" class="pending-queue">
        <div class="pending-queue-head">
          <span>待发送 {{ pendingPromptQueue.length }} 条消息</span>
          <button type="button" class="ghost small" @click="$emit('clear-pending-queue')">取消</button>
        </div>
        <ol class="pending-queue-list">
          <li v-for="(q, qi) in pendingPromptQueue" :key="qi">{{ q }}</li>
        </ol>
      </div>
      <div v-if="agentSuggestions.length && !chatSending" class="agent-suggestion-chips">
        <span class="agent-suggestion-label">建议操作</span>
        <button
          v-for="(suggestion, index) in agentSuggestions"
          :key="`${suggestion.label}-${index}`"
          type="button"
          class="chip agent-suggestion-chip"
          @click="$emit('apply-suggestion', suggestion)"
        >
          {{ suggestion.label }}
        </button>
      </div>
    <div
      v-if="quotedMessages.length"
      class="quoted-preview-stack"
    >
      <div
        v-for="(q, quoteIndex) in quotedMessages"
        :key="`${q.messageId}-${quoteIndex}`"
        class="quoted-preview"
      >
        <div class="quoted-preview-header">
          <span class="quoted-preview-label">
            <span class="quoted-preview-icon">❝</span>
            引用 {{ q.source === "plan" ? "方案" : q.source === "editor" ? (q.filePath || "代码") : (q.role === "assistant" ? "Agent" : "你") }}
          </span>
          <button type="button" class="quoted-preview-close" @click="removeQuotedMessage(quoteIndex)">×</button>
        </div>
        <div class="quoted-preview-body">{{ q.content }}</div>
      </div>
    </div>
      <div class="chat-input-field" @keydown.capture="$emit('on-composer-field-keydown', $event)">
        <div v-if="mentionOpen && mentionResults.length" class="mention-dropdown">
          <button
            v-for="(item, idx) in mentionResults"
            :key="item.path"
            type="button"
            class="mention-item"
            :class="{ active: idx === mentionActiveIndex }"
            @mousedown.prevent="$emit('select-mention', item)"
          >
            <span class="mention-item-name">{{ item.name }}</span>
            <span class="mention-item-path">{{ item.relative }}</span>
          </button>
        </div>
        <div class="chat-input-box" :class="{ focused: chatInputFocused }" @mousedown="$emit('on-chat-input-box-mousedown')">
          <slot name="composer"></slot>
        </div>
      </div>
      <div class="chat-bottom">
        <div
          v-if="showRecoveryBanner"
          class="chat-recovery-banner"
          role="status"
          aria-live="polite"
        >
          <span class="chat-recovery-hint">
            <template v-if="autoResumeSecondsLeft > 0">
              {{ autoResumeSecondsLeft }}s 后自动恢复
            </template>
            <template v-else-if="stalledAssistantMsg">
              运行似乎已卡住
            </template>
            <template v-else>
              Agent 已中断，可恢复
            </template>
          </span>
          <div class="chat-recovery-actions">
            <button
              v-if="autoResumeSecondsLeft > 0"
              type="button"
              class="ghost tiny"
              @click="$emit('cancel-auto-resume')"
            >
              取消
            </button>
            <button
              v-if="stalledAssistantMsg"
              type="button"
              class="secondary tiny resume-bottom-btn"
              :disabled="!configReady || !projectOpened"
              :title="resumeBottomBtnTitle"
              @click="$emit('force-recover-stalled-run', stalledAssistantMsg.id)"
            >
              恢复运行
            </button>
            <button
              v-else-if="recoverableAssistantMsg && !chatSending"
              type="button"
              class="secondary tiny resume-bottom-btn"
              :disabled="!configReady || !projectOpened"
              :title="resumeBottomBtnTitle"
              @click="$emit('resume-agent-run', recoverableAssistantMsg.id)"
            >
              {{ autoResumeSecondsLeft > 0 ? "立即继续" : recoverableResumeLabel }}
            </button>
          </div>
        </div>

        <div
          v-if="chatSending && agentRunningStatus.trim()"
          class="chat-status-row"
        >
          <span class="chat-running-status" aria-live="polite">
            <span class="status-pulse" aria-hidden="true" />
            {{ agentRunningStatus }}
          </span>
        </div>
        <div v-else-if="chatError && !showRecoveryBanner" class="chat-status-row">
          <span class="chat-error">{{ chatError }}</span>
        </div>

        <div class="chat-action-row">
          <div class="composer-mode-row">
            <div class="chat-mode-switch" role="group" aria-label="对话模式">
              <button
                type="button"
                class="mode-btn mode-btn-auto"
                :class="{ active: chatMode === 'auto' }"
                :aria-pressed="chatMode === 'auto'"
                :disabled="chatSending"
                title="自动识别意图，智能切换模式"
                @click="$emit('update:chatMode', 'auto')"
              >
                Auto
              </button>
              <button
                type="button"
                class="mode-btn"
                :class="{ active: chatMode === 'ask' }"
                :aria-pressed="chatMode === 'ask'"
                :disabled="chatSending"
                title="只读探索，自然语言答疑"
                @click="$emit('update:chatMode', 'ask')"
              >
                Ask
              </button>
              <button
                type="button"
                class="mode-btn"
                :class="{ active: chatMode === 'plan' }"
                :aria-pressed="chatMode === 'plan'"
                :disabled="chatSending"
                title="先输出结构化修改方案，确认后再执行"
                @click="$emit('update:chatMode', 'plan')"
              >
                Plan
              </button>
              <button
                type="button"
                class="mode-btn"
                :class="{ active: chatMode === 'build' }"
                :aria-pressed="chatMode === 'build'"
                :disabled="chatSending"
                title="直接探索并修改文件，无需先出方案"
                @click="$emit('update:chatMode', 'build')"
              >
                Build
              </button>
            </div>
            <button
              v-if="totalTokenUsage"
              type="button"
              class="token-usage-btn"
              :class="{ open: showTokenDetail }"
              :title="showTokenDetail ? '收起用量详情' : '查看用量详情'"
              @click="$emit('update:showTokenDetail', !showTokenDetail)"
            >
              {{ totalTokenUsage }}
            </button>
            <div v-if="showTokenDetail && tokenDetailData" class="token-detail-popover">
              <div class="token-detail-row">
                <span>助手回复</span>
                <span>{{ tokenDetailData.assistantCount }} 条</span>
              </div>
              <div v-if="tokenDetailData.totalStreamChars > 0" class="token-detail-row">
                <span>累计输出</span>
                <span>{{ formatCharCount(tokenDetailData.totalStreamChars) }}</span>
              </div>
              <div v-if="tokenDetailData.maxContextChars > 0" class="token-detail-row">
                <span>最大上下文</span>
                <span>{{ formatCharCount(tokenDetailData.maxContextChars) }}</span>
              </div>
              <div class="token-detail-row">
                <span>消息总数</span>
                <span>{{ tokenDetailData.totalMessages }}</span>
              </div>
            </div>
          </div>
          <div class="chat-actions">
            <button v-if="chatSending" type="button" class="secondary" @click="$emit('stop-agent')">停止</button>
            <button type="button" class="primary send-btn" :disabled="!canSendChat" @click="$emit('send-chat')">
              {{ chatSending ? "打断并发送" : "发送" }}
            </button>
          </div>
        </div>
      </div>
    </footer>

    <div
      v-if="projectMemoryOpen"
      class="project-memory-overlay"
      @mousedown.self="$emit('close-project-memory')"
    >
      <div
        class="project-memory-dialog"
        :class="{ wide: projectMemoryTab !== 'memory' }"
        role="dialog"
        aria-labelledby="project-memory-title"
      >
        <div class="project-memory-head">
          <div>
            <h3 id="project-memory-title" class="project-memory-title">项目 AI 数据</h3>
            <p class="project-memory-desc">
              记忆、Skills 与探索归档均存于 .aiall/；保存后 Ask / Plan / Build 会自动注入 Agent。
            </p>
          </div>
          <button
            type="button"
            class="ghost small project-memory-close"
            @click="$emit('close-project-memory')"
          >
            ×
          </button>
        </div>

        <div class="project-memory-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            class="project-memory-tab"
            :class="{ active: projectMemoryTab === 'memory' }"
            :aria-selected="projectMemoryTab === 'memory'"
            @click="$emit('update:projectMemoryTab', 'memory')"
          >
            记忆
          </button>
          <button
            type="button"
            role="tab"
            class="project-memory-tab"
            :class="{ active: projectMemoryTab === 'skills' }"
            :aria-selected="projectMemoryTab === 'skills'"
            @click="$emit('update:projectMemoryTab', 'skills')"
          >
            Skills
            <span v-if="projectSkillsList.length" class="project-memory-tab-count">{{
              projectSkillsList.length
            }}</span>
          </button>
          <button
            type="button"
            role="tab"
            class="project-memory-tab"
            :class="{ active: projectMemoryTab === 'exploration' }"
            :aria-selected="projectMemoryTab === 'exploration'"
            @click="$emit('update:projectMemoryTab', 'exploration')"
          >
            探索归档
            <span v-if="projectExplorationList.length" class="project-memory-tab-count">{{
              projectExplorationList.length
            }}</span>
          </button>
        </div>

        <div v-if="projectMemoryTab === 'memory'" class="project-memory-pane">
          <div v-if="projectMemoryLoading" class="project-memory-status shimmer-text--fast">加载中…</div>
          <textarea
            v-else
            class="project-memory-editor"
            :value="projectMemoryDraft"
            :maxlength="projectMemoryMaxChars"
            placeholder="# 项目记忆&#10;&#10;## 术语 / ## 导航 / ## 偏好"
            @input="$emit('update:projectMemoryDraft', getEventValue($event))"
          />
        </div>

        <div v-else-if="projectMemoryTab === 'skills'" class="project-memory-split-pane">
          <div v-if="projectSkillsLoading" class="project-memory-status shimmer-text--fast">加载中…</div>
          <template v-else>
            <ul v-if="projectSkillsList.length" class="project-memory-list">
              <li
                v-for="item in projectSkillsList"
                :key="item.slug"
                class="project-memory-list-item"
                :class="{ active: item.slug === selectedSkillSlug }"
              >
                <button type="button" class="project-memory-list-btn" @click="$emit('select-project-skill', item.slug)">
                  <span class="project-memory-list-title">{{ item.title }}</span>
                  <span class="project-memory-list-meta">{{ item.kind }} · {{ item.slug }}</span>
                </button>
              </li>
            </ul>
            <div v-else class="project-memory-status">暂无 Skill</div>
            <div class="project-memory-detail">
              <div v-if="skillDetailLoading" class="project-memory-status shimmer-text--fast">加载中…</div>
              <template v-else-if="selectedSkillSlug">
                <div class="project-memory-detail-head">
                  <strong>{{ skillDraftTitle }}</strong>
                  <span class="project-memory-list-meta">{{ skillDraftKind }} · {{ selectedSkillSlug }}</span>
                </div>
                <textarea
                  class="project-memory-editor project-memory-editor-detail"
                  :value="skillDraftBody"
                  @input="$emit('update:skillDraftBody', getEventValue($event))"
                />
              </template>
              <div v-else class="project-memory-status">选择左侧 Skill 查看内容</div>
            </div>
          </template>
        </div>

        <div v-else class="project-memory-split-pane">
          <div v-if="projectSkillsLoading" class="project-memory-status shimmer-text--fast">加载中…</div>
          <template v-else>
            <ul v-if="projectExplorationList.length" class="project-memory-list">
              <li
                v-for="item in projectExplorationList"
                :key="item.id"
                class="project-memory-list-item"
                :class="{ active: item.id === selectedExplorationId }"
              >
                <button
                  type="button"
                  class="project-memory-list-btn"
                  @click="$emit('select-project-exploration', item.id)"
                >
                  <span class="project-memory-list-title">{{ formatExplorationLabel(item) }}</span>
                  <span class="project-memory-list-meta">
                    读 {{ item.readCount }} · 写 {{ item.writtenCount }}
                  </span>
                </button>
              </li>
            </ul>
            <div v-else class="project-memory-status">暂无探索归档</div>
            <div class="project-memory-detail">
              <div v-if="explorationDetailLoading" class="project-memory-status shimmer-text--fast">加载中…</div>
              <div v-else-if="selectedExplorationId" class="project-memory-readonly exploration-markdown" v-html="explorationContentHtml"></div>
              <div v-else class="project-memory-status">选择左侧快照查看内容</div>
            </div>
          </template>
        </div>

        <div class="project-memory-foot">
          <span v-if="projectMemoryTab === 'memory'" class="project-memory-counter">
            {{ projectMemoryDraft.length }} / {{ projectMemoryMaxChars }}
          </span>
          <span v-else-if="projectMemoryTab === 'skills' && selectedSkillSlug" class="project-memory-counter">
            {{ skillDraftBody.length }} 字
          </span>
          <span v-else class="project-memory-counter">&nbsp;</span>
          <span v-if="projectMemoryMessage" class="project-memory-message">{{ projectMemoryMessage }}</span>
          <div class="project-memory-actions">
            <button type="button" class="ghost small" @click="$emit('close-project-memory')">关闭</button>
            <button
              v-if="projectMemoryTab === 'memory'"
              type="button"
              class="primary small"
              :disabled="projectMemorySaving || projectMemoryLoading"
              @click="$emit('save-project-memory')"
            >
              {{ projectMemorySaving ? "保存中…" : "保存" }}
            </button>
            <button
              v-else-if="projectMemoryTab === 'skills' && selectedSkillSlug"
              type="button"
              class="primary small"
              :disabled="skillSaving || skillDetailLoading"
              @click="$emit('save-project-skill')"
            >
              {{ skillSaving ? "保存中…" : "保存 Skill" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, withDefaults, type CSSProperties } from "vue";
import type { VibeChatMode } from "../../../shared/agentTypes";
import type { AgentSuggestion } from "../../services/agentSuggestions";
import type { PendingMemoryProposal } from "../../services/projectMemoryProposal";
import type { PendingSkillProposal } from "../../services/projectSkillProposal";
import type { ExplorationIndexEntry, SkillIndexEntry, SkillKind } from "../../services/projectSkills";
import type { ProjectMemoryTab } from "../../composables/useProjectMemory";
import type { VibeChatSessionMeta } from "../../services/vibeChatStorage";
import { CHAT_SCROLL_BOTTOM_THRESHOLD, formatCharCount, getEventValue } from "../../utils/vibeHelpers";
import { scheduleScrollContainerToBottom, scrollContainerToBottom } from "../../utils/scrollViewport";
import { resolveAgentResumeButtonLabel } from "../../services/agentRecovery";
import { renderMarkdown } from "../../utils/renderMarkdown";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  status?: string;
  agentPhase?: string;
  chatMode?: string;
}

interface QuotedMessage {
  messageId: string;
  content: string;
  role: "user" | "assistant";
  source?: "plan" | "editor";
  filePath?: string;
}

interface MentionItem {
  name: string;
  path: string;
  relative: string;
}

interface TokenDetailData {
  assistantCount: number;
  totalStreamChars: number;
  maxContextChars: number;
  totalMessages: number;
}

interface Props {
  chatPanelStyle?: CSSProperties;
  projectOpened: boolean;
  chatSending: boolean;
  switchingSession?: boolean;
  switchingProject?: boolean;
  chatMessages: ChatMessage[];
  chatMode: VibeChatMode;
  chatError: string;
  configReady: boolean;
  apiKeyReady: boolean;
  aiConfigStatusText: string;
  canSendChat: boolean;
  chatPlaceholder: string;
  recoverableAssistantMsg: ChatMessage | null;
  agentRunningStatus?: string;
  stalledAssistantMsg: ChatMessage | null;
  autoResumeSecondsLeft: number;
  pendingPromptQueue: string[];
  sessionList: VibeChatSessionMeta[];
  activeSessionId: string;
  activeSessionTitle: string;
  chatStoreSyncMessage: string;
  isDragging: boolean;
  editorCollapsed: boolean;
  quotedMessages: QuotedMessage[];
  mentionOpen: boolean;
  mentionResults: MentionItem[];
  mentionActiveIndex: number;
  chatInputFocused: boolean;
  canSwitchToNewerSession: boolean;
  canSwitchToOlderSession: boolean;
  totalTokenUsage?: string;
  showTokenDetail?: boolean;
  tokenDetailData?: TokenDetailData | null;
  projectMemoryOpen?: boolean;
  projectMemoryTab?: ProjectMemoryTab;
  projectMemoryDraft?: string;
  projectMemoryLoading?: boolean;
  projectMemorySaving?: boolean;
  projectMemoryMessage?: string;
  projectMemoryMaxChars?: number;
  projectMemoryHasContent?: boolean;
  projectSkillsList?: SkillIndexEntry[];
  projectExplorationList?: ExplorationIndexEntry[];
  projectSkillsLoading?: boolean;
  selectedSkillSlug?: string;
  skillDraftTitle?: string;
  skillDraftKind?: SkillKind;
  skillDraftBody?: string;
  skillDetailLoading?: boolean;
  skillSaving?: boolean;
  selectedExplorationId?: string;
  explorationContent?: string;
  explorationDetailLoading?: boolean;
  memorySuggestSaving?: boolean;
  pendingMemoryProposals?: PendingMemoryProposal[];
  pendingSkillProposals?: PendingSkillProposal[];
  agentSuggestions?: AgentSuggestion[];
}

const props = withDefaults(defineProps<Props>(), {
  switchingSession: false,
  switchingProject: false,
  totalTokenUsage: "",
  showTokenDetail: false,
  tokenDetailData: null,
  projectMemoryOpen: false,
  projectMemoryTab: "memory",
  projectMemoryDraft: "",
  projectMemoryLoading: false,
  projectMemorySaving: false,
  projectMemoryMessage: "",
  projectMemoryMaxChars: 3500,
  projectMemoryHasContent: false,
  projectSkillsList: () => [],
  projectExplorationList: () => [],
  projectSkillsLoading: false,
  selectedSkillSlug: "",
  skillDraftTitle: "",
  skillDraftKind: "heuristic",
  skillDraftBody: "",
  skillDetailLoading: false,
  skillSaving: false,
  selectedExplorationId: "",
  explorationContent: "",
  explorationDetailLoading: false,
  memorySuggestSaving: false,
  pendingMemoryProposals: () => [],
  pendingSkillProposals: () => [],
  quotedMessages: () => [],
  agentRunningStatus: "",
  agentSuggestions: () => [],
});

const panelStyle = computed(() => {
  if (props.chatPanelStyle && Object.keys(props.chatPanelStyle).length > 0) {
    return props.chatPanelStyle;
  }
  if (props.editorCollapsed) {
    return { flex: "1", minWidth: "260px", width: "auto" };
  }
  return { width: "360px", flexShrink: "0" };
});

const recoverableResumeLabel = computed(() => {
  const msg = props.recoverableAssistantMsg;
  if (!msg) return "恢复运行";
  return resolveAgentResumeButtonLabel(msg);
});

const showRecoveryBanner = computed(
  () =>
    props.autoResumeSecondsLeft > 0
    || Boolean(props.stalledAssistantMsg)
    || Boolean(props.recoverableAssistantMsg && !props.chatSending),
);

const resumeBottomBtnTitle = computed(() => {
  if (props.configReady && props.projectOpened) return undefined;
  if (!props.configReady) return "请先配置 AI 模型";
  return "请先打开项目";
});

function formatExplorationLabel(item: ExplorationIndexEntry): string {
  const stamp = item.createdAt?.trim();
  const timeLabel =
    stamp && !Number.isNaN(new Date(stamp).getTime())
      ? new Date(stamp).toLocaleString("zh-CN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : item.id;
  if (/project-overview/i.test(item.path) || /project-overview/i.test(item.id)) {
    return `项目报告 · ${timeLabel}`;
  }
  return timeLabel;
}

const explorationContentHtml = computed(() => {
  if (!props.explorationContent) return "";
  return renderMarkdown(props.explorationContent);
});

const emit = defineEmits<{
  (e: "send-chat"): void;
  (e: "stop-agent"): void;
  (e: "resume-agent-run", messageId: string): void;
  (e: "force-recover-stalled-run", messageId: string): void;
  (e: "cancel-auto-resume"): void;
  (e: "start-new-session"): void;
  (e: "expand-editor"): void;
  (e: "collapse-chat"): void;
  (e: "switch-session", sessionId: string): void;
  (e: "open-session-list"): void;
  (e: "remove-session", sessionId: string): void;
  (e: "switch-to-adjacent-session", delta: number): void;
  (e: "clear-pending-queue"): void;
  (e: "apply-example", text: string): void;
  (e: "open-project"): void;
  (e: "open-ai-config"): void;
  (e: "open-project-view", view: "knowledge" | "health" | "map" | "fix"): void;
  (e: "apply-suggestion", suggestion: AgentSuggestion): void;
  (e: "copy-session-info", session: VibeChatSessionMeta): void;
  (e: "copy-session-name-path", session: VibeChatSessionMeta): void;
  (e: "clear-chat"): void;
  (e: "on-composer-field-keydown", event: KeyboardEvent): void;
  (e: "on-chat-input-box-mousedown"): void;
  (e: "select-mention", item: MentionItem): void;
  (e: "on-chat-scroll"): void;
  (e: "scroll-to-bottom"): void;
  (e: "on-chat-drag-enter", event: DragEvent): void;
  (e: "on-chat-drag-over", event: DragEvent): void;
  (e: "on-chat-drag-leave", event: DragEvent): void;
  (e: "on-chat-drop", event: DragEvent): void;
  (e: "update:chatMode", mode: VibeChatMode): void;
  (e: "update:quotedMessages", value: QuotedMessage[]): void;
  (e: "update:showTokenDetail", value: boolean): void;
  (e: "update:projectMemoryDraft", value: string): void;
  (e: "open-project-memory"): void;
  (e: "close-project-memory"): void;
  (e: "update:projectMemoryTab", value: ProjectMemoryTab): void;
  (e: "update:projectMemoryDraft", value: string): void;
  (e: "update:skillDraftBody", value: string): void;
  (e: "select-project-skill", slug: string): void;
  (e: "select-project-exploration", id: string): void;
  (e: "save-project-memory"): void;
  (e: "save-project-skill"): void;
  (e: "confirm-memory-proposal", id: string): void;
  (e: "dismiss-memory-proposal", id: string): void;
  (e: "confirm-skill-proposal", id: string): void;
  (e: "dismiss-skill-proposal", id: string): void;
  (e: "test-notification"): void;
}>();

const chatScrollRef = ref<HTMLElement | null>(null);
const chatDropZoneRef = ref<HTMLElement | null>(null);
const headMenuRef = ref<HTMLElement | null>(null);
const headMenuOpen = ref(false);
const headMenuTop = ref(0);
const headMenuRight = ref(0);

function updateHeadMenuPosition() {
  if (headMenuRef.value) {
    const rect = headMenuRef.value.getBoundingClientRect();
    headMenuTop.value = rect.bottom + 6;
    headMenuRight.value = window.innerWidth - rect.right;
  }
}

function toggleHeadMenu() {
  headMenuOpen.value = !headMenuOpen.value;
  if (headMenuOpen.value) {
    nextTick(updateHeadMenuPosition);
  }
}

function onHeadMenuAction(action: "memory" | "new-session" | "clear") {
  headMenuOpen.value = false;
  if (action === "memory") emit("open-project-memory");
  else if (action === "new-session") emit("start-new-session");
  else emit("clear-chat");
}

function onHeadMenuPointerDown(event: PointerEvent) {
  if (!headMenuOpen.value) return;
  const el = headMenuRef.value;
  const target = event.target as Node | null;
  const insideMenu = el && el.contains(target);
  const insideDropdown = target && target instanceof HTMLElement && target.closest('.panel-head-dropdown');
  if (!insideMenu && !insideDropdown) headMenuOpen.value = false;
}

const isAtBottom = ref(true);
const showScrollToBottom = computed(() => !isAtBottom.value && props.chatMessages.length > 0);

function checkScrollPosition() {
  const el = chatScrollRef.value;
  if (!el) { isAtBottom.value = true; return; }
  isAtBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight <= CHAT_SCROLL_BOTTOM_THRESHOLD;
}

function onScroll() {
  checkScrollPosition();
  emit("on-chat-scroll");
}

function scrollToBottom() {
  const el = chatScrollRef.value;
  if (!el) return;
  scrollContainerToBottom(el);
  isAtBottom.value = true;
  emit("on-chat-scroll");
  emit("scroll-to-bottom");
}

function scheduleSessionScrollToBottom() {
  if (props.switchingSession || !props.chatMessages.length) return;
  sessionScrollPending = true;
  if (sessionScrollClearTimer) { clearTimeout(sessionScrollClearTimer); sessionScrollClearTimer = null; }
  sessionScrollClearTimer = window.setTimeout(() => {
    sessionScrollPending = false;
    sessionScrollClearTimer = null;
  }, 900);
  scheduleScrollContainerToBottom(() => chatScrollRef.value, { behavior: "auto" });
  void nextTick(() => {
    scrollToBottom();
  });
}

watch(
  () => props.activeSessionId,
  () => {
    scheduleSessionScrollToBottom();
  },
);

watch(
  () => props.switchingSession,
  (busy, wasBusy) => {
    if (wasBusy && !busy) {
      scheduleSessionScrollToBottom();
    }
  },
);

watch(
  () => [props.chatMessages.length, props.chatSending] as const,
  () => {
    if (props.switchingSession) return;
    void nextTick(() => checkScrollPosition());
  },
);

let scrollResizeObserver: ResizeObserver | null = null;
let sessionScrollPending = false;
let sessionScrollClearTimer: number | null = null;

onMounted(() => {
  document.addEventListener("pointerdown", onHeadMenuPointerDown, true);
  void nextTick(() => {
    checkScrollPosition();
    const scrollEl = chatScrollRef.value;
    if (!scrollEl || typeof ResizeObserver === "undefined") return;
    const contentEl = scrollEl.querySelector(".msg-list") ?? scrollEl;
    scrollResizeObserver = new ResizeObserver(() => {
      if (sessionScrollPending || (props.chatSending && isAtBottom.value)) {
        scrollToBottom();
        return;
      }
      checkScrollPosition();
    });
    scrollResizeObserver.observe(contentEl);
  });
});

onUnmounted(() => {
  document.removeEventListener("pointerdown", onHeadMenuPointerDown, true);
  scrollResizeObserver?.disconnect();
  scrollResizeObserver = null;
  if (sessionScrollClearTimer) { clearTimeout(sessionScrollClearTimer); sessionScrollClearTimer = null; }
});

defineExpose({ chatScrollRef, chatDropZoneRef });

function removeQuotedMessage(index: number) {
  const next = props.quotedMessages.filter((_, i) => i !== index);
  emit("update:quotedMessages", next);
}
</script>

<style src="./styles/ChatPanel.scss" scoped></style>

