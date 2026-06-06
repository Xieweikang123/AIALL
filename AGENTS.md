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
