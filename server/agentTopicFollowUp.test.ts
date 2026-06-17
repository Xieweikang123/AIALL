import { describe, expect, it } from "vitest";
import { buildImmediateTopicFollowUpHint } from "./agentTopicFollowUp";

const EXPLANATION = [
  "这个错误出现在 `patch_file` 工具调用时：",
  "",
  "**原因**：`old_string` 须与磁盘内容逐字符完全一致。",
  "**解决方式**：重新 read_file 后再 patch。",
].join("\n");

describe("buildImmediateTopicFollowUpHint", () => {
  it("anchors short evaluative follow-up to prior explanation", () => {
    const hint = buildImmediateTopicFollowUpHint("需要优化吗", EXPLANATION, "需要优化吗");
    expect(hint).toContain("【延续上一轮话题】");
    expect(hint).toContain("禁止切换到本会话中更早的其他任务");
    expect(hint).toContain("需要优化吗");
  });

  it("skips unrelated long prompts", () => {
    const prompt = "帮我把 src/foo.ts 里的重试逻辑改成指数退避";
    expect(buildImmediateTopicFollowUpHint(prompt, EXPLANATION, prompt)).toBe(prompt);
  });

  it("skips when prior assistant was not explanatory", () => {
    const prior = "已压缩完成，主要改动：padding 从 8px 压到 3px。";
    expect(buildImmediateTopicFollowUpHint("需要优化吗", prior, "需要优化吗")).toBe("需要优化吗");
  });

  it("does not double-inject when hint already present", () => {
    const prior = buildImmediateTopicFollowUpHint("需要优化吗", EXPLANATION, "需要优化吗");
    const again = buildImmediateTopicFollowUpHint(prior, EXPLANATION, "需要优化吗");
    expect(again).toBe(prior);
  });
});
