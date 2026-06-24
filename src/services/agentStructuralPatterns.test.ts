import { describe, expect, it } from "vitest";
import {
  assistantProvidedCodeLocationEvidence,
  PRIOR_DEFINITION_LISTING_RE,
} from "./agentStructuralPatterns";
import {
  FIXTURE_ENUM_LISTING,
  FIXTURE_LOCATE_EVIDENCE,
  FIXTURE_SCHEDULED_TASK_QUESTION,
} from "./agentTestFixtures";

describe("agentStructuralPatterns", () => {
  it("detects prior definition listing without business enum names", () => {
    expect(PRIOR_DEFINITION_LISTING_RE.test(FIXTURE_ENUM_LISTING)).toBe(true);
    expect(PRIOR_DEFINITION_LISTING_RE.test("共有三种状态值。")).toBe(true);
  });

  it("detects generic code location evidence", () => {
    expect(assistantProvidedCodeLocationEvidence(FIXTURE_LOCATE_EVIDENCE)).toBe(true);
    expect(assistantProvidedCodeLocationEvidence("让我再看看。")).toBe(false);
  });

  it("scheduled topic pattern is structural", () => {
    expect(FIXTURE_SCHEDULED_TASK_QUESTION).toMatch(/定时任务/);
  });
});
