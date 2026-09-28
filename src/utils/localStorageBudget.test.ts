import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  estimateLocalStorageUsage,
  reclaimLocalStorageBudget,
  setActiveProjectForBudget,
} from "./localStorageBudget";

/** Minimal Map-backed localStorage mock preserving insertion order. */
function installLocalStorageMock() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  });
  return store;
}

/** Write a value padded to `bytes` chars (keys are tiny, so sizes are controllable). */
function seed(store: Map<string, string>, key: string, bytes: number) {
  store.set(key, "x".repeat(bytes));
}

describe("estimateLocalStorageUsage", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installLocalStorageMock();
  });

  it("sums key + value sizes and reports the largest key", () => {
    seed(store, "a", 10);
    seed(store, "big", 500);
    const usage = estimateLocalStorageUsage();
    expect(usage.keyCount).toBe(2);
    expect(usage.usageBytes).toBe(1 + 10 + 3 + 500);
    expect(usage.maxKey).toBe("big");
    expect(usage.maxKeyBytes).toBe(503);
  });

  it("returns zeros when localStorage throws", () => {
    vi.stubGlobal("localStorage", {
      get length(): number {
        throw new Error("blocked");
      },
    });
    expect(estimateLocalStorageUsage()).toEqual({ usageBytes: 0, keyCount: 0, maxKeyBytes: 0 });
  });
});

describe("reclaimLocalStorageBudget", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installLocalStorageMock();
    setActiveProjectForBudget("");
  });

  it("does nothing when usage is within budget", () => {
    seed(store, "vibe-coding-workspace-ui-d:/p1", 100);
    const result = reclaimLocalStorageBudget({ budgetBytes: 10_000 });
    expect(result.ran).toBe(false);
    expect(result.evictedKeys).toEqual([]);
    expect(store.size).toBe(1);
  });

  it("evicts the least-recently-opened project first", () => {
    seed(store, "vibe-coding-workspace-ui-d:/old", 400);
    seed(store, "vibe-coding-workspace-ui-d:/new", 400);
    seed(store, "vibe-coding-workspace-ui-d:/active", 400);
    setActiveProjectForBudget("D:/active");

    const result = reclaimLocalStorageBudget({
      budgetBytes: 1000,
      recentProjectRanks: ["D:/active", "D:/new", "D:/old"],
    });

    expect(result.ran).toBe(true);
    expect(result.evictedProjects).toContain("d:/old");
    expect(store.has("vibe-coding-workspace-ui-d:/old")).toBe(false);
    // 最近打开的与当前项目都要留着。
    expect(store.has("vibe-coding-workspace-ui-d:/new")).toBe(true);
    expect(store.has("vibe-coding-workspace-ui-d:/active")).toBe(true);
  });

  it("never evicts the active project, even when it is the only candidate", () => {
    seed(store, "vibe-coding-workspace-ui-d:/active", 4000);
    seed(store, "vibe-coding-editor-workspace-d:/active", 4000);
    setActiveProjectForBudget("D:/active");

    const result = reclaimLocalStorageBudget({
      budgetBytes: 1000,
      recentProjectRanks: ["D:/active"],
    });

    expect(result.ran).toBe(true);
    expect(result.freedBytes).toBe(0);
    expect(store.size).toBe(2);
  });

  it("never touches the session index, AI config or API keys", () => {
    seed(store, "vibe-coding-chat", 800);
    seed(store, "ai-config", 800);
    seed(store, "aiall-server-session", 800);
    seed(store, "vibe-coding-workspace-ui-d:/old", 800);

    const result = reclaimLocalStorageBudget({
      budgetBytes: 1000,
      activeProjectPath: "D:/other",
    });

    expect(result.evictedProjects).toEqual(["d:/old"]);
    expect(store.has("vibe-coding-chat")).toBe(true);
    expect(store.has("ai-config")).toBe(true);
    expect(store.has("aiall-server-session")).toBe(true);
  });

  it("prefers tier-1 (pure UI) over tier-2 (possible user text) at the same recency", () => {
    seed(store, "vibe-coding-workspace-ui-d:/p", 600);
    seed(store, "vibe-coding-input-draft-d:/p", 600);

    const result = reclaimLocalStorageBudget({
      budgetBytes: 1000,
      activeProjectPath: "D:/other",
    });

    expect(result.freedBytes).toBeGreaterThanOrEqual(600);
    expect(store.has("vibe-coding-workspace-ui-d:/p")).toBe(false);
    expect(store.has("vibe-coding-input-draft-d:/p")).toBe(true);
  });

  it("groups git batch drafts by project, ignoring the branch suffix", () => {
    seed(store, "vibe-git-batch-draft-d:/p--main", 700);
    seed(store, "vibe-git-batch-draft-d:/p--feature", 700);

    const result = reclaimLocalStorageBudget({
      budgetBytes: 1000,
      activeProjectPath: "D:/other",
    });

    expect(result.evictedProjects).toEqual(["d:/p"]);
    expect(store.has("vibe-git-batch-draft-d:/p--main")).toBe(false);
    expect(store.has("vibe-git-batch-draft-d:/p--feature")).toBe(false);
  });

  it("falls back to insertion order when no recent-project ranks are known", () => {
    seed(store, "vibe-coding-workspace-ui-d:/first", 400);
    seed(store, "vibe-coding-workspace-ui-d:/second", 400);
    seed(store, "vibe-coding-workspace-ui-d:/third", 400);

    const result = reclaimLocalStorageBudget({
      budgetBytes: 1000,
      activeProjectPath: "D:/active",
    });

    // 没有排行时，先插入（更旧）的先淘汰。
    expect(result.evictedProjects).toEqual(["d:/first"]);
  });

  it("stops as soon as usage is back below budget", () => {
    seed(store, "vibe-coding-workspace-ui-d:/a", 600);
    seed(store, "vibe-coding-workspace-ui-d:/b", 600);
    seed(store, "vibe-coding-workspace-ui-d:/c", 600);

    const result = reclaimLocalStorageBudget({
      budgetBytes: 1500,
      activeProjectPath: "D:/active",
      recentProjectRanks: ["D:/c", "D:/b", "D:/a"],
    });

    expect(result.evictedProjects).toEqual(["d:/a"]);
    expect(result.usageAfter).toBeLessThanOrEqual(1500);
  });
});
