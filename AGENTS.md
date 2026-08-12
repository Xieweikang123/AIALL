# 产品北极星（最核心）

AIALL 要做 **Cursor 类通用编程助手**：会查仓库、会改、会验——不是堆个案修法口令的专用脚本。

**能力来自：上下文检索 + 工具闭环 + 模型泛化。不来自：Prompt 里教模型怎么修某一类 Bug。**

| 应投入 | 禁止当作核心 |
|--------|--------------|
| 索引/项目事实进上下文 | always-on 个案 playbook（命中 X → grep Y → patch Z） |
| 改 → 验证 → 复现闭环 | 把某次 UI/业务 bug 写死成固定符号与修法 |
| 流式 / 中断 / 续跑 / diff | 护栏文案直接下令「请 patch 某某」 |
| 桌面 FS/Git 单一真相源 | 再分叉一套 Node 行为实现 |

护栏可以留「别乱搜」；永远别写死「该 patch 哪」。完整条文（含新增编排三问）见 [`.cursor/rules/product-north-star.mdc`](.cursor/rules/product-north-star.mdc)（`alwaysApply`）。编排分层细则见 `agent-orchestration.mdc`。

# 项目术语约定

当用户提到以下术语时，请理解为对应的模块/文件：

| 用户说 | 实际指 |
|--------|--------|
| AI 助手 | `src/views/VibeCodingView.vue` 及相关 vibe coding 模块 |
| vibe coding | `src/views/VibeCodingView.vue` 页面 |
| 聊天页面 | `src/views/ChatView.vue` |
| Git 面板 | `src/components/vibe/GitPanel.vue` |
| 文件面板 | `src/components/vibe/FilePanel.vue` |
| 编辑器 | `src/components/vibe/EditorPanel.vue` |
| 聊天面板 | `src/components/vibe/ChatPanel.vue` |
| 文件树 | `src/components/FileTreeNode.vue` |
| 工具栏 | `src/components/vibe/AppToolbar.vue` |
| 项目切换栏 | `src/components/vibe/AppToolbar.vue`（`project-history-*` 下拉） |
| 架构图 / Code to Map | `src/components/vibe/CodeMapMainPanel.vue` + `ProjectCodeMapPanel.vue`（项目面板 `map`） |

## 项目结构

- `src/views/VibeCodingView.vue` — AI 助手主页面（vibe coding）：项目内 Agent、文件/Git/编辑器/聊天面板
- `src/views/ChatView.vue` — 独立对话页：URL 抓取总结、图标模板驱动的桌面自动化（如「打开某应用」）
- `src/views/IconTemplatesView.vue` — 图标模板库：屏幕截图模板，供 Chat 页在主显示器画面内匹配点击
- `src/views/AiConfigView.vue` — AI 模型与 API 配置
- `src/components/vibe/GitPanel.vue` — Git 面板
- `src/components/vibe/FilePanel.vue` — 文件面板
- `src/components/vibe/EditorPanel.vue` — 编辑器
- `src/components/vibe/ChatPanel.vue` — 聊天面板
- `src/components/vibe/AppToolbar.vue` — 工具栏（含项目历史下拉 `project-history-*`）
- `src/components/FileTreeNode.vue` — 文件树节点
- `src/composables/useGitPanel.ts` — Git 状态管理
- `src/composables/useEditorPanel.ts` — 编辑器状态
- `src/services/vibeCodingClient.ts` — vibe coding 客户端服务
- `src/services/vibeGitClient.ts` — Git 客户端（Tauri invoke → `src-tauri/src/git/`）
- `src/services/vibeAgentClient.ts` — AI agent 客户端
- `src/services/vibeChatStorage.ts` — 聊天持久化
- `src/utils/renderMarkdown.ts` — Markdown 渲染
- `src-tauri/src/agent/` — 桌面 Agent 运行时（行为真相源）

## 产品入口（顶层路由）

| 路由 | 用途 |
|------|------|
| `/vibe-coding` | 主 IDE：打开项目后的 Agent、文件树、Git、Monaco 编辑器、会话聊天 |
| `/chat` | 通用对话：网页 URL 总结、结合图标模板的桌面 UI 自动化 |
| `/icon-templates` | 录入任务栏/桌面截图模板，供 Chat 自动化匹配点击 |
| `/ai-config` | 配置 API Key、模型、网页抓取代理等 |

