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
    <div class="chat-scroll-wrap">
      <div
        ref="chatScrollRef"
        class="chat-scroll"
        @scroll="onScroll"
        @wheel.passive="onUserScrollIntent"
        @touchmove.passive="onUserScrollIntent"
        @mousedown="onScrollbarMouseDown"
      >
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
          <span class="chat-empty-prompt">&gt;</span>
          <span class="chat-empty-caret" />
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
          <div class="chips">
            <button type="button" class="chip" :disabled="chatSending" @click="$emit('apply-example', '解释这个项目是做什么的')">
              <span class="chip-cmd">/explain</span>
              <span class="chip-label">解释项目</span>
            </button>
            <button type="button" class="chip" :disabled="chatSending" @click="$emit('apply-example', '解释这段代码在做什么')">
              <span class="chip-cmd">/read</span>
              <span class="chip-label">解释代码</span>
            </button>
            <button type="button" class="chip" :disabled="chatSending" @click="$emit('apply-example', '帮我优化这段代码，并给出修改后的完整代码')">
              <span class="chip-cmd">/optimize</span>
              <span class="chip-label">优化代码</span>
            </button>
            <button type="button" class="chip" :disabled="chatSending" @click="$emit('apply-example', '找出潜在 bug 并修复')">
              <span class="chip-cmd">/fix</span>
              <span class="chip-label">修复 bug</span>
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

    <div
      v-if="sessionGoal"
      class="session-goal-bar"
      :class="{
        'session-goal-bar--expanded': sessionGoalExpanded,
        'session-goal-bar--expandable': sessionGoalExpandable,
      }"
      role="status"
    >
      <button
        type="button"
        class="session-goal-head"
        :disabled="!sessionGoalExpandable"
        :aria-expanded="sessionGoalExpandable ? sessionGoalExpanded : undefined"
        :title="sessionGoalExpandTitle"
        @click="toggleSessionGoal"
      >
        <span
          v-if="sessionGoalExpandable"
          class="session-goal-chevron"
          aria-hidden="true"
        >{{ sessionGoalExpanded ? "▾" : "▸" }}</span>
        <span class="session-goal-label">模型理解</span>
        <span
          v-if="!sessionGoalExpanded"
          class="session-goal-preview"
        >{{ sessionGoal }}</span>
        <span
          v-else
          class="session-goal-hint"
        >点击收起</span>
      </button>
      <div
        v-show="sessionGoalExpanded"
        class="session-goal-body"
      >{{ sessionGoal }}</div>
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
      <div v-if="composerDisabledHint" class="chat-composer-hint" role="status">
        {{ composerDisabledHint }}
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

        <div v-else-if="chatError && !showRecoveryBanner" class="chat-status-row">
          <span class="chat-error">{{ chatError }}</span>
        </div>

        <div class="chat-action-row">
            <div class="composer-mode-row">
            <div
              v-if="sessionOutline.length"
              ref="outlineWrapRef"
              class="session-outline-wrap"
            >
              <button
                type="button"
                class="chat-debug-toggle"
                :class="{ active: outlineOpen }"
                :title="outlineOpen ? '收起会话大纲' : '会话大纲：本会话问过的问题'"
                :aria-expanded="outlineOpen"
                aria-haspopup="dialog"
                @click="toggleOutline"
              >
                大纲
                <span v-if="sessionOutline.length" class="session-outline-count">{{ sessionOutline.length }}</span>
              </button>
              <Teleport to="body">
                <div
                  v-if="outlineOpen"
                  ref="outlinePopoverRef"
                  class="session-outline-popover"
                  :style="{ position: 'fixed', top: outlinePopoverTop + 'px', right: outlinePopoverRight + 'px' }"
                  role="dialog"
                  aria-label="会话大纲"
                >
                  <div class="session-outline-head">
                    <span class="session-outline-title">本会话问题</span>
                    <span class="session-outline-meta">{{ sessionOutline.length }} 条</span>
                  </div>
                  <ol class="session-outline-list">
                    <li v-for="item in sessionOutline" :key="item.id">
                      <button
                        type="button"
                        class="session-outline-item"
                        :title="item.preview"
                        @click="jumpToOutlineItem(item.id)"
                      >
                        <span class="session-outline-index">{{ item.index }}</span>
                        <span class="session-outline-preview">{{ item.preview }}</span>
                      </button>
                    </li>
                  </ol>
                </div>
              </Teleport>
            </div>
            <button
              type="button"
              class="chat-debug-toggle"
              :class="{ active: agentDebugEnabled }"
              :title="agentDebugEnabled ? '调试详情已开启（显示请求/回复/工具全过程）' : '开启调试详情（显示请求/回复/工具全过程）'"
              @click="setAgentDebugEnabled(!agentDebugEnabled)"
            >
              调试
            </button>
            <div
              v-if="providerOptions.length"
              ref="providerPickerRef"
              class="chat-provider-picker"
            >
              <button
                type="button"
                class="chat-provider-trigger"
                :class="{ open: providerPickerOpen }"
                :disabled="chatSending || !projectOpened"
                :title="providerPickerTitle"
                :aria-expanded="providerPickerOpen"
                aria-haspopup="menu"
                @click="toggleProviderPicker"
              >
                <svg class="chat-provider-trigger-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.2"/>
                  <path d="M6 5.5h4M6 8h4M6 10.5h2" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
                </svg>
                <span class="chat-provider-trigger-label">{{ activeProviderLabel }}</span>
                <svg class="chat-provider-trigger-chevron" width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <Teleport to="body">
                <div
                  v-if="providerPickerOpen"
                  ref="providerDropdownRef"
                  class="chat-provider-dropdown"
                  :style="{ position: 'fixed', top: providerDropdownTop + 'px', right: providerDropdownRight + 'px' }"
                  role="menu"
                >
                  <div class="chat-provider-dropdown-head">
                    <span class="chat-provider-dropdown-title">本会话使用模型</span>
                    <div class="chat-provider-dropdown-head-actions">
                      <button
                        type="button"
                        class="ghost small"
                        :disabled="!activeSessionProviderId"
                        @click="resetProviderToGlobal"
                      >
                        重置为全局
                      </button>
                      <button
                        type="button"
                        class="ghost small chat-provider-config-btn"
                        title="管理供应商与模型"
                        @click="goToAiConfig"
                      >
                        配置…
                      </button>
                    </div>
                  </div>
                  <div v-if="showProviderFilter" class="chat-provider-search">
                    <svg class="chat-provider-search-icon" width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <circle cx="7" cy="7" r="4.2" stroke="currentColor" stroke-width="1.3" />
                      <path d="M10.3 10.3L13.5 13.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
                    </svg>
                    <input
                      ref="providerSearchInputRef"
                      v-model="providerFilterKeyword"
                      class="chat-provider-search-input"
                      type="text"
                      placeholder="搜索模型"
                      spellcheck="false"
                      autocomplete="off"
                      @keydown.escape.prevent="providerFilterKeyword = ''"
                    />
                    <button
                      v-if="providerFilterKeyword"
                      type="button"
                      class="chat-provider-search-clear"
                      title="清空搜索"
                      @click="providerFilterKeyword = ''"
                    >
                      ✕
                    </button>
                  </div>
                  <div class="chat-provider-dropdown-body">
                    <button
                      v-if="showGlobalProviderOption"
                      type="button"
                      class="chat-provider-option"
                      :class="{ active: !activeSessionProviderId }"
                      role="menuitemradio"
                      :aria-checked="!activeSessionProviderId"
                      @click="selectProvider('')"
                    >
                      <span class="chat-provider-option-name">使用全局配置</span>
                      <span class="chat-provider-option-model">{{ globalModelName || "未设置" }}</span>
                      <span v-if="!activeSessionProviderId" class="chat-provider-option-check">✓</span>
                    </button>
                    <div v-if="showGlobalProviderOption && filteredProviderOptions.length" class="chat-provider-option-sep" />
                    <template v-for="p in filteredProviderOptions" :key="p.id">
                      <div class="chat-provider-group">
                        <span class="chat-provider-group-label" :title="p.name">{{ p.name }}</span>
                        <span class="chat-provider-group-count">{{ p.models.length + (p.showDefaultModel ? 1 : 0) }}</span>
                      </div>
                      <button
                        v-if="p.showDefaultModel"
                        type="button"
                        class="chat-provider-option"
                        :class="{ active: activeSessionProviderId === p.id && !activeSessionModelId }"
                        role="menuitemradio"
                        :aria-checked="activeSessionProviderId === p.id && !activeSessionModelId"
                        @click="selectProvider(p.id)"
                      >
                        <span class="chat-provider-option-name">默认</span>
                        <span class="chat-provider-option-model">{{ p.model }}</span>
                        <span v-if="activeSessionProviderId === p.id && !activeSessionModelId" class="chat-provider-option-check">✓</span>
                      </button>
                      <button
                        v-for="m in p.models"
                        :key="m"
                        type="button"
                        class="chat-provider-option"
                        :class="{ active: activeSessionProviderId === p.id && activeSessionModelId === m }"
                        role="menuitemradio"
                        :aria-checked="activeSessionProviderId === p.id && activeSessionModelId === m"
                        @click="selectModel(p.id, m)"
                      >
                        <span class="chat-provider-option-name">{{ m }}</span>
                        <span v-if="activeSessionProviderId === p.id && activeSessionModelId === m" class="chat-provider-option-check">✓</span>
                      </button>
                    </template>
                    <p v-if="!showGlobalProviderOption && !filteredProviderOptions.length" class="chat-provider-empty">
                      没有匹配的模型
                    </p>
                  </div>
                </div>
              </Teleport>
            </div>
            <div class="token-usage-wrap">
              <button
                ref="tokenBtnRef"
                v-if="totalTokenUsage"
                type="button"
                class="token-usage-btn"
                :class="{ open: showTokenDetail }"
                :title="showTokenDetail ? '收起用量详情' : '查看用量详情'"
                @click="$emit('update:showTokenDetail', !showTokenDetail)"
              >
                {{ totalTokenUsage }}
              </button>
              <Teleport to="body">
                <div
                  v-if="showTokenDetail && tokenDetailData"
                  ref="tokenPopoverRef"
                  class="token-detail-popover"
                  :style="{ position: 'fixed', top: tokenPopoverTop + 'px', right: tokenPopoverRight + 'px' }"
                >
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
                  <div v-if="tokenDetailData.toolCallCount > 0" class="token-detail-row">
                    <span>工具调用</span>
                    <span>{{ tokenDetailData.toolCallCount }} 次</span>
                  </div>
                  <div v-if="tokenDetailData.writtenFilesCount > 0" class="token-detail-row">
                    <span>写入文件</span>
                    <span>{{ tokenDetailData.writtenFilesCount }} 个</span>
                  </div>
                  <div v-if="tokenDetailData.imageCount > 0" class="token-detail-row">
                    <span>图片</span>
                    <span>{{ tokenDetailData.imageCount }} 张</span>
                  </div>
                  <div v-if="tokenDetailData.agentTurns > 0" class="token-detail-row">
                    <span>Agent 轮次</span>
                    <span>{{ tokenDetailData.agentTurns }}</span>
                  </div>
                  <div v-if="tokenDetailData.cacheHitRatio !== undefined" class="token-detail-row">
                    <span>缓存命中率</span>
                    <span>{{ Math.round(tokenDetailData.cacheHitRatio * 100) }}%</span>
                  </div>
                  <div v-if="tokenDetailData.cacheHitTokens > 0" class="token-detail-row">
                    <span>缓存命中 token</span>
                    <span>{{ tokenDetailData.cacheHitTokens.toLocaleString() }}</span>
                  </div>
                  <div class="token-detail-row">
                    <span>消息总数</span>
                    <span>{{ tokenDetailData.totalMessages }}</span>
                  </div>
                </div>
              </Teleport>
            </div>
          </div>
          <div class="chat-actions">
            <template v-if="chatSending">
              <button type="button" class="chat-run-control chat-run-control--pause" @click="$emit('pause-agent')">暂停</button>
              <button type="button" class="chat-run-control chat-run-control--stop" @click="$emit('stop-agent')">停止</button>
            </template>
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
              记忆、Skills 与探索归档均存于 .aiall/；保存后会自动注入 Agent。
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
          <button
            type="button"
            role="tab"
            class="project-memory-tab"
            :class="{ active: projectMemoryTab === 'longterm' }"
            :aria-selected="projectMemoryTab === 'longterm'"
            @click="$emit('update:projectMemoryTab', 'longterm')"
          >
            长期记忆
            <span v-if="longTermMemoryList.length" class="project-memory-tab-count">{{
              longTermMemoryList.length
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

        <div v-else-if="projectMemoryTab === 'exploration'" class="project-memory-split-pane">
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

        <div v-else class="project-memory-pane project-memory-longterm">
          <div v-if="longTermMemoryLoading" class="project-memory-status shimmer-text--fast">加载中…</div>
          <ul v-else-if="longTermMemoryList.length" class="project-memory-longterm-list">
            <li
              v-for="entry in longTermMemoryList"
              :key="entry.id"
              class="project-memory-longterm-item"
            >
              <div class="project-memory-longterm-head">
                <span class="project-memory-longterm-scope">{{ longTermMemoryScopeLabel(entry.scope) }}</span>
                <span class="project-memory-list-meta">
                  {{ formatMemoryTimestamp(entry.updatedAt) }}
                  <template v-if="entry.source">· 来源 {{ entry.source }}</template>
                </span>
                <button
                  type="button"
                  class="project-memory-longterm-delete"
                  title="删除该条记忆"
                  @click="$emit('delete-long-term-memory', entry.id)"
                >
                  ×
                </button>
              </div>
              <p class="project-memory-longterm-content">{{ entry.content }}</p>
            </li>
          </ul>
          <div v-else class="project-memory-status">暂无长期记忆（Agent 在 Build 模式会自动沉淀有价值的决策）</div>
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
    <AgentTraceDrawer />
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, withDefaults, type CSSProperties } from "vue";

import type { AgentSuggestion } from "../../services/agentSuggestions";
import type { PendingMemoryProposal } from "../../services/projectMemoryProposal";
import type { PendingSkillProposal } from "../../services/projectSkillProposal";
import type { ExplorationIndexEntry, SkillIndexEntry, SkillKind } from "../../services/projectSkills";
import {
  longTermMemoryScopeLabel,
  type LongTermMemoryEntry,
} from "../../services/vibeLongTermMemoryClient";
import type { ProjectMemoryTab } from "../../composables/useProjectMemory";
import { CHAT_SCROLL_BOTTOM_THRESHOLD, formatCharCount, getEventValue } from "../../utils/vibeHelpers";
import {
  computeScrollFollowStep,
  prefersReducedMotion,
  scheduleScrollContainerToBottom,
  scrollContainerToBottom,
} from "../../utils/scrollViewport";
import { resolveAgentResumeButtonLabel } from "../../services/agentRecovery";
import { renderMarkdown } from "../../utils/renderMarkdown";
import { agentDebugEnabled, setAgentDebugEnabled } from "../../utils/agentDebugFlag";
import { buildSessionOutline } from "../../utils/sessionOutline";
import AgentTraceDrawer from "../AgentTraceDrawer.vue";
import { openLatestTraceDrawer } from "../../services/agentTraceDrawer";
import AgentLiveStatusRail from "../AgentLiveStatusRail.vue";

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
  toolCallCount: number;
  writtenFilesCount: number;
  imageCount: number;
  agentTurns: number;
  cachePromptTokens: number;
  cacheHitTokens: number;
  cacheHitRatio?: number;
}

