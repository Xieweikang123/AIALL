# Rust 化迁移规划

## 目标

将 Node.js sidecar (`server/` + `vibeRoutes*.ts`) 中的模块逐一迁移到 Rust Tauri 命令 (`src-tauri/`)，使前端最终统一走 Tauri `invoke()`，不再依赖 Node.js HTTP sidecar。

## 完成状态图例

| 标记 | 含义 |
|------|------|
| `[ ]` | 未开始 |
| `[~]` | 进行中（见责任人） |
| `[x]` | 已完成 |
| `[-]` | 已废弃（无需迁移） |

## 迁移清单

### 第 1 批：基础设施（已完成）

| 模块 | Node.js 源 | Rust 目标 | 状态 |
|------|-----------|-----------|------|
| 文件系统 | `server/vibeFs.ts` | `src-tauri/src/fs/` | `[x]` |
| Git 基本操作 | `server/vibeGit.ts` + `vibeRoutesGit.ts` | `src-tauri/src/git/` | `[x]` |
| 聊天/会话 | `server/chatStore*.ts` | `src-tauri/src/chat/` | `[x]` |
| 项目元数据 | `server/vibeProject*.ts` | `src-tauri/src/project/` | `[x]` |
| 健康扫描 | `server/projectHealthScan.ts` | `src-tauri/src/project/health_scan.rs` | `[x]` |
| 项目验证运行 | `server/projectVerifyRun.ts` | `src-tauri/src/project/verify_run.rs` | `[x]` |
| 文件监视 | `server/fileWatcher.ts` | `src-tauri/src/commands/watcher.rs` | `[x]` |
| 系统操作 | — | `src-tauri/src/commands/system.rs` | `[x]` |
| AI 代理（基础） | `server/aiForward.ts` | `src-tauri/src/ai/` | `[x]` |
| Agent 循环（基础） | `server/vibeAgent.ts` (部分) | `src-tauri/src/agent/run.rs` + `run_types` / `run_emit` / `run_stream` / `run_finalize` / `run_post_tools` | `[x]` |
| 路径解析 | — | `src-tauri/src/paths.rs` | `[x]` |

### 第 2 批：AI 增强功能（已完成）

| 模块 | Node.js 源 | Rust 目标 | 状态 |
|------|-----------|-----------|------|
| Git AI 提交消息 | `vibeRoutesGit.ts:209-345` | `src-tauri/src/commands/git.rs` (`git_generate_message`) | `[x]` |
| Git AI 文件分组 | `vibeRoutesGit.ts:347-498` | `src-tauri/src/commands/git.rs` (`git_ai_batch_groups`) | `[x]` |
| AI TTS | `server/aiHttpHandlers.ts:113-206` | `src-tauri/src/commands/ai.rs` (`ai_tts`) | `[x]` |
| 流式 AI 支持 | `server/aiForward.ts` | `src-tauri/src/ai/forward.rs` (`chat_completion_stream_raw`) | `[x]` |

### 第 3 批：桌面自动化（已完成）

| 模块 | Node.js 源 | Rust 目标 | 状态 |
|------|-----------|-----------|------|
| 屏幕截图 | `server/winDesktop.ts:131-151` | `src-tauri/src/commands/automation.rs` | `[x]` |
| 鼠标点击 | `server/winDesktop.ts:188-210` | `src-tauri/src/commands/automation.rs` | `[x]` |
| 模板匹配 | `server/templateMatch.ts` | `src-tauri/src/commands/automation.rs` | `[x]` |

### 第 4 批：Web 功能（已完成）

| 模块 | Node.js 源 | Rust 目标 | 状态 |
|------|-----------|-----------|------|
| 网页截图 | `server/webExtract.ts:259-336` | `src-tauri/src/commands/web.rs` (`web_screenshot_page`) | `[x]` |
| 网页提取改进 | `server/webExtract.ts` | `src-tauri/src/commands/web.rs` (`web_extract`) | `[x]` |

### 第 5 批：前端服务层切换（全部完成）

