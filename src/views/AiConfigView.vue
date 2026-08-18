<template>
  <div class="ai-config-page">
    <div class="page-head">
      <div class="page-title-wrap">
        <h1>AI 模型配置</h1>
        <p class="desc">配置 OpenAI 兼容接口、模型参数与服务，支持快捷键 Ctrl/⌘ + S 保存</p>
      </div>
      <div class="head-actions">
        <div class="action-group nav-group">
          <button type="button" class="secondary" @click="handleGoChat">💬 对话</button>
          <router-link class="secondary link-btn" to="/vibe-coding">💻 Vibe Coding</router-link>
        </div>
        <div class="action-divider"></div>
        <div class="action-group">
          <button type="button" class="secondary" title="导出配置文件" @click="handleExportConfig">导出</button>
          <button type="button" class="secondary" title="导入配置文件" @click="handleImportConfig">导入</button>
          <button type="button" class="secondary danger outline" title="重置为默认配置" @click="handleResetConfig">重置</button>
          <button type="button" class="primary save-btn" title="保存所有配置 (Ctrl+S)" @click="saveConfig">保存配置</button>
        </div>
      </div>
    </div>

    <!-- 顶部 Tab 导航 -->
    <nav class="tabs" aria-label="AI 配置选项卡">
      <button
        type="button"
        class="tab"
        :class="{ active: activeTab === 'chat' }"
        @click="activeTab = 'chat'"
      >
        🤖 模型供应商
      </button>
      <button
        type="button"
        class="tab"
        :class="{ active: activeTab === 'tts' }"
        @click="activeTab = 'tts'"
      >
        🎙️ TTS 语音
      </button>
      <button
        type="button"
        class="tab"
        :class="{ active: activeTab === 'experimental' }"
        @click="activeTab = 'experimental'"
      >
        🧪 实验特性
      </button>
    </nav>

    <!-- Tab 1: 模型供应商 -->
    <section v-show="activeTab === 'chat'" class="card main-config-card">
      <div class="card-header-row">
        <div>
          <h2 class="card-title">模型供应商</h2>
          <p class="desc">配置多个 OpenAI 兼容接口，并选择其中一个作为全局默认供应商</p>
        </div>
        <div class="provider-quick-fill">
          <select
            v-model="presetSelected"
            class="preset-select"
            aria-label="用预设填充供应商"
            @change="applyPreset(presetSelected)"
          >
            <option value="" disabled>✨ 用预设填充…</option>
            <option v-for="p in providerPresets" :key="p.name" :value="p.name">
              {{ p.name }}{{ p.model ? `（${p.model}）` : "" }}
            </option>
          </select>
        </div>
      </div>

      <!-- 服务器连接条：web/服务器模式下登录入口与状态（配置在下方表单，保存时同步到服务端） -->
      <div v-if="!isDesktopRuntime" class="server-strip">
        <template v-if="serverLoggedIn">
          <span class="server-strip-status ok">🖥️ 已连接服务器</span>
          <span class="server-strip-note">{{ serverCfgNote }}</span>
          <button type="button" class="link" @click="handleServerLogout">退出登录</button>
        </template>
        <template v-else>
          <span class="server-strip-label">🖥️ 服务器模式</span>
          <input
            v-model="serverLoginPassword"
            type="password"
            class="server-strip-token"
            placeholder="输入服务器 AIALL_SERVER_TOKEN"
            @keyup.enter="handleServerLogin"
          />
          <button type="button" class="secondary" :disabled="serverAuthBusy" @click="handleServerLogin">
            {{ serverAuthBusy ? "登录中..." : "登录服务器" }}
          </button>
          <span v-if="serverLoginError" class="server-strip-error">{{ serverLoginError }}</span>
        </template>
      </div>

      <!-- 供应商切换条 -->
      <div class="provider-bar" role="tablist" aria-label="模型供应商列表">
        <button
          v-for="provider in providers"
          :key="provider.id"
          type="button"
          class="provider-chip"
          :class="{ active: editingProviderId === provider.id, default: activeProviderId === provider.id }"
          role="tab"
          :aria-selected="editingProviderId === provider.id"
          @click="selectProvider(provider.id)"
        >
          <span class="provider-chip-name">{{ provider.name || "未命名" }}</span>
          <span v-if="activeProviderId === provider.id" class="provider-default-badge">默认</span>
        </button>
        <button type="button" class="provider-add" @click="addProvider">+ 添加供应商</button>
      </div>

      <div class="provider-actions">
        <button
          v-if="editingProviderId && editingProviderId !== activeProviderId"
          type="button"
          class="secondary"
          @click="setActiveProvider(editingProviderId)"
        >
          ⭐ 设为默认供应商
        </button>
        <button
          type="button"
          class="secondary danger outline"
          :disabled="providers.length <= 1"
          @click="removeProvider(editingProviderId)"
        >
          🗑️ 删除此供应商
        </button>
      </div>

      <div class="config-form grid-2">
        <label class="field span-2">
          <span>供应商名称</span>
          <input v-model.trim="form.name" type="text" placeholder="例如：MiMo 官方 / DeepSeek / 本地 Ollama" />
        </label>

        <label class="field span-2">
          <div class="field-row">
            <span>接口地址 (Base URL)</span>
            <div class="field-tools">
              <button v-if="canSimplifyEndpoint" type="button" class="link" @click="simplifyEndpoint">
                简化为 Base URL
              </button>
              <span class="badge" :class="endpointReady ? 'ok' : 'fail'">
                {{ endpointReady ? "可用" : "需修正" }}
              </span>
            </div>
          </div>
          <input v-model.trim="form.endpoint" type="text" placeholder="https://api.openai.com/v1" />
          <small v-if="endpointError" class="tips error">{{ endpointError }}</small>
          <small v-else class="tips">
            支持标准 Base URL（如 <code class="inline-code">https://api.example.com/v1</code>），系统会自动补全 <code class="inline-code">/chat/completions</code>。
          </small>
        </label>

        <label class="field">
          <div class="field-row">
            <span>API Key（可选）</span>
            <div class="field-tools">
              <button type="button" class="link" @click="apiKeyVisible = !apiKeyVisible">
                {{ apiKeyVisible ? "隐藏" : "显示" }}
              </button>
              <button type="button" class="link" @click="pasteApiKey">粘贴</button>
              <button type="button" class="link" :disabled="!form.apiKey" @click="copyText(form.apiKey)">
                复制
              </button>
            </div>
          </div>
          <input
            v-model.trim="form.apiKey"
            :type="apiKeyVisible ? 'text' : 'password'"
            placeholder="sk-xxxx（如需鉴权请填写）"
            autocomplete="off"
            @paste="handleApiKeyPaste"
          />
        </label>

        <label class="field">
          <div class="field-row">
            <span>模型名称（Model）</span>
            <div class="field-tools">
              <button type="button" class="link" :disabled="modelsLoading || !endpointReady" @click="handleFetchModels">
                {{ modelsLoading ? "获取中..." : "获取模型" }}
              </button>
              <button v-if="availableModels.length" type="button" class="link" :disabled="modelsLoading || !endpointReady" @click="handleRefreshModels">
                刷新
              </button>
            </div>
          </div>
          <div class="model-row">
            <select v-if="availableModels.length" v-model="form.model" class="model-select" aria-label="选择模型">
              <option v-for="modelName in availableModels" :key="modelName" :value="modelName">
                {{ modelName }}
              </option>
            </select>
            <input v-model.trim="form.model" type="text" placeholder="例如：mimo-v2.5-pro / gpt-4o / deepseek-chat" />
          </div>
          <small v-if="modelsStatusText" class="tips">{{ modelsStatusText }}</small>
        </label>

        <label class="field span-2">
          <div class="field-row">
            <span>网页抓取代理（HTTP，可选）</span>
            <div class="field-tools">
              <button
                type="button"
                class="link"
                :disabled="!web.proxyUrl.trim() || proxyTestLoading"
                @click="handleProxyTest"
              >
                {{ proxyTestLoading ? "测试中..." : "测试" }}
              </button>
              <button type="button" class="link" :disabled="!web.proxyUrl" @click="copyText(web.proxyUrl)">复制</button>
            </div>
          </div>
          <input v-model.trim="web.proxyUrl" type="text" placeholder="例如：http://127.0.0.1:7890" />
          <small class="tips">
            用于 Node 侧联网（聊天页抓取 URL、Vibe Agent 的 web_search / web_extract）。可点「测试」验证。
          </small>
          <p v-if="proxyTestHint" class="tips" :class="proxyTestOk ? 'ok' : 'error'">{{ proxyTestHint }}</p>
        </label>
      </div>

      <p v-if="saveHint" class="tips ok">{{ saveHint }}</p>

      <!-- 内置连通性快速测试 -->
      <div class="inline-test-section">
        <div class="inline-test-header">
          <h3 class="inline-test-title">⚡ 接口连通性测试</h3>
          <label class="checkbox stream-checkbox">
            <input v-model="form.stream" type="checkbox" />
            <span>开启 Stream</span>
          </label>
        </div>
        <form class="inline-test-form" @submit.prevent="handleTest">
          <div class="inline-test-input-row">
            <input v-model="form.prompt" type="text" class="inline-test-prompt" placeholder="输入测试提示词，例如：你好，请返回一句自我介绍。" />
            <button type="submit" class="primary compact-test-btn" :disabled="loading || !canTest">
              {{ loading ? "测试中..." : "发送测试" }}
            </button>
          </div>
        </form>

        <div v-if="result.text || loading" class="result inline-test-result">
          <div class="result-head-row">
            <span class="status" :class="resultStatusClass">状态：{{ resultMessage }}</span>
            <button v-if="result.text" type="button" class="link" @click="copyText(result.text)">复制结果</button>
          </div>
          <pre>{{ resultText }}</pre>
        </div>
      </div>
    </section>

    <!-- Tab 2: TTS 语音合成 -->
    <section v-show="activeTab === 'tts'" class="card">
      <h2 class="card-title">🎙️ TTS 语音合成测试</h2>
      <p class="desc">MiMo TTS 使用 <code class="inline-code">/chat/completions</code> 接口，朗读文本会作为 assistant 消息发送。</p>

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

        <div class="actions span-2">
          <button type="button" class="primary" :disabled="ttsLoading || !canTestTts" @click="handleTestTts">
            {{ ttsLoading ? "合成中..." : "测试合成 TTS" }}
          </button>
          <a v-if="ttsAudioUrl" class="secondary link-btn" :href="ttsAudioUrl" :download="`tts-output.${ttsForm.format}`">
            下载音频
          </a>
        </div>

        <div v-if="ttsResultMessage || ttsAudioUrl" class="span-2">
          <p class="status" :class="ttsStatusClass">状态：{{ ttsResultMessage }}</p>
          <audio v-if="ttsAudioUrl" class="audio-player" :src="ttsAudioUrl" controls />
        </div>
      </div>
    </section>

    <!-- Tab 4: 实验特性（网页视觉长图与总结） -->
    <section v-show="activeTab === 'experimental'" class="card">
      <h2 class="card-title">🧪 页面长图 + 视觉总结 (MVP)</h2>
      <p class="desc">
        仅在<strong>本机桌面/开发环境</strong>有效：调用 Playwright 弹出 Chromium 浏览器窗口截取整页长图，并由多模态模型提取网页核心信息。
      </p>

      <div class="config-form">
        <label class="field">
          <span>页面 URL</span>
          <input v-model.trim="visionMvp.url" type="text" placeholder="https://linux.do/" />
        </label>

        <label class="checkbox">
          <input v-model="visionMvp.headed" type="checkbox" />
          <span>有头模式（弹出真实可操作的浏览器窗口，方便在目标页面手动登录）</span>
        </label>

        <label class="field">
          <span>首屏加载后等待时间（秒）</span>
          <input v-model.number="visionMvp.waitSeconds" type="number" min="0" max="300" step="5" />
          <small class="tips">公开页填 0 即可；若需现场登录建议设置 60～120 秒。</small>
        </label>

        <div class="actions">
          <button type="button" class="primary" :disabled="visionMvpLoading || !visionMvpUrlOk" @click="handleVisionMvpScreenshot">
            {{ visionMvpLoading ? "截图中（较耗时）..." : "截取整页长图" }}
          </button>
          <button type="button" class="secondary" :disabled="!visionMvpDataUrl" @click="clearVisionMvpScreenshot">清除截图</button>
        </div>

        <p v-if="visionMvpHint" class="tips">{{ visionMvpHint }}</p>
        <p v-if="visionMvpError" class="tips error">{{ visionMvpError }}</p>

        <div v-if="visionMvpDataUrl" class="vision-mvp-preview">
          <img :src="visionMvpDataUrl" alt="整页截图预览" />
        </div>

        <template v-if="visionMvpDataUrl">
          <label class="field">
            <span>视觉总结提示词</span>
            <textarea v-model="visionMvp.summaryPrompt" rows="3" placeholder="描述希望模型如何从截图里提炼信息" />
          </label>

          <div class="actions">
            <button
              type="button"
              class="primary"
              :disabled="visionMvpSummaryLoading || !canVisionMvpSummary"
              @click="handleVisionMvpSummarize"
            >
              {{ visionMvpSummaryLoading ? "请求模型中..." : "用当前模型做视觉总结" }}
            </button>
          </div>

          <div v-if="visionMvpSummaryText" class="result vision-mvp-summary">
            <h3 class="result-title">视觉总结输出</h3>
            <pre>{{ visionMvpSummaryText }}</pre>
          </div>
        </template>
      </div>
    </section>

    <InputPrompt />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { lsGet, lsRemove } from "../utils/localStorageSafe";
