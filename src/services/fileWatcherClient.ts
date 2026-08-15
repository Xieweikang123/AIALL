import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { backendUrl } from "./backendBase";
import { isTauriEnv, tauriInvoke } from "./tauriInvoke";
import { readJsonResponse } from "./vibeCodingClient";

export interface FileChangeEvent {
  type: "add" | "change" | "unlink" | "addDir" | "unlinkDir";
  path: string;
  timestamp: number;
}

export interface FileWatcherStartResult {
  ok: boolean;
  message: string;
  watchedPaths: string[];
  error?: string;
}

export interface FileWatcherStopResult {
  ok: boolean;
  message: string;
  error?: string;
}

type TauriWatcherPayload = {
  type?: FileChangeEvent["type"] | "change";
  path?: string;
  paths?: string[];
  timestamp?: number;
};

const FILE_CHANGE_TYPES = new Set<FileChangeEvent["type"]>([
  "add",
  "change",
  "unlink",
  "addDir",
  "unlinkDir",
]);

/** 服务器无桌面文件系统事件源：文件监听仅桌面版可用。 */
const FILE_WATCHER_WEB_DEGRADED: FileWatcherStartResult = {
  ok: false,
  message: "",
  watchedPaths: [],
  error: "文件监听仅桌面版可用",
};

export async function startFileWatcher(
  projectPath: string,
  watchPaths?: string[]
): Promise<FileWatcherStartResult> {
  if (!isTauriEnv()) {
    return { ...FILE_WATCHER_WEB_DEGRADED };
  }
  const paths = watchPaths?.length ? watchPaths : [projectPath];
  try {
    const result = await tauriInvoke<{ ok?: boolean }>("file_watcher_start", { paths });
    return { ok: result.ok !== false, message: "", watchedPaths: paths };
  } catch (error) {
    return {
      ok: false,
      message: "",
      watchedPaths: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function stopFileWatcher(): Promise<FileWatcherStopResult> {
  if (!isTauriEnv()) {
    return { ok: true, message: "已停止" };
  }
  try {
    await tauriInvoke("file_watcher_stop");
    return { ok: true, message: "" };
  } catch (error) {
    return {
      ok: false,
      message: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export type FileWatcherChangeCallback = (changes: FileChangeEvent[]) => void;
export type FileWatcherErrorCallback = (error: string) => void;
export type FileWatcherStatusCallback = (connected: boolean) => void;

let eventSource: EventSource | null = null;
let tauriUnlisten: UnlistenFn | null = null;
let changeCallback: FileWatcherChangeCallback | null = null;
let errorCallback: FileWatcherErrorCallback | null = null;
let statusCallback: FileWatcherStatusCallback | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let changeFlushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingChanges: FileChangeEvent[] = [];
let disposed = false;
let watchedProjectPath: string | null = null;

const RECONNECT_DELAY = 3000;
const CHANGE_FLUSH_DELAY = 300;

function mapTauriWatcherPayload(payload: TauriWatcherPayload): FileChangeEvent[] {
  const timestamp = payload.timestamp ?? Date.now();
  if (payload.path) {
    const type = payload.type && FILE_CHANGE_TYPES.has(payload.type as FileChangeEvent["type"])
      ? payload.type as FileChangeEvent["type"]
      : "change";
    return [{ type, path: payload.path, timestamp }];
  }
  if (payload.paths?.length) {
    return payload.paths.map((path) => ({
      type: "change" as const,
      path,
      timestamp,
    }));
  }
  return [];
}

function scheduleChangeFlush() {
  if (changeFlushTimer) clearTimeout(changeFlushTimer);
  changeFlushTimer = setTimeout(() => {
    changeFlushTimer = null;
    if (pendingChanges.length === 0 || !changeCallback) return;
    const batch = pendingChanges;
    pendingChanges = [];
    changeCallback(batch);
  }, CHANGE_FLUSH_DELAY);
}

function bindStreamListeners() {
  if (!eventSource) return;

  eventSource.addEventListener("status", (event) => {
    const data = JSON.parse(event.data);
    statusCallback?.(!!data.connected);
    if (!data.connected) {
      errorCallback?.("文件监听连接失败");
    }
  });

  eventSource.addEventListener("changes", (event) => {
    const data = JSON.parse(event.data);
    if (data.changes && data.changes.length > 0) {
      changeCallback?.(data.changes);
    }
  });

  eventSource.addEventListener("error", (event) => {
    if (event instanceof MessageEvent) {
      const data = JSON.parse(event.data);
      errorCallback?.(data.message || "文件监听错误");
    } else {
      errorCallback?.("文件监听连接断开");
      reconnect();
    }
  });

  eventSource.onerror = () => {
    statusCallback?.(false);
    eventSource?.close();
    eventSource = null;
    reconnect();
  };
}

async function reconnect() {
  if (disposed) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (disposed || !changeCallback) return;
    if (watchedProjectPath) {
      try {
        await startFileWatcher(watchedProjectPath);
      } catch {
        // 忽略启动错误，继续重连 SSE
      }
    }
    eventSource = new EventSource(backendUrl("/backend/vibe/file-watcher/stream"));
    bindStreamListeners();
  }, RECONNECT_DELAY);
}

export function connectFileWatcherStream(
  onChanges: FileWatcherChangeCallback,
  onError?: FileWatcherErrorCallback,
  onStatus?: FileWatcherStatusCallback,
): () => void {
  disconnectFileWatcherStream();
  disposed = false;

  changeCallback = onChanges;
  errorCallback = onError || null;
  statusCallback = onStatus || null;

  if (isTauriEnv()) {
    void listen<TauriWatcherPayload>("file-watcher", (event) => {
      if (disposed) return;
      const mapped = mapTauriWatcherPayload(event.payload);
      if (mapped.length === 0) return;
      pendingChanges.push(...mapped);
      scheduleChangeFlush();
    })
      .then((unlisten) => {
        if (disposed) {
          void unlisten();
          return;
        }
        tauriUnlisten = unlisten;
        statusCallback?.(true);
      })
      .catch((error) => {
        statusCallback?.(false);
        errorCallback?.(error instanceof Error ? error.message : "文件监听连接失败");
      });
    return () => {
      disconnectFileWatcherStream();
    };
  }

  if (!isTauriEnv()) {
    statusCallback?.(false);
    return () => {
      disconnectFileWatcherStream();
    };
  }

  eventSource = new EventSource(backendUrl("/backend/vibe/file-watcher/stream"));
  bindStreamListeners();

  return () => {
    disconnectFileWatcherStream();
  };
}

export function disconnectFileWatcherStream(): void {
  disposed = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (changeFlushTimer) {
    clearTimeout(changeFlushTimer);
    changeFlushTimer = null;
  }
  pendingChanges = [];
  if (tauriUnlisten) {
    void tauriUnlisten();
    tauriUnlisten = null;
  }
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  changeCallback = null;
  errorCallback = null;
  statusCallback?.(false);
  statusCallback = null;
  watchedProjectPath = null;
}
