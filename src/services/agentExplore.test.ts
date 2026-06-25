import { describe, expect, it } from "vitest";
import {
  EXPLORE_CONTINUE_PRESET_PROMPT,
  EXPLORE_FOLLOWUP_MAX_TURNS,
  EXPLORE_PROJECT_PRESET_PROMPT,
  buildKnowledgeQuoteFollowUpPrompt,
  isExploreContinuePrompt,
  resolveExploreRequestMaxTurns,
} from "./agentExplore";

describe("agentExplore", () => {
  it("detects continue explore prompt", () => {
    expect(isExploreContinuePrompt(EXPLORE_CONTINUE_PRESET_PROMPT)).toBe(true);
    expect(isExploreContinuePrompt(EXPLORE_PROJECT_PRESET_PROMPT)).toBe(false);
  });

  it("uses standard depth for first run", () => {
    expect(resolveExploreRequestMaxTurns(EXPLORE_PROJECT_PRESET_PROMPT, undefined)).toBe(16);
    expect(resolveExploreRequestMaxTurns(EXPLORE_PROJECT_PRESET_PROMPT, undefined, undefined, 0, "quick")).toBe(8);
  });

  it("uses follow-up budget when history has assistant", () => {
    expect(
      resolveExploreRequestMaxTurns("auth 模块做什么", [{ role: "assistant", content: "report" }]),
    ).toBe(EXPLORE_FOLLOWUP_MAX_TURNS);
  });

  it("adds resume bonus for continue prompt", () => {
    expect(
      resolveExploreRequestMaxTurns(EXPLORE_CONTINUE_PRESET_PROMPT, [{ role: "assistant", content: "x" }], undefined, 16),
    ).toBe(24);
  });

  it("buildKnowledgeQuoteFollowUpPrompt wraps excerpt and question", () => {
    const prompt = buildKnowledgeQuoteFollowUpPrompt("Vue 3\nTypeScript", "技术栈对吗？");
    expect(prompt).toContain("用户引用了知识库中的以下段落");
    expect(prompt).toContain("> Vue 3");
    expect(prompt).toContain("用户问题：技术栈对吗？");
    expect(prompt).toContain("写入知识库");
  });
});
