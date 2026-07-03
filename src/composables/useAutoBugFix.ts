import { ref, computed, watch } from "vue";
import { fetchProjectHealthScan, type ProjectHealthScanResult } from "../services/projectHealthScanClient";
import { fetchProjectVerifyRun, type ProjectVerifyRunResult } from "../services/projectVerifyRunClient";
import {
  buildAutoBugFixPrompt,
  buildAutoBugFixNoWorkSummary,
  buildAutoBugFixUserIntent,
  collectAutoBugFixTargetFiles,
  countAutoBugFixWorkItems,
  needsAutoBugFix,
  type AutoBugFixScope,
} from "../../shared/autoBugFixPrompt";
import {
  compareVerifyRuns,
  formatVerifyComparisonSummary,
  isVerifyRunRequestFailed,
  type VerifyRegressionKind,
} from "../../shared/projectVerifyRun";
import type { AgentRunProfile } from "../services/agentRunProfile";
import { AUTO_BUG_FIX_MAX_TURNS } from "../services/agentRunProfile";
import { canResumeAgentRun, HMR_INTERRUPT_REASON, isHmrInterruptReason } from "../services/agentRecovery";
import { hasAgentFinalAnswer } from "../services/agentMessageDisplay";
import {
  buildPersistedAutoBugFixState,
  readAutoBugFixState,
  removeAutoBugFixState,
  writeAutoBugFixState,
} from "../utils/autoBugFixStorage";
import type { ChatMessage } from "../types/vibeChat";

export type AutoBugFixPhase = "idle" | "scanning" | "testing" | "fixing" | "verifying" | "done" | "no_work" | "error";

export type AutoBugFixRunOptions = {
  scope?: AutoBugFixScope;
  includeWarnings?: boolean;
  includeLogicReview?: boolean;
};

export type StartAutoBugFixAgentResult = {
  ok: boolean;
  assistantMsgId?: string;
};

export type StartAutoBugFixAgentParams = {
  prompt: string;
  runProfile: AgentRunProfile;
  userBubbleContent: string;
  sessionId: string;
};

const AUTO_BUG_FIX_USER_BUBBLE_PREFIX = "扫描修复";
const LEGACY_AUTO_BUG_FIX_USER_BUBBLE_PREFIX = "一键修复";

function isAutoBugFixUserBubble(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith(AUTO_BUG_FIX_USER_BUBBLE_PREFIX)
    || trimmed.startsWith(LEGACY_AUTO_BUG_FIX_USER_BUBBLE_PREFIX);
}

