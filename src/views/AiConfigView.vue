<template>
  <div class="ai-config-page">
    <div class="page-head">
      <div>
        <h1>AI 配置</h1>
        <p class="desc">配置模型接口并测试连通性。</p>
      </div>
      <div class="head-actions">
        <button type="button" class="secondary" @click="handleGoChat">去聊天</button>
        <button type="button" class="secondary" @click="handleExportConfig">导出</button>
        <button type="button" class="secondary" @click="handleImportConfig">导入</button>
        <button type="button" class="secondary danger" @click="handleResetConfig">重置</button>
        <button type="button" class="primary" @click="saveConfig">保存配置</button>
      </div>
    </div>

    <nav class="tabs" aria-label="AI 配置选项卡">
      <button type="button" class="tab" :class="{ active: activeTab === 'chat' }" @click="activeTab = 'chat'">
        模型/对话
      </button>
      <button type="button" class="tab" :class="{ active: activeTab === 'tts' }" @click="activeTab = 'tts'">
        TTS
      </button>
      <button type="button" class="tab" :class="{ active: activeTab === 'claude' }" @click="activeTab = 'claude'">
        Claude CLI
      </button>
    </nav>

    <section class="card">
      <h2 class="card-title">基础配置</h2>

      <div class="config-form grid-2">
        <label class="field span-2">
          <div class="field-row">
            <span>接口地址</span>
            <span class="badge" :class="endpointReady ? 'ok' : 'fail'">
              {{ endpointReady ? "可用" : "需修正" }}
            </span>
          </div>
          <input v-model.trim="form.endpoint" type="text" placeholder="https://fufu.iqach.top/v1/chat/completions" />
          <small v-if="endpointError" class="tips error">{{ endpointError }}</small>
          <small v-else class="tips">
            models：<code class="inline-code">{{ derivedModelsEndpoint }}</code>
          </small>
          <small v-if="endpointReady" class="tips">
            tts：<code class="inline-code">{{ derivedTtsEndpoint }}</code>
          </small>
        </label>

        <label class="field">
          <div class="field-row">
            <span>API Key（可选）</span>
            <div class="field-tools">
              <button type="button" class="link" @click="apiKeyVisible = !apiKeyVisible">
                {{ apiKeyVisible ? "隐藏" : "显示" }}
              </button>
              <button type="button" class="link" :disabled="!form.apiKey" @click="copyText(form.apiKey)">
                复制
              </button>
            </div>
          </div>
          <input v-model.trim="form.apiKey" :type="apiKeyVisible ? 'text' : 'password'" placeholder="sk-xxxx（如需鉴权请填写）" />
        </label>

        <label class="field">
          <div class="field-row">
            <span>网页抓取代理（HTTP，可选）</span>
            <div class="field-tools">
              <button type="button" class="link" :disabled="!web.proxyUrl" @click="copyText(web.proxyUrl)">复制</button>
            </div>
          </div>
          <input v-model.trim="web.proxyUrl" type="text" placeholder="例如：http://127.0.0.1:7890" />
          <small class="tips">
            仅用于“总结 URL / 抓取网页”场景，解决 Node 无法直连网站的问题（浏览器能打开不代表 Node 能直连）。
          </small>
        </label>
      </div>

      <p v-if="saveHint" class="tips ok">{{ saveHint }}</p>
    </section>

    <section v-show="activeTab === 'chat'" class="card">
      <h2 class="card-title">模型/对话测试</h2>

      <form class="config-form" @submit.prevent="handleTest">
        <label class="field">
          <span>模型名称</span>
          <div class="model-row">
            <input v-model.trim="form.model" type="text" placeholder="mimo-v2.5-pro" />
            <button type="button" class="secondary" :disabled="modelsLoading || !endpointReady" @click="handleFetchModels">
              {{ modelsLoading ? "加载中..." : "获取可用模型" }}
            </button>
            <button type="button" class="secondary" :disabled="modelsLoading || !endpointReady" @click="handleRefreshModels">
              刷新
            </button>
          </div>
          <select v-if="availableModels.length" v-model="form.model">
            <option v-for="modelName in availableModels" :key="modelName" :value="modelName">
              {{ modelName }}
            </option>
          </select>
          <small class="tips">
            {{ modelsStatusText }}
          </small>
          <pre v-if="availableModels.length" class="models-pre">{{ availableModels.join("\n") }}</pre>
        </label>

        <label class="field">
          <span>测试提示词</span>
          <textarea v-model="form.prompt" rows="4" placeholder="你好，请返回一句自我介绍。" />
        </label>

        <div class="field">
          <div class="field-row">
            <span>输入图片（可选）</span>
            <div class="field-tools">
              <button type="button" class="link" @click="openImagePicker">选择图片</button>
              <button type="button" class="link" :disabled="!imageDataUrl" @click="clearImage">清空</button>
            </div>
          </div>

          <input
            ref="imageInputRef"
            type="file"
            accept="image/*"
            class="file-input"
            @change="handleImageFileChange"
          />

          <div
            class="drop-zone"
            :class="{ active: isDraggingImage }"
            @dragenter.prevent="isDraggingImage = true"
            @dragover.prevent="isDraggingImage = true"
            @dragleave.prevent="isDraggingImage = false"
            @drop.prevent="handleImageDrop"
          >
            <div v-if="!imageDataUrl" class="drop-zone-text">
              <div>拖拽图片到这里，或点击“选择图片”。</div>
              <div class="tips">也支持直接粘贴截图（Ctrl+V）。</div>
            </div>
            <div v-else class="image-preview">
              <img :src="imageDataUrl" alt="预览图片" />
              <div class="tips">
                <span v-if="imageMeta.name">文件：{{ imageMeta.name }}</span>
                <span v-if="imageMeta.sizeText">（{{ imageMeta.sizeText }}）</span>
              </div>
            </div>
          </div>

          <small v-if="imageError" class="tips error">{{ imageError }}</small>
          <small v-else class="tips">提示：只有多模态模型（如 `mimo-v2-omni`）才会真正理解图片。</small>
        </div>

        <label class="checkbox">
          <input v-model="form.stream" type="checkbox" />
          <span>开启 stream</span>
        </label>

        <div class="actions">
          <button type="submit" class="primary" :disabled="loading || !canTest">
            {{ loading ? "测试中..." : "测试模型" }}
          </button>
          <button type="button" class="secondary" :disabled="loading || !result.text" @click="copyText(result.text)">
            复制结果
          </button>
          <button type="button" class="secondary" :disabled="loading" @click="saveConfig">
            保存当前配置
          </button>
        </div>
      </form>

      <div class="result">
        <h3 class="result-title">测试结果</h3>
        <p class="status" :class="resultStatusClass">状态：{{ resultMessage }}</p>
        <pre>{{ resultText }}</pre>
      </div>
    </section>

    <section v-show="activeTab === 'tts'" class="card">
      <h2 class="card-title">TTS 测试</h2>

      <div class="config-form grid-2">
        <label class="field">
          <span>TTS 模型</span>
          <input v-model.trim="ttsForm.model" type="text" placeholder="mimo-v2.5-tts" />
        </label>
        <label class="field">
          <span>音色（voice）</span>
          <select v-model="ttsForm.voice">
            <option v-for="voiceName in ttsVoiceOptions" :key="voiceName" :value="voiceName">
              {{ voiceName }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>音频格式</span>
          <select v-model="ttsForm.format">
            <option value="mp3">mp3</option>
            <option value="wav">wav</option>
            <option value="opus">opus</option>
          </select>
        </label>
        <label class="field span-2">
          <span>朗读文本</span>
          <textarea v-model="ttsForm.input" rows="3" placeholder="你好，这是一段 TTS 测试音频。" />
        </label>

        <div class="actions">
          <button type="button" class="primary" :disabled="ttsLoading || !canTestTts" @click="handleTestTts">
            {{ ttsLoading ? "合成中..." : "测试 TTS" }}
          </button>
          <button type="button" class="secondary" :disabled="ttsLoading" @click="saveConfig">
            保存当前配置
          </button>
          <a v-if="ttsAudioUrl" class="download-link" :href="ttsAudioUrl" :download="`tts-output.${ttsForm.format}`">
            下载音频
          </a>
        </div>

        <p class="status" :class="ttsStatusClass">状态：{{ ttsResultMessage }}</p>
        <audio v-if="ttsAudioUrl" class="audio-player" :src="ttsAudioUrl" controls />
      </div>
    </section>

    <section v-show="activeTab === 'claude'" class="card">
      <h2 class="card-title">Claude Code（CLI）</h2>
      <p class="desc">
        复用本机已安装的 Claude Code CLI（命令 `claude`），通过本地转发层实时显示 stdout/stderr 与 git 变更。
      </p>

      <div class="config-form">
        <div class="actions">
          <button type="button" class="secondary" @click="handleCheckClaudeCli">
            检测 claude 命令
          </button>
          <span class="tips">{{ claudeCliStatus.text }}</span>
        </div>

        <label class="field">
          <span>工作目录（可选）</span>
          <input v-model.trim="claudeForm.cwd" type="text" placeholder="默认使用当前项目根目录" />
          <small class="tips">不填则在当前 Vite 进程工作目录执行。</small>
        </label>

        <label class="field">
          <span>任务描述（prompt）</span>
          <textarea v-model="claudeForm.prompt" rows="5" placeholder="描述你希望 Claude Code 完成的工作..." />
        </label>

        <label class="checkbox">
          <input v-model="claudeForm.bare" type="checkbox" />
          <span>使用 --bare（启动更快、上下文更可控）</span>
        </label>

        <label class="field">
          <span>allowedTools（可选）</span>
          <input v-model.trim="claudeForm.allowedTools" type="text" placeholder='例如：Bash,Read,Edit' />
          <small class="tips">用于非交互模式自动允许工具调用（按你的风险偏好调整）。</small>
        </label>

        <label class="field">
          <span>permissionMode（可选）</span>
          <select v-model="claudeForm.permissionMode">
            <option value="">（不设置）</option>
            <option value="acceptEdits">acceptEdits</option>
            <option value="dontAsk">dontAsk</option>
          </select>
        </label>

        <label class="field">
          <span>maxTurns（可选）</span>
          <input v-model.number="claudeForm.maxTurns" type="number" min="1" step="1" />
        </label>

        <div class="actions">
          <button type="button" class="primary" :disabled="claudeRunning" @click="startClaudeRun">
            {{ claudeRunning ? "运行中..." : "启动 Claude Code" }}
          </button>
          <button type="button" class="secondary" :disabled="!claudeRunning" @click="stopClaudeRun">
            停止
          </button>
          <button type="button" class="secondary" :disabled="claudeRunning" @click="saveConfig">
            保存当前配置
          </button>
          <span class="tips">阶段：{{ claudePhase }}</span>
        </div>

        <div v-if="claudeChangedFiles.length" class="tips">
          <strong>工作区变更：</strong>
          <ul class="file-list">
            <li v-for="item in claudeChangedFiles" :key="item.status + item.file">
              <code>{{ item.status }}</code>
              <span>{{ item.file }}</span>
            </li>
          </ul>
        </div>

        <p v-if="claudeStderr" class="status fail">stderr：{{ claudeStderr }}</p>
        <pre>{{ claudeOutput }}</pre>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { fetchAvailableModels, testAiModel, testTtsModel } from "../services/aiClient";
import { checkClaudeCli, runClaudeCodeSse, type ClaudeRunRequest, type ClaudeSseEvent } from "../services/claudeCodeClient";

interface AiConfigForm {
  endpoint: string;
  apiKey: string;
  model: string;
  prompt: string;
  stream: boolean;
}

interface TtsForm {
  model: string;
  voice: string;
  input: string;
  format: "mp3" | "wav" | "opus";
}

interface PersistedAiConfig {
  version: 3;
  activeTab?: TabKey;
  base: Pick<AiConfigForm, "endpoint" | "apiKey" | "model" | "prompt" | "stream">;
  web: {
    proxyUrl: string;
  };
  tts: TtsForm;
  claude: ClaudeRunRequest;
}

const STORAGE_KEY = "ai-config";

type TestPhase = "idle" | "running" | "success" | "fail";
type TabKey = "chat" | "tts" | "claude";

const router = useRouter();

const activeTab = ref<TabKey>("chat");
const apiKeyVisible = ref(false);
const saveHint = ref("");
let saveHintTimer: number | undefined;

function handleGoChat() {
  router.push({ path: "/chat" });
}

const form = reactive<AiConfigForm>({
  endpoint: "https://fufu.iqach.top/v1/chat/completions",
  apiKey: "",
  model: "mimo-v2.5-pro",
  prompt: "你好",
  stream: true,
});
const web = reactive({
  proxyUrl: "",
});

const loading = ref(false);
const modelsLoading = ref(false);
const availableModels = ref<string[]>([]);
const modelsStatusText = ref("可点击“获取可用模型”自动读取列表。");
const result = reactive({
  phase: "idle" as TestPhase,
  status: 0,
  text: "点击“测试模型”开始请求。",
});
const ttsForm = reactive<TtsForm>({
  model: "mimo-v2.5-tts",
  voice: "mimo_default",
  input: "你好，这是一段 TTS 测试音频。",
  format: "mp3",
});
const ttsVoiceOptions = ["mimo_default", "default_zh", "default_en"];
const ttsLoading = ref(false);
const ttsAudioUrl = ref("");
const ttsResult = reactive({
  phase: "idle" as TestPhase,
  status: 0,
  text: "点击“测试 TTS”开始请求。",
});

// ===== 图片输入（用于多模态模型）=====
const imageInputRef = ref<HTMLInputElement | null>(null);
const imageDataUrl = ref<string>("");
const imageError = ref<string>("");
const isDraggingImage = ref(false);
const imageMeta = reactive({
  name: "",
  sizeText: "",
});
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function openImagePicker() {
  imageInputRef.value?.click();
}

function clearImage() {
  imageDataUrl.value = "";
  imageError.value = "";
  imageMeta.name = "";
  imageMeta.sizeText = "";
  if (imageInputRef.value) imageInputRef.value.value = "";
}

function normalizeImageError(message: string) {
  imageError.value = message;
  if (imageDataUrl.value) imageDataUrl.value = "";
  imageMeta.name = "";
  imageMeta.sizeText = "";
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

async function setImageFile(file: File) {
  imageError.value = "";
  if (!file) return;
  if (!file.type?.startsWith("image/")) {
    normalizeImageError("请选择图片文件（image/*）。");
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    normalizeImageError(`图片过大（${formatBytes(file.size)}），请控制在 ${formatBytes(MAX_IMAGE_BYTES)} 以内。`);
    return;
  }

  imageMeta.name = file.name || "";
  imageMeta.sizeText = formatBytes(file.size);

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });

  if (!dataUrl.startsWith("data:image/")) {
    normalizeImageError("图片读取结果异常（不是 data:image/*）。");
    return;
  }
  imageDataUrl.value = dataUrl;
}

