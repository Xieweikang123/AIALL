import { describe, expect, it } from "vitest";
import {
  enrichPlanMarkdownForDisplay,
  injectPlanFileAnchors,
  parsePlanDocumentDisplay,
} from "./planDocumentDisplay";

const SAMPLE_PLAN = [
  "## 修改方案",
  "改 `src/foo.ts` 和 `src/bar.ts`：",
  "```ts",
  "export const featureFlag = true;",
  "```",
].join("\n");

describe("parsePlanDocumentDisplay", () => {
  it("detects plan metadata", () => {
    const display = parsePlanDocumentDisplay(SAMPLE_PLAN);
    expect(display.isPlan).toBe(true);
    expect(display.isPartialPlan).toBe(false);
    expect(display.files).toEqual(["src/foo.ts", "src/bar.ts"]);
    expect(display.codeBlockCount).toBe(1);
  });

  it("detects partial plan while streaming", () => {
    const display = parsePlanDocumentDisplay("## 修改方案\n正在分析相关代码…");
    expect(display.isPlan).toBe(true);
    expect(display.isPartialPlan).toBe(true);
    expect(display.files).toEqual([]);
  });

  it("does not treat multi-file explanation as plan", () => {
    const display = parsePlanDocumentDisplay(
      "`FilePanel.vue` 负责文件树，`ProjectSwitcherBar.vue` 负责项目切换。",
    );
    expect(display.isPlan).toBe(false);
    expect(display.isPartialPlan).toBe(false);
    expect(display.files).toEqual(["FilePanel.vue", "ProjectSwitcherBar.vue"]);
  });

  it("treats multi-file outline as complete plan shell", () => {
    const display = parsePlanDocumentDisplay("## 修改方案\n将改 `src/foo.ts` 和 `src/bar.ts`");
    expect(display.isPlan).toBe(true);
    expect(display.isPartialPlan).toBe(false);
    expect(display.files).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("returns non-plan for ordinary answers", () => {
    const display = parsePlanDocumentDisplay("这是普通说明。");
    expect(display.isPlan).toBe(false);
    expect(display.files).toEqual([]);
  });
});

describe("injectPlanFileAnchors", () => {
  it("adds anchors before backtick-wrapped paths", () => {
    const enriched = injectPlanFileAnchors(SAMPLE_PLAN, ["src/foo.ts", "src/bar.ts"]);
    expect(enriched).toContain('id="plan-file-0"');
    expect(enriched).toContain('id="plan-file-1"');
    expect(enriched).toContain("`src/foo.ts`");
  });
});

describe("enrichPlanMarkdownForDisplay", () => {
  it("leaves non-plan content unchanged", () => {
    expect(enrichPlanMarkdownForDisplay("hello")).toBe("hello");
  });

  it("injects anchors for plan content", () => {
    const enriched = enrichPlanMarkdownForDisplay(SAMPLE_PLAN);
    expect(enriched).toContain("plan-file-0");
  });

  it("skips enrichment while streaming", () => {
    expect(enrichPlanMarkdownForDisplay(SAMPLE_PLAN, { whileStreaming: true })).toBe(SAMPLE_PLAN);
  });
});
