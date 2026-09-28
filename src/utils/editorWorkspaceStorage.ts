import { lsGetJson, lsRemove, lsSetJson } from "./localStorageSafe";
import { normalizeProjectPath } from "./normalizePath";
import { debugLog } from "./debugLog";

export type PersistedEditorDiff = { before: string; after: string; deleted?: boolean; created?: boolean };

/** git tab 还原所需的最小引用，避免在 localStorage 里存整份文件内容。 */
export type PersistedEditorGitMeta = {
  /** git-history 用的完整 commit hash；工作区 diff 为空。 */
  hash?: string;
  /** 真实文件路径（工作区 diff 可能是相对路径，原样保留）。 */
  filePath: string;
  /** git-history 里被重命名/删除的原路径。 */
  oldPath?: string;
};

export type PersistedEditorTab = {
  path: string;
  kind?: string;
  dirty?: boolean;
  /** 仅 scratch 与未落盘的 dirty file 保留；git 类与磁盘文件不再落盘。 */
  content?: string;
  /** 旧版本遗留字段：读取时兼容（避免一次多余拉取），写入时不再产生。 */
  diff?: PersistedEditorDiff;
  readOnly?: boolean;
  /** git 类 tab 的还原引用（见 PersistedEditorGitMeta）。 */
  git?: PersistedEditorGitMeta;
};

export type PersistedEditorWorkspace = {
  tabs: PersistedEditorTab[];
  activePath: string;
};

/**
 * 单条工作区序列化上限（字符数，约等于字节数）。
 * 编辑器工作区与「会话索引」共用同一个 localStorage 配额，历史上曾因存多份文件全文
 * 把配额吃满，导致 `vibe-coding-chat` 索引写入失败。超限即裁剪。
 */
export const EDITOR_WORKSPACE_MAX_BYTES = 512 * 1024;
export const EDITOR_WORKSPACE_MAX_TABS = 40;

export function editorWorkspaceStorageKey(projectPath: string): string {
  const normalized = normalizeProjectPath(projectPath);
  return `vibe-coding-editor-workspace-${normalized || "__global"}`;
}

function serializeSize(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

/** 去掉可重新获取的内容，仅保留还原 tab 所需的最小元数据。 */
function stripVolatileTabContent(tab: PersistedEditorTab): PersistedEditorTab {
  const { content: _content, diff: _diff, git: _git, ...meta } = tab;
  return { ...meta, ...(_git ? { git: _git } : {}) };
}

/** 写入前始终剥离旧版遗留的 diff（体积最大，且新版本不再产生）。 */
function stripLegacyDiff(tab: PersistedEditorTab): PersistedEditorTab {
  if (!("diff" in tab)) return tab;
  const { diff: _diff, ...rest } = tab;
  return rest;
}

function capTabs(
  tabs: PersistedEditorTab[],
  activePath: string,
  max: number,
): PersistedEditorTab[] {
  if (tabs.length <= max) return tabs;
  const kept = tabs.slice(0, max);
  const active = activePath.trim();
  if (active && !kept.some((tab) => tab.path === active)) {
    const idx = tabs.findIndex((tab) => tab.path === active);
    if (idx >= 0) kept[max - 1] = tabs[idx];
  }
  return kept;
}

export function readEditorWorkspace(projectPath: string): PersistedEditorWorkspace | null {
  const key = editorWorkspaceStorageKey(projectPath);
  const raw = lsGetJson<PersistedEditorWorkspace>(key);
  if (!raw || !Array.isArray(raw.tabs)) return null;
  const tabs = raw.tabs.filter(
    (tab): tab is PersistedEditorTab =>
      Boolean(tab && typeof tab.path === "string" && tab.path.trim()),
  );
  if (!tabs.length) return null;
  const activePath = typeof raw.activePath === "string" ? raw.activePath.trim() : "";
  return { tabs, activePath };
}

export function writeEditorWorkspace(projectPath: string, workspace: PersistedEditorWorkspace): void {
  if (!normalizeProjectPath(projectPath)) return;
  if (!workspace.tabs.length) {
    removeEditorWorkspace(projectPath);
    return;
  }
  const key = editorWorkspaceStorageKey(projectPath);
  const tabs = capTabs(workspace.tabs, workspace.activePath, EDITOR_WORKSPACE_MAX_TABS).map(stripLegacyDiff);
  const payload: PersistedEditorWorkspace = { tabs, activePath: workspace.activePath };

  // 超限时先裁掉可重新获取的内容再写，避免单条工作区把 localStorage 配额吃满。
  const withinBudget =
    serializeSize(payload) <= EDITOR_WORKSPACE_MAX_BYTES
      ? payload
      : { activePath: payload.activePath, tabs: tabs.map(stripVolatileTabContent) };

  if (lsSetJson(key, withinBudget)) return;

  // 配额被占满：丢弃可重新获取的 content/diff，只留元数据再试一次。
  const metadataOnly: PersistedEditorWorkspace = {
    activePath: withinBudget.activePath,
    tabs: withinBudget.tabs.map(stripVolatileTabContent),
  };
  if (!lsSetJson(key, metadataOnly)) {
    // 连纯元数据都写不进：把真实错误与用量写进 debug 日志，便于事后定位（不再只是 console）。
    debugLog("editor-workspace:write-failed", {
      key,
      tabs: metadataOnly.tabs.length,
      bytes: serializeSize(metadataOnly),
      storage: describeLocalStoragePressure(),
    });
  }
}

/** 汇总 localStorage 用量与最大 key，写失败时用于定位是谁把配额吃满。 */
function describeLocalStoragePressure(): { usageBytes?: number; maxKey?: string; maxKeyBytes?: number } {
  try {
    if (typeof localStorage === "undefined") return {};
    let usageBytes = 0;
    let maxKeyBytes = 0;
    let maxKey: string | undefined;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const size = (localStorage.getItem(key) ?? "").length + key.length;
      usageBytes += size;
      if (size > maxKeyBytes) {
        maxKeyBytes = size;
        maxKey = key;
      }
    }
    return { usageBytes, maxKey, maxKeyBytes };
  } catch {
    return {};
  }
}

export function removeEditorWorkspace(projectPath: string): void {
  if (!normalizeProjectPath(projectPath)) return;
  lsRemove(editorWorkspaceStorageKey(projectPath));
}