| 前端服务文件 | 当前后端方式 | 迁移目标 | 状态 | 责任人 |
|------------|------------|---------|------|--------|
| `src/services/vibeGitClient.ts` | HTTP `fetch()` | Tauri invoke | `[x]` | |
| `src/services/vibeAgentClient.ts` | HTTP SSE | Tauri Channel | `[x]` | |
| `src/services/vibeCodingClient.ts`（FS 操作） | HTTP `fetch()` | Tauri invoke | `[x]` | 已全部用 `invokeBackend` 包裹 |
| `src/services/vibeProjectMemoryClient.ts` | HTTP `fetch()` | Tauri invoke | `[x]` | @assistant | 已切换 `project_memory_get/save`，`append` 走 file API |
| `src/services/vibeProjectKnowledgeClient.ts` | HTTP `fetch()` | Tauri invoke | `[x]` | @assistant | 已切换 `project_knowledge_get/save` |
| `src/services/vibeProjectSkillsClient.ts` | HTTP `fetch()` | Tauri invoke | `[x]` | @assistant | 已切换 `project_skills_list/save`，`archive` 走 file API |
| `src/services/vibeProjectArchitectReviewClient.ts` | HTTP `fetch()` | Tauri invoke | `[x]` | @assistant | 已切换 6 个函数
| `src/services/projectHealthScanClient.ts` | HTTP `fetch()` | Tauri invoke | `[x]` | 小四 |
| `src/services/projectVerifyRunClient.ts` | HTTP `fetch()` | Tauri invoke | `[x]` | 小四 |
| `src/services/fileWatcherClient.ts` | HTTP `fetch`+`EventSource` | Tauri invoke | `[x]` | 小四 | start/stop 已切; SSE stream 为 EventSource 长连不受影响 |
| `src/services/aiClient.ts` | HTTP `fetch()` | Tauri invoke | `[x]` | 已切换（`testAiModel`/`fetchAvailableModels`/`testTtsModel`） |
| `src/services/desktopAutomationClient.ts` | HTTP `fetch()` | Tauri invoke | `[x]` | 已切换 |
| `src/services/pageScreenshotClient.ts` | HTTP `fetch()` | Tauri invoke | `[x]` | 已切换 |
| `src/services/webExtractClient.ts` | HTTP `fetch()` | Tauri invoke | `[x]` | 已切换 |
| `src/services/iconTemplatesClient.ts` | HTTP `fetch()` | Tauri invoke | `[x]` | 小四 | 读写均已切 |

### 第 6 批：Rust 编排层模块

| 模块 | Rust 文件 | 状态 | 责任人 | 说明 |
|------|----------|------|--------|------|
| 工具定义 | `src-tauri/src/agent/tools.rs` | `[x]` | | 12 个工具定义 + 执行器，已接入 `run.rs` |
| System Prompt 构建 | `src-tauri/src/agent/prompts.rs` | `[x]` | | 4 种模式，已接入 `run.rs` |
| 运行时检测 | `src-tauri/src/agent/runtime_hint.rs` | `[x]` | | `package.json` 脚本检测，已接入 `run.rs` |
| 分类器摘要 | `src-tauri/src/agent/classifier.rs` | `[x]` | | `tool_summary()` 已接入；`mod.rs` 不 re-export 未用函数 |
| 视觉处理 | `src-tauri/src/agent/vision.rs` | `[x]` | | 被 `run.rs` 调用的函数已全部 re-export，未用函数不暴露 |
| 策略引擎 | `src-tauri/src/agent/policy.rs` | `[x]` | | `resolve_run_policy()` 已接入；`run.rs` 通过 `super::policy` 引用 |
| 探索预算 | `src-tauri/src/agent/exploration.rs` | `[x]` | | nudge builders 已接入；未用常量不 re-export |
| 完成门控 | `src-tauri/src/agent/finish_gate.rs` | `[x]` | 小四 | 已接入 `run.rs` L320 |
| Git 工具 | `src-tauri/src/agent/agent_git_tools.rs` | `[x]` | | context 快照 + `run.rs` 工具执行共用 |
| 咨询追踪 | `src-tauri/src/agent/consultative_trace.rs` | `[x]` | | finalize 门禁与 retry hint 已接入 `run.rs` |
| 探索守卫 | `src-tauri/src/agent/explore_guard.rs` | `[x]` | | runtime/force-patch/duplicate 检测 |
| Agent run 子模块 | `run_types.rs` / `run_emit.rs` / `run_stream.rs` / `run_finalize.rs` / `run_post_tools.rs` | `[x]` | | 主循环 ~859 行；finalize / post-tool 已外提 |

