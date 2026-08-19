import { ref } from "vue";
import {
  fetchGitStatus,
  fetchGitRemotes,
  gitFetchRemote,
  gitPullRemote,
  gitPushRemote,
  stageGitFiles,
  unstageGitFiles,
  discardGitFiles,
  type GitRepoInfo,
  type GitStatusFile,
} from "../../services/vibeGitClient";

export interface MultiRepoEntry {
  repo: GitRepoInfo;
  branch: string;
  headCommit: string;
  files: GitStatusFile[];
  isRepo: boolean;
  stagedCount: number;
  unstagedCount: number;
  ahead: number;
  behind: number;
  trackingBranch: string;
  error: string;
  loading: boolean;
}

export function useGitMultiRepoOverview(options: {
  gitRepos: () => GitRepoInfo[];
  projectOpened: () => boolean;
}) {
  const { gitRepos, projectOpened } = options;
  const entries = ref<MultiRepoEntry[]>([]);
  const overviewLoading = ref(false);
  const overviewError = ref("");
  const expandedRepos = ref<Set<string>>(new Set());

  function normalizePath(p: string): string {
    return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  }

  function isExpanded(repoPath: string): boolean {
    return expandedRepos.value.has(normalizePath(repoPath));
  }

  function toggleExpanded(repoPath: string) {
    const key = normalizePath(repoPath);
    const next = new Set(expandedRepos.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedRepos.value = next;
  }

  async function refreshMultiRepoOverview() {
    if (!projectOpened()) return;
    const repos = gitRepos();
    if (!repos.length) {
      entries.value = [];
      return;
    }
    overviewLoading.value = true;
    overviewError.value = "";
    try {
      // seed entries with loading states so UI shows skeletons per card
      entries.value = repos.map((r) => ({
        repo: r,
        branch: "",
        headCommit: "",
        files: [],
        isRepo: false,
        stagedCount: 0,
        unstagedCount: 0,
        ahead: 0,
        behind: 0,
        trackingBranch: "",
        error: "",
        loading: true,
      }));

      const results = await Promise.all(
        repos.map(async (repo) => {
          try {
            const [statusRes, remotesRes] = await Promise.all([
              fetchGitStatus(repo.path),
              fetchGitRemotes(repo.path).catch(() => ({ ok: false, ahead: 0, behind: 0, trackingBranch: "", remotes: [] }) as never),
            ]);
            const ahead = remotesRes && `ahead` in remotesRes && typeof (remotesRes as { ahead: number }).ahead === "number" ? (remotesRes as { ahead: number }).ahead : 0;
            const behind = remotesRes && `behind` in remotesRes && typeof (remotesRes as { behind: number }).behind === "number" ? (remotesRes as { behind: number }).behind : 0;
            const trackingBranch = remotesRes && `trackingBranch` in remotesRes ? String((remotesRes as { trackingBranch: string }).trackingBranch || "") : "";
            if (!statusRes.ok) {
              return {
                repo,
                branch: statusRes.branch || "",
                headCommit: statusRes.headCommit || "",
                files: [],
                isRepo: statusRes.isRepo,
                stagedCount: 0,
                unstagedCount: 0,
                ahead,
                behind,
                trackingBranch,
                error: statusRes.error || "获取失败",
                loading: false,
              } as MultiRepoEntry;
            }
            return {
              repo,
              branch: statusRes.branch,
              headCommit: statusRes.headCommit || "",
              files: statusRes.files,
              isRepo: statusRes.isRepo,
              stagedCount: statusRes.stagedCount,
              unstagedCount: statusRes.unstagedCount,
              ahead,
              behind,
              trackingBranch,
              error: "",
              loading: false,
            } as MultiRepoEntry;
          } catch (e) {
            return {
              repo,
              branch: "",
              headCommit: "",
              files: [],
              isRepo: false,
              stagedCount: 0,
              unstagedCount: 0,
              ahead: 0,
              behind: 0,
              trackingBranch: "",
              error: e instanceof Error ? e.message : "网络错误",
              loading: false,
            } as MultiRepoEntry;
          }
        }),
      );
      entries.value = results;
    } catch (e) {
      overviewError.value = e instanceof Error ? e.message : "加载总览失败";
    } finally {
      overviewLoading.value = false;
    }
  }

  async function refreshSingleRepo(repoPath: string) {
    const idx = entries.value.findIndex((e) => normalizePath(e.repo.path) === normalizePath(repoPath));
    if (idx < 0) return;
    entries.value[idx] = { ...entries.value[idx], loading: true };
    try {
      const [statusRes, remotesRes] = await Promise.all([
        fetchGitStatus(repoPath),
        fetchGitRemotes(repoPath).catch(() => ({ ok: false, ahead: 0, behind: 0, trackingBranch: "" }) as never),
      ]);
      const ahead = remotesRes && `ahead` in remotesRes ? Number((remotesRes as { ahead: number }).ahead || 0) : 0;
      const behind = remotesRes && `behind` in remotesRes ? Number((remotesRes as { behind: number }).behind || 0) : 0;
      const trackingBranch = remotesRes && `trackingBranch` in remotesRes ? String((remotesRes as { trackingBranch: string }).trackingBranch || "") : "";
      entries.value[idx] = {
        repo: entries.value[idx].repo,
        branch: statusRes.branch || entries.value[idx].branch,
        headCommit: statusRes.headCommit || "",
        files: statusRes.ok ? statusRes.files : [],
        isRepo: statusRes.isRepo,
        stagedCount: statusRes.stagedCount ?? 0,
        unstagedCount: statusRes.unstagedCount ?? 0,
        ahead,
        behind,
        trackingBranch,
        error: statusRes.ok ? "" : statusRes.error || "获取失败",
        loading: false,
      };
    } catch (e) {
      entries.value[idx] = {
        ...entries.value[idx],
        error: e instanceof Error ? e.message : "网络错误",
        loading: false,
      };
    }
  }

  async function stageFile(repoPath: string, filePath: string) {
    const r = await stageGitFiles(repoPath, [filePath]);
    if (r.ok) await refreshSingleRepo(repoPath);
    return r;
  }

  async function unstageFile(repoPath: string, filePath: string) {
    const r = await unstageGitFiles(repoPath, [filePath]);
    if (r.ok) await refreshSingleRepo(repoPath);
    return r;
  }

  async function discardFile(repoPath: string, filePath: string) {
    const r = await discardGitFiles(repoPath, [filePath]);
    if (r.ok) await refreshSingleRepo(repoPath);
    return r;
  }

  async function stageAll(repoPath: string) {
    const entry = entries.value.find((e) => normalizePath(e.repo.path) === normalizePath(repoPath));
    if (!entry) return { ok: false, error: "未找到仓库" };
    const files = entry.files.filter((f) => !f.staged && f.status !== "conflicted").map((f) => f.path);
    if (!files.length) return { ok: true };
    const r = await stageGitFiles(repoPath, files);
    if (r.ok) await refreshSingleRepo(repoPath);
    return r;
  }

  async function unstageAll(repoPath: string) {
    const entry = entries.value.find((e) => normalizePath(e.repo.path) === normalizePath(repoPath));
    if (!entry) return { ok: false, error: "未找到仓库" };
    const files = entry.files.filter((f) => f.staged).map((f) => f.path);
    if (!files.length) return { ok: true };
    const r = await unstageGitFiles(repoPath, files);
    if (r.ok) await refreshSingleRepo(repoPath);
    return r;
  }

  async function pullRepo(repoPath: string) {
    const idx = entries.value.findIndex((e) => normalizePath(e.repo.path) === normalizePath(repoPath));
    if (idx >= 0) entries.value[idx] = { ...entries.value[idx], loading: true };
    try {
      const r = await gitPullRemote(repoPath);
      if (!r.ok) {
        if (idx >= 0) entries.value[idx] = { ...entries.value[idx], loading: false, error: r.error || "拉取失败" };
        return r;
      }
      await refreshSingleRepo(repoPath);
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "拉取异常";
      if (idx >= 0) entries.value[idx] = { ...entries.value[idx], loading: false, error: msg };
      return { ok: false, error: msg } as const;
    }
  }

  async function pushRepo(repoPath: string) {
    const idx = entries.value.findIndex((e) => normalizePath(e.repo.path) === normalizePath(repoPath));
    if (idx >= 0) entries.value[idx] = { ...entries.value[idx], loading: true };
    try {
      const r = await gitPushRemote(repoPath);
      if (!r.ok) {
        if (idx >= 0) entries.value[idx] = { ...entries.value[idx], loading: false, error: r.error || "推送失败" };
        return r;
      }
      await refreshSingleRepo(repoPath);
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "推送异常";
      if (idx >= 0) entries.value[idx] = { ...entries.value[idx], loading: false, error: msg };
      return { ok: false, error: msg } as const;
    }
  }

  async function fetchRepo(repoPath: string) {
    const idx = entries.value.findIndex((e) => normalizePath(e.repo.path) === normalizePath(repoPath));
    if (idx >= 0) entries.value[idx] = { ...entries.value[idx], loading: true };
    try {
      const r = await gitFetchRemote(repoPath);
      if (!r.ok) {
        if (idx >= 0) entries.value[idx] = { ...entries.value[idx], loading: false, error: r.error || "抓取失败" };
        return r;
      }
      await refreshSingleRepo(repoPath);
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "抓取异常";
      if (idx >= 0) entries.value[idx] = { ...entries.value[idx], loading: false, error: msg };
      return { ok: false, error: msg } as const;
    }
  }

  return {
    entries,
    overviewLoading,
    overviewError,
    expandedRepos,
    isExpanded,
    toggleExpanded,
    refreshMultiRepoOverview,
    refreshSingleRepo,
    stageFile,
    unstageFile,
    discardFile,
    stageAll,
    unstageAll,
    pullRepo,
    pushRepo,
    fetchRepo,
  };
}
