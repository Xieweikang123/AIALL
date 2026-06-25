import { describe, expect, it } from "vitest";
import {
  buildProjectKnowledgeMetaForWrite,
  normalizeProjectKnowledgeBody,
  parseProjectKnowledgeFrontmatter,
  PROJECT_KNOWLEDGE_MAX_CHARS,
  serializeProjectKnowledgeFrontmatter,
  stripKnowledgeFrontmatter,
} from "../../shared/projectKnowledgeFormat";

describe("projectKnowledgeFormat", () => {
  it("round-trips frontmatter", () => {
    const meta = {
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastExploredAt: "2026-01-02T00:00:00.000Z",
      exploreRounds: 3,
      gitHead: "abc123",
    };
    const raw = serializeProjectKnowledgeFrontmatter(meta, "## 技术栈\n\nVue");
    const parsed = parseProjectKnowledgeFrontmatter(raw);
    expect(parsed.meta).toEqual(meta);
    expect(parsed.body).toContain("## 技术栈");
    expect(stripKnowledgeFrontmatter(raw)).toBe("## 技术栈\n\nVue");
  });

  it("buildProjectKnowledgeMetaForWrite preserves explore meta on manual save", () => {
    const prior = { exploreRounds: 2, lastExploredAt: "2026-01-01T00:00:00.000Z", gitHead: "old" };
    const meta = buildProjectKnowledgeMetaForWrite(prior, { gitHead: "new" });
    expect(meta.exploreRounds).toBe(2);
    expect(meta.lastExploredAt).toBe("2026-01-01T00:00:00.000Z");
    expect(meta.gitHead).toBe("new");
    expect(meta.updatedAt).toBeTruthy();
  });

  it("buildProjectKnowledgeMetaForWrite bumps explore rounds from explore save", () => {
    const prior = { exploreRounds: 1 };
    const meta = buildProjectKnowledgeMetaForWrite(prior, { fromExplore: true, exploreRounds: 2 });
    expect(meta.exploreRounds).toBe(2);
    expect(meta.lastExploredAt).toBeTruthy();
  });

  it("normalizeProjectKnowledgeBody truncates over max chars", () => {
    const long = "x".repeat(PROJECT_KNOWLEDGE_MAX_CHARS + 100);
    const { content, truncated } = normalizeProjectKnowledgeBody(long);
    expect(truncated).toBe(true);
    expect(content.length).toBeLessThan(long.length);
    expect(content).toContain("已截断");
  });
});
