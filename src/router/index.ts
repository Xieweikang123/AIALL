import { createRouter, createWebHashHistory, type RouteRecordRaw } from "vue-router";
import { getServerBackendProbe, isServerLoggedIn } from "../services/serverAuth";
import { isTauriEnv } from "../services/tauriInvoke";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    redirect: "/vibe-coding",
  },
  {
    path: "/login",
    name: "Login",
    component: () => import("../views/LoginView.vue"),
  },
  {
    path: "/chat",
    name: "Chat",
    component: () => import("../views/ChatView.vue"),
  },
  {
    path: "/ai-config",
    name: "AiConfig",
    component: () => import("../views/AiConfigView.vue"),
  },
  {
    path: "/web-agent",
    name: "WebAgent",
    component: () => import("../views/WebAgentView.vue"),
  },
  {
    path: "/vibe-coding",
    name: "VibeCoding",
    component: () => import("../views/VibeCodingView.vue"),
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

// 整站登录墙：仅 web（非 Tauri）模式启用。
// 后端未配置 token（探测 ok / 不可达）时不拦截；配置了 token（auth）且未登录时，
// 除 /login 外的所有页面重定向到 /login，登录后跳回原页面。
router.beforeEach(async (to) => {
  if (isTauriEnv()) return true;
  if (to.path === "/login") return true;
  const probe = await getServerBackendProbe();
  if (probe !== "auth") return true;
  if (isServerLoggedIn()) return true;
  const redirect = to.fullPath && to.fullPath !== "/" ? to.fullPath : undefined;
  return { path: "/login", query: redirect ? { redirect } : {} };
});

export default router;
