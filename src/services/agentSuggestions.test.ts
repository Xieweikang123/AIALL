import { describe, expect, it } from "vitest";
import { parseAgentSuggestions, stripAgentSuggestions } from "./agentSuggestions";

describe("agentSuggestions", () => {
  it("parses trailing suggestion block and strips it from content", () => {
    const text = [
      "多会话可以并行，改动量约 2-3 天。",
      "",
      "需要我开始实现吗？",
      "<!-- agent-suggestions -->",
      "```json",
      '[{"label":"开始实现","action":"implement"},{"label":"先讨论","action":"send","text":"先说说实现步骤和风险"}]',
      "```",
    ].join("\n");

    const parsed = parseAgentSuggestions(text);
    expect(parsed.content).not.toContain("agent-suggestions");
    expect(parsed.content).toContain("需要我开始实现吗？");
    expect(parsed.suggestions).toEqual([
      { label: "开始实现", action: "implement", text: undefined },
      { label: "先讨论", action: "send", text: "先说说实现步骤和风险" },
    ]);
  });

  it("strips partial marker during streaming", () => {
    const text = "分析结论如下。\n\n<!-- agent-suggestions -->\n```json\n[";
    expect(stripAgentSuggestions(text)).toBe("分析结论如下。");
  });

  it("ignores invalid suggestion payloads", () => {
    const text = [
      "正文",
      "<!-- agent-suggestions -->",
      "```json",
      '[{"label":"","action":"send","text":"x"},{"label":"OK","action":"send"}]',
      "```",
    ].join("\n");
    expect(parseAgentSuggestions(text).suggestions).toEqual([]);
  });
});
