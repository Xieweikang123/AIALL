import { reactive } from "vue";
import type { AgentRoundGroupView } from "./agentRoundGroups";

interface AgentTraceDrawerState {
  open: boolean;
  messageId: string | null;
  title: string;
  roundGroups: AgentRoundGroupView[];
}

const state = reactive<AgentTraceDrawerState>({
  open: false,
  messageId: null,
  title: "数据流轨迹",
  roundGroups: [],
});

let latest: { messageId: string; roundGroups: AgentRoundGroupView[] } | null = null;

/** 每条 Agent 消息渲染时注册自己的轨迹，最后注册的视为最新一条 */
export function registerLatestTrace(messageId: string, roundGroups: AgentRoundGroupView[]): void {
  if (!roundGroups.length) return;
  latest = { messageId, roundGroups };
}

/** 消息内入口按钮点击：打开抽屉并载入该条消息的轨迹 */
export function openTraceDrawer(
  messageId: string | null,
  roundGroups: AgentRoundGroupView[],
  title?: string,
): void {
  state.open = true;
  state.messageId = messageId;
  state.title = title ?? "数据流轨迹";
  state.roundGroups = roundGroups;
}

/** 调试按钮点击：优先展示最新一条消息的轨迹；无数据时显示空态 */
export function openLatestTraceDrawer(): void {
  if (latest) {
    openTraceDrawer(latest.messageId || null, latest.roundGroups);
    return;
  }
  state.open = true;
  state.messageId = null;
  state.title = "数据流轨迹";
  state.roundGroups = [];
}

export function closeTraceDrawer(): void {
  state.open = false;
}

export function useAgentTraceDrawerState(): AgentTraceDrawerState {
  return state;
}