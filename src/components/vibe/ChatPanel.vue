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
    <div class="chat-panel-main">
      <!--
        会话头：当前会话标题 + 「大纲」入口。
        大纲原先挤在输入框下方的操作行里，离消息远、点开还要往上顶消息；
        挪到消息列表上方，打开后向下展开、就近跳转。
      -->
      <div v-if="projectOpened" class="chat-session-head">
        <span class="chat-session-title" :title="activeSessionTitle || '新会话'">
          {{ activeSessionTitle || "新会话" }}
        </span>
        <div
          v-if="sessionOutline.length"
          ref="outlineWrapRef"
          class="session-outline-wrap"
        >
          <button
            ref="outlineButtonRef"
            type="button"
            class="session-outline-trigger"
            :class="{ active: outlineOpen }"
            :title="outlineOpen ? '收起会话大纲' : '会话大纲：本会话问过的问题（↑↓ 选择，回车跳转）'"
            :aria-expanded="outlineOpen"
            aria-haspopup="dialog"
            @click="toggleOutline"
            @keydown="onOutlineButtonKeydown"
          >
            <svg
              class="session-outline-icon"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="3" cy="4" r="1" fill="currentColor" />
              <circle cx="3" cy="8" r="1" fill="currentColor" />
              <circle cx="3" cy="12" r="1" fill="currentColor" />
              <path
                d="M6.2 4h7.3M6.2 8h7.3M6.2 12h5"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
              />
            </svg>
            <span class="session-outline-label">大纲</span>
            <span class="session-outline-count">{{ sessionOutline.length }}</span>
          </button>
        </div>

        <div
          v-if="outlineOpen"
          ref="outlinePopoverRef"
          class="session-outline-popover"
          role="dialog"
          aria-label="会话大纲"
        >
          <div class="session-outline-head">
            <span class="session-outline-title">本会话问题</span>
            <span class="session-outline-meta">{{ sessionOutline.length }} 条</span>
          </div>
          <ol
            class="session-outline-list"
            role="listbox"
            aria-label="本会话问题"
            @keydown="onOutlineListKeydown"
          >
            <li v-for="item in sessionOutline" :key="item.id" role="none">
              <button
                :id="`outline-item-${item.index}`"
                type="button"
                role="option"
                class="session-outline-item"
                :class="{ active: item.id === outlineActiveId }"
                :tabindex="item.id === outlineActiveId ? 0 : -1"
                :aria-selected="item.id === outlineActiveId"
                :data-outline-index="item.index"
                :title="item.preview"
                @click="jumpToOutlineItem(item.id)"
                @mouseenter="outlineActiveId = item.id"
              >
                <span class="session-outline-index">{{ item.index }}</span>
                <span class="session-outline-preview">{{ item.preview }}</span>
              </button>
            </li>
          </ol>
        </div>
      </div>

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

      <!-- 会话导航导轨：一列小横杠对应用户提问，悬浮展开成右对齐的消息目录；
           带比例滑块，替代被隐藏的原生滚动条 -->
      <ChatScrollRail
        v-if="railVisible"
        :items="sessionOutline"
        :anchors="railAnchors"
        :viewport="railViewport"
        @jump="jumpToOutlineItem"
        @scrub="onRailScrub"
      />
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
        <div v-if="presetOpen" class="mention-dropdown preset-dropdown">
          <button
            v-for="(item, idx) in presetResults"
            :key="item.id"
            type="button"
            class="mention-item"
            :class="{ active: idx === presetActiveIndex }"
            @mousedown.prevent="$emit('select-preset', item)"
          >
            <span class="mention-item-name">{{ item.name || "未命名预设" }}</span>
            <span class="preset-item-preview">{{ presetPreview(item.content) }}</span>
          </button>
          <div v-if="!presetResults.length" class="preset-dropdown-empty">无匹配预设</div>
          <button
            type="button"
            class="preset-manage-entry"
            @mousedown.prevent="$emit('open-preset-manager')"
          >
            管理预设…
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
            <button
              type="button"
              class="chat-debug-toggle"
              :class="{ active: traceDrawerState.open }"
              :title="traceButtonTitle"
              @click="onTraceButton"
            >
              轨迹
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
                <span class="chat-provider-trigger-label">{{ activeProviderModel }}</span>
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
                    <p v-if="!filteredProviderOptions.length" class="chat-provider-empty">
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
                :title="`${showTokenDetail ? '收起用量详情' : '查看用量详情'}：${totalTokenUsage}`"
                :aria-label="`上下文用量：${totalTokenUsage}`"
                @click="$emit('update:showTokenDetail', !showTokenDetail)"
              >
                <svg class="token-usage-ring" viewBox="0 0 36 36" aria-hidden="true">
                  <circle class="token-usage-ring-track" cx="18" cy="18" r="15" />
                  <circle
                    class="token-usage-ring-fill"
                    :class="{ 'is-high': contextUsageRatio >= 0.85 }"
                    cx="18"
                    cy="18"
                    r="15"
                    :style="{ strokeDashoffset: tokenRingDashOffset }"
                  />
                </svg>
              </button>
              <span v-if="statusMetricChips.length" class="token-status-chips">
                <span
                  v-for="chip in statusMetricChips"
                  :key="chip.id"
                  class="token-status-chip"
                  :title="chip.title"
                >{{ chip.text }}</span>
              </span>
              <button
                ref="statusConfigBtnRef"
                type="button"
                class="status-config-btn"
                :class="{ open: statusConfigOpen }"
                title="配置底部显示哪些信息"
                aria-label="配置底部显示哪些信息"
                @click="toggleStatusConfig"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="8" cy="8" r="2.1" stroke="currentColor" stroke-width="1.3" />
                  <path d="M8 1.6l1 1.7 2-.4.4 2 1.7 1-1 1.6 1 1.7-2 .4-.4 2-2-.4-1 1.7-1-1.7-2 .4-.4-2-1.7-1 1-1.6-1-1.7 2-.4.4-2 2 .4z" stroke="currentColor" stroke-width="1.05" stroke-linejoin="round" />
                </svg>
              </button>
              <Teleport to="body">
                <div
                  v-if="statusConfigOpen"
                  ref="statusConfigRef"
                  class="status-config-popover"
                  :style="{ position: 'fixed', top: statusConfigTop + 'px', right: statusConfigRight + 'px' }"
                >
                  <div class="status-config-title">底部显示项</div>
                  <label
                    v-for="metric in CHAT_STATUS_METRICS"
                    :key="metric.id"
                    class="status-config-row"
                  >
                    <input
                      type="checkbox"
                      :checked="statusMetrics.includes(metric.id)"
                      @change="toggleStatusMetric(metric.id, ($event.target as HTMLInputElement).checked)"
                    />
                    <span>{{ metric.label }}</span>
                  </label>
                </div>
              </Teleport>
              <Teleport to="body">
                <div
                  v-if="showTokenDetail && tokenDetailData"
                  ref="tokenPopoverRef"
                  class="token-detail-popover"
                  :style="{ position: 'fixed', top: tokenPopoverTop + 'px', right: tokenPopoverRight + 'px' }"
                >
                  <!-- 头部：大圆环 + 上下文占用一眼可见，细节收进下面分组 -->
                  <div class="token-detail-head">
                    <svg class="token-ring-big" viewBox="0 0 36 36" aria-hidden="true">
                      <circle class="token-ring-big-track" cx="18" cy="18" r="15" />
                      <circle
                        class="token-ring-big-fill"
                        :class="{ 'is-high': contextUsageRatio >= 0.85 }"
                        cx="18"
                        cy="18"
                        r="15"
                        :style="{ strokeDashoffset: tokenRingDashOffset }"
                      />
                    </svg>
                    <div class="token-detail-head-text">
                      <div class="token-detail-head-title">上下文占用</div>
                      <div class="token-detail-head-value">
                        <template v-if="tokenDetailData.usesTokenContext">
                          {{ formatTokenCount(tokenDetailData.usedContextTokens) }}
                          <span class="token-detail-head-limit">/ {{ formatTokenCount(tokenDetailData.contextLimitTokens) }}</span>
                        </template>
                        <template v-else>
                          {{ formatCharCount(tokenDetailData.usedContextChars) }} 字符
                        </template>
                      </div>
                      <div v-if="tokenDetailData.usesTokenContext" class="token-detail-head-sub">
                        {{ tokenUsagePercent }}%
                        <span
                          v-if="contextLimitIsEstimate"
                          class="token-detail-estimate"
                          title="上限来自内置估算表，非模型自报；可在 AI 配置里手填真实值"
                        >内置估算</span>
                      </div>
                    </div>
                  </div>

                  <div class="token-detail-section">
                    <div class="token-detail-section-title">上下文</div>
                    <div class="token-detail-row">
                      <span>已用</span>
                      <span v-if="tokenDetailData.usesTokenContext">{{ formatTokenCount(tokenDetailData.usedContextTokens) }} token</span>
                      <span v-else>{{ formatCharCount(tokenDetailData.usedContextChars) }} 字符</span>
                    </div>
                    <div v-if="tokenDetailData.usesTokenContext" class="token-detail-row">
                      <span>上限</span>
                      <span>{{ formatTokenCount(tokenDetailData.contextLimitTokens) }} token</span>
                    </div>
                    <div
                      v-if="tokenDetailData.usesTokenContext && tokenDetailData.peakContextTokens > tokenDetailData.usedContextTokens"
                      class="token-detail-row"
                    >
                      <span>峰值</span>
                      <span>{{ formatTokenCount(tokenDetailData.peakContextTokens) }} token</span>
                    </div>
                    <div
                      v-if="!tokenDetailData.usesTokenContext && tokenDetailData.maxContextChars > tokenDetailData.usedContextChars"
                      class="token-detail-row"
                    >
                      <span>峰值</span>
                      <span>{{ formatCharCount(tokenDetailData.maxContextChars) }} 字符</span>
                    </div>
                  </div>

                  <div v-if="tokenDetailData.totalCompletionTokens > 0 || tokenDetailData.totalStreamChars > 0" class="token-detail-section">
                    <div class="token-detail-section-title">输出</div>
                    <div v-if="tokenDetailData.totalCompletionTokens > 0" class="token-detail-row">
                      <span>累计 token</span>
                      <span>{{ formatTokenCount(tokenDetailData.totalCompletionTokens) }} token</span>
                    </div>
                    <div v-if="tokenDetailData.totalStreamChars > 0" class="token-detail-row">
                      <span>累计正文字符</span>
                      <span>{{ formatCharCount(tokenDetailData.totalStreamChars) }}</span>
                    </div>
                  </div>

                  <div v-if="tokenDetailData.outputTokensPerSecond !== undefined || tokenDetailData.ttftMs !== undefined" class="token-detail-section">
                    <div class="token-detail-section-title">速度</div>
                    <div v-if="tokenDetailData.outputTokensPerSecond !== undefined" class="token-detail-row">
                      <span>输出速度</span>
                      <span>{{ formatSpeed(tokenDetailData.outputTokensPerSecond) }} token/s</span>
                    </div>
                    <div v-if="tokenDetailData.ttftMs !== undefined" class="token-detail-row">
                      <span>首字延迟</span>
                      <span>{{ formatMs(tokenDetailData.ttftMs) }}</span>
                    </div>
                  </div>

                  <div v-if="tokenDetailData.cacheHitRatio !== undefined || tokenDetailData.cacheHitTokens > 0 || tokenDetailData.cachePromptTokens > 0" class="token-detail-section">
                    <div class="token-detail-section-title">缓存</div>
                    <div v-if="tokenDetailData.cachePromptTokens > 0" class="token-detail-row">
                      <span>输入 token</span>
                      <span>{{ tokenDetailData.cachePromptTokens.toLocaleString() }}</span>
                    </div>
                    <div v-if="tokenDetailData.cacheHitTokens > 0" class="token-detail-row">
                      <span>命中 token</span>
                      <span>{{ tokenDetailData.cacheHitTokens.toLocaleString() }}</span>
                    </div>
                    <div v-if="tokenDetailData.cacheHitRatio !== undefined" class="token-detail-row">
                      <span>命中率</span>
                      <span>{{ Math.round(tokenDetailData.cacheHitRatio * 100) }}%</span>
                    </div>
                  </div>

                  <div class="token-detail-section">
                    <div class="token-detail-section-title">运行</div>
                    <div class="token-detail-row">
                      <span>助手回复</span>
                      <span>{{ tokenDetailData.assistantCount }} 条</span>
                    </div>
                    <div v-if="tokenDetailData.agentTurns > 0" class="token-detail-row">
                      <span>Agent 轮次</span>
                      <span>{{ tokenDetailData.agentTurns }}</span>
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
                    <div class="token-detail-row">
                      <span>消息总数</span>
                      <span>{{ tokenDetailData.totalMessages }}</span>
                    </div>
                  </div>
                </div>
              </Teleport>
            </div>
          </div>
          <div class="chat-actions">
            <template v-if="chatSending">
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

    <div
      v-if="presetManagerOpen"
      class="project-memory-overlay"
      @mousedown.self="$emit('close-preset-manager')"
    >
      <div class="project-memory-dialog preset-manager-dialog" role="dialog" aria-labelledby="prompt-preset-title">
        <div class="project-memory-head">
          <div>
            <h3 id="prompt-preset-title" class="project-memory-title">预设提示词</h3>
            <p class="project-memory-desc">
              在输入框敲「/」即可唤起；选中只填入不发送，可继续补充后再回车。全局共享，存于本机。
            </p>
          </div>
          <button
            type="button"
            class="ghost small project-memory-close"
            @click="$emit('close-preset-manager')"
          >
            ×
          </button>
        </div>

        <div class="preset-manager-list">
          <div v-for="item in presets" :key="item.id" class="preset-manager-row">
            <input
              class="preset-manager-name"
              type="text"
              placeholder="名称（用于 / 匹配）"
              :value="item.name"
              @input="$emit('update-preset', item.id, { name: getEventValue($event) })"
            />
            <button
              type="button"
              class="preset-manager-delete"
              title="删除该预设"
              @click="$emit('remove-preset', item.id)"
            >
              ×
            </button>
            <textarea
              class="preset-manager-content"
              placeholder="选中后填入输入框的正文"
              :value="item.content"
              @input="$emit('update-preset', item.id, { content: getEventValue($event) })"
            />
          </div>
          <div v-if="!presets.length" class="project-memory-status">暂无预设，点「新增」开始。</div>
        </div>

        <div class="project-memory-foot">
          <span class="project-memory-counter">共 {{ presets.length }} 条</span>
          <div class="project-memory-actions">
            <button type="button" class="ghost small" @click="$emit('reset-presets')">恢复内置默认</button>
            <button type="button" class="ghost small" @click="$emit('add-preset')">新增</button>
            <button type="button" class="primary small" @click="$emit('close-preset-manager')">完成</button>
          </div>
        </div>
      </div>
    </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, withDefaults, type CSSProperties } from "vue";

