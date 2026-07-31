import { describe, expect, it } from "vitest";
import { buildReplyAccuracyHint } from "./agentReplyAccuracy";

describe("buildReplyAccuracyHint", () => {
  it("covers trace, binary conclusions, tools, consistency, patch verify, and expression", () => {
    const hint = buildReplyAccuracyHint();
    expect(hint).toContain("机制事实结论");
    expect(hint).toContain("直接决定结论的最后证据");
    expect(hint).toContain("实际执行路径与旁路 API 区分开");
    expect(hint).toContain("证据不足明确说不确定");
    expect(hint).toContain("不强制固定入口、层数或中间层");
    expect(hint).toContain("返回值、输出、异常、状态、事件、缓存结果或外部副作用");
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
    expect(hint).not.toContain("常见修复");
    expect(hint).not.toContain("padding:0");
    expect(hint).not.toContain("Execute→Service");
    expect(hint).not.toMatch(/updatedAt|touchTimestamp|switchSession|FilePanel|vibeChat/i);
  });
});