## 开发与运行

| 命令 | 用途 |
|------|------|
| `npm run dev` | **默认**：Tauri 桌面版（Agent / Git / FS 全走 Rust） |
| `npm run tauri:build` | 打包桌面应用 |
| `npm run dev:web` | 浏览器 UI 预览（Agent/Git/FS 不可用，提示使用桌面版） |
| `npm test` | Vitest：契约 / 编排 / shared |
| `npx vitest run <文件>` | 跑单个测试文件（覆盖 `src/**`、`server/**`、`shared/**`） |
| `npm run test:rust-agent` | Rust Agent parity 单测（等价 `cargo test agent:: --quiet`，在 `src-tauri/`） |
| `npm run agent:test-guards` | 完整防线：Rust parity + 编排 guard + 机制回归 |
| `npm run agent:regression` | 先 Rust 回归向量，再 TS 分类器 / 报告 |
| `npm run agent:smoke` | 无头桌面 Agent（`cargo run --bin agent-smoke` → `agent_run_headless`） |
| `npm run lint` / `npm run typecheck` | 均为 `vue-tsc --noEmit`（无 ESLint） |

`agent:smoke` 走 Rust 桌面 Agent，需要环境变量：`AIALL_ENDPOINT`、`AIALL_API_KEY`、`AIALL_MODEL`，可选 `AIALL_PROJECT`、`AIALL_TIMEOUT_MS`。

Sidecar 已按策略 B 删除，见 [`SIDECAR_DELETION.md`](SIDECAR_DELETION.md)。桌面功能以 `src-tauri/` 为准；`server/` 仅 Vitest 契约 / parity（非 HTTP）。SSOT 见 [`AGENT_SSOT.md`](AGENT_SSOT.md)：Rust 跑行为、TS 测契约、shared 钉常量。

## Agent 编排分层

编排代码分三层，修改前先确认自己动的是哪一层：

| 层级 | 目录/文件 | 允许写什么 |
|------|-----------|------------|
| **通用分类器** | `src/orchestration/generic/`、`agentContinuation.ts`、`agentStructuralPatterns.ts`、`agentRunPolicy.ts` 等 | 仅消息**形态**（代码块、步骤结构、路径、句型）；禁止业务名词与静态个案修复话术 |
| **通用机制** | `agentReplyAccuracy.ts`、`agentConsultativeTopics.ts`、`agentExplorationBudget.ts` 等 | 准确度/trace 契约；同分类器 guard |
| **产品编排** | `src/orchestration/product/`（`userIntentHints.ts`、`visionMessage.ts`、`agentAskPrompt.ts`、`agentExplorePrompt.ts`、`agentPlanPrompt.ts`、`agentTopicFollowUp.ts`） | AIALL 模式（Ask/Build/Plan）、截图读图、会话审计；**可以**写产品语义，但仍禁止 `FilePanel` 等内部组件名 |

路径清单见 `src/orchestration/orchestrationTiers.ts`；`agentOrchestrationGuard.test.ts` 按层扫描。

**设计原则**：编排侧优先 **Context Retrieval + 模型泛化**，不用 Prompt Engineering 堆 Bug Playbook。always-on 只放机制契约；栈/症状相关事实走 Profile、knowledge、条件 hint 或工具校验。产品总纲见文首「产品北极星」与 `.cursor/rules/product-north-star.mdc`；编排细则见 `.cursor/rules/agent-orchestration.mdc`「设计原则」节。

用户意图已拆分：`userIntentClassifiers.ts`（分类） vs `userIntentHints.ts`（注入 prompt 的 hint）。

## Agent 编排与提示词（通用性）

修改 **Tier 1 通用分类器**（如 `agentContinuation.ts`、`userIntentClassifiers.ts`）时：

- **禁止**把具体功能、字段名、当前用户需求写进正则或 `PLAN_SIGNAL_*`（例：不要写 `粘贴图片`、`imageDataUrl` 等业务词）
- **应使用**消息结构判断：代码块 / 明确步骤 + 目标文件路径 + 排除「是否需要我…」类征求确认
- **测试**用通用 fixture（`foo.ts`、占位变量），不要用真实需求文案绑定分类器