import { fetchAvailableModels, testAiModel, testTtsModel } from "../services/aiClient";
import { isTauriEnv } from "../services/tauriInvoke";
import {
  isServerLoggedIn,
  serverLogin,
  serverLogout,
  fetchServerAiConfig,
  saveServerAiConfig,
} from "../services/serverAuth";
import InputPrompt from "../components/InputPrompt.vue";
import { useInputPrompt } from "../composables/useInputPrompt";
import { requestPageScreenshot } from "../services/pageScreenshotClient";
import { extractWebText } from "../services/webExtractClient";
import {
  AI_CONFIG_VERSION,
  AI_LOCAL_CONFIG_KEY,
  PROVIDER_PRESETS,
  type AiConfigTabKey,
  type AiProvider,
  type AiTtsConfig,
  createDefaultProvider,
  loadPersistedAiConfigFromStorage,
  migratePersistedAiConfig,
  normalizeWebProxyUrl,
  savePersistedAiConfigToStorage,
} from "../services/aiLocalConfig";

interface AiConfigForm {
  name: string;
  endpoint: string;
  apiKey: string;
  model: string;
  prompt: string;
  stream: boolean;
}

type TestPhase = "idle" | "running" | "success" | "fail";
type TabKey = AiConfigTabKey;

const router = useRouter();
const inputPrompt = useInputPrompt();

