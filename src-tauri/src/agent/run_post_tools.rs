use serde_json::{json, Value};

use super::exploration::{
    build_alternate_ui_patch_strategy_nudge, build_ask_explore_budget_nudge,
    build_consultative_duplicate_explore_nudge, build_explore_budget_nudge,
    build_explore_explore_budget_nudge, build_grep_empty_recovery_nudge,
    build_grep_hit_vue_read_nudge, build_read_file_failed_recovery_nudge,
    build_runtime_tool_failure_recovery_nudge, build_turn_patch_failure_nudge,
    resolve_explore_turn_budget, MAX_CONSECUTIVE_RUNTIME_TOOL_FAILURE_TURNS,
};
use super::explore_guard::{
    consultative_explore_signature, is_runtime_explore_failure_turn,
    should_nudge_alternate_ui_patch_strategy, unread_grep_hit_vue_files, PatchFailureEntry,
    ToolGuardState,
};

pub(crate) struct PostToolNudgeParams<'a> {
    pub messages: &'a mut Vec<Value>,
    pub turn: u32,
    pub turn_grep_empty_patterns: &'a [String],
    pub turn_read_failed_paths: &'a [String],
    pub turn_patch_failures: &'a [PatchFailureEntry],
    pub patch_failure_log: &'a [PatchFailureEntry],
    pub effective_read_only_build: bool,
    pub consultative_vision_run: bool,
    pub turn_had_only_read_tools: bool,
    pub turn_had_grep: bool,
    pub tool_guard: &'a ToolGuardState,
    pub consultative_read_paths: &'a [String],
    pub turn_tool_outcomes: &'a [String],
    pub consultative_grep_patterns: &'a [String],
    pub consultative_search_queries: &'a [String],
    pub is_read_only_run: bool,
    pub written_files: &'a [String],
    pub mode: &'a str,
    pub is_execute_plan: bool,
    pub is_plan_explore: bool,
    pub is_plan_text_only_follow_up: bool,
    pub read_only_build_run: bool,
}

pub(crate) struct PostToolTurnMut {
    pub consecutive_runtime_tool_failure_turns: u32,
    pub last_consultative_explore_sig: Option<String>,
    pub consecutive_read_turns: u32,
    pub total_read_tool_calls: u32,
    pub build_explore_force_patch_sent: bool,
    pub patch_anchor_force_pending: bool,
    pub force_write_only_tools: bool,
    pub consultative_force_answer_pending: bool,
}

