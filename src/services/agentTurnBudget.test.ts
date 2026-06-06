import { describe, expect, it } from "vitest";
import { resolveAgentMaxTurns } from "../../server/agentTurnBudget";

describe("resolveAgentMaxTurns", () => {
  it("uses a modest default for short Ask prompts", () => {
    expect(resolveAgentMaxTurns({ mode: "ask", prompt: "这是啥文件" })).toBe(4);
  });

  it("raises budget for complex Build tasks", () => {
    const turns = resolveAgentMaxTurns({
      mode: "build",
      prompt: "请重构整个 src 目录并修复所有测试",
      history: Array.from({ length: 12 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `msg ${i}`,
      })) as Array<{ role: "user" | "assistant"; content: string }>,
    });
    expect(turns).toBeGreaterThanOrEqual(12);
    expect(turns).toBeLessThanOrEqual(16);
  });

  it("never exceeds mode caps", () => {
    expect(
      resolveAgentMaxTurns({
        mode: "ask",
        prompt: "@a @b @c 重构迁移调试修复实现添加删除全部所有整个批量",
        history: Array.from({ length: 20 }, () => ({ role: "user" as const, content: "x" })),
      }),
    ).toBe(10);
  });
});
