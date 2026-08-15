import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    watch: {
      ignored: ["**/node_modules/**", "**/.git/**"],
    },
    proxy: {
      // 浏览器 Web 模式：把 /backend/vibe/* 与 Agent SSE 代理到无头 agent-server
      "/backend/vibe": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      "/api/agent": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: process.env.TAURI_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: process.env.TAURI_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_DEBUG,
  },
  optimizeDeps: {
    include: ["monaco-editor"],
  },
  worker: {
    format: "es",
  },
});
