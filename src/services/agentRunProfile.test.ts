import { describe, expect, it } from "vitest";
import {
  buildAgentPromptForProfile,
  enrichAgentUserPrompt,
  resolveAgentMaxTurns,
  resolveAgentResumeRunProfile,
  resolveAgentRunProfile,
  resolveAskExecutionEscalation,
} from "./agentRunProfile";

const SAMPLE_PLAN = [
  "## 修改方案",
  "改 `src/foo.ts`：",
  "```ts",
  "const featureFlag = ref(false);",
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
    expect(profile.targetFiles).toContain("src/foo.ts");
  });

  it("uses execute_plan for plan-mode confirmations after a plan", () => {
    const profile = resolveAgentRunProfile({
      prompt: "执行方案",
      mode: "plan",
      lastAssistantContent: SAMPLE_PLAN,
    });
    expect(profile.kind).toBe("execute_plan");
    expect(profile.targetFiles).toContain("src/foo.ts");
  });

  it("uses execute_plan when user asks to implement after quoting the plan", () => {
    const profile = resolveAgentRunProfile({
      prompt: "> Agent: …\n\n实现上述方案中的改动",
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

  it("escalates ask-mode 改吧 after actionable plan to build execute_plan", () => {
    const escalation = resolveAskExecutionEscalation({
      prompt: "改吧",
      mode: "ask",
      lastAssistantContent: SAMPLE_PLAN,
    });
    expect(escalation).toEqual({
      mode: "build",
      runProfile: {
        kind: "execute_plan",
        targetFiles: ["src/foo.ts"],
        userIntent: "改吧",
      },
    });
  });

  it("does not escalate ask-mode 改吧 without actionable plan", () => {
    expect(
      resolveAskExecutionEscalation({
        prompt: "改吧",
        mode: "ask",
        lastAssistantContent: "这是补充说明，不涉及改代码。",
      }),
    ).toBeNull();
  });

  it("uses execute_plan when user @ references files with edit intent", () => {
    const profile = resolveAgentRunProfile({
      prompt: "支持一下这个功能\n\n## 📎 参考文件\n\n### 📄 src/foo.ts",
      mode: "build",
    });
    expect(profile.kind).toBe("execute_plan");
    expect(profile.targetFiles).toContain("src/foo.ts");
  });

  it("stays interactive for pure questions even with @ refs", () => {
    const profile = resolveAgentRunProfile({
      prompt: "有没有这个功能\n\n## 📎 参考文件\n\n### 📄 src/bar.ts",
      mode: "build",
    });
    expect(profile.kind).toBe("interactive");
  });

  it("uses execute_plan for implement intent without @ refs", () => {
    const profile = resolveAgentRunProfile({
      prompt: "支持一下接入该能力",
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

  it("uses execute_plan for 继续 after actionable proposal", () => {
    const proposal = [
      "具体改动：",
      "1. 移除 `src/foo.ts` 中的 `featureFlag`",
      "2. 精简 `src/bar.ts` 计算属性",
      "需要我执行吗？",
    ].join("\n");
    const profile = resolveAgentRunProfile({
      prompt: "继续",
      mode: "build",
      lastAssistantContent: proposal,
    });
    expect(profile.kind).toBe("execute_plan");
    expect(profile.targetFiles).toContain("src/foo.ts");
  });

  it("uses execute_plan for 执行 after actionable proposal without formal plan marker", () => {
    const proposal = [
      "建议在 `src/foo.ts` 添加底部留白：",
      "```css",
      ".panel { padding-bottom: 8px; }",
      "```",
      "请确认后我将执行 patch_file。",
    ].join("\n");
    const profile = resolveAgentRunProfile({
      prompt: "执行",
      mode: "build",
      lastAssistantContent: proposal,
    });
    expect(profile.kind).toBe("execute_plan");
  });

  it("stays interactive for ultra-short open task in build mode", () => {
    const profile = resolveAgentRunProfile({
      prompt: "优化",
      mode: "build",
    });
    expect(profile.kind).toBe("interactive");
  });

  it("stays interactive for audit-report follow-up optimization", () => {
    const profile = resolveAgentRunProfile({
      prompt: "优化吧",
      mode: "build",
      lastAssistantContent: [
        "## 审计报告",
        "### 改进建议",
        "1. Build 模式下默认直接执行。",
        "2. 读取当前状态，避免误判。",
        "3. 一次读取覆盖所需范围，避免碎片化读取。",
      ].join("\n"),
    });
    expect(profile.kind).toBe("interactive");
  });

  it("does not extract target files from audit report examples", () => {
    const profile = resolveAgentRunProfile({
      prompt: "优化吧",
      mode: "build",
      lastAssistantContent: [
        "## 审计报告",
        "### 改进建议",
        "1. Build 模式下默认直接执行。",
        "示例：`src/styles/foo.scss` 里曾出现 gap 过大。",
      ].join("\n"),
    });
    expect(profile).toEqual({ kind: "interactive" });
  });

  it("enrichAgentUserPrompt anchors audit-report optimization to system behavior", () => {
    const prior = [
      "## 审计报告",
      "### 改进建议",
      "1. Build 模式下默认直接执行。",
      "示例：`src/styles/foo.scss` 里曾出现 gap 过大。",
    ].join("\n");
    const hint = enrichAgentUserPrompt("优化吧", { lastAssistantContent: prior });
    expect(hint).toContain("【延续上一轮话题】");
    expect(hint).toContain("系统行为、流程和规则");
  });

  it("uses execute_plan for 继续 after partial progress on implement resume", () => {
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
      "继续改",
      "build",
      "部分改好了，下一步 patch src/foo.ts。",
    );
    expect(profile.kind).toBe("execute_plan");
    expect(profile.targetFiles).toContain("src/foo.ts");
  });

  it("stays interactive when resuming consultative Q&A after many read-only tools", () => {
    const profile = resolveAgentResumeRunProfile(
      {
        totalTurns: 8,
        tools: [
          {
            running: false,
            name: "read_file",
            turn: 7,
            ok: true,
            args: { path: "src/foo/StatusController.cs" },
          },
          { running: false, name: "grep", turn: 1, ok: true },
        ],
      },
      "> Agent: FlagPartial = 1\n\n啥作用",
      "build",
      undefined,
      [
        {
          role: "assistant",
          content: "共有三种：FlagNone=0、FlagPartial=1、FlagFull=2",
        },
      ],
    );
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
    expect(prompt).toContain("禁止再问");
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

describe("enrichAgentUserPrompt execution continuation", () => {
  it("adds no-screenshot hint when confirming without images", () => {
    const hint = enrichAgentUserPrompt("改吧", {
      lastAssistantContent: SAMPLE_PLAN,
      hasImages: false,
    });
    expect(hint).toContain("【续跑确认】");
    expect(hint).toContain("禁止写「看到截图");
  });
});
