import { createRouter, createWebHashHistory, RouteRecordRaw } from "vue-router";
import AiConfigView from "../views/AiConfigView.vue";
import ChatView from "../views/ChatView.vue";

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
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

export default router;
