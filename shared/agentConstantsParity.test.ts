import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AGENT_AI_MAX_RETRIES,
  DEFAULT_AI_MAX_RETRIES,
  MODEL_FIRST_BYTE_TIMEOUT_MS,
} from "./aiRetry";
import { AGENT_SAFETY_MAX_TURNS } from "./agentTurnBudget";
import {
  ASK_EXPLORE_TURN_BUDGET,
  ASK_MAX_TOTAL_EXPLORE_HARD,
  ASK_MAX_TOTAL_EXPLORE_SOFT,
  AUTO_BUG_FIX_EXPLORE_HARD_CAP,
  BUILD_MAX_READ_FILE_REPEATS,
  CONSULTATIVE_BUILD_EXPLORE_TURN_BUDGET,
  EXECUTE_PLAN_EXPLORE_TURN_BUDGET,
  EXPLORE_EXPLORE_TURN_BUDGET,
  EXPLORE_INTERIM_DIAGNOSIS_TURN,
  EXPLORE_MAX_TOTAL_EXPLORE_HARD,
  EXPLORE_MAX_TOTAL_EXPLORE_SOFT,
  INTERACTIVE_EXPLORE_TURN_BUDGET,
  MAX_AUTO_BUG_FIX_WRITES,
  MAX_CONSECUTIVE_RUNTIME_TOOL_FAILURE_TURNS,
  MAX_TOTAL_EXPLORE_TURNS,
  MAX_TOTAL_EXPLORE_TURNS_SOFT,
  MAX_UNIQUE_READ_FILES_BEFORE_NUDGE,
  PLAN_EXPLORE_TURN_BUDGET,
  PLAN_MAX_TOTAL_EXPLORE_HARD,
  PLAN_MAX_TOTAL_EXPLORE_SOFT,
  SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE,
  SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE_SOFT,
} from "./agentExplorationBudget";
import {
  ASK_MAX_CONTEXT_CHARS,
  CONSULTATIVE_UI_APPEARANCE_MAX_CONTEXT_CHARS,
  EXECUTE_PLAN_MAX_CONTEXT_CHARS,
  MAX_AGENT_CONTEXT_CHARS,
  MAX_HISTORY_CHARS,
  MAX_HISTORY_MESSAGES,
  MAX_TOOL_RESULT_MODEL_CHARS,
  PLAN_MAX_CONTEXT_CHARS,
  SOFT_COMPACT_CONTEXT_CHARS,
} from "./agentContextLimits";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseRustNumericConsts(rustPath: string): Record<string, number> {
  const text = fs.readFileSync(rustPath, "utf8");
  const out: Record<string, number> = {};
  const re = /pub(?:\([^)]+\))? const (\w+):[^=]+=\s*([\d_]+)/g;
  for (const match of text.matchAll(re)) {
    out[match[1]] = Number(match[2].replace(/_/g, ""));
  }
  return out;
}

