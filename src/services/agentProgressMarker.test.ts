import { describe, expect, it } from "vitest";
import {
  AGENT_PROGRESS_MARKER,
  sanitizeFeedThoughtText,
  stripAgentProgressMarker,
} from "./agentProgressMarker";

describe("sanitizeFeedThoughtText", () => {
  it("removes agent progress marker prefix", () => {
    const text = `${AGENT_PROGRESS_MARKER}\n根因假设：继续排查。`;
    expect(sanitizeFeedThoughtText(text)).toBe("根因假设：继续排查。");
  });

  it("removes incomplete leading html comment fragments from streaming", () => {
    expect(sanitizeFeedThoughtText("<!")).toBe("");
    expect(sanitizeFeedThoughtText("<!-- agent-progress")).toBe("");
    expect(sanitizeFeedThoughtText("<!-- note -->正文")).toBe("正文");
  });

  it("strips agent-tool-log marker blocks from feed thought text", () => {
    const text = [
      "**总结**：深圳软件公司。",
      "",
      "> **数据来源**：百度搜索",
      "",
      "<!-- agent-tool-log -->",
      "- 联网搜索: Found 5 results",
      "- 抓取网页: Crawled successfully",
    ].join("\n");
    expect(sanitizeFeedThoughtText(text)).toBe(
      "**总结**：深圳软件公司。\n\n> **数据来源**：百度搜索",
    );
  });

  it("delegates to stripAgentProgressMarker for complete markers", () => {
    expect(stripAgentProgressMarker(`${AGENT_PROGRESS_MARKER}  ok`)).toBe("ok");
  });
});
