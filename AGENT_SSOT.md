# Agent / backend SSOT（单一真相源）

桌面运行时已全面走 `src-tauri/`。`server/` 仅为 Vitest 契约 / parity 保留，**不得**再当作实现真相源新增逻辑。

## 目标态

| 层 | 真相源 | 允许 |
|----|--------|------|
| 常量 / 截断 / 格式 | `shared/` | 与 Rust 薄镜像 + `shared/agentConstantsParity.test.ts` |
| 编排分类器 / hint / guard 扫描 | `src/orchestration/` + `src/services/` | Vitest；禁止再在 `server/` 复制业务实现 |
| Agent 循环 / 工具 / FS·Git·AI·Web | `src-tauri/` | Rust 单测 + `agent:regression`（Rust 向量优先） |
| Node 参考实现 | 已删重行为双写 | 新代码禁止「TS 再实现一遍再测」 |

长期禁止「TS 仅测、Rust 只跑」的重行为双写。

## 模块归属（当前）

### A. Rust 真相源（桌面已接入）

改行为只改 Rust，补 Rust 测。

| 能力 | Rust |
|------|------|
| Agent 主循环 | `src-tauri/src/agent/run*.rs` |
| 工具执行 | `agent/tool_exec.rs` |
| 策略 | `agent/policy.rs`（TS 契约侧：`src/services/agentRunPolicy.ts`） |
| Finish / explore guard | `finish_gate.rs` / `explore_guard.rs` / `exploration.rs` |
| FS / Git / AI / Web | `fs/` `git/` `ai/` `commands/web.rs` |
| Chat store | `src-tauri/src/chat/` |
| Health / verify | `project/health_scan.rs` `verify_run.rs`（格式 SSOT 在 `shared/`） |

### B. TS 契约真相源（继续 Vitest）

| 能力 | 路径 |
|------|------|
| 意图 / 方案形态分类 | `src/orchestration/generic/` |
| 产品 hint / Ask·Explore·Plan prompt 文本 | `src/orchestration/product/` |
| Regression 向量消费（TS 半） | `src/services/agentRegression.ts` + `agentRunPolicy.ts` |
| 编排 guard 扫描 | `src/services/agentOrchestrationGuard.test.ts` |
| 咨询 trace 规则 | `src/services/consultative*.ts`（`server/` 仅允许 barrel re-export） |
| 项目上下文 parity | `server/projectStackProfile.ts` + `projectRouteContext.ts` + Rust parity 测 |

### C. 共享薄契约

| 能力 | 路径 |
|------|------|
| 探索预算 / 上下文上限 / compact / AI retry | `shared/*` ↔ Rust 常量 parity |

## 删除队列

按依赖从易到难：

1. **已删**：HTTP sidecar；`server/httpUtils.ts`、`fileLock.ts`；`server/chatStoreIndex|Merge`（无运行时引用）
2. **已收口**：`consultativeAccuracyTrace`、`consultativeBehaviorTrace`、`consultativeUiBehaviorTrace`、`vibeChatImages` → re-export `src/services`
3. **已切轨**：`npm run agent:smoke` → `cargo run --bin agent-smoke`（`agent_run_headless`）。`Cargo.toml` 需 `default-run = "app"`，避免与 `agent-smoke` 冲突
4. **已删**：Node `vibeAgent` 工具链及其 Vitest（`agentTurn*`、`agentToolExecutor`、`agentFinishGate`、`agentExploreGuard` 等）
5. **已删**：`vibeFs` / `vibeGit` / `aiForward` / `webExtract` / `vibeProject*` Node 实现，以及依赖它们的 `projectHealthScan`（Node 扫描实现）/ `projectArchitectReview`（Node）/ memory 辅助模块；`playwright` npm 依赖已移除

## 脚本约定

| 命令 | 真相源 |
|------|--------|
| `npm run test:rust-agent` | Rust Agent 单测 |
| `npm run agent:regression` | **先** Rust 向量，再 TS 分类器 / 报告 |
| `npm run agent:test-guards` | Rust parity + 编排 guard + 机制回归（不含 Node 工具落盘用例） |
| `npm run agent:smoke` | **桌面 Agent**：`cargo run --bin agent-smoke` → `agent_run_headless` |

## 变更纪律

- 修桌面 Agent 行为 → 只改 `src-tauri/`，补 Rust 测；不要在 `server/` 再写同名行为实现
- 改分类器 / hint → 只改 `src/orchestration` 或 `src/services`；`server/` 若仍有 import，用 re-export
- 新增跨运行时常量 → 进 `shared/`，并加 parity
