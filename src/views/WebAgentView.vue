<script setup lang="ts">
import { onMounted, ref } from "vue";
import { runAgentServerSse, type WebAgentSseEvent } from "../services/webAgentTransport";
import { loadAiChatBaseFromStorage } from "../services/aiLocalConfig";

const serverUrl = ref("http://127.0.0.1:8787");
const projectPath = ref("");
const endpoint = ref("");
const apiKey = ref("");
const model = ref("");
const mode = ref("build");
const maxTurns = ref(8);
const prompt = ref("");
const running = ref(false);
const answer = ref("");
const logs = ref<WebAgentSseEvent[]>([]);
let abortCtrl: AbortController | null = null;

const MODES = ["ask", "build", "plan", "explore"];

onMounted(() => {
  const savedPath = localStorage.getItem("web-agent-project");
  if (savedPath) projectPath.value = savedPath;
  const savedServer = localStorage.getItem("web-agent-server");
  if (savedServer) serverUrl.value = savedServer;
  const cfg = loadAiChatBaseFromStorage();
  if (cfg) {
    endpoint.value = cfg.endpoint;
    apiKey.value = cfg.apiKey;
    model.value = cfg.model;
  }
});

function fmtData(data: Record<string, unknown> | undefined): string {
  if (!data) return "";
  return JSON.stringify(data);
}

async function send() {
  if (running.value) return;
  const url = serverUrl.value.trim().replace(/\/+$/, "");
  localStorage.setItem("web-agent-server", url);
  localStorage.setItem("web-agent-project", projectPath.value.trim());
  running.value = true;
  answer.value = "";
  logs.value = [];
  abortCtrl = new AbortController();
  const body = {
    prompt: prompt.value.trim(),
    projectPath: projectPath.value.trim(),
    endpoint: endpoint.value.trim(),
    apiKey: apiKey.value.trim() || undefined,
    model: model.value.trim(),
    mode: mode.value,
    maxTurns: Number(maxTurns.value) || 8,
  };
  try {
    await runAgentServerSse(`${url}/api/agent/run`, body, (ev) => {
      logs.value.push(ev);
      if (logs.value.length > 200) logs.value.shift();
      if (ev.type === "message" && typeof (ev.data as { text?: string }).text === "string") {
        answer.value = (ev.data as { text: string }).text;
      }
    }, abortCtrl.signal);
  } catch (e) {
    logs.value.push({ type: "error", data: { message: String(e) } });
  } finally {
    running.value = false;
  }
}

async function cancel() {
  try {
    await fetch(`${serverUrl.value.trim().replace(/\/+$/, "")}/api/agent/cancel`, { method: "POST" });
  } catch {
    // ignore
  }
  abortCtrl?.abort();
}

function evLabel(ev: WebAgentSseEvent): string {
  switch (ev.type) {
    case "status":
      return `[状态] ${(ev.data as { phase?: string }).phase ?? ""}${(ev.data as { detail?: string }).detail ? " · " + (ev.data as { detail: string }).detail : ""}`;
    case "tool_start":
      return `[工具] ${(ev.data as { name?: string }).name ?? ""} ${fmtData(ev.data as { args?: Record<string, unknown> }).slice(0, 150)}`;
    case "tool_end":
      return `[工具结束] ${(ev.data as { name?: string }).name ?? ""} ${(ev.data as { ok?: boolean }).ok ? "ok" : "FAIL"} ${(ev.data as { summary?: string }).summary?.slice(0, 150) ?? ""}`;
    case "message":
      return "[回答] ...";
    case "error":
      return `[错误] ${(ev.data as { message?: string }).message ?? ""}`;
    case "done":
      return `[完成] ${fmtData(ev.data)}`;
    default:
      return `[${ev.type}] ${fmtData(ev.data)}`;
  }
}
</script>

<template>
  <div class="web-agent">
    <h1>Web Agent（最小验证版）</h1>
    <p class="hint">
      浏览器 → agent-server（服务器上无头跑 Agent 核心，可直接读写服务器文件/Git）。
      桌面版功能不在此页；此页仅验证「远程指挥 Agent 写代码」链路。
    </p>

    <div class="grid">
      <label>Server
        <input v-model="serverUrl" placeholder="http://127.0.0.1:8787" />
      </label>
      <label>项目路径（服务器上）
        <input v-model="projectPath" placeholder="D:\project\AIALL 或 /root/project" />
      </label>
      <label>模型 Endpoint
        <input v-model="endpoint" placeholder="https://.../v1" />
      </label>
      <label>API Key
        <input v-model="apiKey" type="password" placeholder="sk-..." />
      </label>
      <label>模型名
        <input v-model="model" placeholder="模型" />
      </label>
      <label>模式
        <select v-model="mode">
          <option v-for="m in MODES" :key="m" :value="m">{{ m }}</option>
        </select>
      </label>
      <label>Max Turns
        <input v-model.number="maxTurns" type="number" min="1" max="40" />
      </label>
    </div>

    <div class="composer">
      <textarea v-model="prompt" rows="3" placeholder="告诉 Agent 要做什么，例如：把 src/utils/tmp.ts 里的函数抽到独立文件并写单测" />
      <div class="actions">
        <button :disabled="running" @click="send">发送</button>
        <button :disabled="!running" @click="cancel">停止</button>
      </div>
    </div>

    <section class="answer" v-if="answer">
      <h2>最终回答</h2>
      <pre>{{ answer }}</pre>
    </section>

    <section class="logs">
      <h2>事件流（{{ logs.length }}）</h2>
      <div v-for="(log, i) in logs" :key="i" class="line" :class="log.type">
        <span class="mono">{{ evLabel(log) }}</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.web-agent {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px;
  color: #e6e6e6;
  font-family: system-ui, sans-serif;
}
h1 {
  font-size: 20px;
  margin: 0 0 8px;
}
.hint {
  color: #9aa;
  font-size: 13px;
  margin-bottom: 16px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
label {
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: #aab;
  gap: 4px;
}
input,
select,
textarea {
  background: #1e1e1e;
  border: 1px solid #333;
  color: #e6e6e6;
  border-radius: 6px;
  padding: 8px;
  font-size: 13px;
}
.composer {
  margin-top: 16px;
}
.composer textarea {
  width: 100%;
  box-sizing: border-box;
}
.actions {
  margin-top: 8px;
  display: flex;
  gap: 8px;
}
button {
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 8px 18px;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.answer pre {
  background: #14261a;
  border: 1px solid #2a5;
  border-radius: 8px;
  padding: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
.logs {
  margin-top: 16px;
}
.logs h2,
.answer h2 {
  font-size: 13px;
  color: #aab;
}
.line {
  font-size: 12px;
  padding: 3px 6px;
  border-bottom: 1px solid #222;
}
.line.error {
  color: #f66;
}
.line.tool_start,
.line.tool_end {
  color: #7cc;
}
.line.status {
  color: #caa;
}
.mono {
  font-family: ui-monospace, Consolas, monospace;
}
</style>
