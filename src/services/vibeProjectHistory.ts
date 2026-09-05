import { backendUrl } from "./backendBase";
import { invokeBackend } from "./tauriInvoke";

export type ProjectHistoryEntry = {
  path: string;
  displayName: string;
  lastOpenedAt: string;
};

type HistoryListPayload = { ok?: boolean; entries?: ProjectHistoryEntry[]; error?: string };
type HistoryActionPayload = { ok?: boolean; error?: string };

/** 列出最近打开的项目（按最近打开时间排序）。桌面走 Tauri command，web 走 agent-server。 */
export async function listProjectHistory(): Promise<ProjectHistoryEntry[]> {
  const data = await invokeBackend<HistoryListPayload>(
    "project_history_list",
    {},
    async () => {
      const res = await fetch(backendUrl("/backend/vibe/project-history"), {
        method: "GET",
      });
      return readJsonResponse<HistoryListPayload>(res);
    },
  );
  if (data && Array.isArray(data.entries)) return data.entries;
  if (data?.error) throw new Error(data.error);
  return [];
}

/** 打开项目时记录历史（去重并置顶）。 */
export async function addProjectToHistory(path: string): Promise<void> {
  const trimmed = path.trim();
  if (!trimmed) return;
  await invokeBackend<HistoryActionPayload>(
    "project_history_add",
    { path: trimmed },
    async () => {
      const res = await fetch(backendUrl("/backend/vibe/project-history/add"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: trimmed }),
      });
      return readJsonResponse<HistoryActionPayload>(res);
    },
  );
}

/** 从历史中移除单个项目。 */
export async function removeProjectFromHistory(path: string): Promise<void> {
  const trimmed = path.trim();
  if (!trimmed) return;
  await invokeBackend<HistoryActionPayload>(
    "project_history_remove",
    { path: trimmed },
    async () => {
      const res = await fetch(backendUrl("/backend/vibe/project-history/remove"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: trimmed }),
      });
      return readJsonResponse<HistoryActionPayload>(res);
    },
  );
}

/** 清空项目历史。 */
export async function clearProjectHistory(): Promise<void> {
  await invokeBackend<HistoryActionPayload>(
    "project_history_clear",
    {},
    async () => {
      const res = await fetch(backendUrl("/backend/vibe/project-history/clear"), {
        method: "POST",
      });
      return readJsonResponse<HistoryActionPayload>(res);
    },
  );
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `请求失败 (${response.status})`);
  }
  return (await response.json()) as T;
}