import { contextRingDashOffset } from "../../utils/tokenRing";
import { formatMs, formatSpeed } from "../../utils/runStats";
import {
  CHAT_STATUS_METRICS,
  DEFAULT_CHAT_STATUS_METRICS,
  type ChatStatusMetricId,
} from "../../utils/chatStatusBarPreference";
import type { AgentSuggestion } from "../../services/agentSuggestions";
import type { PendingMemoryProposal } from "../../services/projectMemoryProposal";
import type { PendingSkillProposal } from "../../services/projectSkillProposal";
import type { ExplorationIndexEntry, SkillIndexEntry, SkillKind } from "../../services/projectSkills";
import {
  longTermMemoryScopeLabel,
  type LongTermMemoryEntry,
} from "../../services/vibeLongTermMemoryClient";
import type { ProjectMemoryTab } from "../../composables/useProjectMemory";
import { CHAT_SCROLL_BOTTOM_THRESHOLD, formatCharCount, formatTokenCount, getEventValue } from "../../utils/vibeHelpers";
import { chatScrollProbe, readScrollGeometry } from "../../utils/chatScrollProbe";
import {
  decideFollowAfterContentGrowth,
  decideFollowAfterUserInput,
  shouldRecoverFollowOnScroll,
} from "../../utils/chatFollowScroll";
import {
  computeScrollFollowStep,
  prefersReducedMotion,
  scheduleScrollContainerToBottom,
  scrollContainerToBottom,
  SCROLL_FOLLOW_SNAP_PX,
} from "../../utils/scrollViewport";
import { resolveAgentResumeButtonLabel } from "../../services/agentRecovery";
import { renderMarkdown } from "../../utils/renderMarkdown";
import { buildSessionOutline } from "../../utils/sessionOutline";
import type { ChatRailAnchorInput } from "../../utils/chatScrollRail";
import { closeTraceDrawer, openLatestTraceDrawer, useAgentTraceDrawerState } from "../../services/agentTraceDrawer";
import AgentLiveStatusRail from "../AgentLiveStatusRail.vue";
import ChatScrollRail from "./ChatScrollRail.vue";

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

