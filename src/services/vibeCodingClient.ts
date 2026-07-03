import { backendJsonParseErrorMessage } from "./agentConnectCopy";
import { backendUrl } from "./backendBase";
import { formatInvokeError, invokeBackend, isTauriEnv } from "./tauriInvoke";

export function formatFetchError(error: unknown, fallback: string): string {
  const msg = error instanceof Error ? error.message : fallback;
  if (/unexpected end of json input/i.test(msg) || /failed to execute 'json'/i.test(msg)) {
    return "后端无有效响应，请确认开发服务已启动";
  }
  if (/unexpected token '<'/i.test(msg) || /not valid json/i.test(msg)) {
    return "后端返回无效响应，请重启应用（npm run dev）";
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
      throw new Error(`后端服务未响应（HTTP ${response.status}），请重启应用`);
    }
    throw new Error(`后端返回空响应（HTTP ${response.status}）`);
  }
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html") || trimmed.startsWith("<")) {
    throw new Error(backendJsonParseErrorMessage());
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
  activeSessionId?: string;
  syncedAt?: string;
  sessions?: Array<{
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
    status?: string;
  }>;
  error?: string;
}

export type ChatSessionDeleteResult =
  | {
      ok: true;
      activeSessionId: string;
      sessionCount: number;
      syncedAt: string;
      sessions: Array<{
        id: string;
        title: string;
        createdAt: string;
        updatedAt: string;
        messageCount: number;
        status?: string;
      }>;
    }
  | { ok: false; error?: string };

export async function fetchProjectContext(projectPath: string): Promise<ProjectContextResult> {
  try {
    return await invokeBackend<ProjectContextResult>(
      "project_context",
      { path: projectPath },
      async () => {
        const response = await fetch(backendUrl("/backend/vibe/project-context"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: projectPath }),
        });
        return readJsonResponse<ProjectContextResult>(response);
      },
    );
  } catch (error) {
    return { ok: false, error: formatInvokeError(error, "读取项目上下文失败") };
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
    const activeSessionId = options?.activeSessionId || sessionId;
    const body = await invokeBackend<{ ok?: boolean; error?: string }>(
      "chat_session_sync",
      { projectPath, sessionId, data, activeSessionId },
      async () => {
        const response = await fetch(backendUrl("/backend/vibe/chat-session-sync"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectPath, sessionId, data, activeSessionId }),
        });
        if (!response.ok) {
          return { ok: false, error: `HTTP ${response.status}` };
        }
        return readJsonResponse<{ ok?: boolean; error?: string }>(response);
      },
    );
    if (body.ok === false) {
      return { ok: false, error: body.error || "写入会话文件失败" };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: formatInvokeError(error, formatFetchError(error, "网络错误")) };
  }
}