const activeTab = ref<TabKey>("chat");
const apiKeyVisible = ref(false);
const saveHint = ref("");
let saveHintTimer: number | undefined;

// ── 服务器模式（web / agent-server）──
const isDesktopRuntime = isTauriEnv();
const serverLoggedIn = ref(isServerLoggedIn());
const serverLoginPassword = ref("");
const serverLoginError = ref("");
const serverAuthBusy = ref(false);
const serverCfgNote = ref("");

async function refreshServerLoginState() {
  serverLoggedIn.value = isServerLoggedIn();
  if (serverLoggedIn.value) {
    const cfg = await fetchServerAiConfig();
    serverCfgNote.value = cfg.ok
      ? cfg.hasServerKey
        ? "服务端已配置 API Key；本页「保存配置」会同步到服务端。"
        : "服务端尚未配置 API Key，请在本页填写后点「保存配置」。"
      : cfg.error || "无法获取服务端 AI 配置";
  } else {
    serverCfgNote.value = "";
  }
}

async function handleServerLogin() {
  if (serverAuthBusy.value) return;
  serverAuthBusy.value = true;
  serverLoginError.value = "";
  const result = await serverLogin(serverLoginPassword.value.trim());
  serverAuthBusy.value = false;
  if (result.ok) {
    serverLoginPassword.value = "";
    await refreshServerLoginState();
  } else {
    serverLoginError.value = result.error || "登录失败";
  }
}

async function handleServerLogout() {
  await serverLogout();
  await refreshServerLoginState();
}

const providers = ref<AiProvider[]>([createDefaultProvider()]);
const activeProviderId = ref(providers.value[0].id);
const editingProviderId = ref(providers.value[0].id);

function handleGoChat() {
  router.push({ path: "/chat" });
}

const form = reactive<AiConfigForm>({
  name: "默认供应商",
  endpoint: "https://fufu.iqach.top/v1",
  apiKey: "",
  model: "mimo-v2.5-pro",
  prompt: "你好",
  stream: true,
});

function syncFormToProvider(providerId: string) {
  const provider = providers.value.find((item) => item.id === providerId);
  if (!provider) return;
  provider.name = form.name;
  provider.endpoint = form.endpoint;
  provider.apiKey = form.apiKey;
  provider.model = form.model;
  provider.prompt = form.prompt;
  provider.stream = form.stream;
}

function syncProviderToForm(providerId: string) {
  const provider = providers.value.find((item) => item.id === providerId);
  if (!provider) return;
  form.name = provider.name;
  form.endpoint = provider.endpoint;
  form.apiKey = provider.apiKey;
  form.model = provider.model;
  form.prompt = provider.prompt;
  form.stream = provider.stream;
}

function selectProvider(providerId: string) {
  if (editingProviderId.value === providerId) return;
  syncFormToProvider(editingProviderId.value);
  editingProviderId.value = providerId;
  syncProviderToForm(providerId);
  availableModels.value = [];
  modelsStatusText.value = "已切换供应商，可重新获取模型列表。";
}

