import { lsRemove } from "./localStorageSafe";
import { normalizeProjectPath } from "./normalizePath";

/**
 * localStorage 总量水位 + LRU 淘汰。
 *
 * 背景：`vibe-coding-chat` 索引按项目累积，而 localStorage 只有 ~5MB 同源配额。
 * 项目开多了（每个项目还带编辑器工作区 / 会话 tab / 各种草稿），配额会被吃满，
 * 索引写入失败（见 `vibeChatStorage.writeIndex`）。
 *
 * 这里在「总量超过水位」时，按 **项目 LRU** 淘汰可重建的项目缓存，给索引腾地方。
 * 关键约束：
 * - 只碰下表 `EVICT_TIERS` 里的前缀，其余 key（会话索引、AI 配置、API Key、
 *   面板布局等）一律不碰 → 配置与真相源安全；
 * - 当前项目永不淘汰；
 * - 会话内容真相源在磁盘 `chat-*.json`，被淘汰的只是「下次打开时的还原态」，
 *   删了不丢会话。
 */

/** localStorage 同源配额约 5MB，留出安全边际。 */
export const LOCAL_STORAGE_BUDGET_BYTES = 3_500_000;

/**
 * 可淘汰前缀，按「丢了最不心疼」分两档：
 *
 * - Tier 1：纯 UI / 导航态，删除不影响任何用户输入；
 * - Tier 2：可能含用户手写内容（未落盘的编辑器草稿、Git 提交信息草稿、AI 分组草稿），
 *   仅当 Tier 1 腾不够时才动，且从最久未用的项目开始。
 *
 * 不在表内的 key 永不淘汰。会话索引 `vibe-coding-chat` 刻意不在表内。
 */
const EVICT_TIERS: readonly (readonly string[])[] = [
  [
    "vibe-coding-workspace-ui-",
    "aiall-opened-session-tabs-",
    "vibe-coding-auto-bug-fix-",
  ],
  [
    "vibe-coding-editor-workspace-",
    "vibe-coding-input-draft-",
    "vibe-coding-draft-meta-",
    "vibe-git-batch-draft-",
    "vibe-git-commit-draft-",
    "vibe-coding-git-active-repo:",
  ],
];

export type LocalStorageUsage = {
  usageBytes: number;
  keyCount: number;
  /** 占用最大的单个 key（定位「谁把配额吃满」）。 */
  maxKey?: string;
  maxKeyBytes: number;
};

export type LocalStorageReclaimResult = {
  /** false = 用量本就在水位以下，未做任何淘汰。 */
  ran: boolean;
  usageBefore: number;
  usageAfter: number;
  freedBytes: number;
  evictedKeys: string[];
  /** 被淘汰到「完全空」的项目（用于日志 / 测试断言）。 */
  evictedProjects: string[];
};

let activeProjectKey = "";

/** 记录当前项目，淘汰时永远跳过它（索引写失败的重试路径也会用到）。 */
export function setActiveProjectForBudget(projectPath: string): void {
  activeProjectKey = normalizeProjectPath(projectPath);
}

/** 汇总 localStorage 用量与最大 key；localStorage 不可用时返回全 0。 */
export function estimateLocalStorageUsage(): LocalStorageUsage {
  let usageBytes = 0;
  let keyCount = 0;
  let maxKey: string | undefined;
  let maxKeyBytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const size = key.length + (localStorage.getItem(key) ?? "").length;
      usageBytes += size;
      keyCount += 1;
      if (size > maxKeyBytes) {
        maxKeyBytes = size;
        maxKey = key;
      }
    }
  } catch {
    return { usageBytes: 0, keyCount: 0, maxKeyBytes: 0 };
  }
  return { usageBytes, keyCount, maxKey, maxKeyBytes };
}

type Candidate = { key: string; bytes: number; project: string };

function buildRankMap(paths: readonly string[]): Map<string, number> {
  const ranks = new Map<string, number>();
  paths.forEach((path, index) => {
    const key = normalizeProjectPath(path);
    if (key && !ranks.has(key)) ranks.set(key, index);
  });
  return ranks;
}

