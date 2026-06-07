# 项目术语约定

当用户提到以下术语时，请理解为对应的模块/文件：

| 用户说 | 实际指 |
|--------|--------|
| AI 助手 | `src/views/VibeCodingView.vue` 及相关 vibe coding 模块 |
| vibe coding | `src/views/VibeCodingView.vue` 页面 |
| 聊天页面 | `src/views/ChatView.vue` |

## 项目结构

- `src/views/VibeCodingView.vue` — AI 助手主页面（vibe coding）
- `src/services/vibeCodingClient.ts` — vibe coding 客户端服务
- `src/services/vibeAgentClient.ts` — AI agent 客户端
- `server/vibeAgent.ts` — AI agent 后端服务

## Agent 编排与提示词（通用性）

修改 Agent **编排 / 分类 / system prompt 分支**（如 `agentContinuation.ts`、`agentRunProfile.ts`、`vibeAgent.ts`）时：

- **禁止**把具体功能、字段名、当前用户需求写进正则或 `PLAN_SIGNAL_*`（例：不要写 `粘贴图片`、`imageDataUrl` 等业务词）
- **应使用**消息结构判断：代码块 / 明确步骤 + 目标文件路径 + 排除「是否需要我…」类征求确认
- **测试**用通用 fixture（`foo.ts`、占位变量），不要用真实需求文案绑定分类器

完整约定见 Cursor 规则：`.cursor/rules/agent-orchestration.mdc`（`alwaysApply: true`）。
