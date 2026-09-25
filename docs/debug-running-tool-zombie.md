# 定位报告：工具卡片卡在「执行中 · 575s / 30s」

> 现象：截图里 `exec: git log --oneline -12` 显示 `执行中 · 575s / 30s`。
> 该命令是毫秒级命令，Rust 侧 `run_command` 硬超时上限 120s，**575s 物理上不可能**。
> 结论：`tool_end` 从未到达前端，且 run 的收尾信号也丢了。

---

## ⚠️ 结论（已用 crash.log + checkpoint 坐实）

**根因 = Rust panic，不是网络断连、不是前端 bug。**

`tool_summary` 在按**字节**截断 UTF-8 中文串时切在 char 边界中间 → panic →
panic 发生在 `emit(tool_end)` **之前** → 整个 run 崩掉，`tool_end` / `done` 全都没发 →
前端 `running: true` 永不清除 → 计时无限累加 → 575s / 30s。

### 铁证（三个时间戳严丝合缝）

```
[2026-09-25 00:37:35.344] [rust-panic] location=src\agent\classifier.rs:70:48
payload=end byte index 60 is not a char boundary; it is inside '为' (bytes 59..61 of string)
```

| 时间（本地） | 事件 | 证据来源 |
|---|---|---|
| 00:37:35.344 | `run_command` 摘要生成时 panic | `crash.log` |
| 00:37:38.089 | checkpoint 落盘，`phase: "running"` | `checkpoints/active-1789743656583-*.json` 的 `updatedAt` |
| 00:37:38.511 | 再次 panic | `crash.log` |

checkpoint 内容印证：

```json
{ "phase": "running", "agentRecoverable": true, "content": "",
  "tools": [], "totalTurns": 1, "turn": 1,
  "projectPath": "D:\\project\\AIALL",
  "sessionId": "1789743656583-eda074f4783668" }
```

`tools: []` —— panic 太快，工具记录根本没落盘；`phase: "running"` 永不收尾 → 刷新也救不回。

### 触发代码：`src-tauri/src/agent/classifier.rs:65-71`

```rust
let one_line = result.replace(|c: char| c.is_whitespace(), " ").trim().to_string();
if one_line.len() > 60 {                      // ← len() = 字节数，不是字符数
    return format!("{}…", &one_line[..60]);   // ← 按字节切，中文被劈开 → panic
}
```

`"为"` = 3 字节；`&one_line[..60]` 落在第 59~61 字节之间 → Rust 要求切片必须在 char 边界 → panic。
`70:48` 正是 `&one_line[..60]` 的列位置。

### 为什么 `tool_end` 一定发不出来：`run.rs:1124-1141` 是先算后发

```rust
let summary = if ok { crate::agent::tool_summary(name, &result) }   // ← panic 在这里
    else if result.contains("命令超时") { "超时".to_string() }
    else { "failed".to_string() };
emit(&channel, json!({ "type": "tool_end", ... }));                  // ← 永远走不到
```

`tool_summary` panic → run 线程崩溃 → `tool_end` 和 `done` 都发不出。

### 同款地雷清单（全部按字节切，均无防护）

| 位置 | 代码 | 状态 |
|---|---|---|
| `classifier.rs:70` | `&one_line[..60]`（run_command） | **已炸 13 次** |
| `classifier.rs:120` | `&one_line[..120]`（兜底分支） | **已炸**（`end byte index 120`） |
| `classifier.rs:51` | `&line[..60]`（patch_file） | 同款雷，未炸 |
| `agent_git_tools.rs:206` | `&trimmed[..MAX_PATCH_CHARS]`（git diff 截断） | 同款雷，未炸 |

**触发条件**：工具输出 > 60/120 字节，且切点落在多字节字符中间。
`git log --oneline -12` 输出含中文提交信息时**极易命中** —— 与截图完全吻合。

### 修复方案

统一用 char-aware 截断（按字符数，不按字节）：

```rust
pub(crate) fn truncate_chars(s: &str, max_chars: usize) -> String { ... }
pub(crate) fn truncate_chars_suffix(s: &str, max_chars: usize, suffix: &str) -> String { ... }
```

