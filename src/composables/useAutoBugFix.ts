import { ref, computed, watch } from "vue";
import { fetchProjectHealthScan, type ProjectHealthScanResult } from "../services/projectHealthScanClient";
import { fetchProjectVerifyRun, type ProjectVerifyRunResult } from "../services/projectVerifyRunClient";
import {
  buildAutoBugFixPrompt,
  buildAutoBugFixUserIntent,
  collectAutoBugFixTargetFiles,
  countAutoBugFixWorkItems,
  needsAutoBugFix,
  type AutoBugFixScope,
} from "../../shared/autoBugFixPrompt";
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

export type AutoBugFixPhase = "idle" | "scanning" | "testing" | "fixing" | "done" | "no_work" | "error";

export type AutoBugFixRunOptions = {
  scope?: AutoBugFixScope;
  includeWarnings?: boolean;
};

export type StartAutoBugFixAgentResult = {
  ok: boolean;
  assistantMsgId?: string;
};

export type StartAutoBugFixAgentParams = {
  prompt: string;
  runProfile: AgentRunProfile;
  userBubbleContent: string;
};

const AUTO_BUG_FIX_USER_BUBBLE_PREFIX = "一键修复";

function isAutoBugFixUserBubble(content: string): boolean {
  return content.trim().startsWith(AUTO_BUG_FIX_USER_BUBBLE_PREFIX);
}

