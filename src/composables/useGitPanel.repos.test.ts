import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useGitPanel } from "./useGitPanel";

const fetchGitStatusMock = vi.hoisted(() => vi.fn());
const fetchGitReposMock = vi.hoisted(() => vi.fn());
const fetchGitRemotesMock = vi.hoisted(() => vi.fn());
const fetchGitBranchesMock = vi.hoisted(() => vi.fn());
const gitStashListRemoteMock = vi.hoisted(() => vi.fn());
const fetchAheadCommitsMock = vi.hoisted(() => vi.fn());
const listIgnoredLocalChangesMock = vi.hoisted(() => vi.fn());

vi.mock("../services/vibeGitClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/vibeGitClient")>();
  return {
    ...actual,
    fetchGitStatus: fetchGitStatusMock,
    fetchGitRepos: fetchGitReposMock,
    fetchGitRemotes: fetchGitRemotesMock,
    fetchGitBranches: fetchGitBranchesMock,
    gitStashListRemote: gitStashListRemoteMock,
    fetchAheadCommits: fetchAheadCommitsMock,
    listIgnoredLocalChanges: listIgnoredLocalChangesMock,
  };
});

const ROOT = "D:/project/multi";
const NESTED_A = "D:/project/multi/nested/repoA";
const NESTED_B = "D:/project/multi/nested/repoB";

function installLocalStorageMock() {
  const storage: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key in storage ? storage[key] : null),
    setItem: (key: string, value: string) => {
      storage[key] = value;
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
    clear: () => {
      for (const key of Object.keys(storage)) delete storage[key];
    },
    key: (index: number) => Object.keys(storage)[index] ?? null,
    get length() {
      return Object.keys(storage).length;
    },
  });
  return storage;
}

function createGitPanel() {
  const projectPath = ref(ROOT);
  const projectOpened = ref(true);
  return useGitPanel(
    () => projectPath.value,
    () => projectOpened.value,
    () => ({ endpoint: "", apiKey: "", model: "" }),
    () => false,
    vi.fn().mockResolvedValue(true),
  );
}

function multiRepoResult() {
  return {
    ok: true,
    repos: [
      { path: ROOT, name: "multi", relPath: "", isRoot: true },
      { path: NESTED_A, name: "repoA", relPath: "nested/repoA", isRoot: false },
      { path: NESTED_B, name: "repoB", relPath: "nested/repoB", isRoot: false },
    ],
  };
}

function statusResult(isRepo: boolean, branch: string) {
  return {
    ok: true,
    isRepo,
    branch,
    headCommit: "abc123",
    stagedCount: 0,
    unstagedCount: 0,
    files: [],
  };
}

describe("useGitPanel multi-repo", () => {
  beforeEach(() => {
    installLocalStorageMock();
    vi.clearAllMocks();
    fetchGitReposMock.mockResolvedValue(multiRepoResult());
    fetchGitStatusMock.mockResolvedValue(statusResult(true, "main"));
    fetchGitRemotesMock.mockResolvedValue({ ok: true, remotes: [], trackingBranch: "", ahead: 0, behind: 0 });
    fetchGitBranchesMock.mockResolvedValue({ ok: true, branches: [] });
    gitStashListRemoteMock.mockResolvedValue({ ok: true, stashes: [] });
    fetchAheadCommitsMock.mockResolvedValue({ ok: true, commits: [] });
    listIgnoredLocalChangesMock.mockResolvedValue({ ok: true, ignored: [] });
  });

  it("refreshGitRepos lists repos and defaults to the project-root repo", async () => {
    const git = createGitPanel();
    await git.refreshGitRepos();

    expect(git.gitRepos.value).toHaveLength(3);
    expect(git.gitActiveRepoPath.value).toBe(ROOT);
  });

  it("refreshGitRepos keeps a persisted valid selection", async () => {
    const storage = installLocalStorageMock();
    storage[`vibe-coding-git-active-repo:${ROOT}`] = NESTED_B;
    const git = createGitPanel();
    await git.refreshGitRepos();

    expect(git.gitActiveRepoPath.value).toBe(NESTED_B);
    expect(fetchGitStatusMock).toHaveBeenCalledWith(NESTED_B);
  });

  it("switchGitRepo switches active repo and refreshes status at that path", async () => {
    const git = createGitPanel();
    await git.refreshGitRepos();
    fetchGitStatusMock.mockClear();

    git.switchGitRepo(NESTED_A);
    await vi.waitFor(() => {
      expect(fetchGitStatusMock).toHaveBeenCalledWith(NESTED_A);
    });

    expect(git.gitActiveRepoPath.value).toBe(NESTED_A);
  });

  it("switchGitRepo to the same repo is a no-op", async () => {
    const git = createGitPanel();
    await git.refreshGitRepos();
    fetchGitStatusMock.mockClear();

    git.switchGitRepo(ROOT);
    await Promise.resolve();

    expect(fetchGitStatusMock).not.toHaveBeenCalled();
  });

  it("resetGitPanelState clears repos and active repo", async () => {
    const git = createGitPanel();
    await git.refreshGitRepos();
    expect(git.gitRepos.value.length).toBeGreaterThan(0);

    git.resetGitPanelState();

    expect(git.gitRepos.value).toEqual([]);
    expect(git.gitActiveRepoPath.value).toBe("");
  });
});
