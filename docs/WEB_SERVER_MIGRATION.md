# AIALL Web 服务化改造 · 任务总纲

> 给接手此事的 AI 看。先把本文件读一遍，再读自己对应任务的详细文档。
> 相关背景：`docs/DEPLOYMENT_REQUIREMENTS.md`（部署需求）、`AGENTS.md`（全局约定）、`AGENT_SSOT.md`（行为单一真相源）。

## 一、目标

把 AIALL（Tauri 2 + Vue 3 桌面应用）变成「服务器上无头运行的 Agent + 浏览器访问」的 Web 服务：
- 浏览器打开 `http://<服务器>:8088`，能用**完整功能**（Agent 编程 / Git / 文件 / 会话 / 项目记忆）。
- Agent 的行为真相源**仍只有 Rust**（`src-tauri/src/agent/`），禁止在别处重写同名实现。
- 桌面自动化（截图 / 鼠标点击 / 模板匹配）服务器上没有桌面环境，**降级或移除**。

## 二、当前状态（2026-08-15 晚，已完成里程碑）

### ✅ 已完成（不要重复做）

1. **Rust 无头服务 `agent-server`**（`src-tauri/src/bin/agent_server.rs`）：
   - 极简 HTTP 服务器（tokio TcpListener，无第三方 Web 框架），端点：
     - `GET /healthz`
     - `POST /api/agent/run`（SSE 流式返回 `VibeAgentEvent` 事件）
     - `POST /api/agent/cancel`
     - `GET|POST /backend/vibe/*`（文件 / Git / 会话 / 项目 接口，见下方契约）
   - Agent 运行复用 `app_lib::agent::agent_run_headless`（与桌面版同一套循环），**零改动 Agent 行为**。
   - 环境变量：`AIALL_SERVER_BIND`（默认 127.0.0.1）、`AIALL_SERVER_PORT`（默认 8787）、`AIALL_SERVER_TOKEN`（Bearer 认证，默认关闭）、`AIALL_SERVER_ALLOWED_PROJECTS`（项目白名单，空 = 全放行）。
2. **HTTP 路由层**（`src-tauri/src/http_routes.rs`，app_lib 内新模块）：`/backend/vibe/*` 核心路由全部实现，handler 直接调用 `commands::*`（与桌面版同一套函数）。已覆盖：文件树 / Git 面板 / 会话 / 项目记忆 / 健康扫描 / 验证运行。
3. **前端切流**：
   - `src/services/tauriInvoke.ts`：`invokeBackend` 在非 Tauri 环境走 `httpFallback`（浏览器模式自动启用）。
   - `src/services/vibeAgentClient.ts`：`runVibeAgentSse` 在非 Tauri 环境走 `runWebAgentSse`（POST `/api/agent/run` + 流式读 SSE）。
   - `vite.config.ts`：dev 代理 `/backend/vibe` 与 `/api/agent` → `http://127.0.0.1:8787`（浏览器预览零跨域）。
4. **测试**：`npm test` 1013 全过；`npm run typecheck` 通过；`cargo check --bin agent-server` 通过。本地已验证：文件树 / Git 状态 / 历史会话通过 HTTP 返回真实数据，Agent SSE 经 vite 代理正常流式。

### ✅ 已交付（opencode 会话，2026-08-15）

- **任务 B**：`/backend/ai/test` `/backend/ai/models` `/backend/ai/tts`（POST，对齐 `aiClient.ts`，`ok:false`→502，TTS 返回音频二进制）；`/backend/web/screenshot-page` 与 `/backend/automation/*` 降级；`/project-verify-run` 补 POST 分支（前端 `projectVerifyRunClient` 用 POST，原仅 GET）；vite 代理覆盖 `/backend/*`、`/api/agent`、`/api/server`。
- **任务 C**：登录接口 `POST /api/server/login` + `POST /api/server/logout`（session 12h，内存）；所有受保护路由强制认证；`enforce_path_sandbox` 对全部带路径参数的 `/backend/vibe/*` 与 `/api/agent/run` 校验白名单；服务端 AI 配置注入（env 或 `~/.config/aiall/server-config.json`）+ `GET /api/server/ai-config`（不含 key）。

### ✅ 已交付（opencode 会话，2026-08-15，续）

