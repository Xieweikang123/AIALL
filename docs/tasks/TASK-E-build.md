# TASK-E · 生产构建（负责方：AI-B，文件域 `package.json`、`dist/`、`src-tauri/Cargo.toml`）

> 先读 `docs/WEB_SERVER_MIGRATION.md` 总纲与 `docs/DEPLOYMENT_REQUIREMENTS.md`。依赖任务 A 完成。

## 目标

产出可部署的构建物：
1. 前端 `dist/`（生产构建，供 nginx / 服务器托管）。
2. 无头 Agent 服务 `agent-server` 的 release 二进制（Linux 目标由任务 D 的 CI/脚本产出；本任务确保 release 构建命令与产物正确）。

## 执行步骤

### 1. 前端生产构建

- 运行 `npm run build:tauri`（当前是 `cross-env vue-tsc --noEmit && cross-env vite build`），确认 `dist/` 更新、无类型错误。
- **确认生产模式的后端寻址**：web 版 `backendUrl()` 在没有 `VITE_BACKEND_URL` 时返回相对路径（`/backend/vibe/...`），配合 nginx 反代即可（任务 D 的 nginx.conf 已计划反代这些路径）。若决定「直连服务器端口、不走 nginx」，则需要一套带 `VITE_BACKEND_URL=http://<IP>:8088` 的构建产物，并在 `package.json` 加对应脚本（如 `build:web-server`），把两种构建方式在任务 D 的部署 README 里写清。
- **生产构建的 SSE/代理注意**：vite 代理只在 dev 生效，生产靠 nginx；`dist/` 本身不含代理逻辑，无需改前端代码，但要在部署文档里强调 nginx 必须 `proxy_buffering off`（SSE）。

### 2. 无头 Agent 服务 release 构建

- 确认 `cargo build --release --bin agent-server` 在本地（Windows）能出 `src-tauri/target/release/agent-server.exe`。
- Linux 目标由任务 D 的 CI（ubuntu-latest 交叉编译）产出，本任务只保证**本地构建命令可用**并给出文档记录。
- 可选：在 `package.json` 加 `agent:server:release` 脚本（`cd src-tauri && cargo build --release --bin agent-server`），与 AI-C 协调脚本命名，避免撞车。

### 3. 文档更新

- 更新 `docs/DEPLOYMENT_REQUIREMENTS.md` 的「当前状态」勾选已完成项。
- 更新总纲 `docs/WEB_SERVER_MIGRATION.md` 中涉及的构建命令与产物说明。
- 更新 `src/services/tauriInvoke.ts` 里 `WEB_REQUIRES_TAURI_MESSAGE` 文案（若 web 模式已可用，提示语不应再说「请用桌面版」，改成面向服务器模式的说明）。

## 验收标准

1. `npm run build:tauri` 通过且 `dist/` 时间戳更新、产物完整。
2. `cargo build --release --bin agent-server` 本地通过。
3. 本地起 `python -m http.server`（或 nginx）托管 `dist/`，配合 agent-server 与 nginx 反代（或 `VITE_BACKEND_URL` 直连），浏览器验证 `/vibe-coding` 完整功能可用（这是「生产形态」的预演）。
4. `npm run typecheck` 通过。

## 注意

- 你的文件域主要是 `package.json`、`dist/`、`docs/`；如需改前端代码只做构建相关（如脚本、提示文案），业务改动归任务 A。
- 不 commit / push；产物（`dist/`、`target/release`）按 `.gitignore` 处理，不纳入 git。