替换上述 4 处；`classifier.rs:44` 的 `result[..pos]`（`find("（")` 结果）本身是 char 边界，不用改。

---

## 七、修复实施记录（已完成）

### Rust 侧（B 方案）

| 文件 | 改动 |
|---|---|
| `classifier.rs` | 新增 `truncate_chars` / `truncate_chars_suffix`；替换 `patch_file:51`、`run_command:70`、兜底 `:120` 三处字节切片 |
| `agent_git_tools.rs` | `truncate_patch` 改用 `truncate_chars_suffix`（1 行） |

新增 Rust 测试（9 个，覆盖真实 panic 边界）：
- `test_truncate_chars_does_not_panic_on_multibyte_boundary` —— 构造 59 ASCII + 「为」，
  断言 `!s.is_char_boundary(60)` 后调用新实现（旧实现此处在 `&s[..60]` panic）
- `test_truncate_chars_counts_chars_not_bytes` —— 60 个中文（180 字节）不被误截
- `test_tool_summary_run_command_multibyte_boundary_no_panic` —— 真实场景（git log 中文输出）
- `test_tool_summary_fallback_120_multibyte_boundary_no_panic` —— 复现 `index 120` panic
- `test_tool_summary_patch_file_multibyte_never_panics` —— 55~61 填充长度全扫
- 另有 `run_command` 空串 / 空白 / 短串等行为断言

### 前端侧（自愈兜底）

| 文件 | 改动 |
|---|---|
| `services/agentRecovery.ts` | 新增纯函数 `settleRunningTools(msg): number` |
| `composables/useAgentStallRecovery.ts` | `settleRunningTools` 委托纯函数；`prepareAssistantForSilentContinue` 复用它；导出 |
| `composables/useAgentRun.ts` | `finishRunSession` 在 `patchAssistantMsg` **之前**调 `settleRunningTools`，并在 patch 中带上 `tools` |

前端新增测试 4 个（`agentRecovery.test.ts`）：`clears running flags without writing ok`（关键 —— 
断言 `ok === undefined`，防止退回"画红"）、`returns 0 when nothing running`、缺 `tools` 安全性、全 running 场景。

### 验证结果

| 检查 | 结果 |
|---|---|
| `cargo test agent::classifier` | **56 passed, 0 failed** |
| `cargo check` | 通过（仅既有 warning） |
| `npx vue-tsc --noEmit` | **exit 0** |
| `npx vitest run agentRecovery + agentCursorFeed` | **134 passed** |
| `agentOrchestrationGuard` | 4 passed |
| `cargo test agent::` | 506 passed / 2 failed |
| `npx vitest run`（全量） | 1186 passed / 2 failed |

**关于 4 个失败：全部为改动前既有（已用 `git stash` 对照验证）**

- `agent::tool_exec::tests::server_mode_blocks_shell_chaining` —— `git config user.email a@b.c` 未被拦截规则覆盖；baseline 同样失败；在 `tool_exec.rs`（本次未改）
- `agent::agent_regression::tests::agent_regression_vectors_from_file` —— baseline 同样失败
- `src/services/agentRegression.test.ts` / `server/agentRegression.test.ts` —— 同源向量，baseline 同样失败

对照数据（Rust）：改动前 490 passed / 同 2 个 failed；改动后 506 passed / 同 2 个 failed → **零回归**。

### 未做

- 未改 `server/` 下的同名实现（AGENTS.md：行为真相源只在 Rust）
- 未重启 `npm run dev:web` 做端到端复现（需用户确认）；建议复现路径：
  让 Agent 执行一条输出含中文且超过 60 字节的命令（如 `git log --oneline -12`），
  确认卡片能正常收尾、不再出现秒数无限累加

---



## 一、证据链（代码级，全部已 read 验证）

### 1. Rust 侧：30s 是硬上限，超时也一定会发 tool_end

`src-tauri/src/agent/tool_exec.rs:870-875`

```rust
let timeout_ms = args.get("timeout_ms").and_then(|v| v.as_u64())
    .unwrap_or(30000).min(120000).max(5000);   // 默认 30s，最长 120s
```

超时分支 `tool_exec.rs:945-957` —— kill 进程树后返回 `(false, "错误：命令超时（30000ms）")`，
**这是一个正常返回值，仍走 emit 路径**。

