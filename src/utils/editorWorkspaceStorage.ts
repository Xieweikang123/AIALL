import { lsGetJson, lsRemove, lsSetJson } from "./localStorageSafe";

export type PersistedEditorTab = {
  path: string;
  dirty?: boolean;
  content?: string;
};

export type PersistedEditorWorkspace = {
  tabs: PersistedEditorTab[];
  activePath: string;
};

function normalizeProjectPath(projectPath: string): string {
  return projectPath.trim().replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
}

export function editorWorkspaceStorageKey(projectPath: string): string {
  const normalized = normalizeProjectPath(projectPath);
  return `vibe-coding-editor-workspace-${normalized || "__global"}`;
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
  lsSetJson(editorWorkspaceStorageKey(projectPath), workspace);
}

export function removeEditorWorkspace(projectPath: string): void {
  if (!normalizeProjectPath(projectPath)) return;
  lsRemove(editorWorkspaceStorageKey(projectPath));
}
