/**
 * 【已废弃 / 可删除】
 *
 * 这是切 tab 卡顿的二分定位工具，定位已完成，所有引用已移除。
 *
 * 结论（证据见 `%APPDATA%\aiall\debug-logs\<项目>\tab-ablation.log`）：
 *   切到长会话（12 条消息 / 每条 8~13 个 roundGroup）时首帧 ~320ms，
 *   其中 ~95% 来自 `AgentMessage` 的过程 feed 树：
 *     - 关掉整个 AgentMessage 子树 → 7~26ms
 *     - 只把 ChatMarkdown 换成纯文本 → 仍 300ms+（不是 markdown 解析的锅）
 *     - 只渲染最后 5 条 → 90ms（与条数相关，但不是主因）
 *
 * 已据此改为「过程 feed 离屏虚拟化」，见 `src/components/vibe/DeferRender.vue`。
 *
 * 本文件没有任何 import，可安全删除（当前 shell 受沙箱限制无法直接删）。
 */

export {};
