import { describe, expect, it } from "vitest";
import { buildCursorAgentFeed, formatCursorActionLabel } from "./agentCursorFeed";
import type { AgentRoundGroupView } from "./agentRoundGroups";

describe("agentCursorFeed", () => {
  it("formats tool actions like Cursor", () => {
    expect(formatCursorActionLabel({
      id: "1",
      name: "write_file",
      icon: "✏️",
      title: "写入",
      detail: "src/views/VibeCodingView.vue",
      label: "写入",
      summary: "已写入",
      ok: true,
      args: { path: "src/views/VibeCodingView.vue", content: "abcde" },
    })).toBe("Edited src/views/VibeCodingView.vue +5");
  });

  it("builds thought then action sequence", () => {
    const groups: AgentRoundGroupView[] = [{
      turn: 1,
      modelSteps: [],
      toolIds: ["t1"],
      narrative: "好的，我先读取文件。",
      tools: [{
        id: "t1",
        turn: 1,
        name: "read_file",
        icon: "📄",
        title: "读取",
        detail: "a.ts",
        label: "读取",
        summary: "读取 10 行内容",
        ok: true,
        args: { path: "a.ts" },
      }],
    }];

    const feed = buildCursorAgentFeed({ groups, isRunning: false });
    expect(feed[0].kind).toBe("thought");
    expect(feed[1].kind).toBe("action");
  });
});
