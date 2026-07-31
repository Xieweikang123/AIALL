import { describe, expect, it } from "vitest";
import {
  buildAskAnswerStructureHints,
  buildAskExplorationHints,
  buildAskSystemPromptLines,
  buildFileAccessPathHint,
  buildSearchFilesEmptyHint,
} from "../src/orchestration/product/agentAskPrompt";

describe("agentAskPrompt", () => {
  it("prioritizes grep over search_files in exploration hints", () => {
    const hints = buildAskExplorationHints();
    expect(hints.indexOf("grep")).toBeLessThan(hints.indexOf("search_files"));
    expect(hints).toContain("重叠");
  });

  it("requires entry write/revert/none classification in answer hints", () => {
    const hints = buildAskAnswerStructureHints();
    expect(hints).toContain("输入、前提、结果与可观察影响");
    expect(hints).toContain("AND");
  });

  it("includes ask exploration and answer hints in system prompt lines", () => {
    const lines = buildAskSystemPromptLines("/tmp/project");
    const joined = lines.join("\n");
    expect(joined).toContain("Ask 模式");
    expect(joined).toContain("探索策略");
    expect(joined).toContain("回答结构");
    expect(joined).toContain("事实与准确度");
    expect(joined).toContain("无附图");
    expect(joined).toContain("/tmp/project");
  });

  it("suggests grep fallback when search_files misses on CJK query", () => {
    expect(buildSearchFilesEmptyHint("工单")).toContain("grep");
    expect(buildSearchFilesEmptyHint("WorkOrder")).toBe("（无匹配文件）");
  });

  it("buildFileAccessPathHint defers external paths to AGENTS.md", () => {
    const hint = buildFileAccessPathHint();
    expect(hint).toContain("AGENTS.md");
    expect(hint).not.toMatch(/aiall|vibe-chat|AppData/i);
  });
});