async function handleImageFileChange(event: Event) {
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0];
  if (!file) return;
  await setImageFile(file);
}

async function handleImageDrop(event: DragEvent) {
  isDraggingImage.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  await setImageFile(file);
}

async function handlePaste(event: ClipboardEvent) {
  if (activeTab.value !== "chat") return;
  const items = event.clipboardData?.items || [];
  const imageItem = Array.from(items).find((item) => item.kind === "file" && item.type.startsWith("image/"));
  const file = imageItem?.getAsFile();
  if (!file) return;
  await setImageFile(file);
}

function validateEndpoint(value: string): string {
  const input = value.trim();
  if (!input) return "请填写接口地址。";
  try {
    const url = new URL(input);
    if (!/^https?:$/.test(url.protocol)) return "接口地址需为 http/https。";
    return "";
  } catch {
    return "接口地址格式不正确，请检查是否是完整 URL。";
  }
}

const endpointError = computed(() => validateEndpoint(form.endpoint));
const endpointReady = computed(() => !endpointError.value);

function resolveModelsEndpointForDisplay(endpoint: string): string {
  const input = endpoint.trim();
  if (!input) return "";
  try {
    const url = new URL(input);
    const path = url.pathname;
    if (path.endsWith("/chat/completions")) url.pathname = path.replace(/\/chat\/completions$/, "/models");
    else if (!path.endsWith("/models")) url.pathname = (path.endsWith("/") ? path.slice(0, -1) : path) + "/models";
    return url.toString();
  } catch {
    if (input.endsWith("/chat/completions")) return input.replace(/\/chat\/completions$/, "/models");
    if (input.endsWith("/models")) return input;
    return `${input.replace(/\/$/, "")}/models`;
  }
}

