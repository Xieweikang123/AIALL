<template>
  <div v-if="show" class="vibe-welcome" role="region" aria-label="欢迎">
    <div class="vibe-welcome-card">
      <div class="vibe-welcome-logo" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2L3 7v10l9 5 9-5V7l-9-5Z"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linejoin="round"
          />
          <path d="M12 12 3 7M12 12l9-5M12 12v10" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
        </svg>
      </div>
      <h2 class="vibe-welcome-title">开始 Vibe Coding</h2>
      <p class="vibe-welcome-desc">
        打开项目，让 Agent 自动理解需求、探索代码并完成修改。
      </p>

      <!-- Web 模式状态与调试信息 -->
      <div v-if="!isDesktopRuntime" class="vibe-welcome-server-box">
        <div class="server-box-header">
          <span class="server-status-dot" :class="probeStatusClass" />
          <span class="server-status-label">{{ probeStatusText }}</span>
          <button
            type="button"
            class="server-recheck-btn"
            :disabled="rechecking"
            title="重新检测后端连接"
            @click="handleRecheck"
          >
            {{ rechecking ? "检测中…" : "🔄 重新检测" }}
          </button>
        </div>

        <div v-if="serverProbe === 'unreachable'" class="server-box-warning">
          <strong>⚠️ 后端服务未连接</strong>
          <p>Web 模式需同时运行前端与 <code>agent-server</code> 后端。</p>
          <div class="server-cmd-tip">
            <span>启动命令：</span>
            <code>start-web.bat</code> 或 <code>cd src-tauri && cargo run --bin agent-server</code>
          </div>
          <div class="server-diag-links">
            <a href="http://127.0.0.1:8787/healthz" target="_blank" rel="noopener noreferrer">测试 /healthz 接口</a>
          </div>
        </div>

        <div v-else-if="serverProbe === 'auth'" class="server-box-auth">
          <strong>🔒 需要登录认证</strong>
          <p>服务器配置了访问密码，请前往 AI 配置页输入 Token 登录。</p>
          <button type="button" class="server-login-btn" @click="$emit('open-ai-config')">
            去登录
          </button>
        </div>
      </div>

      <!-- 打开项目错误详情 -->
      <div v-if="treeError" class="vibe-welcome-error-box" role="alert">
        <div class="error-box-title">❌ 打开项目失败</div>
        <div class="error-box-detail">{{ treeError }}</div>
        <div v-if="!isDesktopRuntime" class="error-box-hint">
          提示：Web 模式下必须使用<strong>服务器全路径</strong>（如 <code>D:\project\AIALL</code> 或 <code>/home/user/project</code>）。
        </div>
      </div>

      <ol class="vibe-welcome-steps" aria-label="上手步骤">
        <li class="vibe-welcome-step is-active">
          <span class="vibe-welcome-step-num">1</span>
          <div class="vibe-welcome-step-body">
            <strong>打开项目</strong>
            <span>{{ isDesktopRuntime ? "选择本地代码文件夹" : "选择或输入服务器项目绝对路径" }}</span>
          </div>
        </li>
        <li class="vibe-welcome-step" :class="{ 'is-done': configReady && apiKeyReady }">
          <span class="vibe-welcome-step-num">2</span>
          <div class="vibe-welcome-step-body">
            <strong>配置模型</strong>
            <span>{{ configStepHint }}</span>
          </div>
        </li>
        <li class="vibe-welcome-step">
          <span class="vibe-welcome-step-num">3</span>
          <div class="vibe-welcome-step-body">
            <strong>在助手中提问</strong>
            <span>Auto 自动选择合适的工作方式</span>
          </div>
        </li>
      </ol>

      <!-- Web 模式快捷输入路径 -->
      <div v-if="!isDesktopRuntime" class="vibe-welcome-path-input-row">
        <input
          v-model="inputPath"
          class="welcome-path-input"
          type="text"
          placeholder="输入服务器项目全路径（如 D:\project\AIALL）"
          @keydown.enter="handleOpenByInput"
        />
        <button
          type="button"
          class="primary compact"
          :disabled="!inputPath.trim() || loadingTree"
          @click="handleOpenByInput"
        >
          打开
        </button>
      </div>

      <div class="vibe-welcome-actions">
        <button type="button" class="primary" :disabled="pickingFolder || loadingTree" @click="$emit('open-project')">
          {{ pickingFolder ? "选择文件夹…" : isDesktopRuntime ? "选择本地文件夹" : "浏览服务器目录" }}
        </button>
        <button
          v-if="!configReady || !apiKeyReady"
          type="button"
          class="secondary"
          @click="$emit('open-ai-config')"
        >
          去配置模型
        </button>
      </div>
      <p class="vibe-welcome-footnote">
        改码用本页；网页总结 / 桌面自动化请用顶部「对话」与「图标模板」。
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ServerBackendProbe } from "../../services/serverAuth";

