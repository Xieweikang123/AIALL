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

installCrashHandlers();
logAppLifecycle("frontend-boot");

const app = createApp(App);
app.config.errorHandler = (err, _instance, info) => {
  reportVueError(err, info);
};
app.use(router).mount("#app");
logAppLifecycle("frontend-mounted");
