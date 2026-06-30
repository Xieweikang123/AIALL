import { describe, expect, it } from "vitest";
import {
  filterStageableGitPaths,
  formatGitStageSkippedHint,
  isGitPathStageBlocked,
  shouldShowGitStatusPath,
} from "../shared/gitStageGuard";

describe("gitStageGuard", () => {
  it("blocks IDE/build/agent root directories", () => {
    expect(isGitPathStageBlocked(".vs/")).toBe(true);
    expect(isGitPathStageBlocked(".vs\\sgcc\\FileContentIndex\\a.vsidx")).toBe(true);
    expect(isGitPathStageBlocked(".aiall/project-memory.md")).toBe(true);
    expect(isGitPathStageBlocked("obj/")).toBe(true);
    expect(isGitPathStageBlocked("bin/Debug/app.dll")).toBe(true);
    expect(isGitPathStageBlocked("node_modules/pkg/index.js")).toBe(true);
  });

  it("allows normal source paths", () => {
    expect(isGitPathStageBlocked("Controllers/HomeController.cs")).toBe(false);
    expect(isGitPathStageBlocked("Program.cs")).toBe(false);
    expect(isGitPathStageBlocked("src/obj-helper.ts")).toBe(false);
  });

  it("partitions stageable and blocked paths", () => {
    const { stageable, blocked } = filterStageableGitPaths([
      ".vs/",
      ".aiall/skills/index.json",
      "Controllers/",
      "Program.cs",
      ".vs/foo.vsidx",
    ]);
    expect(stageable).toEqual(["Controllers/", "Program.cs"]);
    expect(blocked).toEqual([".vs/", ".aiall/"]);
  });

  it("formats skip hint", () => {
    expect(formatGitStageSkippedHint([".vs/", ".aiall/"])).toContain(".vs/");
    expect(formatGitStageSkippedHint([".vs/", ".aiall/"])).toContain(".gitignore");
  });

  it("hides directory-only paths but shows git-reported files under blocked roots", () => {
    expect(shouldShowGitStatusPath("Controllers/")).toBe(false);
    expect(shouldShowGitStatusPath("Controllers/Home.cs")).toBe(true);
    expect(shouldShowGitStatusPath(".vs/foo.vsidx")).toBe(true);
    expect(shouldShowGitStatusPath(".aiall/project-memory.md")).toBe(true);
    expect(shouldShowGitStatusPath("node_modules/pkg/index.js")).toBe(true);
  });
});
