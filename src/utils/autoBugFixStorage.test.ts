import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  autoBugFixStorageKey,
  buildPersistedAutoBugFixState,
  readAutoBugFixState,
  removeAutoBugFixState,
  writeAutoBugFixState,
  AUTO_BUG_FIX_STATE_STALE_MS,
} from "./autoBugFixStorage";

function installLocalStorageMock() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
  return store;
}

describe("autoBugFixStorage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installLocalStorageMock();
  });

  it("round-trips persisted fix panel state", () => {
    const project = "D:/project/foo";
    writeAutoBugFixState(project, buildPersistedAutoBugFixState({
      phase: "fixing",
      scanResult: {
        ok: true,
        projectPath: project,
        scannedAt: "2026-01-01T00:00:00Z",
        durationMs: 100,
        issues: [],
        summary: { errorCount: 1, warningCount: 0, infoCount: 0 },
        checksRun: ["todo"],
      },
      verifyResult: {
        ok: true,
        projectPath: project,
        command: "npm test",
        exitCode: 1,
        durationMs: 200,
        stdout: "x".repeat(50_000),
        stderr: "",
        failingFiles: ["src/foo.test.ts"],
        ranAt: "2026-01-01T00:00:01Z",
      },
      includeWarnings: false,
      lastSummary: "修复中",
      error: "",
      assistantMsgId: "a1",
      sessionId: "s1",
    }));

    const restored = readAutoBugFixState(project);
    expect(restored?.phase).toBe("fixing");
    expect(restored?.assistantMsgId).toBe("a1");
    expect(restored?.verifyResult?.command).toBe("npm test");
    expect(restored?.verifyResult).not.toHaveProperty("stdout");
  });

  it("expires stale state", () => {
    const project = "D:/project/bar";
    const key = autoBugFixStorageKey(project);
    localStorage.setItem(
      key,
      JSON.stringify({
        phase: "done",
        savedAt: Date.now() - AUTO_BUG_FIX_STATE_STALE_MS - 1,
      }),
    );
    expect(readAutoBugFixState(project)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("remove clears storage", () => {
    const project = "D:/project/baz";
    writeAutoBugFixState(project, buildPersistedAutoBugFixState({
      phase: "done",
      scanResult: null,
      verifyResult: null,
      includeWarnings: false,
      lastSummary: "",
      error: "",
    }));
    removeAutoBugFixState(project);
    expect(readAutoBugFixState(project)).toBeNull();
  });
});
