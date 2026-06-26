import { describe, expect, it } from "vitest";
import {
  buildKnowledgeExploreManifest,
  computeKnowledgeOverview,
  findUnexploredSectionTitles,
  formatKnowledgeSize,
  injectReportHeadingIds,
  isFullKnowledgeReport,
  isProjectReport,
  mergeKnowledgeExploreOutput,
  mergeSectionUpdatesIntoKnowledge,
  parseKnowledgeTocSections,
  parseProjectReportDisplay,
  replaceKnowledgeSection,
  resolveKnowledgeBodyForSave,
  slugifyReportHeading,
} from "./projectReportDisplay";
import { PROJECT_KNOWLEDGE_MARKER, PROJECT_KNOWLEDGE_TITLE, PROJECT_REPORT_MARKER } from "../../server/agentExplorePrompt";
import { buildExploreUnexploredPrompt } from "./agentExplore";

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

  it("parseKnowledgeTocSections falls back without report marker", () => {
    const content = ["# 项目知识库", "## 技术栈", "## 入口与启动流程"].join("\n");
    expect(parseKnowledgeTocSections(content).map((s) => s.title)).toEqual([
      "技术栈",
      "入口与启动流程",
    ]);
  });

  it("injectReportHeadingIds attaches ids to matching headings", () => {
    const sections = parseKnowledgeTocSections(
      [PROJECT_KNOWLEDGE_MARKER, "# 项目知识库", "## 技术栈"].join("\n"),
    );
    const html = injectReportHeadingIds("<h2>技术栈</h2><p>vue</p>", sections);
    expect(html).toBe(`<h2 id="${sections[0]!.id}">技术栈</h2><p>vue</p>`);
  });

  it("injectReportHeadingIds handles titles with parentheses", () => {
    const sections = parseKnowledgeTocSections(
      [PROJECT_KNOWLEDGE_MARKER, "# 项目知识库 (补充版)", "## 系统架构"].join("\n"),
    );
    const html = injectReportHeadingIds(
      "<h1>项目知识库 (补充版)</h1><h2>系统架构</h2>",
      sections,
    );
    expect(html).toContain('<h1 id="');
    expect(html).toContain('<h2 id="');
    expect(html).toContain(">系统架构</h2>");
  });

  it("injectReportHeadingIds handles inline code in heading titles", () => {
    const title = "八、`.aiall/` Agent 记忆与技能";
    const sections = parseKnowledgeTocSections(
      [PROJECT_KNOWLEDGE_MARKER, "# 项目知识库", `## ${title}`].join("\n"),
    );
    const html = injectReportHeadingIds(
      `<h2>八、<code>.aiall/</code> Agent 记忆与技能</h2>`,
      sections,
    );
    expect(html).toBe(`<h2 id="${sections[0]!.id}">八、<code>.aiall/</code> Agent 记忆与技能</h2>`);
  });

  it("findUnexploredSectionTitles detects flagged sections", () => {
    const content = [
      PROJECT_KNOWLEDGE_MARKER,
      "## 核心模块",
      "内容未探索",
      "## 数据流 / 关键依赖",
      "已梳理",
    ].join("\n");
    expect(findUnexploredSectionTitles(content)).toEqual(["核心模块"]);
  });
});

describe("buildExploreUnexploredPrompt", () => {
  it("lists section titles in prompt", () => {
    const prompt = buildExploreUnexploredPrompt(["核心模块", "测试"]);
    expect(prompt).toContain("核心模块");
    expect(prompt).toContain("测试");
  });
});

