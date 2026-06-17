import { describe, expect, it } from "vitest";
import {
  buildAgentPromptForProfile,
  enrichAgentUserPrompt,
  resolveAgentMaxTurns,
  resolveAgentResumeRunProfile,
  resolveAgentRunProfile,
} from "./agentRunProfile";

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

  it("uses execute_plan for plan-mode confirmations after a plan", () => {
    const profile = resolveAgentRunProfile({
      prompt: "执行方案",
      mode: "plan",
      lastAssistantContent: SAMPLE_PLAN,
    });
    expect(profile.kind).toBe("execute_plan");
    expect(profile.targetFiles).toContain("src/components/ChatComposerEditor.vue");
  });

  it("uses execute_plan when user asks to implement after quoting the plan", () => {
    const profile = resolveAgentRunProfile({
      prompt: "> Agent: …\n\n实现 vibe coding 页的发图功能",
      mode: "build",
      lastAssistantContent: SAMPLE_PLAN,
    });
    expect(profile.kind).toBe("execute_plan");
    expect(profile.userIntent).toContain("实现");
  });

  it("stays interactive for ask mode even after 改吧", () => {
    const profile = resolveAgentRunProfile({
      prompt: "改吧",
      mode: "ask",
      lastAssistantContent: SAMPLE_PLAN,
    });
    expect(profile.kind).toBe("interactive");
  });

  it("uses execute_plan when user @ references files with edit intent", () => {
    const profile = resolveAgentRunProfile({
      prompt: "支持一下粘贴图片\n\n## 📎 参考文件\n\n### 📄 src/components/ChatComposerEditor.vue",
      mode: "build",
    });
    expect(profile.kind).toBe("execute_plan");
    expect(profile.targetFiles).toContain("src/components/ChatComposerEditor.vue");
  });

  it("stays interactive for pure questions even with @ refs", () => {
    const profile = resolveAgentRunProfile({
      prompt: "有没有发图功能\n\n## 📎 参考文件\n\n### 📄 src/views/VibeCodingView.vue",
      mode: "build",
    });
    expect(profile.kind).toBe("interactive");
  });

  it("uses execute_plan for implement intent without @ refs", () => {
    const profile = resolveAgentRunProfile({
      prompt: "Vibe Coding 支持一下粘贴图片",
      mode: "build",
    });
    expect(profile.kind).toBe("execute_plan");
    expect(profile.userIntent).toContain("支持");
    expect(profile.targetFiles).toBeUndefined();
  });

  it("uses execute_plan when user clarifies click-anywhere input requirement", () => {
    const profile = resolveAgentRunProfile({
      prompt: "我要的效果是，点击输入框任何位置，都能输入",
      mode: "build",
      lastAssistantContent: "已修复聚焦描边样式。",
    });
    expect(profile.kind).toBe("execute_plan");
    expect(profile.userIntent).toContain("任何位置");
  });

  it("enrichAgentUserPrompt keeps scope hint even when images are attached", () => {
    const prior = "已修复。添加了 `.composer-editor.focused` 聚焦描边。";
    const hint = enrichAgentUserPrompt("我要的效果是，点击输入框任何位置，都能输入", {
      lastAssistantContent: prior,
      hasImages: true,
    });
    expect(hint).toContain("点击/聚焦交互");
    expect(hint).not.toBe("我要的效果是，点击输入框任何位置，都能输入");
  });

  it("enrichAgentUserPrompt anchors short follow-up to prior explanation", () => {
    const prior = [
      "这个错误出现在 `patch_file` 工具调用时：",
      "**原因**：须逐字符完全一致。",
      "**解决方式**：重新 read_file 后再 patch。",
    ].join("\n");
    const hint = enrichAgentUserPrompt("需要优化吗", { lastAssistantContent: prior });
    expect(hint).toContain("【延续上一轮话题】");
    expect(hint).toContain("需要优化吗");
  });

  it("uses execute_plan for 继续 after partial progress on resume", () => {
    const profile = resolveAgentResumeRunProfile(
      {
        totalTurns: 12,
        tools: [
          {
            running: false,
            name: "read_file",
            turn: 3,
            label: "读取文件 src/foo.ts",
            ok: true,
            args: { path: "src/foo.ts" },
          },
          { running: false, name: "grep", turn: 2, ok: true },
        ],
      },
      "输入框支持发送图片吗？",
      "build",
    );
    expect(profile.kind).toBe("execute_plan");
    expect(profile.targetFiles).toContain("src/foo.ts");
  });
});

describe("buildAgentPromptForProfile", () => {
  it("adds execution guidance without banning read_file", () => {
    const prompt = buildAgentPromptForProfile("改吧", {
      kind: "execute_plan",
      targetFiles: ["src/foo.ts"],
    });
    expect(prompt).toContain("read_file");
    expect(prompt).toContain("不要再次询问是否开始");
    expect(prompt).not.toContain("禁止 read_file");
  });
});

describe("resolveAgentMaxTurns export", () => {
  it("re-exports turn budget helper from server module", () => {
    expect(resolveAgentMaxTurns("build", { kind: "execute_plan" })).toBe(20);
    expect(resolveAgentMaxTurns("plan", { kind: "execute_plan" })).toBe(20);
    expect(resolveAgentMaxTurns("plan", { kind: "interactive" })).toBe(16);
  });
});
