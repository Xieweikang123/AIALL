<template>
  <div class="chat-page">
    <header class="page-head">
      <div class="head-left">
        <h1 class="title">AI 对话</h1>
        <div class="subline">
          <span class="pill" :class="statusPillClass">状态：{{ statusText }}</span>
          <span class="meta">
            当前模型：<code class="inline-code">{{ modelNameForDisplay }}</code>
            <span v-if="!configReady" class="meta error">（未配置或不完整，请先去“AI 配置”页保存）</span>
          </span>
        </div>
        <p class="desc">
          支持指令：<code class="inline-code">总结 https://linux.do/ 的最近信息</code>（自动抓取网页/最新列表后再总结）。
        </p>
      </div>

      <div class="head-actions">
        <router-link class="secondary link-btn" to="/ai-config">去配置</router-link>
        <button type="button" class="secondary" :disabled="sending || !messages.length" @click="clearAll">清空</button>
      </div>
    </header>

    <main ref="scrollWrapRef" class="chat-scroll">
      <div class="chat-inner">
        <div v-if="!messages.length" class="empty">
          <div class="empty-title">从一条指令开始</div>
          <div class="empty-desc">例如：总结 https://linux.do/ 的最近信息</div>
          <div class="suggestions">
            <button type="button" class="chip" :disabled="sending" @click="applyExample('总结 https://linux.do/ 的最近信息')">
              总结 linux.do 最近信息
            </button>
          </div>
        </div>

        <div v-else class="msg-list">
          <div v-for="m in messages" :key="m.id" class="msg" :class="m.role">
            <div class="avatar" aria-hidden="true">
              <span v-if="m.role === 'user'">我</span>
              <span v-else>AI</span>
            </div>
            <div class="bubble">
              <div class="bubble-top">
                <span class="role-name">{{ m.role === "user" ? "你" : "助手" }}</span>
                <span v-if="m.meta" class="bubble-meta">{{ m.meta }}</span>
              </div>
              <pre class="bubble-text">{{ m.content }}</pre>
              <div v-if="m.role === 'assistant'" class="bubble-actions">
                <button type="button" class="ghost" :disabled="sending || !m.content" @click="copyText(m.content)">复制</button>
              </div>
            </div>
          </div>

          <div class="tail-spacer" />
        </div>
      </div>
    </main>

    <footer class="composer">
      <div class="composer-card">
        <textarea
          v-model="inputText"
          class="composer-input"
          rows="3"
          :disabled="sending"
          placeholder="输入：总结 + URL（Ctrl/⌘ + Enter 发送）"
          @keydown="onInputKeydown"
        />
        <div class="composer-bottom">
          <div class="hint">
            <span v-if="state.phase === 'fail'" class="hint-error">失败：{{ state.message }}</span>
            <span v-else-if="state.phase === 'running'" class="hint-running">处理中：{{ state.message }}</span>
            <span v-else class="hint-muted">快捷键：Ctrl/⌘ + Enter 发送，Shift + Enter 换行</span>
          </div>
          <div class="actions">
            <button type="button" class="secondary" :disabled="sending || !lastAssistantText" @click="copyText(lastAssistantText)">
              复制最后回复
            </button>
            <button type="button" class="primary" :disabled="sending || !canSend" @click="handleSend">
              {{ sending ? "处理中..." : "发送" }}
            </button>
          </div>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from "vue";
import { extractWebText } from "../services/webExtractClient";
import { testAiModel } from "../services/aiClient";

type Phase = "idle" | "running" | "success" | "fail";
type ChatRole = "user" | "assistant";

interface PersistedAiConfig {
  version?: number;
  base?: {
    endpoint?: string;
    apiKey?: string;
    model?: string;
    prompt?: string;
    stream?: boolean;
  };
}

type UiMessage = {
  id: string;
  role: ChatRole;
  content: string;
  meta?: string;
};

const STORAGE_KEY = "ai-config";

const inputText = ref("");
const sending = ref(false);
const state = reactive({
  phase: "idle" as Phase,
  message: "未开始",
});

const messages = ref<UiMessage[]>([]);
const scrollWrapRef = ref<HTMLElement | null>(null);

