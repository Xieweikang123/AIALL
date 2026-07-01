import type { AutoBugFixPhase } from "../composables/useAutoBugFix";
import type { ProjectHealthScanResult } from "../services/projectHealthScanClient";
import type { ProjectVerifyRunResult } from "../services/projectVerifyRunClient";
import type { VerifyRegressionKind } from "../../shared/projectVerifyRun";
import { lsGetJson, lsRemove, lsSetJson } from "./localStorageSafe";

/** Persist auto bug fix UI across page refresh (per project). */
export const AUTO_BUG_FIX_STATE_STALE_MS = 24 * 60 * 60 * 1000;

export type PersistedAutoBugFixVerify = Pick<
  ProjectVerifyRunResult,
  | "ok"
  | "projectPath"
  | "command"
  | "exitCode"
  | "durationMs"
  | "failingFiles"
  | "ranAt"
  | "skipped"
  | "skipReason"
>;

export type PersistedAutoBugFixState = {
  phase: AutoBugFixPhase;
  scanResult?: ProjectHealthScanResult | null;
  /** Latest verify snapshot shown in the panel (baseline before fix, post-fix after rerun). */
  verifyResult?: PersistedAutoBugFixVerify | null;
  baselineVerify?: PersistedAutoBugFixVerify | null;
  postFixVerify?: PersistedAutoBugFixVerify | null;
  verifyComparison?: { kind: VerifyRegressionKind; detail: string } | null;
  includeWarnings?: boolean;
  includeLogicReview?: boolean;
  lastSummary?: string;
  error?: string;
  assistantMsgId?: string;
  sessionId?: string;
  savedAt: number;
};

function normalizeProjectPath(projectPath: string): string {
  return projectPath.trim().replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
}

export function autoBugFixStorageKey(projectPath: string): string {
  const normalized = normalizeProjectPath(projectPath);
  return `vibe-coding-auto-bug-fix-${normalized || "__global"}`;
}

function slimVerifyResult(result: ProjectVerifyRunResult | null): PersistedAutoBugFixVerify | null {
  if (!result?.ranAt) return null;
  return {
    ok: result.ok,
    projectPath: result.projectPath,
    command: result.command,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    failingFiles: result.failingFiles ?? [],
    ranAt: result.ranAt,
    skipped: result.skipped,
    skipReason: result.skipReason,
  };
}

export function readAutoBugFixState(projectPath: string): PersistedAutoBugFixState | null {
  const key = autoBugFixStorageKey(projectPath);
  const raw = lsGetJson<PersistedAutoBugFixState>(key);
  if (!raw || typeof raw !== "object") return null;
  if (!raw.phase || raw.phase === "idle") return null;
  if (!raw.savedAt || Date.now() - raw.savedAt > AUTO_BUG_FIX_STATE_STALE_MS) {
    lsRemove(key);
    return null;
  }
  return raw;
}

export function writeAutoBugFixState(
  projectPath: string,
  state: Omit<PersistedAutoBugFixState, "savedAt">,
): void {
  if (!normalizeProjectPath(projectPath)) return;
  if (state.phase === "idle") {
    removeAutoBugFixState(projectPath);
    return;
  }
  lsSetJson(autoBugFixStorageKey(projectPath), {
    ...state,
    verifyResult: state.verifyResult ?? null,
    baselineVerify: state.baselineVerify ?? null,
    postFixVerify: state.postFixVerify ?? null,
    verifyComparison: state.verifyComparison ?? null,
    savedAt: Date.now(),
  });
}

export function removeAutoBugFixState(projectPath: string): void {
  if (!normalizeProjectPath(projectPath)) return;
  lsRemove(autoBugFixStorageKey(projectPath));
}

export function buildPersistedAutoBugFixState(input: {
  phase: AutoBugFixPhase;
  scanResult: ProjectHealthScanResult | null;
  verifyResult: ProjectVerifyRunResult | null;
  baselineVerify?: ProjectVerifyRunResult | null;
  postFixVerify?: ProjectVerifyRunResult | null;
  verifyComparison?: { kind: VerifyRegressionKind; detail: string } | null;
  includeWarnings: boolean;
  includeLogicReview: boolean;
  lastSummary: string;
  error: string;
  assistantMsgId?: string;
  sessionId?: string;
}): Omit<PersistedAutoBugFixState, "savedAt"> {
  return {
    phase: input.phase,
    scanResult: input.scanResult,
    verifyResult: slimVerifyResult(input.verifyResult),
    baselineVerify: slimVerifyResult(input.baselineVerify ?? null),
    postFixVerify: slimVerifyResult(input.postFixVerify ?? null),
    verifyComparison: input.verifyComparison ?? null,
    includeWarnings: input.includeWarnings,
    includeLogicReview: input.includeLogicReview,
    lastSummary: input.lastSummary,
    error: input.error,
    assistantMsgId: input.assistantMsgId,
    sessionId: input.sessionId,
  };
}
