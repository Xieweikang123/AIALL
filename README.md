# AIALL

Tauri 桌面 IDE：在本地项目上跑 Agent（文件 / Git / Monaco / 会话），并附带通用对话、图标模板桌面自动化与 AI 配置页。

## 运行

| 命令 | 用途 |
|------|------|
| `npm run dev` | **默认**：Tauri 桌面版（完整功能） |
| `npm run tauri:build` | 打包桌面应用 |
| `npm run dev:web` | 浏览器 UI 预览（Agent/Git/FS 不可用） |
| `npm test` | Vitest（契约 / 编排 / shared） |
| `npm run test:rust-agent` | Rust Agent 单测 |
| `npm run agent:smoke` | 无头桌面 Agent smoke（Rust） |

桌面运行时真相源为 `src-tauri/`。约定与术语见 [`AGENTS.md`](AGENTS.md)，后端 SSOT 见 [`AGENT_SSOT.md`](AGENT_SSOT.md)。