export async function deleteChatSessionFromDisk(
  projectPath: string,
  sessionId: string,
  options?: { activeSessionId?: string },
): Promise<ChatSessionDeleteResult> {
  try {
    const body = await invokeBackend<ChatSessionDeleteResult>(
      "chat_session_delete",
      {
        projectPath,
        sessionId,
        activeSessionId: options?.activeSessionId || "",
      },
      async () => {
        const response = await fetch(backendUrl("/backend/vibe/chat-session-delete"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectPath,
            sessionId,
            activeSessionId: options?.activeSessionId || "",
          }),
        });
        if (!response.ok) {
          return { ok: false, error: `HTTP ${response.status}` };
        }
        return readJsonResponse<ChatSessionDeleteResult>(response);
      },
    );
    if (!body.ok) {
      return { ok: false, error: body.error || "删除会话文件失败" };
    }
    return body;
  } catch (error) {
    return { ok: false, error: formatInvokeError(error, formatFetchError(error, "删除会话文件失败")) };
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
    const data = await invokeBackend<{ ok?: boolean; dataUrl?: string; error?: string }>(
      "chat_image",
      { projectPath, path: refPath },
      async () => {
        const qs = new URLSearchParams({ projectPath, path: refPath });
        const response = await fetch(backendUrl(`/backend/vibe/chat-image?${qs.toString()}`));
        if (!response.ok) {
          return { ok: false, error: `HTTP ${response.status}` };
        }
        return readJsonResponse<{ ok?: boolean; dataUrl?: string; error?: string }>(response);
      },
    );
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
  if (fetchChatStoreAbort) {
    fetchChatStoreAbort.abort();
    fetchChatStoreAbort = null;
  }
  const controller = new AbortController();
  fetchChatStoreAbort = controller;

  try {
    const loadMessages = options?.loadMessages ?? false;
    const result = await invokeBackend<ChatStoreLoadResult>(
      "chat_store_load",
      { projectPath, loadMessages },
      async () => {
        const loadMsg = loadMessages ? "&loadMessages=1" : "";
        const url = backendUrl(
          `/backend/vibe/chat-store-load?projectPath=${encodeURIComponent(projectPath)}&_t=${Date.now()}${loadMsg}`,
        );
        const response = await fetch(url, { signal: controller.signal });
        if (response.status === 404) {
          return { ok: false, error: "磁盘上没有会话备份" };
        }
        if (!response.ok) {
          return { ok: false, error: `读取会话备份失败：HTTP ${response.status}` };
        }
        return readJsonResponse<ChatStoreLoadResult>(response);
      },
    );
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
    return await invokeBackend<SessionMessagesResult>(
      "chat_session_messages",
      { projectPath, sessionId },
      async () => {
        const response = await fetch(
          backendUrl(
            `/backend/vibe/chat-session-messages?projectPath=${encodeURIComponent(projectPath)}&sessionId=${encodeURIComponent(sessionId)}`,
          ),
        );
        if (!response.ok) {
          return { ok: false, error: `读取会话消息失败：HTTP ${response.status}` };
        }
        return readJsonResponse<SessionMessagesResult>(response);
      },
    );
  } catch (error) {
    return { ok: false, error: formatFetchError(error, "读取会话消息失败") };
  }
}

export async function syncChatStore(projectPath: string, data: unknown): Promise<ChatStoreSyncResult> {
  try {
    return await invokeBackend<ChatStoreSyncResult>(
      "chat_store_sync",
      { projectPath, data },
      async () => {
        const response = await fetch(backendUrl("/backend/vibe/chat-store-sync"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectPath, data }),
        });
        if (!response.ok) {
          return { ok: false, error: `同步会话到本地失败：HTTP ${response.status}` };
        }
        return readJsonResponse<ChatStoreSyncResult>(response);
      },
    );
  } catch (error) {
    return { ok: false, error: formatFetchError(error, "同步会话到本地失败") };
  }
}

export interface OpenFolderResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export async function openProjectFolderInExplorer(folderPath: string): Promise<OpenFolderResult> {
  try {
    return await invokeBackend<OpenFolderResult>(
      "system_open_folder",
      { path: folderPath },
      async () => {
        const response = await fetch(backendUrl("/backend/vibe/open-folder"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: folderPath }),
        });
        return readJsonResponse<OpenFolderResult>(response);
      },
    );
  } catch (error) {
    return { ok: false, error: formatFetchError(error, "打开文件夹失败") };
  }
}

export async function pickProjectFolder(initialPath?: string): Promise<PickFolderResult> {
  try {
    const result = await invokeBackend<PickFolderResult>(
      "system_pick_folder",
      { initialPath: initialPath?.trim() || null },
      async () => {
        const response = await fetch(backendUrl("/backend/vibe/pick-folder"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initialPath: initialPath || "" }),
        });
        const data = await readJsonResponse<PickFolderResult>(response);
        if (data.cancelled) return { ok: false, cancelled: true };
        return data;
      },
    );
    if (result.cancelled) return { ok: false, cancelled: true };
    return result;
  } catch (error) {
    return { ok: false, error: formatFetchError(error, "打开文件夹选择器失败") };
  }
}

export async function listDirectory(dirPath: string): Promise<ListResult> {
  try {
    return await invokeBackend<ListResult>(
      "fs_list",
      { path: dirPath },
      async () => {
        const url = backendUrl(`/backend/vibe/list?path=${encodeURIComponent(dirPath)}`);
        const response = await fetch(url);
        return readJsonResponse<ListResult>(response);
      },
    );
  } catch (error) {
    return { ok: false, path: dirPath, items: [], error: formatFetchError(error, "网络错误") };
  }
}

