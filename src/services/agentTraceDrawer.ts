import { reactive } from "vue";
import type { AgentRoundGroup, AgentRoundGroupView, AgentRoundTool } from "./agentRoundGroups";
import {
  DEFAULT_AGENT_TRACE_DETAIL,
  normalizeAgentTraceDetail,
  type AgentTraceDetailLevel,
} from "./agentTraceDetail";

/**
 * 数据流轨迹抽屉（Agent 运行过程的唯一查看面）。
 *
 * 之前这里存的是 `roundGroups` 数组**引用**，而 `recordAgentRound*` 每次录制都会
 * `cloneRoundGroups` 换一个新数组（见 `agentRoundGroups.ts`），所以抽屉一旦打开就
 * 永久停在打开那一刻的快照上 —— 只能当"跑完后的验尸报告"。
 *
 * 现在只存 `messageId`，数据通过注册进来的查找函数**按 id 实时解析**当前消息的
 * roundGroups，运行中也能跟着长。服务层不认识视图层，由主视图注入查找实现。
 */

/**
 * 轨迹面板作为工作区最右一列时的目标宽度（px）。
 *
 * 两处必须同源：抽屉 CSS 用 `v-bind` 读它，`usePanelLayout.getChatPanelMaxWidth`
 * 扣掉它再算会话面板的最大宽度。两边各写一个数字会漂。
 */
export const AGENT_TRACE_PANEL_WIDTH = 420;

interface AgentTraceDrawerState {
  open: boolean;
  messageId: string | null;
  title: string;
  /** 详细度档位：简略 / 标准 / 详细 / 全量 */
  detail: AgentTraceDetailLevel;
  /** Agent 开始产出时是否自动展开面板（工具栏「轨迹」按钮控制） */
  autoEnabled: boolean;
  /** 当前项目路径，用于导出轨迹文件 */
  projectPath: string;
  /** 当前会话 id，导出时附带会话磁盘路径 */
  sessionId: string | null;
}

const state = reactive<AgentTraceDrawerState>({
  open: false,
  messageId: null,
  title: "数据流轨迹",
  detail: DEFAULT_AGENT_TRACE_DETAIL,
  autoEnabled: true,
  projectPath: "",
  sessionId: null,
});

/** 主视图注入：按 messageId 取当前消息的 roundGroups（返回 live 引用，含运行中消息）。 */
type TraceGroupResolver = (messageId: string | null) => AgentRoundGroup[];

/** 主视图注入：按 messageId 取当前消息的工具记录，供视图层组装 AgentRoundGroupView。 */
type TraceToolsResolver = (messageId: string | null) => AgentRoundTool[];

let resolveGroups: TraceGroupResolver = () => [];
let resolveTools: TraceToolsResolver = () => [];
/**
 * 运行时注入的「整轮是否在跑」信号。返回 `null` 表示没注入/未知，
 * 调用方退回结构判断。**必须**用真实运行态：中断结束时某些轮次永远拿不到
 * `isFinal`，只看结构会让「思考中…」永久挂着。
 */
let resolveRunning: (() => boolean | null) | null = null;
let latestMessageId: string | null = null;

/** 由主视图同步当前项目 / 会话，供导出轨迹文件使用 */
export function setTraceDumpContext(projectPath: string, sessionId: string | null): void {
  state.projectPath = projectPath.trim();
  state.sessionId = sessionId?.trim() || null;
}

/**
 * 主视图注入消息查找实现 —— 让抽屉能拿到实时（而非快照）的 roundGroups。
 *
 * 这两个函数会被高频调用（流式期间每帧多次），**必须只做查表**，
 * 不要在里面做 map/filter/对象展开，否则会架空面板的 rAF 节流。
 */
export function setTraceGroupResolver(resolver: TraceGroupResolver | null): void {
  resolveGroups = resolver ?? (() => []);
}

export function setTraceToolsResolver(resolver: TraceToolsResolver | null): void {
  resolveTools = resolver ?? (() => []);
}

/** 主视图注入真实运行态（Agent 是否仍在跑）。 */
export function setTraceRunningResolver(resolver: (() => boolean | null) | null): void {
  resolveRunning = resolver;
}

/** 当前是否仍在跑；`null` 表示未知，调用方自行退回结构判断。 */
export function resolveTraceRunning(): boolean | null {
  if (!resolveRunning) return null;
  try {
    return resolveRunning();
  } catch {
    return null;
  }
}

