import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  formatGitStatusForAgent,
  parseGitVirtualPath,
  runGitDiffTool,
  runGitStatusTool,
} from "./agentGitTools";

describe("agentGitTools", () => {
  it("parseGitVirtualPath handles git-index and git-history prefixes", () => {
    expect(parseGitVirtualPath("git-index://src/foo.ts")).toEqual({
      kind: "index",
      relative: "src/foo.ts",
    });
    expect(parseGitVirtualPath("git-index:/Mall.API/WorkOrder.cs")).toEqual({
      kind: "index",
      relative: "Mall.API/WorkOrder.cs",
    });
    expect(parseGitVirtualPath("git-history://src/bar.ts")).toEqual({
      kind: "history",
      relative: "src/bar.ts",
    });
    expect(parseGitVirtualPath("src/main.ts")).toBeNull();
  });

  it("formatGitStatusForAgent groups staged and unstaged files", () => {
    const text = formatGitStatusForAgent({
      ok: true,
      branch: "main",
      headCommit: "abc123def456",
      stagedCount: 1,
      unstagedCount: 1,
      files: [
        {
          path: "a.cs",
          status: "modified",
          indexStatus: "M",
          worktreeStatus: " ",
          staged: true,
        },
        {
          path: "b.env",
          status: "modified",
          indexStatus: " ",
          worktreeStatus: "M",
          staged: false,
        },
        {
          path: "c.txt",
          status: "untracked",
          indexStatus: "?",
          worktreeStatus: "?",
          staged: false,
        },
      ],
    });
    expect(text).toContain("已暂存（1）");
    expect(text).toContain("M a.cs");
    expect(text).toContain("未暂存（1）");
    expect(text).toContain("M b.env");
    expect(text).toContain("未跟踪（1）");
    expect(text).toContain("?? c.txt");
  });

  it("runGitStatusTool and runGitDiffTool work on a temp repo", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aiall-git-tool-"));
    try {
      execFileSync("git", ["init"], { cwd: tempDir, stdio: "ignore" });
      fs.writeFileSync(path.join(tempDir, "file.txt"), "hello");
      execFileSync("git", ["add", "file.txt"], { cwd: tempDir, stdio: "ignore" });

      const statusText = await runGitStatusTool(tempDir);
      expect(statusText).toContain("已暂存");
      expect(statusText).toContain("file.txt");

      const diffText = await runGitDiffTool(tempDir, "file.txt", true);
      expect(diffText).toContain("file.txt");
      expect(diffText).toContain("hello");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
