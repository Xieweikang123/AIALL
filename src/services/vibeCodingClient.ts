import { backendUrl } from "./backendBase";
import { open } from "@tauri-apps/plugin-dialog";

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  extension: string;
  size?: number;
}

export interface ListResult {
  ok: boolean;
  path: string;
  items: FileEntry[];
  error?: string;
}

export interface ReadResult {
  ok: boolean;
  content: string;
  path: string;
  size: number;
  error?: string;
}

export interface WriteResult {
  ok: boolean;
  path: string;
  size: number;
  error?: string;
}

export interface SearchResult {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface SearchResults {
  ok: boolean;
  results: SearchResult[];
  error?: string;
}

export interface GrepMatch {
  path: string;
  relative: string;
  line: number;
  text: string;
}

export interface GrepResults {
  ok: boolean;
  results: GrepMatch[];
  error?: string;
}

export interface CreateResult {
  ok: boolean;
  path: string;
  type: string;
  error?: string;
}

export interface DeleteResult {
  ok: boolean;
  path: string;
  error?: string;
}

export interface RenameResult {
  ok: boolean;
  from: string;
  to: string;
  error?: string;
}

export interface PickFolderResult {
  ok: boolean;
  path?: string;
  cancelled?: boolean;
  error?: string;
}

export interface ProjectKeyFile {
  path: string;
  content: string;
}

export interface ProjectContextResult {
  ok: boolean;
  path?: string;
  tree?: string;
  keyFiles?: ProjectKeyFile[];
  truncated?: boolean;
  error?: string;
}

export interface ChatStoreSyncResult {
  ok: boolean;
  path?: string;
  sessionCount?: number;
  error?: string;
}

export async function fetchProjectContext(projectPath: string): Promise<ProjectContextResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/project-context"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath }),
    });
    const data = (await response.json()) as ProjectContextResult;
    return data;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function syncChatSession(projectPath: string, sessionId: string, data: unknown): Promise<void> {
  try {
    await fetch(backendUrl("/backend/vibe/chat-session-sync"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectPath, sessionId, data }),
    });
  } catch {
    // best-effort, ignore errors
  }
}

export async function syncChatStore(projectPath: string, data: unknown): Promise<ChatStoreSyncResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/chat-store-sync"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectPath, data }),
    });
    if (!response.ok) {
      return { ok: false, error: `同步会话到本地失败：HTTP ${response.status}` };
    }
    const result = (await response.json()) as ChatStoreSyncResult;
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "同步会话到本地失败" };
  }
}

export async function pickProjectFolder(initialPath?: string): Promise<PickFolderResult> {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "选择项目文件夹",
      defaultPath: initialPath || undefined,
    });
    if (selected === null) {
      return { ok: false, cancelled: true };
    }
    return { ok: true, path: selected };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "打开文件夹选择器失败" };
  }
}

export async function listDirectory(dirPath: string): Promise<ListResult> {
  try {
    const url = backendUrl(`/backend/vibe/list?path=${encodeURIComponent(dirPath)}`);
    const response = await fetch(url);
    const data = (await response.json()) as ListResult;
    return data;
  } catch (error) {
    return { ok: false, path: dirPath, items: [], error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function readFile(filePath: string, projectRoot?: string): Promise<ReadResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/read"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath, projectRoot }),
    });
    const data = (await response.json()) as ReadResult;
    return data;
  } catch (error) {
    return { ok: false, content: "", path: filePath, size: 0, error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function writeFile(filePath: string, content: string, projectRoot?: string): Promise<WriteResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/write"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath, content, projectRoot }),
    });
    const data = (await response.json()) as WriteResult;
    return data;
  } catch (error) {
    return { ok: false, path: filePath, size: 0, error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function searchFiles(dirPath: string, query: string): Promise<SearchResults> {
  try {
    const url = backendUrl(`/backend/vibe/search?path=${encodeURIComponent(dirPath)}&q=${encodeURIComponent(query)}`);
    const response = await fetch(url);
    const data = (await response.json()) as SearchResults;
    return data;
  } catch (error) {
    return { ok: false, results: [], error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function grepContent(dirPath: string, pattern: string): Promise<GrepResults> {
  try {
    const url = backendUrl(
      `/backend/vibe/grep?path=${encodeURIComponent(dirPath)}&q=${encodeURIComponent(pattern)}`,
    );
    const response = await fetch(url);
    const data = (await response.json()) as GrepResults;
    return data;
  } catch (error) {
    return { ok: false, results: [], error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function createItem(itemPath: string, isDirectory: boolean, content?: string, projectRoot?: string): Promise<CreateResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/create"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: itemPath, isDirectory, content, projectRoot }),
    });
    const data = (await response.json()) as CreateResult;
    return data;
  } catch (error) {
    return { ok: false, path: itemPath, type: "", error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function deleteItem(itemPath: string, projectRoot?: string): Promise<DeleteResult> {
  try {
    const rootParam = projectRoot ? `&projectRoot=${encodeURIComponent(projectRoot)}` : "";
    const url = backendUrl(`/backend/vibe/delete?path=${encodeURIComponent(itemPath)}${rootParam}`);
    const response = await fetch(url, { method: "DELETE" });
    const data = (await response.json()) as DeleteResult;
    return data;
  } catch (error) {
    return { ok: false, path: itemPath, error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function renameItem(fromPath: string, toPath: string): Promise<RenameResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/rename"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromPath, to: toPath }),
    });
    const data = (await response.json()) as RenameResult;
    return data;
  } catch (error) {
    return {
      ok: false,
      from: fromPath,
      to: toPath,
      error: error instanceof Error ? error.message : "网络错误",
    };
  }
}
