import { describe, expect, it } from "vitest";
import {
  buildMemoryProposalToolResult,
  parseMemoryProposalToolResult,
} from "./projectMemoryProposal";

describe("projectMemoryProposal", () => {
  it("round-trips proposal payload", () => {
    const raw = buildMemoryProposalToolResult({ section: "导航", content: "探索涉及：`src/foo.ts`" });
    expect(parseMemoryProposalToolResult(raw)).toEqual({
      section: "导航",
      content: "探索涉及：`src/foo.ts`",
    });
  });

  it("rejects invalid section", () => {
    const raw = "【memory_proposal】{\"section\":\"其他\",\"content\":\"x\"}";
    expect(parseMemoryProposalToolResult(raw)).toBeNull();
  });
});
