# TASK-C · 安全加固（负责方：AI-A，文件域 `src-tauri/`）

> 先读 `docs/WEB_SERVER_MIGRATION.md` 总纲与 `docs/DEPLOYMENT_REQUIREMENTS.md`（含服务器信息与安全要求）。
> **部署到公网前必须完成本任务。** 当前 agent-server 默认只绑 127.0.0.1，未完成本任务前不得对外开放。

## 认领状态

- 认领 AI：opencode（deepseek-v4-flash，本次会话）
- 状态：✅ **已交付**（2026-08-15，与 TASK-B 串行完成）
- 交付摘要：
  - **认证**：`POST /api/server/login`（body `{password}` 匹配 `AIALL_SERVER_TOKEN`）→ 随机 32B session token（内存存储，12h）；`POST /api/server/logout` 吊销；`authorized()` 同时接受静态 Bearer 与 session；`/healthz` 匿名，其余全强制。
  - **路径沙箱**：`project_allowed` 移入 `http_routes.rs`（`agent_server` 复用）；`enforce_path_sandbox` 对每个带绝对路径参数（path/projectPath/projectRoot/from/to）的 `/backend/vibe/*` 与 `/api/agent/run` 校验白名单 → 403。
  - **命令白名单**：已有 `AIALL_SERVER_RESTRICT_COMMANDS=1` + `server_mode_command_blocked`（`tool_exec.rs`），桌面路径不受影响。
  - **服务端 AI key**：`AIALL_SERVER_AI_ENDPOINT/MODEL/KEY/PROXY` 或 `~/.config/aiall/server-config.json`；`handle_agent_run` 调 `AgentRunRequest::apply_server_ai` 注入缺失 endpoint/key/model/proxy；`GET /api/server/ai-config` 返回 `{endpoint, model, webProxyUrl, hasServerKey}`（不含 key）。
- 待办（前端配合，属任务 A）：登录 UI / 浏览器不传明文 key / 配置页展示服务端 endpoint。

## 威胁模型

公网暴露出一个**能读文件、写文件、执行任意 shell 命令、git commit/push、访问外网**的 Agent。若被攻破 ≈ 服务器被 RCE。

## 要做的三件事

### 1. 认证（现在只有可选 Bearer token）

现状：`AIALL_SERVER_TOKEN` 非空时要求 `Authorization: Bearer <token>`（`agent_server.rs` 的 `authorized`）。

要求：
- 提供一个**登录接口**换取会话凭证（token 或 cookie），浏览器端非敏感地持有。
- 对 `/api/agent/run`、`/api/agent/cancel`、`/backend/vibe/*`、`/api/*` 全部强制校验（除 `/healthz` 可匿名）。
- token 至少 32 字节随机；建议固定时长 + 刷新。
- 参考实现位置：`agent_server.rs` 的 `authorized`、`ServerConfig.token`。**注意 `http_routes.rs` 与 `agent_server.rs` 同属 AI-A 权限，但与 TASK-B 是同一人做，注意别让两个任务撞车（见总纲第五、六节，若你和 B 分属两人则串行执行）。**

### 2. 项目沙箱 + 命令白名单（最关键）

现状：
- 已有 `AIALL_SERVER_ALLOWED_PROJECTS` 白名单，仅校验请求的 `projectPath` 落在白名单内（`agent_server.rs::project_allowed`）。
- **缺口 1**：`projectPath` 校验通过后，Agent 的 `read_file`/`write_file` 等工具通过 `crate::paths::resolve_readable_path` 做了「项目根目录内」限制，但**命令执行工具 `exec_run_command`（`src-tauri/src/agent/tool_exec.rs`）可以执行任意 shell 命令**，如 `rm -rf /`、读取 `/etc/passwd`。这是公网最大风险。
- **缺口 2**：白名单路径需对 `/backend/vibe/*` 里所有带 `path`/`projectPath` 参数的请求做校验（当前仅 `/api/agent/run` 校验）。文件读/写/Git 操作如果传入白名单外路径，会被 `resolve_*` 拦截一部分，但 HTTP 层的 `fs_read` 等命令支持绝对路径，需要统一强制。

要求（按优先级）：
1. **命令白名单**：给 `exec_run_command` 加一个「服务器模式命令策略」——默认只允许常见安全命令（`npm test`、`npm run build`、`git status`、`ls`、`cargo check` 等前缀白名单），其余返回「服务器模式禁止执行该命令」。开关由环境变量控制（如 `AIALL_SERVER_RESTRICT_COMMANDS=1`），**仅服务器模式启用，桌面版行为不变**。改 `tool_exec.rs` 时注意：Agent 行为 SSOT 在 Rust，白名单是「服务器模式策略」而非改 Agent 通用行为，尽量做成条件分支而非影响桌面路径。
2. **统一路径沙箱**：在 `http_routes.rs`（或抽一个 helper）对每个带路径参数的路由，先 `project_allowed` 校验再放行；`/api/agent/run` 已有，补全其余。
3. **禁止写 `.aiall/exploration` 与 `.aiall/memory` 的既有护栏**（AGENTS.md）在 HTTP 模式同样生效（走同一 `resolve_*` 即可，验证一遍）。

### 3. AI API Key 服务端管理

现状：前端 `VibeAgentRunRequest.apiKey` / 各 AI 请求把 key 发给服务端。

要求：
- **Key 不下发浏览器**：浏览器侧改为传「Key 引用 / 空」；服务端从自己的配置（环境变量或 `~/.config/aiall/server-config.json`）读取 key 注入请求。
- 至少做到：服务端提供 `GET /api/server/ai-config`（返回 endpoint/model，**不含 key**）供前端配置页展示；agent-run 时 key 从服务端配置取，请求体里的 `apiKey` 字段在服务器模式下忽略或仅作 fallback。
- 前端配合部分由任务 A 的 AI-B 做（它改 `aiClient.ts` / `vibeAgentClient.ts`），你在本任务只做服务端能力 + 写清接口约定，两端通过 `docs/WEB_SERVER_MIGRATION.md` 对齐。

## 验收标准

1. 无凭证访问 `/backend/vibe/*` 与 `/api/agent/run` 返回 401；登录后可访问。
2. 服务器模式（`AIALL_SERVER_RESTRICT_COMMANDS=1`）下，Agent 尝试 `rm -rf /`、`cat /etc/passwd` 等命令被拒并返回明确错误；`npm test` 等白名单内命令放行。
3. 向 `/backend/vibe/read` 传入白名单外路径返回 403。
4. 浏览器请求体不含明文 key；服务端用配置里的 key 正常完成 Agent 运行（用假 endpoint 验证请求头/体里带上了配置的 key）。
5. `cargo check --bin agent-server` 通过；桌面版回归：`npm run agent:test-guards` 不新增失败（尤其命令策略改动不得破坏桌面工具路径）。
6. 在 `docs/WEB_SERVER_MIGRATION.md` 登记新增接口与开关。

## 注意

- 只改 `src-tauri/`。改动 Agent 工具执行（命令白名单）时**谨慎**：先读 `AGENT_SSOT.md` 与 `tool_exec.rs` 现有防线（`is_dangerous_command` 等），把服务器策略做成条件分支，避免动桌面行为。
- 安全默认：宁可先拒，不可先放。拿不准的命令一律拒绝。
