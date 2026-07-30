<template>
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
              @click.stop="$emit('copy-session-name-path', activeSession)"
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
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from "vue";
import type { VibeChatSessionMeta } from "../../services/vibeChatStorage";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const props = defineProps<{
  sessionList: VibeChatSessionMeta[];
  activeSessionId: string;
  activeSessionTitle: string;
  chatStoreSyncMessage: string;
  configReady: boolean;
  apiKeyReady: boolean;
  aiConfigStatusText: string;
  projectOpened: boolean;
  canSwitchToNewerSession: boolean;
  canSwitchToOlderSession: boolean;
  projectMemoryHasContent: boolean;
  chatMessages: ChatMessage[];
  chatSending: boolean;
}>();

const emit = defineEmits<{
  (e: "switch-to-adjacent-session", delta: number): void;
  (e: "open-session-list"): void;
  (e: "copy-session-name-path", session: VibeChatSessionMeta | undefined): void;
  (e: "open-ai-config"): void;
  (e: "open-project-memory"): void;
  (e: "start-new-session"): void;
  (e: "clear-chat"): void;
  (e: "collapse-chat"): void;
}>();

const activeSession = computed(() =>
  props.sessionList.find((s) => s.id === props.activeSessionId),
);

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
  const insideDropdown = target && target instanceof HTMLElement && target.closest(".panel-head-dropdown");
  if (!insideMenu && !insideDropdown) headMenuOpen.value = false;
}

onMounted(() => {
  document.addEventListener("pointerdown", onHeadMenuPointerDown, true);
});

onUnmounted(() => {
  document.removeEventListener("pointerdown", onHeadMenuPointerDown, true);
});
</script>

<style src="./styles/ChatPanel.scss" scoped></style>
