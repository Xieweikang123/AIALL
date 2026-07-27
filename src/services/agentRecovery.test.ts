import { describe, expect, it } from "vitest";
import { PARTIAL_WRITE_ABORT_HEADING } from "./agentMessageDisplay";
import {
  agentConnectStallMessage,
  agentStallRecoveryReason,
  buildAgentMaxTurnsExhaustedMessage,
  buildAgentResumePrompt,
  buildSilentContinueStatusLog,
  canResumeAgentRun,
  canReuseZeroProgressAssistantSlot,
  hasRecoverableAgentProgress,
  HMR_INTERRUPT_REASON,
  resetAssistantMessageForNewRun,
  prepareAssistantForResume,
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
  isAgentRuntimeReferenceError,
  formatAgentTransportErrorMessage,
  isAgentBillingOrAuthError,
  AGENT_AUTO_RESUME_SECONDS,
  AGENT_AUTO_RESUME_IMMEDIATE_SECONDS,
  AGENT_RATE_LIMIT_AUTO_RESUME_SECONDS,
  AGENT_RATE_LIMIT_SILENT_CONTINUE_DELAY_MS,
  AGENT_SILENT_CONTINUE_MAX,
  extractRateLimitHintFromStatusLog,
  isRateLimitAgentError,
  resolveSilentContinueDelayMs,
  resolveAutoResumeSeconds,
  resolveModelWaitStallMs,
  AGENT_MODEL_WAIT_STALL_MS,
  AGENT_CONTINUE_MODEL_WAIT_STALL_MS,
  recoverableAgentErrorHint,
  resolveAgentCompletedTurns,
  resolveAgentFailureBubbleContent,
  diagnoseMissingFinalAnswer,
  formatMissingFinalAnswerDetail,
  buildAgentRunningStatusText,
  resolveOriginalTaskFromResumePrompt,
  resolveResumeOriginalUserPrompt,
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

  it("detects transient HTTP 400 provider errors as recoverable", () => {
    expect(
      isRecoverableAgentError(
        "请求失败，HTTP 400：Error from provider (Xiaomi): unexpected end of data\n上游模型网关认为本次请求参数不合法。",
      ),
    ).toBe(true);
    expect(isRecoverableAgentError("请求失败，HTTP 400：invalid model name")).toBe(false);
  });

  it("detects HTTP 429 rate limits as recoverable", () => {
    expect(
      isRecoverableAgentError(
        "请求失败，HTTP 429：Error from provider (Xiaomi): Too many requests",
      ),
    ).toBe(true);
    expect(isRecoverableAgentError("Too many requests from provider")).toBe(true);
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

  it("uses longer delays for HTTP 429 rate limits", () => {
    const rateLimitMsg = "请求失败，HTTP 429：Error from provider (Xiaomi): Too many requests";
    expect(shouldAutoResumeAgentError(rateLimitMsg)).toBe(true);
    expect(shouldSilentAutoContinue(rateLimitMsg)).toBe(true);
    expect(resolveAutoResumeSeconds(rateLimitMsg)).toBe(AGENT_RATE_LIMIT_AUTO_RESUME_SECONDS);
    expect(resolveSilentContinueDelayMs(rateLimitMsg)).toBe(AGENT_RATE_LIMIT_SILENT_CONTINUE_DELAY_MS);
    expect(isRateLimitAgentError(rateLimitMsg)).toBe(true);
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

describe("canReuseZeroProgressAssistantSlot", () => {
  it("allows empty or early-aborted assistant shells", () => {
    expect(canReuseZeroProgressAssistantSlot({ role: "assistant", tools: [], content: "" })).toBe(
      true,
    );
    expect(
      canReuseZeroProgressAssistantSlot({
        role: "assistant",
        tools: [],
        agentAborted: true,
        agentAbortReason: "已被新指令打断",
        statusLog: ["已被新指令打断"],
      }),
    ).toBe(true);
  });

  it("rejects runs with progress or a final answer", () => {
    expect(
      canReuseZeroProgressAssistantSlot({
        role: "assistant",
        tools: [{ running: false, label: "读取", summary: "ok" }],
      }),
    ).toBe(false);
    expect(
      canReuseZeroProgressAssistantSlot({
        role: "assistant",
        roundGroups: [
          {
            turn: 1,
            modelSteps: [],
            response: {
              assistantText: "结论",
              toolCalls: [],
              hasToolCalls: false,
              isFinal: true,
            },
          },
        ],
      }),
    ).toBe(false);
  });
});

describe("resetAssistantMessageForNewRun", () => {
  it("keeps id and clears run artifacts", () => {
    const msg = resetAssistantMessageForNewRun(
      {
        id: "a1",
        role: "assistant",
        content: "stale",
        chatMode: "ask",
        tools: [{ running: false, label: "x", summary: "y" }],
        roundGroups: [{ turn: 1, modelSteps: [] }],
        statusLog: ["old"],
        agentAborted: true,
        agentAbortReason: "已被新指令打断",
        agentFailed: true,
        agentRecoverable: true,
        agentFailureReason: "x",
        agentContinueCount: 2,
      },
      "build",
    );
    expect(msg.id).toBe("a1");
    expect(msg.chatMode).toBe("build");
    expect(msg.content).toBe("");
    expect(msg.tools).toEqual([]);
    expect(msg.roundGroups).toEqual([]);
    expect(msg.statusLog).toBeUndefined();
    expect(msg.agentAborted).toBe(false);
    expect(msg.agentFailed).toBe(false);
    expect(msg.agentContinueCount).toBeUndefined();
  });
});

describe("prepareAssistantForResume", () => {
  it("clears incomplete-turn content and narrative even when an earlier turn isFinal", () => {
    const corrupt =
      "| GET | `api/dualdatabase/schema-db1`年度碳排放\" | 获取完整表结构 |\n\n/carbon-summary`";
    const msg = prepareAssistantForResume({
      content: corrupt,
      streamChars: corrupt.length,
      agentTurn: 3,
      roundGroups: [
        {
          turn: 2,
          modelSteps: [],
          toolIds: [],
          response: {
            assistantText: "中间工具轮",
            toolCalls: [],
            hasToolCalls: true,
            isFinal: false,
          },
        },
        {
          turn: 3,
          narrative: corrupt,
          modelSteps: [],
          toolIds: [],
        },
      ],
    });
    expect(msg.content).toBe("");
    expect(msg.streamChars).toBeUndefined();
    expect(msg.roundGroups?.find((g) => g.turn === 3)?.narrative).toBeUndefined();
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

  it("includes read_file ranges summary with merged overlapping ranges", () => {
    const summary = summarizeAgentProgress({
      tools: [
        { name: "read_file", ok: true, turn: 1, args: { path: "src/a.ts", offset: 1, limit: 100 } },
        { name: "read_file", ok: true, turn: 2, args: { path: "src/a.ts", offset: 90, limit: 50 } },
        { name: "read_file", ok: true, turn: 3, args: { path: "src/b.ts", offset: 200, limit: 50 } },
        { name: "grep", ok: true, turn: 1, args: { pattern: "foo" } },
      ],
    });
    expect(summary).toContain("已读文件范围");
    expect(summary).toContain("src/a.ts");
    expect(summary).toContain("src/b.ts");
    // L1-100 and L90-139 should merge to L1-139
    expect(summary).toContain("L1-139");
    expect(summary).toContain("L200-249");
  });

  it("skips read_file summary when no read_file tools", () => {
    const summary = summarizeAgentProgress({
      tools: [
        { name: "grep", ok: true, turn: 1, args: { pattern: "foo" } },
        { name: "patch_file", ok: true, turn: 2, args: { path: "src/a.ts" } },
      ],
    });
    expect(summary).not.toContain("已读文件范围");
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
    expect(prompt).toContain("patch_file");
  });

  it("uses read-only resume for consultative questions", () => {
    const prompt = buildAgentResumePrompt(
      {
        tools: [{ running: false, name: "grep", summary: "11 处匹配", ok: true, turn: 1 }],
      },
      "手动终止会话，也会通知？",
      "已手动停止",
    );
    expect(prompt).toContain("【咨询续跑·只读】");
    expect(prompt).toContain("禁止 patch_file");
    expect(prompt).not.toContain("后直接 patch_file/write_file");
    expect(prompt).toContain("手动终止会话，也会通知？");
    expect(resolveOriginalTaskFromResumePrompt(prompt)).toBe("手动终止会话，也会通知？");
  });

  it("adds behavior-purpose resume guidance for enum follow-up questions", () => {
    const prompt = buildAgentResumePrompt(
      {
        tools: [
          {
            running: false,
            name: "read_file",
            summary: "读取 90 行",
            ok: true,
            turn: 2,
            args: { path: "src/foo/WorkOrderController.cs" },
          },
        ],
      },
      "> Agent: FlagPartial = 1\n\n啥作用",
      "HTTP 400",
      {
        history: [
          {
            role: "assistant",
            content: "FlagNone=0、FlagPartial=1、FlagFull=2",
          },
        ],
      },
    );
    expect(prompt).toContain("用途/作用类");
    expect(prompt).toContain("禁止重复枚举定义");
  });
});

describe("resolveResumeOriginalUserPrompt", () => {
  it("finds the nearest preceding user message", () => {
    const messages = [
      { id: "u1", role: "user", content: "实现功能 A" },
      { id: "a1", role: "assistant", content: "进行中" },
    ];
    expect(resolveResumeOriginalUserPrompt(messages, "a1")).toBe("实现功能 A");
  });

  it("falls back to last user message when assistant has no preceding user bubble", () => {
    const messages = [
      { id: "u1", role: "user", content: "原始任务" },
      { id: "a1", role: "assistant", content: "第一次" },
      { id: "a2", role: "assistant", content: "续跑占位" },
    ];
    expect(resolveResumeOriginalUserPrompt(messages, "a2")).toBe("原始任务");
  });

  it("uses image-only fallback text", () => {
    const messages = [
      { id: "u1", role: "user", content: "", imageDataUrls: ["data:image/png;base64,abc"] },
      { id: "a1", role: "assistant", content: "Failed to fetch" },
    ];
    expect(resolveResumeOriginalUserPrompt(messages, "a1")).toBe("请结合附带的图片回答。");
  });

  it("returns empty when no user task exists", () => {
    expect(resolveResumeOriginalUserPrompt([{ id: "a1", role: "assistant", content: "x" }], "a1")).toBe("");
  });
});

describe("canResumeAgentRun", () => {
  it("allows resume only for recoverable failures", () => {
    expect(canResumeAgentRun({ agentFailed: true, agentRecoverable: true })).toBe(true);
    expect(canResumeAgentRun({ agentFailed: true, agentRecoverable: false })).toBe(false);
    expect(canResumeAgentRun({ agentFailed: true, agentRecoverable: true, agentAborted: true })).toBe(true);
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

  it("allows resume after HMR interrupt even without tool progress", () => {
    expect(
      canResumeAgentRun({
        agentFailed: true,
        agentRecoverable: true,
        agentAborted: true,
        agentAbortReason: HMR_INTERRUPT_REASON,
      }),
    ).toBe(true);
  });

  it("allows resume after manual stop", () => {
    expect(
      canResumeAgentRun({
        agentFailed: true,
        agentRecoverable: true,
        agentAborted: true,
        agentAbortReason: "已手动停止",
        tools: [{ running: false, label: "读取文件", summary: "ok", turn: 1 }],
      }),
    ).toBe(true);
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

  it("preserves explicit API failure instead of masking as missing final answer", () => {
    const flags = inferAgentRecoveryFlags({
      role: "assistant",
      agentFailed: true,
      agentRecoverable: false,
      agentFailureReason: "模型 API 余额不足，请充值或更换 API Key 后再试",
      roundGroups: [{ turn: 2, maxTurns: 40, modelSteps: [], toolIds: [] }],
      tools: [{ name: "patch_file", running: false, ok: true, summary: "已修改", turn: 2 }],
    });
    expect(flags?.agentFailureReason).toBe("模型 API 余额不足，请充值或更换 API Key 后再试");
    expect(flags?.agentRecoverable).toBe(false);
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
    expect(flags?.agentFailureDetail).toContain("客户端未结案");
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

  it("uses structured abort summary when schema probe tools ran", () => {
    const text = resolveAgentFailureBubbleContent({
      content: "",
      tools: [
        {
          running: false,
          name: "run_command",
          ok: true,
          summary: JSON.stringify({ tableCount: 2, schema: [{ tableName: "a" }, { tableName: "b" }] }),
        },
        {
          running: false,
          name: "write_file",
          ok: true,
          args: { path: "schema_result.json" },
        },
      ],
      writtenFiles: ["schema_result.json"],
      turnTraces: [{ turn: 1 }],
    });
    expect(text).toContain("运行中断摘要");
    expect(text).toContain("实体");
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
      {
        turnTraces: [{ turn: 1 }],
        tools: [{ running: false, name: "grep", summary: "ok" }],
      },
      "运行中断（未生成最终回复）",
    );
    expect(hint).toContain("未生成最终回复");
    expect(hint).toContain("服务端持续探索未结案");
    expect(hint).toContain("恢复运行");
  });
});

describe("extractRateLimitHintFromStatusLog", () => {
  it("extracts the latest HTTP 429 line from statusLog", () => {
    const hint = extractRateLimitHintFromStatusLog([
      "正在等待模型响应（第 2/20 轮）…",
      "模型请求失败：请求失败，HTTP 429：Error from provider (Xiaomi): Too many requests，正在重试（第 2/20 轮），第 1/3 次重试…",
    ]);
    expect(hint).toContain("HTTP 429");
    expect(hint).toContain("Too many requests");
  });
});

describe("diagnoseMissingFinalAnswer", () => {
  it("detects client-side draft without isFinal", () => {
    const diagnosis = diagnoseMissingFinalAnswer({
      content: "A".repeat(80),
      tools: [{ running: false, name: "read_file", summary: "ok", turn: 1 }],
      roundGroups: [{ turn: 1, maxTurns: 24, modelSteps: [], toolIds: ["t1"] }],
    });
    expect(diagnosis.kind).toBe("client_answer_not_committed");
    expect(formatMissingFinalAnswerDetail(diagnosis)).toContain("客户端未结案");
  });

  it("detects server explore-only runs without finalize", () => {
    const diagnosis = diagnoseMissingFinalAnswer({
      content: "让我看看相关样式。",
      tools: [
        { running: false, name: "grep", summary: "ok", turn: 1 },
        { running: false, name: "read_file", summary: "ok", turn: 2 },
      ],
      roundGroups: [
        { turn: 1, maxTurns: 24, modelSteps: [], toolIds: ["t1"] },
        { turn: 2, maxTurns: 24, modelSteps: [], toolIds: ["t2"] },
      ],
      totalTurns: 5,
    });
    expect(diagnosis.kind).toBe("server_explore_no_finalize");
    expect(diagnosis.detail).toContain("grep");
  });

  it("detects segment cap from status log", () => {
    const diagnosis = diagnoseMissingFinalAnswer({
      tools: [{ running: false, name: "grep", summary: "ok", turn: 6 }],
      roundGroups: [{ turn: 6, maxTurns: 40, modelSteps: [], toolIds: ["t1"] }],
      statusLog: ["咨询只读已达段内轮次上限，须输出结论"],
    });
    expect(diagnosis.kind).toBe("server_segment_cap_no_answer");
    expect(diagnosis.detail).toContain("段内轮次上限");
  });

  it("classifies 10-turn run with 102-char draft as client uncommitted", () => {
    const diagnosis = diagnoseMissingFinalAnswer(
      {
        content: "这是一段约一百字的回复草稿，说明下拉背景是不透明实色而非半透明毛玻璃效果，并引用了样式变量。".padEnd(102, "。"),
        tools: Array.from({ length: 8 }, (_, index) => ({
          running: false,
          name: index % 2 === 0 ? "grep" : "read_file",
          summary: "ok",
          turn: index + 1,
        })),
        roundGroups: Array.from({ length: 10 }, (_, index) => ({
          turn: index + 1,
          maxTurns: 40,
          modelSteps: [],
          toolIds: [`t${index}`],
        })),
        totalTurns: 10,
      },
      { doneTurns: 10 },
    );
    expect(diagnosis.kind).toBe("client_answer_not_committed");
    expect(diagnosis.detail).toContain("isFinal");
  });

  it("does not treat failure bubble text as a substantive draft", () => {
    const diagnosis = diagnoseMissingFinalAnswer({
      content: "运行中断（已完成 10 轮，8 个工具步骤），可点击「恢复运行」继续。",
      tools: [{ running: false, name: "grep", summary: "ok", turn: 1 }],
      roundGroups: [{ turn: 1, maxTurns: 40, modelSteps: [], toolIds: ["t1"] }],
      totalTurns: 10,
    });
    expect(diagnosis.kind).not.toBe("client_answer_not_committed");
  });

  it("enriches plan explore-only diagnosis", () => {
    const diagnosis = diagnoseMissingFinalAnswer(
      {
        chatMode: "plan",
        tools: [
          { running: false, name: "list_dir", summary: "ok", turn: 2 },
          { running: false, name: "list_dir", summary: "ok", turn: 3 },
        ],
        roundGroups: [
          { turn: 1, maxTurns: 16, modelSteps: [], toolIds: ["t1"] },
          { turn: 2, maxTurns: 16, modelSteps: [], toolIds: ["t2"] },
          { turn: 3, maxTurns: 16, modelSteps: [], toolIds: ["t3"] },
        ],
        totalTurns: 3,
      },
      { doneTurns: 3, chatMode: "plan" },
    );
    expect(diagnosis.kind).toBe("server_explore_no_finalize");
    expect(diagnosis.detail).toContain("[PLAN]");
    expect(diagnosis.detail).toContain("恢复运行");
  });

  it("surfaces prior model failure with plan explore context", () => {
    const diagnosis = diagnoseMissingFinalAnswer({
      chatMode: "plan",
      agentFailureReason: "模型请求失败",
      tools: [{ running: false, name: "list_dir", summary: "ok", turn: 1 }],
      roundGroups: [{ turn: 1, maxTurns: 16, modelSteps: [], toolIds: ["t1"] }],
    });
    expect(diagnosis.kind).toBe("server_blocked_or_empty");
    expect(diagnosis.detail).toContain("模型请求失败");
    expect(diagnosis.detail).toContain("list_dir");
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
    expect(shouldSilentAutoContinue("运行中断（未生成最终回复）")).toBe(false);
    expect(isAgentRuntimeReferenceError("runtimeProfile is not defined")).toBe(true);
    expect(shouldSilentAutoContinue("runtimeProfile is not defined")).toBe(false);
    expect(formatAgentTransportErrorMessage("请求失败，HTTP 401：Insufficient balance")).toBe(
      "模型 API 余额不足，请充值或更换 API Key 后再试",
    );
    expect(isAgentBillingOrAuthError("CreditsError insufficient balance")).toBe(true);
    expect(shouldSilentAutoContinue("请求失败，HTTP 401：Insufficient balance")).toBe(false);
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
    expect(agentConnectStallMessage(true, "web")).toContain("Tauri");
    expect(agentConnectStallMessage(false, "web")).toContain("npm run dev");
    expect(agentConnectStallMessage(true, "tauri")).not.toContain("sidecar");
    expect(agentConnectStallMessage(false, "tauri")).toContain("重启应用");
  });
});

describe("resolveModelWaitStallMs", () => {
  it("uses continue threshold after silent continue", () => {
    expect(resolveModelWaitStallMs(92_000, 1)).toBe(AGENT_CONTINUE_MODEL_WAIT_STALL_MS);
  });

  it("aligns with large-context first-byte timeout plus buffer", () => {
    expect(resolveModelWaitStallMs(92_000, 0)).toBe(AGENT_MODEL_WAIT_STALL_MS);
    expect(resolveModelWaitStallMs(0, 0)).toBe(75_000);
    expect(resolveModelWaitStallMs(500_000, 0)).toBe(AGENT_MODEL_WAIT_STALL_MS);
  });
});
