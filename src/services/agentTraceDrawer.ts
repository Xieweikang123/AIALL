import { reactive } from "vue";
import { lsGet, lsRemove, lsSet } from "../utils/localStorageSafe";
import type { AgentRoundGroup, AgentRoundGroupView, AgentRoundTool } from "./agentRoundGroups";
import {
  createDefaultAgentTraceView,
  normalizeAgentTraceView,
  type AgentTraceViewConfig,
} from "./agentTraceView";

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

/**
 * 轨迹目标的**会话作用域键**。
 *
 * 消息 id 只在所属会话内唯一，而轨迹抽屉是**全应用单例**（模块级 `state`）。
 * 两个会话同时跑时，若只记 `messageId`，切换会话会让解析函数在"当前会话"的
 * 消息数组里查另一个会话的 id —— 查不到就回退到 `latestMessageId`，而那个全局
 * 值被两个会话轮流覆盖，于是面板内容反复横跳（表现为闪烁）。
 *
 * 所以目标必须带上会话维度：`{ sessionId, messageId }` 一起比对、一起跟随。
 * 空字符串表示"未知会话"（测试/未注入场景），此时退回旧的全局语义。
 */
function traceScopeKey(sessionId: string | null | undefined): string {
  return (sessionId ?? "").trim();
}

interface AgentTraceDrawerState {
  open: boolean;
  messageId: string | null;
  /**
   * `messageId` 所属的会话 id。
   *
   * 与 `messageId` 同时读写：解析时若"当前激活会话"与它不一致，说明面板还停在
   * 另一个会话的轨迹上 —— 这时**不**做跨会话回退，直接按会话查注册表，
   * 避免两个会话互相抢锁造成闪烁。
   */
  messageSessionId: string | null;
  /**
   * 用户点消息内「数据流轨迹」入口**显式锁定**的 id。
   *
   * 与 `messageId` 的区别是「锁的来源」：自动弹出锁的会跟着新轮次走，用户点的不会。
   * 抽屉跑完一轮**不自动收起**（轨迹是运行记录，跑完最该看），所以下一轮开始时
   * 面板往往还开着 —— 这时必须把锁挪到新消息，否则面板永远停在上一轮的历史轨迹上，
   * 表现就是「新一轮跑起来了，数据流轨迹不更新」。
   */
  pinnedMessageId: string | null;
  /** 显式锁定的 id 所属会话（与 `pinnedMessageId` 配套，见 `messageSessionId` 说明）。 */
  pinnedSessionId: string | null;
  title: string;
  /**
   * 显示配置：每类条目是否默认展开（正交开关）+ 正文截断档 + 瞬态阶段噪音。
   * 默认等于旧「标准」档，升级后默认体验不变。真相源在 `agentTraceView.ts`。
   */
  view: AgentTraceViewConfig;
  /** Agent 开始产出时是否自动展开面板（工具栏「轨迹」按钮控制） */
  autoEnabled: boolean;
  /** 当前项目路径，用于导出轨迹文件 */
  projectPath: string;
  /** 当前会话 id，导出时附带会话磁盘路径 */
  sessionId: string | null;
  /**
   * 是否「因为编辑器打开而被动收起」。
   *
   * 与用户主动点关闭的区别：被动收起的，等编辑器让开之后要**自动恢复**。
   * 记这个标记而不是直接把 `open` 置 false 了事，否则用户点开一个文件就把
   * 轨迹面板永久关掉，回来还得重新找那条消息 —— 那是丢状态，不是让位。
   */
  collapsedForEditor: boolean;
  /**
   * 用户是否**主动**关掉了自动弹出的面板。
   *
   * 与 `collapsedForEditor` 相反：那是"被动让位、要恢复"，这是"我不看，别烦我"。
   * 关掉它之前必须区分开，否则用户在编辑器里关掉轨迹面板，Agent 一跑就被
   * 弹回来 —— 那是无视用户指令。用户手动点开面板（任意入口）会清除它。
   */
  userDismissedAuto: boolean;
}

/**
 * 「自动打开」偏好的持久化 key。
 *
 * 关掉自动展开是**跨会话、跨重启**都该记住的用户偏好，所以落 localStorage。
 * 读取失败 / 未设置时回默认 `true` —— 保持升级前的行为不变。
 */
