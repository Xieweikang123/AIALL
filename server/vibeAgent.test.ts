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

  it("patch_file persists to disk immediately", async () => {
    const root = await makeProject();
    await fs.promises.mkdir(path.join(root, "src"), { recursive: true });
    await fs.promises.writeFile(path.join(root, "src", "a.ts"), "foo bar", "utf-8");
    const stage = createWriteStage();
    const result = await executeTool(
      root,
      "patch_file",
      { path: "src/a.ts", old_string: "foo", new_string: "baz" },
      stage,
    );
    expect(result).toBe("已修改 src/a.ts（3 → 3 字符）");
    expect(stage.writtenList).toEqual(["src/a.ts"]);
    const onDisk = await fs.promises.readFile(path.join(root, "src", "a.ts"), "utf-8");
    expect(onDisk).toBe("baz bar");
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
});
