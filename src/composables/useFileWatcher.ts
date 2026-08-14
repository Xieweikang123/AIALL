import { ref } from "vue";
import { debugLog } from "../utils/debugLog";
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

/**
 * Git metadata files that change on branch switch / stash / amend without
 * touching the working tree. Intentionally excludes `.git/index` — `git status`
 * refreshes the index stat cache, so watching it would cause a self-triggering
 * refresh loop.
 */
const GIT_METADATA_PATH_RE =
  /(?:^|[/\\])\.git[/\\](?:HEAD|FETCH_HEAD|ORIG_HEAD|MERGE_HEAD|CHERRY_PICK_HEAD|refs[/\\]|logs[/\\]|packed-refs|rebase-merge|rebase-apply)/;

/** True when a path change only reflects git internal bookkeeping. */
function isGitMetadataPath(path: string): boolean {
  return GIT_METADATA_PATH_RE.test(path);
}

/** Cooldown between git-metadata-triggered status refreshes (avoids rebase churn). */
const GIT_META_REFRESH_COOLDOWN_MS = 1500;

export interface UseFileWatcherOptions {
  onFileChanges?: (changes: FileChangeEvent[]) => void;
  refreshTree?: () => void | Promise<void>;
  isProjectKnowledgeFilePath: (path: string) => boolean;
  onKnowledgeFileChanged: () => void;
  gitStagingInProgress: () => boolean;
  gitLastStagingAt: () => number;
  /** When true, skip git status refresh from watcher (e.g. AI batch grouping). */
  gitRefreshPaused?: () => boolean;
}

export function useFileWatcher(options: UseFileWatcherOptions) {
  const fileWatcherActive = ref(false);
  const fileWatcherConnected = ref(false);
  const fileWatcherCleanup = ref<(() => void) | null>(null);
  let gitRefreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let treeRefreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastGitMetaRefreshAt = 0;

  function scheduleTreeRefreshFromWatcher() {
    if (!options.refreshTree) return;
    if (treeRefreshDebounceTimer) clearTimeout(treeRefreshDebounceTimer);
    treeRefreshDebounceTimer = setTimeout(() => {
      treeRefreshDebounceTimer = null;
      void options.refreshTree?.();
    }, 300);
  }

  function scheduleGitStatusRefreshFromWatcher(
    refreshGitStatus: () => void,
    opts?: { fromGitMetadata?: boolean },
  ) {
    if (gitRefreshDebounceTimer) clearTimeout(gitRefreshDebounceTimer);
    gitRefreshDebounceTimer = setTimeout(() => {
      gitRefreshDebounceTimer = null;
      if (options.gitRefreshPaused?.()) return;
      if (options.gitStagingInProgress()) return;
      if (options.gitLastStagingAt() && Date.now() - options.gitLastStagingAt() < 1500) return;
      if (opts?.fromGitMetadata) {
        if (Date.now() - lastGitMetaRefreshAt < GIT_META_REFRESH_COOLDOWN_MS) return;
        lastGitMetaRefreshAt = Date.now();
      }
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
            const guard3 = Boolean(options.gitRefreshPaused?.());
            if (guard1 || guard2 || guard3) return;
            const gitMetadataChanges = changes.filter((change) => isGitMetadataPath(change.path));
            const relevantChanges = changes.filter(
              (change) =>
                !change.path.includes(".git") && !change.path.includes("node_modules"),
            );
            if (gitMetadataChanges.length > 0) {
              scheduleGitStatusRefreshFromWatcher(refreshGitStatus, { fromGitMetadata: true });
            }
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
            debugLog("File watcher stream error:", error);
          },
          (connected) => {
            fileWatcherConnected.value = connected;
          },
        );
      }
    } catch (e) {
      debugLog("Failed to start file watcher:", e);
    }
  }

  async function stopFileWatcherForProject() {
    if (gitRefreshDebounceTimer) {
      clearTimeout(gitRefreshDebounceTimer);
      gitRefreshDebounceTimer = null;
    }
    if (treeRefreshDebounceTimer) {
      clearTimeout(treeRefreshDebounceTimer);
      treeRefreshDebounceTimer = null;
    }
    if (fileWatcherCleanup.value) {
      fileWatcherCleanup.value();
      fileWatcherCleanup.value = null;
    }
    try {
      await stopFileWatcher();
      fileWatcherActive.value = false;
    } catch (e) {
      debugLog("Failed to stop file watcher:", e);
    }
  }

  return {
    fileWatcherActive,
    fileWatcherConnected,
    startFileWatcherForProject,
    stopFileWatcherForProject,
  };
}
