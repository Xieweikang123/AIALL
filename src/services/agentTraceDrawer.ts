import { reactive } from "vue";
import type { AgentRoundGroupView } from "./agentRoundGroups";

interface AgentTraceDrawerState {
  open: boolean;
  messageId: string | null;
  title: string;
  roundGroups: AgentRoundGroupView[];
  /** 当前项目路径，用于导出轨迹文件 */
  projectPath: string;
  /** 当前会话 id，导出时附带会话磁盘路径 */
  sessionId: string | null;
}

const state = reactive<AgentTraceDrawerState>({
  open: false,
  messageId: null,
  title: "数据流轨迹",
  roundGroups: [],
  projectPath: "",
  sessionId: null,
});

let latest: { messageId: string; roundGroups: AgentRoundGroupView[] } | null = null;

/** 由主视图同步当前项目 / 会话，供导出轨迹文件使用 */
export function setTraceDumpContext(projectPath: string, sessionId: string | null): void {
  state.projectPath = projectPath.trim();
  state.sessionId = sessionId?.trim() || null;
}

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