/**
 * 当前应展示的轨迹原始数据；运行中也会随消息更新。
 *
 * ⚠️ `state.messageId` 可能指向一条**已经不存在**的消息（消息被重建/会话切换后
 * id 变了）。实测踩过：抽屉死抓旧 id、解析恒为 0 轮，面板一直显示
 * 「暂无轨迹数据」，而真正的最新消息就在手边（`latestMessageId`）。
 *
 * 所以这里做**回退**：锁定 id 查不到时，改用最新注册的消息再试一次。
 * 只有显式点击某条消息的入口才需要"锁定"语义，而回退只在锁定失效时发生，
 * 不会影响正常点击。
 */
export function resolveTraceRoundGroups(): AgentRoundGroup[] {
  const locked = state.messageId;
  if (locked) {
    const groups = safeResolve(resolveGroups, locked);
    if (groups.length) return groups;
    // 锁定失效 → 回退到最新消息；同时把锁打开，避免每帧都白查一次
    state.messageId = null;
  }
  if (!latestMessageId) return [];
  return safeResolve(resolveGroups, latestMessageId);
}

function safeResolve(resolver: TraceGroupResolver, id: string): AgentRoundGroup[] {
  try {
    return resolver(id) ?? [];
  } catch {
    return [];
  }
}

/**
 * 与 `resolveTraceRoundGroups` 配套的工具表。
 *
 * 用同一个"有效 id"解析（`state.messageId` 已在 groups 侧做过失效回退，这里直接跟随），
 * 避免两个 computed 的求值顺序影响结果。
 */
export function resolveTraceTools(): AgentRoundTool[] {
  const id = state.messageId ?? latestMessageId;
  if (!id) return [];
  return safeResolveTools(resolveTools, id);
}

function safeResolveTools(resolver: TraceToolsResolver, id: string): AgentRoundTool[] {
  try {
    return resolver(id) ?? [];
  } catch {
    return [];
  }
}

/**
 * 每条 Agent 消息渲染时注册自己为「最新一条」，供调试入口直开抽屉。
 * 运行中也注册 —— 否则运行中打开抽屉只会看到空态。
 */
export function registerLatestTrace(messageId: string, _roundGroups: AgentRoundGroupView[]): void {
  latestMessageId = messageId || null;
}

/**
 * Agent 开始跑一轮时由消息层通知：自动弹出面板（可由工具栏「轨迹」按钮关掉）。
 *
 * 与旧的思考抽屉不同，这里**不**在整轮结束时自动收起 —— 轨迹是运行过程的记录，
 * 跑完正是最该看的时候。自动弹出只负责"开始时有得看"，收起交给用户。
 */
export function notifyTraceRunStarted(messageId: string | null): void {
  if (!state.autoEnabled) return;
  if (messageId) latestMessageId = messageId;
  if (state.open) return;
  state.open = true;
  state.messageId = latestMessageId;
  state.title = "数据流轨迹";
}

/** 工具栏开关：关掉时立刻收起面板 */
export function setTraceAutoEnabled(enabled: boolean): void {
  state.autoEnabled = enabled;
  if (enabled) return;
  state.open = false;
}

/** 消息内入口按钮点击：打开抽屉并载入该条消息的轨迹 */
export function openTraceDrawer(
  messageId: string | null,
  _roundGroups: AgentRoundGroupView[],
  title?: string,
): void {
  state.open = true;
  state.messageId = messageId;
  state.title = title ?? "数据流轨迹";
}

/** 调试按钮点击：优先展示最新一条消息的轨迹；无数据时显示空态 */
export function openLatestTraceDrawer(): void {
  state.open = true;
  state.messageId = latestMessageId;
  state.title = "数据流轨迹";
}

export function closeTraceDrawer(): void {
  state.open = false;
}

/** 详细度切换：只影响构建期过滤，不重开面板。 */
export function setTraceDetail(level: AgentTraceDetailLevel): void {
  state.detail = normalizeAgentTraceDetail(level);
}

export function useAgentTraceDrawerState(): AgentTraceDrawerState {
  return state;
}

/** 仅测试用：重置模块级状态（生产代码不调用） */
export function __resetAgentTraceDrawerForTest(): void {
  state.open = false;
  state.messageId = null;
  state.title = "数据流轨迹";
  state.detail = DEFAULT_AGENT_TRACE_DETAIL;
  state.autoEnabled = true;
  state.projectPath = "";
  state.sessionId = null;
  latestMessageId = null;
  resolveGroups = () => [];
  resolveTools = () => [];
  resolveRunning = null;
}
