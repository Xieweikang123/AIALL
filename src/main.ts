import { createApp } from "vue";
import "./assets/scrollbar.css";
import "highlight.js/styles/github-dark.css";
import App from "./App.vue";
import router from "./router";
import {
  installCrashHandlers,
  logAppLifecycle,
  reportVueError,
} from "./utils/debugLog";
import { isTauriEnv } from "./services/tauriInvoke";
import { getServerBackendProbe, installServerAuthFetch } from "./services/serverAuth";

installCrashHandlers();
logAppLifecycle("frontend-boot");

// Web（服务器）模式：对所有 /backend/* 与 /api/* 请求自动附加登录 session token。
// 桌面版走 Tauri invoke，不启用 HTTP 认证包装。
if (!isTauriEnv()) {
  installServerAuthFetch();
  // 启动时探测 agent-server 可达性，供界面区分「已连服务端 / 需登录 / 纯预览」。
  void getServerBackendProbe();
}

const app = createApp(App);
app.config.errorHandler = (err, _instance, info) => {
  reportVueError(err, info);
};
app.use(router).mount("#app");
logAppLifecycle("frontend-mounted");
