<template>
  <div class="ai-config-page">
    <div class="page-head">
      <div>
        <h1>AI 配置</h1>
        <p class="desc">配置模型接口并测试连通性。快捷键：Ctrl/⌘ + S 保存。</p>
      </div>
      <div class="head-actions">
        <div class="action-group nav-group">
          <button type="button" class="secondary" @click="handleGoChat">去聊天</button>
          <router-link class="secondary link-btn" to="/vibe-coding">Vibe Coding</router-link>
          <router-link class="secondary link-btn" to="/icon-templates">图标模板</router-link>
        </div>
        <div class="action-divider"></div>
        <div class="action-group">
          <button type="button" class="secondary" @click="handleExportConfig">导出</button>
          <button type="button" class="secondary" @click="handleImportConfig">导入</button>
          <button type="button" class="secondary danger outline" @click="handleResetConfig">重置</button>
          <button type="button" class="primary" @click="saveConfig">保存配置</button>
        </div>
      </div>
    </div>

    <nav class="tabs" aria-label="AI 配置选项卡">
      <button type="button" class="tab" :class="{ active: activeTab === 'chat' }" @click="activeTab = 'chat'">
        模型/对话
      </button>
      <button type="button" class="tab" :class="{ active: activeTab === 'tts' }" @click="activeTab = 'tts'">
        TTS
      </button>

    </nav>

    <section class="card">
      <h2 class="card-title">模型供应商</h2>
      <p class="desc">可配置多个 OpenAI 兼容接口，并选择其中一个作为聊天与其它功能的默认供应商。</p>

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
        <button type="button" class="provider-add" @click="addProvider">+ 添加</button>
      </div>

      <div class="provider-actions">
        <button
          v-if="editingProviderId && editingProviderId !== activeProviderId"
          type="button"
          class="secondary"
          @click="setActiveProvider(editingProviderId)"
        >
          设为默认供应商
        </button>
        <button
          type="button"
          class="secondary danger outline"
          :disabled="providers.length <= 1"
          @click="removeProvider(editingProviderId)"
        >
          删除当前供应商
        </button>
      </div>

      <div class="config-form grid-2">
        <label class="field span-2">
          <span>供应商名称</span>
          <input v-model.trim="form.name" type="text" placeholder="例如：MiMo 官方 / 本地 Ollama" />
        </label>

        <label class="field span-2">
          <div class="field-row">
            <span>接口地址</span>
            <div class="field-tools">
              <button v-if="canSimplifyEndpoint" type="button" class="link" @click="simplifyEndpoint">
                简化为 Base URL
              </button>
              <span class="badge" :class="endpointReady ? 'ok' : 'fail'">
                {{ endpointReady ? "可用" : "需修正" }}
              </span>
            </div>
          </div>
          <input v-model.trim="form.endpoint" type="text" placeholder="https://example.com/v1（或完整地址 .../v1/chat/completions）" />
          <small v-if="endpointError" class="tips error">{{ endpointError }}</small>
          <small v-else class="tips">
            支持填写 Base URL（如 <code class="inline-code">/v1</code>），系统会自动补全 <code class="inline-code">/chat/completions</code>；也可直接填写完整地址。
          </small>
          <small v-if="endpointReady" class="tips">
            chat：<code class="inline-code">{{ derivedChatEndpoint }}</code>
            &nbsp;|&nbsp;
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

    <section v-show="activeTab === 'chat'" class="card">
      <h2 class="card-title">页面长图 + 视觉总结（MVP）</h2>
      <p class="desc">
        仅在<strong>本机</strong>运行 <code class="inline-code">npm run dev</code> 时有效：后端会启动 Playwright
        Chromium。勾选「有头模式」后弹出真实窗口，可在下方等待时间内<strong>手动登录</strong>，再截取<strong>整页长图</strong>；随后用支持图片的<strong>多模态模型</strong>总结（与上方「输入图片」测试共用同一套接口）。
      </p>

      <div class="config-form">
        <label class="field">
          <span>页面 URL</span>
          <input v-model.trim="visionMvp.url" type="text" placeholder="https://linux.do/" />
        </label>

        <label class="checkbox">
          <input v-model="visionMvp.headed" type="checkbox" />
          <span>有头模式（弹出可操作的浏览器窗口；关闭则为无头，无法现场登录）</span>
        </label>

        <label class="field">
          <span>首屏加载后等待（秒）</span>
          <input v-model.number="visionMvp.waitSeconds" type="number" min="0" max="300" step="5" />
          <small class="tips">用于在窗口内完成登录。公开页可填 0；需要登录建议 60～120。</small>
        </label>

        <div class="actions">
          <button type="button" class="primary" :disabled="visionMvpLoading || !visionMvpUrlOk" @click="handleVisionMvpScreenshot">
            {{ visionMvpLoading ? "截图中（等待结束时会较久）..." : "截取整页长图" }}
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

    <section v-show="activeTab === 'tts'" class="card">
      <h2 class="card-title">TTS 测试</h2>
      <p class="tips">MiMo TTS 使用 <code class="inline-code">/chat/completions</code> 接口（非 OpenAI 的 <code class="inline-code">/audio/speech</code>），朗读文本会作为 assistant 消息发送。</p>

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

    <InputPrompt />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { fetchAvailableModels, testAiModel, testTtsModel } from "../services/aiClient";
