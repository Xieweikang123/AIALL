import { describe, expect, it } from "vitest";
import {
  buildArchitectReviewPrompt,
  parseArchitectReviewVerdictFromBody,
  architectReviewBadgeCount,
  ARCHITECT_REVIEW_MARKER,
  isArchitectReviewReport,
} from "../shared/projectArchitectReview";
import {
  buildArchitectReviewMetaForWrite,
  parseArchitectReviewFrontmatter,
  serializeArchitectReviewFrontmatter,
} from "../shared/projectArchitectReviewFormat";

describe("projectArchitectReview shared", () => {
  it("parses and serializes frontmatter", () => {
    const meta = buildArchitectReviewMetaForWrite({}, {
      fromReview: true,
      gitHead: "abc123",
      verdict: "caution",
    });
    const body = `${ARCHITECT_REVIEW_MARKER}\n\n# 报告\n\n## 总体判断\n**需关注**`;
    const raw = serializeArchitectReviewFrontmatter(meta, body);
    const parsed = parseArchitectReviewFrontmatter(raw);
    expect(parsed.meta.gitHead).toBe("abc123");
    expect(parsed.meta.verdict).toBe("caution");
    expect(parsed.body).toContain(ARCHITECT_REVIEW_MARKER);
  });

  it("detects architect review marker", () => {
    expect(isArchitectReviewReport(`${ARCHITECT_REVIEW_MARKER}\n# x`)).toBe(true);
    expect(isArchitectReviewReport("# 普通文档")).toBe(false);
  });

  it("parses verdict from body", () => {
    expect(parseArchitectReviewVerdictFromBody("## 总体判断\n**方向正确**")).toBe("on_track");
    expect(parseArchitectReviewVerdictFromBody("## 总体判断\n**需关注**：边界模糊")).toBe("caution");
    expect(parseArchitectReviewVerdictFromBody("## 总体判断\n**明显跑偏**")).toBe("off_track");
    expect(parseArchitectReviewVerdictFromBody("无判断")).toBe(null);
  });

  it("badge count reflects attention level", () => {
    expect(architectReviewBadgeCount("on_track")).toBe(0);
    expect(architectReviewBadgeCount("caution")).toBe(1);
    expect(architectReviewBadgeCount("off_track")).toBe(1);
  });

  it("buildArchitectReviewPrompt includes git sections", () => {
    const prompt = buildArchitectReviewPrompt({
      projectPath: "/tmp/proj",
      currentGitHead: "deadbeef",
      sinceGitRef: "cafebabe",
      recentCommits: [{
        hash: "deadbeef",
        shortHash: "deadbee",
        date: "2026-01-01",
        message: "feat: add module",
        fileCount: 2,
      }],
      changedFiles: ["src/foo.ts"],
    });
    expect(prompt).toContain("近期提交");
    expect(prompt).toContain("src/foo.ts");
    expect(prompt).toContain(ARCHITECT_REVIEW_MARKER);
  });
});