interface PromptPresetItem {
  id: string;
  name: string;
  content: string;
}

/** 下拉里预设正文的单行预览 */
function presetPreview(content: string): string {
  const text = content.replace(/\s+/g, " ").trim();
  if (!text) return "（空）";
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

interface TokenDetailData {
  assistantCount: number;
  totalStreamChars: number;
  /** 当前/最近一轮实际占用的上下文字符数 */
  usedContextChars: number;
  /** 会话内峰值占用 */
  maxContextChars: number;
  /** 真实 token 口径：最近一轮 prompt token 数 */
  usedContextTokens: number;
  /** 真实 token 口径：会话内峰值 prompt token 数 */
  peakContextTokens: number;
  /** 真实 token 口径：供应商上报的输出 token 总量（跨 turn 累加，缺省为 0） */
  totalCompletionTokens: number;
  /** 当前模型真实上下文窗口（token 数） */
  contextLimitTokens: number;
  /** 窗口值来源：override(手填) / reported(供应商) / static(内置表) / fallback(兜底) */
  contextLimitSource?: "override" | "reported" | "static" | "fallback";
  /** 是否有 token 口径数据（供应商上报了 usage） */
  usesTokenContext: boolean;
  totalMessages: number;
  toolCallCount: number;
  writtenFilesCount: number;
  imageCount: number;
  agentTurns: number;
  cachePromptTokens: number;
  cacheHitTokens: number;
  cacheHitRatio?: number;
  /** 最近一轮首字延迟（ms）。 */
  ttftMs?: number;
  /** 输出速度（token/s），仅在 token 与解码窗口配对的轮次上算得。 */
  outputTokensPerSecond?: number;
  /** 参与速度配对的轮次数（分子分母同源）。 */
  speedSampleTurns?: number;
  /** 上报了输出 token 的轮次数；大于 speedSampleTurns 说明速度只覆盖部分轮次。 */
  speedTokenTurns?: number;
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
  /** 当前会话标题，显示在聊天面板顶部会话头。 */
  activeSessionTitle?: string;
  isDragging: boolean;
  editorCollapsed: boolean;
  mentionOpen: boolean;
  mentionResults: MentionItem[];
  mentionActiveIndex: number;
  presetOpen?: boolean;
  presetResults?: PromptPresetItem[];
  presetActiveIndex?: number;
  presetManagerOpen?: boolean;
  presets?: PromptPresetItem[];
  chatInputFocused: boolean;
  totalTokenUsage?: string;
  showTokenDetail?: boolean;
  tokenDetailData?: TokenDetailData | null;
  /** 底部栏显示的指标 id 列表（来自用户全局配置）。 */
  statusMetrics?: ChatStatusMetricId[];
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
  providerOptions?: Array<{ id: string; name: string; model: string; availableModels?: string[]; modelWindows?: Record<string, number> }>;
  globalModelName: string;
}

const props = withDefaults(defineProps<Props>(), {
  switchingSession: false,
  switchingProject: false,
  presetOpen: false,
  presetResults: () => [],
  presetActiveIndex: 0,
  presetManagerOpen: false,
  presets: () => [],
  totalTokenUsage: "",
  showTokenDetail: false,
  tokenDetailData: null,
  statusMetrics: () => [...DEFAULT_CHAT_STATUS_METRICS],
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
	activeSessionTitle: "",
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
  (e: "select-preset", item: PromptPresetItem): void;
  (e: "open-preset-manager"): void;
  (e: "close-preset-manager"): void;
  (e: "add-preset"): void;
  (e: "update-preset", id: string, patch: { name?: string; content?: string }): void;
  (e: "remove-preset", id: string): void;
  (e: "reset-presets"): void;
  (e: "on-chat-scroll"): void;
  (e: "scroll-to-bottom"): void;
  (e: "on-chat-drag-enter", event: DragEvent): void;
  (e: "on-chat-drag-over", event: DragEvent): void;
  (e: "on-chat-drag-leave", event: DragEvent): void;
  (e: "on-chat-drop", event: DragEvent): void;
  (e: "update:showTokenDetail", value: boolean): void;
  (e: "update:statusMetrics", value: ChatStatusMetricId[]): void;
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
/**
 * 是否处于「跟随到底部」状态（决定内容增长时要不要自动滚）。
 * 只在两个时刻更新：用户输入事件、内容增长后的恢复判定。**绝不由 scroll 事件驱动。**
 */
const isAtBottom = ref(true);
/** 视觉上是否贴近底部（决定「回到底部」按钮显隐），容差 30px。与跟随状态相互独立。 */
const isVisuallyAtBottom = ref(true);
const showScrollToBottom = computed(() => !isVisuallyAtBottom.value && props.chatMessages.length > 0);

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

/** 全局标签形如「供应商 / 模型」，触发器只要模型段。 */
function modelSegmentOf(label: string): string {
  const text = label.trim();
  const sep = text.lastIndexOf(" / ");
  return sep >= 0 ? text.slice(sep + 3).trim() || text : text;
}

/** 触发器只显示模型名（供应商名太长会挤掉它）；供应商信息放 tooltip。 */
const activeProviderModel = computed(() => {
  const id = props.activeSessionProviderId.trim();
  if (!id) return modelSegmentOf(props.globalModelName) || "未设置";
  const provider = props.providerOptions?.find((p) => p.id === id);
  if (!provider) return "自定义";
  return props.activeSessionModelId?.trim() || provider.model || provider.name || "未设置";
});

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
/** 上下文占用比例（0~1），驱动用量圆环的进度弧。 */
const contextUsageRatio = computed(() => {
  const used = props.tokenDetailData?.usedContextTokens ?? 0;
  const limit = props.tokenDetailData?.contextLimitTokens ?? 0;
  // 只有供应商真实上报了 usage 才有分子；缺 token 口径时不给假进度（保持空环）。
  if (limit <= 0 || used <= 0) return 0;
  return Math.min(1, Math.max(0, used / limit));
});
/** SVG stroke-dashoffset：r=15 → 周长约 94.25，占用越多偏移越小。 */
const tokenRingDashOffset = computed(() => contextRingDashOffset(contextUsageRatio.value, 15));
/** 占用百分比（整数，用于弹层头部文案）。 */
const tokenUsagePercent = computed(() => Math.round(contextUsageRatio.value * 100));
/** 上限是否来自内置估算表（非模型自报）——估算值要在界面上标明，别当成真值。 */
const contextLimitIsEstimate = computed(
  () => props.tokenDetailData?.contextLimitSource === "static" || props.tokenDetailData?.contextLimitSource === "fallback",
);

/**
 * 底部栏指标 chip：把用户配置的 id 列表映射成「有数据的」展示文本。
 * 缺数据的项直接不渲染（例如供应商没报速度就不显示速度），所以配置是"想显示哪些"，
 * 最终显示 = 想显示 ∩ 有数据。
 */
const statusMetricChips = computed<Array<{ id: ChatStatusMetricId; text: string; title: string }>>(() => {
  const ids = props.statusMetrics ?? [];
  if (!ids.length) return [];
  const d = props.tokenDetailData;
  const chips: Array<{ id: ChatStatusMetricId; text: string; title: string }> = [];
  for (const id of ids) {
    switch (id) {
      case "speed": {
        const tps = d?.outputTokensPerSecond;
        if (tps === undefined) break;
        const sampled = d?.speedSampleTurns ?? 0;
        chips.push({
          id,
          text: `${formatSpeed(tps)} tok/s`,
          title: sampled > 0
            ? `输出速度：按 ${sampled} 次运行中「token + 解码窗口」同时上报的样本计算`
            : "输出速度",
        });
        break;
      }
      case "ttft": {
        const ttft = d?.ttftMs;
        if (ttft === undefined) break;
        chips.push({ id, text: `首字 ${formatMs(ttft)}`, title: `首字延迟（最近一轮）：${formatMs(ttft)}` });
        break;
      }
      case "context": {
        if (!d?.usesTokenContext) break;
        chips.push({ id, text: `${tokenUsagePercent.value}%`, title: `上下文占用：${tokenUsagePercent.value}%` });
        break;
      }
      case "output": {
        if (!d?.totalCompletionTokens) break;
        chips.push({ id, text: `${formatTokenCount(d.totalCompletionTokens)} 输出`, title: "本会话累计输出 token" });
        break;
      }
      case "cache": {
        if (d?.cacheHitRatio === undefined) break;
        const pct = Math.round(d.cacheHitRatio * 100);
        chips.push({ id, text: `缓存 ${pct}%`, title: `缓存命中率（整会话累计）：${pct}%` });
        break;
      }
      case "tools": {
        if (!d?.toolCallCount) break;
        chips.push({ id, text: `${d.toolCallCount} 工具`, title: `工具调用：${d.toolCallCount} 次` });
        break;
      }
      case "files": {
        if (!d?.writtenFilesCount) break;
        chips.push({ id, text: `${d.writtenFilesCount} 文件`, title: `写入文件：${d.writtenFilesCount} 个` });
        break;
      }
      case "turns": {
        if (!d?.agentTurns) break;
        chips.push({ id, text: `${d.agentTurns} 轮`, title: `Agent 轮次：${d.agentTurns}` });
        break;
      }
      default:
        break;
    }
  }
  return chips;
});
const tokenPopoverRef = ref<HTMLElement | null>(null);
const tokenPopoverTop = ref(0);
const tokenPopoverRight = ref(0);

/** 底部显示项配置弹层。 */
const statusConfigOpen = ref(false);
const statusConfigBtnRef = ref<HTMLElement | null>(null);
const statusConfigRef = ref<HTMLElement | null>(null);
const statusConfigTop = ref(0);
const statusConfigRight = ref(0);

function updateStatusConfigPosition() {
  const btn = statusConfigBtnRef.value;
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const pop = statusConfigRef.value;
  const popHeight = pop?.offsetHeight ?? 0;
  const gap = 6;
  const spaceAbove = rect.top - gap;
  const spaceBelow = window.innerHeight - rect.bottom - gap;
  const openDown = spaceAbove < popHeight && spaceBelow > spaceAbove;
  statusConfigTop.value = openDown ? rect.bottom + gap : Math.max(gap, rect.top - popHeight - gap);
  statusConfigRight.value = Math.max(8, window.innerWidth - rect.right);
}

function toggleStatusConfig() {
  statusConfigOpen.value = !statusConfigOpen.value;
  if (statusConfigOpen.value) nextTick(updateStatusConfigPosition);
}

function handleStatusConfigViewportChange() {
  if (statusConfigOpen.value) updateStatusConfigPosition();
}

watch(statusConfigOpen, (open) => {
  if (open) {
    window.addEventListener("resize", handleStatusConfigViewportChange);
    document.addEventListener("scroll", handleStatusConfigViewportChange, true);
  } else {
    window.removeEventListener("resize", handleStatusConfigViewportChange);
    document.removeEventListener("scroll", handleStatusConfigViewportChange, true);
  }
});

function handleStatusConfigOutsideClick(e: MouseEvent) {
  if (!statusConfigOpen.value) return;
  const target = e.target as Node;
  if (statusConfigBtnRef.value?.contains(target) || statusConfigRef.value?.contains(target)) return;
  statusConfigOpen.value = false;
}

/** 勾选 / 取消：把变更回传给父级（父级负责持久化）。 */
function toggleStatusMetric(id: ChatStatusMetricId, checked: boolean) {
  const current = props.statusMetrics ?? [];
  const next = checked ? [...new Set([...current, id])] : current.filter((m) => m !== id);
  emit("update:statusMetrics", next);
}

const outlineOpen = ref(false);
const outlineWrapRef = ref<HTMLElement | null>(null);
const outlineButtonRef = ref<HTMLButtonElement | null>(null);
const outlinePopoverRef = ref<HTMLElement | null>(null);
/** 当前高亮的问题 id。键盘移动 / 鼠标悬停 / 刚跳转过的那条都会更新它。 */
const outlineActiveId = ref<string | null>(null);

const sessionOutline = computed(() => buildSessionOutline(props.chatMessages));

/**
 * 会话导航导轨的几何：
 * - `railAnchors` 从滚动区里按 sessionOutline 的顺序查出每个提问消息块的 offsetTop/高度；
 *   注意只取 user 消息（和 outline 同源），保证刻度和浮层条目一一对齐。
 * - `railViewport` 是滚动容器当前几何，滚动时更新。
 * - 内容不足一屏 / 没有提问时 `railVisible=false`，整条导轨不渲染。
 */
const railAnchors = ref<ChatRailAnchorInput[]>([]);
const railViewport = ref({ scrollTop: 0, clientHeight: 0, scrollHeight: 0 });
const railVisible = computed(
  () =>
    sessionOutline.value.length > 0 &&
    railViewport.value.scrollHeight > railViewport.value.clientHeight + 1 &&
    railAnchors.value.length > 0,
);

let railMeasureRaf = 0;

/** 量一次每条提问消息块的位置（offsetTop 相对滚动内容，与 scrollTop 同坐标系）。 */
function measureRailAnchors(): void {
  const scrollEl = chatScrollRef.value;
  const anchors: ChatRailAnchorInput[] = [];
  if (scrollEl) {
    for (const item of sessionOutline.value) {
      const escaped =
        typeof CSS !== "undefined" && "escape" in CSS
          ? CSS.escape(item.id)
          : item.id.replace(/"/g, '\\"');
      const el = scrollEl.querySelector<HTMLElement>(`[data-message-id="${escaped}"]`);
      if (!el) continue;
      anchors.push({ id: item.id, top: el.offsetTop, height: el.offsetHeight });
    }
  }
  railAnchors.value = anchors;
  readRailViewport();
}

/** 只读滚动几何，滚动期间每帧调用，代价很低。 */
function readRailViewport(): void {
  const el = chatScrollRef.value;
  if (!el) return;
  railViewport.value = {
    scrollTop: el.scrollTop,
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
  };
}

/** 消息增减 / 高度变化时重算刻度（rAF 合并高频变更）。 */
function scheduleRailMeasure(): void {
  if (railMeasureRaf) return;
  railMeasureRaf = requestAnimationFrame(() => {
    railMeasureRaf = 0;
    measureRailAnchors();
  });
}

/**
 * 数据流轨迹：Agent 思考/执行时自动在右侧展开，也是查看思考过程的唯一面板。
 * 按钮点击在「打开 / 收起」间切换；自动展开开关见 `agentTraceDrawer.autoEnabled`。
 */
const traceDrawerState = useAgentTraceDrawerState();

const traceButtonTitle = computed(() =>
  traceDrawerState.open
    ? "收起数据流轨迹（含思考过程）"
    : traceDrawerState.autoEnabled
      ? "查看数据流轨迹（含思考过程）；Agent 思考时会自动展开"
      : "查看数据流轨迹（含思考过程）；自动展开已关闭",
);

function onTraceButton() {
  if (traceDrawerState.open) {
    closeTraceDrawer();
    return;
  }
  openLatestTraceDrawer();
}

/**
 * 会话大纲浮层的位置完全由 CSS 负责（从顶部会话头的「大纲」按钮向下展开），
 * 所以这里不再有「量按钮位置 → 手算 fixed top/right → 监听 resize/scroll 重算」那套。
 */
function setOutlineActiveByIndex(index: number, focus = false): void {
  const items = sessionOutline.value;
  if (!items.length) return;
  const clamped = Math.min(Math.max(index, 0), items.length - 1);
  const item = items[clamped];
  if (!item) return;
  outlineActiveId.value = item.id;
  if (!focus) return;
  nextTick(() => {
    const el = outlinePopoverRef.value?.querySelector<HTMLElement>(
      `[data-outline-index="${item.index}"]`,
    );
    el?.focus();
    el?.scrollIntoView({ block: "nearest" });
  });
}

function toggleOutline() {
  if (outlineOpen.value) {
    outlineOpen.value = false;
    return;
  }
  outlineOpen.value = true;
  // 默认停在最后一条（也就是当前视野里最新的那个问题）
  setOutlineActiveByIndex(sessionOutline.value.length - 1);
}

/** 键盘打开：顺便把焦点交给列表，才能直接按 ↑↓ */
function openOutlineAndFocus(): void {
  if (outlineOpen.value) return;
  outlineOpen.value = true;
  setOutlineActiveByIndex(sessionOutline.value.length - 1, true);
}

function closeOutline(): void {
  outlineOpen.value = false;
  nextTick(() => outlineButtonRef.value?.focus());
}

/**
 * 按钮上的键盘操作。Enter/Space 除了 toggle 还要把焦点交给列表，
 * 否则键盘打开后焦点还留在按钮上，↑↓ 走不到列表里。
 * （keydown 上 preventDefault 顺便挡掉回车提交 / 空格滚页。）
 */
function onOutlineButtonKeydown(e: KeyboardEvent): void {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    openOutlineAndFocus();
    return;
  }
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (outlineOpen.value) {
      closeOutline();
      return;
    }
    openOutlineAndFocus();
  }
}

function onOutlineListKeydown(e: KeyboardEvent): void {
  const items = sessionOutline.value;
  if (!items.length) return;
  const current = items.findIndex((item) => item.id === outlineActiveId.value);
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      setOutlineActiveByIndex(current < 0 ? 0 : current + 1, true);
      break;
    case "ArrowUp":
      e.preventDefault();
      setOutlineActiveByIndex(current < 0 ? items.length - 1 : current - 1, true);
      break;
    case "Home":
      e.preventDefault();
      setOutlineActiveByIndex(0, true);
      break;
    case "End":
      e.preventDefault();
      setOutlineActiveByIndex(items.length - 1, true);
      break;
    case "Enter":
    case " ": {
      const item = current >= 0 ? items[current] : undefined;
      if (!item) return;
      e.preventDefault();
      jumpToOutlineItem(item.id);
      break;
    }
    case "Escape":
      e.preventDefault();
      closeOutline();
      break;
    default:
      break;
  }
}

/**
 * 跳转后**不关**浮层：连着看/跳好几条时不用反复点开（这是旧版最难受的地方）。
 */
function jumpToOutlineItem(messageId: string) {
  outlineActiveId.value = messageId;
  detachFollowForJump();
  emit("jump-to-message", messageId);
}

/**
 * 跳历史前解除「跟随到底部」。
 *
 * 用户主动去看历史时，若仍处于跟随后，运行中的内容一长高就会把他拽回底部，
 * 表现为「跳过去又被弹回」。跟随状态由本组件持有，改完通过 `on-chat-scroll`
 * 通知父组件同步 pin。
 */
function detachFollowForJump() {
  stopFollow();
  isAtBottom.value = false;
  emit("on-chat-scroll");
}

/**
 * 拖动导轨比例滑块：直接写 scrollTop（相当于原生滚动条拖动）。
 * 拖拽本身是明确的用户滚动意图，要解除「跟随到底部」。
 */
function onRailScrub(scrollTop: number) {
  const el = chatScrollRef.value;
  if (!el) return;
  stopFollow();
  isAtBottom.value = false;
  el.scrollTop = scrollTop;
  isVisuallyAtBottom.value =
    el.scrollHeight - el.scrollTop - el.clientHeight <= CHAT_SCROLL_BOTTOM_THRESHOLD;
  readRailViewport();
  emit("on-chat-scroll");
}

function handleOutlineOutsideClick(e: MouseEvent) {
  if (!outlineOpen.value) return;
  const target = e.target as Node;
  if (outlineWrapRef.value?.contains(target) || outlinePopoverRef.value?.contains(target)) return;
  outlineOpen.value = false;
}

watch(
  () => props.activeSessionId,
  () => {
    outlineOpen.value = false;
    outlineActiveId.value = null;
  },
);

watch(sessionOutline, (items) => {
  // 只在浮层开着时兜底：流式期间这个 computed 每次消息 patch 都会重建，
  // 面板没开时没必要为「高亮项还在不在」白扫一遍。
  if (!outlineOpen.value) return;
  if (!items.length) {
    outlineOpen.value = false;
    return;
  }
  // 当前高亮的那条不在了（切了内容等），回退到最后一条
  if (outlineActiveId.value && !items.some((item) => item.id === outlineActiveId.value)) {
    outlineActiveId.value = items[items.length - 1]?.id ?? null;
  }
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
  document.addEventListener("mousedown", handleStatusConfigOutsideClick, true);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", handleProviderPickerOutsideClick, true);
  document.removeEventListener("mousedown", handleTokenPopoverOutsideClick, true);
  document.removeEventListener("mousedown", handleOutlineOutsideClick, true);
  document.removeEventListener("mousedown", handleStatusConfigOutsideClick, true);
  window.removeEventListener("resize", handleStatusConfigViewportChange);
  document.removeEventListener("scroll", handleStatusConfigViewportChange, true);
  onProviderPickerOpenChange(false);
});

/** 只更新「回到底部」按钮的显隐，不触碰跟随状态。 */
function checkScrollPosition() {
  const el = chatScrollRef.value;
  if (!el) { isVisuallyAtBottom.value = true; return; }
  isVisuallyAtBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight <= CHAT_SCROLL_BOTTOM_THRESHOLD;
}

function onScroll() {
  const el = chatScrollRef.value;

  // 1) 按钮显隐（视觉状态，30px 容差）—— 每次都更新。
  checkScrollPosition();

  // 导轨只读几何，代价低；放在最前，保证刻度/当前项跟手。
  readRailViewport();

  // 2) 「触底恢复跟随」—— 仅在不跟随时才可能为 true。
  //    未跟随时检测触底是必需的：用户滚到底后往往不再产生新的 wheel 事件，
  //    只靠用户输入事件判定会漏掉最后一次，表现为「滚回底部却不再跟随」。
  //    已跟随时该判定恒 false —— 跟随中的 scroll 来自程序自身写 scrollTop 或内容增长，
  //    此时 remaining 是弹簧瞬时落后，据此改状态会导致永久断跟（历史 bug 根因）。
  if (el) {
    const recovered = shouldRecoverFollowOnScroll({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      isFollowing: isAtBottom.value,
    });
    if (recovered) {
      chatScrollProbe("onScroll:recover-follow", { geo: readScrollGeometry(el) });
      isAtBottom.value = true;
      emit("on-chat-scroll");
    }
  }

  chatScrollProbe("onScroll", {
    geo: readScrollGeometry(el),
    isAtBottom: isAtBottom.value,
    isVisuallyAtBottom: isVisuallyAtBottom.value,
    followActive,
  });
}

function scrollToBottom() {
  const el = chatScrollRef.value;
  if (!el) return;
  stopFollow();
  isAtBottom.value = true;
  isVisuallyAtBottom.value = true;
  // Parent only re-pins; animation stays in this component so a hard jump
  // cannot cancel the spring / smooth glide.
  emit("scroll-to-bottom");
  // 回到最新 = 恢复跟随，需同步给父组件（否则父组件仍以为未跟随）。
  emit("on-chat-scroll");
  if (prefersReducedMotion()) {
    scrollContainerToBottom(el);
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
 * Spring glide toward bottom. Settled frames sleep the RAF; content growth
 * re-wakes via ResizeObserver → followToBottom (no warm idle spin while pinned).
 */
function stepFollow(ts: number) {
  followRaf = 0;
  const el = chatScrollRef.value;
  if (!el || !followActive) return;

  if (prefersReducedMotion()) {
    el.scrollTop = el.scrollHeight;
    followActive = false;
    followVelocity = 0;
    followLastTs = 0;
    isAtBottom.value = true;
    isVisuallyAtBottom.value = true;
    emit("on-chat-scroll");
    return;
  }

  const last = followLastTs || ts;
  const dt = Math.min(0.064, Math.max(0.001, (ts - last) / 1000));
  followLastTs = ts;

  const { nextScrollTop, velocity, settled } = computeScrollFollowStep(
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

  if (settled) {
    followActive = false;
    followVelocity = 0;
    followLastTs = 0;
    isAtBottom.value = true;
    isVisuallyAtBottom.value = true;
    return;
  }

  // 跟随中不改 isAtBottom 的「是否跟随」语义（本函数只在跟随状态下运行）。
  followRaf = requestAnimationFrame(stepFollow);
}

/** Animated follow used while a run streams — spring glide, coalesced per frame. */
function followToBottom() {
  const el = chatScrollRef.value;
  if (!el) {
    chatScrollProbe("followToBottom:no-el");
    return;
  }
  isAtBottom.value = true;
  isVisuallyAtBottom.value = true;
  if (followActive) {
    chatScrollProbe("followToBottom:already-active");
    return;
  }
  if (prefersReducedMotion()) {
    chatScrollProbe("followToBottom:reduced-motion");
    scrollContainerToBottom(el);
    return;
  }
  const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
  // Already pinned — snap without starting a spring frame.
  if (maxScroll - el.scrollTop <= SCROLL_FOLLOW_SNAP_PX) {
    chatScrollProbe("followToBottom:snap", { maxScroll, scrollTop: el.scrollTop });
    el.scrollTop = maxScroll;
    return;
  }
  chatScrollProbe("followToBottom:start-spring", {
    maxScroll,
    scrollTop: el.scrollTop,
    gap: Math.round(maxScroll - el.scrollTop),
  });
  followActive = true;
  followVelocity = 0;
  followLastTs = 0;
  followRaf = requestAnimationFrame(stepFollow);
}

/**
 * 用户产生滚动意图（滚轮 / 触摸 / 滚条 / 键盘）——**唯一**的「取消跟随」入口。
 *
 * 触底判定只在此刻做：用户往上翻 → 不触底 → 停手；翻回底部 → 触底 → 恢复跟随。
 * 容器滚不动时不算离开底部（内容不足一屏时滚轮无效，否则回复长起来后就不再跟随）。
 *
 * 注意异步：`wheel`/`keydown` 触发时 `scrollTop` **尚未**改变，同步读到的仍是滚动前
 * 的位置。因此判定推迟到下一帧（滚动已应用）执行，否则「往上翻」会被误判成「仍触底」。
 */
function applyUserFollowDecision() {
  if (userDecisionRaf) cancelAnimationFrame(userDecisionRaf);
  userDecisionRaf = requestAnimationFrame(() => {
    userDecisionRaf = 0;
    const el = chatScrollRef.value;
    if (!el) return;
    const next = decideFollowAfterUserInput({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      wasFollowing: isAtBottom.value,
    });
    chatScrollProbe("userFollowDecision", {
      geo: readScrollGeometry(el),
      wasFollowing: isAtBottom.value,
      next,
    });
    isAtBottom.value = next;
    // 顺带刷新按钮显隐：此刻读到的已是滚动后的位置，不必等下一个 scroll 事件。
    checkScrollPosition();
    if (!next) stopFollow();
    emit("on-chat-scroll");
  });
}

let userDecisionRaf = 0;

function onUserScrollIntent() {
  applyUserFollowDecision();
}

/** Scrollbar drag lands on the scroll element itself; text selection does not. */
function onScrollbarMouseDown(e: MouseEvent) {
  if (e.target !== chatScrollRef.value) return;
  applyUserFollowDecision();
}

const FOLLOW_KEYS = new Set(["PageUp", "PageDown", "ArrowUp", "ArrowDown", "Home", "End", " "]);

function onFollowKeydown(e: KeyboardEvent) {
  if (FOLLOW_KEYS.has(e.key)) applyUserFollowDecision();
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
    void nextTick(() => scheduleRailMeasure());
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
    void nextTick(() => {
      checkScrollPosition();
      scheduleRailMeasure();
    });
  },
);

let scrollResizeObserver: ResizeObserver | null = null;
let sessionScrollPending = false;
let sessionScrollClearTimer: number | null = null;

onMounted(() => {
  window.addEventListener("keydown", onFollowKeydown, true);
  void nextTick(() => {
    checkScrollPosition();
    measureRailAnchors();
    const scrollEl = chatScrollRef.value;
    if (!scrollEl || typeof ResizeObserver === "undefined") return;
    const contentEl = scrollEl.querySelector(".msg-list") ?? scrollEl;
    scrollResizeObserver = new ResizeObserver(() => {
      // 内容长高：跟随中 → 继续跟；未跟随 → 仅在「用户已滚回真触底」时恢复跟随。
      // 注意不在这里做「解除跟随」判定 —— 内容增长导致的 remaining 跳变是弹簧落后，不是用户意图。
      const el = scrollEl;
      const next = decideFollowAfterContentGrowth({
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        wasFollowing: isAtBottom.value,
      });
      chatScrollProbe("resizeObserver", {
        sessionScrollPending,
        chatSending: props.chatSending,
        isAtBottom: isAtBottom.value,
        followActive,
        next,
        geo: readScrollGeometry(el),
      });
      isAtBottom.value = next;

      if (sessionScrollPending || (props.chatSending && next)) {
        followToBottom();
        scheduleRailMeasure();
        return;
      }
      checkScrollPosition();
      scheduleRailMeasure();
    });
    scrollResizeObserver.observe(contentEl);
  });
});

onUnmounted(() => {
  scrollResizeObserver?.disconnect();
  scrollResizeObserver = null;
  stopFollow();
  if (railMeasureRaf) { cancelAnimationFrame(railMeasureRaf); railMeasureRaf = 0; }
  if (userDecisionRaf) { cancelAnimationFrame(userDecisionRaf); userDecisionRaf = 0; }
  if (sessionScrollClearTimer) { clearTimeout(sessionScrollClearTimer); sessionScrollClearTimer = null; }
  window.removeEventListener("keydown", onFollowKeydown, true);
});

defineExpose({
  chatScrollRef,
  chatDropZoneRef,
  followToBottom,
  scrollToBottom,
  /** 跳历史前解除跟随：父组件（如快速搜索跳转）在滚动前调用。 */
  detachFollowForJump,
  /** 当前是否处于「跟随到底部」状态（父组件据此同步 pin）。 */
  isFollowingBottom: () => isAtBottom.value,
});
</script>

<style src="./styles/ChatPanel.scss" scoped></style>