function resolveTtsEndpointForDisplay(endpoint: string): string {
  const input = endpoint.trim();
  if (!input) return "";
  try {
    const url = new URL(input);
    const path = url.pathname;
    if (path.endsWith("/chat/completions")) url.pathname = path.replace(/\/chat\/completions$/, "/audio/speech");
    else if (!path.endsWith("/audio/speech"))
      url.pathname = (path.endsWith("/") ? path.slice(0, -1) : path) + "/audio/speech";
    return url.toString();
  } catch {
    if (input.endsWith("/chat/completions")) return input.replace(/\/chat\/completions$/, "/audio/speech");
    if (input.endsWith("/audio/speech")) return input;
    return `${input.replace(/\/$/, "")}/audio/speech`;
  }
}

const derivedModelsEndpoint = computed(() => resolveModelsEndpointForDisplay(form.endpoint));
const derivedTtsEndpoint = computed(() => resolveTtsEndpointForDisplay(form.endpoint));

const canTest = computed(() => endpointReady.value && Boolean(form.model.trim()) && Boolean(form.prompt.trim()));
const canTestTts = computed(
  () => endpointReady.value && Boolean(ttsForm.model.trim()) && Boolean(ttsForm.voice) && Boolean(ttsForm.input.trim()),
);

const resultMessage = computed(() => {
  if (result.phase === "idle") return "未测试";
  if (result.phase === "running") return "测试中...";
  if (result.phase === "success") return `成功（HTTP ${result.status}）`;
  return `失败（HTTP ${result.status || "N/A"}）`;
});