import InputPrompt from "../components/InputPrompt.vue";
import { useInputPrompt } from "../composables/useInputPrompt";
import { requestPageScreenshot } from "../services/pageScreenshotClient";
import {
  AI_CONFIG_VERSION,
  AI_LOCAL_CONFIG_KEY,
  type AiConfigTabKey,
  type AiProvider,
  type AiTtsConfig,
  createDefaultProvider,
  loadPersistedAiConfigFromStorage,
  migratePersistedAiConfig,
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

function saveConfig() {
  syncFormToProvider(editingProviderId.value);
  savePersistedAiConfigToStorage({
    version: AI_CONFIG_VERSION,
    activeProviderId: activeProviderId.value,
    providers: providers.value.map((provider) => ({ ...provider })),
    activeTab: activeTab.value,
    web: {
      proxyUrl: web.proxyUrl,
    },
    tts: {
      model: ttsForm.model,
      voice: ttsForm.voice,
      input: ttsForm.input,
      format: ttsForm.format,
    },
  });
  saveHint.value = "配置已保存到本地 localStorage。";
  window.clearTimeout(saveHintTimer);
  saveHintTimer = window.setTimeout(() => {
    saveHint.value = "";
  }, 2000);
}

function loadConfig() {
  const stored = loadPersistedAiConfigFromStorage();
  if (!stored) {
    const raw = localStorage.getItem(AI_LOCAL_CONFIG_KEY);
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
    const raw = localStorage.getItem(AI_LOCAL_CONFIG_KEY) || "";
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
  try {
    localStorage.removeItem(AI_LOCAL_CONFIG_KEY);
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
:global(html),
:global(body) {
  margin: 0;
  overflow: auto;
  overscroll-behavior: auto;
  background: radial-gradient(900px 520px at 18% 8%, rgba(31, 111, 235, 0.09), transparent 56%),
    radial-gradient(900px 560px at 90% 0%, rgba(130, 80, 223, 0.14), transparent 55%),
    radial-gradient(900px 560px at 50% 100%, rgba(26, 127, 55, 0.12), transparent 50%),
    #f6f8fa;
  color: #111827;
}

.ai-config-page {
  --bg: #ffffff;
  --text: #111827;
  --muted: rgba(17, 24, 39, 0.7);
  --subtle: rgba(17, 24, 39, 0.55);
  --border: rgba(17, 24, 39, 0.1);
  --border-2: rgba(17, 24, 39, 0.16);
  --ring: rgba(31, 111, 235, 0.2);
  --primary: #1f6feb;
  --danger: #cf222e;
  --ok: #1a7f37;
  --card-shadow: 0 2px 8px rgba(15, 23, 42, 0.04), 0 1px 2px rgba(15, 23, 42, 0.06);
  --card-shadow-hover: 0 4px 16px rgba(15, 23, 42, 0.06), 0 2px 4px rgba(15, 23, 42, 0.08);

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
  gap: 4px;
  margin: 0 0 20px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(8px);
}

.tab {
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted);
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms ease;
}

.tab.active {
  border-color: rgba(31, 111, 235, 0.3);
  background: rgba(31, 111, 235, 0.08);
  color: var(--primary);
  font-weight: 600;
}

.tab:hover:not(.active) {
  background: rgba(17, 24, 39, 0.04);
  color: var(--text);
}

.tab:active:not(.disabled) {
  transform: scale(0.98);
}

.card {
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 20px;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(10px);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04), 0 1px 2px rgba(15, 23, 42, 0.06);
  margin-top: 16px;
  transition: box-shadow 200ms ease, border-color 200ms ease;
}

.card:hover {
  border-color: var(--border-2);
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.06), 0 2px 4px rgba(15, 23, 42, 0.08);
}

.card-title {
  margin: 0 0 14px;
  font-size: 15px;
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
  background: rgba(255, 255, 255, 0.7);
  color: var(--muted);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: none;
  transition: all 150ms ease;
}

.provider-chip.active {
  border-color: rgba(31, 111, 235, 0.35);
  background: rgba(31, 111, 235, 0.1);
  color: var(--primary);
  font-weight: 600;
}

.provider-chip.default:not(.active) {
  border-color: rgba(26, 127, 55, 0.28);
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
  background: rgba(26, 127, 55, 0.12);
  color: var(--ok);
  border: 1px solid rgba(26, 127, 55, 0.28);
}

.provider-add {
  border: 1px dashed var(--border-2);
  background: transparent;
  color: var(--primary);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 13px;
  box-shadow: none;
}

.provider-add:hover:not(:disabled) {
  background: rgba(31, 111, 235, 0.06);
  transform: none;
  box-shadow: none;
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
  background: rgba(255, 255, 255, 0.95);
  color: var(--text);
  outline: none;
  transition: border-color 150ms ease, box-shadow 150ms ease, background 150ms ease;
}

.field input::placeholder,
.field textarea::placeholder {
  color: rgba(17, 24, 39, 0.4);
}

.field input:focus,
.field textarea:focus,
.field select:focus {
  border-color: rgba(31, 111, 235, 0.5);
  box-shadow: 0 0 0 3px var(--ring);
  background: #fff;
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
  border-radius: 8px;
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(31, 111, 235, 0.2);
  transition: all 150ms ease;
}

button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(31, 111, 235, 0.25);
}

button:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 1px 2px rgba(31, 111, 235, 0.2);
}

button.primary {
  background: var(--primary);
  font-weight: 600;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

button.secondary {
  background: rgba(17, 24, 39, 0.06);
  color: var(--text);
  box-shadow: none;
  border: 1px solid var(--border);
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
