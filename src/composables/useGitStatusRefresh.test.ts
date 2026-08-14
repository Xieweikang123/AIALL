import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useGitPanel } from "./useGitPanel";

const fetchGitStatusMock = vi.hoisted(() => vi.fn());
const fetchGitRemotesMock = vi.hoisted(() => vi.fn());
const fetchGitBranchesMock = vi.hoisted(() => vi.fn());
const gitStashListRemoteMock = vi.hoisted(() => vi.fn());
const listIgnoredLocalChangesMock = vi.hoisted(() => vi.fn());

vi.mock("../services/vibeGitClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/vibeGitClient")>();
  return {
    ...actual,
    fetchGitStatus: fetchGitStatusMock,
    fetchGitRemotes: fetchGitRemotesMock,
    fetchGitBranches: fetchGitBranchesMock,
    gitStashListRemote: gitStashListRemoteMock,
    listIgnoredLocalChanges: listIgnoredLocalChangesMock,
  };
});

const PROJECT = "D:/project/demo";

function createGitPanel() {
  const projectPath = ref(PROJECT);
  const projectOpened = ref(true);
  return useGitPanel(
    () => projectPath.value,
    () => projectOpened.value,
    () => ({ endpoint: "", apiKey: "", model: "" }),
    () => false,
    vi.fn().mockResolvedValue(true),
  );
}

function okStatus() {
  return {
    ok: true,
    isRepo: true,
    branch: "main",
    headCommit: "abc123",
    files: [],
    stagedCount: 0,
    unstagedCount: 0,
  };
}

function mockSideEffects() {
  fetchGitRemotesMock.mockResolvedValue({ ok: true, remotes: [], trackingBranch: "", ahead: 0, behind: 0 });
  fetchGitBranchesMock.mockResolvedValue({ ok: true, branches: [], current: "main" });
  gitStashListRemoteMock.mockResolvedValue({ ok: true, stashes: [] });
  listIgnoredLocalChangesMock.mockResolvedValue({ ok: true, ignored: [] });
}

describe("useGitStatusRefresh loading-starve guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSideEffects();
  });

  it("coalesces rapid refreshes during a slow fetch so first load cannot starve", async () => {
    const git = createGitPanel();

    let resolveFirst!: (v: unknown) => void;
    fetchGitStatusMock.mockReturnValueOnce(new Promise((r) => (resolveFirst = r)));
    fetchGitStatusMock.mockResolvedValue(okStatus());

    // 模拟文件 watcher 高频触发：首个请求还没回来，又来了两个
    const p1 = git.refreshGitStatus();
    const p2 = git.refreshGitStatus();
    const p3 = git.refreshGitStatus();

    // 合并生效：慢请求期间只有一次真实 git 调用（后两个被合并，不顶 token）
    expect(fetchGitStatusMock).toHaveBeenCalledTimes(1);
    expect(git.gitLoading.value).toBe(true);
    expect(git.gitStatusKnown.value).toBe(false);

    resolveFirst!(okStatus());
    await Promise.all([p1, p2, p3]);

    // 慢请求回来即置位 + 结束 loading（不会再「正在加载…」卡死）
    expect(git.gitStatusKnown.value).toBe(true);
    expect(git.gitLoading.value).toBe(false);
    // 合并后补跑一次，覆盖 in-flight 期间的新变动
    expect(fetchGitStatusMock).toHaveBeenCalledTimes(2);
  });

  it("sequential refreshes still work normally", async () => {
    const git = createGitPanel();
    fetchGitStatusMock.mockResolvedValue(okStatus());

    await git.refreshGitStatus();
    expect(git.gitStatusKnown.value).toBe(true);
    expect(fetchGitStatusMock).toHaveBeenCalledTimes(1);

    await git.refreshGitStatus({ force: true });
    expect(fetchGitStatusMock).toHaveBeenCalledTimes(2);
  });

  it("backslash vs forward-slash path representation does not discard the refresh", async () => {
    const git = createGitPanel();

    let resolveFetch!: (v: unknown) => void;
    fetchGitStatusMock.mockReturnValueOnce(new Promise((r) => (resolveFetch = r)));

    // 刷新开始时 gitActiveRepoPath 是反斜杠原生路径（Rust 返回），
    // fetch 进行中被清空 → 取正斜杠的 projectPath
    git.gitActiveRepoPath.value = "D:\\project\\demo";
    const p = git.refreshGitStatus();
    expect(git.gitLoading.value).toBe(true);

    git.gitActiveRepoPath.value = "";
    resolveFetch!(okStatus());
    await p;

    // 同一目录不同分隔符不应判 stale：结果必须应用、loading 必须结束
    expect(git.gitStatusKnown.value).toBe(true);
    expect(git.gitLoading.value).toBe(false);
    expect(git.gitBranch.value).toBe("main");
  });
});