const TRACE_AUTO_ENABLED_STORAGE_KEY = "vibe-coding-trace-auto-open";

/** 读取持久化的「自动打开」偏好；只有明确存过 `"false"` 才算关闭，其余一律默认开启。 */
function loadTraceAutoEnabled(): boolean {
  return lsGet(TRACE_AUTO_ENABLED_STORAGE_KEY) !== "false";
}

const state = reactive<AgentTraceDrawerState>({
  open: false,
  messageId: null,
  messageSessionId: null,
  pinnedMessageId: null,
  pinnedSessionId: null,
  title: "数据流轨迹",
  view: createDefaultAgentTraceView(),
  autoEnabled: loadTraceAutoEnabled(),
  projectPath: "",
  sessionId: null,
  collapsedForEditor: false,
  userDismissedAuto: false,
});

/**
 * 主视图注入：按 messageId 取当前消息的 roundGroups（返回 live 引用，含运行中消息）。
 *
 * 第二参数 `sessionId` 是该消息所属会话；`null` 表示未知（调用方按当前会话兜底）。
 * 主视图据此去**对应会话**的消息表里查，而不是只查当前激活会话。
 */
type TraceGroupResolver = (messageId: string | null, sessionId?: string | null) => AgentRoundGroup[];

/**
 * 「这条消息是否存在」的查询 —— 与 `TraceGroupResolver` 分开，因为**空 ≠ 死**。
 *
 * 一轮刚开跑时 `notifyTraceRunStarted` 就弹了面板，那一刻这条 assistant 消息已经
 * 在消息表里、但 `roundGroups` 还是空数组（第一个 status / turn_request 事件还没到）。
 * 只凭 `resolver(id).length === 0` 判定"id 失效"，会把**正在跑的这一轮**记进失效缓存，
 * 之后即便数据长出来也永远不再查它 —— 表现就是「第一轮自动弹出的面板一直是空的」。
 *
 * 所以失效判定必须问这个函数：消息**不在表里**才算失效；在表里但没数据只是"还没产出"。
 * 未注入时返回 `null`（未知），调用方不做失效判定。
 */
type TraceMessageExistsResolver = (messageId: string, sessionId?: string | null) => boolean | null;

/** 主视图注入：按 messageId 取当前消息的工具记录，供视图层组装 AgentRoundGroupView。 */
type TraceToolsResolver = (messageId: string | null, sessionId?: string | null) => AgentRoundTool[];

let resolveGroups: TraceGroupResolver = () => [];
let resolveTools: TraceToolsResolver = () => [];
let resolveMessageExists: TraceMessageExistsResolver = () => null;
/**
 * `resolveGroups` 是否已被主视图注入。
 *
 * 用于区分「查不到数据」和「还没有数据源」：未注入时一切解析结果都不可信，
 * 不能据此判定某条消息已失效（否则会把用户正在看的轨迹踢掉）。
 */
let hasGroupResolver = false;
/**
 * 运行时注入的「整轮是否在跑」信号。返回 `null` 表示没注入/未知，
 * 调用方退回结构判断。**必须**用真实运行态：中断结束时某些轮次永远拿不到
 * `isFinal`，只看结构会让「思考中…」永久挂着。
 */
let resolveRunning: (() => boolean | null) | null = null;
/**
 * 运行时注入的「编辑器是否正占着工作区宽度」信号。
 *
 * 视图层 `noActiveEditor` 还要看 plan / git 前台态，composable 拿不到，
 * 所以判定在视图层做、结果注入进来。默认 false = 编辑器没占位。
 */
let resolveEditorTakesSpace: (() => boolean) | null = null;

/**
 * 每个会话**各自**的最新消息 id。
 *
 * 以前这里是单个全局 `latestMessageId`：两个会话同时跑时被轮流覆盖，轨迹解析
 * 跟着跳，面板就闪。按会话分桶后，"当前会话的最新一条"不再被别的会话污染。
 */
const latestMessageIdBySession = new Map<string, string>();
/** 无会话信息的注册（测试 / 未注入）落在这个桶，保持旧行为。 */
const UNSCOPED_SESSION_KEY = "";