const resultStatusClass = computed(() => ({
  ok: result.phase === "success",
  fail: result.phase === "fail",
}));

const resultText = computed(() => result.text);
const ttsResultMessage = computed(() => {
  if (ttsResult.phase === "idle") return "未测试";
  if (ttsResult.phase === "running") return "合成中...";
  if (ttsResult.phase === "success") return `成功（HTTP ${ttsResult.status}）`;
  return `失败（HTTP ${ttsResult.status || "N/A"}）`;
});

const ttsStatusClass = computed(() => ({
  ok: ttsResult.phase === "success",
  fail: ttsResult.phase === "fail",
}));

// ===== Claude Code（CLI）集成 =====
const claudeCliStatus = reactive({
  ok: false,
  text: "未检测",
});

const claudeForm = reactive<ClaudeRunRequest>({
  prompt: "请阅读本项目，并在不破坏现有功能的前提下新增一个示例页面：展示 Hello + 当前时间。",
  cwd: "",
  bare: true,
  allowedTools: "Bash,Read,Edit",
  permissionMode: "acceptEdits",
  maxTurns: 6,
});

const claudeRunning = ref(false);
const claudeOutput = ref("");
const claudeStderr = ref("");
const claudePhase = ref("idle");
const claudeChangedFiles = ref<Array<{ status: string; file: string }>>([]);
let claudeAbortHandle: { abort: () => void } | null = null;
let claudeAutoChecked = false;

async function copyText(text: string) {
  const value = String(text ?? "");
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    saveHint.value = "已复制到剪贴板。";
  } catch {
    // 部分环境可能禁用 clipboard API，兜底用旧方式。
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
      saveHint.value = "已复制到剪贴板。";
    } catch {
      saveHint.value = "复制失败，请手动复制。";
    } finally {
      document.body.removeChild(textarea);
    }
  } finally {
    window.clearTimeout(saveHintTimer);
    saveHintTimer = window.setTimeout(() => {
      saveHint.value = "";
    }, 1800);
  }
}