function addProvider() {
  syncFormToProvider(editingProviderId.value);
  const provider = createDefaultProvider(`供应商 ${providers.value.length + 1}`);
  providers.value.push(provider);
  editingProviderId.value = provider.id;
  syncProviderToForm(provider.id);
  availableModels.value = [];
  modelsStatusText.value = "已添加新供应商，请填写接口信息。";
}

const providerPresets = PROVIDER_PRESETS;
const presetSelected = ref("");

/** 用预设填充当前编辑的供应商（endpoint / model，apiKey 留空）。 */
function applyPreset(presetName: string) {
  const preset = providerPresets.find((p) => p.name === presetName);
  presetSelected.value = "";
  if (!preset) return;
  syncFormToProvider(editingProviderId.value);
  form.endpoint = preset.endpoint;
  form.model = preset.model;
  if (!form.name || form.name === "默认供应商") {
    form.name = preset.name;
  }
  availableModels.value = [];
  modelsStatusText.value = preset.model
    ? `已应用预设「${preset.name}」，请填写 API Key。`
    : `已应用预设「${preset.name}」，请填写 API Key 后点「获取模型」选择模型。`;
}

function setActiveProvider(providerId: string) {
  if (!providers.value.some((item) => item.id === providerId)) return;
  activeProviderId.value = providerId;
  saveHint.value = "已设为默认供应商，记得点击「保存配置」。";
  window.clearTimeout(saveHintTimer);
  saveHintTimer = window.setTimeout(() => {
    saveHint.value = "";
  }, 2000);
}

function removeProvider(providerId: string) {
  if (providers.value.length <= 1) return;
  const ok = window.confirm("确认删除该供应商？删除后无法恢复。");
  if (!ok) return;

  syncFormToProvider(editingProviderId.value);
  const index = providers.value.findIndex((item) => item.id === providerId);
  if (index < 0) return;

  providers.value.splice(index, 1);
  if (activeProviderId.value === providerId) {
    activeProviderId.value = providers.value[0].id;
  }
  if (editingProviderId.value === providerId) {
    editingProviderId.value = providers.value[0].id;
    syncProviderToForm(editingProviderId.value);
  }
  availableModels.value = [];
  modelsStatusText.value = "已删除供应商。";
}
const web = reactive({
  proxyUrl: "",
});

/** 经代理探测 Node 能否访问外网（国内通常需代理才能连通） */
const PROXY_TEST_URL = "https://www.google.com/generate_204";

const proxyTestLoading = ref(false);
const proxyTestHint = ref("");
const proxyTestOk = ref(false);

async function handleProxyTest() {
  const normalized = normalizeWebProxyUrl(web.proxyUrl);
  if (!normalized) {
    proxyTestOk.value = false;
    proxyTestHint.value = "代理地址不合法，请填写如 http://127.0.0.1:7890";
    return;
  }
  if (normalized !== web.proxyUrl.trim()) {
    web.proxyUrl = normalized;
  }

  proxyTestLoading.value = true;
  proxyTestOk.value = false;
  proxyTestHint.value = "正在通过代理请求测试 URL…";
  try {
    const res = await extractWebText({
      url: PROXY_TEST_URL,
      mode: "html",
      proxyUrl: normalized,
      onProgress: (msg) => {
        proxyTestHint.value = msg;
      },
    });
    if (res.ok) {
      proxyTestOk.value = true;
      proxyTestHint.value = `代理可用（HTTP ${res.status}，Node 已通过 ${normalized} 连通外网）`;
    } else {
      proxyTestOk.value = false;
      proxyTestHint.value = res.error || `测试失败（HTTP ${res.status}）`;
    }
  } catch (error) {
    proxyTestOk.value = false;
    proxyTestHint.value = error instanceof Error ? error.message : "测试异常";
  } finally {
    proxyTestLoading.value = false;
  }
}

