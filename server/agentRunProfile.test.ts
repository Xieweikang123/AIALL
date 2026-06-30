import { describe, expect, it } from "vitest";
import {
  buildExecutePlanSystemHint,
  formatTargetFileManifest,
} from "./agentRunProfile";

describe("formatTargetFileManifest", () => {
  it("marks missing files and suggestions", () => {
    const text = formatTargetFileManifest([
      { requested: "src/views/AiAssistantView.vue", status: "missing", suggestions: ["src/views/VibeCodingView.vue"] },
      { requested: "src/a.ts", status: "ok", resolved: "src/a.ts", lines: 40 },
    ]);
    expect(text).toContain("AiAssistantView.vue");
    expect(text).toContain("VibeCodingView.vue");
    expect(text).toContain("✓ src/a.ts");
  });
});

describe("buildExecutePlanSystemHint", () => {
  it("guides without banning tool calls", () => {
    const hint = buildExecutePlanSystemHint(
      [{ requested: "src/a.ts", status: "ok", resolved: "src/a.ts", lines: 40 }],
      "改聊天发送",
    );
    expect(hint).toContain("read_file");
    expect(hint).toContain("search_files");
    expect(hint).toContain(".aiall/plans/");
    expect(hint).not.toMatch(/禁止/);
  });
});
