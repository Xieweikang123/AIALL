/**
 * AI 回复里的「可点选项」什么时候允许点。
 *
 * 选项有两个来源，渲染位置也不同：
 *   - 结构化 `suggestedOptions`（模型尾部 `<ai_options>` 字段给的）→ 渲染在消息气泡
 *     外、`VibeChatMessages.vue` 的独立按钮行；
 *   - 正文里的编号列表（`parseAiOptions` 正则）→ 渲染在正文自己的 `ChatMarkdown` 里。
 * 两条路的可点判定必须一致，否则同一屏里会出现"一半能点一半不能点"。
 *
 * 历史形态（别改回去）：`m.id !== lastAgentMessageId` —— 只有列表里最后一条 Agent
 * 消息的选项能点，更早的一律置灰。它当初是为"跑的时候点不动"加的，但把两件不同的事
 * 混成了一条：
 *   1. **有轮次在跑时别点** —— 点了会打断正在跑的那一轮，这个要留；
 *   2. **只有最新那条消息能点** —— 用户翻回旧回复、想选旧回复里的选项，照样被拒。
 *      实测被投诉的就是这条：明明是刚读完的那一轮，选项却是灰的。
 * 第 2 条是误伤：旧消息里的选项同样是有效选项，点了就是接着聊。
 *
 * 所以现在只保留第 1 条：**任何时刻有轮次在跑就禁用，其余一律可点**。
 */
export function isAgentOptionSelectable(input: {
  /** 这条消息自己是否在跑（自己跑的轮次，其选项在模板层已被 v-if 挡掉，这里兜底） */
  messageRunning?: boolean;
  /** 当前是否有任何轮次在跑（含别的消息） */
  sending?: boolean;
}): boolean {
  return !input.messageRunning && !input.sending;
}
