import { createRouter, createWebHashHistory, RouteRecordRaw } from "vue-router";
import AiConfigView from "../views/AiConfigView.vue";
import ChatView from "../views/ChatView.vue";
import IconTemplatesView from "../views/IconTemplatesView.vue";
import VibeCodingView from "../views/VibeCodingView.vue";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    redirect: "/chat",
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
    component: VibeCodingView,
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

export default router;
