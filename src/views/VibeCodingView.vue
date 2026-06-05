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
      <span v-if="treeError" class="bar-error">{{ treeError }}</span>
    </section>

    <main ref="workspaceRef" class="workspace" :class="{ 'no-project': !projectOpened, 'editor-collapsed': editorCollapsed }">
      <aside class="file-panel" :style="{ width: filePanelWidth + 'px' }">
        <div class="panel-head">
          <span class="panel-title">文件</span>
          <button
            v-if="editorCollapsed"
            type="button"
            class="ghost small"
            title="展开编辑器"
            @click="expandEditor"
          >
            编辑器
          </button>
          <input
            v-model="searchQuery"
            class="search-input"
            type="text"
            placeholder="搜索文件名…"
            :disabled="!projectOpened"
            @keydown.enter="handleSearch"
          />
        </div>

        <div v-if="!projectOpened" class="panel-empty">请先打开项目文件夹</div>

        <div v-else-if="searchResults.length" class="file-list">
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
            :expanded-dirs="expandedDirs"
            @toggle="toggleDir"
            @open="openFile"
          />
        </div>
      </aside>

      <div class="resize-handle" @mousedown="startResize('file', $event)"></div>

      <section v-show="!editorCollapsed" class="editor-panel">
        <div class="panel-head">
          <span class="panel-title">{{ activeFilePath ? fileName(activeFilePath) : "未打开文件" }}</span>
          <div class="panel-actions">
            <span v-if="fileDirty" class="dirty-badge">未保存</span>
            <button type="button" class="secondary" :disabled="!activeFilePath || !fileDirty" @click="saveFile">
              保存
            </button>
            <button type="button" class="secondary" :disabled="!activeFilePath" @click="reloadFile">重新加载</button>
            <button type="button" class="ghost small" title="收起编辑器" @click="collapseEditor">收起</button>
          </div>
        </div>

        <div v-if="!activeFilePath" class="editor-empty">
          <p>从左侧选择文件开始编辑</p>
          <button type="button" class="secondary" @click="collapseEditor">收起编辑器</button>
        </div>

        <div v-else-if="fileLoadError" class="editor-empty error">{{ fileLoadError }}</div>

        <CodeMonacoEditor
          v-else
          v-model="fileContent"
          class="code-editor"
          :file-path="activeFilePath"
          @change="fileDirty = true"
          @save="saveFile"
        />
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
            <p>Agent 会自行探索项目（list / read / grep / write），直接提问即可。</p>
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
            <div v-for="m in chatMessages" :key="m.id" class="msg" :class="m.role">
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
              <ChatMarkdown v-if="m.content" :content="m.content" />
              <div v-if="m.role === 'assistant' && extractCodeBlocks(m.content).length" class="msg-actions">
                <button
                  v-for="(block, idx) in extractCodeBlocks(m.content)"
                  :key="idx"
                  type="button"
                  class="ghost"
                  :disabled="!activeFilePath"
                  @click="applyCodeBlock(block)"
                >
                  应用代码块 {{ idx + 1 }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <footer class="chat-composer">
          <textarea
            v-model="chatInput"
            class="chat-input"
            rows="3"
            :disabled="chatSending"
            placeholder="例如：解释这个项目 / 优化这段代码（Enter 发送，Shift+Enter 换行）"
            @keydown="onChatKeydown"
          />
          <div class="chat-bottom">
            <span v-if="chatError" class="chat-error">{{ chatError }}</span>
            <span v-else-if="chatSending" class="chat-running">Agent 运行中…</span>
            <span v-else class="chat-hint">Agent 自行探索项目 · Enter 发送</span>
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
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import ChatMarkdown from "../components/ChatMarkdown.vue";
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
import { runVibeAgentSse, type VibeAgentSseEvent } from "../services/vibeAgentClient";
import {
  listDirectory,
  pickProjectFolder,
  readFile,
  searchFiles,
  writeFile,
  type FileEntry,
} from "../services/vibeCodingClient";

const STORAGE_KEY = "vibe-coding-project";
const PANEL_WIDTH_KEY = "vibe-coding-panel-widths";
const EDITOR_COLLAPSED_KEY = "vibe-coding-editor-collapsed";
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
  status?: string;
  agentPhase?: string;
  agentTurn?: number;
  agentMaxTurns?: number;
  activityExpanded?: boolean;
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

const activeFilePath = ref("");
const fileContent = ref("");
const fileDirty = ref(false);
const fileLoadError = ref("");

const searchQuery = ref("");
const searchResults = ref<Array<{ name: string; path: string; isDirectory: boolean }>>([]);

const chatInput = ref("");
const chatMessages = ref<ChatMessage[]>([]);
const chatSending = ref(false);
const chatError = ref("");
const chatScrollRef = ref<HTMLElement | null>(null);
const workspaceRef = ref<HTMLElement | null>(null);
let scrollChatRaf = 0;
const historyOpen = ref(false);
const activeSessionId = ref("");
const sessionList = ref<VibeChatSessionMeta[]>([]);

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
  () => Boolean(chatInput.value.trim()) && configReady.value && projectOpened.value,
);

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
  if (!projectPath.value.trim() || chatSending.value) return;
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

  try {
    const items = await loadDirChildren(normalized);
    fileTree.value = items;
    expandedDirs.value = new Set([normalized]);
    projectOpened.value = true;
    projectPath.value = normalized;
    localStorage.setItem(STORAGE_KEY, normalized);
    chatMessages.value = normalizeChatMessages(loadVibeChatHistory(normalized));
    refreshSessionList(normalized);
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

async function openFile(filePath: string) {
  expandEditor();
  fileLoadError.value = "";
  activeFilePath.value = filePath;
  fileDirty.value = false;

  const result = await readFile(filePath);
  if (!result.ok) {
    fileContent.value = "";
    fileLoadError.value = result.error || "读取失败";
    return;
  }

  fileContent.value = result.content;
}

async function reloadFile() {
  if (!activeFilePath.value) return;
  await openFile(activeFilePath.value);
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
}

async function handleSearch() {
  const q = searchQuery.value.trim();
  if (!q || !projectPath.value.trim()) {
    searchResults.value = [];
    return;
  }
  const result = await searchFiles(projectPath.value.trim(), q);
  searchResults.value = result.ok ? result.results : [];
}

watch(searchQuery, (val) => {
  if (!val.trim()) searchResults.value = [];
});

function applyExample(text: string) {
  chatInput.value = text;
}

function onChatKeydown(e: KeyboardEvent) {
  if (e.key !== "Enter" || e.shiftKey) return;
  e.preventDefault();
  void sendChat();
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

function applyCodeBlock(code: string) {
  fileContent.value = code;
  fileDirty.value = true;
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
    return { name, icon: "✏️", title: "写入文件", detail, label: detail ? `写入文件 ${detail}` : "写入文件" };
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
  const activeRel = activeFileRelativePath();
  for (const rel of files) {
    const normalized = rel.replace(/\\/g, "/").toLowerCase();
    if (activeRel && normalized === activeRel) {
      await reloadFile();
      fileDirty.value = false;
      break;
    }
  }
  await refreshTree();
}

function handleAgentEvent(event: VibeAgentSseEvent, assistantMsg: ChatMessage) {
  if (event.type === "status") {
    const { phase } = event.data;
    setAgentStatus(assistantMsg, phase, event.data);
    if (phase === "finished") {
      assistantMsg.agentPhase = undefined;
    }
    if (phase === "aborted") {
      chatSending.value = false;
      collapseAgentActivity(assistantMsg);
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
    void scrollChatToBottom(true);
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
    void scrollChatToBottom(true);
    return;
  }

  if (event.type === "message") {
    assistantMsg.content = event.data.text;
    assistantMsg.status = "";
    assistantMsg.agentPhase = undefined;
    void scrollChatToBottom(true);
    return;
  }

  if (event.type === "error") {
    chatError.value = event.data.message;
    if (!assistantMsg.content) assistantMsg.content = event.data.message;
    collapseAgentActivity(assistantMsg);
    void scrollChatToBottom(true);
    return;
  }

  if (event.type === "done") {
    chatSending.value = false;
    agentAbortHandle = null;
    assistantMsg.status = "";
    assistantMsg.agentPhase = undefined;
    collapseAgentActivity(assistantMsg);
    persistChatNow();
    void handleAgentWrittenFiles(event.data.writtenFiles || []);
    void scrollChatToBottom(true);
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

async function runAgentTurn(userText: string) {
  const prompt = userText.trim();
  if (!prompt || !configReady.value || !projectOpened.value) return;

  reloadAiConfig();
  chatSending.value = true;
  chatError.value = "";

  chatMessages.value.push({ id: genId(), role: "user", content: prompt });
  const assistantMsg: ChatMessage = {
    id: genId(),
    role: "assistant",
    content: "",
    tools: [],
    activityExpanded: true,
    agentPhase: "connecting_local",
    status: formatAgentStatus({ phase: "connecting_local" }),
  };
  chatMessages.value.push(assistantMsg);
  await scrollChatToBottom(true);

  agentAbortHandle?.abort();
  agentAbortHandle = runVibeAgentSse(
    {
      prompt,
      projectPath: projectPath.value.trim(),
      endpoint: aiConfig.value.endpoint,
      apiKey: aiConfig.value.apiKey,
      model: aiConfig.value.model,
      openFilePath: activeFilePath.value || undefined,
    },
    (event) => handleAgentEvent(event, assistantMsg),
  );
}

async function sendChat() {
  if (!canSendChat.value) return;
  const userText = chatInput.value.trim();
  chatInput.value = "";
  await runAgentTurn(userText);
}

function onWindowFocus() {
  reloadAiConfig();
}

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
  loadSavedProject();
  chatPanelWidth.value = Math.min(chatPanelWidth.value, getChatPanelMaxWidth());
  window.addEventListener("focus", onWindowFocus);
});

onBeforeUnmount(() => {
  window.removeEventListener("focus", onWindowFocus);
  agentAbortHandle?.abort();
  stopResize();
  if (scrollChatRaf) cancelAnimationFrame(scrollChatRaf);
  if (saveChatTimer) clearTimeout(saveChatTimer);
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

.vibe-page {
  --bg: #0b1220;
  --panel: rgba(17, 24, 39, 0.72);
  --panel-2: rgba(2, 6, 23, 0.55);
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
  gap: 16px;
  padding: 14px 20px 12px;
  border-bottom: 1px solid var(--border);
  background: rgba(11, 18, 32, 0.8);
  backdrop-filter: blur(10px);
}

.head-left {
  flex-shrink: 0;
}

.title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.2px;
}

.desc {
  margin: 3px 0 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.4;
}

.head-actions {
  display: flex;
  gap: 6px;
}

.project-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--border);
  background: rgba(11, 18, 32, 0.6);
  flex-wrap: wrap;
}

.path-input {
  flex: 1;
  min-width: 200px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  font-size: 13px;
  outline: none;
  transition: border-color 150ms ease, background 150ms ease;
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

.editor-panel {
  background: rgba(2, 6, 23, 0.35);
  flex: 1;
  min-width: 0;
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

.search-input {
  width: 120px;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  outline: none;
  transition: border-color 150ms ease, background 150ms ease;
}

.search-input:focus {
  border-color: rgba(31, 111, 235, 0.5);
  background: rgba(255, 255, 255, 0.06);
  width: 160px;
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
  gap: 6px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
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
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  transition: all 150ms ease;
}

.chip:hover:not(:disabled) {
  background: rgba(31, 111, 235, 0.2);
  border-color: rgba(31, 111, 235, 0.4);
}

.chat-composer {
  border-top: 1px solid var(--border);
  padding: 12px;
  background: rgba(11, 18, 32, 0.5);
}

.chat-input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  font-size: 13px;
  resize: vertical;
  min-height: 72px;
  outline: none;
  transition: border-color 150ms ease, background 150ms ease;
}

.chat-input:focus {
  border-color: rgba(31, 111, 235, 0.5);
  background: rgba(255, 255, 255, 0.06);
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
  padding: 8px 14px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 150ms ease;
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
  padding: 5px 10px;
  font-size: 11px;
  color: var(--muted);
}

button.ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
}

button:disabled {
  opacity: 0.45;
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
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 500;
  transition: all 150ms ease;
}

.link-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}
</style>
