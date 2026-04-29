<template>
  <div class="ai-config-page">
    <h1>AI 配置</h1>
    <p class="desc">配置模型接口并测试连通性。</p>

    <form class="config-form" @submit.prevent="handleTest">
      <label class="field">
        <span>接口地址</span>
        <input
          v-model.trim="form.endpoint"
          type="text"
          placeholder="https://fufu.iqach.top/v1/chat/completions"
        />
      </label>

      <label class="field">
        <span>API Key（可选）</span>
        <input
          v-model.trim="form.apiKey"
          type="password"
          placeholder="sk-xxxx（如需鉴权请填写）"
        />
      </label>

      <label class="field">
        <span>模型名称</span>
        <div class="model-row">
          <input v-model.trim="form.model" type="text" placeholder="mimo-v2.5-pro" />
          <button type="button" class="secondary" :disabled="modelsLoading" @click="handleFetchModels">
            {{ modelsLoading ? "加载中..." : "获取可用模型" }}
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
      </label>

      <label class="field">
        <span>测试提示词</span>
        <textarea
          v-model="form.prompt"
          rows="4"
          placeholder="你好，请返回一句自我介绍。"
        />
      </label>

      <label class="checkbox">
        <input v-model="form.stream" type="checkbox" />
        <span>开启 stream</span>
      </label>

      <div class="actions">
        <button type="submit" :disabled="loading">
          {{ loading ? "测试中..." : "测试模型" }}
        </button>
        <button type="button" class="secondary" @click="saveConfig">保存配置</button>
      </div>
    </form>

    <section class="result">
      <h2>测试结果</h2>
      <p class="status" :class="{ ok: result.ok, fail: !result.ok }">
        状态：{{ resultMessage }}
      </p>
      <pre>{{ resultText }}</pre>
    </section>

    <section class="result">
      <h2>TTS 测试</h2>
      <div class="config-form">
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
        <label class="field">
          <span>朗读文本</span>
          <textarea
            v-model="ttsForm.input"
            rows="3"
            placeholder="你好，这是一段 TTS 测试音频。"
          />
        </label>
        <div class="actions">
          <button type="button" :disabled="ttsLoading" @click="handleTestTts">
            {{ ttsLoading ? "合成中..." : "测试 TTS" }}
          </button>
          <a
            v-if="ttsAudioUrl"
            class="download-link"
            :href="ttsAudioUrl"
            :download="`tts-output.${ttsForm.format}`"
          >
            下载音频
          </a>
        </div>
        <p class="status" :class="{ ok: ttsResult.ok, fail: !ttsResult.ok }">
          状态：{{ ttsResultMessage }}
        </p>
        <audio v-if="ttsAudioUrl" class="audio-player" :src="ttsAudioUrl" controls />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { fetchAvailableModels, testAiModel, testTtsModel } from "../services/aiClient";

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

const STORAGE_KEY = "ai-config";

const form = reactive<AiConfigForm>({
  endpoint: "https://fufu.iqach.top/v1/chat/completions",
  apiKey: "",
  model: "mimo-v2.5-pro",
  prompt: "你好",
  stream: true,
});

const loading = ref(false);
const modelsLoading = ref(false);
const availableModels = ref<string[]>([]);
const modelsStatusText = ref("可点击“获取可用模型”自动读取列表。");
const result = reactive({
  ok: false,
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
  ok: false,
  status: 0,
  text: "点击“测试 TTS”开始请求。",
});

const resultMessage = computed(() => {
  if (result.status === 0 && result.text.includes("点击")) {
    return "未测试";
  }
  return result.ok ? `成功（HTTP ${result.status}）` : `失败（HTTP ${result.status || "N/A"}）`;
});

const resultText = computed(() => result.text);
const ttsResultMessage = computed(() => {
  if (ttsResult.status === 0 && ttsResult.text.includes("点击")) {
    return "未测试";
  }
  return ttsResult.ok ? `成功（HTTP ${ttsResult.status}）` : `失败（HTTP ${ttsResult.status || "N/A"}）`;
});

function saveConfig() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
  result.ok = true;
  result.status = 200;
  result.text = "配置已保存到本地 localStorage。";
}

