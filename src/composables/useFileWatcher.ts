import { ref } from "vue";
import {
  startFileWatcher,
  stopFileWatcher,
  connectFileWatcherStream,
  type FileChangeEvent,
} from "../services/fileWatcherClient";

const TREE_STRUCTURAL_CHANGE_TYPES = new Set<FileChangeEvent["type"]>([
  "add",
  "unlink",
  "addDir",
  "unlinkDir",
]);

export interface UseFileWatcherOptions {
  onFileChanges?: (changes: FileChangeEvent[]) => void;
  refreshTree?: () => void | Promise<void>;
  isProjectKnowledgeFilePath: (path: string) => boolean;
  onKnowledgeFileChanged: () => void;
  gitStagingInProgress: () => boolean;
  gitLastStagingAt: () => number;
}

export function useFileWatcher(options: UseFileWatcherOptions) {
  const fileWatcherActive = ref(false);
  const fileWatcherConnected = ref(false);
  const fileWatcherCleanup = ref<(() => void) | null>(null);
  let gitRefreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let treeRefreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleTreeRefreshFromWatcher() {
    if (!options.refreshTree) return;
    if (treeRefreshDebounceTimer) clearTimeout(treeRefreshDebounceTimer);
    treeRefreshDebounceTimer = setTimeout(() => {
      treeRefreshDebounceTimer = null;
      void options.refreshTree?.();
    }, 300);
  }

  function scheduleGitStatusRefreshFromWatcher(refreshGitStatus: () => void) {
    if (gitRefreshDebounceTimer) clearTimeout(gitRefreshDebounceTimer);
    gitRefreshDebounceTimer = setTimeout(() => {
      gitRefreshDebounceTimer = null;
      if (options.gitStagingInProgress()) return;
      if (options.gitLastStagingAt() && Date.now() - options.gitLastStagingAt() < 1500) return;
      refreshGitStatus();
    }, 300);
  }

  async function startFileWatcherForProject(
    projectPath: string,
    refreshGitStatus: () => void,
  ) {
    try {
      const result = await startFileWatcher(projectPath);
      if (result.ok) {
        fileWatcherActive.value = true;
        fileWatcherCleanup.value = connectFileWatcherStream(
          (changes) => {
            const guard1 = options.gitStagingInProgress();
            const guard2 = Date.now() - options.gitLastStagingAt() < 500;
            if (guard1 || guard2) return;
            const relevantChanges = changes.filter(
              (change) => !change.path.includes(".git") && !change.path.includes("node_modules"),
            );
            if (relevantChanges.length > 0) {
              scheduleGitStatusRefreshFromWatcher(refreshGitStatus);
              const treeChanges = relevantChanges.filter((change) =>
                TREE_STRUCTURAL_CHANGE_TYPES.has(change.type),
              );
              if (treeChanges.length > 0) {
                scheduleTreeRefreshFromWatcher();
                options.onFileChanges?.(treeChanges);
              }
              if (relevantChanges.some((change) => options.isProjectKnowledgeFilePath(change.path))) {
                options.onKnowledgeFileChanged();
              }
            }
          },
          (error) => {
            console.error("File watcher stream error:", error);
          },
          (connected) => {
            fileWatcherConnected.value = connected;
          },
        );
      }
    } catch (e) {
      console.error("Failed to start file watcher:", e);
    }
  }

  async function stopFileWatcherForProject() {
    if (fileWatcherCleanup.value) {
      fileWatcherCleanup.value();
      fileWatcherCleanup.value = null;
    }
    try {
      await stopFileWatcher();
      fileWatcherActive.value = false;
    } catch (e) {
      console.error("Failed to stop file watcher:", e);
    }
  }

  return {
    fileWatcherActive,
    fileWatcherConnected,
    startFileWatcherForProject,
    stopFileWatcherForProject,
  };
}
