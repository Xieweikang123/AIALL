import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatProjectMemoryForPrompt,
  normalizeProjectMemoryContent,
  PROJECT_MEMORY_DEFAULT_TEMPLATE,
  PROJECT_MEMORY_MAX_CHARS,
  PROJECT_MEMORY_REL_PATH,
  readProjectMemory,
  writeProjectMemory,
  appendProjectMemory,
} from "./vibeProjectMemory";

describe("vibeProjectMemory", () => {
  let tmpDir = "";

  afterEach(async () => {
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
      tmpDir = "";
    }
  });

  async function makeProject() {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibe-memory-"));
    return tmpDir;
  }

  it("returns empty content when memory file is missing", async () => {
    const root = await makeProject();
    const result = await readProjectMemory(root);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toBe("");
    expect(result.path).toBe(PROJECT_MEMORY_REL_PATH);
  });

  it("reads and truncates oversized memory for prompt injection", async () => {
    const root = await makeProject();
    const body = "x".repeat(PROJECT_MEMORY_MAX_CHARS + 100);
    await writeProjectMemory(root, body);

    const result = await readProjectMemory(root);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.truncated).toBe(true);
    expect(result.content.length).toBeLessThanOrEqual(PROJECT_MEMORY_MAX_CHARS + 20);
  });

  it("writes memory under .aiall/project-memory.md", async () => {
    const root = await makeProject();
    const write = await writeProjectMemory(root, PROJECT_MEMORY_DEFAULT_TEMPLATE);
    expect(write.ok).toBe(true);

    const onDisk = await fs.promises.readFile(
      path.join(root, ".aiall", "project-memory.md"),
      "utf-8",
    );
    expect(onDisk).toContain("项目记忆");
  });

  it("formatProjectMemoryForPrompt skips empty content", () => {
    expect(formatProjectMemoryForPrompt("")).toBe("");
    expect(formatProjectMemoryForPrompt("  ")).toBe("");
  });

  it("normalizeProjectMemoryContent preserves short content", () => {
    const { content, truncated } = normalizeProjectMemoryContent("  hello  ");
    expect(content).toBe("hello");
    expect(truncated).toBe(false);
  });

  it("appendProjectMemorySection merges bullets", async () => {
    const root = await makeProject();
    await writeProjectMemory(root, "## 导航\n\n- old");
    const result = await appendProjectMemory(root, "导航", ["new item"]);
    expect(result.ok).toBe(true);
    const read = await readProjectMemory(root);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.content).toContain("- old");
    expect(read.content).toContain("- new item");
  });
});