**Tier 3 产品编排**（截图流程、模式说明）允许产品语义；个案修复应走动态 `build*Hint`，勿写进全局 system prompt。

完整约定见 Cursor 规则：`.cursor/rules/agent-orchestration.mdc`（`alwaysApply: true`）。

## Agent 回复准确度（通用）

修改 Agent **答疑/探索/修改** 相关 system prompt（如 `agentReplyAccuracy.ts`、`agentAskPrompt.ts`、`agentExplorePrompt.ts`）时：

- **应使用**结构契约：行为问题 trace 调用链、二元结论需完整证据、patch 后验证、多轮自洽更正
- **禁止**把具体功能名、字段名、个案 bug 边界写进全局提示

完整约定见 Cursor 规则：`.cursor/rules/agent-reply-accuracy.mdc`（`alwaysApply: true`）。

## 会话文件存储

AIALL 的 Vibe 会话文件**不在项目目录内**，存储在 AppData Roaming 下：

- 会话消息：`%APPDATA%\aiall\vibe-chat-sessions\chat-<id>.json`
- 会话索引：`%APPDATA%\aiall\vibe-chat-sessions\chat-store.json`
- 调试日志：`%APPDATA%\aiall\debug-logs\`（打开项目时为 `debug-logs\<项目名_hash>\`，如 `debug.log`、`tab-perf.log`）

**Agent 读取会话文件**：会话文件（`chat-*.json`）**不允许**通过 `read_file` / `list_dir` 直接读取（`resolve_readable_path` 已拦截 `aiall/vibe-chat-sessions/` 前缀）。跨会话回忆请使用 **`search_sessions`** 工具：按关键词搜索所有历史会话，返回清洗过的片段与来源会话 id。`write_file` / `patch_file` / `delete_file` 仍仅限项目内相对路径。

## 开发约定

- **禁止** 在代码中添加 `console.log` 用于调试
- **应使用** 写入临时文件的日志（勿写进用户项目根目录）：
  - 桌面版（Tauri）：`%APPDATA%\aiall\debug-logs\`（有打开项目时为 `debug-logs\<项目名_hash>\`），如 `debug.log`、`tab-perf.log`
  - Node/Vitest 参考实现：仓库内 `.debug/debug.log`（已在 `.gitignore`）
  - 调试完成后可删除对应日志文件
- **`.aiall/`（项目根目录，已 gitignore）**：Agent 的项目状态目录——`project-memory.md`、`project-knowledge.md`、`skills/`、`plans/`、`exploration/`、`probe/`、`memory/`（条目式长期记忆）。Git 面板禁止 stage `.aiall/` 路径；Agent 写工具（`write_file`/`patch_file`）禁止写 `.aiall/exploration/` 与 `.aiall/memory/`（长期记忆只能走 `memory_write` 工具，唯一入口）
- **Rust 行为改动**：改 `src-tauri/` 后必须 `cargo check` 通过；行为真相源见 `AGENT_SSOT.md`（改行为只改 Rust，禁止在 `server/` 重写同名实现）

## Rust 化迁移

迁移规划记录在 `RUST_MIGRATION.md`，所有 AI 实例在开始迁移前必须先查阅该文档：
1. 找到待迁移模块，将状态改为 `[~]`，责任人写自己的 ID
2. 完成迁移后改为 `[x]`，清除责任人
3. 同一函数不允许两个 AI 同时修改

## 事实核查

- 涉及代码实现的断言，必须先 read/grep 验证，禁止凭印象作答
- 不确定时明确说"不确定"，不要用肯定语气包装猜测

## 事件竞态调试准则

处理 DOM 事件竞态（mousedown/mouseup/selectionchange 等）时：

- **先穷举事件时序**再动手改——画出所有场景下各事件的先后顺序和此时 UI 状态
- **区分症状与根因**——"按钮不消失"和"按钮不出现"可能是同一竞态的两面，修一个时要验证另一个方向
- **不要信任事件读到的"当前状态"**——mouseup 时 `getSelection()` 返回的不是 mouseup 造成的选区，而是 mouseup **之前**的残留；遇到"状态不对"先查这个值是谁、什么时候写入的
- **抑制机制要精准**——用时间戳（自包含）优于状态标记（易漏清）；压制范围越窄副作用越少（如区分 `event.detail` 单击/多击）
- **先测 edge case**——triple-click、快速拖拽等非常规操作是第一个要验证的，修交互 bug 时把所有触发路径过一遍再提交

## Markdown 显示问题排障准则

处理"某段 markdown 渲染错乱"（字面 `---`、代码块裂开、灰框等）时：

- **先确认显示面**——同一消息有多条渲染链路：主气泡（`renderMarkdown`/`ChatMarkdown`）与过程 feed（`agentNarrativeSegments` → `agentCursorFeed` 的叙事项）。改一个面不代表全好，先定位用户看到的是哪个面
- **显示源 ≠ 存储源**——`msg.content` 只是其中一份源；roundGroups 分段、live 预览、merge 拼接都会生成**派生文本**，坏源常在这些派生路径上。验证前先确认实际渲染的是哪份
- **日志优先，别反复推理**——拿干净存储内容验证会一直"假通过"。先给真实 App 加"渲染源快照"日志（dump 实际喂给渲染器的源与结果 HTML），一次定位，而不是归因到流式瞬态/旧构建
- **标记粘接是拼接层问题**——`mergeShortNarrativeSegments` 用空格拼短段、`joinFinalStages` 用 `---` 连接、SSE 拼 delta 等 join/merge/slice 逻辑最易把 markdown 标记粘进正文；这种坏源改渲染器永远治不好，只能去上游拼它的地方修
- **技术坑备忘**：闭合围栏不允许带 info string（` ``` --- ` 会被 marked 当块内内容吞掉）；`--`（2 个横线）既非 HR 也不被 strip 清理会字面显示；流式给未闭合围栏补假闭合会产生空灰框，开头围栏先到时应扣住不渲染；行内列表拆分等启发式必须 fence 感知，否则误拆代码注释（`// 1. 引入`）
- **工具层**：模型把 search query 当文件路径传（`read_file mixin.js`）是常见行为，工具层做 basename 唯一消歧比改提示词可靠

