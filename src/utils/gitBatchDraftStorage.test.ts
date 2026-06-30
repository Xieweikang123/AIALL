import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  gitBatchDraftStorageKey,
  pathsEqual,
  readGitBatchDraft,
  removeGitBatchDraft,
  sortedUnstagedPaths,
  writeGitBatchDraft,
} from "./gitBatchDraftStorage";

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

const PROJECT = "D:/project/AIALL";
const MAIN = "main";
const DEV = "dev";

beforeEach(() => {
  installLocalStorageMock();
});

afterEach(() => {
  for (const branch of [MAIN, DEV, ""]) {
    removeGitBatchDraft(PROJECT, branch);
    removeGitBatchDraft("d:\\project\\AIALL", branch);
  }
});

describe("gitBatchDraftStorage", () => {
  it("uses case-insensitive project and branch keys", () => {
    expect(gitBatchDraftStorageKey("D:/project/AIALL", "Main")).toBe(
      gitBatchDraftStorageKey("d:\\project\\AIALL", "main"),
    );
  });

  it("isolates drafts per branch", () => {
    writeGitBatchDraft(PROJECT, MAIN, {
      unstagedPaths: ["src/a.ts"],
      groups: null,
      messages: ["main branch"],
      sectionOpen: true,
    });
    writeGitBatchDraft(PROJECT, DEV, {
      unstagedPaths: ["src/b.ts"],
      groups: null,
      messages: ["dev branch"],
      sectionOpen: false,
    });

    expect(readGitBatchDraft(PROJECT, MAIN)?.messages).toEqual(["main branch"]);
    expect(readGitBatchDraft(PROJECT, DEV)?.messages).toEqual(["dev branch"]);
  });

  it("normalizes git paths when comparing and storing", () => {
    writeGitBatchDraft(PROJECT, MAIN, {
      unstagedPaths: sortedUnstagedPaths(["src\\a.ts", "src/b.ts"]),
      groups: null,
      messages: ["feat: a", "fix: b"],
      sectionOpen: true,
    });

    const draft = readGitBatchDraft("d:/project/AIALL", "main");
    expect(draft?.messages).toEqual(["feat: a", "fix: b"]);
    expect(pathsEqual(draft?.unstagedPaths ?? [], ["src/a.ts", "src\\b.ts"])).toBe(true);
  });

  it("accepts drafts with null groups", () => {
    writeGitBatchDraft(PROJECT, MAIN, {
      unstagedPaths: ["src/a.ts"],
      groups: null,
      messages: ["update a"],
      sectionOpen: false,
    });

    expect(readGitBatchDraft(PROJECT, MAIN)?.messages).toEqual(["update a"]);
  });
});
