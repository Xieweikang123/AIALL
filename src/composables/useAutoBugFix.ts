import { ref, computed } from "vue";
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

export type AutoBugFixPhase = "idle" | "scanning" | "testing" | "fixing" | "done" | "no_work" | "error";

export type AutoBugFixRunOptions = {
  scope?: AutoBugFixScope;
  includeWarnings?: boolean;
};

export type StartAutoBugFixAgentParams = {
  prompt: string;
  runProfile: AgentRunProfile;
  userBubbleContent: string;
};

export function useAutoBugFix(
  projectPath: { value: string },
  projectOpened: { value: boolean },
  deps: {
    startAgent: (params: StartAutoBugFixAgentParams) => Promise<boolean>;
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
  const running = computed(() => phase.value === "scanning" || phase.value === "testing" || phase.value === "fixing");

  function reset() {
    phase.value = "idle";
    error.value = "";
    scanResult.value = null;
    verifyResult.value = null;
    baselineVerify.value = null;
    lastSummary.value = "";
  }

  async function runScanOnly() {
    const path = projectPath.value.trim();
    if (!path || !projectOpened.value) return;
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

    if (!started) {
      error.value = "无法启动 Agent 修复";
      phase.value = "error";
      return;
    }

    lastSummary.value = `已启动修复（最多 ${AUTO_BUG_FIX_MAX_TURNS} 轮）`;
    phase.value = "done";
  }

  function onAgentSettled() {
    if (phase.value === "fixing") {
      phase.value = "done";
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
    reset,
    runScanOnly,
    runVerifyOnly,
    startAutoBugFix,
    onAgentSettled,
    openGitDiff,
  };
}
