import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./vibeCodingClient", () => ({
  writeFile: vi.fn(),
}));

import { writeFile } from "./vibeCodingClient";
import { dumpAgentTraceToFile } from "./agentTraceDump";
import type { AgentRoundGroupView } from "./agentRoundGroups";

const writeFileMock = vi.mocked(writeFile);

function sampleGroups(): AgentRoundGroupView[] {
  return [
    {
      turn: 1,
      modelSteps: [],
      toolIds: [],
      tools: [],
      request: {
        model: "test-model",
        contextMessages: 1,
        contextChars: 12,
        messages: [{ role: "user", content: "hello" }],
      },
      response: {
        assistantText: "world",
        hasToolCalls: false,
        isFinal: true,
        toolCalls: [],
      },
    },
  ];
}

describe("dumpAgentTraceToFile", () => {
  beforeEach(() => {
    writeFileMock.mockReset();
  });

  it("rejects when project path is missing", async () => {
    const result = await dumpAgentTraceToFile({
      projectPath: "  ",
      roundGroups: sampleGroups(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("打开项目");
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("rejects when there is no trace data", async () => {
    const result = await dumpAgentTraceToFile({
      projectPath: "D:/project/AIALL",
      roundGroups: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("暂无轨迹");
  });

  it("writes under .aiall/agent-traces and returns absolute path + clipboard text", async () => {
    writeFileMock.mockResolvedValue({
      ok: true,
      path: "D:\\project\\AIALL\\.aiall\\agent-traces\\trace-demo.json",
      size: 100,
    });

    const result = await dumpAgentTraceToFile({
      projectPath: "D:\\project\\AIALL",
      sessionId: "1781689365698-5b7c3cda4e73e",
      messageId: "msg-abc",
      roundGroups: sampleGroups(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [relPath, content, root] = writeFileMock.mock.calls[0];
    expect(relPath).toMatch(/^\.aiall\/agent-traces\/trace-.+-msg-abc\.json$/);
    expect(root).toBe("D:\\project\\AIALL");
    expect(content).toContain('"messageId": "msg-abc"');
    expect(content).toContain('"assistantText": "world"');

    expect(result.absolutePath).toBe(
      "D:\\project\\AIALL\\.aiall\\agent-traces\\trace-demo.json",
    );
    expect(result.clipboardText).toContain(result.absolutePath);
    expect(result.clipboardText).toContain(
      "%APPDATA%\\aiall\\vibe-chat-sessions\\chat-1781689365698-5b7c3cda4e73e.json",
    );
    expect(result.clipboardText).toContain("messageId: msg-abc");
  });
});
