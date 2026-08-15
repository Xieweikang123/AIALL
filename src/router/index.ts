import { createRouter, createWebHashHistory, RouteRecordRaw } from "vue-router";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    redirect: "/vibe-coding",
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
    path: "/icon-templates",
    name: "IconTemplates",
    component: () => import("../views/IconTemplatesView.vue"),
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

export default router;
