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

## 项目结构

- `src/views/VibeCodingView.vue` — AI 助手主页面（vibe coding）
- `src/views/ChatView.vue` — 聊天页面
- `src/components/vibe/GitPanel.vue` — Git 面板
- `src/components/vibe/FilePanel.vue` — 文件面板
- `src/components/vibe/EditorPanel.vue` — 编辑器
- `src/components/vibe/ChatPanel.vue` — 聊天面板
- `src/components/vibe/AppToolbar.vue` — 工具栏
- `src/components/vibe/AppToolbar.vue` — 工具栏（含项目历史下拉 `project-history-*`）
- `src/components/FileTreeNode.vue` — 文件树节点
- `src/composables/useGitPanel.ts` — Git 状态管理
- `src/composables/useEditorPanel.ts` — 编辑器状态
- `src/services/vibeCodingClient.ts` — vibe coding 客户端服务
- `src/services/vibeAgentClient.ts` — AI agent 客户端
- `src/services/vibeChatStorage.ts` — 聊天持久化
- `src/utils/renderMarkdown.ts` — Markdown 渲染
- `server/vibeAgent.ts` — AI agent 后端服务

## Agent 编排与提示词（通用性）

修改 Agent **编排 / 分类 / system prompt 分支**（如 `agentContinuation.ts`、`agentRunProfile.ts`、`vibeAgent.ts`）时：

- **禁止**把具体功能、字段名、当前用户需求写进正则或 `PLAN_SIGNAL_*`（例：不要写 `粘贴图片`、`imageDataUrl` 等业务词）
- **应使用**消息结构判断：代码块 / 明确步骤 + 目标文件路径 + 排除「是否需要我…」类征求确认
- **测试**用通用 fixture（`foo.ts`、占位变量），不要用真实需求文案绑定分类器

完整约定见 Cursor 规则：`.cursor/rules/agent-orchestration.mdc`（`alwaysApply: true`）。

## Agent 回复准确度（通用）

修改 Agent **答疑/探索/修改** 相关 system prompt（如 `agentReplyAccuracy.ts`、`vibeAgent.ts`、`agentAskPrompt.ts`）时：

- **应使用**结构契约：行为问题 trace 调用链、二元结论需完整证据、patch 后验证、多轮自洽更正
- **禁止**把具体功能名、字段名、个案 bug 边界写进全局提示

完整约定见 Cursor 规则：`.cursor/rules/agent-reply-accuracy.mdc`（`alwaysApply: true`）。

## 会话文件存储

AIALL 的 Vibe 会话文件**不在项目目录内**，存储在 AppData Roaming 下：

- 会话消息：`%APPDATA%\aiall\vibe-chat-sessions\chat-<id>.json`
- 会话索引：`%APPDATA%\aiall\vibe-chat-sessions\chat-store.json`

对于当前用户 `[REDACTED]`，完整路径为：
`C:\Users\<username>\AppData\Roaming\aiall\vibe-chat-sessions\`

**Agent 读取会话文件**：`read_file` / `list_dir` 支持读本机任意路径（绝对路径），也识别逻辑前缀 `aiall/vibe-chat-sessions/`（自动映射到上述 AppData 目录）。大 JSON 请用 `offset` / `limit` 分段读。`write_file` / `patch_file` / `delete_file` 仍仅限项目内相对路径。

## 开发约定

- **禁止** 在代码中添加 `console.log` 用于调试
- **应使用** 写入临时文件的日志：追加到 `.debug.log`（项目根目录），调试完成后删除该文件

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
