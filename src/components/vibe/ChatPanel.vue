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
    <ChatPanelHeader
      :session-list="sessionList"
      :active-session-id="activeSessionId"
      :active-session-title="activeSessionTitle"
      :chat-store-sync-message="chatStoreSyncMessage"
      :config-ready="configReady"
      :api-key-ready="apiKeyReady"
      :ai-config-status-text="aiConfigStatusText"
      :project-opened="projectOpened"
      :can-switch-to-newer-session="canSwitchToNewerSession"
      :can-switch-to-older-session="canSwitchToOlderSession"
      :project-memory-has-content="projectMemoryHasContent"
      :chat-messages="chatMessages"
      :chat-sending="chatSending"
      @switch-to-adjacent-session="$emit('switch-to-adjacent-session', $event)"
      @open-session-list="$emit('open-session-list')"
      @copy-session-name-path="$emit('copy-session-name-path', $event)"
      @open-ai-config="$emit('open-ai-config')"
      @open-project-memory="$emit('open-project-memory')"
      @start-new-session="$emit('start-new-session')"
      @clear-chat="$emit('clear-chat')"
      @collapse-chat="$emit('collapse-chat')"
    />

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

        <div v-else-if="pendingApproval" class="chat-status-row">
          <span class="chat-running-status chat-running-status--waiting" aria-live="polite">
            <span class="status-pulse status-pulse--waiting" aria-hidden="true" />
            等待确认
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
            </div>
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
                    <span>本会话使用模型</span>
                    <div class="chat-provider-dropdown-head-actions">
                      <button
                        type="button"
                        class="ghost small"
                        :disabled="!activeSessionProviderId"
                        @click="resetProviderToGlobal"
                      >
                        跟随全局
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
                  <button
                    type="button"
                    class="chat-provider-option"
                    :class="{ active: !activeSessionProviderId }"
                    role="menuitemradio"
                    :aria-checked="!activeSessionProviderId"
                    @click="selectProvider('')"
                  >
                    <span class="chat-provider-option-name">跟随全局</span>
                    <span class="chat-provider-option-model">{{ globalModelName || "未设置" }}</span>
                    <span v-if="!activeSessionProviderId" class="chat-provider-option-check">✓</span>
                  </button>
                  <div v-if="providerOptions.length" class="chat-provider-option-sep" />
                  <button
                    v-for="p in providerOptions"
                    :key="p.id"
                    type="button"
                    class="chat-provider-option"
                    :class="{ active: activeSessionProviderId === p.id }"
                    role="menuitemradio"
                    :aria-checked="activeSessionProviderId === p.id"
                    @click="selectProvider(p.id)"
                  >
                    <span class="chat-provider-option-name">{{ p.name }}</span>
                    <span class="chat-provider-option-model">{{ p.model }}</span>
                    <span v-if="activeSessionProviderId === p.id" class="chat-provider-option-check">✓</span>
                  </button>
                </div>
              </Teleport>
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
import ChatPanelHeader from "./ChatPanelHeader.vue";
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
  agentRunStageLabel?: string;
  pendingApproval?: boolean;
  stalledAssistantMsg: ChatMessage | null;
  autoResumeSecondsLeft: number;
  pendingPromptQueue: string[];
  sessionList: VibeChatSessionMeta[];
  activeSessionId: string;
  activeSessionTitle: string;
  chatStoreSyncMessage: string;
  isDragging: boolean;
  editorCollapsed: boolean;
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
  activeSessionProviderId: string;
  providerOptions?: Array<{ id: string; name: string; model: string }>;
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
	agentRunningStatus: "",
	agentRunStageLabel: "",
	pendingApproval: false,
	agentSuggestions: () => [],
	activeSessionProviderId: "",
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
  (e: "update:activeSessionProviderId", providerId: string): void;
}>();

const chatScrollRef = ref<HTMLElement | null>(null);
const chatDropZoneRef = ref<HTMLElement | null>(null);
const isAtBottom = ref(true);
const showScrollToBottom = computed(() => !isAtBottom.value && props.chatMessages.length > 0);

const activeProviderLabel = computed(() => {
  const id = props.activeSessionProviderId.trim();
  if (!id) return "跟随全局";
  return props.providerOptions?.find((p) => p.id === id)?.name || "自定义";
});

const providerPickerTitle = computed(() => {
  if (props.activeSessionProviderId.trim()) return `会话模型：${activeProviderLabel.value}（在「AI 配置」可管理供应商）`;
  return `会话模型：跟随全局配置（${props.globalModelName || "未设置"}）`;
});

const providerPickerRef = ref<HTMLElement | null>(null);
const providerDropdownRef = ref<HTMLElement | null>(null);
const providerPickerOpen = ref(false);
const providerDropdownTop = ref(0);
const providerDropdownRight = ref(0);

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

function toggleProviderPicker() {
  providerPickerOpen.value = !providerPickerOpen.value;
  if (providerPickerOpen.value) {
    nextTick(updateProviderDropdownPosition);
  }
}

function closeProviderPicker() {
  providerPickerOpen.value = false;
}

function selectProvider(providerId: string) {
  providerPickerOpen.value = false;
  emit("update:activeSessionProviderId", providerId);
}

function resetProviderToGlobal() {
  providerPickerOpen.value = false;
  emit("update:activeSessionProviderId", "");
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
});

onUnmounted(() => {
  document.removeEventListener("mousedown", handleProviderPickerOutsideClick, true);
  onProviderPickerOpenChange(false);
});

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
  scrollResizeObserver?.disconnect();
  scrollResizeObserver = null;
  if (sessionScrollClearTimer) { clearTimeout(sessionScrollClearTimer); sessionScrollClearTimer = null; }
});

defineExpose({ chatScrollRef, chatDropZoneRef });
</script>

<style src="./styles/ChatPanel.scss" scoped></style>

