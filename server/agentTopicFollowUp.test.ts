import { describe, expect, it } from "vitest";
import { buildImmediateTopicFollowUpHint } from "../src/orchestration/product/agentTopicFollowUp";

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

  it("anchors audit-report optimization to system behavior instead of example code", () => {
    const prior = [
      "## 审计报告",
      "**原因**：短追问被误路由。",
      "### 改进建议",
      "1. Build 模式下默认直接执行。",
      "2. 一次读取覆盖所需范围。",
      "示例：`src/styles/foo.scss` 里曾出现 gap 过大。",
    ].join("\n");
    const hint = buildImmediateTopicFollowUpHint("优化吧", prior, "优化吧");
    expect(hint).toContain("系统行为、流程和规则");
    expect(hint).toContain("不是示例代码片段");
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
