import chokidar, { type FSWatcher } from "node:fs/promises";
import { EventEmitter } from "node:events";

export interface FileChangeEvent {
  type: "add" | "change" | "unlink" | "addDir" | "unlinkDir";
  path: string;
  timestamp: number;
}

export interface FileWatcherOptions {
  ignored?: string[];
  persistent?: boolean;
  ignoreInitial?: boolean;
  followSymlinks?: boolean;
  awaitWriteFinish?: boolean | { stabilityThreshold: number; pollInterval: number };
}

export class FileWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private watchedPaths: Set<string> = new Set();
  private changeBuffer: FileChangeEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private options: FileWatcherOptions;

  constructor(options: FileWatcherOptions = {}) {
    super();
    this.options = {
      ignored: [
        "**/node_modules/**",
        "**/.git/**",
        "**/dist/**",
        "**/.DS_Store",
        "**/Thumbs.db",
        ...(options.ignored || []),
      ],
      persistent: true,
      ignoreInitial: true,
      followSymlinks: false,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      ...options,
    };
  }

  async start(paths: string[]): Promise<void> {
    if (this.watcher) {
      await this.stop();
    }

    const validPaths: string[] = [];
    for (const p of paths) {
      try {
        const stat = await import("node:fs/promises").then((fs) => fs.stat(p));
        if (stat) {
          validPaths.push(p);
          this.watchedPaths.add(p);
        }
      } catch {
        // Skip invalid paths
      }
    }

    if (validPaths.length === 0) {
      return;
    }

    this.watcher = chokidar.watch(validPaths, this.options);

    this.watcher.on("all", (event, path) => {
      const changeEvent: FileChangeEvent = {
        type: event as FileChangeEvent["type"],
        path,
        timestamp: Date.now(),
      };

      this.changeBuffer.push(changeEvent);
      this.scheduleFlush();
    });

    this.watcher.on("error", (error) => {
      this.emit("error", error);
    });
  }

  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    this.watchedPaths.clear();
    this.changeBuffer = [];
  }

  addPath(path: string): void {
    if (!this.watchedPaths.has(path) && this.watcher) {
      this.watcher.add(path);
      this.watchedPaths.add(path);
    }
  }

  removePath(path: string): void {
    if (this.watchedPaths.has(path) && this.watcher) {
      this.watcher.unwatch(path);
      this.watchedPaths.delete(path);
    }
  }

  getWatchedPaths(): string[] {
    return Array.from(this.watchedPaths);
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    this.flushTimer = setTimeout(() => {
      this.flushChanges();
    }, 100);
  }

  private flushChanges(): void {
    if (this.changeBuffer.length === 0) {
      return;
    }

    const changes = [...this.changeBuffer];
    this.changeBuffer = [];

    // Deduplicate changes by path, keeping the latest event for each path
    const uniqueChanges = new Map<string, FileChangeEvent>();
    for (const change of changes) {
      const existing = uniqueChanges.get(change.path);
      if (!existing || change.timestamp > existing.timestamp) {
        uniqueChanges.set(change.path, change);
      }
    }

    const dedupedChanges = Array.from(uniqueChanges.values());
    this.emit("changes", dedupedChanges);
  }

  isWatching(): boolean {
    return this.watcher !== null;
  }
}

// Singleton instance for global file watching
let globalWatcher: FileWatcher | null = null;

export function getGlobalWatcher(): FileWatcher {
  if (!globalWatcher) {
    globalWatcher = new FileWatcher();
  }
  return globalWatcher;
}

export async function startGlobalWatcher(paths: string[]): Promise<FileWatcher> {
  const watcher = getGlobalWatcher();
  await watcher.start(paths);
  return watcher;
}

export async function stopGlobalWatcher(): Promise<void> {
  if (globalWatcher) {
    await globalWatcher.stop();
    globalWatcher = null;
  }
}