export function useAutoBugFix(
  projectPath: { value: string },
  projectOpened: { value: boolean },
  activeSessionId: { value: string },
  deps: {
    startAgent: (params: StartAutoBugFixAgentParams) => Promise<StartAutoBugFixAgentResult>;
    expandChat: () => void;
    switchGitPanel?: () => void;
  },
) {
  const phase = ref<AutoBugFixPhase>("idle");
  const error = ref("");
  const scanResult = ref<ProjectHealthScanResult | null>(null);
  const verifyResult = ref<ProjectVerifyRunResult | null>(null);
  const baselineVerify = ref<ProjectVerifyRunResult | null>(null);
  const scope = ref<AutoBugFixScope>("tests_and_errors");
  const includeWarnings = ref(false);
  const lastSummary = ref("");
  const assistantMsgId = ref("");
  const interruptedHint = ref("");
  const running = computed(() => phase.value === "scanning" || phase.value === "testing" || phase.value === "fixing");

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
        includeWarnings: includeWarnings.value,
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
    lastSummary.value = "";
    assistantMsgId.value = "";
    clearInterruptedHint();
    removeAutoBugFixState(projectPath.value.trim());
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

  function applyInterruptedAssistantState(msg: ChatMessage | null) {
    if (!msg) {
      clearInterruptedHint();
      return;
    }
    assistantMsgId.value = msg.id;
    if (hasAgentFinalAnswer(msg)) {
      phase.value = "done";
      lastSummary.value = "修复任务已完成，可在 Git 面板查看变更。";
      clearInterruptedHint();
      return;
    }
    if (canResumeAgentRun(msg)) {
      phase.value = "fixing";
      const reason = msg.agentFailureReason || msg.agentAbortReason || "";
      interruptedHint.value = isHmrInterruptReason(reason)
        ? "修复因页面刷新中断，可点击下方「恢复运行」从断点继续。"
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
    phase.value = "fixing";
    interruptedHint.value = "修复任务进行中，请在聊天面板查看 Agent 进度。";
    lastSummary.value = interruptedHint.value;
  }

  /** Restore fix panel state after refresh; returns whether fix tab should open. */
  function tryRestoreFromStorage(messages: ChatMessage[]): boolean {
    const path = projectPath.value.trim();
    if (!path || !projectOpened.value) return false;

    const stored = readAutoBugFixState(path);
    const sessionMatches = !stored?.sessionId || stored.sessionId === activeSessionId.value.trim();

    if (stored && sessionMatches) {
      scanResult.value = stored.scanResult ?? null;
      verifyResult.value = restoreVerifyResult(stored.verifyResult);
      baselineVerify.value = verifyResult.value;
      includeWarnings.value = Boolean(stored.includeWarnings);
      lastSummary.value = stored.lastSummary || "";
      error.value = stored.error || "";

      if (stored.phase === "scanning" || stored.phase === "testing") {
        phase.value = "error";
        error.value = "页面刷新中断了扫描或测试，请重新点击「开始自动修复」。";
        lastSummary.value = "";
        clearInterruptedHint();
        persistNow();
        return true;
      }

      phase.value = stored.phase;
      applyInterruptedAssistantState(
        resolveInterruptedAssistant(messages, stored.assistantMsgId),
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
    [phase, scanResult, verifyResult, lastSummary, error, includeWarnings, assistantMsgId, projectPath, activeSessionId],
    () => {
      persistNow();
    },
    { deep: true },
  );

  async function runScanOnly() {
    const path = projectPath.value.trim();
    if (!path || !projectOpened.value) return;
    clearInterruptedHint();
    phase.value = "scanning";
    error.value = "";
    try {
      const result = await fetchProjectHealthScan(path);
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
    clearInterruptedHint();
    phase.value = "testing";
    error.value = "";
    try {
      const result = await fetchProjectVerifyRun(path);
      if (!result.ok) {
        error.value = result.error || "测试运行失败";
        phase.value = "error";
        return;
      }
      verifyResult.value = result;
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

    error.value = "";
    lastSummary.value = "";
    clearInterruptedHint();
    assistantMsgId.value = "";

    phase.value = "scanning";
    const scan = await fetchProjectHealthScan(path);
    if (!scan.ok) {
      error.value = scan.error || "扫描失败";
      phase.value = "error";
      return;
    }
    scanResult.value = scan;

    phase.value = "testing";
    const verify = await fetchProjectVerifyRun(path);
    if (!verify.ok) {
      error.value = verify.error || "测试运行失败";
      phase.value = "error";
      return;
    }
    verifyResult.value = verify;
    baselineVerify.value = verify;

    if (!needsAutoBugFix(scan, verify, effectiveScope)) {
      phase.value = "no_work";
      lastSummary.value = "未发现需自动修复的测试失败或 error 级扫描项。";
      return;
    }

    const targetFiles = collectAutoBugFixTargetFiles(scan, verify, effectiveScope);
    const counts = countAutoBugFixWorkItems(scan, verify, effectiveScope);
    const prompt = buildAutoBugFixPrompt({
      scan,
      verifyRun: verify,
      scope: effectiveScope,
      verifyScript: verify.command || undefined,
    });
    const userIntent = buildAutoBugFixUserIntent(effectiveScope);
    const bubble = `一键修复：${counts.testFailures ? `${counts.testFailures} 项测试问题` : ""}${counts.testFailures && counts.scanItems ? " · " : ""}${counts.scanItems ? `${counts.scanItems} 项扫描 error` : ""}`.trim();

    phase.value = "fixing";
    deps.expandChat();

    const started = await deps.startAgent({
      prompt,
      userBubbleContent: bubble || "一键自动修复",
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
    if (msg?.id && assistantMsgId.value && msg.id !== assistantMsgId.value) return;
    if (phase.value === "fixing" || assistantMsgId.value) {
      applyInterruptedAssistantState(msg ?? null);
      persistNow();
    }
  }

  function onAgentInterrupted(reason?: string) {
    if (phase.value !== "fixing" && !assistantMsgId.value) return;
    if (isHmrInterruptReason(reason || HMR_INTERRUPT_REASON)) {
      interruptedHint.value = "修复因页面刷新中断，可点击下方「恢复运行」从断点继续。";
      lastSummary.value = interruptedHint.value;
      phase.value = "fixing";
      persistNow();
    }
  }

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
    scope,
    includeWarnings,
    lastSummary,
    assistantMsgId,
    interruptedHint,
    reset,
    persistNow,
    tryRestoreFromStorage,
    runScanOnly,
    runVerifyOnly,
    startAutoBugFix,
    onAgentSettled,
    onAgentInterrupted,
    openGitDiff,
  };
}
