import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import {
  gitStatus,
  gitChangedFilesSince,
  gitDiff,
  gitDiffFile,
  gitDiffContent,
  gitReset,
  gitAdd,
  gitRemotes,
  gitAheadCommits,
} from "./vibeGit";

describe("vibeGit on unborn branch / empty repo", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-git-test-"));
    execSync("git init -b main", { cwd: tempDir, stdio: "ignore" });
    // Configure git user so commits work if needed
    execSync("git config user.name 'Test'", { cwd: tempDir, stdio: "ignore" });
    execSync("git config user.email 'test@example.com'", { cwd: tempDir, stdio: "ignore" });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("gitStatus should not throw and return ok: true on empty repo", async () => {
    const res = await gitStatus(tempDir);
    expect(res.ok).toBe(true);
    expect(res.branch).toBe("main");
    expect(res.headCommit).toBe("");
    expect(res.files).toEqual([]);
  });

  it("gitStatus should list untracked and staged files", async () => {
    fs.writeFileSync(path.join(tempDir, "file1.txt"), "hello");
    fs.writeFileSync(path.join(tempDir, "file2.txt"), "world");

    // file1 is untracked, file2 will be staged
    execSync("git add file2.txt", { cwd: tempDir, stdio: "ignore" });

    const res = await gitStatus(tempDir);
    expect(res.ok).toBe(true);
    expect(res.files).toHaveLength(2);

    const f1 = res.files.find(f => f.path === "file1.txt");
    const f2 = res.files.find(f => f.path === "file2.txt");

    expect(f1?.status).toBe("untracked");
    expect(f2?.status).toBe("added");
    expect(f2?.staged).toBe(true);
  });

  it("gitChangedFilesSince should work without HEAD", async () => {
    fs.writeFileSync(path.join(tempDir, "file.txt"), "hello");
    execSync("git add file.txt", { cwd: tempDir, stdio: "ignore" });

    const res = await gitChangedFilesSince(tempDir, "", { includeWorkingTree: true });
    expect(res.ok).toBe(true);
    expect(res.files).toEqual(["file.txt"]);
  });

  it("gitDiff should work for staged changes without HEAD", async () => {
    fs.writeFileSync(path.join(tempDir, "file.txt"), "hello");
    execSync("git add file.txt", { cwd: tempDir, stdio: "ignore" });

    const res = await gitDiff(tempDir, undefined, true);
    expect(res.ok).toBe(true);
    expect(res.files).toHaveLength(1);
    expect(res.files[0].path).toBe("file.txt");
    expect(res.patch).toContain("+hello");
  });

  it("gitDiffFile should work for staged file without HEAD", async () => {
    fs.writeFileSync(path.join(tempDir, "file.txt"), "hello");
    execSync("git add file.txt", { cwd: tempDir, stdio: "ignore" });

    const res = await gitDiffFile(tempDir, "file.txt", true);
    expect(res.ok).toBe(true);
    expect(res.patch).toContain("+hello");
  });

  it("gitDiffContent should work for staged and unstaged files without HEAD", async () => {
    fs.writeFileSync(path.join(tempDir, "file.txt"), "hello");
    execSync("git add file.txt", { cwd: tempDir, stdio: "ignore" });

    const resStaged = await gitDiffContent(tempDir, "file.txt", true);
    expect(resStaged.ok).toBe(true);
    expect(resStaged.before).toBe("");
    expect(resStaged.after).toBe("hello");

    fs.writeFileSync(path.join(tempDir, "file.txt"), "hello world");
    const resUnstaged = await gitDiffContent(tempDir, "file.txt", false);
    expect(resUnstaged.ok).toBe(true);
    expect(resUnstaged.after).toBe("hello world");
  });

  it("gitReset should unstage files without HEAD", async () => {
    fs.writeFileSync(path.join(tempDir, "file.txt"), "hello");
    execSync("git add file.txt", { cwd: tempDir, stdio: "ignore" });

    // Verify it is staged
    let status = await gitStatus(tempDir);
    expect(status.files.find(f => f.path === "file.txt")?.staged).toBe(true);

    // Reset it
    const resetRes = await gitReset(tempDir, ["file.txt"]);
    expect(resetRes.ok).toBe(true);

    // Verify it is now untracked (unstaged)
    status = await gitStatus(tempDir);
    expect(status.files.find(f => f.path === "file.txt")?.status).toBe("untracked");
  });

  it("gitReset all should unstage all files without HEAD", async () => {
    fs.writeFileSync(path.join(tempDir, "file1.txt"), "hello");
    fs.writeFileSync(path.join(tempDir, "file2.txt"), "world");
    execSync("git add file1.txt file2.txt", { cwd: tempDir, stdio: "ignore" });

    let status = await gitStatus(tempDir);
    expect(status.stagedCount).toBe(2);

    const resetRes = await gitReset(tempDir, []);
    expect(resetRes.ok).toBe(true);

    status = await gitStatus(tempDir);
    expect(status.stagedCount).toBe(0);
    expect(status.files.every(f => f.status === "untracked")).toBe(true);
  });

  it("gitAdd skips blocked IDE/build directories", async () => {
    fs.mkdirSync(path.join(tempDir, ".vs", "proj", "FileContentIndex"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, ".vs", "proj", "FileContentIndex", "a.vsidx"), "locked");
    fs.writeFileSync(path.join(tempDir, "Program.cs"), "class App {}");

    const blockedOnly = await gitAdd(tempDir, [".vs/"]);
    expect(blockedOnly.ok).toBe(false);
    expect(blockedOnly.error).toContain(".vs/");

    const mixed = await gitAdd(tempDir, [".vs/", "Program.cs"]);
    expect(mixed.ok).toBe(true);
    expect(mixed.warning).toContain(".vs/");

    const status = await gitStatus(tempDir);
    expect(status.files.some((f) => f.path === "Program.cs" && f.staged)).toBe(true);
    expect(status.files.some((f) => f.path === ".vs/" && f.staged)).toBe(false);
  });

  it("gitStatus lists untracked files instead of directories", async () => {
    fs.mkdirSync(path.join(tempDir, "Controllers"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "Controllers", "Home.cs"), "class Home {}");
    fs.writeFileSync(path.join(tempDir, "Program.cs"), "class App {}");

    const res = await gitStatus(tempDir);
    expect(res.files.some((f) => f.path === "Controllers/")).toBe(false);
    expect(res.files.some((f) => f.path === "Controllers/Home.cs")).toBe(true);
    expect(res.files.some((f) => f.path === "Program.cs")).toBe(true);
  });

  it("gitStatus hides blocked IDE and agent paths", async () => {
    fs.mkdirSync(path.join(tempDir, ".vs", "proj"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, ".vs", "proj", "cache.vsidx"), "x");
    fs.mkdirSync(path.join(tempDir, ".aiall"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, ".aiall", "project-memory.md"), "mem");
    fs.writeFileSync(path.join(tempDir, "Program.cs"), "app");

    const res = await gitStatus(tempDir);
    expect(res.files.every((f) => !f.path.startsWith(".vs"))).toBe(true);
    expect(res.files.every((f) => !f.path.startsWith(".aiall"))).toBe(true);
    expect(res.files.some((f) => f.path === "Program.cs")).toBe(true);
  });

  it("gitRemotes counts unpushed commits before upstream is configured", async () => {
    execSync("git remote add origin https://example.com/repo.git", { cwd: tempDir, stdio: "ignore" });
    fs.writeFileSync(path.join(tempDir, "file.txt"), "hello");
    execSync("git add file.txt", { cwd: tempDir, stdio: "ignore" });
    execSync('git commit -m "initial commit"', { cwd: tempDir, stdio: "ignore" });

    const remotes = await gitRemotes(tempDir);
    expect(remotes.ok).toBe(true);
    expect(remotes.remotes.length).toBe(1);
    expect(remotes.ahead).toBe(1);
    expect(remotes.trackingBranch).toBe("origin/main");

    const ahead = await gitAheadCommits(tempDir, 10);
    expect(ahead.ok).toBe(true);
    expect(ahead.entries.length).toBe(1);
    expect(ahead.entries[0]?.message).toContain("initial commit");
  });
});
