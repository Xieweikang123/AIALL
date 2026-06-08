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

export interface FileWatcherChangesResult {
  ok: boolean;
  changes: FileChangeEvent[];
  isWatching: boolean;
  watchedPaths: string[];
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

export async function getFileWatcherChanges(): Promise<FileWatcherChangesResult> {
  try {
    const url = backendUrl("/backend/vibe/file-watcher/changes");
    const response = await fetch(url);
    return await response.json();
  } catch (error) {
    return {
      ok: false,
      changes: [],
      isWatching: false,
      watchedPaths: [],
      error: error instanceof Error ? error.message : "获取文件变化失败",
    };
  }
}