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

  it("delegates to stripAgentProgressMarker for complete markers", () => {
    expect(stripAgentProgressMarker(`${AGENT_PROGRESS_MARKER}  ok`)).toBe("ok");
  });
});