- **任务 D**：`deploy/`（`agent-server.service`、`nginx.conf` 含 `proxy_buffering off`、`server.env.example`、`server-config.example.json`、`README.md`）；`scripts/`（`build-linux-agent-server.sh`、`build-linux-agent-server.yml` CI workflow、`deploy.sh`）。全部占位符、无真 key；部署/验证清单与「方案 A nginx 反代 / 方案 B 直连」二选一写清。
- **前端安全配合（任务 A 子集，opencode 执行）**：
  - `src/services/serverAuth.ts`：登录/登出/session 存储/`getAuthHeaders`/`authFetch`/`fetchServerAiConfig`。
  - 全局 fetch 包装 `installServerAuthFetch`（`main.ts` web 模式启用）：所有 `/backend/*`、`/api/*` 请求自动附 `Authorization: Bearer <session>`。
  - **key 不下发浏览器**：`runWebAgentSse`（agent run）与 `/backend/ai/*`、`git/generate-message`、`git/ai-batch-groups` 的 HTTP fallback 改传空 key，由服务端 `apply_server_ai` 注入。
  - 登录 UI：`WebAgentView.vue`（登录/登出）、`AiConfigView.vue`（服务器模式状态条：服务端 endpoint/model/key 状态展示 + 登录/登出）。

### ⬜ 未完成（见「四、任务索引」）

浏览器实测（真实起 agent-server + vite 验证）、生产构建（任务 E：`npm run build:tauri`、release 产物）。

## 三、接口契约（以 `/backend/vibe/*` 为准，改契约需先在此登记）

> 前端所有 client 已经写好 HTTP fallback（调用这些路径）。**路径与参数结构由现有 `src/services/*.ts` 决定，不要擅自改**；后端补齐实现即可。

### 3.1 已实现路由（`http_routes.rs`）