const loading = ref(false);
const modelsLoading = ref(false);
const availableModels = ref<string[]>([]);
const modelsStatusText = ref("可点击“获取可用模型”自动读取列表。");
const result = reactive({
  phase: "idle" as TestPhase,
  status: 0,
  text: "点击“测试模型”开始请求。",
});
const ttsForm = reactive<AiTtsConfig>({
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

const visionMvp = reactive({
  url: "https://linux.do/",
  headed: true,
  waitSeconds: 90,
  summaryPrompt:
    "请根据截图中的可见内容，用中文分条总结：页面类型、可见的帖子标题或区块、你认为的热点或注意事项。若文字过小无法辨认请说明。",
});
const visionMvpLoading = ref(false);
const visionMvpError = ref("");
const visionMvpHint = ref("");
const visionMvpDataUrl = ref("");
const visionMvpSummaryLoading = ref(false);
const visionMvpSummaryText = ref("");

const visionMvpUrlOk = computed(() => {
  try {
    const u = new URL(visionMvp.url.trim());
    return /^https?:$/.test(u.protocol);
  } catch {
    return false;
  }
});

const canVisionMvpSummary = computed(
  () => endpointReady.value && Boolean(form.model.trim()) && Boolean(visionMvp.summaryPrompt.trim()) && Boolean(visionMvpDataUrl.value),
);

function clearVisionMvpScreenshot() {
  visionMvpDataUrl.value = "";
  visionMvpError.value = "";
  visionMvpHint.value = "";
  visionMvpSummaryText.value = "";
}

async function handleVisionMvpScreenshot() {
  if (!visionMvpUrlOk.value) {
    visionMvpError.value = "请先填写合法的 http/https URL。";
    return;
  }
  visionMvpError.value = "";
  visionMvpHint.value = "";
  visionMvpSummaryText.value = "";
  visionMvpLoading.value = true;
  try {
    const waitMs = Math.round(Math.min(300, Math.max(0, visionMvp.waitSeconds)) * 1000);
    visionMvpHint.value =
      visionMvp.headed && waitMs > 0
        ? `将在约 ${visionMvp.waitSeconds} 秒内保持窗口开启，请在 Chromium 中完成登录；结束后自动截整页图。`
        : "正在截取整页图…";
    const res = await requestPageScreenshot({
      url: visionMvp.url.trim(),
      proxyUrl: web.proxyUrl?.trim() || undefined,
      headed: visionMvp.headed,
      waitAfterGotoMs: waitMs,
    });
    if (!res.ok) {
      visionMvpError.value = res.error;
      visionMvpHint.value = "";
      return;
    }
    visionMvpDataUrl.value = res.dataUrl;
    visionMvpHint.value =
      res.byteLength > 0
        ? `截图完成（约 ${formatBytes(res.byteLength)}）。若视觉接口报错，可缩短页面高度或改用更小视口（后续版本优化）。`
        : "截图完成。";
  } catch (error) {
    visionMvpError.value = error instanceof Error ? error.message : "截图异常";
    visionMvpHint.value = "";
  } finally {
    visionMvpLoading.value = false;
  }
}

async function handleVisionMvpSummarize() {
  if (!canVisionMvpSummary.value) return;
  visionMvpSummaryLoading.value = true;
  visionMvpSummaryText.value = form.stream ? "" : "请求中...\n";
  try {
    const response = await testAiModel({
      endpoint: form.endpoint,
      apiKey: form.apiKey,
      model: form.model,
      prompt: visionMvp.summaryPrompt.trim(),
      imageDataUrl: visionMvpDataUrl.value,
      stream: form.stream,
      onStreamChunk: (chunkText) => {
        visionMvpSummaryText.value += chunkText;
      },
    });

    if (!response.ok) {
      visionMvpSummaryText.value = response.error || response.rawText || "视觉总结请求失败。";
      return;
    }

    visionMvpSummaryText.value = response.rawText || visionMvpSummaryText.value || "未返回内容。";
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    visionMvpSummaryText.value = `请求异常：${message}`;
  } finally {
    visionMvpSummaryLoading.value = false;
  }
}

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

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return true;
  return target.isContentEditable;
}

function handleApiKeyPaste(event: ClipboardEvent) {
  const text = event.clipboardData?.getData("text/plain")?.trim();
  if (!text) return;
  event.preventDefault();
  form.apiKey = text;
}

async function pasteApiKey() {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!text) {
      saveHint.value = "剪贴板为空或非文本内容。";
      return;
    }
    form.apiKey = text;
    saveHint.value = "已从剪贴板粘贴 API Key。";
  } catch {
    saveHint.value = "粘贴失败，请在输入框内使用 Ctrl+V。";
  } finally {
    window.clearTimeout(saveHintTimer);
    saveHintTimer = window.setTimeout(() => {
      saveHint.value = "";
    }, 1800);
  }
}

async function handlePaste(event: ClipboardEvent) {
  if (activeTab.value !== "chat") return;
  if (isTextInputTarget(event.target)) return;
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

const canSimplifyEndpoint = computed(() => {
  const ep = form.endpoint.trim();
  return ep.endsWith("/chat/completions") || ep.endsWith("/completions");
});

function simplifyEndpoint() {
  const ep = form.endpoint.trim();
  if (ep.endsWith("/chat/completions")) form.endpoint = ep.replace(/\/chat\/completions$/, "");
  else if (ep.endsWith("/completions")) form.endpoint = ep.replace(/\/completions$/, "");
}

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
  return resolveChatEndpointForDisplay(endpoint);
}

function resolveChatEndpointForDisplay(endpoint: string): string {
  const input = endpoint.trim();
  if (!input) return "";
  if (input.endsWith("/chat/completions")) return input;
  if (input.endsWith("/completions")) return input.replace(/\/completions$/, "/chat/completions");
  return `${input.replace(/\/+$/, "")}/chat/completions`;
}

const derivedChatEndpoint = computed(() => resolveChatEndpointForDisplay(form.endpoint));
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

function handleSaveShortcut(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
  if (event.key !== "s" && event.key !== "S") return;
  event.preventDefault();
  saveConfig();
}

function scheduleSaveHintClear() {
  window.clearTimeout(saveHintTimer);
  saveHintTimer = window.setTimeout(() => {
    saveHint.value = "";
  }, 2800);
}

function saveConfig() {
  syncFormToProvider(editingProviderId.value);
  const normalizedProxy = normalizeWebProxyUrl(web.proxyUrl);
  if (normalizedProxy) {
    web.proxyUrl = normalizedProxy;
  }
  savePersistedAiConfigToStorage({
    version: AI_CONFIG_VERSION,
    activeProviderId: activeProviderId.value,
    providers: providers.value.map((provider) => ({ ...provider })),
    activeTab: activeTab.value,
    web: {
      proxyUrl: web.proxyUrl.trim(),
    },
    tts: {
      model: ttsForm.model,
      voice: ttsForm.voice,
      input: ttsForm.input,
      format: ttsForm.format,
    },
  });

  // 服务器模式（web）：主 tab 配置同步到服务端，Vibe 页才会使用；
  // 无需再单独去「服务器模式」tab 填一遍（旧设计两处配置同一件事）。
  if (serverLoggedIn.value) {
    saveHint.value = "配置已保存，正在同步到服务端…";
    void saveServerAiConfig({
      endpoint: form.endpoint.trim(),
      apiKey: form.apiKey.trim(),
      model: form.model.trim(),
      webProxyUrl: web.proxyUrl.trim() || undefined,
    }).then((res) => {
      if (res.ok) {
        saveHint.value = "配置已保存，并已同步到服务端（Vibe 页即刻可用）。";
        void refreshServerLoginState();
      } else {
        saveHint.value = `本地已保存；同步服务端失败：${res.error || "未知原因"}（服务端可能用环境变量 AIALL_SERVER_AI_* 接管了配置）`;
      }
      scheduleSaveHintClear();
    });
    return;
  }

  saveHint.value = "配置已保存到本地 localStorage。";
  scheduleSaveHintClear();
}