## UI 状态不更新排障准则

处理"状态变了但界面不更新"（高亮/选中/显隐不对）时：

- **先区分"值没变"还是"变了没渲染"**——状态层单测通过 ≠ 模板正确；composable 单测覆盖不到 `v-memo`、`key` 复用、`Teleport`、`transition`、`v-html` 等模板/渲染层行为，逻辑正确也要怀疑渲染缓存
- **高亮/选中类问题优先怀疑渲染缓存**——`v-memo` 依赖数组只含布尔比较结果，跳过后 props 不更新会残留旧状态；递归组件（如 `FileTreeNode`）加 `v-memo` 时要格外小心
- **排查卡住 ≥2 轮时，先做可逆最小改动验证**（删 `v-memo`、加 `data-path` 定位、加"渲染源快照"日志），用结果快速排除假设，不要继续加深静态分析
- **听用户的现象信号**——"新文件没高亮 + 旧文件残留"这类描述直接指向渲染层（值是新的、UI 没跟上），别绕回状态写入链
- **修完反向验证**——修"不更新"时也要确认"能正常更新"的路径没被破坏（如点已打开文件、切回同一文件）

## 文件膨胀约束

`src/composables/useAgentRun.ts` 已拆出 `useAgentChainScroll.ts`、`useAgentStreamPatch.ts`、`useAgentEventHandlers.ts`、`useAgentSSEConnection.ts` 等子 composable，主文件负责 Agent 运行编排并委托分发。

- **新增 SSE 事件 handler**：一律加入 `useAgentEventHandlers.ts` 中 `handleAgentEvent` 的 `agentEventHandlers` 分发表（Map），handler 实现为独立函数；禁止往 `handleAgentEvent` 主体内塞 if-else 分支
- **新增流式/UI patch/滚动逻辑**：进对应的子 composable（`useAgentStreamPatch` / `useAgentChainScroll`），禁止内联回 `useAgentRun.ts`
- **新增 stall/resume/autoResume 逻辑**：可与现有 `recoverAgentRunFromStall`、`trySilentContinue` 等 同处 `useAgentRun.ts`，但若该职责簇再增长，应抽新子 composable 而非继续堆叠
- **修改前先确认层级**：纯展示/节流逻辑 → 子 composable；有状态编排（依赖 `runManager` + `assistantMsg` 双向变更）→ 主文件
