import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWriteStage, executeTool } from "./vibeAgent";

describe("executeTool immediate persistence", () => {
  let tmpDir = "";

  afterEach(async () => {
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
      tmpDir = "";
    }
  });

  async function makeProject() {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibe-agent-"));
    return tmpDir;
  }

  it("write_file persists to disk immediately", async () => {
    const root = await makeProject();
    const stage = createWriteStage();
    const result = await executeTool(root, "write_file", { path: "src/a.ts", content: "hello" }, stage);
    expect(result).toBe("已写入 src/a.ts（5 字符）");
    expect(stage.writtenList).toEqual(["src/a.ts"]);
    const onDisk = await fs.promises.readFile(path.join(root, "src", "a.ts"), "utf-8");
    expect(onDisk).toBe("hello");
  });

  it("patch_file requires read_file first on existing files", async () => {
    const root = await makeProject();
    await fs.promises.mkdir(path.join(root, "src"), { recursive: true });
    await fs.promises.writeFile(path.join(root, "src", "a.ts"), "foo bar", "utf-8");
    const stage = createWriteStage();
    const readCache = new Map<string, string>();
    const readSliceCache = new Map<string, string>();

    const blocked = await executeTool(
      root,
      "patch_file",
      { path: "src/a.ts", old_string: "foo", new_string: "baz" },
      stage,
      "build",
      readCache,
      readSliceCache,
    );
    expect(blocked).toContain("请先 read_file");

    await executeTool(root, "read_file", { path: "src/a.ts" }, stage, "build", readCache, readSliceCache);
    const result = await executeTool(
      root,
      "patch_file",
      { path: "src/a.ts", old_string: "foo", new_string: "baz" },
      stage,
      "build",
      readCache,
      readSliceCache,
    );
    expect(result).toBe("已修改 src/a.ts（3 → 3 字符）");
    const onDisk = await fs.promises.readFile(path.join(root, "src", "a.ts"), "utf-8");
    expect(onDisk).toBe("baz bar");
  });

  it("patch_file applies LF old_string to CRLF files after read_file", async () => {
    const root = await makeProject();
    const filePath = path.join(root, "routes.ts");
    await fs.promises.writeFile(filePath, "before\r\n  push();\r\nafter\r\n", "utf-8");
    const stage = createWriteStage();
    const readCache = new Map<string, string>();
    const readSliceCache = new Map<string, string>();

    await executeTool(root, "read_file", { path: "routes.ts" }, stage, "build", readCache, readSliceCache);
    const result = await executeTool(
      root,
      "patch_file",
      {
        path: "routes.ts",
        old_string: "  push();\nafter",
        new_string: "  push();\n  stash();\nafter",
      },
      stage,
      "build",
      readCache,
      readSliceCache,
    );
    expect(result).toContain("已修改 routes.ts");
    const onDisk = await fs.promises.readFile(filePath, "utf-8");
    expect(onDisk).toBe("before\r\n  push();\r\n  stash();\r\nafter\r\n");
  });

  it("deduplicates identical read_file slice requests", async () => {
    const root = await makeProject();
    await fs.promises.writeFile(path.join(root, "a.ts"), "line1\nline2\n", "utf-8");
    const stage = createWriteStage();
    const readCache = new Map<string, string>();
    const readSliceCache = new Map<string, string>();
    const readSliceRepeatCounts = new Map<string, number>();

    const first = await executeTool(
      root,
      "read_file",
      { path: "a.ts" },
      stage,
      "build",
      readCache,
      readSliceCache,
      undefined,
      readSliceRepeatCounts,
    );
    const second = await executeTool(
      root,
      "read_file",
      { path: "a.ts" },
      stage,
      "build",
      readCache,
      readSliceCache,
      undefined,
      readSliceRepeatCounts,
    );
    const third = await executeTool(
      root,
      "read_file",
      { path: "a.ts" },
      stage,
      "build",
      readCache,
      readSliceCache,
      undefined,
      readSliceRepeatCounts,
    );
    const fourth = await executeTool(
      root,
      "read_file",
      { path: "a.ts" },
      stage,
      "build",
      readCache,
      readSliceCache,
      undefined,
      readSliceRepeatCounts,
    );

    expect(first).toContain("line1");
    expect(second).toContain("省略重复读取");
    expect(third).toContain("省略重复读取");
    expect(fourth).toContain("错误");
    expect(fourth).toContain("勿重复 read_file");
  });

  it("delete_file removes from disk immediately", async () => {
    const root = await makeProject();
    const filePath = path.join(root, "remove-me.txt");
    await fs.promises.writeFile(filePath, "gone", "utf-8");
    const stage = createWriteStage();
    const result = await executeTool(root, "delete_file", { path: "remove-me.txt" }, stage);
    expect(result).toBe("已删除 remove-me.txt");
    expect(stage.writtenList).toEqual(["remove-me.txt"]);
    await expect(fs.promises.stat(filePath)).rejects.toThrow();
  });

  it("read_file allows absolute paths outside project root", async () => {
    const root = await makeProject();
    const externalFile = path.join(os.tmpdir(), `vibe-agent-ext-${Date.now()}.txt`);
    await fs.promises.writeFile(externalFile, "external line\n", "utf-8");
    try {
      const result = await executeTool(root, "read_file", { path: externalFile }, null, "build");
      expect(result).toContain("external line");
    } finally {
      await fs.promises.unlink(externalFile).catch(() => {});
    }
  });

  it("read_file works without write stage for in-project paths", async () => {
    const root = await makeProject();
    await fs.promises.writeFile(path.join(root, "a.ts"), "inside project\n", "utf-8");
    const result = await executeTool(root, "read_file", { path: "a.ts" }, null, "ask");
    expect(result).toContain("inside project");
    expect(result).not.toMatch(/错误：.*has/);
  });
});