function loadConfig() {
  const stored = loadPersistedAiConfigFromStorage();
  if (!stored) {
    const raw = lsGet(AI_LOCAL_CONFIG_KEY);
    if (!raw) return;
    try {
      const migrated = migratePersistedAiConfig(JSON.parse(raw) as unknown);
      applyPersistedConfig(migrated);
    } catch {
      // 忽略损坏的本地配置，保留默认值。
    }
    return;
  }
  applyPersistedConfig(stored);
}

function applyPersistedConfig(payload: ReturnType<typeof migratePersistedAiConfig>) {
  providers.value = payload.providers.map((provider) => ({ ...provider }));
  activeProviderId.value = payload.activeProviderId;
  editingProviderId.value = payload.activeProviderId;
  if (payload.activeTab && ["chat", "tts"].includes(payload.activeTab)) {
    activeTab.value = payload.activeTab;
  }
  web.proxyUrl = payload.web.proxyUrl;
  ttsForm.model = payload.tts.model;
  ttsForm.voice = payload.tts.voice;
  ttsForm.input = payload.tts.input;
  ttsForm.format = payload.tts.format;
  syncProviderToForm(editingProviderId.value);
}

function handleExportConfig() {
  try {
    saveConfig();
    const raw = lsGet(AI_LOCAL_CONFIG_KEY) || "";
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

async function handleImportConfig() {
  const input = await inputPrompt.prompt("请粘贴导出的配置 JSON（会覆盖当前表单）", {
    placeholder: "粘贴 JSON...",
  });
  if (input == null) return;
  const text = input.trim();
  if (!text) return;
  try {
    const parsed = JSON.parse(text) as unknown;
    const migrated = migratePersistedAiConfig(parsed);
    savePersistedAiConfigToStorage(migrated);
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
  lsRemove(AI_LOCAL_CONFIG_KEY);
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
  void refreshServerLoginState();
  window.addEventListener("paste", handlePaste);
  window.addEventListener("keydown", handleSaveShortcut);
});

watch(
  () => [form.endpoint, form.apiKey, editingProviderId.value] as const,
  () => {
    // 输入变化时，模型缓存展示可能已过期，避免误导。
    availableModels.value = [];
    modelsStatusText.value = "接口或 Key 已变更，可重新获取模型列表。";
  },
);

watch(
  () => form.name,
  (name) => {
    const provider = providers.value.find((item) => item.id === editingProviderId.value);
    if (provider) provider.name = name;
  },
);

onBeforeUnmount(() => {
  if (ttsAudioUrl.value) {
    URL.revokeObjectURL(ttsAudioUrl.value);
  }
  window.removeEventListener("paste", handlePaste);
  window.removeEventListener("keydown", handleSaveShortcut);
  window.clearTimeout(saveHintTimer);
});
</script>

<style scoped>
.server-mode {
  border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
  background: rgba(17, 24, 39, 0.5);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
}
.server-mode-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.server-badge {
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--muted, rgba(255, 255, 255, 0.7));
}
.server-badge.ok {
  background: rgba(34, 197, 94, 0.15);
  color: #3fb950;
}
.server-mode code {
  background: rgba(0, 0, 0, 0.3);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
}
.server-login-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.server-login-row input {
  flex: 1;
  max-width: 360px;
}
.server-login-error {
  color: #f85149;
  font-size: 12px;
}
.server-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 12px;
  margin-bottom: 14px;
  border-radius: 8px;
  border: 1px solid rgba(130, 80, 223, 0.25);
  background: rgba(130, 80, 223, 0.08);
  font-size: 12px;
}
.server-strip-status {
  color: #3fb950;
  font-weight: 500;
}
.server-strip-label {
  color: #8250df;
  font-weight: 500;
}
.server-strip-note {
  color: var(--muted, rgba(255, 255, 255, 0.7));
  flex: 1;
  min-width: 160px;
}
.server-strip-token {
  padding: 6px 10px;
  border: 1px solid var(--border-2, rgba(255, 255, 255, 0.14));
  border-radius: 6px;
  background: rgba(2, 6, 23, 0.5);
  color: var(--text, rgba(255, 255, 255, 0.92));
  outline: none;
  width: 260px;
  font-size: 12px;
}
.server-strip-error {
  color: #f85149;
}
.server-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
  margin: 12px 0;
}
.server-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted, rgba(255, 255, 255, 0.7));
}
.server-field input {
  padding: 8px 10px;
  border: 1px solid var(--border-2, rgba(255, 255, 255, 0.14));
  border-radius: 6px;
  font-size: 13px;
  background: rgba(2, 6, 23, 0.5);
  color: var(--text, rgba(255, 255, 255, 0.92));
  outline: none;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.server-field input:focus {
  border-color: var(--primary, #58a6ff);
  background: rgba(2, 6, 23, 0.75);
}
.server-form-actions {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 10px;
}
.server-save-ok {
  color: #3fb950;
  font-size: 12px;
}
:global(html),
:global(body) {
  margin: 0;
  overflow: auto;
  overscroll-behavior: auto;
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
  --border: rgba(255, 255, 255, 0.12);
  --border-2: rgba(255, 255, 255, 0.18);
  --ring: rgba(31, 111, 235, 0.28);
  --primary: #1f6feb;
  --danger: #cf222e;
  --ok: #1a7f37;
  --card-shadow: 0 4px 12px rgba(0, 0, 0, 0.25), 0 1px 3px rgba(0, 0, 0, 0.15);
  --card-shadow-hover: 0 6px 20px rgba(0, 0, 0, 0.3), 0 2px 4px rgba(0, 0, 0, 0.2);

  max-width: 980px;
  margin: 0 auto;
  padding: 22px 18px 40px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, "Noto Sans", "Liberation Sans", sans-serif;
}

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.page-head > div:first-child {
  flex-shrink: 0;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.action-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.action-divider {
  width: 1px;
  height: 18px;
  background: var(--border-2);
  margin: 0 4px;
}

.nav-group {
  display: inline-flex;
  align-items: center;
  gap: 0;
  padding: 3px;
  border-radius: 10px;
  background: rgba(130, 80, 223, 0.08);
  border: 1px solid rgba(130, 80, 223, 0.15);
}

.nav-group .secondary,
.nav-group .link-btn {
  background: transparent;
  color: #8250df;
  box-shadow: none;
  border: none;
  border-radius: 7px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 500;
}

.nav-group .secondary:hover:not(:disabled),
.nav-group .link-btn:hover:not(:disabled) {
  background: rgba(130, 80, 223, 0.15);
  box-shadow: none;
}

.nav-group .secondary:active:not(:disabled),
.nav-group .link-btn:active:not(:disabled) {
  background: rgba(130, 80, 223, 0.22);
}

button.secondary {
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 8px;
}

button.danger.outline {
  background: transparent;
  color: var(--danger);
  border: 1px solid rgba(207, 34, 46, 0.3);
  box-shadow: none;
}

button.danger.outline:hover:not(:disabled) {
  background: rgba(207, 34, 46, 0.08);
  box-shadow: none;
}

button.primary {
  padding: 7px 18px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
}

.page-head h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.2px;
  color: var(--text);
}

.desc {
  color: var(--muted);
  margin: 4px 0 0;
  font-size: 14px;
  line-height: 1.5;
}

.tabs {
  display: flex;
  gap: 6px;
  margin: 0 0 20px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: rgba(17, 24, 39, 0.45);
  backdrop-filter: blur(8px);
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted);
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms ease;
}

.tab.active {
  border-color: rgba(88, 166, 255, 0.35);
  background: rgba(31, 111, 235, 0.18);
  color: rgba(100, 160, 255, 0.95);
  font-weight: 600;
}

.tab:hover:not(.active) {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.85);
}

