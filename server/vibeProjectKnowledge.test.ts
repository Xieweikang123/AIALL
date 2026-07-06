import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PROJECT_KNOWLEDGE_MARKER, PROJECT_KNOWLEDGE_TITLE } from "../src/orchestration/product/agentExplorePrompt";
import {
  formatProjectKnowledgeForPrompt,
  isProjectKnowledgeBody,
  PROJECT_KNOWLEDGE_REL_PATH,
  readProjectKnowledge,
  truncateKnowledgeForPrompt,
  writeProjectKnowledge,
} from "./vibeProjectKnowledge";

describe("vibeProjectKnowledge", () => {
  let tmpDir = "";

  afterEach(async () => {
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
      tmpDir = "";
    }
  });

  async function makeProject() {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibe-knowledge-"));
    return tmpDir;
  }

  it("returns empty content when knowledge file is missing", async () => {
    const root = await makeProject();
    const result = await readProjectKnowledge(root);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toBe("");
    expect(result.path).toBe(PROJECT_KNOWLEDGE_REL_PATH);
  });

  it("writes knowledge under .aiall/project-knowledge.md with frontmatter", async () => {
    const root = await makeProject();
    const body = [
      PROJECT_KNOWLEDGE_MARKER,
      `# ${PROJECT_KNOWLEDGE_TITLE}`,
      "## 一句话摘要",
      "test project",
    ].join("\n");
    const write = await writeProjectKnowledge(root, body, { fromExplore: true, gitHead: "abc123" });
    expect(write.ok).toBe(true);

    const onDisk = await fs.promises.readFile(
      path.join(root, ".aiall", "project-knowledge.md"),
      "utf-8",
    );
    expect(onDisk).toContain("updatedAt:");
    expect(onDisk).toContain("lastExploredAt:");
    expect(onDisk).toContain("exploreRounds: 1");
    expect(onDisk).toContain("gitHead: abc123");
    expect(onDisk).toContain(PROJECT_KNOWLEDGE_MARKER);
  });

  it("detects knowledge body markers", () => {
    expect(isProjectKnowledgeBody(`${PROJECT_KNOWLEDGE_MARKER}\n# ${PROJECT_KNOWLEDGE_TITLE}`)).toBe(true);
    expect(isProjectKnowledgeBody("plain text")).toBe(false);
  });

  it("formatProjectKnowledgeForPrompt skips empty content", async () => {
    expect(await formatProjectKnowledgeForPrompt("")).toBe("");
  });

  it("truncateKnowledgeForPrompt cuts on section boundaries", () => {
    const body = [
      "# foo",
      "## alpha",
      "x".repeat(6_000),
      "",
      "## beta",
      "y".repeat(6_000),
      "",
      "## gamma",
      "z".repeat(6_000),
    ].join("\n");
    const out = truncateKnowledgeForPrompt(body, 12_500);
    expect(out).toContain("## alpha");
    expect(out).toContain("## beta");
    expect(out).not.toContain("## gamma");
    expect(out).toContain("已截断");
  });

  it("truncateKnowledgeForPrompt uses a longer fence when body has tall fences", async () => {
    const body = `${PROJECT_KNOWLEDGE_MARKER}\n# ${PROJECT_KNOWLEDGE_TITLE}\nshort`;
    const out = await formatProjectKnowledgeForPrompt(body);
    expect(out).toContain("````markdown");
    expect(out.trim().endsWith("````")).toBe(true);
  });
});
