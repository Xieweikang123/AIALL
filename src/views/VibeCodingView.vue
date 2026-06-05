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

    <main class="workspace" :class="{ 'no-project': !projectOpened }">
      <aside class="file-panel" :style="{ width: filePanelWidth + 'px' }">
        <div class="panel-head">
          <span class="panel-title">文件</span>
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

      <section class="editor-panel">
        <div class="panel-head">
          <span class="panel-title">{{ activeFilePath ? fileName(activeFilePath) : "未打开文件" }}</span>
          <div class="panel-actions">
            <span v-if="fileDirty" class="dirty-badge">未保存</span>
            <button type="button" class="secondary" :disabled="!activeFilePath || !fileDirty" @click="saveFile">
              保存
            </button>
            <button type="button" class="secondary" :disabled="!activeFilePath" @click="reloadFile">重新加载</button>
          </div>
        </div>

        <div v-if="!activeFilePath" class="editor-empty">
          <p>从左侧选择文件开始编辑</p>
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

      <div class="resize-handle" @mousedown="startResize('chat', $event)"></div>

      <aside class="chat-panel" :style="{ width: chatPanelWidth + 'px' }">
        <div class="panel-head">
          <span class="panel-title">AI 助手</span>
          <span class="panel-meta" :class="{ warn: !configReady || !apiKeyReady }">
            {{ aiConfigStatusText }}
          </span>
        </div>

        <div ref="chatScrollRef" class="chat-scroll">
          <div v-if="!chatMessages.length" class="chat-empty">
            <p>直接提问即可，系统会自动判断附带项目结构或当前文件。</p>
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
              <div class="msg-role">{{ m.role === "user" ? "你" : "AI" }}</div>
              <pre class="msg-text">{{ m.content }}</pre>
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
            placeholder="例如：解释这个项目 / 优化这段代码（Ctrl/⌘ + Enter 发送）"
            @keydown="onChatKeydown"
          />
          <div class="chat-bottom">
            <span v-if="chatError" class="chat-error">{{ chatError }}</span>
            <span v-else-if="chatSending" class="chat-running">AI 思考中…</span>
            <span v-else class="chat-hint">{{ contextHint }} · Ctrl/⌘ + Enter 发送</span>
            <button type="button" class="primary" :disabled="chatSending || !canSendChat" @click="sendChat">
              {{ chatSending ? "发送中…" : "发送" }}
            </button>
          </div>
        </footer>
      </aside>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import CodeMonacoEditor from "../components/CodeMonacoEditor.vue";
import FileTreeNode, { type TreeNode } from "../components/FileTreeNode.vue";
import { testAiModel } from "../services/aiClient";
import { loadAiChatBaseFromStorage } from "../services/aiLocalConfig";
import { detectChatContextIntent } from "../utils/chatContextIntent";
import {
  fetchProjectContext,
  listDirectory,
  pickProjectFolder,
  readFile,
  searchFiles,
  writeFile,
  type FileEntry,
} from "../services/vibeCodingClient";

const STORAGE_KEY = "vibe-coding-project";
type ChatRole = "user" | "assistant";
type ChatMessage = { id: string; role: ChatRole; content: string };

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

const aiConfig = ref({ endpoint: "", apiKey: "", model: "" });

const configReady = computed(() => Boolean(aiConfig.value.endpoint.trim()) && Boolean(aiConfig.value.model.trim()));
const apiKeyReady = computed(() => Boolean(aiConfig.value.apiKey.trim()));
const modelNameForDisplay = computed(() => aiConfig.value.model.trim() || "（未设置）");
const aiConfigStatusText = computed(() => {
  if (!configReady.value) return "未配置模型";
  if (!apiKeyReady.value) return `${modelNameForDisplay.value}（未保存 API Key）`;
  return modelNameForDisplay.value;
});
const canSendChat = computed(() => Boolean(chatInput.value.trim()) && configReady.value);

const contextHint = computed(() => {
  return detectChatContextIntent(chatInput.value, {
    hasProject: projectOpened.value,
    hasOpenFile: Boolean(activeFilePath.value && fileContent.value && !fileLoadError.value),
  }).hint;
});