const config = reactive({
  endpoint: "",
  apiKey: "",
  model: "",
  proxyUrl: "",
});

function loadAiConfig() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as PersistedAiConfig | any;
    const base = parsed?.base || parsed || {};
    const web = parsed?.web || {};
    config.endpoint = String(base.endpoint || "");
    config.apiKey = String(base.apiKey || "");
    config.model = String(base.model || "");
    config.proxyUrl = String(web.proxyUrl || "");
  } catch {
    // ignore
  }
}

const configReady = computed(() => Boolean(config.endpoint.trim()) && Boolean(config.model.trim()));
const modelNameForDisplay = computed(() => config.model.trim() || "（未设置）");
const canSend = computed(() => Boolean(inputText.value.trim()) && configReady.value);

const statusPillClass = computed(() => ({
  ok: state.phase === "success",
  fail: state.phase === "fail",
  running: state.phase === "running",
}));
const statusText = computed(() => {
  if (state.phase === "idle") return "未开始";
  if (state.phase === "running") return "处理中...";
  if (state.phase === "success") return "成功";
  return "失败";
});

const lastAssistantText = computed(() => {
  for (let i = messages.value.length - 1; i >= 0; i -= 1) {
    const m = messages.value[i];
    if (m.role === "assistant" && m.content.trim()) return m.content;
  }
  return "";
});

function parseSummarizeCommand(text: string): { url: string; raw: string } | null {
  const raw = String(text || "").trim();
  if (!raw) return null;

  // 兼容：总结URL / 总结 URL / 总结：URL / 总结 https://... 的最近信息
  const m = raw.match(/^\s*总结(?:\s|：|:)+((https?:\/\/)[^\s]+)\s*.*$/i);
  if (!m) return null;
  return { url: m[1], raw };
}

function buildSummaryPrompt(sourceText: string, userRaw: string) {
  return [
    "你是一个中文信息整理助手。",
    "用户的原始诉求：",
    userRaw,
    "",
    "下面是我从网页/接口抓取到的“最近信息”原始材料，请你：",
    "1）用中文输出 5-10 条要点总结",
    "2）如果材料是论坛主题列表，请优先概括讨论热点与趋势，并点出最值得关注的 3 个主题",
    "3）避免臆测；如果信息不足，请明确说明“不足”并给出你需要的补充（例如更长时间范围/指定板块）",
    "",
    "【原始材料开始】",
    sourceText,
    "【原始材料结束】",
  ].join("\n");
}

function genId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function scrollToBottom() {
  await nextTick();
  const el = scrollWrapRef.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

async function copyText(text: string) {
  const value = String(text ?? "");
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand("copy");
    } finally {
      document.body.removeChild(textarea);
    }
  }
}

function clearAll() {
  inputText.value = "";
  messages.value = [];
  state.phase = "idle";
  state.message = "未开始";
}

function applyExample(example: string) {
  inputText.value = example;
}

function onInputKeydown(e: KeyboardEvent) {
  // textarea 内允许换行：Shift+Enter；发送用 Ctrl/⌘+Enter。
  if (e.key !== "Enter") return;
  if (e.shiftKey) return;
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    handleSend();
  }
}