describe("mergeKnowledgeExploreOutput", () => {
  const existing = [
    PROJECT_KNOWLEDGE_MARKER,
    `# ${PROJECT_KNOWLEDGE_TITLE}`,
    "## 技术栈",
    "Vue 3",
  ].join("\n");

  it("replaces when incoming is a full knowledge report", () => {
    const incoming = [
      PROJECT_KNOWLEDGE_MARKER,
      `# ${PROJECT_KNOWLEDGE_TITLE}`,
      "## 一句话摘要",
      "updated",
    ].join("\n");
    expect(isFullKnowledgeReport(incoming)).toBe(true);
    expect(mergeKnowledgeExploreOutput(existing, incoming)).toBe(incoming);
  });

  it("appends supplement sections instead of replacing", () => {
    const supplement = "## 补充：测试\n\nnpm test";
    const merged = mergeKnowledgeExploreOutput(existing, supplement);
    expect(merged).toContain("## 技术栈");
    expect(merged).toContain("## 补充：测试");
  });

  it("merges follow-up into best matching section instead of trailing supplement", () => {
    const doc = [
      PROJECT_KNOWLEDGE_MARKER,
      `# ${PROJECT_KNOWLEDGE_TITLE}`,
      "## 目录结构",
      "src/ server/",
      "## 技术栈",
      "Vue 3",
    ].join("\n");
    const incoming = "## 补充：知识库\n\n项目内知识库位于 `.aiall/project-knowledge.md`。";
    const merged = mergeKnowledgeExploreOutput(doc, incoming);
    expect(merged).toContain("## 目录结构");
    expect(merged).toContain(".aiall/project-knowledge.md");
    expect(merged.indexOf("## 目录结构")).toBeLessThan(merged.indexOf(".aiall/project-knowledge.md"));
    expect(merged).not.toContain("## 补充：知识库");
  });

  it("resolveKnowledgeBodyForSave merges follow-up answers", () => {
    const saved = resolveKnowledgeBodyForSave(existing, "npm test 命令为 `npm run test`");
    expect(saved).toContain("## 技术栈");
    expect(saved).toContain("npm test");
  });

  it("does not replace entire doc when long output lacks full report marker", () => {
    const longPartial = [
      "## 技术栈",
      "React 18",
      "## 目录结构",
      "src/\nserver/\n".repeat(80),
      "## 核心模块",
      "未探索",
    ].join("\n");
    expect(isFullKnowledgeReport(longPartial)).toBe(false);
    const merged = mergeKnowledgeExploreOutput(existing, longPartial);
    expect(merged).toContain("Vue 3");
    expect(merged).toContain("React 18");
  });

  it("does not treat supplement that merely quotes the title as full report", () => {
    const quote = [
      "## 补充：知识库",
      "",
      `引用：${PROJECT_KNOWLEDGE_MARKER}`,
      `参考标题：# ${PROJECT_KNOWLEDGE_TITLE}`,
      "项目内知识库位于 `.aiall/project-knowledge.md`。",
    ].join("\n");
    expect(isFullKnowledgeReport(quote)).toBe(false);
    const merged = mergeKnowledgeExploreOutput(existing, quote);
    expect(merged).toContain("## 技术栈");
    expect(merged).toContain("## 补充：知识库");
    expect(merged).not.toBe(quote);
  });

  it("requires marker at start and h1 immediately after", () => {
    expect(
      isFullKnowledgeReport(
        [PROJECT_KNOWLEDGE_MARKER, `# ${PROJECT_KNOWLEDGE_TITLE}`, "## 一句话摘要", "x"].join("\n"),
      ),
    ).toBe(true);
    // marker not at start
    expect(
      isFullKnowledgeReport(`前言\n${PROJECT_KNOWLEDGE_MARKER}\n# ${PROJECT_KNOWLEDGE_TITLE}`),
    ).toBe(false);
    // marker but no h1 right after
    expect(
      isFullKnowledgeReport(`${PROJECT_KNOWLEDGE_MARKER}\n## 一句话摘要\nx`),
    ).toBe(false);
  });
});

describe("replaceKnowledgeSection", () => {
  const existing = [
    PROJECT_KNOWLEDGE_MARKER,
    `# ${PROJECT_KNOWLEDGE_TITLE}`,
    "## 技术栈",
    "Vue 3",
    "## 核心模块",
    "内容未探索",
  ].join("\n");

  it("replaces a single section in place", () => {
    const updated = replaceKnowledgeSection(
      existing,
      "核心模块",
      "## 核心模块\n\n| 模块 | 路径 |\n| chat | src/views |",
    );
    expect(updated).toContain("## 技术栈");
    expect(updated).toContain("| chat | src/views |");
    expect(updated).not.toContain("内容未探索");
  });

  it("mergeSectionUpdatesIntoKnowledge handles section fill output", () => {
    const merged = mergeSectionUpdatesIntoKnowledge(
      existing,
      "## 核心模块\n\n已梳理 server 与 src",
    );
    expect(merged).toContain("已梳理 server 与 src");
    expect(merged).toContain("## 技术栈");
  });

  it("resolveKnowledgeBodyForSave uses section merge for section_fill intent", () => {
    const merged = resolveKnowledgeBodyForSave(
      existing,
      "## 核心模块\n\n补全内容",
      { intent: "section_fill" },
    );
    expect(merged).toContain("补全内容");
    expect(merged).toContain("Vue 3");
  });
});

describe("buildKnowledgeExploreManifest", () => {
  it("includes section status without full body", () => {
    const body = [
      PROJECT_KNOWLEDGE_MARKER,
      `# ${PROJECT_KNOWLEDGE_TITLE}`,
      "## 技术栈",
      "Vue",
      "## 核心模块",
      "未探索",
    ].join("\n");
    const manifest = buildKnowledgeExploreManifest(body, { exploreRounds: 2, gitHead: "abc123def456" });
    expect(manifest).toContain(".aiall/project-knowledge.md");
    expect(manifest).toContain("技术栈（已覆盖）");
    expect(manifest).toContain("核心模块（未探索）");
    expect(manifest).not.toContain("Vue");
    expect(manifest).toContain("read_file");
  });
});

describe("computeKnowledgeOverview", () => {
  it("computes coverage and size", () => {
    const body = [
      PROJECT_KNOWLEDGE_MARKER,
      `# ${PROJECT_KNOWLEDGE_TITLE}`,
      "## 技术栈",
      "Vue 3",
      "## 核心模块",
      "内容未探索",
      "## 数据流 / 关键依赖",
      "待验证",
    ].join("\n");
    const stats = computeKnowledgeOverview(body);
    expect(stats.sectionCount).toBe(3);
    expect(stats.coveredSections).toBe(1);
    expect(stats.unexploredSections).toBe(1);
    expect(stats.pendingSections).toBe(1);
    expect(stats.coveragePercent).toBe(33);
    expect(stats.charCount).toBeGreaterThan(0);
  });

  it("formatKnowledgeSize uses wan for large docs", () => {
    expect(formatKnowledgeSize(500)).toBe("500 字");
    expect(formatKnowledgeSize(2500)).toBe("2.5k 字");
    expect(formatKnowledgeSize(12000)).toBe("1.2 万字");
  });
});