interface Props {
  chatPanelStyle?: CSSProperties;
  projectOpened: boolean;
  chatSending: boolean;
  switchingSession?: boolean;
  switchingProject?: boolean;
  chatMessages: ChatMessage[];
  chatError: string;
  configReady: boolean;
  apiKeyReady: boolean;
  canSendChat: boolean;
  chatPlaceholder: string;
  /** 输入框禁用时直接在界面上显示的原因文字 */
  composerDisabledHint?: string;
  recoverableAssistantMsg: ChatMessage | null;
  agentRunningStatus?: string;
  agentRunStageLabel?: string;
  pendingApproval?: boolean;
  stalledAssistantMsg: ChatMessage | null;
  autoResumeSecondsLeft: number;
  pendingPromptQueue: string[];
  activeSessionId: string;
  isDragging: boolean;
  editorCollapsed: boolean;
  mentionOpen: boolean;
  mentionResults: MentionItem[];
  mentionActiveIndex: number;
  chatInputFocused: boolean;
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
  projectSkillsList?: SkillIndexEntry[];
  projectExplorationList?: ExplorationIndexEntry[];
  projectSkillsLoading?: boolean;
  longTermMemoryList?: LongTermMemoryEntry[];
  longTermMemoryLoading?: boolean;
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
  activeSessionProviderId: string;
  activeSessionModelId?: string;
  /** Sticky read-only model understanding of the user demand (from intent classifier). */
  sessionGoal?: string;
  providerOptions?: Array<{ id: string; name: string; model: string; availableModels?: string[] }>;
  globalModelName: string;
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
  projectSkillsList: () => [],
  projectExplorationList: () => [],
  projectSkillsLoading: false,
  longTermMemoryList: () => [],
  longTermMemoryLoading: false,
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
	composerDisabledHint: "",
	agentRunningStatus: "",
	agentRunStageLabel: "",
	pendingApproval: false,
	agentSuggestions: () => [],
	activeSessionProviderId: "",
	activeSessionModelId: "",
	sessionGoal: "",
	providerOptions: () => [],
	globalModelName: "",
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

function formatMemoryTimestamp(raw?: string): string {
  const stamp = raw?.trim();
  if (!stamp || Number.isNaN(new Date(stamp).getTime())) return stamp || "";
  return new Date(stamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const explorationContentHtml = computed(() => {
  if (!props.explorationContent) return "";
  return renderMarkdown(props.explorationContent);
});

const emit = defineEmits<{
  (e: "send-chat"): void;
  (e: "stop-agent"): void;
  (e: "pause-agent"): void;
  (e: "resume-agent-run", messageId: string): void;
  (e: "force-recover-stalled-run", messageId: string): void;
  (e: "cancel-auto-resume"): void;
  (e: "clear-pending-queue"): void;
  (e: "apply-example", text: string): void;
  (e: "open-project"): void;
  (e: "open-ai-config"): void;
  (e: "apply-suggestion", suggestion: AgentSuggestion): void;
  (e: "on-composer-field-keydown", event: KeyboardEvent): void;
  (e: "on-chat-input-box-mousedown"): void;
  (e: "select-mention", item: MentionItem): void;
  (e: "on-chat-scroll"): void;
  (e: "scroll-to-bottom"): void;
  (e: "on-chat-drag-enter", event: DragEvent): void;
  (e: "on-chat-drag-over", event: DragEvent): void;
  (e: "on-chat-drag-leave", event: DragEvent): void;
  (e: "on-chat-drop", event: DragEvent): void;
  (e: "update:showTokenDetail", value: boolean): void;
  (e: "update:projectMemoryDraft", value: string): void;
  (e: "close-project-memory"): void;
  (e: "update:projectMemoryTab", value: ProjectMemoryTab): void;
  (e: "update:projectMemoryDraft", value: string): void;
  (e: "update:skillDraftBody", value: string): void;
  (e: "select-project-skill", slug: string): void;
  (e: "select-project-exploration", id: string): void;
  (e: "delete-long-term-memory", id: string): void;
  (e: "save-project-memory"): void;
  (e: "save-project-skill"): void;
  (e: "confirm-memory-proposal", id: string): void;
  (e: "dismiss-memory-proposal", id: string): void;
  (e: "confirm-skill-proposal", id: string): void;
  (e: "dismiss-skill-proposal", id: string): void;
  (e: "update:activeSessionProviderId", providerId: string): void;
  (e: "update:activeSessionModelId", modelId: string): void;
  (e: "jump-to-message", messageId: string): void;
}>();

const chatScrollRef = ref<HTMLElement | null>(null);
const chatDropZoneRef = ref<HTMLElement | null>(null);
const isAtBottom = ref(true);
const showScrollToBottom = computed(() => !isAtBottom.value && props.chatMessages.length > 0);

/** Sticky goal: collapse to one line; expand when the demand is longer than a glance. */
const SESSION_GOAL_COLLAPSE_CHARS = 36;
const sessionGoalExpanded = ref(false);
const sessionGoalExpandable = computed(() => {
  const goal = props.sessionGoal?.trim() || "";
  return goal.length > SESSION_GOAL_COLLAPSE_CHARS || goal.includes("\n");
});
const sessionGoalExpandTitle = computed(() => {
  if (!sessionGoalExpandable.value) return "模型对用户意图的理解";
  return sessionGoalExpanded.value ? "收起理解" : "展开完整理解";
});

function toggleSessionGoal() {
  if (!sessionGoalExpandable.value) return;
  sessionGoalExpanded.value = !sessionGoalExpanded.value;
}

watch(
  () => props.sessionGoal,
  () => {
    sessionGoalExpanded.value = false;
  },
);

/** 「供应商 / 模型」展示；只改模型名、供应商不变时也能看出换了默认源。 */
function formatProviderModelLabel(providerName: string, model: string): string {
  const name = providerName.trim();
  const modelName = model.trim();
  if (name && modelName) return `${name} / ${modelName}`;
  return modelName || name || "未设置";
}

const activeProviderLabel = computed(() => {
  const id = props.activeSessionProviderId.trim();
  if (!id) return props.globalModelName.trim() || "未设置";
  const provider = props.providerOptions?.find((p) => p.id === id);
  if (!provider) return "自定义";
  const model = props.activeSessionModelId?.trim() || provider.model;
  return formatProviderModelLabel(provider.name, model);
});

const providerPickerTitle = computed(() => {
  if (props.activeSessionProviderId.trim()) return `会话模型：${activeProviderLabel.value}（在「AI 配置」可管理供应商）`;
  return `会话模型：使用全局配置（${props.globalModelName || "未设置"}）`;
});

const providerFilterKeyword = ref("");
const providerSearchInputRef = ref<HTMLInputElement | null>(null);

/** 选项多时才需要搜索框，少选项直接列出来更快 */
const showProviderFilter = computed(() => providerOptionCount.value >= 8);

const providerOptionCount = computed(() =>
  (props.providerOptions ?? []).reduce((total, p) => total + 1 + (p.availableModels?.length ?? 0), 0),
);

const normalizedProviderKeyword = computed(() => providerFilterKeyword.value.trim().toLowerCase());

const showGlobalProviderOption = computed(() => {
  const keyword = normalizedProviderKeyword.value;
  if (!keyword) return true;
  return "使用全局配置".includes(keyword) || (props.globalModelName || "").toLowerCase().includes(keyword);
});

/** 按关键词过滤：命中供应商名则整组保留，否则只保留命中的模型 */
const filteredProviderOptions = computed(() => {
  const keyword = normalizedProviderKeyword.value;
  const options = props.providerOptions ?? [];
  if (!keyword) {
    return options.map((p) => ({
      id: p.id,
      name: p.name,
      model: p.model,
      models: p.availableModels ?? [],
      showDefaultModel: true,
    }));
  }
  const filtered: Array<{ id: string; name: string; model: string; models: string[]; showDefaultModel: boolean }> = [];
  for (const p of options) {
    const nameHit = p.name.toLowerCase().includes(keyword);
    const defaultHit = p.model.toLowerCase().includes(keyword);
    const models = nameHit
      ? [...(p.availableModels ?? [])]
      : (p.availableModels ?? []).filter((m) => m.toLowerCase().includes(keyword));
    if (!nameHit && !defaultHit && !models.length) continue;
    filtered.push({ id: p.id, name: p.name, model: p.model, models, showDefaultModel: nameHit || defaultHit });
  }
  return filtered;
});

function resetProviderFilter() {
  providerFilterKeyword.value = "";
}

const providerPickerRef = ref<HTMLElement | null>(null);
const providerDropdownRef = ref<HTMLElement | null>(null);
const providerPickerOpen = ref(false);
const providerDropdownTop = ref(0);
const providerDropdownRight = ref(0);

const tokenBtnRef = ref<HTMLElement | null>(null);
const tokenPopoverRef = ref<HTMLElement | null>(null);
const tokenPopoverTop = ref(0);
const tokenPopoverRight = ref(0);

const outlineOpen = ref(false);
const outlineWrapRef = ref<HTMLElement | null>(null);
const outlinePopoverRef = ref<HTMLElement | null>(null);
const outlinePopoverTop = ref(0);
const outlinePopoverRight = ref(0);

const sessionOutline = computed(() => buildSessionOutline(props.chatMessages));

function updateOutlinePopoverPosition() {
  const wrap = outlineWrapRef.value;
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const pop = outlinePopoverRef.value;
  const popHeight = pop?.offsetHeight ?? 0;
  const gap = 6;
  const spaceAbove = rect.top - gap;
  const spaceBelow = window.innerHeight - rect.bottom - gap;
  const openDown = spaceAbove < popHeight && spaceBelow > spaceAbove;
  outlinePopoverTop.value = openDown ? rect.bottom + gap : Math.max(gap, rect.top - popHeight - gap);
  outlinePopoverRight.value = Math.max(8, window.innerWidth - rect.right);
}

function handleOutlineViewportChange() {
  if (outlineOpen.value) updateOutlinePopoverPosition();
}

function toggleOutline() {
  outlineOpen.value = !outlineOpen.value;
  if (outlineOpen.value) nextTick(updateOutlinePopoverPosition);
}

function jumpToOutlineItem(messageId: string) {
  outlineOpen.value = false;
  emit("jump-to-message", messageId);
}

function handleOutlineOutsideClick(e: MouseEvent) {
  if (!outlineOpen.value) return;
  const target = e.target as Node;
  if (outlineWrapRef.value?.contains(target) || outlinePopoverRef.value?.contains(target)) return;
  outlineOpen.value = false;
}

watch(outlineOpen, (open) => {
  if (open) {
    window.addEventListener("resize", handleOutlineViewportChange);
    document.addEventListener("scroll", handleOutlineViewportChange, true);
  } else {
    window.removeEventListener("resize", handleOutlineViewportChange);
    document.removeEventListener("scroll", handleOutlineViewportChange, true);
  }
});

watch(
  () => props.activeSessionId,
  () => {
    outlineOpen.value = false;
  },
);

watch(sessionOutline, (items) => {
  if (!items.length) outlineOpen.value = false;
});

function updateTokenPopoverPosition() {
  const btn = tokenBtnRef.value;
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const pop = tokenPopoverRef.value;
  const popHeight = pop?.offsetHeight ?? 0;
  const gap = 6;
  // 默认向上展开；上方空间不足时改为向下展开，避免被视口裁掉
  const spaceAbove = rect.top - gap;
  const spaceBelow = window.innerHeight - rect.bottom - gap;
  const openDown = spaceAbove < popHeight && spaceBelow > spaceAbove;
  tokenPopoverTop.value = openDown ? rect.bottom + gap : Math.max(gap, rect.top - popHeight - gap);
  tokenPopoverRight.value = Math.max(8, window.innerWidth - rect.right);
}

/** 打开期间窗口缩放 / 页面滚动时保持弹窗定位准确 */
function handleTokenViewportChange() {
  if (props.showTokenDetail) updateTokenPopoverPosition();
}

watch(
  () => props.showTokenDetail,
  (open) => {
    if (open) {
      nextTick(updateTokenPopoverPosition);
      window.addEventListener("resize", handleTokenViewportChange);
      document.addEventListener("scroll", handleTokenViewportChange, true);
    } else {
      window.removeEventListener("resize", handleTokenViewportChange);
      document.removeEventListener("scroll", handleTokenViewportChange, true);
    }
  },
);

onUnmounted(() => {
  window.removeEventListener("resize", handleTokenViewportChange);
  document.removeEventListener("scroll", handleTokenViewportChange, true);
  window.removeEventListener("resize", handleOutlineViewportChange);
  document.removeEventListener("scroll", handleOutlineViewportChange, true);
});

/** 点击按钮/弹窗外部时自动关闭 */
function handleTokenPopoverOutsideClick(e: MouseEvent) {
  if (!props.showTokenDetail) return;
  const target = e.target as Node;
  if (tokenBtnRef.value?.contains(target) || tokenPopoverRef.value?.contains(target)) return;
  emit("update:showTokenDetail", false);
}

function updateProviderDropdownPosition() {
  if (!providerPickerRef.value) return;
  const rect = providerPickerRef.value.getBoundingClientRect();
  const dropdown = providerDropdownRef.value;
  const dropdownHeight = dropdown?.offsetHeight ?? 0;
  const gap = 4;
  // 默认向下展开；下方空间不足时向上展开，避免超出视口被裁掉
  const spaceBelow = window.innerHeight - rect.bottom - gap;
  const spaceAbove = rect.top - gap;
  const openUp = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;
  providerDropdownTop.value = openUp
    ? Math.max(gap, rect.top - dropdownHeight - gap)
    : rect.bottom + gap;
  providerDropdownRight.value = window.innerWidth - rect.right;
}

/** 打开期间窗口缩放 / 页面滚动时保持下拉定位准确 */
function handleProviderViewportChange() {
  if (providerPickerOpen.value) updateProviderDropdownPosition();
}

// 过滤后列表变短，弹窗高度跟着变：重新定位，否则向上展开会与触发按钮脱开
watch(providerFilterKeyword, () => {
  if (!providerPickerOpen.value) return;
  nextTick(updateProviderDropdownPosition);
});

function toggleProviderPicker() {
  providerPickerOpen.value = !providerPickerOpen.value;
  if (providerPickerOpen.value) {
    providerFilterKeyword.value = "";
    nextTick(() => {
      updateProviderDropdownPosition();
      if (showProviderFilter.value) providerSearchInputRef.value?.focus();
    });
  }
}

function closeProviderPicker() {
  providerPickerOpen.value = false;
}

function selectProvider(providerId: string) {
  providerPickerOpen.value = false;
  emit("update:activeSessionProviderId", providerId);
  emit("update:activeSessionModelId", "");
}

function selectModel(providerId: string, modelId: string) {
  providerPickerOpen.value = false;
  emit("update:activeSessionProviderId", providerId);
  emit("update:activeSessionModelId", modelId);
}

function resetProviderToGlobal() {
  providerPickerOpen.value = false;
  emit("update:activeSessionProviderId", "");
  emit("update:activeSessionModelId", "");
}

function goToAiConfig() {
  providerPickerOpen.value = false;
  emit("open-ai-config");
}

/** 点击下拉外部时自动关闭 */
function handleProviderPickerOutsideClick(e: MouseEvent) {
  if (!providerPickerOpen.value) return;
  const trigger = providerPickerRef.value;
  const dropdown = providerDropdownRef.value;
  const target = e.target as Node;
  if (trigger?.contains(target) || dropdown?.contains(target)) return;
  providerPickerOpen.value = false;
}

function onProviderPickerOpenChange(open: boolean) {
  if (open) {
    window.addEventListener("resize", handleProviderViewportChange);
    document.addEventListener("scroll", handleProviderViewportChange, true);
  } else {
    window.removeEventListener("resize", handleProviderViewportChange);
    document.removeEventListener("scroll", handleProviderViewportChange, true);
  }
}

watch(providerPickerOpen, onProviderPickerOpenChange);

onMounted(() => {
  document.addEventListener("mousedown", handleProviderPickerOutsideClick, true);
  document.addEventListener("mousedown", handleTokenPopoverOutsideClick, true);
  document.addEventListener("mousedown", handleOutlineOutsideClick, true);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", handleProviderPickerOutsideClick, true);
  document.removeEventListener("mousedown", handleTokenPopoverOutsideClick, true);
  document.removeEventListener("mousedown", handleOutlineOutsideClick, true);
  onProviderPickerOpenChange(false);
});

function checkScrollPosition() {
  const el = chatScrollRef.value;
  if (!el) { isAtBottom.value = true; return; }
  isAtBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight <= CHAT_SCROLL_BOTTOM_THRESHOLD;
}

function onScroll() {
  // During eased follow the scroll writes are programmatic — keep the pin and
  // bottom state untouched so a single frame's remaining distance (a large block
  // landing at once) can't be mistaken for the user scrolling away.
  if (followActive) return;
  checkScrollPosition();
  emit("on-chat-scroll");
}

function scrollToBottom() {
  const el = chatScrollRef.value;
  if (!el) return;
  stopFollow();
  isAtBottom.value = true;
  // Parent only re-pins; animation stays in this component so a hard jump
  // cannot cancel the spring / smooth glide.
  emit("scroll-to-bottom");
  if (prefersReducedMotion()) {
    scrollContainerToBottom(el);
    emit("on-chat-scroll");
    return;
  }
  followActive = true;
  followVelocity = 0;
  followLastTs = 0;
  followRaf = requestAnimationFrame(stepFollow);
}

let followRaf = 0;
let followActive = false;
let followVelocity = 0;
let followLastTs = 0;

function stopFollow() {
  if (followRaf) cancelAnimationFrame(followRaf);
  followRaf = 0;
  followActive = false;
  followVelocity = 0;
  followLastTs = 0;
}

/**
 * Spring glide toward bottom. While a run streams, keep the loop warm even at
 * bottom so the next content growth is chased without a restart gap.
 */
function stepFollow(ts: number) {
  followRaf = 0;
  const el = chatScrollRef.value;
  if (!el || !followActive) return;

  if (prefersReducedMotion()) {
    el.scrollTop = el.scrollHeight;
    followVelocity = 0;
    if (!props.chatSending) {
      followActive = false;
      followLastTs = 0;
      isAtBottom.value = true;
      emit("on-chat-scroll");
      return;
    }
    followLastTs = ts;
    followRaf = requestAnimationFrame(stepFollow);
    return;
  }

  const last = followLastTs || ts;
  const dt = Math.min(0.064, Math.max(0.001, (ts - last) / 1000));
  followLastTs = ts;

  const { nextScrollTop, velocity, atBottom, settled } = computeScrollFollowStep(
    el.scrollTop,
    el.scrollHeight,
    el.clientHeight,
    followVelocity,
    dt,
  );
  followVelocity = velocity;
  if (nextScrollTop !== el.scrollTop) {
    el.scrollTop = nextScrollTop;
  }

  if (settled && !props.chatSending) {
    followActive = false;
    followVelocity = 0;
    followLastTs = 0;
    isAtBottom.value = true;
    emit("on-chat-scroll");
    return;
  }

  isAtBottom.value = atBottom || isAtBottom.value;
  followRaf = requestAnimationFrame(stepFollow);
}

/** Animated follow used while a run streams — spring glide, coalesced per frame. */
function followToBottom() {
  if (!chatScrollRef.value) return;
  isAtBottom.value = true;
  if (followActive) return;
  followActive = true;
  followVelocity = 0;
  followLastTs = 0;
  followRaf = requestAnimationFrame(stepFollow);
}

function onUserScrollIntent() {
  stopFollow();
  checkScrollPosition();
}

/** Scrollbar drag lands on the scroll element itself; text selection does not. */
function onScrollbarMouseDown(e: MouseEvent) {
  if (e.target !== chatScrollRef.value) return;
  stopFollow();
}

const FOLLOW_KEYS = new Set(["PageUp", "PageDown", "ArrowUp", "ArrowDown", "Home", "End", " "]);

function onFollowKeydown(e: KeyboardEvent) {
  if (FOLLOW_KEYS.has(e.key)) stopFollow();
}

function scheduleSessionScrollToBottom() {
  if (props.switchingSession || !props.chatMessages.length) return;
  stopFollow();
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
    sessionGoalExpanded.value = false;
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
  window.addEventListener("keydown", onFollowKeydown, true);
  void nextTick(() => {
    checkScrollPosition();
    const scrollEl = chatScrollRef.value;
    if (!scrollEl || typeof ResizeObserver === "undefined") return;
    const contentEl = scrollEl.querySelector(".msg-list") ?? scrollEl;
    scrollResizeObserver = new ResizeObserver(() => {
      // Eased follow locally while a live run grows the content, instead of
      // emitting `scroll-to-bottom` (the parent's force path schedules repeated
      // timed hard jumps → visible stutter).
      if (sessionScrollPending || (props.chatSending && isAtBottom.value)) {
        followToBottom();
        return;
      }
      checkScrollPosition();
    });
    scrollResizeObserver.observe(contentEl);
  });
});

onUnmounted(() => {
  scrollResizeObserver?.disconnect();
  scrollResizeObserver = null;
  stopFollow();
  if (sessionScrollClearTimer) { clearTimeout(sessionScrollClearTimer); sessionScrollClearTimer = null; }
  window.removeEventListener("keydown", onFollowKeydown, true);
});

defineExpose({ chatScrollRef, chatDropZoneRef, followToBottom, scrollToBottom });
</script>

<style src="./styles/ChatPanel.scss" scoped></style>