function loadConfig() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Partial<AiConfigForm>;
    form.endpoint = parsed.endpoint || form.endpoint;
    form.apiKey = parsed.apiKey || form.apiKey;
    form.model = parsed.model || form.model;
    form.prompt = parsed.prompt || form.prompt;
    form.stream = typeof parsed.stream === "boolean" ? parsed.stream : form.stream;
  } catch {
    // 忽略损坏的本地配置，保留默认值。
  }
}

async function handleFetchModels() {
  if (!form.endpoint) {
    modelsStatusText.value = "请先填写接口地址。";
    return;
  }

  modelsLoading.value = true;
  modelsStatusText.value = "正在拉取模型列表...";
  const response = await fetchAvailableModels({
    endpoint: form.endpoint,
    apiKey: form.apiKey,
  });
  modelsLoading.value = false;

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
  modelsStatusText.value = `已加载 ${availableModels.value.length} 个模型。`;
}

async function handleTest() {
  if (!form.endpoint || !form.model || !form.prompt) {
    result.ok = false;
    result.status = 0;
    result.text = "请先完整填写接口地址、模型名称、测试提示词。";
    return;
  }

  loading.value = true;
  result.ok = true;
  result.status = 200;
  result.text = form.stream ? "正在流式接收...\n" : "请求中...\n";
  const response = await testAiModel({
    endpoint: form.endpoint,
    apiKey: form.apiKey,
    model: form.model,
    prompt: form.prompt,
    stream: form.stream,
    onStreamChunk: (chunkText) => {
      result.text += chunkText;
    },
  });
  loading.value = false;

  result.ok = response.ok;
  result.status = response.status;
  result.text = response.rawText || response.error || "未返回内容。";
}

async function handleTestTts() {
  if (!form.endpoint || !ttsForm.model || !ttsForm.voice || !ttsForm.input) {
    ttsResult.ok = false;
    ttsResult.status = 0;
    ttsResult.text = "请先完整填写接口地址、TTS 模型、音色和朗读文本。";
    return;
  }

  ttsLoading.value = true;
  const response = await testTtsModel({
    endpoint: form.endpoint,
    apiKey: form.apiKey,
    model: ttsForm.model,
    voice: ttsForm.voice,
    input: ttsForm.input,
    format: ttsForm.format,
  });
  ttsLoading.value = false;

  if (response.ok && response.audioBlob) {
    if (ttsAudioUrl.value) {
      URL.revokeObjectURL(ttsAudioUrl.value);
    }
    ttsAudioUrl.value = URL.createObjectURL(response.audioBlob);
    ttsResult.ok = true;
    ttsResult.status = response.status;
    ttsResult.text = "语音合成成功，可在线播放或下载。";
    return;
  }

  ttsResult.ok = false;
  ttsResult.status = response.status;
  ttsResult.text = response.error || "TTS 合成失败。";
}

onMounted(loadConfig);
onBeforeUnmount(() => {
  if (ttsAudioUrl.value) {
    URL.revokeObjectURL(ttsAudioUrl.value);
  }
});
</script>

<style scoped>
.ai-config-page {
  max-width: 900px;
  margin: 0 auto;
  padding: 20px;
  font-family: Arial, sans-serif;
}

.desc {
  color: #666;
  margin-bottom: 16px;
}

.config-form {
  display: grid;
  gap: 12px;
}

.field {
  display: grid;
  gap: 6px;
}

.field input,
.field textarea,
.field select {
  width: 100%;
  border: 1px solid #d0d7de;
  border-radius: 8px;
  padding: 10px;
  font-size: 14px;
}

.model-row {
  display: grid;
  grid-template-columns: 1fr auto;
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
}

button {
  border: none;
  background: #1f6feb;
  color: #fff;
  border-radius: 8px;
  padding: 10px 16px;
  cursor: pointer;
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

button.secondary {
  background: #57606a;
}

.result {
  margin-top: 24px;
}

.tips {
  color: #666;
  font-size: 12px;
}

.audio-player {
  width: 100%;
}

.download-link {
  display: inline-flex;
  align-items: center;
  color: #1f6feb;
  text-decoration: none;
  font-size: 14px;
}

.status.ok {
  color: #1a7f37;
}

.status.fail {
  color: #cf222e;
}

pre {
  background: #f6f8fa;
  border: 1px solid #d0d7de;
  border-radius: 8px;
  padding: 12px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
