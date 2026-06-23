import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  adaptPatchLineEndings,
  applyUniquePatch,
  detectFileEOL,
  resolveProjectPath,
  resolveReadablePath,
} from "./vibeFs";

describe("resolveProjectPath", () => {
  it("joins relative paths under project root", () => {
    const root = path.resolve("D:/project/mall");
    const result = resolveProjectPath(root, ".aiall/project-memory.md");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe(path.resolve(root, ".aiall/project-memory.md"));
      expect(result.relative).toBe(".aiall/project-memory.md");
    }
  });

  it("rejects paths outside project root", () => {
    const root = path.resolve("D:/project/mall");
    const result = resolveProjectPath(root, "../AIALL/package.json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("路径超出项目根目录");
  });

  it("accepts absolute paths inside project root", () => {
    const root = path.resolve("D:/project/mall");
    const abs = path.resolve(root, "src/main.ts");
    const result = resolveProjectPath(root, abs);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.relative).toBe("src/main.ts");
  });
});

describe("resolveReadablePath", () => {
  it("allows absolute paths outside project root for read-only access", () => {
    const root = path.resolve("D:/project/mall");
    const external = path.resolve("C:/Users/me/AppData/Roaming/aiall/chat-store.json");
    const result = resolveReadablePath(root, external);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outsideProject).toBe(true);
      expect(result.path).toBe(external);
    }
  });

  it("keeps relative paths under project root", () => {
    const root = path.resolve("D:/project/mall");
    const result = resolveReadablePath(root, "src/main.ts");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outsideProject).toBe(false);
      expect(result.key).toBe("src/main.ts");
    }
  });

  it("rejects relative paths that escape project root", () => {
    const root = path.resolve("D:/project/mall");
    const result = resolveReadablePath(root, "../other/package.json");
    expect(result.ok).toBe(false);
  });

  it("maps logical aiall/vibe-chat-sessions/ paths to AppData", () => {
    const root = path.resolve("D:/project/mall");
    const result = resolveReadablePath(root, "aiall/vibe-chat-sessions/chat-abc.json");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outsideProject).toBe(true);
      expect(result.path).toContain(`${path.sep}vibe-chat-sessions${path.sep}chat-abc.json`);
    }
  });
});

describe("patch line endings", () => {
  it("detectFileEOL prefers CRLF when present", () => {
    expect(detectFileEOL("a\r\nb")).toBe("\r\n");
    expect(detectFileEOL("a\nb")).toBe("\n");
  });

  it("adaptPatchLineEndings converts LF patch to CRLF", () => {
    expect(adaptPatchLineEndings("line1\nline2", "\r\n")).toBe("line1\r\nline2");
  });

  it("applyUniquePatch matches LF old_string against CRLF file content", () => {
    const content = "before\r\n  foo();\r\n  bar();\r\nafter";
    const oldString = "  foo();\n  bar();";
    const newString = "  foo();\n  bar();\n  stash();";
    const result = applyUniquePatch(content, oldString, newString);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.patched).toBe("before\r\n  foo();\r\n  bar();\r\n  stash();\r\nafter");
    }
  });

  it("applyUniquePatch keeps exact match when EOL already matches", () => {
    const content = "alpha\nbeta\ngamma";
    const result = applyUniquePatch(content, "beta", "BETA");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.patched).toBe("alpha\nBETA\ngamma");
  });

  it("applyUniquePatch reports duplicate matches", () => {
    const result = applyUniquePatch("foo\nfoo", "foo", "bar");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.occurrences).toBe(2);
  });

  it("applyUniquePatch tolerates leading-indent mismatch when block is unique", () => {
    const content = ["<template>", "  <div class=\"panel\">", "    hello", "  </div>", "</template>"].join("\n");
    const oldString = ["    <div class=\"panel\">", "      hello", "    </div>"].join("\n");
    const newString = ["    <div class=\"panel\">", "      world", "    </div>"].join("\n");
    const result = applyUniquePatch(content, oldString, newString);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.patched).toContain("world");
      expect(result.patched).not.toContain("hello");
    }
  });
});