export function useAutoBugFix(
  projectPath: { value: string },
  projectOpened: { value: boolean },
  activeSessionId: { value: string },
  deps: {
    startAgent: (params: StartAutoBugFixAgentParams) => Promise<StartAutoBugFixAgentResult>;
    startNewSession: () => void;
    switchSession?: (sessionId: string) => void;
    getSessionMessages?: (sessionId: string) => ChatMessage[] | undefined;
    expandChat: () => void;
    switchGitPanel?: () => void;
    stopFixAgent?: (sessionId: string) => void;
  },
) {
  const phase = ref<AutoBugFixPhase>("idle");
  const error = ref("");
  const scanResult = ref<ProjectHealthScanResult | null>(null);
  const verifyResult = ref<ProjectVerifyRunResult | null>(null);
  const baselineVerify = ref<ProjectVerifyRunResult | null>(null);
  const postFixVerify = ref<ProjectVerifyRunResult | null>(null);
  const verifyComparison = ref<{ kind: VerifyRegressionKind; detail: string } | null>(null);
  const scope = ref<AutoBugFixScope>("tests_and_errors");
  const includeWarnings = ref(false);
  const includeLogicReview = ref(false);
  const lastSummary = ref("");
  const assistantMsgId = ref("");
  const fixSessionId = ref("");
  const interruptedHint = ref("");
  const fixRunCancelled = ref(false);
  const abortGeneration = ref(0);
  const running = computed(() => phase.value === "scanning" || phase.value === "testing" || phase.value === "fixing" || phase.value === "verifying");

  function clearInterruptedHint() {
    interruptedHint.value = "";
  }

  function persistNow() {
    const path = projectPath.value.trim();
    if (!path || phase.value === "idle") return;
    writeAutoBugFixState(
      path,
      buildPersistedAutoBugFixState({
        phase: phase.value,
        scanResult: scanResult.value,
        verifyResult: verifyResult.value,
        baselineVerify: baselineVerify.value,
        postFixVerify: postFixVerify.value,
        verifyComparison: verifyComparison.value,
        includeWarnings: includeWarnings.value,
        includeLogicReview: includeLogicReview.value,
        lastSummary: lastSummary.value,
        error: error.value,
        assistantMsgId: assistantMsgId.value || undefined,
        sessionId: activeSessionId.value.trim() || undefined,
      }),
    );
  }

  function reset() {
    phase.value = "idle";
    error.value = "";
    scanResult.value = null;
    verifyResult.value = null;
    baselineVerify.value = null;
    postFixVerify.value = null;
    verifyComparison.value = null;
    lastSummary.value = "";
    assistantMsgId.value = "";
    fixSessionId.value = "";
    clearInterruptedHint();
    fixRunCancelled.value = false;
    removeAutoBugFixState(projectPath.value.trim());
  }

  function cancelAutoBugFix() {
    const path = projectPath.value.trim();
    if (!path || !projectOpened.value) return;
    const wasActive = phase.value !== "idle" && phase.value !== "no_work" && phase.value !== "done";
    if (!wasActive && !assistantMsgId.value) return;

    fixRunCancelled.value = true;
    abortGeneration.value += 1;
    const sessionId = fixSessionId.value.trim() || activeSessionId.value.trim();
    if (sessionId) deps.stopFixAgent?.(sessionId);

    clearInterruptedHint();
    assistantMsgId.value = "";
    fixSessionId.value = "";
    phase.value = "idle";
    error.value = "";
    if (wasActive) {
      lastSummary.value = "已终止本轮修复。扫描与测试结果仍保留，可重新点击「开始扫描修复」。";
    }
    removeAutoBugFixState(path);
  }

  function restoreVerifyResult(
    stored: NonNullable<ReturnType<typeof readAutoBugFixState>>["verifyResult"],
  ): ProjectVerifyRunResult | null {
    if (!stored?.ranAt) return null;
    return {
      ...stored,
      stdout: "",
      stderr: "",
    };
  }

  function resolveInterruptedAssistant(
    messages: ChatMessage[],
    preferredId?: string,
  ): ChatMessage | null {
    if (preferredId) {
      const direct = messages.find((m) => m.id === preferredId);
      if (direct?.role === "assistant") return direct;
    }
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (msg?.role !== "assistant") continue;
      const userIdx = i - 1;
      const user = userIdx >= 0 ? messages[userIdx] : undefined;
      if (user?.role === "user" && isAutoBugFixUserBubble(user.content || "")) {
        return msg;
      }
    }
    return null;
  }

  async function rerunVerifyAfterFix() {
    const path = projectPath.value.trim();
    if (!path || !projectOpened.value || !baselineVerify.value) return;
    const after = await fetchProjectVerifyRun(path);
    if (isVerifyRunRequestFailed(after)) return;
    postFixVerify.value = after;
    verifyResult.value = after;
    const comparison = compareVerifyRuns(baselineVerify.value, after);
    verifyComparison.value = comparison;
    lastSummary.value = formatVerifyComparisonSummary(comparison, baselineVerify.value, after);
    persistNow();
  }

  function applyInterruptedAssistantState(msg: ChatMessage | null) {
    if (!msg) {
      clearInterruptedHint();
      if (phase.value === "verifying") {
        if (baselineVerify.value) {
          lastSummary.value = "修复任务已完成，正在复验…";
          void rerunVerifyAfterFix().then(() => {
            phase.value = "done";
            if (!verifyComparison.value) {
              lastSummary.value = "修复任务已完成，可在 Git 面板查看变更。";
              persistNow();
            }
          });
        } else {
          phase.value = "done";
          if (!lastSummary.value) {
            lastSummary.value = "修复任务已完成，可在 Git 面板查看变更。";
          }
          persistNow();
        }
      }
      return;
    }
    assistantMsgId.value = msg.id;
    if (hasAgentFinalAnswer(msg)) {
      phase.value = "verifying";
      lastSummary.value = "修复任务已完成，正在复验…";
      clearInterruptedHint();
      void rerunVerifyAfterFix().then(() => {
        phase.value = "done";
        if (!verifyComparison.value) {
          lastSummary.value = "修复任务已完成，可在 Git 面板查看变更。";
          persistNow();
        }
      });
      return;
    }
    if (canResumeAgentRun(msg)) {
      phase.value = "fixing";
      const reason = msg.agentFailureReason || msg.agentAbortReason || "";
      interruptedHint.value = isHmrInterruptReason(reason)
        ? "修复因页面刷新中断，可点击下方「恢复运行」从断点继续。"
        : reason.includes("未生成最终回复")
          ? "修复未生成完整总结，可点击下方「恢复运行」继续，或「终止修复」。"
          : "修复尚未完成，可点击下方「恢复运行」继续。";
      lastSummary.value = interruptedHint.value;
      return;
    }
    if (msg.agentAborted || msg.agentFailed) {
      phase.value = "error";
      error.value = msg.agentFailureReason || msg.agentAbortReason || "修复运行已中断";
      interruptedHint.value = "";
      return;
    }
    phase.value = "error";
    error.value = "Agent 未输出修复总结即结束";
    lastSummary.value = "请在聊天中点击「恢复运行」，或重新「开始扫描修复」。";
    interruptedHint.value = "";
  }

  /** Restore fix panel state after refresh; returns whether fix tab should open. */
  function tryRestoreFromStorage(messages: ChatMessage[]): boolean {
    const path = projectPath.value.trim();
    if (!path || !projectOpened.value) return false;

    const stored = readAutoBugFixState(path);

    if (stored) {
      const storedSessionId = stored.sessionId?.trim() ?? "";
      const restoreMessages = storedSessionId && deps.getSessionMessages
        ? (deps.getSessionMessages(storedSessionId) ?? messages)
        : messages;

      scanResult.value = stored.scanResult ?? null;
      baselineVerify.value = restoreVerifyResult(
        stored.baselineVerify ?? (stored.phase === "done" ? null : stored.verifyResult),
      );
      postFixVerify.value = restoreVerifyResult(stored.postFixVerify ?? null);
      verifyComparison.value = stored.verifyComparison ?? null;
      verifyResult.value = restoreVerifyResult(
        stored.postFixVerify ?? stored.verifyResult,
      ) ?? baselineVerify.value;
      includeWarnings.value = Boolean(stored.includeWarnings);
      includeLogicReview.value = Boolean(stored.includeLogicReview);
      lastSummary.value = stored.lastSummary || "";
      error.value = stored.error || "";

      if (stored.phase === "scanning" || stored.phase === "testing") {
        phase.value = "error";
        error.value = "页面刷新中断了扫描或测试，请重新点击「开始扫描修复」。";
        lastSummary.value = "";
        clearInterruptedHint();
        persistNow();
        return true;
      }

      phase.value = stored.phase;

      if (stored.phase === "done" || stored.phase === "no_work") {
        if (stored.assistantMsgId) assistantMsgId.value = stored.assistantMsgId;
        if (stored.sessionId?.trim()) fixSessionId.value = stored.sessionId.trim();
        persistNow();
        return true;
      }

      applyInterruptedAssistantState(
        resolveInterruptedAssistant(restoreMessages, stored.assistantMsgId),
      );
      persistNow();
      return true;
    }

    const inferred = resolveInterruptedAssistant(messages);
    if (!inferred) return false;

    applyInterruptedAssistantState(inferred);
    persistNow();
    return true;
  }

  watch(
    [
      phase,
      scanResult,
      verifyResult,
      baselineVerify,
      postFixVerify,
      verifyComparison,
      lastSummary,
      error,
      includeWarnings,
      includeLogicReview,
      assistantMsgId,
      projectPath,
      activeSessionId,
    ],
    () => {
      persistNow();
    },
    { deep: true },
  );

  async function runScanOnly() {
    const path = projectPath.value.trim();
    if (!path || !projectOpened.value) return;
    const gen = ++abortGeneration.value;
    fixRunCancelled.value = false;
    clearInterruptedHint();
    phase.value = "scanning";
    error.value = "";
    try {
      const result = await fetchProjectHealthScan(path);
      if (gen !== abortGeneration.value) return;
      if (!result.ok) {
        error.value = result.error || "扫描失败";
        phase.value = "error";
        scanResult.value = null;
        return;
      }
      scanResult.value = result;
      phase.value = "idle";
    } catch (e) {
      error.value = e instanceof Error ? e.message : "扫描失败";
      phase.value = "error";
    }
  }

  async function runVerifyOnly() {
    const path = projectPath.value.trim();
    if (!path || !projectOpened.value) return;
    const gen = ++abortGeneration.value;
    fixRunCancelled.value = false;
    clearInterruptedHint();
    phase.value = "testing";
    error.value = "";
    try {
      const result = await fetchProjectVerifyRun(path);
      if (gen !== abortGeneration.value) return;
      if (isVerifyRunRequestFailed(result)) {
        error.value = result.error || "测试运行失败";
        phase.value = "error";
        return;
      }
      verifyResult.value = result;
      baselineVerify.value = null;
      postFixVerify.value = null;
      verifyComparison.value = null;
      phase.value = "idle";
    } catch (e) {
      error.value = e instanceof Error ? e.message : "测试运行失败";
      phase.value = "error";
    }
  }

  async function startAutoBugFix(options?: AutoBugFixRunOptions) {
    const path = projectPath.value.trim();
    if (!path || !projectOpened.value || running.value) return;

    const effectiveScope: AutoBugFixScope = options?.scope
      ?? (options?.includeWarnings || includeWarnings.value ? "include_warnings" : scope.value);
    const effectiveLogicReview = options?.includeLogicReview ?? includeLogicReview.value;

    fixRunCancelled.value = false;
    error.value = "";
    lastSummary.value = "";
    clearInterruptedHint();
    assistantMsgId.value = "";
    fixSessionId.value = "";

    const gen = ++abortGeneration.value;
    phase.value = "scanning";
    const scan = await fetchProjectHealthScan(path);
    if (gen !== abortGeneration.value) return;
    if (!scan.ok) {
      error.value = scan.error || "扫描失败";
      phase.value = "error";
      return;
    }
    scanResult.value = scan;

    phase.value = "testing";
    const verify = await fetchProjectVerifyRun(path);
    if (gen !== abortGeneration.value) return;
    if (isVerifyRunRequestFailed(verify)) {
      error.value = verify.error || "测试运行失败";
      phase.value = "error";
      return;
    }
    verifyResult.value = verify;
    baselineVerify.value = verify;
    postFixVerify.value = null;
    verifyComparison.value = null;

    if (!needsAutoBugFix(scan, verify, effectiveScope, effectiveLogicReview)) {
      phase.value = "no_work";
      lastSummary.value = buildAutoBugFixNoWorkSummary(scan, verify, effectiveScope);
      return;
    }

    const targetFiles = collectAutoBugFixTargetFiles(scan, verify, effectiveScope);
    const counts = countAutoBugFixWorkItems(scan, verify, effectiveScope);
    const prompt = buildAutoBugFixPrompt({
      scan,
      verifyRun: verify,
      scope: effectiveScope,
      includeLogicReview: effectiveLogicReview,
      verifyCommands: verify.verifyCommands,
    });
    const userIntent = buildAutoBugFixUserIntent(effectiveScope, effectiveLogicReview);
    const bubbleParts: string[] = [];
    if (counts.testFailures) bubbleParts.push(`${counts.testFailures} 项测试问题`);
    if (counts.scanItems) bubbleParts.push(`${counts.scanItems} 项扫描 error`);
    if (effectiveLogicReview) bubbleParts.push("含逻辑审查");
    const bubble = bubbleParts.length ? `扫描修复：${bubbleParts.join(" · ")}` : "";

    deps.startNewSession();
    const sessionId = activeSessionId.value.trim();
    fixSessionId.value = sessionId;
    if (!sessionId) {
      error.value = "无法创建修复会话";
      phase.value = "error";
      return;
    }

    phase.value = "fixing";
    deps.expandChat();

    const started = await deps.startAgent({
      prompt,
      userBubbleContent: bubble || "扫描与测试修复",
      sessionId: fixSessionId.value,
      runProfile: {
        kind: "execute_plan",
        triggerSource: "auto_bug_fix",
        targetFiles,
        userIntent,
      },
    });

    if (!started.ok) {
      error.value = "无法启动 Agent 修复";
      phase.value = "error";
      return;
    }

    assistantMsgId.value = started.assistantMsgId || "";
    lastSummary.value = `Agent 修复进行中（最多 ${AUTO_BUG_FIX_MAX_TURNS} 轮），可在聊天面板查看进度。`;
    persistNow();
  }

  function onAgentSettled(msg?: ChatMessage) {
    if (fixRunCancelled.value) return;
    if (msg?.id && assistantMsgId.value && msg.id !== assistantMsgId.value) return;
    if ((phase.value === "fixing" || phase.value === "verifying" || assistantMsgId.value) && phase.value !== "done") {
      applyInterruptedAssistantState(msg ?? null);
      persistNow();
    }
  }

  function onAgentInterrupted(reason?: string) {
    if (fixRunCancelled.value) return;
    if (phase.value !== "fixing" && !assistantMsgId.value) return;
    if (isHmrInterruptReason(reason || HMR_INTERRUPT_REASON)) {
      interruptedHint.value = "修复因页面刷新中断，可点击下方「恢复运行」从断点继续。";
      lastSummary.value = interruptedHint.value;
      phase.value = "fixing";
      persistNow();
    }
  }

  const canStopFix = computed(() => phase.value === "fixing");

  function openGitDiff() {
    deps.switchGitPanel?.();
  }

  return {
    phase,
    error,
    running,
    scanResult,
    verifyResult,
    baselineVerify,
    postFixVerify,
    verifyComparison,
    scope,
    includeWarnings,
    includeLogicReview,
    lastSummary,
    assistantMsgId,
    interruptedHint,
    canStopFix,
    reset,
    persistNow,
    tryRestoreFromStorage,
    runScanOnly,
    runVerifyOnly,
    startAutoBugFix,
    cancelAutoBugFix,
    onAgentSettled,
    onAgentInterrupted,
    openGitDiff,
  };
}