/**
 * 从 `前缀 + 项目token` 形式的 key 里取回项目 token。
 * Git 分组草稿形如 `<项目>--<分支>`，在 `--` 处截断。
 */
function projectTokenFor(key: string, prefix: string): string {
  let rest = key.slice(prefix.length);
  const sep = rest.indexOf("--");
  if (sep >= 0) rest = rest.slice(0, sep);
  return normalizeProjectPath(rest);
}

/** 按前缀收集候选，并按项目 token 分组（保留 key 的出现顺序）。 */
function collectGroupedCandidates(prefixes: readonly string[]): Map<string, Candidate[]> {
  const groups = new Map<string, Candidate[]>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const prefix = prefixes.find((p) => key.startsWith(p));
      if (!prefix) continue;
      const project = projectTokenFor(key, prefix);
      const candidate: Candidate = {
        key,
        bytes: key.length + (localStorage.getItem(key) ?? "").length,
        project,
      };
      const list = groups.get(project);
      if (list) list.push(candidate);
      else groups.set(project, [candidate]);
    }
  } catch {
    // localStorage 不可用：返回已收集到的部分。
  }
  return groups;
}

/**
 * 项目淘汰顺序（越靠前越先淘汰）：
 * - 有排行时：排行越靠后（越久未打开）越先淘汰；未记录的一律视为最旧，最先淘汰；
 * - 无排行时：按插入顺序，先插入（更旧）的先淘汰。
 */
function orderProjects(
  projects: readonly string[],
  ranks: Map<string, number>,
  activeKey: string,
  insertion: Map<string, number>,
): string[] {
  return projects
    .filter((project) => project !== activeKey)
    .sort((a, b) => {
      const ra = ranks.get(a);
      const rb = ranks.get(b);
      if (ra !== undefined && rb !== undefined) return rb - ra;
      // 未记录最近打开时间的项目一律视为最旧，最先淘汰。
      if (ra !== undefined) return 1;
      if (rb !== undefined) return -1;
      return (insertion.get(a) ?? 0) - (insertion.get(b) ?? 0);
    });
}

/**
 * 当 localStorage 用量超过水位时，按项目 LRU 淘汰可重建缓存。
 *
 * @param options.recentProjectRanks 最近打开的项目，最近的在前（用于 LRU 判序）。
 * @param options.activeProjectPath 当前项目，永不淘汰；缺省用 `setActiveProjectForBudget` 记录值。
 * @param options.budgetBytes 水位，缺省 `LOCAL_STORAGE_BUDGET_BYTES`。
 */
export function reclaimLocalStorageBudget(options?: {
  budgetBytes?: number;
  activeProjectPath?: string;
  recentProjectRanks?: readonly string[];
}): LocalStorageReclaimResult {
  const budget = options?.budgetBytes ?? LOCAL_STORAGE_BUDGET_BYTES;
  const before = estimateLocalStorageUsage();
  if (before.usageBytes <= budget) {
    return {
      ran: false,
      usageBefore: before.usageBytes,
      usageAfter: before.usageBytes,
      freedBytes: 0,
      evictedKeys: [],
      evictedProjects: [],
    };
  }

  const activeKey = normalizeProjectPath(options?.activeProjectPath ?? activeProjectKey);
  const ranks = buildRankMap(options?.recentProjectRanks || []);

  let usage = before.usageBytes;
  const evictedKeys: string[] = [];
  const evictedProjects = new Set<string>();

  for (const tier of EVICT_TIERS) {
    if (usage <= budget) break;
    const groups = collectGroupedCandidates(tier);
    const insertion = new Map<string, number>();
    let i = 0;
    for (const project of groups.keys()) insertion.set(project, i++);

    for (const project of orderProjects([...groups.keys()], ranks, activeKey, insertion)) {
      if (usage <= budget) break;
      for (const candidate of groups.get(project) || []) {
        if (!lsRemove(candidate.key)) continue;
        usage -= candidate.bytes;
        evictedKeys.push(candidate.key);
        evictedProjects.add(project);
      }
    }
  }

  return {
    ran: true,
    usageBefore: before.usageBytes,
    usageAfter: usage,
    freedBytes: before.usageBytes - usage,
    evictedKeys,
    evictedProjects: [...evictedProjects],
  };
}