### 第 7 批：Agent 流式 + 循环接线

| 任务 | 说明 | 状态 | 责任人 |
|------|------|------|--------|
| `run.rs` 改用 `chat_completion_stream_raw` | 流式 SSE + `message_delta` | `[x]` | |
| `run.rs` 调用 `policy::resolve_run_policy` | 调用策略引擎 | `[x]` | |
| `run.rs` 调用 `exploration` nudge builders | 只读轮数超预算时 nudge | `[x]` | |
| `run.rs` 调用 `classifier::tool_summary` | `tool_end` 摘要 | `[x]` | |
| `run.rs` 调用 `finish_gate` | 质量校验 | `[x]` | 小四 |
| `run.rs` 注入 `vision` 提示词 | 有截图时加 vision 规则 | `[x]` | |

### 第 8 批：Agent parity + 桌面 P0 收尾

| 模块 | Rust / 前端 | 状态 | 说明 |
|------|------------|------|------|
| Post-tool nudge | `run.rs` + `exploration.rs` | `[x]` | grep 空/read 失败/runtime/duplicate/force-patch |
| Finalize 重试 | `run.rs` + `finish_gate.rs` | `[x]` | 空回复、过早完成、patch-required |
| 探索归档写入拦截 | `run.rs` + `exploration.rs` | `[x]` | `.aiall/exploration/` 禁止 write |
| Memory usage 追踪 | `project/memory_usage.rs` + `useProjectMemory.ts` | `[x]` | `.aiall/memory-usage.json` |
| 聊天图片 Tauri 显示 | `vibeChatImageStore.ts` | `[x]` | Tauri 走 hydrate/dataUrl，不依赖 sidecar URL |
| Web extract 进度 | `webExtractClient.ts` | `[x]` | Tauri + onProgress 走 invoke |

### 第 9 批（Sidecar 收口）

| 任务 | 说明 | 状态 |
|------|------|------|
| Tauri 缺口命令 | `system_pick_folder`、`automation_test_icon_template`；`system_open_url` 已存在 | `[x]` |
| 前端 invokeBackend 统一 | `pickProjectFolder`、`testIconTemplateMatch` | `[x]` |
| Sidecar 删除路线图 | 见 `SIDECAR_DELETION.md` | `[x]` |
| Sidecar 物理删除 | HTTP sidecar、Vite middleware、`vibeRoutes*` | `[x]` | 策略 B；`server/` 编排逻辑保留供 Vitest |
| Parity 测试 Rust 化 | `npm run test:rust-agent`（finish_gate / exploration / explore_guard / policy） | `[x]` |
| explore_guard 全量迁移 | 重叠 read、vision grep、grepHitVue finalize 等（见 `SIDECAR_DELETION.md`） | `[x]` | Rust 单测 24+ 用例；`agent:regression` Rust 向量优先 |
| Agent turn preflight | `server/agentTurnPreflight.ts` | `run_preflight.rs` | `[x]` |
| Startup hints | `vibeAgent.ts` / `agentContextBuilder.ts` | `run_startup_hints.rs` | `[x]` |
| Knowledge manifest | `projectReportDisplay.ts` / `agentContextBuilder.ts` | `knowledge_manifest.rs` + `context.rs` | `[x]` |
| Explore system prompt | `agentExplorePrompt.ts` | `explore_prompt.rs` + `prompt_hints.rs` | `[x]` |

### 第 10 批：Agent 上下文 / AI 重试 shared parity

