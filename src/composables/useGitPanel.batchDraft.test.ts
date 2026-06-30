import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { GitStatusFile } from "../services/vibeGitClient";
import {
  readGitBatchDraft,
  removeGitBatchDraft,
  writeGitBatchDraft,
} from "../utils/gitBatchDraftStorage";
import { useGitPanel } from "./useGitPanel";

const fetchGitStatusMock = vi.hoisted(() => vi.fn());
const fetchGitRemotesMock = vi.hoisted(() => vi.fn());
const fetchGitBranchesMock = vi.hoisted(() => vi.fn());
const gitStashListRemoteMock = vi.hoisted(() => vi.fn());
const fetchAheadCommitsMock = vi.hoisted(() => vi.fn());
const aiBatchGroupsMock = vi.hoisted(() => vi.fn());

vi.mock("../services/vibeGitClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/vibeGitClient")>();
  return {
    ...actual,
    fetchGitStatus: fetchGitStatusMock,
    fetchGitRemotes: fetchGitRemotesMock,
    fetchGitBranches: fetchGitBranchesMock,
    gitStashListRemote: gitStashListRemoteMock,
    fetchAheadCommits: fetchAheadCommitsMock,
    aiBatchGroups: aiBatchGroupsMock,
  };
});

const PROJECT = "D:/project/demo";
const AI_CONFIG = { endpoint: "http://ai.test", apiKey: "key", model: "test-model" };
const AI_GROUPS = [
  { name: "pkg", files: ["pkg/a.ts"], message: "feat(pkg): update a" },
  { name: "src", files: ["src/b.ts"], message: "feat(src): update b" },
];

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

function unstagedFile(path: string): GitStatusFile {
  return {
    path,
    status: "modified",
    indexStatus: " ",
    worktreeStatus: "M",
    staged: false,
  };
}

function gitStatusResult(branch: string, unstagedPaths: string[]) {
  return {
    ok: true,
    branch,
    headCommit: "abc123",
    isRepo: true,
    stagedCount: 0,
    unstagedCount: unstagedPaths.length,
    files: unstagedPaths.map(unstagedFile),
  };
}

function createGitPanel(ai = { endpoint: "", apiKey: "", model: "" }) {
  const projectPath = ref(PROJECT);
  const projectOpened = ref(true);
  return useGitPanel(
    () => projectPath.value,
    () => projectOpened.value,
    () => ai,
    () => Boolean(ai.endpoint.trim() && ai.model.trim()),
    vi.fn().mockResolvedValue(true),
  );
}

