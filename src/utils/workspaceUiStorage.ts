import { lsGetJson, lsRemove, lsSetJson } from "./localStorageSafe";

export const WORKSPACE_UI_VERSION = 1;

export type PersistedGitPanelUi = {
  logOpen?: boolean;
  stagedOpen?: boolean;
  unstagedOpen?: boolean;
  stashOpen?: boolean;
  aheadCommitsOpen?: boolean;
  batchSectionOpen?: boolean;
  stashSectionOpen?: boolean;
  localChangesOpen?: boolean;
  treeExpandedDirs?: string[];
  selectedFiles?: string[];
  expandedLogEntries?: string[];
  logSearchQuery?: string;
};

export type PersistedWorkspaceUi = {
  version: typeof WORKSPACE_UI_VERSION;
  expandedDirs?: string[];
  selectedTreePath?: string;
  showDiffMode?: boolean;
  chatScrollTop?: number;
  chatPinnedToBottom?: boolean;
  git?: PersistedGitPanelUi;
  planPanelInForeground?: boolean;
  planPanelActive?: boolean;
  planUserDismissed?: boolean;
  planPinnedMessageId?: string;
  quickSearchOpen?: boolean;
};

function normalizeProjectPath(projectPath: string): string {
  return projectPath.trim().replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
}

export function workspaceUiStorageKey(projectPath: string): string {
  const normalized = normalizeProjectPath(projectPath);
  return `vibe-coding-workspace-ui-${normalized || "__global"}`;
}

function slimStringArray(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const out = values.filter((v): v is string => typeof v === "string" && Boolean(v.trim())).map((v) => v.trim());
  return out.length ? out : undefined;
}

function slimGitPanelUi(raw: unknown): PersistedGitPanelUi | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const src = raw as PersistedGitPanelUi;
  const git: PersistedGitPanelUi = {};
  if (typeof src.logOpen === "boolean") git.logOpen = src.logOpen;
  if (typeof src.stagedOpen === "boolean") git.stagedOpen = src.stagedOpen;
  if (typeof src.unstagedOpen === "boolean") git.unstagedOpen = src.unstagedOpen;
  if (typeof src.stashOpen === "boolean") git.stashOpen = src.stashOpen;
  if (typeof src.aheadCommitsOpen === "boolean") git.aheadCommitsOpen = src.aheadCommitsOpen;
  if (typeof src.batchSectionOpen === "boolean") git.batchSectionOpen = src.batchSectionOpen;
  if (typeof src.stashSectionOpen === "boolean") git.stashSectionOpen = src.stashSectionOpen;
  if (typeof src.localChangesOpen === "boolean") git.localChangesOpen = src.localChangesOpen;
  const treeExpandedDirs = slimStringArray(src.treeExpandedDirs);
  if (treeExpandedDirs) git.treeExpandedDirs = treeExpandedDirs;
  const selectedFiles = slimStringArray(src.selectedFiles);
  if (selectedFiles) git.selectedFiles = selectedFiles;
  const expandedLogEntries = slimStringArray(src.expandedLogEntries);
  if (expandedLogEntries) git.expandedLogEntries = expandedLogEntries;
  if (typeof src.logSearchQuery === "string") git.logSearchQuery = src.logSearchQuery;
  return Object.keys(git).length ? git : undefined;
}

export function readWorkspaceUi(projectPath: string): PersistedWorkspaceUi | null {
  const raw = lsGetJson<PersistedWorkspaceUi>(workspaceUiStorageKey(projectPath));
  if (!raw || typeof raw !== "object") return null;
  if (raw.version !== WORKSPACE_UI_VERSION) return null;

  const ui: PersistedWorkspaceUi = { version: WORKSPACE_UI_VERSION };
  const expandedDirs = slimStringArray(raw.expandedDirs);
  if (expandedDirs) ui.expandedDirs = expandedDirs;
  if (typeof raw.selectedTreePath === "string" && raw.selectedTreePath.trim()) {
    ui.selectedTreePath = raw.selectedTreePath.trim();
  }
  if (typeof raw.showDiffMode === "boolean") ui.showDiffMode = raw.showDiffMode;
  if (typeof raw.chatScrollTop === "number" && Number.isFinite(raw.chatScrollTop)) {
    ui.chatScrollTop = Math.max(0, raw.chatScrollTop);
  }
  if (typeof raw.chatPinnedToBottom === "boolean") ui.chatPinnedToBottom = raw.chatPinnedToBottom;
  const git = slimGitPanelUi(raw.git);
  if (git) ui.git = git;
  if (typeof raw.planPanelInForeground === "boolean") ui.planPanelInForeground = raw.planPanelInForeground;
  if (typeof raw.planPanelActive === "boolean") ui.planPanelActive = raw.planPanelActive;
  if (typeof raw.planUserDismissed === "boolean") ui.planUserDismissed = raw.planUserDismissed;
  if (typeof raw.planPinnedMessageId === "string" && raw.planPinnedMessageId.trim()) {
    ui.planPinnedMessageId = raw.planPinnedMessageId.trim();
  }
  if (typeof raw.quickSearchOpen === "boolean") ui.quickSearchOpen = raw.quickSearchOpen;
  return ui;
}

export function writeWorkspaceUi(projectPath: string, state: Omit<PersistedWorkspaceUi, "version">): void {
  if (!normalizeProjectPath(projectPath)) return;
  lsSetJson(workspaceUiStorageKey(projectPath), {
    version: WORKSPACE_UI_VERSION,
    ...state,
  });
}

export function removeWorkspaceUi(projectPath: string): void {
  if (!normalizeProjectPath(projectPath)) return;
  lsRemove(workspaceUiStorageKey(projectPath));
}