describe("agent constants TS/Rust parity", () => {
  const contextLimits = parseRustNumericConsts(
    path.join(root, "src-tauri/src/agent/context_limits.rs"),
  );
  const retry = parseRustNumericConsts(path.join(root, "src-tauri/src/ai/retry.rs"));
  const runEmit = parseRustNumericConsts(path.join(root, "src-tauri/src/agent/run_emit.rs"));
  const policy = parseRustNumericConsts(path.join(root, "src-tauri/src/agent/policy.rs"));
  const exploration = parseRustNumericConsts(path.join(root, "src-tauri/src/agent/exploration.rs"));

  it("context limit constants match Rust context_limits.rs", () => {
    expect(MAX_AGENT_CONTEXT_CHARS).toBe(contextLimits.MAX_AGENT_CONTEXT_CHARS);
    expect(EXECUTE_PLAN_MAX_CONTEXT_CHARS).toBe(contextLimits.EXECUTE_PLAN_MAX_CONTEXT_CHARS);
    expect(ASK_MAX_CONTEXT_CHARS).toBe(contextLimits.ASK_MAX_CONTEXT_CHARS);
    expect(CONSULTATIVE_UI_APPEARANCE_MAX_CONTEXT_CHARS).toBe(
      contextLimits.CONSULTATIVE_UI_APPEARANCE_MAX_CONTEXT_CHARS,
    );
    expect(PLAN_MAX_CONTEXT_CHARS).toBe(contextLimits.PLAN_MAX_CONTEXT_CHARS);
  });

  it("compact/history constants match Rust context_limits.rs", () => {
    expect(SOFT_COMPACT_CONTEXT_CHARS).toBe(contextLimits.SOFT_COMPACT_CONTEXT_CHARS);
    expect(MAX_TOOL_RESULT_MODEL_CHARS).toBe(contextLimits.MAX_TOOL_RESULT_MODEL_CHARS);
    expect(MAX_HISTORY_MESSAGES).toBe(contextLimits.MAX_HISTORY_MESSAGES);
    expect(MAX_HISTORY_CHARS).toBe(contextLimits.MAX_HISTORY_CHARS);
  });

  it("ai retry constants match Rust retry.rs", () => {
    expect(DEFAULT_AI_MAX_RETRIES).toBe(retry.DEFAULT_AI_MAX_RETRIES);
    expect(MODEL_FIRST_BYTE_TIMEOUT_MS).toBe(retry.MODEL_FIRST_BYTE_TIMEOUT_MS);
    expect(AGENT_AI_MAX_RETRIES).toBe(DEFAULT_AI_MAX_RETRIES + 1);
  });

  it("turn safety ceiling matches Rust run_emit.rs", () => {
    expect(AGENT_SAFETY_MAX_TURNS).toBe(runEmit.AGENT_SAFETY_MAX_TURNS);
  });

  it("build explore caps match Rust policy.rs", () => {
    expect(MAX_TOTAL_EXPLORE_TURNS).toBe(policy.MAX_TOTAL_EXPLORE_TURNS);
    expect(MAX_TOTAL_EXPLORE_TURNS_SOFT).toBe(policy.MAX_TOTAL_EXPLORE_TURNS_SOFT);
    expect(SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE).toBe(policy.SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE);
    expect(SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE_SOFT).toBe(
      policy.SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE_SOFT,
    );
    expect(AUTO_BUG_FIX_EXPLORE_HARD_CAP).toBe(policy.AUTO_BUG_FIX_EXPLORE_HARD_CAP);
  });

  it("exploration budget constants match Rust exploration.rs", () => {
    expect(INTERACTIVE_EXPLORE_TURN_BUDGET).toBe(exploration.INTERACTIVE_EXPLORE_TURN_BUDGET);
    expect(EXECUTE_PLAN_EXPLORE_TURN_BUDGET).toBe(exploration.EXECUTE_PLAN_EXPLORE_TURN_BUDGET);
    expect(PLAN_EXPLORE_TURN_BUDGET).toBe(exploration.PLAN_EXPLORE_TURN_BUDGET);
    expect(ASK_EXPLORE_TURN_BUDGET).toBe(exploration.ASK_EXPLORE_TURN_BUDGET);
    expect(CONSULTATIVE_BUILD_EXPLORE_TURN_BUDGET).toBe(
      exploration.CONSULTATIVE_BUILD_EXPLORE_TURN_BUDGET,
    );
    expect(EXPLORE_EXPLORE_TURN_BUDGET).toBe(exploration.EXPLORE_EXPLORE_TURN_BUDGET);
    expect(PLAN_MAX_TOTAL_EXPLORE_SOFT).toBe(exploration.PLAN_MAX_TOTAL_EXPLORE_SOFT);
    expect(PLAN_MAX_TOTAL_EXPLORE_HARD).toBe(exploration.PLAN_MAX_TOTAL_EXPLORE_HARD);
    expect(ASK_MAX_TOTAL_EXPLORE_SOFT).toBe(exploration.ASK_MAX_TOTAL_EXPLORE_SOFT);
    expect(ASK_MAX_TOTAL_EXPLORE_HARD).toBe(exploration.ASK_MAX_TOTAL_EXPLORE_HARD);
    expect(EXPLORE_MAX_TOTAL_EXPLORE_SOFT).toBe(exploration.EXPLORE_MAX_TOTAL_EXPLORE_SOFT);
    expect(EXPLORE_MAX_TOTAL_EXPLORE_HARD).toBe(exploration.EXPLORE_MAX_TOTAL_EXPLORE_HARD);
    expect(BUILD_MAX_READ_FILE_REPEATS).toBe(exploration.BUILD_MAX_READ_FILE_REPEATS);
    expect(MAX_UNIQUE_READ_FILES_BEFORE_NUDGE).toBe(exploration.MAX_UNIQUE_READ_FILES_BEFORE_NUDGE);
    expect(MAX_CONSECUTIVE_RUNTIME_TOOL_FAILURE_TURNS).toBe(
      exploration.MAX_CONSECUTIVE_RUNTIME_TOOL_FAILURE_TURNS,
    );
    expect(EXPLORE_INTERIM_DIAGNOSIS_TURN).toBe(exploration.EXPLORE_INTERIM_DIAGNOSIS_TURN);
    expect(MAX_AUTO_BUG_FIX_WRITES).toBe(exploration.MAX_AUTO_BUG_FIX_WRITES);
  });
});
