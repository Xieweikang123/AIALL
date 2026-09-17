import { lsGetJson, lsRemove, lsSetJson } from "./localStorageSafe";

/**
 * 会话 tab（顶部标签栏）的持久化与恢复。
 *
 * 这里承载一条硬约束，历史上一度被重构破坏并导致「刷新后 tab 丢失」复发：
 *
 *   会话索引（sessionList）还没加载完时，绝不能拿它去过滤/写回持久化记录。
 *
 * 项目切换或页面刷新时，`resetUiForProjectSwitch` 会先把 sessionList 清空，
 * 之后才由 `refreshSessionList` 重新填充。若在「空列表」这一次就把已存 tab
 * 用空集合过滤并无条件写回，存档会被当场覆盖成空数组，等索引就绪后已无从恢复。
 * 因此 `decideSessionTabsRestore` 对空 knownIds 一律返回 `next: null`（跳过），
 * 且跳过时绝不 persist。回归测试见 sessionTabs.test.ts。
 */

export const SESSION_TABS_STORAGE_PREFIX = "aiall-opened-session-tabs:";

/**
 * 存储 key。这里刻意**不**对项目路径做规范化（normalizeProjectPath），
 * 因为历史存档就是用原始 trim 后的路径写的；一旦改成规范化会读不到旧数据。
 */
export function sessionTabsStorageKey(projectPath: string): string {
  return SESSION_TABS_STORAGE_PREFIX + projectPath.trim();
}

/** 读取已存 tab；无记录、解析失败或结构不符时返回空数组。 */
export function readSessionTabs(projectPath: string): string[] {
  const path = projectPath.trim();
  if (!path) return [];
  const raw = lsGetJson<unknown>(sessionTabsStorageKey(path));
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && Boolean(x.trim()));
}

export function writeSessionTabs(projectPath: string, ids: readonly string[]): void {
  const path = projectPath.trim();
  if (!path) return;
  if (!ids.length) {
    lsRemove(sessionTabsStorageKey(path));
    return;
  }
  lsSetJson(sessionTabsStorageKey(path), ids);
}

export type SessionTabsRestoreDecision = {
  /**
   * 要赋给 UI 的 tab 列表；`null` 表示本次不恢复（会话索引尚未就绪），
   * 调用方应保持现状、且**不要**写回存储。
   */
  next: string[] | null;
  /** 是否应把 `next` 写回存储（仅当结果与已存记录不同才需要）。 */
  persist: boolean;
};

export type SessionTabsRestoreInput = {
  /** 持久化的 tab（来自 localStorage）。 */
  persisted: readonly string[];
  /** 当前内存中已打开的 tab。 */
  current: readonly string[];
  /** 当前激活会话 id。 */
  activeId: string;
  /** 本次已加载的会话 id 全集；为空 = 索引未就绪。 */
  knownIds: readonly string[];
};

function dedupe(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (!value || out.includes(value)) continue;
    out.push(value);
  }
  return out;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

/**
 * 计算会话 tab 的合并结果。
 *
 * 合并来源：持久化 tab + 当前已打开 tab + 当前激活会话（去重），
 * 再过滤掉已删除/未知会话。顺序保留「持久化在前、内存新增在后」。
 *
 * 注意：`knownIds` 为空时返回跳过，**这是刻意的**——空列表分不清是
 * 「项目确实没有会话」还是「索引还在加载」，此时销毁存档的代价远大于
 * 晚一点恢复的代价。详见文件头注释。
 */
export function decideSessionTabsRestore(
  input: SessionTabsRestoreInput,
): SessionTabsRestoreDecision {
  if (!input.knownIds.length) {
    return { next: null, persist: false };
  }

  const known = new Set(input.knownIds);
  const merged = dedupe([...input.persisted, ...input.current]);

  const active = input.activeId.trim();
  if (active && !merged.includes(active)) merged.push(active);

  const filtered = merged.filter((id) => known.has(id));
  return { next: filtered, persist: !sameOrder(filtered, input.persisted) };
}