| 模块 | TS 源 | Rust 目标 | 状态 | 说明 |
|------|-------|-----------|------|------|
| 上下文上限常量 | `shared/agentContextLimits.ts` | `src-tauri/src/agent/context_limits.rs` | `[x]` | policy / compact / history 共用；`shared/agentConstantsParity.test.ts` 校验 |
| 消息 compact | `shared/agentMessageCompact.ts` | `src-tauri/src/agent/run_compact.rs` | `[x]` | `run.rs` 每轮 model call 前 compact；Vitest + Rust 单测 |
| AI 重试 | `shared/aiRetry.ts` | `src-tauri/src/ai/retry.rs` | `[x]` | 首包超时、429/5xx、空回复；`AGENT_AI_MAX_RETRIES` |
| 消息 normalize | `shared/chatMessageNormalize.ts` | `src-tauri/src/ai/normalize.rs` | `[x]` | assistant tool_calls / tool content 规范化 |
| Chat 消息类型 | `shared/chatCompletionTypes.ts` | — | `[x]` | TS 编排与 Vitest 共用；Rust 用 `serde_json::Value` |
| AI 流式重试接线 | `server/aiForward.ts` | `src-tauri/src/ai/forward.rs` | `[x]` | `chat_completion_stream_with_retry` + `retrying_model` SSE |
| Server 上下文 barrel | `server/agentContext.ts` | — | `[x]` | 历史/display/SSE 截断；compact 逻辑 re-export 自 `shared/` |
| 前端重复模块删除 | `src/services/agentContext.ts` | — | `[x]` | 测试改 import `shared/`；桌面运行时走 Rust |

## 协作规则

### 认领机制

1. 所有 AI 实例在开始迁移某个模块前，先将该模块的 `状态` 改为 `[~]`，`责任人` 写上自己的 ID
2. 模块粒度最小为 **一个函数**（如 `git_generate_message`），最大为 **一个文件**（如整个 `vibeGitClient.ts`）
3. 避免同时修改同一个 **函数** — 允许不同 AI 同时修改同一个文件的 **不同函数**
4. 完成后改为 `[x]`，清除责任人

### 迁移模式

每个模块迁移的标准步骤：

1. **了解逻辑** — 读 Node.js 源实现
2. **Rust 实现** — 在 `src-tauri/src/` 对应位置实现功能
3. **注册命令** — 在 `src-tauri/src/lib.rs` 的 `invoke_handler` 中注册（如需要）
4. **前端切换** — 在前端服务文件中加入 Tauri invoke / Channel（桌面 only；浏览器 `dev:web` 不可用）
5. **验证** — `cargo check` 通过，不破坏已有功能

### 后端调用模式

Tauri invoke 模式（桌面唯一路径）：

```rust
// Rust 端 — 用 Channel 做流式
#[tauri::command]
pub async fn my_cmd(arg: String, on_event: Channel<Value>) {
  let _ = on_event.send(json!({ "type": "progress", "data": { ... } }));
  // ...
  let _ = on_event.send(json!({ "type": "done", "data": { ... } }));
}
```

```typescript
// 前端 — 仅 Tauri env；非桌面由 invokeBackend 拒绝
import { invoke, Channel } from "@tauri-apps/api/core";
import { isTauriEnv } from "./tauriInvoke";

function myCmdTauri(arg: string, onProgress: (s: string) => void): Promise<Result> {
  if (!isTauriEnv()) {
    return Promise.resolve({ ok: false, error: "请使用 Tauri 桌面版" } as Result);
  }
  return new Promise((resolve) => {
    const channel = new Channel<{ type: string; data: any }>();
    channel.onmessage = (e) => {
      if (e.type === "progress") onProgress(e.data.step);
      else if (e.type === "done") resolve(e.data);
      else if (e.type === "error") resolve({ ok: false, error: e.data.error });
    };
    invoke("my_cmd", { arg, onEvent: channel }).catch(() => {});
  });
}
```

非流式命令用 `invokeBackend`：

```typescript
import { invokeBackend } from "./tauriInvoke";

async function mySimpleCmd(arg: string): Promise<Result> {
  return invokeBackend<Result>("my_cmd", { arg });
}
```

### 注意事项

- **Web 预览** — 浏览器 `dev:web` 不再连接 sidecar；`invokeBackend` 提示使用 Tauri 桌面版。Vitest 中仍可通过可选 `httpFallback` 测客户端契约（非产品路径）
- **Node 双写已清** — Agent / FS / Git / AI / Web 的 Node 参考实现已删；行为真相源为 Rust。见 [`AGENT_SSOT.md`](AGENT_SSOT.md)
- **`cargo check`** — 修改 Rust 代码后必须通过 `cargo check`
- **每种 AI 采用不同的系统 Prompt 指向此文档**，并在文档中标注自己当前负责的模块