export async function readFile(filePath: string, projectRoot?: string): Promise<ReadResult> {
  try {
    return await invokeBackend<ReadResult>(
      "fs_read",
      { path: filePath, projectRoot: projectRoot ?? null },
      async () => {
        const response = await fetch(backendUrl("/backend/vibe/read"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: filePath, projectRoot }),
        });
        return readJsonResponse<ReadResult>(response);
      },
    );
  } catch (error) {
    return { ok: false, content: "", path: filePath, size: 0, error: formatFetchError(error, "网络错误") };
  }
}

export async function writeFile(filePath: string, content: string, projectRoot?: string): Promise<WriteResult> {
  try {
    return await invokeBackend<WriteResult>(
      "fs_write",
      { path: filePath, content, projectRoot: projectRoot ?? null },
      async () => {
        const response = await fetch(backendUrl("/backend/vibe/write"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: filePath, content, projectRoot }),
        });
        return readJsonResponse<WriteResult>(response);
      },
    );
  } catch (error) {
    return { ok: false, path: filePath, size: 0, error: formatFetchError(error, "网络错误") };
  }
}

export async function searchFiles(dirPath: string, query: string): Promise<SearchResults> {
  try {
    return await invokeBackend<SearchResults>(
      "fs_search",
      { path: dirPath, q: query },
      async () => {
        const url = backendUrl(`/backend/vibe/search?path=${encodeURIComponent(dirPath)}&q=${encodeURIComponent(query)}`);
        const response = await fetch(url);
        return readJsonResponse<SearchResults>(response);
      },
    );
  } catch (error) {
    return { ok: false, results: [], error: formatFetchError(error, "网络错误") };
  }
}

export async function grepContent(dirPath: string, pattern: string): Promise<GrepResults> {
  try {
    return await invokeBackend<GrepResults>(
      "fs_grep",
      { path: dirPath, q: pattern },
      async () => {
        const url = backendUrl(
          `/backend/vibe/grep?path=${encodeURIComponent(dirPath)}&q=${encodeURIComponent(pattern)}`,
        );
        const response = await fetch(url);
        return readJsonResponse<GrepResults>(response);
      },
    );
  } catch (error) {
    return { ok: false, results: [], error: formatFetchError(error, "网络错误") };
  }
}

export async function createItem(itemPath: string, isDirectory: boolean, content?: string, projectRoot?: string): Promise<CreateResult> {
  try {
    return await invokeBackend<CreateResult>(
      "fs_create",
      {
        path: itemPath,
        isDirectory,
        content: content ?? null,
        projectRoot: projectRoot ?? null,
      },
      async () => {
        const response = await fetch(backendUrl("/backend/vibe/create"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: itemPath, isDirectory, content, projectRoot }),
        });
        return readJsonResponse<CreateResult>(response);
      },
    );
  } catch (error) {
    return { ok: false, path: itemPath, type: "", error: formatFetchError(error, "网络错误") };
  }
}

export async function deleteItem(itemPath: string, projectRoot?: string): Promise<DeleteResult> {
  try {
    return await invokeBackend<DeleteResult>(
      "fs_delete",
      { path: itemPath, projectRoot: projectRoot ?? null },
      async () => {
        const rootParam = projectRoot ? `&projectRoot=${encodeURIComponent(projectRoot)}` : "";
        const url = backendUrl(`/backend/vibe/delete?path=${encodeURIComponent(itemPath)}${rootParam}`);
        const response = await fetch(url, { method: "DELETE" });
        return readJsonResponse<DeleteResult>(response);
      },
    );
  } catch (error) {
    return { ok: false, path: itemPath, error: formatFetchError(error, "网络错误") };
  }
}

export async function renameItem(fromPath: string, toPath: string, projectRoot?: string): Promise<RenameResult> {
  try {
    return await invokeBackend<RenameResult>(
      "fs_rename",
      { from: fromPath, to: toPath, projectRoot: projectRoot ?? null },
      async () => {
        const response = await fetch(backendUrl("/backend/vibe/rename"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: fromPath, to: toPath, projectRoot }),
        });
        return readJsonResponse<RenameResult>(response);
      },
    );
  } catch (error) {
    return {
      ok: false,
      from: fromPath,
      to: toPath,
      error: formatFetchError(error, "网络错误"),
    };
  }
}
