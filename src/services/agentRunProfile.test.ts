import { describe, expect, it } from "vitest";
import { buildAgentPromptForProfile, resolveAgentRunProfile } from "./agentRunProfile";

const SAMPLE_PLAN = [
  "## 修改方案",
  "改 `src/components/ChatComposerEditor.vue`：",
  "```ts",
  "const imageDataUrl = ref('');",
  "```",
].join("\n");

describe("resolveAgentRunProfile", () => {
  it("uses execute_plan for build-mode confirmations after a plan", () => {
    const profile = resolveAgentRunProfile({
      prompt: "改吧",
      mode: "build",
      lastAssistantContent: SAMPLE_PLAN,
    });
    expect(profile.kind).toBe("execute_plan");
    expect(profile.targetFiles).toContain("src/components/ChatComposerEditor.vue");
  });

  it("stays interactive for ask mode even after 改吧", () => {
    const profile = resolveAgentRunProfile({
      prompt: "改吧",
      mode: "ask",
      lastAssistantContent: SAMPLE_PLAN,
    });
    expect(profile.kind).toBe("interactive");
  });
});

describe("buildAgentPromptForProfile", () => {
  it("adds execution guidance without banning read_file", () => {
    const prompt = buildAgentPromptForProfile("改吧", {
      kind: "execute_plan",
      targetFiles: ["src/foo.ts"],
    });
    expect(prompt).toContain("read_file");
    expect(prompt).not.toContain("禁止 read_file");
  });
});