| 组 | 方法 & 路径 | 后端调用 |
|---|---|---|
| 文件 | GET `/list?path=` | `commands::fs::fs_list_core` |
| 文件 | POST `/read`（path, projectRoot） | `fs_read` |
| 文件 | POST `/write`（path, content, projectRoot） | `fs_write` |
| 文件 | GET `/search?path=&q=` | `fs_search` |
| 文件 | GET `/grep?path=&q=` | `fs_grep` |
| 文件 | POST `/create`（path, isDirectory, content, projectRoot） | `fs_create` |
| 文件 | DELETE `/delete?path=&projectRoot=` | `fs_delete` |
| 文件 | POST `/rename`（from, to, projectRoot） | `fs_rename` |
| 会话 | GET `/chat-store-load?projectPath=&loadMessages=` | `chat_store_load` |
| 会话 | GET `/chat-session-messages?projectPath=&sessionId=` | `chat_session_messages` |
| 会话 | POST `/chat-store-sync`（projectPath, data） | `chat_store_sync` |
| 会话 | POST `/chat-session-sync`（projectPath, sessionId, data, activeSessionId） | `chat_session_sync` |
| 会话 | POST `/chat-session-delete`（projectPath, sessionId, activeSessionId） | `chat_session_delete` |
| 会话 | GET `/chat-image?projectPath=&path=` | `chat_image` |
| 会话 | GET `/chat-image-file?projectPath=&path=`（返回图片二进制） | `chat_image_file` |
| Git | GET `/git/status?path=` | `git_status` |
| Git | GET `/git/repos?path=` | `git_list_repos` |
| Git | GET `/git/changed-since?path=&since=` | `git_changed_since` |
| Git | GET `/git/diff?path=&staged=&file=` | `git_diff` |
| Git | GET `/git/diff-content?path=&file=&staged=` | `git_diff_content` |
| Git | GET `/git/commit-file-diff?path=&hash=&file=&oldFile=` | `git_commit_file_diff` |
| Git | POST `/git/commit`（path, message） | `git_commit` |
| Git | GET `/git/log?path=&count=&search=&author=&file=&since=&until=&all=&branch=` | `git_log` |
| Git | GET `/git/ahead-commits?path=&count=` | `git_ahead_commits` |
| Git | GET `/git/behind-commits?path=&count=` | `git_behind_commits` |
| Git | POST `/git/add`（path, files[]） | `git_add` |
| Git | POST `/git/reset`（path, files[]） | `git_reset` |
| Git | POST `/git/reset-to-commit`（path, commit, mode） | `git_reset_to_commit` |
| Git | POST `/git/resolve-conflict`（path, file, side） | `git_resolve_conflict` |
| Git | POST `/git/discard`（path, files[]） | `git_discard` |
| Git | POST `/git/ignore-local`（path, files[]） | `git_ignore_local_changes` |
| Git | POST `/git/unignore-local`（path, files[]） | `git_unignore_local_changes` |
| Git | GET `/git/ignored-local?path=` | `git_list_ignored_local_changes` |
| Git | GET `/git/remotes?path=` | `git_remotes` |
| Git | POST `/git/fetch`（path, remote） | `git_fetch` |
| Git | POST `/git/pull`（path, remote, branch） | `git_pull` |
| Git | POST `/git/push`（path, remote, branch, setUpstream） | `git_push` |
| Git | GET `/git/stash-list?path=` | `git_stash_list` |
| Git | POST `/git/stash-save`（path, message） | `git_stash_save` |
| Git | POST `/git/stash-pop`（path, stashIndex） | `git_stash_pop` |
| Git | POST `/git/stash-apply`（path, stashIndex） | `git_stash_apply` |
| Git | POST `/git/stash-drop`（path, stashIndex） | `git_stash_drop` |
| Git | GET `/git/branches?path=` | `git_branches` |
| Git | POST `/git/checkout`（path, branch, createNew, startPoint） | `git_checkout` |
| Git | POST `/git/branch/delete`（path, branch, force） | `git_branch_delete` |
| Git | GET `/git/op-state?path=` | `git_op_state` |
| Git | POST `/git/merge`（path, branch） | `git_merge` |
| Git | POST `/git/merge-abort`（path） | `git_merge_abort` |
| Git | POST `/git/rebase`（path, onto） | `git_rebase` |
| Git | POST `/git/rebase-abort`（path） | `git_rebase_abort` |
| Git | POST `/git/cherry-pick`（path, commit） | `git_cherry_pick` |
| Git | POST `/git/revert-commit`（path, commit） | `git_revert_commit` |
| Git | GET `/git/tag-list?path=` | `git_tag_list` |
| Git | POST `/git/tag-create`（path, name, commit, message） | `git_tag_create` |
| Git | POST `/git/tag-delete`（path, name） | `git_tag_delete` |
| Git | GET `/git/submodule-status?path=` | `git_submodule_status` |
| Git | POST `/git/submodule-update`（path, init） | `git_submodule_update` |
| 项目 | POST `/project-context`（path） | `project_context` |
| 项目 | GET/POST `/project-memory`（projectPath / +content） | `project_memory_get/save` |
| 项目 | GET/POST `/project-knowledge`（projectPath / +content） | `project_knowledge_get/save` |
| 项目 | GET/POST `/project-skills`（projectPath, slug / +slug,content） | `project_skills_list/save` |
| 项目 | GET `/project-health-scan?projectPath=` | `project_health_scan` |
| 项目 | GET `/project-verify-run?projectPath=` | `project_verify_run` |
| 项目 | POST `/memory-usage`（projectPath, memoryContent, assistantResponse） | `memory_usage` |
| 杂项 | POST `/open-folder`（降级 stub） | — |
| 杂项 | POST `/pick-folder`（降级 stub，返回 cancelled） | — |

### 3.2 Agent 流式事件契约（`POST /api/agent/run`）

请求体 JSON：`{ prompt, history?, projectPath, endpoint, apiKey?, model, mode?, maxTurns?, imageDataUrls?, webProxyUrl?, taskWrittenFiles? }`（camelCase，字段对齐 `AgentRunRequest`）。

响应：`text/event-stream`，每事件一行 `data: <VibeAgentEvent JSON>\n\n`。事件 type 含：`status` / `agent_context` / `turn_request` / `tool_start` / `tool_end` / `message`（data.text 为助手文本）/ `error` / `done`。流结束即 run 结束。

### 3.3 前端调用路径（此前=任务 B 清单，现全部已实现）