async function handleSend() {
  if (!canSend.value) return;
  sending.value = true;
  state.phase = "running";
  state.message = "开始处理...";

  const userRaw = inputText.value.trim();
  messages.value.push({ id: genId(), role: "user", content: userRaw });
  inputText.value = "";

  const assistantMsg: UiMessage = {
    id: genId(),
    role: "assistant",
    content: "",
    meta: "处理中...",
  };
  messages.value.push(assistantMsg);
  await scrollToBottom();

  try {
    const cmd = parseSummarizeCommand(userRaw);
    if (!cmd) {
      state.phase = "fail";
      state.message = "仅支持“总结 + URL”指令";
      assistantMsg.meta = "输入不符合指令";
      assistantMsg.content = "当前仅实现了“总结 + URL”的指令。\n示例：总结 https://linux.do/ 的最近信息";
      await scrollToBottom();
      return;
    }

    state.message = "抓取网页中...";
    assistantMsg.meta = "抓取网页中...";
    assistantMsg.content = `正在抓取：${cmd.url}\n\n【抓取进度】\n`;
    await scrollToBottom();

    const extracted = await extractWebText({
      url: cmd.url,
      mode: "auto",
      limit: 15,
      proxyUrl: config.proxyUrl?.trim() || undefined,
      onProgress: (msg) => {
        assistantMsg.content += `• ${msg}\n`;
        assistantMsg.meta = msg;
        state.message = msg;
        void scrollToBottom();
      },
    });
    if (!extracted.ok || !extracted.text) {
      state.phase = "fail";
      state.message = extracted.error || "抓取失败（可尝试在 AI 配置里设置网页抓取代理）";
      assistantMsg.meta = "抓取失败";
      assistantMsg.content = `抓取失败：${extracted.error || "未知原因"}\n`;
      if (extracted.rawText) assistantMsg.content += `\n后端原始返回：\n${extracted.rawText}\n`;
      await scrollToBottom();
      return;
    }

    const prompt = buildSummaryPrompt(extracted.text, cmd.raw);
    state.message = "请求模型中...";
    assistantMsg.meta = "请求模型中...";
    assistantMsg.content += "\n【模型】\n";
    assistantMsg.content += "抓取成功，开始请求模型（流式输出）...\n\n";
    await scrollToBottom();

    const ai = await testAiModel({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      model: config.model,
      prompt,
      stream: true,
      onStreamChunk: (chunk) => {
        assistantMsg.content += chunk;
        void scrollToBottom();
      },
    });

    if (!ai.ok) {
      state.phase = "fail";
      state.message = ai.error || "模型请求失败";
      assistantMsg.meta = "模型失败";
      assistantMsg.content += `\n\n模型请求失败：${ai.error || "未知原因"}\n`;
      await scrollToBottom();
      return;
    }

    state.phase = "success";
    state.message = "完成";
    assistantMsg.meta = "完成";
    if (ai.rawText && ai.rawText.trim()) assistantMsg.content = ai.rawText;
    await scrollToBottom();
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    state.phase = "fail";
    state.message = message;
    assistantMsg.meta = "异常";
    assistantMsg.content = `处理异常：${message}`;
    await scrollToBottom();
  } finally {
    sending.value = false;
  }
}

onMounted(() => {
  loadAiConfig();
});
</script>

<style scoped>
:global(body) {
  margin: 0;
  background: radial-gradient(900px 520px at 18% 8%, rgba(31, 111, 235, 0.16), transparent 62%),
    radial-gradient(900px 560px at 92% 0%, rgba(130, 80, 223, 0.18), transparent 60%),
    radial-gradient(900px 560px at 50% 100%, rgba(26, 127, 55, 0.16), transparent 55%),
    #0b1220;
  color: rgba(255, 255, 255, 0.92);
}

.chat-page {
  --bg: #0b1220;
  --panel: rgba(17, 24, 39, 0.72);
  --panel-2: rgba(2, 6, 23, 0.55);
  --text: rgba(255, 255, 255, 0.92);
  --muted: rgba(255, 255, 255, 0.72);
  --subtle: rgba(255, 255, 255, 0.6);
  --border: rgba(255, 255, 255, 0.14);
  --border-2: rgba(255, 255, 255, 0.2);
  --ring: rgba(31, 111, 235, 0.28);
  --primary: #1f6feb;
  --ok: #1a7f37;
  --danger: #ff4d5e;

  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji",
    "Segoe UI Emoji";
}

.page-head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 10px;
  background: rgba(11, 18, 32, 0.72);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--border);
}

.head-left {
  min-width: 0;
}

.title {
  margin: 0;
  font-size: 18px;
  line-height: 1.2;
}