.tab:active:not(.disabled) {
  transform: scale(0.98);
}

.tab-badge {
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(35, 134, 54, 0.25);
  color: #3fb950;
  border: 1px solid rgba(63, 185, 80, 0.3);
}

.card {
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 14px;
  padding: 22px;
  background: rgba(17, 24, 39, 0.65);
  backdrop-filter: blur(12px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25), 0 1px 3px rgba(0, 0, 0, 0.15);
  margin-top: 16px;
  transition: box-shadow 200ms ease, border-color 200ms ease;
}

.card:hover {
  border-color: var(--border-2, rgba(255, 255, 255, 0.18));
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3), 0 2px 4px rgba(0, 0, 0, 0.2);
}

.card-header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.card-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.1px;
  color: var(--text);
}
.provider-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.provider-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.06);
  color: var(--muted);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: none;
  transition: all 150ms ease;
}

.provider-chip:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text);
}

.provider-chip.active {
  border-color: rgba(88, 166, 255, 0.45);
  background: rgba(31, 111, 235, 0.18);
  color: #79c0ff;
  font-weight: 600;
}

.provider-chip.default:not(.active) {
  border-color: rgba(63, 185, 80, 0.4);
}

.provider-chip-name {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-default-badge {
  font-size: 11px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(35, 134, 54, 0.2);
  color: #3fb950;
  border: 1px solid rgba(63, 185, 80, 0.35);
}

.provider-add {
  border: 1px dashed var(--border-2);
  background: transparent;
  color: #58a6ff;
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 13px;
  box-shadow: none;
  cursor: pointer;
}

.provider-add:hover:not(:disabled) {
  background: rgba(88, 166, 255, 0.1);
  border-color: #58a6ff;
  transform: none;
  box-shadow: none;
}

.preset-select {
  border: 1px solid var(--border-2, rgba(255, 255, 255, 0.16));
  background: rgba(255, 255, 255, 0.06);
  color: var(--text, rgba(255, 255, 255, 0.9));
  border-radius: 999px;
  padding: 6px 28px 6px 12px;
  font-size: 13px;
  max-width: 260px;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='M4 6l4 4 4-4' stroke='rgba(255,255,255,0.7)' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  outline: none;
  transition: all 150ms ease;
}

.preset-select:hover {
  background-color: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.28);
}

.preset-select:focus {
  border-color: #58a6ff;
  box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.25);
}

.preset-select option {
  background: #161b22;
  color: rgba(255, 255, 255, 0.92);
  padding: 6px 10px;
}

.provider-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.config-form {
  display: grid;
  gap: 14px;
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
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
}

.field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.field-tools {
  display: inline-flex;
  gap: 8px;
}

.field input,
.field textarea,
.field select {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 14px;
  background: rgba(2, 6, 23, 0.5);
  color: var(--text, rgba(255, 255, 255, 0.92));
  outline: none;
  transition: border-color 150ms ease, box-shadow 150ms ease, background 150ms ease;
}

.field input::placeholder,
.field textarea::placeholder {
  color: rgba(255, 255, 255, 0.35);
}

.field input:focus,
.field textarea:focus,
.field select:focus {
  border-color: rgba(88, 166, 255, 0.5);
  box-shadow: 0 0 0 3px var(--ring);
  background: rgba(2, 6, 23, 0.75);
}

.file-input {
  display: none;
}

.drop-zone {
  border: 1px dashed rgba(17, 24, 39, 0.22);
  border-radius: 12px;
  background: rgba(17, 24, 39, 0.02);
  padding: 16px;
  min-height: 88px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 150ms ease, background 150ms ease, box-shadow 150ms ease;
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
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid var(--border);
}

.vision-mvp-preview {
  max-height: 320px;
  overflow: auto;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.92);
}

.vision-mvp-preview img {
  width: 100%;
  display: block;
  vertical-align: top;
}

.vision-mvp-summary {
  margin-top: 8px;
}

.model-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.model-row select {
  flex: 0 1 auto;
  min-width: 0;
}

.model-row input {
  flex: 1 1 0;
  min-width: 0;
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
  background: transparent;
  color: var(--text);
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms ease;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

button.primary {
  background: var(--primary);
  color: #fff;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(31, 111, 235, 0.2);
}

button.primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(31, 111, 235, 0.25);
}

button.primary:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 1px 2px rgba(31, 111, 235, 0.2);
}

button.secondary {
  background: rgba(17, 24, 39, 0.06);
  color: var(--text);
  border: 1px solid var(--border);
}

button.secondary:hover:not(:disabled) {
  background: rgba(17, 24, 39, 0.1);
}

