import { createRouter, createWebHashHistory, RouteRecordRaw } from "vue-router";
import ChatView from "../views/ChatView.vue";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    redirect: "/vibe-coding",
  },
  {
    path: "/chat",
    name: "Chat",
    component: ChatView,
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
