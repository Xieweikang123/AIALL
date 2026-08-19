import { createRouter, createWebHashHistory, type RouteRecordRaw } from "vue-router";
import { isServerLoggedIn, probeServerBackend } from "../services/serverAuth";
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
    path: "/git-overview",
    name: "GitOverview",
    component: () => import("../views/GitOverviewView.vue"),
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
// web 模式下未登录一律跳 /login（后端已配 admin 认证）；Tauri 桌面版不拦截。
// probe 仅用于区分 unreachable 时的横幅，登录态以 localStorage 为准，避免缓存导致不跳。
router.beforeEach(async (to) => {
  if (isTauriEnv()) return true;
  if (to.path === "/login") return true;
  if (isServerLoggedIn()) return true;
  // 未登录：先探一下后端是否真的需要认证，探不到也直接跳登录（当前服务器已开认证）
  try {
    const probe = await probeServerBackend();
    if (probe === "unreachable") return true;
  } catch {}
  const redirect = to.fullPath && to.fullPath !== "/" ? to.fullPath : undefined;
  return { path: "/login", query: redirect ? { redirect } : {} };
});

export default router;