button.secondary:hover:not(:disabled) {
  background: rgba(17, 24, 39, 0.1);
  box-shadow: none;
}

a.secondary.link-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  box-sizing: border-box;
  background: rgba(17, 24, 39, 0.06);
  color: var(--text);
  box-shadow: none;
  border: 1px solid var(--border);
}

a.secondary.link-btn:hover:not(:disabled) {
  background: rgba(17, 24, 39, 0.1);
  box-shadow: none;
}

button.danger {
  background: var(--danger);
  box-shadow: 0 1px 2px rgba(207, 34, 46, 0.2);
}

button.danger:hover:not(:disabled) {
  box-shadow: 0 4px 8px rgba(207, 34, 46, 0.25);
}

.link {
  background: transparent;
  color: var(--primary);
  padding: 0;
  border-radius: 0;
  text-decoration: underline;
  box-shadow: none;
  transition: opacity 150ms ease, color 150ms ease;
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

.inline-test-section {
  margin-top: 24px;
  padding-top: 18px;
  border-top: 1px solid var(--border, rgba(255, 255, 255, 0.12));
}

.inline-test-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.inline-test-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.inline-test-input-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.inline-test-prompt {
  flex: 1;
  background: rgba(2, 6, 23, 0.5);
  color: var(--text, rgba(255, 255, 255, 0.92));
  border: 1px solid var(--border-2, rgba(255, 255, 255, 0.14));
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13.5px;
  outline: none;
}

.inline-test-prompt:focus {
  border-color: var(--primary, #58a6ff);
  background: rgba(2, 6, 23, 0.75);
}

.compact-test-btn {
  white-space: nowrap;
  flex-shrink: 0;
}

.inline-test-result {
  margin-top: 14px;
  background: rgba(2, 6, 23, 0.4);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 8px;
  padding: 12px;
}

.result-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.inline-test-result pre {
  margin: 0;
  max-height: 200px;
  overflow-y: auto;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: rgba(255, 255, 255, 0.88);
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
  font-weight: 500;
  color: var(--muted);
  background: rgba(255, 255, 255, 0.7);
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

pre {
  background: rgba(17, 24, 39, 0.03);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.5;
}

.inline-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 12px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(17, 24, 39, 0.05);
}



.model-select {
  min-width: 0;
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
  :global(html),
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
    --border: rgba(255, 255, 255, 0.12);
    --border-2: rgba(255, 255, 255, 0.18);
    --ring: rgba(31, 111, 235, 0.28);
    --card-shadow: 0 4px 12px rgba(0, 0, 0, 0.25), 0 1px 3px rgba(0, 0, 0, 0.15);
    --card-shadow-hover: 0 6px 20px rgba(0, 0, 0, 0.3), 0 2px 4px rgba(0, 0, 0, 0.2);
  }

  .tabs {
    background: rgba(17, 24, 39, 0.6);
    border-color: rgba(255, 255, 255, 0.1);
  }

  .card {
    background: rgba(17, 24, 39, 0.65);
    border-color: rgba(255, 255, 255, 0.1);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2), 0 1px 2px rgba(0, 0, 0, 0.15);
  }

  .card:hover {
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25), 0 2px 4px rgba(0, 0, 0, 0.2);
  }

  .tab {
    color: rgba(255, 255, 255, 0.65);
  }

  .tab.active {
    background: rgba(31, 111, 235, 0.15);
    border-color: rgba(31, 111, 235, 0.35);
    color: rgba(100, 160, 255, 0.95);
  }

  .tab:hover:not(.active) {
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.85);
  }

  .provider-chip {
    background: rgba(2, 6, 23, 0.35);
    border-color: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.72);
  }

  .provider-chip.active {
    background: rgba(31, 111, 235, 0.18);
    border-color: rgba(31, 111, 235, 0.35);
    color: rgba(100, 160, 255, 0.95);
  }

  .provider-add {
    border-color: rgba(255, 255, 255, 0.18);
    color: rgba(100, 160, 255, 0.95);
  }

  .field > span {
    color: rgba(255, 255, 255, 0.85);
  }

  .field input,
  .field textarea,
  .field select {
    background: rgba(2, 6, 23, 0.5);
    color: rgba(255, 255, 255, 0.92);
    border-color: rgba(255, 255, 255, 0.14);
  }

  .field input::placeholder,
  .field textarea::placeholder {
    color: rgba(255, 255, 255, 0.4);
  }

  .field input:focus,
  .field textarea:focus,
  .field select:focus {
    background: rgba(2, 6, 23, 0.7);
    border-color: rgba(31, 111, 235, 0.5);
  }

  button.secondary {
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.85);
    border-color: rgba(255, 255, 255, 0.12);
  }

  button.secondary:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
  }

  a.secondary.link-btn {
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.85);
    border-color: rgba(255, 255, 255, 0.12);
  }

  a.secondary.link-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
  }

  pre {
    background: rgba(2, 6, 23, 0.5);
    border-color: rgba(255, 255, 255, 0.1);
  }

  .badge {
    background: rgba(2, 6, 23, 0.3);
    border-color: rgba(255, 255, 255, 0.1);
  }

  .drop-zone {
    background: rgba(2, 6, 23, 0.3);
    border-color: rgba(255, 255, 255, 0.18);
  }

  .image-preview img {
    background: rgba(2, 6, 23, 0.4);
  }

  .action-divider {
    background: rgba(255, 255, 255, 0.12);
  }

  .nav-group {
    background: rgba(130, 80, 223, 0.1);
    border-color: rgba(130, 80, 223, 0.18);
  }

  .nav-group .secondary,
  .nav-group .link-btn {
    color: #b392f0;
  }

  .nav-group .secondary:hover:not(:disabled),
  .nav-group .link-btn:hover:not(:disabled) {
    background: rgba(130, 80, 223, 0.18);
  }

  button.danger.outline {
    border-color: rgba(207, 34, 46, 0.35);
  }

  button.danger.outline:hover:not(:disabled) {
    background: rgba(207, 34, 46, 0.1);
  }
}
</style>
