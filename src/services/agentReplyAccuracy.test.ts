import { describe, expect, it } from "vitest";
import { buildReplyAccuracyHint } from "./agentReplyAccuracy";

describe("buildReplyAccuracyHint", () => {
  it("covers trace, binary conclusions, tools, consistency, patch verify, and expression", () => {
    const hint = buildReplyAccuracyHint();
    expect(hint).toContain("行为类问题");
    expect(hint).toContain("至少两层");
    expect(hint).toContain("会/不会");
    expect(hint).toContain("grep 精确符号");
    expect(hint).toContain("显式更正");
    expect(hint).toContain("read 验证");
    expect(hint).toContain("你之前");
    expect(hint).toContain("运行时入口");
    expect(hint).toContain("行号");
    expect(hint).toContain("修复宣称");
    expect(hint).toContain("list_dir");
    expect(hint).toContain("外部配置映射");
    expect(hint).toContain("枚举个数优先");
    expect(hint).toContain("假设验证原则");
    expect(hint).toContain("全局上下文盘点");
  });

  it("avoids topic-specific playbook terms", () => {
    const hint = buildReplyAccuracyHint();
    expect(hint).not.toContain("CronSchedule");
    expect(hint).not.toContain("IJob");
    expect(hint).not.toContain("v-if/shimmer");
    expect(hint).not.toMatch(/updatedAt|touchTimestamp|switchSession|FilePanel|vibeChat/i);
  });
});
