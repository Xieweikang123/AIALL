import { createRouter, createWebHashHistory, RouteRecordRaw } from "vue-router";
import AiConfigView from "../views/AiConfigView.vue";
import ChatView from "../views/ChatView.vue";
import IconTemplatesView from "../views/IconTemplatesView.vue";

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
    component: AiConfigView,
  },
  {
    path: "/icon-templates",
    name: "IconTemplates",
    component: IconTemplatesView,
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
