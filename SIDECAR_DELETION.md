# Sidecar 删除路线图

桌面版（`npm run dev` / `tauri build`）全面走 Tauri `invoke()`。**Sidecar HTTP 运行时已删除（策略 B，2026-07）**。

## 阶段 0：Tauri 缺口补齐（已完成）

| 能力 | Tauri 命令 | 前端 |
|------|-----------|------|
| 选择项目文件夹 | `system_pick_folder` | `vibeCodingClient.pickProjectFolder` → `invokeBackend` |
| 打开 URL | `system_open_url` | `CursorToolStepRow.vue`（Tauri 分支） |
| 图标模板测试匹配 | `automation_test_icon_template` | `iconTemplatesClient.testIconTemplateMatch` → `invokeBackend` |

## 阶段 1：Parity 测试（已完成）

Rust 侧单元测试为桌面 Agent 的**真相源**；`server/` 下 Vitest 保留编排逻辑回归。

统一入口：

```bash
npm run test:rust-agent
npm run agent:regression   # Rust policy 向量优先 + TS 分类器
npm run agent:test-guards
```

## 阶段 2：策略 B（已完成）

- 已删除 `sidecar/main.ts`、Vite middleware、`vibeRoutes*.ts`、`server/localApiServer.ts` 及 HTTP-only 模块
- `dev:web` 仅 UI 预览；`invokeBackend` 在浏览器中返回「请使用 Tauri 桌面版」
- `server/` **保留** Vitest 契约 / parity（barrel re-export、project context 等）；`agent:smoke` 已切 Rust

## 已删除清单

| 类别 | 路径 |
|------|------|
| Sidecar 入口 | `sidecar/main.ts`（`sidecar/dist/` 仍在 `.gitignore`） |
| HTTP 服务 | `server/localApiServer.ts`、`server/aiHttpHandlers.ts` |
| Vite middleware | `vite.vibeCodingMiddleware.ts`、`vite.automationMiddleware.ts`、`vite.iconTemplatesMiddleware.ts` |
| HTTP 路由 | `vibeRoutesGit.ts`、`vibeRoutesFileOps.ts`、`vibeRoutesFileWatcher.ts` |
| 桌面自动化（Node） | `server/winDesktop.ts`、`server/templateMatch.ts`、`server/tolerantTemplateMatch.ts`、`server/selfDevProbeMatch.ts` |
| 文件监视（Node） | `server/fileWatcher.ts` |
| 构建脚本 | `scripts/build-sidecar.mjs`、`scripts/fetch-node-runtime.mjs` |
| npm 依赖 | `connect`、`chokidar`、`sharp`、`concurrently`、`playwright`（随 Node webExtract 删除） |

## 保留

- `src-tauri/` — 桌面运行时（Agent 行为真相源）
- `shared/` — 共享类型与格式（含 `agentContextLimits`、`agentMessageCompact`、`aiRetry`、`chatMessageNormalize`；TS/Rust 常量 parity 见 `shared/agentConstantsParity.test.ts`）
- `server/` — Vitest 契约 / parity（**非 HTTP**、非桌面行为真相源）；见 [`AGENT_SSOT.md`](AGENT_SSOT.md)
- Vitest 中编排/准确度相关测试（契约在 `src/orchestration` / `src/services`）

## 快速检查

```bash
npm run dev          # 桌面版（唯一完整功能入口）
npm run dev:web      # UI 预览 only
cd src-tauri && cargo test
npm test
```
