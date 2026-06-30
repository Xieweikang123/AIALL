import { describe, expect, it } from "vitest";
import {
  LEGACY_PLAN_DOCUMENT_REL_PATH,
  PLAN_DOCUMENTS_DIR,
  buildPlanDocumentBuildModeBlockedMessage,
  buildPlanDocumentRelPath,
  isPlanDocumentPath,
  resolvePlanDocumentRelPath,
} from "../shared/planFilePath";

describe("planFilePath", () => {
  it("builds per-message plan paths", () => {
    expect(buildPlanDocumentRelPath("1700000000000-abc123")).toBe(
      `${PLAN_DOCUMENTS_DIR}/1700000000000-abc123.md`,
    );
    expect(resolvePlanDocumentRelPath("1700000000000-abc123")).toBe(
      `${PLAN_DOCUMENTS_DIR}/1700000000000-abc123.md`,
    );
  });

  it("matches legacy and per-message plan paths", () => {
    expect(isPlanDocumentPath(LEGACY_PLAN_DOCUMENT_REL_PATH)).toBe(true);
    expect(isPlanDocumentPath(`${PLAN_DOCUMENTS_DIR}/msg-1.md`)).toBe(true);
    expect(isPlanDocumentPath(".aiall/plan.md")).toBe(false);
    expect(isPlanDocumentPath("src/PLAN.md")).toBe(false);
  });

  it("migrates legacy shared path to per-message path on resolve", () => {
    expect(
      resolvePlanDocumentRelPath("msg-a", LEGACY_PLAN_DOCUMENT_REL_PATH),
    ).toBe(`${PLAN_DOCUMENTS_DIR}/msg-a.md`);
    expect(
      resolvePlanDocumentRelPath("msg-a", `${PLAN_DOCUMENTS_DIR}/msg-a.md`),
    ).toBe(`${PLAN_DOCUMENTS_DIR}/msg-a.md`);
  });

  it("builds build-mode block message", () => {
    expect(buildPlanDocumentBuildModeBlockedMessage("read_file")).toContain("read_file");
    expect(buildPlanDocumentBuildModeBlockedMessage("read_file")).toContain(PLAN_DOCUMENTS_DIR);
  });
});