`src-tauri/src/agent/run.rs:1124-1141` 是唯一的 `tool_end` emit 点：

```rust
let summary = if ok { tool_summary(name, &result) }
              else if result.contains("命令超时") { "超时".to_string() }
              else { "failed".to_string() };
emit(&channel, json!({ "type": "tool_end", "data": { ... } }));
```

**推论：只要 Rust 进程活着，`run_command` 最多 120s 必有 `tool_end`。575s 说明 emit 没发生或没送达。**

### 2. Rust 侧：取消检查在批次外层，中途取消会吞掉整批 tool_end

`src-tauri/src/agent/run.rs:929-937`

```rust
for (parallel_batch, indices) in batches {
    if is_cancelled(&cancel) {
        checkpoint.finish_aborted(&run_state.written_files, turns).await;
        emit_aborted_done(&channel, &run_state.written_files, turns);
        return Ok(());            // ← 直接返回，本批 tool_end 全部不发
    }
    for &index in &indices { emit(..."tool_start"...); }   // run.rs:939-948
    ...
}
```

注意时序：**`tool_start` 在进入批次后才发**（run.rs:939-948）。
所以取消发生在批次执行中时，已发的 `tool_start` 不会有配对的 `tool_end`。

### 3. 前端侧：`running: true` 只在 tool_start 时置位

`src/composables/useAgentEventHandlers.ts:514-522`

```ts
const toolStep = { id, ...meta, args, summary: "", running: true, turn, startTs: Date.now() };
```

### 4. 前端侧（**根因**）：run 收尾时不清 `tools[].running`

`src/composables/useAgentRun.ts:355-383` `finishRunSession`：

```ts
function finishRunSession(sessionId: string, silent = false) {
  const run = runManager.get(sessionId);
  if (run?.assistantMsg.role === "assistant") {
    applyInferredAgentRecovery(run.assistantMsg);      // 只设 agentFailed/recoverable
    Object.assign(run.assistantMsg, assistantTransientUiClearPatch());
    patchAssistantMsg(run.assistantMsg.id, { ... });
  }
  ...
}
```

两个被调用的函数都**不含 tools 清理**：

- `applyInferredAgentRecovery`（`src/services/agentRecovery.ts:1128-1152`）只写
  `agentFailed` / `agentRecoverable` / `agentFailureReason` / `content` / `activityExpanded`
- `assistantTransientUiClearPatch`（`src/utils/vibeHelpers.ts:56-70`）只清
  `status` / `agentPhase` / `agentDetail` / `streaming` / `agentWaitStartedAt`

**唯一会清 `tools[].running` 的地方是 `prepareAssistantForSilentContinue`**
（`src/composables/useAgentStallRecovery.ts:341-345`）：

```ts
function prepareAssistantForSilentContinue(assistantMsg: VibeChatMessage) {
  for (const tool of assistantMsg.tools || []) {
    if (tool.running) tool.running = false;
  }
}
```

而它**只在 `trySilentContinue` 成功时被调用**（stallRecovery.ts:363）。
`recoverAgentRunFromStall`（stallRecovery.ts:455-476）的逻辑是：

```ts
const silentResult = trySilentContinue(sessionId, assistantMsg, reason);
if (silentResult) { ...; return; }          // ← 只有这条路清 running
finishRunSession(sessionId);                 // ← 这条路不清 → 僵尸卡片
handleRecoverableInterruption(...);
```

**根因：只要走不到 silent continue（超次数、runtime error、无原 prompt、
configReady/projectOpened 为假等），`finishRunSession` 就留下 `running: true` 的僵尸工具行。**

### 5. 渲染侧：`running: true` 永远显示「执行中」，且计时无上限

`src/services/agentCursorFeed.ts:609-617`：

```ts
export function cursorActionClass(step: AgentRoundTool): AgentActionState {
  if (step.running) return "running";          // ← 僵尸卡片落在这里
  if (step.ok === undefined) return "unknown"; // ← 灰色 unknown 只在 running=false 时可达
  ...
}
```

`src/services/agentCursorFeed.ts:491-502` 计时标签：

```ts
const elapsedSec = Math.max(0, Math.floor((now - start) / 1000));
```

