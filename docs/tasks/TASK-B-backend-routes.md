# TASK-B · 后端增强路由（负责方：AI-A，文件域 `src-tauri/`）

> 先读 `docs/WEB_SERVER_MIGRATION.md` 总纲（尤其第三、五、六节）与 `AGENT_SSOT.md`。

## 认领状态

- 认领 AI：opencode（deepseek-v4-flash，本次会话）
- 状态：✅ **已交付**（2026-08-15）
- 交付内容：
  - `git_generate_message` / `git_ai_batch_groups`：`http_routes.rs` 的 `collect_channel_events` 用假 `Channel` 收集事件组 SSE（零改动 `commands/git.rs`）。
  - `project_architect_review*`（5 变体）、`project_memory_*` / `project_knowledge_*` / `project_skills_*`：直接包装 `commands::project::*`。
  - `/backend/web/extract`：SSE（progress + result）；`/backend/web/screenshot-page`：降级。
  - **`/backend/ai/test|models|tts`（POST）**：对齐 `aiClient.ts`（前端原调 `/backend/ai/*`，后端旧为 `/api/ai/*` GET → 已改）；`ok:false` → HTTP 502；`/tts` 直接返回音频二进制（`commands::ai::ai_tts_impl` 抽非流式底层，桌面 `ai_tts` 复用）。
  - `/backend/automation/*`：降级（服务器无桌面）。
  - vite 代理统一 `/backend` 前缀 + `/api/server`。
- 备注：本任务在 `b3fd1c8` 时大部分路由已实现；本次补齐了 AI 配置页 / 截图 / 自动化契约与状态码语义。

## 目标

补齐前端已定义 fallback、但 `http_routes.rs` 尚未实现的 `/backend/vibe/*` 路由，让 web 模式覆盖剩余功能（提交信息生成、AI 批量分组、架构审查、网页抓取、AI 配置页探测）。

## 现有结构（勿重复实现）

- `src-tauri/src/http_routes.rs`：`/backend/vibe/*` 核心路由已全部实现，结构为「HTTP 参数 → `commands::*` 函数」薄包装。**新增路由照现有模式加 match 分支**。
- `src-tauri/src/bin/agent_server.rs`：已把 `path.starts_with("/backend/vibe/")` 的请求转给 `handle_backend_vibe`，无需改 HTTP 层。
- 前端 fallback 的**路径与参数结构由 `src/services/*.ts` 决定**，逐个对照（总纲 3.3 表）。

## 要补的路由

### 1. POST `/backend/vibe/git/generate-message`（body: path, endpoint, apiKey, model, stagedFiles? 等）

- 前端 `vibeGitClient.ts` 的 `gitGenerateMessage`：桌面版走 `invoke("git_generate_message", {... onEvent: channel })`，**流式**；HTTP fallback 期望一次拿到 `{ ok, message, warning? }`。
- 现状：`commands::git::git_generate_message` 带 `on_event: Channel<Value>`（`src-tauri/src/commands/git.rs` 约 902 行）。
- 做法：**不改动 `commands::git` 原函数**（避免影响桌面版与回归向量）。在 `commands/` 层或 `http_routes.rs` 里写一个**非流式包装**：调用底层 `git::git_generate_message_impl`（若存在）或复用其内部逻辑返回最终 message；若底层没有可复用函数，可在 `crate::git` 内抽出一个 `pub` 的非流式函数并让原 command 复用它（**改 `crate::git` 需谨慎**，见铁律）。
- 验收：`curl -X POST http://127.0.0.1:8787/backend/vibe/git/generate-message -d '{"path":"D:\\project\\AIALL","endpoint":"<真实或假>","apiKey":"...","model":"..."}'` 返回 `{ok, message, warning?}` 结构，不挂死。

### 2. POST `/backend/vibe/git/ai-batch-groups`（body: path, endpoint, apiKey, model）

- 同理：桌面版 `invoke("git_ai_batch_groups", {..., onEvent: channel})` 流式；HTTP fallback 期望 `{ ok, groups }` 之类一次性结果。
- 参考 `git_generate_message` 的处理方式。

### 3. GET/POST `/backend/vibe/project-architect-review*`（5 个变体）

- 前端 `vibeProjectArchitectReviewClient.ts`：
  - `GET /backend/vibe/project-architect-review?projectPath=`
  - `POST /backend/vibe/project-architect-review`（body 见该文件）
  - `GET /backend/vibe/project-architect-review/context?projectPath=`
  - `GET /backend/vibe/project-architect-review/history?projectPath=&reviewId=`
  - `POST /backend/vibe/project-architect-review/history`（含删除？以该文件为准）
- 后端对应：`commands::project::{project_architect_review_get, project_architect_review_save, project_architect_review_context, project_architect_review_history, project_architect_review_history_delete}`，全是无 State 的 `Value -> Value`，直接照 `project_memory_get` 的模式加分支即可。
- 注意：`project_architect_review_history` / `_history_delete` 的签名（参数名）以 `src-tauri/src/commands/project.rs` 为准，前端 body 字段名以 `vibeProjectArchitectReviewClient.ts` 为准，**两者对齐**。

### 4. 网页抓取（供 ChatView / Agent web_search 增强，可降级）

- 前端 `webExtractClient.ts` 有两路：tauriInvoke（桌面）与 HTTP fallback。确认 fallback 请求的具体路径与 body，补后端路由（对应 `commands::web::{web_extract, web_screenshot_page}`）。若路径不是 `/backend/vibe/*` 而是 `/api/*`，新增路由时保持与前端一致，并在总纲登记。
- `web_screenshot_page`（页面截图）服务器上有 headless_chrome 可用则实现，否则降级 `{ ok: false }`。

### 5. AI 配置页探测（配合任务 A 的 `aiClient.ts`）

- 前端若在 web 模式调 `POST /api/ai/test`、`GET /api/ai/models`（路径以任务 A 落定的为准），对应 `commands::ai::{ai_test, ai_models}`（无 State，直接包装）。`ai_test_stream` / `ai_tts` 可暂缓/降级。

## 铁律

1. **只在 `src-tauri/` 内改**。`http_routes.rs` 是唯一的路由面；业务逻辑别内联，尽量 `commands::*` 已有函数。
2. 抽非流式函数时，**优先在 `commands/` 层包一层**，不破坏现有 `#[tauri::command]` 行为；若必须动 `crate::git` / `crate::agent` 底层，先读 `AGENT_SSOT.md` 并 `cargo test`（含 `npm run test:rust-agent`）确认无回归。
3. 前端与后端的**字段名必须对齐**（camelCase）。不确定就打开对应 `src/services/*.ts` 逐个核对。
4. 完成后 `cargo check --bin agent-server` 必须通过；如可能，对每个新路由用 curl 冒烟（见各节验收）。

## 验收标准

- 上表每条路由 curl 冒烟返回预期结构（`{ok, ...}`），不 404、不挂死。
- `cargo check --bin agent-server` 通过；`npm run test:rust-agent`（Rust parity）不新增失败。
- 新增的路径与参数在 `docs/WEB_SERVER_MIGRATION.md` 3.3 表标记「已实现」。
