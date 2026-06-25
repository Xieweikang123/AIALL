import { describe, expect, it } from "vitest";
import { EXPLORE_CONTINUE_PRESET_PROMPT, EXPLORE_PROJECT_PRESET_PROMPT, buildExploreChangedFilesPrompt } from "./agentExplore";
import {
  classifyExploreKnowledgeIntent,
  exploreIntentUsesKnowledgeManifest,
  isExploreChangesPrompt,
  isExploreContinuePrompt,
  isExploreFollowUpPrompt,
  isExploreSectionFillPrompt,
  isKnowledgeQuoteFollowUpPrompt,
} from "./knowledgeExplore";
import { buildExploreUnexploredPrompt } from "./agentExplore";

describe("knowledgeExplore", () => {
  it("classifies initial vs rebuild", () => {
    expect(classifyExploreKnowledgeIntent(EXPLORE_PROJECT_PRESET_PROMPT, false)).toBe("initial");
    expect(classifyExploreKnowledgeIntent(EXPLORE_PROJECT_PRESET_PROMPT, true)).toBe("rebuild");
  });

  it("classifies continue, section fill, changes, and followup", () => {
    expect(classifyExploreKnowledgeIntent(EXPLORE_CONTINUE_PRESET_PROMPT, true)).toBe("continue");
    const sectionPrompt = buildExploreUnexploredPrompt(["核心模块"]);
    expect(isExploreSectionFillPrompt(sectionPrompt)).toBe(true);
    expect(classifyExploreKnowledgeIntent(sectionPrompt, true)).toBe("section_fill");
    const changesPrompt = buildExploreChangedFilesPrompt(3);
    expect(isExploreChangesPrompt(changesPrompt)).toBe(true);
    expect(classifyExploreKnowledgeIntent(changesPrompt, true)).toBe("changes");
    expect(classifyExploreKnowledgeIntent("项目的测试如何运行？", true)).toBe("followup");
  });

  it("manifest applies to incremental intents only", () => {
    expect(exploreIntentUsesKnowledgeManifest("continue")).toBe(true);
    expect(exploreIntentUsesKnowledgeManifest("section_fill")).toBe(true);
    expect(exploreIntentUsesKnowledgeManifest("changes")).toBe(true);
    expect(exploreIntentUsesKnowledgeManifest("followup")).toBe(true);
    expect(exploreIntentUsesKnowledgeManifest("rebuild")).toBe(false);
    expect(exploreIntentUsesKnowledgeManifest("initial")).toBe(false);
  });

  it("isExploreContinuePrompt matches continue preset", () => {
    expect(isExploreContinuePrompt(EXPLORE_CONTINUE_PRESET_PROMPT)).toBe(true);
    expect(isExploreFollowUpPrompt(EXPLORE_CONTINUE_PRESET_PROMPT)).toBe(false);
  });

  it("detects quote-anchored follow-up prompts", () => {
    const prompt = "用户引用了知识库中的以下段落：\n\n> Vue 3\n\n用户问题：对吗？";
    expect(isKnowledgeQuoteFollowUpPrompt(prompt)).toBe(true);
    expect(classifyExploreKnowledgeIntent(prompt, true)).toBe("followup");
  });
});