`now - start` **没有上限**，`startTs` 是前端本地时钟，后端死了照走 →
所以能显示 575s，且会一直涨下去。

### 6. 旁证：代码注释已预期「无 tool_end」但没覆盖 running 残留

`src/services/agentCursorFeed.ts:611-613`：

```ts
// tool_end 到达时必写 ok（成功/失败都写）；非 running 且 ok 缺失 = 结果未回传（如连接中断），
// 用中性 unknown 表示，不能与真实失败（ok: false）混同画红。
```

这个 `unknown` 分支设计得很对，但它有个前提：**`running` 已经被置回 false**。
而根因（第 4 点）说明这个前提在某些收尾路径上不成立 → 于是退化成永久「执行中」。

### 7. 落盘会固化僵尸状态

`src/composables/useAgentRun.ts:375` `finishRunSession` 里调 `persistAgentRunSession(sessionId)`，
**在清理 running 之前就把当前状态写盘**。所以刷新页面后卡片还在。

## 二、根因总结

| 层次 | 问题 |
|------|------|
| **主根因** | `finishRunSession` 收尾时不重置 `tools[].running`，只在 silent-continue 路径重置 |
| **触发条件** | run 中断/取消/后端失联，且不满足 silent continue 条件 |
| **放大因素** | 计时器无上限 + `cursorActionClass` 把 `running` 优先判为 running + 状态在清理前落盘 |
| **次要触发** | `run.rs:930` 取消检查在批次外层，中途取消吞掉整批 `tool_end` |

## 三、建议修法（未实施，待确认）

**最小改动**：把 `prepareAssistantForSilentContinue` 的循环提取为通用函数
（如 `settleRunningTools(assistantMsg)`），在 `finishRunSession` 里也调一次 —— 
置 `running = false` 且**不写 `ok`**，这样渲染层自动走已有的 `unknown` 中性分支，
语义完全正确（「结果未回传」），不需要改渲染代码。

**注意**：`finishRunSession` 在 `useAgentRun.ts:1089` / `1282` 等多处也被调用，
改动要确认不破坏 `hasRecoverableAgentProgress`（`agentRecovery.ts:272-277`）的判定 ——
它特意过滤 `!t.running`，所以清理后可能**新增**可恢复判定，需回归测试。

## 四、验证步骤（pwsh 沙箱当前不可用，需人工执行）

1. 确认现象是否仍在：卡片秒数是否还在涨
2. 刷新页面，卡片是否仍显示「执行中」→ 是则第 7 点成立（已落盘）
3. 查 checkpoint：`%APPDATA%\aiall\...\checkpoints\active-<sessionId>.json` 是否残留
4. 查 debug 日志：`%APPDATA%\aiall\debug-logs\<项目名_hash>\debug.log`，
   搜 `tool_start` 之后是否有对应收尾
5. 若要在 dev 环境打点：在 `finishRunSession` 入口加一行
   `debugLog('[finish-run] tools running=' + (run?.assistantMsg.tools?.filter(t => t.running).length ?? 0))`
   → 重启 `npm run dev:web` 复现，若打印出 >0 则主根因确认

## 五、本次未能验证的部分

- ~~未读实际 `debug.log` / checkpoint 文件~~ → **已补齐**，见文首「铁证」节
- 未确认 9/25 00:37 那次 panic 具体是哪个 `run_command` 的输出（`crash.log` 只记 panic payload，
  不含命令原文）；但 `classifier.rs:70` 只在 `run_command` 分支可达，与截图工具名一致
- 未运行 `cargo test` 验证修复（本次只做定位，未改 Rust 代码）

## 六、环境备注

本次排查初期 `pwsh` 报 `SetNamedSecurityInfoW failed (Win32 5): grantWrite(D:\project\AIALL)`，
是沙箱修改工作区 ACL 被系统拒绝（`ERROR_ACCESS_DENIED`），与项目代码无关。
文件策略切到 `danger-full-access` 后恢复正常。
另：pwsh 每个进程仍会打印 `[Console]::OutputEncoding ... CannotCreateTypeConstrainedLanguage`
的 stderr 噪音（只读模式下的受约束语言限制），不影响命令结果。

