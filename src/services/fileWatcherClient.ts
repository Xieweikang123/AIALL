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

let eventSource: EventSource | null = null;
let changeCallback: FileWatcherChangeCallback | null = null;
let errorCallback: FileWatcherErrorCallback | null = null;

export function connectFileWatcherStream(
  onChanges: FileWatcherChangeCallback,
  onError?: FileWatcherErrorCallback
): () => void {
  // Disconnect existing connection
  disconnectFileWatcherStream();

  changeCallback = onChanges;
  errorCallback = onError || null;

  const url = backendUrl("/backend/vibe/file-watcher/stream");
  eventSource = new EventSource(url);

  eventSource.addEventListener("status", (event) => {
    const data = JSON.parse(event.data);
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
    }
  });

  eventSource.onerror = () => {
    errorCallback?.("文件监听连接错误");
  };

  // Return cleanup function
  return () => {
    disconnectFileWatcherStream();
  };
}

export function disconnectFileWatcherStream(): void {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  changeCallback = null;
  errorCallback = null;
}