function setLatestMessageId(sessionId: string | null | undefined, messageId: string): void {
  latestMessageIdBySession.set(traceScopeKey(sessionId), messageId);
}

function getLatestMessageId(sessionId: string | null | undefined): string | null {
  return latestMessageIdBySession.get(traceScopeKey(sessionId)) ?? null;
}

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
  hasGroupResolver = Boolean(resolver);
}

/**
 * 主视图注入「这条消息还在不在消息表里」。
 *
 * 与 `setTraceGroupResolver` 配套，但语义不同：**空数据不等于消息失效**。
 * 只有这里明确说"消息查不到"才允许判定失效并回退（见 `isLockedMessageGone`）。
 * 不注入（测试 / 未接线）或返回 `null` = 未知，此时**一律不判死**，
 * 宁可多查几次也不能把正在跑的轨迹判死 —— 那正是「第一轮面板一直空」的根因。
 *
 * ⚠️ 这是个"能判人死刑"的注入点，实现时必须对不确定的情况返回 `null`
 * 而不是 `false`（例：指定的会话消息表尚未就绪）。给错 `false` 的后果是
 * 用户正在看的轨迹被回退掉。视图层实现见 `VibeCodingView.vue`。
 */
export function setTraceMessageExistsResolver(resolver: TraceMessageExistsResolver | null): void {
  resolveMessageExists = resolver ?? (() => null);
}

export function setTraceToolsResolver(resolver: TraceToolsResolver | null): void {
  resolveTools = resolver ?? (() => []);
}

/** 主视图注入真实运行态（Agent 是否仍在跑）。 */
export function setTraceRunningResolver(resolver: (() => boolean | null) | null): void {
  resolveRunning = resolver;
}

/** 主视图注入「编辑器是否占着宽度」，供自动弹出判断是否该让位。 */
export function setTraceEditorSpaceResolver(resolver: (() => boolean) | null): void {
  resolveEditorTakesSpace = resolver;
}

/**
 * 主视图注入「当前激活会话 id」提供者。
 *
 * 供 `registerLatestTrace` 这类**渲染树深处**的调用方兜底：消息组件（`AgentMergedContent`）
 * 拿不到 sessionId，而它们渲染的都是**当前会话**的消息，所以按"当前激活会话"归属是正确的。
 * 有它能少穿 3 层 props；显式传了 sessionId 的调用方（Agent 运行期）仍以实参为准。
 */
let resolveActiveSessionId: (() => string | null) | null = null;

export function setTraceActiveSessionResolver(resolver: (() => string | null) | null): void {
  resolveActiveSessionId = resolver;
}

function currentActiveSessionId(): string | null {
  if (!resolveActiveSessionId) return null;
  try {
    return (resolveActiveSessionId() ?? "").trim() || null;
  } catch {
    return null;
  }
}