pub(crate) fn apply_post_tool_turn(
    params: &mut PostToolNudgeParams<'_>,
    state: &mut PostToolTurnMut,
) {
    if !params.turn_grep_empty_patterns.is_empty() {
        params.messages.push(json!({
          "role": "system",
          "content": build_grep_empty_recovery_nudge(params.turn_grep_empty_patterns)
        }));
    }
    if !params.turn_read_failed_paths.is_empty() {
        params.messages.push(json!({
          "role": "system",
          "content": build_read_file_failed_recovery_nudge(params.turn_read_failed_paths)
        }));
    }

    if params.turn > 1 && !params.turn_patch_failures.is_empty() {
        let failed_files: String = params
            .turn_patch_failures
            .iter()
            .map(|f| f.path.as_str())
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect::<Vec<_>>()
            .join("、");
        params.messages.push(json!({
          "role": "system",
          "content": build_turn_patch_failure_nudge(params.turn_patch_failures.len(), &failed_files)
        }));
        for path in params
            .turn_patch_failures
            .iter()
            .map(|f| f.path.as_str())
            .collect::<std::collections::HashSet<_>>()
        {
            if should_nudge_alternate_ui_patch_strategy(params.patch_failure_log, path) {
                params.messages.push(json!({
                  "role": "system",
                  "content": build_alternate_ui_patch_strategy_nudge(path)
                }));
            }
        }
    }

    if params.effective_read_only_build
        && params.consultative_vision_run
        && params.turn_had_only_read_tools
        && params.turn_had_grep
    {
        let unread_vue =
            unread_grep_hit_vue_files(params.tool_guard, params.consultative_read_paths);
        if !unread_vue.is_empty() {
            params.messages.push(json!({
              "role": "system",
              "content": build_grep_hit_vue_read_nudge(&unread_vue)
            }));
        }
    }

    let runtime_failure_turn = is_runtime_explore_failure_turn(params.turn_tool_outcomes);
    if runtime_failure_turn {
        state.consecutive_runtime_tool_failure_turns += 1;
        let forced_count = state.consecutive_runtime_tool_failure_turns
            >= MAX_CONSECUTIVE_RUNTIME_TOOL_FAILURE_TURNS;
        params.messages.push(json!({
          "role": "system",
          "content": build_runtime_tool_failure_recovery_nudge(
            state.consecutive_runtime_tool_failure_turns,
            forced_count,
          )
        }));
    } else {
        state.consecutive_runtime_tool_failure_turns = 0;
    }

    if params.effective_read_only_build || params.is_read_only_run {
        let sig = consultative_explore_signature(
            params.consultative_read_paths,
            params.consultative_grep_patterns,
            params.consultative_search_queries,
        );
        if let Some(prev) = state.last_consultative_explore_sig.as_ref() {
            if prev == &sig && !sig.is_empty() {
                params.messages.push(json!({
                  "role": "system",
                  "content": build_consultative_duplicate_explore_nudge()
                }));
            }
        }
        if !sig.is_empty() {
            state.last_consultative_explore_sig = Some(sig);
        }
    }

    if params.turn_had_only_read_tools && !runtime_failure_turn {
        state.consecutive_read_turns += 1;
        state.total_read_tool_calls += 1;
    } else if !params.turn_had_only_read_tools {
        state.consecutive_read_turns = 0;
        if !params.written_files.is_empty() {
            state.build_explore_force_patch_sent = false;
            state.patch_anchor_force_pending = false;
            state.force_write_only_tools = false;
        }
    }

    apply_post_tool_explore_budget_nudges(params, state);
}

fn apply_post_tool_explore_budget_nudges(
    params: &mut PostToolNudgeParams<'_>,
    state: &mut PostToolTurnMut,
) {
    let turn_explore_only = params.turn_had_only_read_tools;
    if !turn_explore_only {
        return;
    }

    let is_explore = params.mode == "explore";
    let explore_turn_budget =
        resolve_explore_turn_budget(is_explore, params.is_execute_plan, params.is_plan_explore);
    let consecutive = state.consecutive_read_turns;

    if is_explore && consecutive >= 4 {
        params.messages.push(json!({
          "role": "system",
          "content": build_explore_explore_budget_nudge(consecutive)
        }));
        state.consecutive_read_turns = 0;
    } else if params.read_only_build_run && consecutive >= 5 {
        params.messages.push(json!({
          "role": "system",
          "content": build_consultative_duplicate_explore_nudge()
        }));
        state.consecutive_read_turns = 0;
    } else if params.is_plan_explore
        && !params.is_plan_text_only_follow_up
        && consecutive >= explore_turn_budget
    {
        params.messages.push(json!({
          "role": "system",
          "content": build_explore_budget_nudge(consecutive, "plan")
        }));
        state.consultative_force_answer_pending = true;
        state.consecutive_read_turns = 0;
    } else if params.is_plan_explore
        && params.is_plan_text_only_follow_up
        && consecutive >= explore_turn_budget
    {
        params.messages.push(json!({
          "role": "system",
          "content": build_ask_explore_budget_nudge(consecutive)
        }));
        state.consultative_force_answer_pending = true;
        state.consecutive_read_turns = 0;
    } else if !params.is_read_only_run
        && !params.read_only_build_run
        && !params.is_plan_explore
        && consecutive >= explore_turn_budget
    {
        params.messages.push(json!({
          "role": "system",
          "content": build_explore_budget_nudge(consecutive, params.mode)
        }));
        state.consecutive_read_turns = 0;
    }
}