.subline {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 6px;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.desc {
  color: var(--muted);
  margin: 10px 0 0;
  font-size: 13px;
}

.meta {
  color: var(--muted);
  font-size: 12px;
  min-width: 0;
}

.meta.error {
  color: var(--danger);
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  border: 1px solid var(--border);
  background: rgba(17, 24, 39, 0.62);
  color: var(--muted);
}

.pill.running {
  border-color: rgba(31, 111, 235, 0.45);
  color: rgba(145, 190, 255, 0.98);
  background: rgba(31, 111, 235, 0.12);
}

.pill.ok {
  border-color: rgba(26, 127, 55, 0.48);
  color: rgba(152, 239, 188, 0.98);
  background: rgba(26, 127, 55, 0.14);
}

.pill.fail {
  border-color: rgba(255, 77, 94, 0.48);
  color: rgba(255, 153, 164, 0.98);
  background: rgba(255, 77, 94, 0.14);
}

.chat-scroll {
  flex: 1;
  overflow: auto;
  padding: 14px 18px;
}

.chat-inner {
  max-width: 980px;
  margin: 0 auto;
}

button {
  border: none;
  background: var(--primary);
  color: #fff;
  border-radius: 8px;
  padding: 10px 16px;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
}

button.primary {
  background: var(--primary);
}

button.secondary {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.9);
  border: 1px solid var(--border);
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ghost {
  background: transparent;
  color: rgba(255, 255, 255, 0.86);
  border: 1px solid var(--border);
  padding: 7px 10px;
  border-radius: 8px;
}

.ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
}

.link-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  padding: 10px 16px;
  text-decoration: none;
  color: #fff;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid var(--border);
}

.empty {
  margin: 22px auto 0;
  max-width: 720px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 18px;
}

.empty-title {
  font-weight: 600;
  font-size: 14px;
}

.empty-desc {
  color: var(--muted);
  margin-top: 6px;
  font-size: 13px;
}

.suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 12px;
}

.chip {
  background: rgba(31, 111, 235, 0.16);
  color: rgba(170, 208, 255, 0.98);
  border: 1px solid rgba(31, 111, 235, 0.35);
}

.msg-list {
  display: grid;
  gap: 12px;
}

.msg {
  display: grid;
  grid-template-columns: 34px 1fr;
  gap: 10px;
  align-items: flex-start;
}

.avatar {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  border: 1px solid var(--border);
  background: rgba(17, 24, 39, 0.62);
  color: rgba(255, 255, 255, 0.86);
}

.msg.user .avatar {
  border-color: rgba(31, 111, 235, 0.45);
  color: rgba(170, 208, 255, 0.98);
  background: rgba(31, 111, 235, 0.12);
}

.bubble {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 12px 12px 10px;
  min-width: 0;
}

.msg.user .bubble {
  border-color: rgba(31, 111, 235, 0.4);
  background: rgba(31, 111, 235, 0.12);
}

.bubble-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.role-name {
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}

.bubble-meta {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}

.bubble-text {
  margin: 0;
  background: transparent;
  border: none;
  padding: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.55;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.bubble-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}

.tail-spacer {
  height: 4px;
}

.composer {
  position: sticky;
  bottom: 0;
  z-index: 2;
  padding: 12px 18px 16px;
  border-top: 1px solid var(--border);
  background: rgba(11, 18, 32, 0.76);
  backdrop-filter: blur(10px);
}

.composer-card {
  max-width: 980px;
  margin: 0 auto;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 12px;
}

.composer-input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.5;
  outline: none;
  resize: vertical;
  min-height: 78px;
  background: var(--panel-2);
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.composer-input::placeholder {
  color: rgba(255, 255, 255, 0.42);
}

.composer-input:focus {
  border-color: rgba(31, 111, 235, 0.6);
  box-shadow: 0 0 0 4px var(--ring);
  background: rgba(2, 6, 23, 0.7);
}

.composer-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.hint {
  font-size: 12px;
  color: var(--muted);
  min-width: 0;
}

.hint-muted {
  color: var(--muted);
}

.hint-running {
  color: rgba(145, 190, 255, 0.98);
  font-weight: 600;
}

.hint-error {
  color: rgba(255, 153, 164, 0.98);
  font-weight: 600;
}

.actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.inline-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 12px;
}

@media (max-width: 640px) {
  .page-head {
    flex-direction: column;
    align-items: stretch;
  }

  .chat-scroll {
    padding: 12px 12px;
  }

  .composer {
    padding: 12px 12px 14px;
  }
}
</style>
