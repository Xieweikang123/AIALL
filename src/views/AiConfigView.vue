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
          placeholder="/api/v1/chat/completions"
        />
      </label>

      <label class="field">
        <span>模型名称</span>
        <input v-model.trim="form.model" type="text" placeholder="mimo-v2.5-pro" />
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { testAiModel } from "../services/aiClient";

interface AiConfigForm {
  endpoint: string;
  model: string;
  prompt: string;
  stream: boolean;
}

const STORAGE_KEY = "ai-config";

const form = reactive<AiConfigForm>({
  endpoint: "/api/v1/chat/completions",
  model: "mimo-v2.5-pro",
  prompt: "你好",
  stream: true,
});

const loading = ref(false);
const result = reactive({
  ok: false,
  status: 0,
  text: "点击“测试模型”开始请求。",
});

const resultMessage = computed(() => {
  if (result.status === 0 && result.text.includes("点击")) {
    return "未测试";
  }
  return result.ok ? `成功（HTTP ${result.status}）` : `失败（HTTP ${result.status || "N/A"}）`;
});

const resultText = computed(() => result.text);

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
    form.model = parsed.model || form.model;
    form.prompt = parsed.prompt || form.prompt;
    form.stream = typeof parsed.stream === "boolean" ? parsed.stream : form.stream;
  } catch {
    // 忽略损坏的本地配置，保留默认值。
  }
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

onMounted(loadConfig);
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
.field textarea {
  width: 100%;
  border: 1px solid #d0d7de;
  border-radius: 8px;
  padding: 10px;
  font-size: 14px;
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