/** 编辑器当前是否占着工作区宽度；未注入按 false（不挡自动弹出）。 */
export function traceEditorTakesSpace(): boolean {
  if (!resolveEditorTakesSpace) return false;
  try {
    return resolveEditorTakesSpace();
  } catch {
    return false;
  }
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
 * 「暂无轨迹数据」，而真正的最新消息就在手边。
 *
 * 所以这里做**回退**：锁定 id 查不到时，改用同会话最新注册的消息再试一次。
 * 只有显式点击某条消息的入口才需要"锁定"语义，而回退只在锁定失效时发生，
 * 不会影响正常点击。
 *
 * ⚠️ 回退必须**限定在同一会话内**（`state.messageSessionId`）。以前回退用的是
 * 全局 `latestMessageId`，两个会话同时跑时它被轮流覆盖：切会话后锁定 id 在
 * 当前会话查不到 → 回退到"另一个会话的最新消息" → 面板显示错会话的内容，
 * 下次事件又切回来，来回横跳就是闪烁。现在按会话解析，跨会话不再串台。
 *
 * 另外这函数是 computed 求值路径，**不在这里写 state**（旧实现在这里清锁，
 * 每帧可能触发一次状态写入，进一步放大抖动）。
 *
 * ⚠️⚠️ **空数据 ≠ 失效 id**（本文件最贵的一次教训，见下方 `isLockedMessageGone`）。
 *
 * 曾经这里有个 `deadLock*` 缓存，把"已确认查不到的 id"记下来跳过后续查询（省性能）。
 * 它被**删掉**了，因为它把"暂时没数据"和"消息不存在"混为一谈，而且**一旦记错就永不
 * 回头**：面板在一轮刚开始时自动弹出，那一刻消息已在表里、`roundGroups` 还是空数组
 * （第一个 SSE 事件还没到），缓存一记，之后数据长出来也永远不再查它 ——
 * 表现就是「第一轮自动弹出，然后一直没内容」。
 *
 * 就算判定改准了，缓存仍然危险：存在性查询可能给一次**瞬时假阴性**
 * （会话消息表尚未 hydrate）→ 判死 → 缓存 → 消息其实还在，但锁再也回不来，
 * 而回退分支又排除 `fallbackId === locked`，于是 groups/tools 双双为空。
 * 也就是说缓存本身是"面板恒空"这类 bug 的最后一个温床。
 *
 * 删掉不亏：判定只是一次 `Array.some`（O(n) 且 n 是单会话消息数），
 * 而面板求值本来就被 rAF 节流；用"多查几次"换掉"一次误判就永久卡死"是划算的。
 * **别再加回来。**
 */

/**
 * 锁定的消息是否**真的不在了**（而不是"在、只是还没产出数据"）。
 *
 * 这是**实时判定**，不是缓存值 —— 每次求值都重新问，所以一次假阴性只影响一帧，
 * 下一帧消息回来就自动恢复。判定优先级：
 * 1. 未注入存在性查询（测试 / 未接线）→ 一律 `false`，不做失效判定。
 *    **保守方向必须选"别判死"**：多查几次只是性能，判错就是面板恒空。
 * 2. 注入返回 `null`（未知，如会话消息表未就绪）→ `false`，同样不判死。
 * 3. 明确返回 `false`（消息确实不在表里）→ `true`，可以回退。
 */
function isLockedMessageGone(id: string, sessionId: string | null): boolean {
  try {
    return resolveMessageExists(id, sessionId) === false;
  } catch {
    return false;
  }
}

export function resolveTraceRoundGroups(): AgentRoundGroup[] {
  const locked = state.messageId;
  if (locked) {
    const lockedSession = state.messageSessionId;
    const groups = safeResolve(resolveGroups, locked, lockedSession);
    if (groups.length) return groups;
    /**
     * 解析到 0 轮 —— 再确认一句"这条消息还在吗"：
     * 在表里（正在跑、数据还没到）就原样返回空，等下一帧数据长出来再显示；
     * 确实不在表里才走回退去找别的消息。
     */
    if (!isLockedMessageGone(locked, lockedSession)) return groups;
  }
  const { id, sessionId } = effectiveTraceMessageId();
  if (!id) return [];
  return safeResolve(resolveGroups, id, sessionId);
}

function safeResolve(
  resolver: TraceGroupResolver,
  id: string,
  sessionId: string | null,
): AgentRoundGroup[] {
  try {
    return resolver(id, sessionId) ?? [];
  } catch {
    return [];
  }
}

/**
 * 与 `resolveTraceRoundGroups` 配套的工具表。
 *
 * ⚠️ 必须用与 groups 侧**完全一致**的有效 id 算法：旧实现直接取
 * `state.messageId ?? 最新`，而 groups 侧在锁失效时会回退到最新一条 ——
 * 于是 groups 有数据、tools 却是另一个（甚至失效）id 的，步骤行缺失。
 * 这里复用 `effectiveTraceMessageId()`，两边永远同一个 id。
 */
export function resolveTraceTools(): AgentRoundTool[] {
  const { id, sessionId } = effectiveTraceMessageId();
  if (!id) return [];
  return safeResolveTools(resolveTools, id, sessionId);
}

/**
 * 当前"有效"的轨迹消息 id —— groups 与 tools 两侧共用，避免求值顺序影响结果。
 *
 * 与 `resolveTraceRoundGroups` 同一套规则：消息**确实不在了**才回退同会话最新一条。
 *
 * ⚠️ 这里**同样**必须先问"消息还在不在"再决定回退。旧实现只看
 * `safeResolve(...).length > 0`：消息在表里但这一轮还没产出数据时，会被判成回退，
 * 而回退目标 `fallbackId` 往往就是同一个 id（或为 null），于是 panels 恒空 ——
 * 与 `resolveTraceRoundGroups` 里那个（已删除的）失效缓存是同一个 bug 的两面。
 * 修一面不修另一面，会出现"某一路径有数据、另一路没有"的不一致。
 */
function effectiveTraceMessageId(): { id: string | null; sessionId: string | null } {
  const locked = state.messageId;
  const sessionId = state.messageSessionId;
  if (locked) {
    // 消息还在表里 → 就用它，哪怕此刻还没有数据（数据随后会长出来）
    if (!isLockedMessageGone(locked, sessionId)) return { id: locked, sessionId };
    // 消息确定不在了 → 才考虑回退
    const fallbackId = getLatestMessageId(sessionId);
    return { id: fallbackId && fallbackId !== locked ? fallbackId : null, sessionId };
  }
  return { id: getLatestMessageId(sessionId), sessionId };
}

function safeResolveTools(
  resolver: TraceToolsResolver,
  id: string,
  sessionId: string | null,
): AgentRoundTool[] {
  try {
    return resolver(id, sessionId) ?? [];
  } catch {
    return [];
  }
}

/**
 * 每条 Agent 消息渲染时注册自己为「本会话最新一条」，供调试入口直开抽屉。
 * 运行中也注册 —— 否则运行中打开抽屉只会看到空态。
 *
 * `sessionId` 让注册落到**所属会话**的桶里；不传（测试/未注入）落全局桶。
 * 缺了它会退回"全应用一个最新 id"，两个会话同时跑就会互相覆盖 —— 闪烁的根因。
 */
export function registerLatestTrace(
  messageId: string,
  _roundGroups: AgentRoundGroupView[],
  sessionId?: string | null,
): void {
  if (!messageId) return;
  // 未显式传会话的（渲染树深处的消息组件）按"当前激活会话"归属 —— 它们渲染的
  // 就是当前会话的消息。这样不会污染其他会话的桶。
  setLatestMessageId(sessionId ?? currentActiveSessionId(), messageId);
}

/**
 * Agent 开始跑一轮时由消息层通知：自动弹出面板（可由工具栏「轨迹」按钮关掉），
 * 并把面板跟到这一轮上。
 *
 * 与旧的思考抽屉不同，这里**不**在整轮结束时自动收起 —— 轨迹是运行过程的记录，
 * 跑完正是最该看的时候。自动弹出只负责"开始时有得看"，收起交给用户。
 *
 * ⚠️ 面板**已经开着**时也必须换锁。抽屉不自动收起 + 锁还指着上一轮那条消息 =
 * 面板永远停在上一轮的历史轨迹上（消息还在、解析得到值、不触发回退），
 * 看起来就是「新一轮跑起来了，轨迹面板不更新」。唯一例外是用户点消息内入口
 * 显式锁定的那条（`pinnedMessageId`）—— 那个不能被自动抢走。
 */
export function notifyTraceRunStarted(
  messageId: string | null,
  sessionId?: string | null,
): void {
  if (!state.autoEnabled) return;
  if (messageId) setLatestMessageId(sessionId, messageId);
  const target = messageId || getLatestMessageId(sessionId);
  if (!target) return;
  const targetSession = messageId ? traceScopeKey(sessionId) || null : state.messageSessionId;
  /**
   * 面板已开时换锁 —— 但**只在没被用户显式锁定，或锁就在这个会话里**时换。
   *
   * 两个会话同时跑时，A 的 `notifyTraceRunStarted` 不能把面板从 B 抢过来：
   * 面板此刻显示的是哪个会话由 `syncTraceScopeToActiveSession` 决定（用户在看哪个
   * 会话就看哪个），这里只负责"当前会话内跟到新一轮"。旧实现无条件抢锁，
   * 于是两个会话交替抢，面板来回跳 —— 正是闪烁。
   */
  if (state.open) {
    /**
     * 失效的**显式锁定**不该永远挡着自动跟随，但也不能凭"查不到数据"就草率作废：
     * resolver 可能只是还没注册 / 该会话的消息列表尚未载入，误判会把用户正在看的
     * 轨迹踢掉。所以只在该消息**确实不在表里**时才作废 —— 与
     * `isLockedMessageGone` 同一条规则：**空数据 ≠ 消息失效**。
     * （用户点开的那条若正在跑、只是还没产出，作废它会把面板跳到别的消息上。）
     *
     * 判定放在这里而不是 `resolveTraceRoundGroups`：这是真实的状态迁移点，
     * 而 resolve 是 computed 求值路径，不该写 state（那是闪烁的放大器之一）。
     */
    if (state.pinnedMessageId) {
      // 数据源尚未注入时不做判定 —— 查不到 ≠ 已失效。
      if (!hasGroupResolver) return;
      const pinnedAlive = !isLockedMessageGone(state.pinnedMessageId, state.pinnedSessionId);
      if (pinnedAlive) return;
      state.pinnedMessageId = null;
      state.pinnedSessionId = null;
    }
    if (state.messageSessionId && traceScopeKey(sessionId) && state.messageSessionId !== traceScopeKey(sessionId)) {
      return;
    }
    state.messageId = target;
    state.messageSessionId = targetSession;
    return;
  }
  // 用户主动关掉的：别弹回来。锁也不换，否则下一次自动弹出会跳到这一轮
  if (state.userDismissedAuto) return;
  /**
   * 编辑器正占着宽度时不弹出来抢地方，但**锁照换**。
   *
   * 只标记 `collapsedForEditor` 就够：编辑器让开时 `restoreTraceAfterEditor()`
   * 会自动打开面板，而锁已经指向这一轮 —— 恢复出来就是当前轨迹，不是旧的。
   * 若这里连锁都不换，恢复的会是上一轮，看起来就跟运行对不上。
   */
  if (traceEditorTakesSpace()) {
    state.messageId = target;
    state.messageSessionId = targetSession;
    state.collapsedForEditor = true;
    return;
  }
  state.open = true;
  state.messageId = target;
  state.messageSessionId = targetSession;
  state.title = "数据流轨迹";
}

/** 工具栏开关：关掉时立刻收起面板 */
export function setTraceAutoEnabled(enabled: boolean): void {
  state.autoEnabled = enabled;
  lsSet(TRACE_AUTO_ENABLED_STORAGE_KEY, enabled ? "true" : "false");
  if (enabled) {
    state.userDismissedAuto = false;
    return;
  }
  state.open = false;
  state.collapsedForEditor = false;
  state.userDismissedAuto = true;
}

/** 消息内入口按钮点击：打开抽屉并载入该条消息的轨迹（显式锁定，不被新一轮抢走） */
export function openTraceDrawer(
  messageId: string | null,
  _roundGroups: AgentRoundGroupView[],
  title?: string,
  sessionId?: string | null,
): void {
  state.open = true;
  state.messageId = messageId;
  state.messageSessionId = traceScopeKey(sessionId) || null;
  state.pinnedMessageId = messageId || null;
  state.pinnedSessionId = state.messageSessionId;
  state.title = title ?? "数据流轨迹";
  // 用户自己点开的，撤销"别再烦我"
  state.userDismissedAuto = false;
  state.collapsedForEditor = false;
}

/**
 * 调试按钮点击：优先展示**当前会话**最新一条消息的轨迹；无数据时显示空态。
 *
 * 会话由 `syncTraceScopeToActiveSession` 先行同步；未同步时退回全局桶（旧行为）。
 */
export function openLatestTraceDrawer(sessionId?: string | null): void {
  const scoped = traceScopeKey(sessionId) || state.messageSessionId || null;
  state.open = true;
  state.messageId = getLatestMessageId(scoped) ?? getLatestMessageId(UNSCOPED_SESSION_KEY);
  state.messageSessionId = state.messageId ? scoped : state.messageSessionId;
  // 「看最新」是跟随语义，不算显式锁定
  state.pinnedMessageId = null;
  state.pinnedSessionId = null;
  state.title = "数据流轨迹";
  state.userDismissedAuto = false;
  state.collapsedForEditor = false;
}

/**
 * 当前激活会话变化时由视图层调用：把轨迹锁**切到新会话**。
 *
 * 这是修复"两个会话同时跑 → 轨迹闪烁"的关键一步。抽屉是全应用单例，锁必须跟着
 * 用户正在看的会话走：
 *
 * - 用户**显式锁定**了某条消息（`pinnedMessageId`）→ 不抢，保持锁定；
 * - 否则把锁移到新会话的最新一条（可能还没有 → 置空，等这一轮开始时再跟随）。
 *
 * 注意**不**触碰 `open`：切会话不该关掉面板，也不该打开面板。
 * 面板打开与否由自动弹出 / 用户操作决定。
 */
export function syncTraceScopeToActiveSession(sessionId: string | null | undefined): void {
  const next = traceScopeKey(sessionId);
  const current = traceScopeKey(state.messageSessionId);
  if (next === current) return;
  // 显式锁定的消息属于另一个会话时也不抢 —— 用户点开的就是要看的
  if (state.pinnedMessageId) return;
  state.messageSessionId = next || null;
  state.messageId = getLatestMessageId(next);
}

export function closeTraceDrawer(): void {
  state.open = false;
  // 用户主动关的 —— 这不是让位，别指望编辑器收起后自动弹回来
  state.collapsedForEditor = false;
  state.userDismissedAuto = true;
}

/**
 * 编辑器展开时调用：轨迹面板让位收起。
 *
 * 打开文件时编辑器要占走工作区一大块宽度，轨迹列（`AGENT_TRACE_PANEL_WIDTH`）
 * 再挂在那儿会把编辑器压到 `EDITOR_MIN_WIDTH` 以下，两边都难用。
 *
 * **只让位，不丢状态**：消息锁（`messageId` / `pinnedMessageId`）原样保留，
 * 记下 `collapsedForEditor` 标记，等编辑器让开时由 `restoreTraceAfterEditor()`
 * 恢复。用户主动点关闭走的是 `closeTraceDrawer()`，不会被这里自动弹回来。
 *
 * 返回是否真的执行了让位（面板本来是关着的就没有让位可言）。
 */
export function collapseTraceForEditor(): boolean {
  if (!state.open) return false;
  state.open = false;
  state.collapsedForEditor = true;
  return true;
}

/**
 * 编辑器让开时调用（编辑器收起 / 没有打开的文件）：恢复被让位收起的轨迹面板。
 *
 * 只有 `collapseTraceForEditor()` 收起的才恢复；用户自己关的不动。
 * 若让位期间用户已经用别的方式把面板打开了（工具栏按钮等），
 * 这里只清标记、不重复恢复。
 */
export function restoreTraceAfterEditor(): void {
  if (!state.collapsedForEditor) return;
  state.collapsedForEditor = false;
  if (state.open) return;
  state.open = true;
}

/** 显示配置变更：只影响构建期过滤与展开默认值，不重开面板。 */
export function setTraceView(view: AgentTraceViewConfig): void {
  state.view = normalizeAgentTraceView(view);
}

export function useAgentTraceDrawerState(): AgentTraceDrawerState {
  return state;
}

/** 仅测试用：重置模块级状态（生产代码不调用） */
export function __resetAgentTraceDrawerForTest(): void {
  state.open = false;
  state.messageId = null;
  state.messageSessionId = null;
  state.pinnedMessageId = null;
  state.pinnedSessionId = null;
  state.title = "数据流轨迹";
  state.view = createDefaultAgentTraceView();
  state.autoEnabled = true;
  lsRemove(TRACE_AUTO_ENABLED_STORAGE_KEY);
  state.projectPath = "";
  state.sessionId = null;
  state.collapsedForEditor = false;
  state.userDismissedAuto = false;
  latestMessageIdBySession.clear();
  resolveGroups = () => [];
  resolveTools = () => [];
  resolveMessageExists = () => null;
  hasGroupResolver = false;
  resolveRunning = null;
  resolveEditorTakesSpace = null;
  resolveActiveSessionId = null;
}
