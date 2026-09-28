import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { GitStatusFile } from "../services/vibeGitClient";
import {
  gitCommitDraftStorageKey,
  readGitCommitDraft,
} from "../utils/gitCommitDraftStorage";
import { useGitPanel } from "./useGitPanel";

const fetchGitStatusMock = vi.hoisted(() => vi.fn());
const fetchGitRemotesMock = vi.hoisted(() => vi.fn());
const fetchGitBranchesMock = vi.hoisted(() => vi.fn());
const gitStashListRemoteMock = vi.hoisted(() => vi.fn());
const fetchAheadCommitsMock = vi.hoisted(() => vi.fn());
const commitGitChangesMock = vi.hoisted(() => vi.fn());

vi.mock("../services/vibeGitClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/vibeGitClient")>();
  return {
    ...actual,
    fetchGitStatus: fetchGitStatusMock,
    fetchGitRemotes: fetchGitRemotesMock,
    fetchGitBranches: fetchGitBranchesMock,
    gitStashListRemote: gitStashListRemoteMock,
    fetchAheadCommits: fetchAheadCommitsMock,
    commitGitChanges: commitGitChangesMock,
  };
});

const PROJECT = "D:/project/demo";
const AI_CONFIG = { endpoint: "http://ai.test", apiKey: "key", model: "test-model" };

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

function stagedFile(path: string): GitStatusFile {
  return {
    path,
    status: "modified",
    indexStatus: "M",
    worktreeStatus: " ",
    staged: true,
  };
}

function gitStagedStatusResult(branch: string, stagedPaths: string[], isRepo = true) {
  return {
    ok: true,
    branch,
    headCommit: "abc123",
    isRepo,
    stagedCount: stagedPaths.length,
    unstagedCount: 0,
    files: stagedPaths.map(stagedFile),
  };
}

function createGitPanel(projectPathValue = PROJECT) {
  const projectPath = ref(projectPathValue);
  return useGitPanel(
    () => projectPath.value,
    () => true,
    () => AI_CONFIG,
    () => true,
    vi.fn().mockResolvedValue(true),
  );
}

function mockGitSideEffects() {
  fetchGitRemotesMock.mockResolvedValue({
    ok: true,
    remotes: [],
    trackingBranch: "",
    ahead: 0,
    behind: 0,
  });
  fetchGitBranchesMock.mockResolvedValue({ ok: true, branches: [] });
  gitStashListRemoteMock.mockResolvedValue({ ok: true, stashes: [] });
  fetchAheadCommitsMock.mockResolvedValue({ ok: true, commits: [] });
}

describe("useGitPanel commit message draft", () => {
  beforeEach(() => {
    installLocalStorageMock();
    vi.clearAllMocks();
    mockGitSideEffects();
    fetchGitStatusMock.mockResolvedValue(gitStagedStatusResult("main", ["src/a.ts"]));
    commitGitChangesMock.mockResolvedValue({ ok: true });
  });

  it("persists commit message to storage on change", async () => {
    const git = createGitPanel();
    await git.refreshGitStatus();

    git.gitCommitMessage.value = "修了登录态偶发丢失";
    await Promise.resolve();

    expect(readGitCommitDraft(PROJECT)).toBe("修了登录态偶发丢失");
  });

  it("simulates page reload via resetGitPanelState then refreshGitStatus", async () => {
    const first = createGitPanel();
    await first.refreshGitStatus();
    first.gitCommitMessage.value = "feat: 新增批量提交";
    await Promise.resolve();
    first.resetGitPanelState();

    const second = createGitPanel();
    await second.refreshGitStatus();

    expect(second.gitCommitMessage.value).toBe("feat: 新增批量提交");
  });

  it("clears stored draft after a successful commit", async () => {
    const git = createGitPanel();
    await git.refreshGitStatus();
    git.gitCommitMessage.value = "chore: 清理草稿";
    await Promise.resolve();
    expect(readGitCommitDraft(PROJECT)).not.toBe("");

    await git.commitGit();
    await Promise.resolve();

    expect(git.gitCommitMessage.value).toBe("");
    expect(readGitCommitDraft(PROJECT)).toBe("");
  });

  it("isolates drafts between different project scopes", async () => {
    const other = "D:/project/other";
    const gitA = createGitPanel(PROJECT);
    await gitA.refreshGitStatus();
    gitA.gitCommitMessage.value = "draft A";
    await Promise.resolve();

    const gitB = createGitPanel(other);
    await gitB.refreshGitStatus();
    gitB.gitCommitMessage.value = "draft B";
    await Promise.resolve();

    expect(gitCommitDraftStorageKey(PROJECT)).not.toBe(gitCommitDraftStorageKey(other));
    expect(readGitCommitDraft(PROJECT)).toBe("draft A");
    expect(readGitCommitDraft(other)).toBe("draft B");

    // Switching back restores the original scope's draft, no cross-bleed.
    const gitA2 = createGitPanel(PROJECT);
    await gitA2.refreshGitStatus();
    expect(gitA2.gitCommitMessage.value).toBe("draft A");
  });
});
