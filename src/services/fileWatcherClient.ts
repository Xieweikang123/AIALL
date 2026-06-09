import { backendUrl } from "./backendBase";

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

export async function startFileWatcher(
  projectPath: string,
  watchPaths?: string[]
): Promise<FileWatcherStartResult> {
  try {
    const url = backendUrl("/backend/vibe/file-watcher/start");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath, watchPaths }),
    });
    return await response.json();
  } catch (error) {
    return {
      ok: false,
      message: "",
      watchedPaths: [],
      error: error instanceof Error ? error.message : "启动文件监听失败",
    };
  }
}

export async function stopFileWatcher(): Promise<FileWatcherStopResult> {
  try {
    const url = backendUrl("/backend/vibe/file-watcher/stop");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    return await response.json();
  } catch (error) {
    return {
      ok: false,
      message: "",
      error: error instanceof Error ? error.message : "停止文件监听失败",
    };
  }
}

export type FileWatcherChangeCallback = (changes: FileChangeEvent[]) => void;
export type FileWatcherErrorCallback = (error: string) => void;
export type FileWatcherStatusCallback = (connected: boolean) => void;

let eventSource: EventSource | null = null;
let changeCallback: FileWatcherChangeCallback | null = null;
let errorCallback: FileWatcherErrorCallback | null = null;
let statusCallback: FileWatcherStatusCallback | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let disposed = false;

const RECONNECT_DELAY = 3000;

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

function reconnect() {
  if (disposed) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (disposed || !changeCallback) return;
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
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  changeCallback = null;
  errorCallback = null;
}