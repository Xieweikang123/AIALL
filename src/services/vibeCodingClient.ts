import { backendUrl } from "./backendBase";
import { open } from "@tauri-apps/plugin-dialog";

export function formatFetchError(error: unknown, fallback: string): string {
  const msg = error instanceof Error ? error.message : fallback;
  if (/unexpected end of json input/i.test(msg) || /failed to execute 'json'/i.test(msg)) {
    return "后端无有效响应，请确认开发服务已启动";
  }
  if (/unexpected token '<'/i.test(msg) || /not valid json/i.test(msg)) {
    return "后端返回 HTML 而非 JSON，请重启本地服务（npm run dev 或 npm run sidecar）";
  }
  if (/failed to fetch|networkerror|network error/i.test(msg)) {
    return "无法连接后端服务，请检查网络或开发服务是否已启动";
  }
  return msg.trim() || fallback;
}

export async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    if (response.status >= 500) {
      throw new Error(`后端服务未启动或已崩溃（HTTP ${response.status}），请运行 npm run dev 重启`);
    }
    throw new Error(`后端返回空响应（HTTP ${response.status}）`);
  }
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html") || trimmed.startsWith("<")) {
    throw new Error("后端返回 HTML 而非 JSON，请重启本地服务（npm run dev 或 npm run sidecar）");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`后端返回无效 JSON（HTTP ${response.status}）`);
  }
}

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
    const data = await readJsonResponse<ProjectContextResult>(response);
    return data;
  } catch (error) {
    return { ok: false, error: formatFetchError(error, "网络错误") };
  }
}

export type ChatSessionSyncResult = { ok: true } | { ok: false; error?: string };

export async function syncChatSession(
  projectPath: string,
  sessionId: string,
  data: unknown,
  options?: { activeSessionId?: string },
): Promise<ChatSessionSyncResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/chat-session-sync"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectPath,
        sessionId,
        data,
        activeSessionId: options?.activeSessionId || sessionId,
      }),
    });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const body = await readJsonResponse<{ ok?: boolean; error?: string }>(response);
    if (body.ok === false) {
      return { ok: false, error: body.error || "写入会话文件失败" };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: formatFetchError(error, "网络错误") };
  }
}

export function buildChatImageFileUrl(projectPath: string, refPath: string): string {
  const qs = new URLSearchParams({
    projectPath,
    path: refPath,
  });
  return backendUrl(`/backend/vibe/chat-image-file?${qs.toString()}`);
}

export async function fetchChatImageDataUrl(
  projectPath: string,
  refPath: string,
): Promise<{ ok: true; dataUrl: string } | { ok: false; error?: string }> {
  try {
    const qs = new URLSearchParams({
      projectPath,
      path: refPath,
    });
    const response = await fetch(backendUrl(`/backend/vibe/chat-image?${qs.toString()}`));
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const data = await readJsonResponse<{ ok?: boolean; dataUrl?: string; error?: string }>(response);
    if (!data.ok || !data.dataUrl) {
      return { ok: false, error: data.error || "读取图片失败" };
    }
    return { ok: true, dataUrl: data.dataUrl };
  } catch (error) {
    return { ok: false, error: formatFetchError(error, "读取图片失败") };
  }
}

export type ChatStoreLoadResult =
  | { ok: true; data: import("./vibeChatStorage").VibeChatProjectSnapshot }
  | { ok: false; error: string };

export type SessionMessagesResult =
  | { ok: true; data: { sessionId: string; messages: unknown[] } }
  | { ok: false; error: string };

let fetchChatStoreAbort: AbortController | null = null;

/** 加载会话存储，默认不含 messages；传入 loadMessages=true 可同时加载消息内容 */
export async function fetchChatStoreFromDisk(projectPath: string, options?: { loadMessages?: boolean }): Promise<ChatStoreLoadResult> {
  // 取消之前的请求，避免连接池阻塞
  if (fetchChatStoreAbort) {
    fetchChatStoreAbort.abort();
    fetchChatStoreAbort = null;
  }
  const controller = new AbortController();
  fetchChatStoreAbort = controller;

  const t0 = performance.now();
  try {
    const loadMsg = options?.loadMessages ? "&loadMessages=1" : "";
    const url = backendUrl(`/backend/vibe/chat-store-load?projectPath=${encodeURIComponent(projectPath)}&_t=${Date.now()}${loadMsg}`);
    
    const response = await fetch(url, { signal: controller.signal });
    console.log(`[FETCH] ${Math.round(performance.now() - t0)}ms ${projectPath.split("\\").pop()}`);
    
    if (response.status === 404) {
      return { ok: false, error: "磁盘上没有会话备份" };
    }
    if (!response.ok) {
      return { ok: false, error: `读取会话备份失败：HTTP ${response.status}` };
    }
    
    const result = await response.json() as ChatStoreLoadResult;
    return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, error: "请求已取消" };
    }
    return { ok: false, error: formatFetchError(error, "读取会话备份失败") };
  } finally {
    if (fetchChatStoreAbort === controller) {
      fetchChatStoreAbort = null;
    }
  }
}