const filePanelWidth = ref(280);
const chatPanelWidth = ref(360);
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
    filePanelWidth.value = Math.min(Math.max(180, startWidth + delta), 500);
  } else {
    chatPanelWidth.value = Math.min(Math.max(260, startWidth - delta), 600);
  }
}

function stopResize() {
  isResizing.value = false;
  resizeType = null;
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

async function scrollChatToBottom() {
  await nextTick();
  const el = chatScrollRef.value;
  if (el) el.scrollTop = el.scrollHeight;
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
  if (e.key !== "Enter") return;
  if (e.shiftKey) return;
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    void sendChat();
  }
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

async function buildChatPrompt(userMessage: string, intent: ReturnType<typeof detectChatContextIntent>): Promise<string> {
  const parts = [
    "你是一个专业的编程助手，帮助用户理解和修改代码。",
    "回答请使用中文。",
    "如果需要给出修改后的代码，请用 markdown 代码块包裹完整代码。",
    "",
    `用户问题：${userMessage}`,
  ];

  if (intent.includeProject && projectPath.value.trim()) {
    const ctx = await fetchProjectContext(projectPath.value.trim());
    if (ctx.ok && ctx.tree) {
      parts.push("", `项目路径：${ctx.path}`, "【目录结构】", ctx.tree);
      if (ctx.truncated) {
        parts.push("（说明：项目较大，目录或文件内容已部分截断）");
      }
      if (ctx.keyFiles?.length) {
        parts.push("", "【关键文件内容】");
        for (const file of ctx.keyFiles) {
          parts.push(`--- ${file.path} ---`, file.content, "");
        }
      }
    } else if (!ctx.ok) {
      parts.push("", `（未能读取项目上下文：${ctx.error || "未知原因"}）`);
    }
  }

  if (intent.includeFile && activeFilePath.value && fileContent.value) {
    parts.push(
      "",
      `当前文件：${activeFilePath.value}`,
      "【文件内容开始】",
      fileContent.value,
      "【文件内容结束】",
    );
  }

  return parts.join("\n");
}

async function sendChat() {
  if (!canSendChat.value) return;

  reloadAiConfig();

  chatSending.value = true;
  chatError.value = "";
  const userText = chatInput.value.trim();
  chatInput.value = "";

  chatMessages.value.push({ id: genId(), role: "user", content: userText });
  const assistantMsg: ChatMessage = { id: genId(), role: "assistant", content: "" };
  chatMessages.value.push(assistantMsg);
  await scrollChatToBottom();

  const intent = detectChatContextIntent(userText, {
    hasProject: projectOpened.value,
    hasOpenFile: Boolean(activeFilePath.value && fileContent.value && !fileLoadError.value),
  });

  try {
    if (intent.includeProject) {
      assistantMsg.content = "正在扫描项目结构与关键文件…\n";
      await scrollChatToBottom();
    }

    const prompt = await buildChatPrompt(userText, intent);
    assistantMsg.content = intent.includeProject ? "" : assistantMsg.content;

    const result = await testAiModel({
      endpoint: aiConfig.value.endpoint,
      apiKey: aiConfig.value.apiKey,
      model: aiConfig.value.model,
      prompt,
      stream: true,
      onStreamChunk: (chunk) => {
        assistantMsg.content += chunk;
        void scrollChatToBottom();
      },
    });

    if (!result.ok) {
      chatError.value = result.error || "AI 请求失败";
      if (!assistantMsg.content) assistantMsg.content = chatError.value;
    }
  } catch (e) {
    chatError.value = e instanceof Error ? e.message : "发送失败";
    if (!assistantMsg.content) assistantMsg.content = chatError.value;
  } finally {
    chatSending.value = false;
    await scrollChatToBottom();
  }
}

function onWindowFocus() {
  reloadAiConfig();
}

onMounted(() => {
  reloadAiConfig();
  loadSavedProject();
  window.addEventListener("focus", onWindowFocus);
});

onBeforeUnmount(() => {
  window.removeEventListener("focus", onWindowFocus);
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

.msg-role {
  font-size: 11px;
  font-weight: 700;
  margin-bottom: 6px;
  color: var(--muted);
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
