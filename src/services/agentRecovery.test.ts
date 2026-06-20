import { describe, expect, it } from "vitest";
import { PARTIAL_WRITE_ABORT_HEADING } from "./agentMessageDisplay";
import {
  agentConnectStallMessage,
  agentStallRecoveryReason,
  buildAgentMaxTurnsExhaustedMessage,
  buildAgentResumePrompt,
  buildSilentContinueStatusLog,
  canResumeAgentRun,
  hasRecoverableAgentProgress,
  HMR_INTERRUPT_REASON,
  inferAgentRecoveryFlags,
  isAgentMaxTurnsExhausted,
  isAgentConnectPhase,
  isAgentConnectStalled,
  isAgentRunStalled,
  isRecoverableAgentError,
  isIncompleteAgentRunWithoutFinalAnswer,
  isPartialWrittenRunInterrupt,
  PARTIAL_RUN_RESUME_REASON,
  resolveAgentResumeButtonLabel,
  shouldOfferPartialRunResume,
  shouldAutoResumeAgentError,
  shouldSilentAutoContinue,
  AGENT_AUTO_RESUME_SECONDS,
  AGENT_AUTO_RESUME_IMMEDIATE_SECONDS,
  AGENT_SILENT_CONTINUE_MAX,
  resolveAutoResumeSeconds,
  recoverableAgentErrorHint,
  resolveAgentCompletedTurns,
  resolveAgentFailureBubbleContent,
  buildAgentRunningStatusText,
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

  it("detects Chinese timeout and stream-interruption messages", () => {
    expect(isRecoverableAgentError("模型响应超时（等待首包超过 60s）")).toBe(true);
    expect(isRecoverableAgentError("连接中断（流已结束但未收到完成信号）")).toBe(true);
    expect(isRecoverableAgentError(agentStallRecoveryReason())).toBe(true);
  });

  it("detects max-turn exhaustion as recoverable", () => {
    const message = buildAgentMaxTurnsExhaustedMessage(12);
    expect(isRecoverableAgentError(message)).toBe(true);
  });
});

describe("shouldAutoResumeAgentError", () => {
  it("auto-continues transient disconnects but not turn-cap exhaustion", () => {
    expect(shouldAutoResumeAgentError("Failed to fetch")).toBe(true);
    expect(shouldAutoResumeAgentError("连接中断（运行未完成）")).toBe(true);
    expect(shouldAutoResumeAgentError(buildAgentMaxTurnsExhaustedMessage(12))).toBe(false);
    expect(shouldAutoResumeAgentError("模型返回格式错误")).toBe(false);
  });

  it("uses a 2–10 second countdown window", () => {
    expect(AGENT_AUTO_RESUME_IMMEDIATE_SECONDS).toBeGreaterThanOrEqual(1);
    expect(AGENT_AUTO_RESUME_IMMEDIATE_SECONDS).toBeLessThan(AGENT_AUTO_RESUME_SECONDS);
    expect(AGENT_AUTO_RESUME_SECONDS).toBeGreaterThanOrEqual(2);
    expect(AGENT_AUTO_RESUME_SECONDS).toBeLessThanOrEqual(10);
  });

  it("shortens auto-resume for transport errors", () => {
    expect(resolveAutoResumeSeconds("network error")).toBe(AGENT_AUTO_RESUME_IMMEDIATE_SECONDS);
    expect(resolveAutoResumeSeconds("Failed to fetch")).toBe(AGENT_AUTO_RESUME_IMMEDIATE_SECONDS);
    expect(resolveAutoResumeSeconds("连接中断（流已结束但未收到完成信号）")).toBe(
      AGENT_AUTO_RESUME_IMMEDIATE_SECONDS,
    );
    expect(resolveAutoResumeSeconds("模型响应超时（等待首包超过 60s）")).toBe(AGENT_AUTO_RESUME_SECONDS);
  });
});

