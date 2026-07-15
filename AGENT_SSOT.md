# Agent / backend SSOT（单一真相源）

桌面运行时已全面走 `src-tauri/`。`server/` 仅为 Vitest / `agent-smoke` 保留，**不得**再当作实现真相源新增逻辑。

## 目标态

| 层 | 真相源 | 允许 |
|----|--------|------|
| 常量 / 截断 / 格式 | `shared/` | 与 Rust 薄镜像 + `shared/agentConstantsParity.test.ts` |
| 编排分类器 / hint / guard 扫描 | `src/orchestration/` + `src/services/` | Vitest；禁止再在 `server/` 复制业务实现 |
| Agent 循环 / 工具 / FS·Git·AI·Web | `src-tauri/` | Rust 单测 + `agent:regression`（Rust 向量优先） |
| Node 参考实现 | 删除或薄 re-export | 新代码禁止「TS 再实现一遍再测」 |

过渡手段（冻结表）服务于删除，不是终态。长期禁止「TS 仅测、Rust 只跑」的重行为双写。

## 模块归属（当前）

### A. Rust 真相源（桌面已接入；Node 副本冻结）

改行为只改 Rust；Node 侧仅维护到 smoke 迁走为止，**禁止功能对刷**。

| 能力 | Rust | Node（冻结 / 待删） |
|------|------|---------------------|
| Agent 主循环 | `src-tauri/src/agent/run*.rs` | `server/vibeAgent.ts` + `agentTurn*.ts` |
| 工具执行 | `agent/tool_exec.rs` | `server/agentToolExecutor.ts` |
| 策略 | `agent/policy.rs` | `server/agentRunPolicy.ts` → re-export `src/services` |
| Finish / explore guard | `finish_gate.rs` / `explore_guard.rs` / `exploration.rs` | `server/agentFinishGate.ts` / `agentExploreGuard.ts` |
| FS / Git / AI / Web | `fs/` `git/` `ai/` `commands/web.rs` | `vibeFs` `vibeGit` `aiForward` `webExtract` |
| Chat store | `src-tauri/src/chat/` | ~~`server/chatStore*`~~ 已删 |
| Health / verify | `project/health_scan.rs` `verify_run.rs` | `server/projectHealthScan.ts` 等（shared 为格式 SSOT） |

### B. TS 契约真相源（继续 Vitest）

| 能力 | 路径 |
|------|------|
| 意图 / 方案形态分类 | `src/orchestration/generic/` |
| 产品 hint / Ask·Explore·Plan prompt 文本 | `src/orchestration/product/` |
| Regression 向量消费（TS 半） | `src/services/agentRegression.ts` + `agentRunPolicy.ts` |
| 编排 guard 扫描 | `src/services/agentOrchestrationGuard.test.ts` |
| 咨询 trace 规则 | `src/services/consultative*.ts`（`server/` 仅允许 barrel re-export） |

### C. 共享薄契约

| 能力 | 路径 |
|------|------|
| 探索预算 / 上下文上限 / compact / AI retry | `shared/*` ↔ Rust 常量 parity |

## 删除队列

按依赖从易到难：

1. **已删**：HTTP sidecar；`server/httpUtils.ts`、`fileLock.ts`；`server/chatStoreIndex|Merge`（无运行时引用）
2. **已收口**：`server/agentRunPolicy`、`consultativeAccuracyTrace`、`consultativeBehaviorTrace`、`consultativeUiBehaviorTrace`、`vibeChatImages` → re-export `src/services`
3. **已切轨**：`npm run agent:smoke` → `cargo run --bin agent-smoke`（`agent_run_headless`）；Node `server/vibeAgent` 不再被 smoke 调用。`Cargo.toml` 需 `default-run = "app"`，避免与 `agent-smoke` 冲突
4. **随后**：删 `vibeAgent` 工具链及其 Vitest；迁完后才能从删除队列去掉 Node Agent
5. **再后**：删 `vibeFs` / `vibeGit` / `aiForward` / `webExtract` / `vibeProject*` Node 实现

## 脚本约定

| 命令 | 真相源 |
|------|--------|
| `npm run test:rust-agent` | Rust Agent 单测 |
| `npm run agent:regression` | **先** Rust 向量，再 TS 分类器 / 报告 |
| `npm run agent:test-guards` | Rust parity + 编排 guard + 机制回归（不含 Node 工具落盘用例） |
| `npm run agent:smoke` | **桌面 Agent**：`cargo run --bin agent-smoke` → `agent_run_headless` |

## 变更纪律

- 修桌面 Agent 行为 → 只改 `src-tauri/`，补 Rust 测；不要「顺手」改 `server/` 同名逻辑冒充已覆盖
- 改分类器 / hint → 只改 `src/orchestration` 或 `src/services`；`server/` 若仍有 import，用 re-export
- 新增跨运行时常量 → 进 `shared/`，并加 parity
