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
| 项目切换栏 | `src/components/vibe/ProjectSwitcherBar.vue` |

## 项目结构

- `src/views/VibeCodingView.vue` — AI 助手主页面（vibe coding）
- `src/views/ChatView.vue` — 聊天页面
- `src/components/vibe/GitPanel.vue` — Git 面板
- `src/components/vibe/FilePanel.vue` — 文件面板
- `src/components/vibe/EditorPanel.vue` — 编辑器
- `src/components/vibe/ChatPanel.vue` — 聊天面板
- `src/components/vibe/AppToolbar.vue` — 工具栏
- `src/components/vibe/ProjectSwitcherBar.vue` — 项目切换栏
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

## 开发约定

- **禁止** 在代码中添加 `console.log` 用于调试
- **应使用** 写入临时文件的日志：追加到 `.debug.log`（项目根目录），调试完成后删除该文件