/** 按需加载单个会话的 messages */
export async function fetchSessionMessages(projectPath: string, sessionId: string): Promise<SessionMessagesResult> {
  try {
    const response = await fetch(
      backendUrl(`/backend/vibe/chat-session-messages?projectPath=${encodeURIComponent(projectPath)}&sessionId=${encodeURIComponent(sessionId)}`),
    );
    if (!response.ok) {
      return { ok: false, error: `读取会话消息失败：HTTP ${response.status}` };
    }
    const result = await readJsonResponse<SessionMessagesResult>(response);
    return result;
  } catch (error) {
    return { ok: false, error: formatFetchError(error, "读取会话消息失败") };
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
    const result = await readJsonResponse<ChatStoreSyncResult>(response);
    return result;
  } catch (error) {
    return { ok: false, error: formatFetchError(error, "同步会话到本地失败") };
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
    const data = await readJsonResponse<ListResult>(response);
    return data;
  } catch (error) {
    return { ok: false, path: dirPath, items: [], error: formatFetchError(error, "网络错误") };
  }
}

export async function readFile(filePath: string, projectRoot?: string): Promise<ReadResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/read"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath, projectRoot }),
    });
    return await readJsonResponse<ReadResult>(response);
  } catch (error) {
    return { ok: false, content: "", path: filePath, size: 0, error: formatFetchError(error, "网络错误") };
  }
}

export async function writeFile(filePath: string, content: string, projectRoot?: string): Promise<WriteResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/write"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath, content, projectRoot }),
    });
    return await readJsonResponse<WriteResult>(response);
  } catch (error) {
    return { ok: false, path: filePath, size: 0, error: formatFetchError(error, "网络错误") };
  }
}

export async function searchFiles(dirPath: string, query: string): Promise<SearchResults> {
  try {
    const url = backendUrl(`/backend/vibe/search?path=${encodeURIComponent(dirPath)}&q=${encodeURIComponent(query)}`);
    const response = await fetch(url);
    return await readJsonResponse<SearchResults>(response);
  } catch (error) {
    return { ok: false, results: [], error: formatFetchError(error, "网络错误") };
  }
}

export async function grepContent(dirPath: string, pattern: string): Promise<GrepResults> {
  try {
    const url = backendUrl(
      `/backend/vibe/grep?path=${encodeURIComponent(dirPath)}&q=${encodeURIComponent(pattern)}`,
    );
    const response = await fetch(url);
    return await readJsonResponse<GrepResults>(response);
  } catch (error) {
    return { ok: false, results: [], error: formatFetchError(error, "网络错误") };
  }
}

export async function createItem(itemPath: string, isDirectory: boolean, content?: string, projectRoot?: string): Promise<CreateResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/create"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: itemPath, isDirectory, content, projectRoot }),
    });
    return await readJsonResponse<CreateResult>(response);
  } catch (error) {
    return { ok: false, path: itemPath, type: "", error: formatFetchError(error, "网络错误") };
  }
}

export async function deleteItem(itemPath: string, projectRoot?: string): Promise<DeleteResult> {
  try {
    const rootParam = projectRoot ? `&projectRoot=${encodeURIComponent(projectRoot)}` : "";
    const url = backendUrl(`/backend/vibe/delete?path=${encodeURIComponent(itemPath)}${rootParam}`);
    const response = await fetch(url, { method: "DELETE" });
    return await readJsonResponse<DeleteResult>(response);
  } catch (error) {
    return { ok: false, path: itemPath, error: formatFetchError(error, "网络错误") };
  }
}

export async function renameItem(fromPath: string, toPath: string): Promise<RenameResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/rename"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromPath, to: toPath }),
    });
    return await readJsonResponse<RenameResult>(response);
  } catch (error) {
    return {
      ok: false,
      from: fromPath,
      to: toPath,
      error: formatFetchError(error, "网络错误"),
    };
  }
}
