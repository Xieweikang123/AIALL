import { describe, expect, it } from "vitest";
import {
  filterKnowledgeChangePaths,
  summarizeKnowledgeChanges,
} from "./knowledgeGitChanges";

describe("knowledgeGitChanges", () => {
  it("filters noise paths", () => {
    const files = filterKnowledgeChangePaths([
      "src/foo.ts",
      ".aiall/project-knowledge.md",
      "node_modules/pkg/index.js",
      "dist/assets/app.js",
    ]);
    expect(files).toEqual(["src/foo.ts"]);
  });

  it("summarizes file count and stale fallback", () => {
    expect(summarizeKnowledgeChanges(["a.ts", "b.ts"])).toBe("变更 2 个文件");
    expect(summarizeKnowledgeChanges([], { knowledgeStale: true })).toBe("已有新提交");
    expect(summarizeKnowledgeChanges([])).toBe("");
  });
});
