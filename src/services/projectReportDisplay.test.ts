import { describe, expect, it } from "vitest";
import {
  isProjectReport,
  parseProjectReportDisplay,
  slugifyReportHeading,
} from "./projectReportDisplay";
import { PROJECT_REPORT_MARKER } from "../../server/agentExplorePrompt";

describe("projectReportDisplay", () => {
  it("detects project report marker", () => {
    expect(isProjectReport(`${PROJECT_REPORT_MARKER}\n# 项目理解报告`)).toBe(true);
    expect(isProjectReport("普通回复")).toBe(false);
  });

  it("parses section toc from headings", () => {
    const content = [
      PROJECT_REPORT_MARKER,
      "# 项目理解报告",
      "## 一句话摘要",
      "summary",
      "## 技术栈",
      "vue",
    ].join("\n");
    const display = parseProjectReportDisplay(content);
    expect(display.isProjectReport).toBe(true);
    expect(display.sections.map((s) => s.title)).toEqual(["一句话摘要", "技术栈"]);
  });

  it("slugifies headings for anchors", () => {
    expect(slugifyReportHeading("技术栈", 1)).toMatch(/^report-1-/);
  });
});
