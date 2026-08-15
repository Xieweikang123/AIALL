# TASK-A · 前端实测 + 未切流调用降级（负责方：AI-B，文件域 `src/`）

> 先读 `docs/WEB_SERVER_MIGRATION.md` 总纲（尤其第三、五、六节）。

## 认领状态

- 认领 AI：opencode（deepseek-v4-flash，本次会话）
- 状态：**进行中**（2026-08-15）
- 备注：TASK-B 已由另一实例认领，本任务与其并行；涉及 `/backend/vibe/*` 新增路径时按总纲 3.3 登记并同步告知 B。

## 目标

让 `npm run dev:web` 的浏览器预览，在 agent-server 运行的情况下，**完整可用**：
- `/vibe-coding`（主 IDE：文件树 / 编辑器 / Git 面板 / 会话 / Agent 对话）不报错、各面板能读真实服务器数据。
- 桌面自动化（截图 / 鼠标点击 / 模板匹配）与其它纯桌面功能**优雅降级**：显示「仅桌面版」提示，不抛未捕获错误。

## 现状（已由总纲描述，勿重复）

- `src/services/tauriInvoke.ts`：非 Tauri 环境 `invokeBackend` 已走 `httpFallback`。
- `src/services/vibeAgentClient.ts`：`runVibeAgentSse` 非 Tauri 已走 HTTP SSE。
- `vite.config.ts`：已代理 `/backend/vibe`、`/api/agent` → `127.0.0.1:8787`。
- **但以下调用仍是直接 `tauriInvoke` / `invoke`（无 fallback），web 模式会抛错**（见总纲 3.4 表）：
  - `src/services/aiClient.ts`：`ai_test`、`ai_test_stream`、`ai_models`、`ai_tts`
  - `src/services/desktopAutomationClient.ts`：`automation_capture_screen` 等
  - `src/services/iconTemplatesClient.ts`：`automation_test_icon_template`
  - `src/services/fileWatcherClient.ts`：`file_watcher_start/stop/stream`
  - `src/services/npmScriptClient.ts`：`npm_script_run/stop`
  - `src/services/vibeGitClient.ts`：`git_generate_message`、`git_ai_batch_groups`（归任务 B，但 web 模式下要能友好报错/降级）
  - `src/utils/debugLog.ts`、`VibeCodingView.vue:1498`（`system_open_url`）

## 执行步骤

### 1. 浏览器实测（先定位，再改）

前提：`src-tauri/target/debug/agent-server.exe` 在跑（默认 8787），`npm run dev:web` 在跑。

打开 `http://localhost:5173/#/vibe-coding`，逐项记录报错：
1. 顶部项目切换栏能否列出/打开项目（历史项目在 localStorage；无历史时 web 模式 `pick-folder` 返回 cancelled，需提供「手动输入路径」或「用示例项目」的降级入口，可向用户确认预期）。
2. 打开项目后：文件树 → 双击文件进编辑器；Git 面板 status/diff/commit；会话面板历史列表与消息；Agent 对话发送。
3. 打开 `http://localhost:5173/#/chat`、`/#/ai-config`、`/#/icon-templates`，记录报错。

排查方法：浏览器 DevTools Console 里看 `Uncaught (in promise) ...` 或「请使用桌面版」报错，定位到对应 `src/services/*.ts` 的调用点。**优先查「没走 invokeBackend 的直连 tauriInvoke 调用」**，这是 web 报错的主要来源。

### 2. 给桌面专属 client 加降级（不改服务端）

原则：**服务端不可用的命令，前端不要请求它，直接返回降级结果并提示**。参照现有降级先例：
- `searchSymbols` 的 fallback 返回 `{ ok: false, results: [], error: "符号搜索仅桌面版可用" }`（`vibeCodingClient.ts`）。
- `open-folder` / `pick-folder` 在 `http_routes.rs` 已是 stub。

具体做法（每个文件视情况）：
- **desktopAutomationClient.ts / iconTemplatesClient.ts**：在函数内 `if (!isTauriEnv())` 返回降级结果（`{ ok: false, error: "桌面自动化仅桌面版可用" }` 之类），不调 `tauriInvoke`。ChatView / IconTemplatesView 的入口按钮随之隐藏或置灰（看这两个 view 怎么消费返回值）。
- **fileWatcherClient.ts / npmScriptClient.ts**：非 Tauri 环境静默 no-op 或返回降级，避免抛错。
- **aiClient.ts**：`ai_test` / `ai_models` 若配置页在 web 模式需要可用，走 `invokeBackend("ai_test", args, httpFallback)` 且 fallback 请求后端 `POST /api/ai/test`（后端此路由由任务 B 补，见 TASK-B；若后端未就绪，fallback 先返回降级结果并在 TODO 注明）。`ai_test_stream` / `ai_tts` 可先降级。

### 3. 桌面自动化功能的 UI 层处理

- `src/views/ChatView.vue` 的桌面自动化入口（打开应用 / 匹配点击）在 web 模式**隐藏或禁用**并提示。
- `src/views/IconTemplatesView.vue` 同理。
- 原则：**web 模式不显示会必挂的功能入口**，而不是显示了再报错。

### 4. 顺带修复

- `src/views/VibeCodingView.vue:1498` 的 `system_open_url`（打开外部链接）非 Tauri 下静默忽略或 `window.open`。
- `src/utils/debugLog.ts` 的 `invoke`（写调试日志）非 Tauri 下降级为 no-op。
- 检查 `VibeCodingView` 打开项目的链路里所有 `invokeBackend` fallback 是否真的请求到了 `agent-server`（有些 fallback 可能返回「仅桌面版可用」，导致 web 模式打不开项目——这类要补真实现或改降级文案，不能假死）。

## 验收标准

1. `npm run dev:web` + agent-server 运行，浏览器打开 `/vibe-coding`：
   - 文件树列出真实目录，双击可读文件进编辑器；保存/新建/删除/重命名不报错。
   - Git 面板 status / diff / commit / log / branch 等主流程可用。
   - 会话面板历史列表、单会话消息可读；Agent 对话发消息走 SSE 流式返回。
2. `/chat`、`/icon-templates` 打开不抛未捕获错误；桌面自动化入口在 web 模式不显示或明确提示「仅桌面版」。
3. `npm run typecheck` 通过；`npx vitest run src/services/vibeAgentClient.test.ts src/services/vibeCodingClient.test.ts` 通过；`npm test` 不新增失败。
4. 若你在前端新增了 `/backend/vibe/*` 或 `/api/*` 的调用路径，**回总纲 3.3 表登记**，并确保后端（任务 B）知道。

## 注意

- 只改 `src/` 下文件。不要碰 `src-tauri/`（那归 AI-A）。
- 不要 `console.log`；调试写 `%APPDATA%\aiall\debug-logs\`（见 AGENTS.md）或用浏览器 DevTools。
- 不确定的交互（如 web 模式如何"打开项目"）先按最稳的降级做，记录 TODO，别擅自改产品交互。