describe("isAgentMaxTurnsExhausted", () => {
  it("flags runs that ended on the cap while still calling tools", () => {
    expect(
      isAgentMaxTurnsExhausted(
        {
          agentMaxTurns: 12,
          tools: [
            { running: false, turn: 11, name: "grep" },
            { running: false, turn: 12, name: "read_file" },
          ],
        },
        12,
      ),
    ).toBe(true);
  });

  it("allows successful completion on the final allowed turn", () => {
    expect(
      isAgentMaxTurnsExhausted(
        {
          agentMaxTurns: 12,
          tools: [{ running: false, turn: 11, name: "grep" }],
        },
        12,
      ),
    ).toBe(false);
  });
});

describe("isAgentRunStalled", () => {
  it("flags runs with no progress beyond the threshold", () => {
    const now = Date.now();
    expect(isAgentRunStalled(now - 130_000, true, now)).toBe(true);
    expect(isAgentRunStalled(now - 30_000, true, now)).toBe(false);
    expect(isAgentRunStalled(now - 130_000, false, now)).toBe(false);
  });
});

describe("hasRecoverableAgentProgress", () => {
  it("requires completed steps, not an empty run", () => {
    expect(hasRecoverableAgentProgress({ tools: [] })).toBe(false);
    expect(
      hasRecoverableAgentProgress({
        tools: [{ running: false, label: "读取文件", summary: "ok" }],
      }),
    ).toBe(true);
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
    expect(prompt).toContain("【自动续跑】");
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

  it("allows resume after user stop when partial files were written", () => {
    expect(
      canResumeAgentRun({
        agentFailed: true,
        agentRecoverable: true,
        agentAborted: true,
        writtenFiles: ["src/foo.ts"],
        content: `## ${PARTIAL_WRITE_ABORT_HEADING}\n\n- \`src/foo.ts\``,
      }),
    ).toBe(true);
  });

  it("allows resume after HMR interrupt when progress exists", () => {
    expect(
      canResumeAgentRun({
        agentFailed: true,
        agentRecoverable: true,
        agentAborted: true,
        agentAbortReason: HMR_INTERRUPT_REASON,
        tools: [{ running: false, label: "读取文件", summary: "ok", turn: 1 }],
      }),
    ).toBe(true);
  });

  it("blocks resume after manual stop even with progress", () => {
    expect(
      canResumeAgentRun({
        agentFailed: true,
        agentRecoverable: true,
        agentAborted: true,
        agentAbortReason: "已手动停止",
        tools: [{ running: false, label: "读取文件", summary: "ok", turn: 1 }],
      }),
    ).toBe(false);
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

describe("buildAgentRunningStatusText", () => {
  it("combines phase status with partial write count", () => {
    expect(
      buildAgentRunningStatusText(
        { writtenFiles: ["src/foo.ts"], tools: [{ running: false, summary: "ok" }] },
        "第 3 轮 · 执行工具",
      ),
    ).toBe("第 3 轮 · 执行工具 · 已落盘 1 个文件");
  });

  it("falls back to default label", () => {
    expect(buildAgentRunningStatusText({}, "")).toBe("Agent 运行中…");
  });
});

describe("shouldOfferPartialRunResume", () => {
  it("offers resume when stopped run wrote files without a final summary", () => {
    expect(
      shouldOfferPartialRunResume({
        wasAborted: true,
        writtenFiles: ["src/foo.ts"],
        msg: { tools: [{ running: false, summary: "ok", turn: 1 }] },
      }),
    ).toBe(true);
  });

  it("skips when the run completed with a substantive summary", () => {
    expect(
      shouldOfferPartialRunResume({
        wasAborted: true,
        writtenFiles: ["src/foo.ts"],
        msg: {
          tools: [{ running: false, summary: "ok", turn: 1 }],
          roundGroups: [
            {
              turn: 1,
              modelSteps: [],
              toolIds: [],
              response: {
                assistantText: "## 修改完成\n已将 Pop 改为 Apply，并更新了后端路由与前端客户端。",
                toolCalls: [],
                hasToolCalls: false,
                isFinal: true,
              },
            },
          ],
        },
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

  it("skips inference after recovery was dismissed for network errors", () => {
    expect(
      inferAgentRecoveryFlags({
        role: "assistant",
        agentRecoveryDismissed: true,
        content: "Failed to fetch",
        tools: [{ running: false, summary: "ok" }],
      }),
    ).toBeNull();
  });

  it("re-infers max-turn exhaustion even when recovery was dismissed", () => {
    const flags = inferAgentRecoveryFlags({
      role: "assistant",
      agentRecoveryDismissed: true,
      totalTurns: 12,
      roundGroups: [{ turn: 12, maxTurns: 12, modelSteps: [], toolIds: [] }],
      tools: [{ running: false, turn: 12, summary: "ok" }],
    });
    expect(flags?.agentRecoverable).toBe(true);
    expect(flags?.agentFailureReason).toContain("已达最大轮次（12）");
  });

  it("re-infers partial-write interruption even when recovery was dismissed", () => {
    const flags = inferAgentRecoveryFlags({
      role: "assistant",
      agentRecoveryDismissed: true,
      agentAborted: true,
      writtenFiles: ["src/foo.ts"],
      content: `## ${PARTIAL_WRITE_ABORT_HEADING}\n\n- \`src/foo.ts\``,
      tools: [{ running: false, summary: "ok", turn: 1 }],
    });
    expect(flags?.agentRecoverable).toBe(true);
    expect(flags?.agentFailureReason).toBe(PARTIAL_RUN_RESUME_REASON);
  });

  it("re-infers incomplete silent-continue run even when recovery was dismissed", () => {
    const flags = inferAgentRecoveryFlags({
      role: "assistant",
      agentRecoveryDismissed: true,
      agentContinueCount: 3,
      content: "让我看看 `useProjectMemory.ts` 中归档保存的完整流程，以及归档文件如何被后续注入。",
      tools: [{ running: false, summary: "读取 149 行内容", turn: 1 }],
      statusLog: [
        "继续执行（自动续跑 3/8）…",
        "正在发送模型请求… · 正在发送请求…",
      ],
      roundGroups: [
        { turn: 1, maxTurns: 40, modelSteps: [], toolIds: ["t1"] },
      ],
    });
    expect(flags?.agentRecoverable).toBe(true);
    expect(flags?.agentFailureReason).toBe("运行中断（未生成最终回复）");
  });

  it("does not treat normal model-wait status lines as recoverable errors", () => {
    expect(
      isRecoverableAgentError("正在等待模型响应（第 7/24 轮 · mimo-v2.5）… · 等待模型首包 · 3s"),
    ).toBe(false);
  });
});

describe("isIncompleteAgentRunWithoutFinalAnswer", () => {
  it("detects incomplete agent run without final answer", () => {
    expect(
      isIncompleteAgentRunWithoutFinalAnswer({
        tools: [{ running: false, summary: "ok", turn: 1 }],
        roundGroups: [{ turn: 1, maxTurns: 24, modelSteps: [], toolIds: ["t1"] }],
        content: "让我看看相关逻辑。",
      }),
    ).toBe(true);
  });

  it("returns false when a substantive final answer exists", () => {
    expect(
      isIncompleteAgentRunWithoutFinalAnswer({
        tools: [{ running: false, summary: "ok", turn: 1 }],
        content: "A".repeat(80),
        roundGroups: [
          {
            turn: 2,
            maxTurns: 24,
            modelSteps: [],
            toolIds: [],
            response: { assistantText: "A".repeat(80), hasToolCalls: false, isFinal: true, toolCalls: [] },
          },
        ],
      }),
    ).toBe(false);
  });
});

describe("inferAgentRecoveryFlags (continued)", () => {
  it("infers recoverable flags for HMR-aborted runs with progress", () => {
    const flags = inferAgentRecoveryFlags({
      role: "assistant",
      agentAborted: true,
      agentAbortReason: HMR_INTERRUPT_REASON,
      tools: [{ running: false, label: "读取文件", summary: "ok", turn: 1 }],
    });
    expect(flags?.agentRecoverable).toBe(true);
    expect(flags?.agentFailureReason).toBe(HMR_INTERRUPT_REASON);
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
    expect(text).toContain("恢复运行");
  });
});

describe("resolveAgentResumeButtonLabel", () => {
  it("uses 继续 for partial-write interruption", () => {
    expect(
      resolveAgentResumeButtonLabel({
        writtenFiles: ["src/foo.ts"],
        content: `## ${PARTIAL_WRITE_ABORT_HEADING}`,
      }),
    ).toBe("继续");
    expect(resolveAgentResumeButtonLabel({ content: "Failed to fetch" })).toBe("恢复运行");
  });
});

describe("recoverableAgentErrorHint", () => {
  it("mentions 继续 for partial-write interruption", () => {
    const hint = recoverableAgentErrorHint(
      {
        writtenFiles: ["src/foo.ts"],
        content: `## ${PARTIAL_WRITE_ABORT_HEADING}`,
      },
      PARTIAL_RUN_RESUME_REASON,
    );
    expect(hint).toContain("继续");
    expect(hint).toContain("1 个文件");
  });

  it("mentions resume for HMR interruption with progress", () => {
    const hint = recoverableAgentErrorHint(
      {
        agentAbortReason: HMR_INTERRUPT_REASON,
        tools: [{ running: false, label: "读取文件", summary: "ok", turn: 1 }],
      },
      HMR_INTERRUPT_REASON,
    );
    expect(hint).toContain("恢复运行");
    expect(hint).toContain(HMR_INTERRUPT_REASON);
  });

  it("mentions turns and manual retry after silent continue gives up", () => {
    const hint = recoverableAgentErrorHint(
      { turnTraces: [{ turn: 1 }, { turn: 2 }], tools: [{ running: false, summary: "ok" }] },
      "Failed to fetch",
    );
    expect(hint).toContain("自动续跑");
    expect(hint).toContain("恢复运行");
    expect(hint).toContain("Failed to fetch");
  });

  it("mentions turn cap for max-turns exhaustion without implying auto-retry", () => {
    const hint = recoverableAgentErrorHint(
      { turnTraces: [{ turn: 1 }, { turn: 2 }, { turn: 3 }], tools: [{ running: false, summary: "ok" }] },
      buildAgentMaxTurnsExhaustedMessage(3),
    );
    expect(hint).toContain("轮次上限");
    expect(hint).toContain("恢复运行");
    expect(hint).not.toContain("自动续跑");
  });

  it("mentions stall for long-no-progress recovery", () => {
    const hint = recoverableAgentErrorHint(
      { turnTraces: [{ turn: 1 }], tools: [{ running: false, summary: "ok" }] },
      agentStallRecoveryReason(),
    );
    expect(hint).toContain("卡住");
    expect(hint).toContain("恢复运行");
  });

  it("mentions missing final answer when run completed without summary", () => {
    const hint = recoverableAgentErrorHint(
      { turnTraces: [{ turn: 1 }], tools: [{ running: false, summary: "ok" }] },
      "运行中断（未生成最终回复）",
    );
    expect(hint).toContain("未生成最终回复");
    expect(hint).toContain("恢复运行");
  });
});

describe("silent continue helpers", () => {
  it("builds status log for seamless continuation", () => {
    expect(buildSilentContinueStatusLog("network error", 2)).toContain("自动续跑（第 2 次）");
  });

  it("caps silent attempts", () => {
    expect(AGENT_SILENT_CONTINUE_MAX).toBeGreaterThanOrEqual(3);
    expect(shouldSilentAutoContinue(buildAgentMaxTurnsExhaustedMessage(20))).toBe(false);
    expect(shouldSilentAutoContinue("Failed to fetch")).toBe(true);
  });
});

describe("agent connect stall", () => {
  it("detects connect phases", () => {
    expect(isAgentConnectPhase("connecting_local")).toBe(true);
    expect(isAgentConnectPhase("waiting_model")).toBe(false);
  });

  it("flags long connect waits", () => {
    const now = 1_000_000;
    expect(isAgentConnectStalled(now - 50_000, "connecting_local", true, now)).toBe(true);
    expect(isAgentConnectStalled(now - 10_000, "connecting_local", true, now)).toBe(false);
  });

  it("builds helpful connect stall message", () => {
    expect(agentConnectStallMessage(true)).toContain("sidecar");
    expect(agentConnectStallMessage(false)).toContain("37891");
  });
});
