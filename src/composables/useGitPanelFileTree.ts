import { ref, watch, computed, type Ref } from "vue";
import { buildGitFileTree, collectGitFolderPaths } from "../utils/gitFileTree";
import { parseGitFileSelectionKey } from "../utils/gitHelpers";
import { lsGetJson, lsSetJson } from "../utils/localStorageSafe";

export interface GitPanelFileInput {
  path: string;
  status: string;
  staged: boolean;
}

export type GitChangesViewMode = "tree" | "flat";

const GIT_CHANGES_VIEW_MODE_KEY = "aiall-git-changes-view-mode";

export function useGitPanelFileTree(
  gitStagedFiles: Ref<GitPanelFileInput[]>,
  gitUnstagedFiles: Ref<GitPanelFileInput[]>,
  gitConflictedFiles: Ref<GitPanelFileInput[]>,
  gitStagedOpen: Ref<boolean>,
  gitUnstagedOpen: Ref<boolean>,
  gitUntrackedOpen: Ref<boolean>,
  selectedGitFiles: Ref<string[]>,
) {
  const gitStagedExpandedDirs = ref<Set<string>>(new Set());
  const gitModifiedExpandedDirs = ref<Set<string>>(new Set());
  const gitUntrackedExpandedDirs = ref<Set<string>>(new Set());
  const gitStagedKnownDirs = ref<Set<string>>(new Set());
  const gitModifiedKnownDirs = ref<Set<string>>(new Set());
  const gitUntrackedKnownDirs = ref<Set<string>>(new Set());

  const gitChangesViewMode = ref<GitChangesViewMode>(
    lsGetJson<GitChangesViewMode>(GIT_CHANGES_VIEW_MODE_KEY, "tree"),
  );

  function setGitChangesViewMode(mode: GitChangesViewMode) {
    gitChangesViewMode.value = mode;
    lsSetJson(GIT_CHANGES_VIEW_MODE_KEY, mode);
  }

  const gitModifiedFiles = computed(() =>
    gitUnstagedFiles.value.filter((f) => f.status !== "untracked"),
  );
  const gitUntrackedFiles = computed(() =>
    gitUnstagedFiles.value.filter((f) => f.status === "untracked"),
  );

  const gitStagedTree = computed(() => buildGitFileTree(gitStagedFiles.value));
  const gitModifiedTree = computed(() => buildGitFileTree(gitModifiedFiles.value));
  const gitUntrackedTree = computed(() => buildGitFileTree(gitUntrackedFiles.value));

  const uniqueChangeCount = computed(() => {
    const paths = new Set<string>();
    for (const f of gitStagedFiles.value) paths.add(f.path);
    for (const f of gitUnstagedFiles.value) paths.add(f.path);
    for (const f of gitConflictedFiles.value) paths.add(f.path);
    return paths.size;
  });

  const selectedCanStage = computed(() =>
    selectedGitFiles.value.some((key) => {
      const parsed = parseGitFileSelectionKey(key);
      return !!parsed && !parsed.staged && gitUnstagedFiles.value.some((f) => f.path === parsed.path);
    }),
  );
  const selectedCanUnstage = computed(() =>
    selectedGitFiles.value.some((key) => {
      const parsed = parseGitFileSelectionKey(key);
      return !!parsed && parsed.staged && gitStagedFiles.value.some((f) => f.path === parsed.path);
    }),
  );
  const selectedCanDiscard = computed(() => selectedCanStage.value);

  const hasExpandedFileList = computed(
    () =>
      gitConflictedFiles.value.length > 0
      || (gitStagedOpen.value && gitStagedFiles.value.length > 0)
      || (gitUnstagedOpen.value && gitModifiedFiles.value.length > 0)
      || (gitUntrackedOpen.value && gitUntrackedFiles.value.length > 0),
  );

  type GitTreeKind = "staged" | "modified" | "untracked";

  function expandedDirsFor(kind: GitTreeKind) {
    if (kind === "staged") return gitStagedExpandedDirs;
    if (kind === "modified") return gitModifiedExpandedDirs;
    return gitUntrackedExpandedDirs;
  }

  function toggleGitTreeDir(path: string, kind: GitTreeKind) {
    const dirs = expandedDirsFor(kind);
    const next = new Set(dirs.value);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    dirs.value = next;
  }

  function syncExpandedDirs(
    tree: ReturnType<typeof buildGitFileTree>,
    target: typeof gitStagedExpandedDirs,
    known: typeof gitStagedKnownDirs,
  ) {
    const folderPaths = new Set(collectGitFolderPaths(tree));
    const prev = target.value;
    const next = new Set<string>();
    for (const path of folderPaths) {
      if (!known.value.has(path)) next.add(path);
      else if (prev.has(path)) next.add(path);
    }
    known.value = new Set(folderPaths);
    target.value = next;
  }

  watch(
    () => gitStagedFiles.value.map((f) => f.path).join("\n"),
    () => syncExpandedDirs(gitStagedTree.value, gitStagedExpandedDirs, gitStagedKnownDirs),
    { immediate: true },
  );
  watch(
    () => gitModifiedFiles.value.map((f) => f.path).join("\n"),
    () => syncExpandedDirs(gitModifiedTree.value, gitModifiedExpandedDirs, gitModifiedKnownDirs),
    { immediate: true },
  );
  watch(
    () => gitUntrackedFiles.value.map((f) => f.path).join("\n"),
    () => syncExpandedDirs(gitUntrackedTree.value, gitUntrackedExpandedDirs, gitUntrackedKnownDirs),
    { immediate: true },
  );

  return {
    gitModifiedFiles,
    gitUntrackedFiles,
    gitStagedTree,
    gitModifiedTree,
    gitUntrackedTree,
    uniqueChangeCount,
    selectedCanStage,
    selectedCanUnstage,
    selectedCanDiscard,
    hasExpandedFileList,
    gitStagedExpandedDirs,
    gitModifiedExpandedDirs,
    gitUntrackedExpandedDirs,
    toggleGitTreeDir,
    gitChangesViewMode,
    setGitChangesViewMode,
  };
}
