import { watch, type WatchStopHandle } from "vue";
import { debugLog } from "./debugLog";

const DEBUG_KEY = "aiall.debugAgentJump";

/** On by default; opt out with localStorage.setItem('aiall.debugAgentJump', '0'). */
export function isAgentJumpDebugEnabled(): boolean {
  try {
    const flag = localStorage.getItem(DEBUG_KEY);
    if (flag === "0") return false;
    return true;
  } catch {
    return true;
  }
}

export function logAgentJump(scope: string, detail: Record<string, unknown>): void {
  if (!isAgentJumpDebugEnabled()) return;
  debugLog("[agent-jump]", scope, detail);
}

type JumpSnapshot = {
  finalLen: number;
  stableLen: number;
  running: boolean;
  streaming: boolean;
  showExploration: boolean;
  showAnswerBlock: boolean;
};

/** Log when answer UI metrics shrink or visibility toggles (default on). */
export function watchAgentAnswerJumps(
  scope: string,
  getters: {
    finalAnswer: () => string;
    stableAnswer: () => string;
    isRunning: () => boolean;
    answerStreaming: () => boolean;
    showExploration: () => boolean;
    showAnswerBlock: () => boolean;
  },
): WatchStopHandle {
  if (!isAgentJumpDebugEnabled()) return () => {};

  const snap = (): JumpSnapshot => ({
    finalLen: getters.finalAnswer().trim().length,
    stableLen: getters.stableAnswer().trim().length,
    running: getters.isRunning(),
    streaming: getters.answerStreaming(),
    showExploration: getters.showExploration(),
    showAnswerBlock: getters.showAnswerBlock(),
  });

  let prev = snap();

  return watch(
    () => [
      getters.finalAnswer(),
      getters.stableAnswer(),
      getters.isRunning(),
      getters.answerStreaming(),
      getters.showExploration(),
      getters.showAnswerBlock(),
    ] as const,
    () => {
      const next = snap();
      const reasons: string[] = [];

      if (prev.finalLen > 48 && next.finalLen < prev.finalLen * 0.85) {
        reasons.push(`finalAnswer shrink ${prev.finalLen}→${next.finalLen}`);
      }
      if (prev.stableLen > 48 && next.stableLen < prev.stableLen * 0.85) {
        reasons.push(`stableAnswer shrink ${prev.stableLen}→${next.stableLen}`);
      }
      if (prev.showAnswerBlock && !next.showAnswerBlock) {
        reasons.push("answer block hidden");
      }
      if (!prev.showAnswerBlock && next.showAnswerBlock) {
        reasons.push("answer block shown");
      }
      if (prev.showExploration !== next.showExploration) {
        reasons.push(`exploration ${prev.showExploration}→${next.showExploration}`);
      }
      if (prev.streaming !== next.streaming) {
        reasons.push(`streaming ${prev.streaming}→${next.streaming}`);
      }
      if (prev.running !== next.running) {
        reasons.push(`running ${prev.running}→${next.running}`);
      }

      if (reasons.length) {
        logAgentJump(scope, { reasons, prev, next });
      }
      prev = next;
    },
  );
}