const props = withDefaults(
  defineProps<{
    show: boolean;
    loadingTree?: boolean;
    pickingFolder?: boolean;
    configReady?: boolean;
    apiKeyReady?: boolean;
    treeError?: string;
    isDesktopRuntime?: boolean;
    serverProbe?: ServerBackendProbe;
    projectPath?: string;
  }>(),
  {
    loadingTree: false,
    pickingFolder: false,
    configReady: false,
    apiKeyReady: false,
    treeError: "",
    isDesktopRuntime: false,
    serverProbe: "unreachable",
    projectPath: "",
  },
);

const emit = defineEmits<{
  (e: "open-project"): void;
  (e: "open-ai-config"): void;
  (e: "recheck-server"): void;
  (e: "open-path", path: string): void;
}>();

const inputPath = ref(props.projectPath || "");
watch(
  () => props.projectPath,
  (val) => {
    if (val && !inputPath.value) inputPath.value = val;
  },
);

const rechecking = ref(false);

async function handleRecheck() {
  rechecking.value = true;
  emit("recheck-server");
  setTimeout(() => {
    rechecking.value = false;
  }, 600);
}

function handleOpenByInput() {
  if (inputPath.value.trim()) {
    emit("open-path", inputPath.value.trim());
  }
}

const probeStatusClass = computed(() => {
  if (props.serverProbe === "ok") return "is-ok";
  if (props.serverProbe === "auth") return "is-auth";
  return "is-unreachable";
});

const probeStatusText = computed(() => {
  if (props.serverProbe === "ok") return "后端 agent-server 在线 (8787)";
  if (props.serverProbe === "auth") return "后端需要登录 Token";
  return "后端 agent-server 未连接";
});

const configStepHint = computed(() => {
  if (!props.configReady) return "填写接口与模型";
  if (!props.apiKeyReady) return "请保存 API Key";
  return "已就绪";
});
</script>

<style scoped>
.vibe-welcome-server-box {
  margin: 0 0 16px;
  padding: 10px 14px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border);
  text-align: left;
  font-size: 12px;
}

.server-box-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.server-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.server-status-dot.is-ok {
  background: #3fb950;
  box-shadow: 0 0 8px rgba(63, 185, 80, 0.6);
}
.server-status-dot.is-auth {
  background: #d29922;
  box-shadow: 0 0 8px rgba(210, 153, 34, 0.6);
}
.server-status-dot.is-unreachable {
  background: #f85149;
  box-shadow: 0 0 8px rgba(248, 81, 73, 0.6);
}

.server-status-label {
  font-weight: 600;
  color: var(--text);
  flex: 1;
}

.server-recheck-btn {
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-dim);
  cursor: pointer;
}
.server-recheck-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: var(--text);
}

.server-box-warning {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  color: #f85149;
}
.server-box-warning p {
  margin: 4px 0;
  color: var(--muted);
}
.server-cmd-tip {
  margin: 6px 0;
  padding: 6px 8px;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 4px;
  font-family: monospace;
  font-size: 11px;
  color: #c9d1d9;
  word-break: break-all;
}
.server-diag-links {
  margin-top: 6px;
}
.server-diag-links a {
  color: #58a6ff;
  text-decoration: underline;
  font-size: 11px;
}

.server-box-auth {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  color: #d29922;
}
.server-box-auth p {
  margin: 4px 0;
  color: var(--muted);
}
.server-login-btn {
  margin-top: 6px;
  padding: 4px 10px;
  font-size: 11px;
  border-radius: 4px;
  border: 1px solid #d29922;
  background: rgba(210, 153, 34, 0.15);
  color: #f0883e;
  cursor: pointer;
}

.vibe-welcome-error-box {
  margin: 0 0 16px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(248, 81, 73, 0.12);
  border: 1px solid rgba(248, 81, 73, 0.4);
  text-align: left;
  font-size: 12px;
}
.error-box-title {
  font-weight: 600;
  color: #f85149;
  margin-bottom: 4px;
}
.error-box-detail {
  color: #ff7b72;
  word-break: break-all;
  font-family: monospace;
  font-size: 11px;
  margin-bottom: 4px;
}
.error-box-hint {
  color: var(--muted);
  font-size: 11px;
}

.vibe-welcome-path-input-row {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
.welcome-path-input {
  flex: 1;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: rgba(0, 0, 0, 0.3);
  color: var(--text);
  font-size: 12px;
}
.welcome-path-input:focus {
  outline: none;
  border-color: #58a6ff;
}
</style>
