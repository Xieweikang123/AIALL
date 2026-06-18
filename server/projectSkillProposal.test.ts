import { describe, expect, it } from "vitest";
import {
  buildSkillProposalToolResult,
  parseSkillProposalToolResult,
} from "./projectSkillProposal";

describe("projectSkillProposal", () => {
  it("round-trips proposal payload", () => {
    const raw = buildSkillProposalToolResult({
      slug: "patch-from-read",
      kind: "heuristic",
      title: "局部修改前须已读",
      content: "old_string 必须来自 read_file。",
    });
    expect(parseSkillProposalToolResult(raw)).toEqual({
      slug: "patch-from-read",
      kind: "heuristic",
      title: "局部修改前须已读",
      content: "old_string 必须来自 read_file。",
    });
  });

  it("rejects invalid kind", () => {
    const raw =
      '【skill_proposal】{"slug":"x","kind":"other","title":"t","content":"c"}\n已向用户提议';
    expect(parseSkillProposalToolResult(raw)).toBeNull();
  });
});
