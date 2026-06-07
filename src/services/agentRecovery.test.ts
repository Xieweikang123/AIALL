import { describe, expect, it } from "vitest";
import {
  buildAgentResumePrompt,
  canResumeAgentRun,
  inferAgentRecoveryFlags,
  isRecoverableAgentError,
  recoverableAgentErrorHint,
  resolveAgentCompletedTurns,
  resolveAgentFailureBubbleContent,
  summarizeAgentProgress,
} from "./agentRecovery";

describe("isRecoverableAgentError", () => {
  it("detects common fetch / network failures", () => {
    expect(isRecoverableAgentError("Failed to fetch")).toBe(true);
    expect(isRecoverableAgentError("NetworkError when attempting to fetch resource.")).toBe(true);
    expect(isRecoverableAgentError("fetch failed")).toBe(true);
    expect(isRecoverableAgentError("read ECONNRESET")).toBe(true);
  });

  it("rejects non-network errors", () => {
    expect(isRecoverableAgentError("模型返回格式错误")).toBe(false);
    expect(isRecoverableAgentError("HTTP 401")).toBe(false);
  });
});

describe("resolveAgentCompletedTurns", () => {
  it("prefers turn traces over zero done turns", () => {
    expect(
      resolveAgentCompletedTurns({
        turnTraces: [{ turn: 1 }, { turn: 2 }, { turn: 3 }],
        tools: [{ name: "read_file", summary: "ok" }],
      }),
    ).toBe(3);
  });
});

describe("summarizeAgentProgress", () => {
  it("lists completed tools and narratives", () => {
    const summary = summarizeAgentProgress({
      turnTraces: [{ turn: 1, assistantText: "先读文件" }, { turn: 2, assistantText: "再写入" }],
      tools: [
        { running: false, label: "读取文件 a.ts", summary: "120 行", ok: true, turn: 1 },
        { running: false, label: "写入文件 b.ts", summary: "已写入", ok: true, turn: 2 },
      ],
      turnFileDiffs: { "src/b.ts": {} },
    });
    expect(summary).toContain("已完成 2 轮");
    expect(summary).toContain("读取文件 a.ts");
    expect(summary).toContain("再写入");
    expect(summary).toContain("src/b.ts");
  });
});

describe("buildAgentResumePrompt", () => {
  it("includes original task and progress context", () => {
    const prompt = buildAgentResumePrompt(
      {
        tools: [{ running: false, label: "搜索文件", summary: "3 个匹配", ok: true, turn: 1 }],
        turnTraces: [{ turn: 1, assistantText: "搜索中" }],
      },
      "实现粘贴图片功能",
      "Failed to fetch",
    );
    expect(prompt).toContain("【恢复运行】");
    expect(prompt).toContain("Failed to fetch");
    expect(prompt).toContain("搜索文件");
    expect(prompt).toContain("实现粘贴图片功能");
  });
});

describe("canResumeAgentRun", () => {
  it("allows resume only for recoverable failures", () => {
    expect(canResumeAgentRun({ agentFailed: true, agentRecoverable: true })).toBe(true);
    expect(canResumeAgentRun({ agentFailed: true, agentRecoverable: false })).toBe(false);
    expect(canResumeAgentRun({ agentFailed: true, agentRecoverable: true, agentAborted: true })).toBe(false);
    expect(canResumeAgentRun({ agentFailed: true, agentRecoverable: true, agentRecoveryDismissed: true })).toBe(
      false,
    );
  });

  it("does not infer recoverable state at runtime from legacy content", () => {
    expect(
      canResumeAgentRun({
        role: "assistant",
        content: "Failed to fetch",
        tools: [{ running: false, label: "搜索文件", summary: "3 个匹配", ok: true, turn: 1 }],
      }),
    ).toBe(false);
  });
});

describe("inferAgentRecoveryFlags", () => {
  it("reads failure reason from status log", () => {
    const flags = inferAgentRecoveryFlags({
      role: "assistant",
      tools: [{ running: false, summary: "ok" }],
      statusLog: ["连接中断：Failed to fetch（可恢复运行）"],
    });
    expect(flags?.agentRecoverable).toBe(true);
    expect(flags?.agentFailureReason).toBe("Failed to fetch");
  });

  it("skips inference after recovery was dismissed", () => {
    expect(
      inferAgentRecoveryFlags({
        role: "assistant",
        agentRecoveryDismissed: true,
        content: "Failed to fetch",
        tools: [{ running: false, summary: "ok" }],
      }),
    ).toBeNull();
  });
});

describe("resolveAgentFailureBubbleContent", () => {
  it("replaces raw fetch error with progress summary when tools exist", () => {
    const text = resolveAgentFailureBubbleContent({
      content: "Failed to fetch",
      tools: [{ running: false, label: "读取文件", ok: true }],
      turnTraces: [{ turn: 1, assistantText: "分析输入框结构" }],
    });
    expect(text).not.toBe("Failed to fetch");
    expect(text).toContain("分析输入框结构");
  });
});

describe("recoverableAgentErrorHint", () => {
  it("mentions turns and resume action", () => {
    const hint = recoverableAgentErrorHint(
      { turnTraces: [{ turn: 1 }, { turn: 2 }], tools: [{ running: false, summary: "ok" }] },
      "Failed to fetch",
    );
    expect(hint).toContain("网络中断");
    expect(hint).toContain("恢复运行");
    expect(hint).toContain("Failed to fetch");
  });
});
