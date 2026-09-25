import { reactive } from "vue";

/**
 * 思考全文抽屉（只读展示面）。
 *
 * 现有聊天气泡里的「思考中…」仍按原样裁成一行 —— 本模块不参与那条渲染链路，
 * 只是把 Agent 产出的 reasoning 全文额外登记一份，供右侧抽屉单独查看。
 */

export interface ReasoningDrawerEntry {
  /** reasoning item 的 key（同一段推理稳定不变） */
  key: string;
  /** 所属消息 id，用于区分不同轮次 */
  messageId: string | null;
  /** 该段推理的完整文本 */
  text: string;
  /** 是否仍在产出中（决定抽屉里的流光/吸底） */
  active: boolean;
  /** 最后更新时间戳，用于「最新一段」排序 */
  updatedAt: number;
}

interface ReasoningDrawerState {
  /** 面板是否可见（自动跟随 Agent 思考，也可手动开关） */
  open: boolean;
  /** 用户显式关掉了自动弹出 —— 关掉后只有手动点按钮才会开 */
  autoEnabled: boolean;
  /** 用户手动锁定了展开（点按钮打开），此时不会被「思考结束」自动收起 */
  pinned: boolean;
  /** 打开时锁定的那一段；运行中会被最新活跃段自动接管 */
  key: string | null;
  /** 是否自动吸底跟随最新内容（用户手动上滚后置 false） */
  follow: boolean;
}

const state = reactive<ReasoningDrawerState>({
  open: false,
  autoEnabled: true,
  pinned: false,
  key: null,
  follow: true,
});

/** 所有已登记过的推理段，按 key 索引（历史消息也会登记，供回看） */
const entries = reactive<Map<string, ReasoningDrawerEntry>>(new Map());

/** 最近一次登记的 key —— 抽屉没有锁定时默认展示它 */
let latestKey: string | null = null;

function composeEntryKey(messageId: string | null, key: string): string {
  return `${messageId ?? ""}::${key}`;
}

/**
 * 每条 Agent 消息渲染 reasoning 时登记全文。
 * 只登记不渲染 —— 不改动消息内既有的一行折叠表现。
 */
export function registerReasoningEntry(input: {
  messageId: string | null;
  key: string;
  text: string;
  active: boolean;
}): void {
  const composed = composeEntryKey(input.messageId, input.key);
  const prev = entries.get(composed);
  const text = input.text ?? "";
  if (prev && prev.text === text && prev.active === input.active) return;

  entries.set(composed, {
    key: composed,
    messageId: input.messageId,
    text,
    active: input.active,
    updatedAt: Date.now(),
  });
  latestKey = composed;

  if (input.active) {
    // 正在思考 → 自动滑出，并锁定为当前展示的那一段。
    // 不重置 follow：用户上滚暂停跟随后，内容继续增长不应把视角强拉回底部。
    if (state.autoEnabled && !state.pinned) {
      if (!state.open) state.follow = true;
      state.open = true;
      state.key = composed;
    }
    return;
  }

  // 思考结束：自动模式且非手动锁定时收起（手动点开的保持开着，等用户自己关）。
  maybeAutoClose();
}

/** 思考段结束后是否该自动收起 —— 手动锁定的不参与 */
function maybeAutoClose(): void {
  if (!state.autoEnabled || state.pinned) return;
  const current = state.key ? entries.get(state.key) : null;
  if (current && current.active) return;
  state.open = false;
}

/** 消息内/工具栏入口：打开面板看某一段思考全文（手动打开 = 锁定，不自动收） */
export function openReasoningDrawer(key?: string | null): void {
  state.open = true;
  state.pinned = true;
  state.follow = true;
  if (key) {
    state.key = composeEntryKey(null, key);
    return;
  }
  state.key = resolveLatestEntry()?.key ?? null;
}

/** 工具栏入口：优先展示正在产出的那一段，没有则取最后一段 */
export function openLatestReasoningDrawer(): void {
  state.open = true;
  state.pinned = true;
  state.follow = true;
  state.key = resolveLatestEntry()?.key ?? null;
}

export function closeReasoningDrawer(): void {
  state.open = false;
  // 手动关闭 = 取消锁定；若仍在思考，下次 reasoning 更新会自动再开。
  state.pinned = false;
}

/** 显式开关「自动弹出」；关掉时立刻收起面板 */
export function setReasoningAutoEnabled(enabled: boolean): void {
  state.autoEnabled = enabled;
  if (enabled) return;
  if (state.pinned) return;
  state.open = false;
}

/** 用户在面板里手动上滚 → 暂停吸底；回到底部再恢复 */
export function setReasoningDrawerFollow(follow: boolean): void {
  state.follow = follow;
}

function resolveLatestEntry(): ReasoningDrawerEntry | null {
  if (latestKey) {
    const found = entries.get(latestKey);
    if (found) return found;
  }
  let newest: ReasoningDrawerEntry | null = null;
  for (const entry of entries.values()) {
    if (!newest || entry.updatedAt >= newest.updatedAt) newest = entry;
  }
  return newest;
}

/** 当前应展示的推理段 */
export function resolveReasoningDrawerEntry(): ReasoningDrawerEntry | null {
  if (state.key) {
    const found = entries.get(state.key);
    if (found) return found;
  }
  return resolveLatestEntry();
}

/** 全部登记过的推理段，按更新时间升序 —— 供抽屉里的「上一段/下一段」导航 */
export function listReasoningEntries(): ReasoningDrawerEntry[] {
  return [...entries.values()].sort((a, b) => a.updatedAt - b.updatedAt);
}

export function useReasoningDrawerState(): ReasoningDrawerState {
  return state;
}

/** 仅测试用：清空登记（生产代码不调用） */
export function __resetReasoningDrawerForTest(): void {
  entries.clear();
  latestKey = null;
  state.open = false;
  state.autoEnabled = true;
  state.pinned = false;
  state.key = null;
  state.follow = true;
}