| 路径 | 前端 client | 后端实现 |
|---|---|---|
| POST `/backend/vibe/git/generate-message` | `vibeGitClient.ts`（`gitGenerateMessage`） | `http_routes.rs` 用假 Channel 收集事件组 SSE（`collect_channel_events`），复用 `commands::git::git_generate_message`，零改动 commands |
| POST `/backend/vibe/git/ai-batch-groups` | `vibeGitClient.ts`（`gitAiBatchGroups`） | 同上，组 SSE |
| GET/POST `/backend/vibe/project-architect-review` + `/context` + `/history`（GET/POST/DELETE） | `vibeProjectArchitectReviewClient.ts` | 直接包装 `commands::project::*` |
| POST `/backend/web/extract` | `webExtractClient.ts` | 包装 `commands::web::web_extract`，SSE（progress + result） |
| POST `/backend/web/screenshot-page` | `pageScreenshotClient.ts` | **降级** `{ok:false, error:"服务器模式不支持页面截图"}`
| POST `/backend/ai/test` / `/backend/ai/models` / `/backend/ai/tts` | `aiClient.ts` | 包装 `commands::ai::*`；`ok:false` → HTTP 502；`/tts` 直接返回音频二进制 |
| POST `/backend/automation/open-by-template` / `/test-match` | `desktopAutomationClient.ts` / `iconTemplatesClient.ts` | **降级**（服务器无桌面环境） |

### 3.5 任务 C 新增接口与开关

| 项 | 说明 |
|---|---|
| POST `/api/server/login` | body `{password}` 匹配 `AIALL_SERVER_TOKEN` → 返回 `{ok, token, expiresAt, ttlSeconds}`；session 内存存储，12h 过期 |
| POST `/api/server/logout` | 吊销当前 Bearer session token |
| GET `/api/server/ai-config` | 返回 `{ok, endpoint, model, webProxyUrl, hasServerKey}`，**不含 key** |
| 认证 | `AIALL_SERVER_TOKEN` 非空时，`/api/agent/*`、`/backend/*`、`/api/server/*` 全部强制 `Bearer`（静态 token 或 session）；`/healthz` 匿名 |
| 路径沙箱 | `AIALL_SERVER_ALLOWED_PROJECTS` 非空时，`http_routes::enforce_path_sandbox` 对每个带绝对路径参数（path/projectPath/projectRoot/from/to）的 `/backend/vibe/*` 与 `/api/agent/run` 校验白名单 |
| 命令白名单 | `AIALL_SERVER_RESTRICT_COMMANDS=1` 启用 `server_mode_command_blocked`（`tool_exec.rs`） |
| 服务端 AI key | `AIALL_SERVER_AI_ENDPOINT/MODEL/KEY/PROXY` 或 `~/.config/aiall/server-config.json`；agent-run 与 `/backend/ai/*` 在请求体 apiKey 为空时由服务端注入 |

### 3.4 前端直接 `tauriInvoke`、无 HTTP fallback 的调用点（= 任务 A 清单）

| 调用点 | 命令 | 服务器态度 |
|---|---|---|
| `src/services/aiClient.ts` | `ai_test` / `ai_test_stream` / `ai_models` / `ai_tts` | 可做 HTTP（AI 配置页要能用）或降级 |
| `src/services/desktopAutomationClient.ts` | `automation_capture_screen` / `click_at` / `find_template` / `open_by_template` | **降级**：服务器无桌面 |
| `src/services/iconTemplatesClient.ts` | `automation_test_icon_template` | **降级** |
| `src/services/fileWatcherClient.ts` | `file_watcher_start` / `stop` / `stream`(EventSource) | 服务器意义小，**降级**或 stub |
| `src/services/npmScriptClient.ts` | `npm_script_run` / `npm_script_stop` | 服务器可跑但需沙箱，**先降级** |
| `src/services/vibeGitClient.ts` | `git_generate_message` / `git_ai_batch_groups`（直连 invoke） | 归任务 B |
| `src/services/webExtractClient.ts` | `web_extract`（tauriInvoke 路） | 归任务 B |
| `src/utils/debugLog.ts`、`VibeCodingView.vue` | `system_open_url` 等 | 可忽略/静默 |

## 四、任务索引与依赖

