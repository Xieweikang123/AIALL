import { describe, expect, it } from "vitest";
import { buildConsultativeBuildHint, isConsultativeUserPrompt } from "./agentUserIntent";

describe("isConsultativeUserPrompt", () => {
  it("detects question-only prompts", () => {
    expect(isConsultativeUserPrompt("这个输入框，点哪里能聚焦？")).toBe(true);
    expect(isConsultativeUserPrompt("这是什么组件")).toBe(true);
    expect(isConsultativeUserPrompt("为什么点击没反应")).toBe(true);
  });

  it("rejects explicit implement requests", () => {
    expect(isConsultativeUserPrompt("帮我把输入框改成可聚焦")).toBe(false);
    expect(isConsultativeUserPrompt("实现点击空白也能聚焦")).toBe(false);
    expect(isConsultativeUserPrompt("修复聚焦问题")).toBe(false);
  });

  it("rejects automation/resume prompts", () => {
    expect(isConsultativeUserPrompt("【方案执行阶段】请直接动手")).toBe(false);
  });

  it("treats short evaluative follow-ups as consultative despite 优化", () => {
    expect(isConsultativeUserPrompt("需要优化吗")).toBe(true);
    expect(isConsultativeUserPrompt("要不要调整呢")).toBe(true);
  });

  it("treats screenshot UI defect reports as implement intent even with ？", () => {
    expect(isConsultativeUserPrompt("看到没，引用按钮跑别的地方了？")).toBe(false);
    expect(isConsultativeUserPrompt("你看，这个按钮错位了？")).toBe(false);
  });
});

describe("buildConsultativeBuildHint", () => {
  it("mentions read-only tools", () => {
    expect(buildConsultativeBuildHint()).toContain("禁止 patch_file");
    expect(buildConsultativeBuildHint()).toContain("grep");
  });
});