async function runGenerateAiBatchGroups(git: ReturnType<typeof createGitPanel>) {
  vi.useFakeTimers();
  try {
    const run = git.generateAiBatchGroups();
    await vi.runAllTimersAsync();
    await run;
  } finally {
    vi.useRealTimers();
  }
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

describe("useGitPanel batch draft", () => {
  beforeEach(() => {
    installLocalStorageMock();
    vi.clearAllMocks();
    mockGitSideEffects();
    removeGitBatchDraft(PROJECT, "main");
    removeGitBatchDraft(PROJECT, "dev");
  });

  it("restores persisted draft after refreshGitStatus", async () => {
    writeGitBatchDraft(PROJECT, "main", {
      unstagedPaths: ["src/a.ts"],
      groups: [{ name: "core", files: ["src/a.ts"], message: "ai hint" }],
      messages: ["feat: core change"],
      sectionOpen: true,
    });
    fetchGitStatusMock.mockResolvedValue(gitStatusResult("main", ["src/a.ts"]));

    const git = createGitPanel();
    await git.refreshGitStatus();

    expect(git.batchMessages.value).toEqual(["feat: core change"]);
    expect(git.batchSectionOpen.value).toBe(true);
    expect(git.batchGroupsFromAi.value).toBe(true);
    expect(git.batchGroups.value[0]?.dir).toBe("core");
  });

  it("simulates page reload via resetGitPanelState then refreshGitStatus", async () => {
    writeGitBatchDraft(PROJECT, "main", {
      unstagedPaths: ["pkg/a.ts", "src/b.ts"],
      groups: null,
      messages: ["update a", "update b"],
      sectionOpen: false,
    });
    fetchGitStatusMock.mockResolvedValue(gitStatusResult("main", ["pkg/a.ts", "src/b.ts"]));

    const git = createGitPanel();
    await git.refreshGitStatus();
    git.resetGitPanelState();
    await git.refreshGitStatus();

    expect(git.batchMessages.value).toEqual(["update a", "update b"]);
    expect(git.batchSectionOpen.value).toBe(false);
  });

  it("persists edited batch messages via flushBatchDraftPersist", async () => {
    fetchGitStatusMock.mockResolvedValue(gitStatusResult("main", ["src/a.ts"]));

    const git = createGitPanel();
    await git.refreshGitStatus();
    git.batchMessages.value = ["custom commit message"];
    git.batchSectionOpen.value = true;
    git.flushBatchDraftPersist();

    expect(readGitBatchDraft(PROJECT, "main")).toMatchObject({
      messages: ["custom commit message"],
      sectionOpen: true,
      unstagedPaths: ["src/a.ts"],
    });
  });

  it("isolates drafts per branch when branch changes", async () => {
    writeGitBatchDraft(PROJECT, "main", {
      unstagedPaths: ["src/a.ts"],
      groups: null,
      messages: ["main draft"],
      sectionOpen: true,
    });
    writeGitBatchDraft(PROJECT, "dev", {
      unstagedPaths: ["src/feature.ts"],
      groups: null,
      messages: ["dev draft"],
      sectionOpen: false,
    });

    fetchGitStatusMock.mockResolvedValueOnce(gitStatusResult("main", ["src/a.ts"]));
    const git = createGitPanel();
    await git.refreshGitStatus();
    expect(git.batchMessages.value).toEqual(["main draft"]);
    expect(git.batchSectionOpen.value).toBe(true);

    fetchGitStatusMock.mockResolvedValueOnce(gitStatusResult("dev", ["src/feature.ts"]));
    await git.refreshGitStatus();
    expect(git.batchMessages.value).toEqual(["dev draft"]);
    expect(git.batchSectionOpen.value).toBe(false);
    expect(readGitBatchDraft(PROJECT, "main")?.messages).toEqual(["main draft"]);
  });

  it("keeps draft in storage when git status fetch fails", async () => {
    writeGitBatchDraft(PROJECT, "main", {
      unstagedPaths: ["src/a.ts"],
      groups: null,
      messages: ["keep me"],
      sectionOpen: true,
    });
    fetchGitStatusMock.mockResolvedValue({
      ok: false,
      branch: "",
      headCommit: "",
      isRepo: false,
      stagedCount: 0,
      unstagedCount: 0,
      files: [],
      error: "network error",
    });

    const git = createGitPanel();
    await git.refreshGitStatus();

    expect(readGitBatchDraft(PROJECT, "main")?.messages).toEqual(["keep me"]);
    expect(git.gitStatusKnown.value).toBe(false);
  });

  it("clears draft when unstaged files become empty", async () => {
    fetchGitStatusMock
      .mockResolvedValueOnce(gitStatusResult("main", ["src/a.ts"]))
      .mockResolvedValueOnce(gitStatusResult("main", []));

    const git = createGitPanel();
    await git.refreshGitStatus();
    git.batchMessages.value = ["to be cleared"];
    git.flushBatchDraftPersist();
    expect(readGitBatchDraft(PROJECT, "main")?.messages).toEqual(["to be cleared"]);

    await git.refreshGitStatus();
    expect(readGitBatchDraft(PROJECT, "main")).toBeNull();
    expect(git.batchMessages.value).toEqual([]);
    expect(git.batchSectionOpen.value).toBe(false);
  });

  it("invalidates stale draft when unstaged paths change on same branch", async () => {
    writeGitBatchDraft(PROJECT, "main", {
      unstagedPaths: ["pkg/a.ts"],
      groups: null,
      messages: ["old draft"],
      sectionOpen: true,
    });

    fetchGitStatusMock.mockResolvedValue(gitStatusResult("main", ["pkg/a.ts", "src/b.ts"]));

    const git = createGitPanel();
    await git.refreshGitStatus();

    expect(readGitBatchDraft(PROJECT, "main")).toBeNull();
    expect(git.batchMessages.value).toEqual([
      "pkg: a.ts",
      "src: b.ts",
    ]);
  });

  describe("AI grouping auto persist", () => {
    beforeEach(() => {
      fetchGitStatusMock.mockResolvedValue(gitStatusResult("main", ["pkg/a.ts", "src/b.ts"]));
      aiBatchGroupsMock.mockResolvedValue({ ok: true, groups: AI_GROUPS });
    });

    it("persists draft immediately when AI grouping succeeds", async () => {
      const git = createGitPanel(AI_CONFIG);
      await git.refreshGitStatus();
      await runGenerateAiBatchGroups(git);

      expect(aiBatchGroupsMock).toHaveBeenCalledOnce();
      expect(git.batchSectionOpen.value).toBe(true);
      expect(git.batchGroupsFromAi.value).toBe(true);
      expect(git.batchMessages.value).toEqual([
        "feat(pkg): update a",
        "feat(src): update b",
      ]);
      expect(readGitBatchDraft(PROJECT, "main")).toMatchObject({
        groups: AI_GROUPS,
        messages: ["feat(pkg): update a", "feat(src): update b"],
        sectionOpen: true,
        unstagedPaths: ["pkg/a.ts", "src/b.ts"],
      });
    });

    it("restores AI grouping draft after reload following successful grouping", async () => {
      const git = createGitPanel(AI_CONFIG);
      await git.refreshGitStatus();
      await runGenerateAiBatchGroups(git);

      git.resetGitPanelState();
      await git.refreshGitStatus();

      expect(git.batchGroupsFromAi.value).toBe(true);
      expect(git.batchGroups.value.map((g) => g.dir)).toEqual(["pkg", "src"]);
      expect(git.batchMessages.value).toEqual([
        "feat(pkg): update a",
        "feat(src): update b",
      ]);
      expect(git.batchSectionOpen.value).toBe(true);
    });

    it("does not persist draft when AI grouping fails", async () => {
      aiBatchGroupsMock.mockResolvedValue({ ok: false, groups: [], error: "model error" });

      const git = createGitPanel(AI_CONFIG);
      await git.refreshGitStatus();
      await git.generateAiBatchGroups();

      expect(readGitBatchDraft(PROJECT, "main")).toBeNull();
      expect(git.batchGroupsFromAi.value).toBe(false);
    });

    it("does not call AI grouping without config", async () => {
      const git = createGitPanel();
      await git.refreshGitStatus();
      await git.generateAiBatchGroups();

      expect(aiBatchGroupsMock).not.toHaveBeenCalled();
      expect(readGitBatchDraft(PROJECT, "main")).toBeNull();
    });
  });
});