| 任务 | 负责方 | 文件域 | 依赖 | 文档 | 状态 |
|---|---|---|---|---|---|
| **A 前端实测 + 降级** | AI-B | `src/` | 无（现在就能做） | `docs/tasks/TASK-A-frontend.md` | **部分交付**（opencode：登录/认证注入/key 不下发/AI 配置页服务端状态条）；浏览器实测待做 |
| **B 后端增强路由** | AI-A | `src-tauri/src/http_routes.rs`、`src-tauri/src/commands/*.rs`、`src-tauri/src/bin/agent_server.rs` | 无（并行） | `docs/tasks/TASK-B-backend-routes.md` | ✅ **已交付**（`/backend/ai/*` 对齐、screenshot-page 降级、automation 降级、TTS 二进制、ai-config 状态码） |
| **C 安全** | AI-A | `src-tauri/` | 无（并行，但**勿与 B 同时改同一文件**，见下） | `docs/tasks/TASK-C-security.md` | ✅ **已交付**（登录/session、统一路径沙箱、服务端 AI key、命令白名单已有） |
| **D 部署物** | AI-C | 部署目录（`deploy/`、`scripts/`） | B、C 交付后 | `docs/tasks/TASK-D-deploy.md` | ✅ **已交付**（systemd / nginx(SSE off) / env 模板 / 部署 README / 交叉编译脚本 + CI workflow / deploy.sh，占位符无真 key） |
| **E 生产构建** | AI-B | `package.json`、`dist/`、`src-tauri/Cargo.toml` | A 完成 | `docs/tasks/TASK-E-build.md` | 待认领 |

依赖图：`A → E`；`B、C（串行给同一个 AI）→ D`。

## 五、文件所有权矩阵（防冲突，务必遵守）

| 目录/文件 | 只能由谁改 |
|---|---|
| `src-tauri/src/bin/agent_server.rs` | AI-A（任务 B/C） |
| `src-tauri/src/http_routes.rs` | AI-A（任务 B） |
| `src-tauri/src/commands/*.rs` | AI-A（任务 B/C） |
| `src-tauri/src/agent/**`、`src-tauri/src/git/**`、`src-tauri/src/fs/**` | **原则上不动**；确需抽函数（如 generate-message 非流式）由 AI-A 在 `commands/` 层包一层 |
| `src/**`（services/views/composables/utils） | AI-B（任务 A） |
| `deploy/`、`scripts/deploy*` | AI-C（任务 D） |
| `package.json`、`vite.config.ts` | AI-B（任务 A/E） |
| 本总纲与 `docs/tasks/*` | 任何人改需在此登记变更 |

**同一时间段内，`src-tauri/src/http_routes.rs` 只允许一个 AI 修改**（B 与 C 不能并发改它）。

## 六、通用铁律（所有接手 AI 必读）

1. **行为 SSOT**：Agent 行为 / 工具执行 / Git / 文件逻辑**只能在 Rust**（`src-tauri/`）里实现或包装。禁止在 `server/` 或前端重写同名实现。改行为前读 `AGENT_SSOT.md`；Rust 行为改动必须 `cargo check` 通过。
2. **接口契约**：`/backend/vibe/*` 路径与参数结构以前端 `src/services/*.ts` 的既有 fallback 为准，改动必须两处同步并在本总纲登记。
3. **分层**：`src-tauri/src/http_routes.rs` 只做「HTTP 参数 → commands::* 函数」的薄包装，业务判断放 `commands/` 或更底层。禁止在 http_routes 里内联大段业务逻辑。
4. **安全底线**：公网暴露前必须完成任务 C。当前 `agent-server` 默认只绑 `127.0.0.1`，**不得**在 C 完成前把 `AIALL_SERVER_BIND=0.0.0.0` 用于公网。
5. **测试**：改完必须跑 `npm run typecheck`；改 Rust 必须 `cargo check --bin agent-server`；改前端 client 契约必须跑对应 `npx vitest run <文件>`。
6. **日志**：禁止 `console.log` 调试；Rust 侧 `println!`/`eprintln!` 仅限 bin 启动与错误路径。
7. 本仓库为 git 仓库：**未获明确指示不得 commit / push**；改动保持未提交状态由验收方统一处理。

## 七、验收命令速查

```bash
cargo check --bin agent-server          # Rust 编译检查（src-tauri 内）
cargo build --bin agent-server          # 本地构建
npm run typecheck                       # 前端类型检查
npm test                                # 全量 Vitest
npx vitest run <文件>                    # 单文件测试
npm run agent:test-guards               # 完整防线（改 agent 相关时）
```

启动顺序（本地联调）：
```bash
# 终端 1：无头 Agent 服务
cd src-tauri && cargo run --bin agent-server   # 或直接用 target/debug/agent-server.exe
# 终端 2：浏览器预览
npm run dev:web                                # vite 已代理 /backend/vibe 与 /api/agent → 8787
# 浏览器访问
# http://localhost:5173/#/vibe-coding   （完整面板）
# http://localhost:5173/#/web-agent     （极简 Agent 验证页）
```