async function handleCheckClaudeCli() {
  claudeCliStatus.ok = false;
  claudeCliStatus.text = "检测中...";
  try {
    const result = await checkClaudeCli();
    claudeCliStatus.ok = result.ok;
    claudeCliStatus.text = result.ok ? `已安装：${result.version || "未知版本"}` : `不可用：${result.error || "未知原因"}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    claudeCliStatus.ok = false;
    claudeCliStatus.text = `检测失败：${message}`;
  }
}

function appendOutputLine(text: string) {
  claudeOutput.value += text.endsWith("\n") ? text : `${text}\n`;
}

function handleClaudeEvent(event: ClaudeSseEvent) {
  if (event.type === "status") {
    claudePhase.value = String(event.data.phase || "status");
    appendOutputLine(`[status] ${JSON.stringify(event.data)}`);
    if (event.data.phase === "finished" || event.data.phase === "error" || event.data.phase === "http_error") {
      claudeRunning.value = false;
      claudeAbortHandle = null;
    }
    return;
  }

  if (event.type === "stderr") {
    claudeStderr.value += event.data.text;
    return;
  }

  if (event.type === "git_status") {
    claudeChangedFiles.value = event.data.files || [];
    return;
  }

  if (event.type === "claude") {
    // 为了兼容不同版本的输出格式，先原样展示 raw；如果你后面想“更像进度条”，我们再基于 parsed.type 做解析。
    appendOutputLine(event.data.raw);
    return;
  }

  appendOutputLine(`[unknown] ${JSON.stringify(event.data)}`);
}

function startClaudeRun() {
  if (!claudeForm.prompt.trim()) {
    claudeOutput.value = "请先填写 prompt。\n";
    return;
  }

  claudeAbortHandle?.abort();
  claudeAbortHandle = null;

  claudeRunning.value = true;
  claudePhase.value = "starting";
  claudeOutput.value = "";
  claudeStderr.value = "";
  claudeChangedFiles.value = [];

  claudeAbortHandle = runClaudeCodeSse(
    {
      ...claudeForm,
      cwd: claudeForm.cwd?.trim() || undefined,
      permissionMode: claudeForm.permissionMode?.trim() || undefined,
      allowedTools: claudeForm.allowedTools?.trim() || undefined,
      maxTurns: claudeForm.maxTurns || undefined,
    },
    handleClaudeEvent,
  );
}

function stopClaudeRun() {
  claudeAbortHandle?.abort();
  claudeAbortHandle = null;
  claudeRunning.value = false;
  claudePhase.value = "aborted";
  appendOutputLine("[status] 用户已停止");
}

function saveConfig() {
  const payload: PersistedAiConfig = {
    version: 3,
    activeTab: activeTab.value,
    base: {
      endpoint: form.endpoint,
      apiKey: form.apiKey,
      model: form.model,
      prompt: form.prompt,
      stream: form.stream,
    },
    web: {
      proxyUrl: web.proxyUrl,
    },
    tts: {
      model: ttsForm.model,
      voice: ttsForm.voice,
      input: ttsForm.input,
      format: ttsForm.format,
    },
    claude: {
      prompt: claudeForm.prompt,
      cwd: claudeForm.cwd?.trim() || undefined,
      bare: Boolean(claudeForm.bare),
      allowedTools: claudeForm.allowedTools?.trim() || undefined,
      permissionMode: claudeForm.permissionMode?.trim() || undefined,
      maxTurns: claudeForm.maxTurns || undefined,
      model: claudeForm.model?.trim() || undefined,
    },
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  saveHint.value = "配置已保存到本地 localStorage。";
  window.clearTimeout(saveHintTimer);
  saveHintTimer = window.setTimeout(() => {
    saveHint.value = "";
  }, 2000);
}

function loadConfig() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedAiConfig> | Partial<AiConfigForm>;

    // 兼容旧版：直接存了 base 表单。
    if (![2, 3].includes((parsed as any).version)) {
      const legacy = parsed as Partial<AiConfigForm>;
      form.endpoint = legacy.endpoint || form.endpoint;
      form.apiKey = legacy.apiKey || form.apiKey;
      form.model = legacy.model || form.model;
      form.prompt = legacy.prompt || form.prompt;
      form.stream = typeof legacy.stream === "boolean" ? legacy.stream : form.stream;
      return;
    }

    const payload = parsed as Partial<PersistedAiConfig>;
    if (payload.activeTab && ["chat", "tts", "claude"].includes(payload.activeTab)) {
      activeTab.value = payload.activeTab;
    }

    if (payload.base) {
      form.endpoint = payload.base.endpoint || form.endpoint;
      form.apiKey = payload.base.apiKey || form.apiKey;
      form.model = payload.base.model || form.model;
      form.prompt = payload.base.prompt || form.prompt;
      form.stream = typeof payload.base.stream === "boolean" ? payload.base.stream : form.stream;
    }

    if ((payload as any).web) {
      web.proxyUrl = String((payload as any).web?.proxyUrl || "");
    } else {
      web.proxyUrl = "";
    }

    if (payload.tts) {
      ttsForm.model = payload.tts.model || ttsForm.model;
      ttsForm.voice = payload.tts.voice || ttsForm.voice;
      ttsForm.input = payload.tts.input || ttsForm.input;
      ttsForm.format = payload.tts.format || ttsForm.format;
    }

    if (payload.claude) {
      claudeForm.prompt = payload.claude.prompt || claudeForm.prompt;
      claudeForm.cwd = payload.claude.cwd || "";
      claudeForm.bare = typeof payload.claude.bare === "boolean" ? payload.claude.bare : claudeForm.bare;
      claudeForm.allowedTools = payload.claude.allowedTools || claudeForm.allowedTools;
      claudeForm.permissionMode = payload.claude.permissionMode || claudeForm.permissionMode;
      claudeForm.maxTurns = payload.claude.maxTurns || claudeForm.maxTurns;
      claudeForm.model = payload.claude.model || claudeForm.model;
    }
  } catch {
    // 忽略损坏的本地配置，保留默认值。
  }
}

function handleExportConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || "";
    if (!raw) {
      saveHint.value = "当前没有可导出的配置（localStorage 为空）。";
      window.clearTimeout(saveHintTimer);
      saveHintTimer = window.setTimeout(() => (saveHint.value = ""), 1800);
      return;
    }
    copyText(raw);
  } catch {
    saveHint.value = "导出失败，请稍后重试。";
    window.clearTimeout(saveHintTimer);
    saveHintTimer = window.setTimeout(() => (saveHint.value = ""), 1800);
  }
}

function handleImportConfig() {
  const input = window.prompt("请粘贴导出的配置 JSON（会覆盖当前表单）", "");
  if (input == null) return;
  const text = String(input).trim();
  if (!text) return;
  try {
    const parsed = JSON.parse(text) as Partial<PersistedAiConfig> | Partial<AiConfigForm>;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    loadConfig();
    saveHint.value = "已导入配置。";
  } catch {
    saveHint.value = "导入失败：不是合法 JSON。";
  } finally {
    window.clearTimeout(saveHintTimer);
    saveHintTimer = window.setTimeout(() => (saveHint.value = ""), 2000);
  }
}

function handleResetConfig() {
  const ok = window.confirm("确认重置？这会清空本页已保存的本地配置，并恢复默认值。");
  if (!ok) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  window.location.reload();
}

async function fetchModels(forceRefresh: boolean) {
  if (!endpointReady.value) {
    modelsStatusText.value = endpointError.value || "请先填写接口地址。";
    return;
  }

  modelsLoading.value = true;
  modelsStatusText.value = "正在拉取模型列表...";
  try {
    const response = await fetchAvailableModels({
      endpoint: form.endpoint,
      apiKey: form.apiKey,
      forceRefresh,
    });

    if (!response.ok) {
      availableModels.value = [];
      modelsStatusText.value = response.error || "获取模型失败。";
      return;
    }

    availableModels.value = response.models;
    if (!availableModels.value.length) {
      modelsStatusText.value = "接口可达，但未解析到模型列表。";
      return;
    }

    if (!availableModels.value.includes(form.model)) {
      form.model = availableModels.value[0];
    }
    const cacheHint = response.fromCache ? "（来自缓存）" : "";
    modelsStatusText.value = `已加载 ${availableModels.value.length} 个模型${cacheHint}。`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    availableModels.value = [];
    modelsStatusText.value = `获取模型失败：${message}`;
  } finally {
    modelsLoading.value = false;
  }
}

async function handleFetchModels() {
  await fetchModels(false);
}

async function handleRefreshModels() {
  await fetchModels(true);
}

async function handleTest() {
  if (!canTest.value) {
    result.phase = "fail";
    result.status = 0;
    result.text = endpointError.value || "请先完整填写接口地址、模型名称、测试提示词。";
    return;
  }

  loading.value = true;
  result.phase = "running";
  result.status = 0;
  result.text = form.stream ? "正在流式接收...\n" : "请求中...\n";
  try {
    const response = await testAiModel({
      endpoint: form.endpoint,
      apiKey: form.apiKey,
      model: form.model,
      prompt: form.prompt,
      imageDataUrl: imageDataUrl.value || undefined,
      stream: form.stream,
      onStreamChunk: (chunkText) => {
        // 注意：流式情况下会持续追加；结束后再用 rawText 兜一次最终文本。
        result.text += chunkText;
      },
    });

    if (!response.ok) {
      result.phase = "fail";
      result.status = response.status;
      result.text = response.error || response.rawText || "请求失败。";
      return;
    }

    result.phase = "success";
    result.status = response.status;
    // 保留最终文本（避免不同浏览器/代理下流式尾包丢失）。
    result.text = response.rawText || result.text || "未返回内容。";
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    result.phase = "fail";
    result.status = 0;
    result.text = `请求异常：${message}`;
  } finally {
    loading.value = false;
  }
}

async function handleTestTts() {
  if (!canTestTts.value) {
    ttsResult.phase = "fail";
    ttsResult.status = 0;
    ttsResult.text = endpointError.value || "请先完整填写接口地址、TTS 模型、音色和朗读文本。";
    return;
  }

  ttsLoading.value = true;
  ttsResult.phase = "running";
  ttsResult.status = 0;
  ttsResult.text = "合成中...";
  try {
    const response = await testTtsModel({
      endpoint: form.endpoint,
      apiKey: form.apiKey,
      model: ttsForm.model,
      voice: ttsForm.voice,
      input: ttsForm.input,
      format: ttsForm.format,
    });

    if (response.ok && response.audioBlob) {
      if (ttsAudioUrl.value) {
        URL.revokeObjectURL(ttsAudioUrl.value);
      }
      ttsAudioUrl.value = URL.createObjectURL(response.audioBlob);
      ttsResult.phase = "success";
      ttsResult.status = response.status;
      ttsResult.text = "语音合成成功，可在线播放或下载。";
      return;
    }

    ttsResult.phase = "fail";
    ttsResult.status = response.status;
    ttsResult.text = response.error || "TTS 合成失败。";
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    ttsResult.phase = "fail";
    ttsResult.status = 0;
    ttsResult.text = `请求异常：${message}`;
  } finally {
    ttsLoading.value = false;
  }
}

onMounted(() => {
  loadConfig();
  window.addEventListener("paste", handlePaste);
});

watch(
  () => [form.endpoint, form.apiKey] as const,
  () => {
    // 输入变化时，模型缓存展示可能已过期，避免误导。
    availableModels.value = [];
    modelsStatusText.value = "接口或 Key 已变更，可重新获取模型列表。";
  },
);

watch(
  () => activeTab.value,
  (tab) => {
    if (tab === "claude" && !claudeAutoChecked) {
      claudeAutoChecked = true;
      handleCheckClaudeCli();
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (ttsAudioUrl.value) {
    URL.revokeObjectURL(ttsAudioUrl.value);
  }
  window.removeEventListener("paste", handlePaste);
  claudeAbortHandle?.abort();
  window.clearTimeout(saveHintTimer);
});
</script>

<style scoped>
:global(body) {
  margin: 0;
  background: radial-gradient(900px 520px at 18% 8%, rgba(31, 111, 235, 0.09), transparent 56%),
    radial-gradient(900px 560px at 90% 0%, rgba(130, 80, 223, 0.14), transparent 55%),
    radial-gradient(900px 560px at 50% 100%, rgba(26, 127, 55, 0.12), transparent 50%),
    #f6f8fa;
  color: #111827;
}

.ai-config-page {
  --bg: #ffffff;
  --text: #111827;
  --muted: rgba(17, 24, 39, 0.72);
  --subtle: rgba(17, 24, 39, 0.56);
  --border: rgba(17, 24, 39, 0.12);
  --border-2: rgba(17, 24, 39, 0.18);
  --ring: rgba(31, 111, 235, 0.22);
  --primary: #1f6feb;
  --danger: #cf222e;
  --ok: #1a7f37;
  --card-shadow: 0 10px 30px rgba(15, 23, 42, 0.08), 0 2px 8px rgba(15, 23, 42, 0.05);
  --card-shadow-hover: 0 14px 40px rgba(15, 23, 42, 0.12), 0 4px 12px rgba(15, 23, 42, 0.06);

  max-width: 980px;
  margin: 0 auto;
  padding: 22px 18px 40px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, "Noto Sans", "Liberation Sans", sans-serif;
}

.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.page-head h1 {
  margin: 0;
  font-size: 22px;
  letter-spacing: 0.2px;
}

.desc {
  color: var(--muted);
  margin: 6px 0 0;
  line-height: 1.5;
}

.tabs {
  display: flex;
  gap: 10px;
  margin: 14px 0 18px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.62);
  backdrop-filter: blur(8px);
}

.tab {
  border: 1px solid transparent;
  background: transparent;
  color: rgba(17, 24, 39, 0.86);
  border-radius: 999px;
  padding: 9px 14px;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
}

.tab.active {
  border-color: rgba(31, 111, 235, 0.35);
  background: rgba(31, 111, 235, 0.1);
  color: var(--primary);
}

.tab:hover {
  background: rgba(17, 24, 39, 0.04);
}

.tab:active {
  transform: translateY(1px);
}

.card {
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(10px);
  box-shadow: var(--card-shadow);
  margin-top: 14px;
  transition: box-shadow 160ms ease, border-color 160ms ease, transform 160ms ease;
}

.card:hover {
  border-color: var(--border-2);
  box-shadow: var(--card-shadow-hover);
}

.card-title {
  margin: 0 0 10px;
  font-size: 15px;
  letter-spacing: 0.2px;
}

.config-form {
  display: grid;
  gap: 12px;
}

.config-form.grid-2 {
  grid-template-columns: 1fr 1fr;
  align-items: start;
}

.field.span-2 {
  grid-column: 1 / -1;
}

.field {
  display: grid;
  gap: 6px;
}

.field > span {
  color: rgba(17, 24, 39, 0.84);
  font-size: 13px;
}

.field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.field-tools {
  display: inline-flex;
  gap: 10px;
}

.field input,
.field textarea,
.field select {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px;
  font-size: 14px;
  background: rgba(255, 255, 255, 0.92);
  color: var(--text);
  outline: none;
  transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;
}

.field input::placeholder,
.field textarea::placeholder {
  color: rgba(17, 24, 39, 0.42);
}

.field input:focus,
.field textarea:focus,
.field select:focus {
  border-color: rgba(31, 111, 235, 0.55);
  box-shadow: 0 0 0 4px var(--ring);
  background: #fff;
}

.file-input {
  display: none;
}

.drop-zone {
  border: 1px dashed rgba(17, 24, 39, 0.28);
  border-radius: 14px;
  background: rgba(17, 24, 39, 0.03);
  padding: 12px;
  min-height: 86px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 120ms ease, background 120ms ease, box-shadow 120ms ease;
}

.drop-zone.active {
  border-color: rgba(31, 111, 235, 0.8);
  background: rgba(31, 111, 235, 0.08);
  box-shadow: 0 0 0 4px rgba(31, 111, 235, 0.12);
}

.drop-zone-text {
  text-align: center;
  color: rgba(17, 24, 39, 0.64);
  font-size: 13px;
}

.image-preview {
  display: grid;
  gap: 8px;
  width: 100%;
}

.image-preview img {
  width: 100%;
  max-height: 260px;
  object-fit: contain;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid var(--border);
}

.model-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 8px;
}

.checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
}

.actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

button {
  border: none;
  background: var(--primary);
  color: #fff;
  border-radius: 12px;
  padding: 10px 16px;
  cursor: pointer;
  box-shadow: 0 8px 18px rgba(31, 111, 235, 0.18);
  transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease, opacity 120ms ease;
}

button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 12px 26px rgba(31, 111, 235, 0.22);
}

button:active:not(:disabled) {
  transform: translateY(0px);
}

button.primary {
  background: var(--primary);
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  box-shadow: none;
}

button.secondary {
  background: rgba(17, 24, 39, 0.72);
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.18);
}

button.secondary:hover:not(:disabled) {
  box-shadow: 0 12px 26px rgba(15, 23, 42, 0.22);
}

button.danger {
  background: var(--danger);
  box-shadow: 0 8px 18px rgba(207, 34, 46, 0.16);
}

button.danger:hover:not(:disabled) {
  box-shadow: 0 12px 26px rgba(207, 34, 46, 0.2);
}

.link {
  background: transparent;
  color: var(--primary);
  padding: 0;
  border-radius: 0;
  text-decoration: underline;
  box-shadow: none;
  transition: opacity 120ms ease, color 120ms ease;
}

.link:disabled {
  opacity: 0.5;
}

.result {
  margin-top: 12px;
}

.result-title {
  margin: 0 0 8px;
  font-size: 14px;
}

.tips {
  color: var(--subtle);
  font-size: 12px;
}

.tips.error {
  color: var(--danger);
}

.tips.ok {
  color: var(--ok);
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 2px 10px;
  border: 1px solid var(--border);
  font-size: 12px;
  color: rgba(17, 24, 39, 0.66);
  background: rgba(255, 255, 255, 0.72);
}

.badge.ok {
  border-color: rgba(26, 127, 55, 0.38);
  color: var(--ok);
  background: rgba(26, 127, 55, 0.08);
}

.badge.fail {
  border-color: rgba(207, 34, 46, 0.4);
  color: var(--danger);
  background: rgba(207, 34, 46, 0.08);
}

.audio-player {
  width: 100%;
}

.download-link {
  display: inline-flex;
  align-items: center;
  color: var(--primary);
  text-decoration: none;
  font-size: 14px;
}

.status.ok {
  color: var(--ok);
}

.status.fail {
  color: var(--danger);
}

.file-list {
  margin: 8px 0 0;
  padding-left: 18px;
}

.file-list li {
  display: flex;
  gap: 10px;
  align-items: baseline;
  font-size: 13px;
}

.file-list code {
  display: inline-block;
  min-width: 24px;
  padding: 1px 6px;
  border-radius: 6px;
  background: #eaeef2;
}

pre {
  background: rgba(17, 24, 39, 0.03);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 12px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.inline-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 12px;
}

.models-pre {
  max-height: 220px;
  overflow: auto;
}

@media (max-width: 640px) {
  .page-head {
    flex-direction: column;
  }

  .config-form.grid-2 {
    grid-template-columns: 1fr;
  }

  .model-row {
    grid-template-columns: 1fr;
  }
}

@media (prefers-color-scheme: dark) {
  :global(body) {
    background: radial-gradient(900px 520px at 18% 8%, rgba(31, 111, 235, 0.14), transparent 62%),
      radial-gradient(900px 560px at 90% 0%, rgba(130, 80, 223, 0.18), transparent 60%),
      radial-gradient(900px 560px at 50% 100%, rgba(26, 127, 55, 0.16), transparent 55%),
      #0b1220;
    color: rgba(255, 255, 255, 0.92);
  }

  .ai-config-page {
    --bg: rgba(17, 24, 39, 0.78);
    --text: rgba(255, 255, 255, 0.92);
    --muted: rgba(255, 255, 255, 0.72);
    --subtle: rgba(255, 255, 255, 0.6);
    --border: rgba(255, 255, 255, 0.14);
    --border-2: rgba(255, 255, 255, 0.2);
    --ring: rgba(31, 111, 235, 0.28);
    --card-shadow: 0 18px 44px rgba(0, 0, 0, 0.35), 0 2px 10px rgba(0, 0, 0, 0.2);
    --card-shadow-hover: 0 22px 56px rgba(0, 0, 0, 0.42), 0 4px 16px rgba(0, 0, 0, 0.24);
  }

  .tabs,
  .card {
    background: rgba(17, 24, 39, 0.72);
  }

  .tab {
    color: rgba(255, 255, 255, 0.86);
  }

  .tab:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .field > span {
    color: rgba(255, 255, 255, 0.86);
  }

  .field input,
  .field textarea,
  .field select {
    background: rgba(2, 6, 23, 0.55);
    color: rgba(255, 255, 255, 0.92);
    border-color: rgba(255, 255, 255, 0.16);
  }

  .field input::placeholder,
  .field textarea::placeholder {
    color: rgba(255, 255, 255, 0.42);
  }

  .field input:focus,
  .field textarea:focus,
  .field select:focus {
    background: rgba(2, 6, 23, 0.72);
  }

  pre {
    background: rgba(2, 6, 23, 0.55);
  }

  .badge {
    background: rgba(2, 6, 23, 0.35);
  }

  .drop-zone {
    background: rgba(2, 6, 23, 0.35);
    border-color: rgba(255, 255, 255, 0.22);
  }

  .image-preview img {
    background: rgba(2, 6, 23, 0.45);
  }
}
</style>
