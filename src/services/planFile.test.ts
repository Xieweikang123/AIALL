import { describe, expect, it } from "vitest";
import {
  PLAN_FILE_REL_PATH,
  buildPlanFileDocument,
  stripPlanFilePreamble,
  extractPlanContentFromStoredMessage,
  messageQualifiesForPlanPanel,
  qualifiesPlanPanelSync,
  canForceOpenPlanPanel,
  isPlanClarificationOnly,
  shouldUsePlanExternalView,
} from "./planFile";

const SAMPLE_PLAN = [
  "[PLAN]",
  "",
  "## 修改方案",
  "",
  "将改 `src/foo.ts`：",
  "",
  "```ts",
  "export const x = 1;",
  "```",
].join("\n");

describe("planFile", () => {
  it("uses .aiall/PLAN.md path", () => {
    expect(PLAN_FILE_REL_PATH).toBe(".aiall/PLAN.md");
  });

  it("wraps plan body with agent-plan-file preamble", () => {
    const doc = buildPlanFileDocument(SAMPLE_PLAN);
    expect(doc).toContain("<!-- agent-plan-file");
    expect(doc).toContain("## 修改方案");
    expect(stripPlanFilePreamble(doc)).toBe(SAMPLE_PLAN);
  });

  it("stripPlanFilePreamble leaves plain markdown unchanged", () => {
    expect(stripPlanFilePreamble(SAMPLE_PLAN)).toBe(SAMPLE_PLAN);
  });

  it("extractPlanContentFromStoredMessage prefers final roundGroups text", () => {
    const content = extractPlanContentFromStoredMessage(
      {
        chatMode: "plan",
        content: "",
        planFilePath: ".aiall/PLAN.md",
        roundGroups: [
          {
            turn: 4,
            modelSteps: [],
            toolIds: [],
            response: { assistantText: SAMPLE_PLAN, hasToolCalls: false, isFinal: true, toolCalls: [] },
          },
        ],
      },
      "",
    );
    expect(content).toContain("[PLAN]");
    expect(messageQualifiesForPlanPanel(content, { chatMode: "plan", planFilePath: ".aiall/PLAN.md" })).toBe(true);
  });

  it("qualifiesPlanPanelSync accepts in-flight plan text", () => {
    expect(
      qualifiesPlanPanelSync("## 修改方案\n", { chatMode: "plan", planFilePath: undefined }, true),
    ).toBe(true);
    expect(
      qualifiesPlanPanelSync("请确认 foo 是指哪种系统？", { chatMode: "plan", planFilePath: undefined }, true),
    ).toBe(false);
  });

  it("canForceOpenPlanPanel rejects clarification-only answers", () => {
    expect(canForceOpenPlanPanel("请确认 foo 是指哪种系统？", { chatMode: "plan" })).toBe(false);
    expect(canForceOpenPlanPanel("", { chatMode: "plan" })).toBe(false);
  });

  it("keeps clarification in chat instead of plan panel", () => {
    const clarification =
      "请确认 foo 是指外部系统还是可视化前端？\n\n1. 外部业务系统\n2. 三维可视化\n3. 其他（请说明）";
    expect(isPlanClarificationOnly(clarification)).toBe(true);
    expect(messageQualifiesForPlanPanel(clarification, { chatMode: "plan", planFilePath: undefined })).toBe(false);
    expect(qualifiesPlanPanelSync(clarification, { chatMode: "plan", planFilePath: undefined }, false)).toBe(false);
    expect(shouldUsePlanExternalView(clarification, { chatMode: "plan" })).toBe(false);
  });
});
