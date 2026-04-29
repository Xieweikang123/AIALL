import { createRouter, createWebHashHistory, RouteRecordRaw } from "vue-router";
import AiConfigView from "../views/AiConfigView.vue";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    redirect: "/ai-config",
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
