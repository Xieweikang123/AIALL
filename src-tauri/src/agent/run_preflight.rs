use serde_json::{json, Value};
use std::collections::HashSet;

use super::continuation::detect_user_negation;
use super::exploration::{
    build_ask_explore_soft_cap_nudge, build_ask_force_answer_nudge,
    build_build_explore_force_patch_nudge, build_explore_abort_partial_report_nudge,
    build_explore_explore_soft_cap_nudge, build_explore_force_report_nudge,
    build_explore_interim_diagnosis_nudge, build_explore_soft_cap_nudge, build_file_breadth_nudge,
    build_force_output_nudge, build_patch_anchor_force_patch_nudge, build_plan_force_answer_nudge,
    build_same_issue_follow_up_force_summary_nudge, build_ui_defect_force_patch_nudge,
    build_user_negation_nudge, is_productive_write_path, ASK_MAX_TOTAL_EXPLORE_HARD,
    ASK_MAX_TOTAL_EXPLORE_SOFT, EXPLORE_INTERIM_DIAGNOSIS_TURN, EXPLORE_MAX_TOTAL_EXPLORE_HARD,
    EXPLORE_MAX_TOTAL_EXPLORE_SOFT, MAX_UNIQUE_READ_FILES_BEFORE_NUDGE,
    PLAN_MAX_TOTAL_EXPLORE_HARD, PLAN_MAX_TOTAL_EXPLORE_SOFT,
};
use super::explore_guard::{should_force_patch_after_anchor_located, ToolGuardState};
use super::policy::AgentRunPolicy;
use super::run_emit::{
    build_agent_turns_low_nudge, filter_force_patch_tools, filter_read_only_tools,
    filter_strip_wide_search_tools,
};

pub(crate) struct TurnPreflightState {
    pub turns_low_nudge_sent: bool,
    pub consecutive_user_negations: u32,
    pub negation_nudge_sent: bool,
    pub file_breadth_nudge_sent: bool,
    pub interim_diagnosis_nudge_sent: bool,
    pub explore_abort_grace_turn_active: bool,
}

impl TurnPreflightState {
    pub fn new() -> Self {
        Self {
            turns_low_nudge_sent: false,
            consecutive_user_negations: 0,
            negation_nudge_sent: false,
            file_breadth_nudge_sent: false,
            interim_diagnosis_nudge_sent: false,
            explore_abort_grace_turn_active: false,
        }
    }
}

pub(crate) struct TurnPreflightMut {
    pub ui_defect_force_patch_nudge_sent: bool,
    pub build_explore_force_patch_nudge_sent: bool,
    pub patch_anchor_force_patch_nudge_sent: bool,
    pub patch_anchor_force_pending: bool,
    pub force_write_only_tools: bool,
    pub consultative_force_answer_pending: bool,
}

pub(crate) struct TurnPreflightParams<'a> {
    pub messages: &'a mut Vec<Value>,
    pub mode: &'a str,
    pub prompt: &'a str,
    pub is_read_only_run: bool,
    pub is_execute_plan: bool,
    pub is_plan_explore: bool,
    pub is_plan_text_only_follow_up: bool,
    pub run_policy: &'a AgentRunPolicy,
    pub total_read_tool_calls: u32,
    pub written_files: &'a [String],
    pub explore_files_read: &'a HashSet<String>,
    pub tool_guard: &'a ToolGuardState,
    pub all_tools: &'a Value,
    pub read_set: &'a HashSet<&'static str>,
    pub segment_max_turns: u32,
    pub turn: u32,
    pub agent_step_clarify_pending: bool,
    pub ambiguous_term_clarification_pending: bool,
    pub nudge_mode: &'a str,
}

pub(crate) struct TurnPreflightOutcome {
    pub active_tools: Value,
}

fn has_productive_write(written_files: &[String]) -> bool {
    written_files.iter().any(|p| is_productive_write_path(p))
}

pub(crate) fn apply_turn_preflight(
    params: &mut TurnPreflightParams<'_>,
    state: &mut TurnPreflightState,
    flags: &mut TurnPreflightMut,
) -> TurnPreflightOutcome {
    let is_ask = params.mode == "ask";
    let is_explore = params.mode == "explore";
    let read_only_build = params.run_policy.read_only_build_run;
    let explore_hard_cap = params.run_policy.explore_hard_cap;
    let explore_soft_cap = params.run_policy.explore_soft_cap;
    let total = params.total_read_tool_calls;

    if !params.is_read_only_run
        && !read_only_build
        && !state.turns_low_nudge_sent
        && params.turn >= params.segment_max_turns.saturating_sub(3)
    {
        params.messages.push(json!({
          "role": "system",
          "content": build_agent_turns_low_nudge(
            params.turn,
            params.segment_max_turns,
            params.nudge_mode,
            params.is_execute_plan && params.mode == "plan",
          )
        }));
        state.turns_low_nudge_sent = true;
    }

    if !params.is_read_only_run && !params.is_plan_explore && detect_user_negation(params.prompt) {
        state.consecutive_user_negations += 1;
    } else if !params.prompt.is_empty() {
        state.consecutive_user_negations = 0;
        state.negation_nudge_sent = false;
    }
    if !state.negation_nudge_sent
        && state.consecutive_user_negations >= 2
        && !params.is_read_only_run
        && !params.is_plan_explore
        && !read_only_build
    {
        params.messages.push(json!({
          "role": "system",
          "content": build_user_negation_nudge(state.consecutive_user_negations)
        }));
        state.negation_nudge_sent = true;
    }

    let build_explore_hard_cap_reached = !params.is_read_only_run
        && !params.is_plan_explore
        && !read_only_build
        && total >= explore_hard_cap;
    let same_issue_follow_up_needs_summary = params.run_policy.same_issue_follow_up_run
        && build_explore_hard_cap_reached
        && !has_productive_write(params.written_files);
    let force_patch_output = !same_issue_follow_up_needs_summary
        && !params.is_read_only_run
        && !params.is_plan_explore
        && !read_only_build
        && (build_explore_hard_cap_reached
            || should_force_patch_after_anchor_located(
                params.tool_guard.patch_anchor_located,
                flags.patch_anchor_force_pending,
                build_explore_hard_cap_reached,
                params.run_policy.implement_follow_up_run,
            ));
    let force_text_output = !force_patch_output
        && (same_issue_follow_up_needs_summary
            || (is_explore && state.explore_abort_grace_turn_active)
            || (is_explore && total >= EXPLORE_MAX_TOTAL_EXPLORE_HARD)
            || (is_ask && total >= ASK_MAX_TOTAL_EXPLORE_HARD)
            || (params.is_plan_explore
                && !params.is_plan_text_only_follow_up
                && (flags.consultative_force_answer_pending
                    || total >= PLAN_MAX_TOTAL_EXPLORE_HARD))
            || (read_only_build && total >= ASK_MAX_TOTAL_EXPLORE_HARD));
    let strip_wide_search = !force_text_output
        && !force_patch_output
        && ((is_explore && total >= EXPLORE_MAX_TOTAL_EXPLORE_SOFT)
            || (is_ask && total >= ASK_MAX_TOTAL_EXPLORE_SOFT)
            || (params.is_plan_explore
                && !params.is_plan_text_only_follow_up
                && total >= PLAN_MAX_TOTAL_EXPLORE_SOFT)
            || (read_only_build && total >= ASK_MAX_TOTAL_EXPLORE_SOFT)
            || (!params.is_read_only_run
                && !params.is_plan_explore
                && !read_only_build
                && total >= explore_soft_cap));

    if force_patch_output
        && !flags.ui_defect_force_patch_nudge_sent
        && build_explore_hard_cap_reached
        && params.run_policy.ui_defect_build_run
    {
        params.messages.push(json!({
          "role": "system",
          "content": build_ui_defect_force_patch_nudge(total)
        }));
        flags.ui_defect_force_patch_nudge_sent = true;
        flags.force_write_only_tools = true;
        flags.patch_anchor_force_pending = true;
    } else if force_patch_output
        && build_explore_hard_cap_reached
        && !flags.build_explore_force_patch_nudge_sent
        && !params.run_policy.ui_defect_build_run
        && !flags.patch_anchor_force_pending
    {
        params.messages.push(json!({
          "role": "system",
          "content": build_build_explore_force_patch_nudge(total)
        }));
        flags.build_explore_force_patch_nudge_sent = true;
        flags.force_write_only_tools = true;
        flags.patch_anchor_force_pending = true;
    } else if force_patch_output
        && flags.patch_anchor_force_pending
        && !flags.patch_anchor_force_patch_nudge_sent
    {
        params.messages.push(json!({
          "role": "system",
          "content": build_patch_anchor_force_patch_nudge()
        }));
        flags.patch_anchor_force_patch_nudge_sent = true;
    } else if force_text_output {
        let content = if same_issue_follow_up_needs_summary {
            build_same_issue_follow_up_force_summary_nudge(total)
        } else if is_explore {
            if state.explore_abort_grace_turn_active {
                build_explore_abort_partial_report_nudge(params.explore_files_read.len())
            } else {
                build_explore_force_report_nudge(total)
            }
        } else if params.is_plan_explore {
            if params.is_plan_text_only_follow_up {
                build_ask_force_answer_nudge(total)
            } else {
                build_plan_force_answer_nudge(total)
            }
        } else if params.is_read_only_run || read_only_build {
            build_ask_force_answer_nudge(total)
        } else {
            build_force_output_nudge(total, params.mode)
        };
        params
            .messages
            .push(json!({ "role": "system", "content": content }));
    } else if strip_wide_search {
        let content = if is_explore {
            build_explore_explore_soft_cap_nudge(total)
        } else if params.is_read_only_run || read_only_build {
            build_ask_explore_soft_cap_nudge(total)
        } else {
            build_explore_soft_cap_nudge(total, params.mode)
        };
        params
            .messages
            .push(json!({ "role": "system", "content": content }));
    }

    if !state.file_breadth_nudge_sent
        && params.explore_files_read.len() as u32 >= MAX_UNIQUE_READ_FILES_BEFORE_NUDGE
    {
        let files: Vec<String> = params.explore_files_read.iter().cloned().collect();
        params.messages.push(json!({
          "role": "system",
          "content": build_file_breadth_nudge(&files, params.mode)
        }));
        state.file_breadth_nudge_sent = true;
    }

    if !state.interim_diagnosis_nudge_sent
        && !params.is_read_only_run
        && !params.is_plan_explore
        && total >= EXPLORE_INTERIM_DIAGNOSIS_TURN
        && params.written_files.is_empty()
    {
        params.messages.push(json!({
          "role": "system",
          "content": build_explore_interim_diagnosis_nudge(total)
        }));
        state.interim_diagnosis_nudge_sent = true;
    }

    let active_tools = if force_text_output
        || flags.consultative_force_answer_pending
        || params.agent_step_clarify_pending
        || params.ambiguous_term_clarification_pending
    {
        json!([])
    } else if force_patch_output || flags.force_write_only_tools {
        filter_force_patch_tools(params.all_tools)
    } else if strip_wide_search {
        filter_strip_wide_search_tools(params.all_tools)
    } else if params.is_read_only_run {
        filter_read_only_tools(params.all_tools, params.read_set)
    } else {
        params.all_tools.clone()
    };

    TurnPreflightOutcome { active_tools }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn default_policy() -> AgentRunPolicy {
        AgentRunPolicy::default()
    }

    fn default_tool_guard() -> ToolGuardState {
        ToolGuardState::default()
    }

    fn make_tool(name: &str) -> Value {
        json!({ "function": { "name": name, "arguments": "{}" } })
    }

    fn read_set() -> HashSet<&'static str> {
        ["read_file", "grep", "list_dir", "search_files"]
            .into_iter()
            .collect()
    }

    #[test]
    fn preflight_no_nudge_at_start() {
        let mut messages = Vec::new();
        let mut state = TurnPreflightState::new();
        let mut flags = TurnPreflightMut {
            ui_defect_force_patch_nudge_sent: false,
            build_explore_force_patch_nudge_sent: false,
            patch_anchor_force_patch_nudge_sent: false,
            patch_anchor_force_pending: false,
            force_write_only_tools: false,
            consultative_force_answer_pending: false,
        };
        let mut policy = default_policy();
        policy.explore_hard_cap = 50;
        policy.explore_soft_cap = 30;
        let all_tools = json!([make_tool("read_file"), make_tool("grep")]);
        let mut params = TurnPreflightParams {
            messages: &mut messages,
            mode: "build",
            prompt: "fix the bug",
            is_read_only_run: false,
            is_execute_plan: false,
            is_plan_explore: false,
            is_plan_text_only_follow_up: false,
            run_policy: &policy,
            total_read_tool_calls: 0,
            written_files: &[],
            explore_files_read: &HashSet::new(),
            tool_guard: &default_tool_guard(),
            all_tools: &all_tools,
            read_set: &read_set(),
            segment_max_turns: 200,
            turn: 1,
            agent_step_clarify_pending: false,
            ambiguous_term_clarification_pending: false,
            nudge_mode: "build",
        };
        let outcome = apply_turn_preflight(&mut params, &mut state, &mut flags);
        // At turn 1 with 0 reads, no nudge should be sent
        assert!(
            messages.is_empty(),
            "no nudge expected at turn 1, got: {:?}",
            messages
        );
        // All tools should be active
        assert_eq!(outcome.active_tools.as_array().unwrap().len(), 2);
    }

    #[test]
    fn preflight_turns_low_nudge_at_threshold() {
        let mut messages = Vec::new();
        let mut state = TurnPreflightState::new();
        let mut flags = TurnPreflightMut {
            ui_defect_force_patch_nudge_sent: false,
            build_explore_force_patch_nudge_sent: false,
            patch_anchor_force_patch_nudge_sent: false,
            patch_anchor_force_pending: false,
            force_write_only_tools: false,
            consultative_force_answer_pending: false,
        };
        let mut policy = default_policy();
        policy.explore_hard_cap = 50;
        policy.explore_soft_cap = 30;
        let all_tools = json!([make_tool("read_file")]);
        let mut params = TurnPreflightParams {
            messages: &mut messages,
            mode: "build",
            prompt: "continue",
            is_read_only_run: false,
            is_execute_plan: false,
            is_plan_explore: false,
            is_plan_text_only_follow_up: false,
            run_policy: &policy,
            total_read_tool_calls: 0,
            written_files: &[],
            explore_files_read: &HashSet::new(),
            tool_guard: &default_tool_guard(),
            all_tools: &all_tools,
            read_set: &read_set(),
            segment_max_turns: 10,
            turn: 8, // >= 10 - 3 = 7, triggers low nudge
            agent_step_clarify_pending: false,
            ambiguous_term_clarification_pending: false,
            nudge_mode: "build",
        };
        let _outcome = apply_turn_preflight(&mut params, &mut state, &mut flags);
        assert!(!messages.is_empty(), "should send turns low nudge");
        assert!(messages[0]["content"]
            .as_str()
            .unwrap()
            .contains("剩余约 3 轮"));
        assert!(state.turns_low_nudge_sent);
    }

    #[test]
    fn preflight_turns_low_nudge_only_once() {
        let mut messages = Vec::new();
        let mut state = TurnPreflightState::new();
        let mut flags = TurnPreflightMut {
            ui_defect_force_patch_nudge_sent: false,
            build_explore_force_patch_nudge_sent: false,
            patch_anchor_force_patch_nudge_sent: false,
            patch_anchor_force_pending: false,
            force_write_only_tools: false,
            consultative_force_answer_pending: false,
        };
        let mut policy = default_policy();
        policy.explore_hard_cap = 50;
        policy.explore_soft_cap = 30;
        let all_tools = json!([make_tool("read_file")]);
        let mut params = TurnPreflightParams {
            messages: &mut messages,
            mode: "build",
            prompt: "continue",
            is_read_only_run: false,
            is_execute_plan: false,
            is_plan_explore: false,
            is_plan_text_only_follow_up: false,
            run_policy: &policy,
            total_read_tool_calls: 0,
            written_files: &[],
            explore_files_read: &HashSet::new(),
            tool_guard: &default_tool_guard(),
            all_tools: &all_tools,
            read_set: &read_set(),
            segment_max_turns: 10,
            turn: 8,
            agent_step_clarify_pending: false,
            ambiguous_term_clarification_pending: false,
            nudge_mode: "build",
        };
        let _ = apply_turn_preflight(&mut params, &mut state, &mut flags);
        let count_before = params.messages.len();
        // Create new params for second call (params dropped)
        let mut params2 = TurnPreflightParams {
            messages: &mut messages,
            mode: "build",
            prompt: "continue",
            is_read_only_run: false,
            is_execute_plan: false,
            is_plan_explore: false,
            is_plan_text_only_follow_up: false,
            run_policy: &policy,
            total_read_tool_calls: 0,
            written_files: &[],
            explore_files_read: &HashSet::new(),
            tool_guard: &default_tool_guard(),
            all_tools: &all_tools,
            read_set: &read_set(),
            segment_max_turns: 10,
            turn: 9,
            agent_step_clarify_pending: false,
            ambiguous_term_clarification_pending: false,
            nudge_mode: "build",
        };
        let _ = apply_turn_preflight(&mut params2, &mut state, &mut flags);
        assert_eq!(messages.len(), count_before, "should not send nudge again");
    }

    #[test]
    fn preflight_read_only_run_skips_nudge_and_uses_read_only_tools() {
        let mut messages = Vec::new();
        let mut state = TurnPreflightState::new();
        let mut flags = TurnPreflightMut {
            ui_defect_force_patch_nudge_sent: false,
            build_explore_force_patch_nudge_sent: false,
            patch_anchor_force_patch_nudge_sent: false,
            patch_anchor_force_pending: false,
            force_write_only_tools: false,
            consultative_force_answer_pending: false,
        };
        // Include a write tool to verify it's filtered out
        let all_tools = json!([
            make_tool("read_file"),
            make_tool("write_file"),
            make_tool("grep")
        ]);
        let mut params = TurnPreflightParams {
            messages: &mut messages,
            mode: "ask",
            prompt: "read this file",
            is_read_only_run: true,
            is_execute_plan: false,
            is_plan_explore: false,
            is_plan_text_only_follow_up: false,
            run_policy: &default_policy(),
            total_read_tool_calls: 0,
            written_files: &[],
            explore_files_read: &HashSet::new(),
            tool_guard: &default_tool_guard(),
            all_tools: &all_tools,
            read_set: &read_set(),
            segment_max_turns: 10,
            turn: 8, // would trigger low nudge if not read_only
            agent_step_clarify_pending: false,
            ambiguous_term_clarification_pending: false,
            nudge_mode: "ask",
        };
        let outcome = apply_turn_preflight(&mut params, &mut state, &mut flags);
        // No nudge despite turn >= 8 because is_read_only_run
        assert!(messages.is_empty());
        // Only read_file and grep should be active, not write_file
        let active: Vec<&str> = outcome
            .active_tools
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["function"]["name"].as_str().unwrap())
            .collect();
        assert_eq!(active, vec!["read_file", "grep"]);
    }

    #[test]
    fn preflight_user_negation_two_consecutive_triggers_nudge() {
        let mut messages = Vec::new();
        let mut state = TurnPreflightState::new();
        let mut flags = TurnPreflightMut {
            ui_defect_force_patch_nudge_sent: false,
            build_explore_force_patch_nudge_sent: false,
            patch_anchor_force_patch_nudge_sent: false,
            patch_anchor_force_pending: false,
            force_write_only_tools: false,
            consultative_force_answer_pending: false,
        };
        let mut policy = default_policy();
        policy.explore_hard_cap = 50;
        policy.explore_soft_cap = 30;
        let all_tools = json!([make_tool("read_file")]);

        // First negation
        let mut params = TurnPreflightParams {
            messages: &mut messages,
            mode: "build",
            prompt: "不好，换一种方法",
            is_read_only_run: false,
            is_execute_plan: false,
            is_plan_explore: false,
            is_plan_text_only_follow_up: false,
            run_policy: &policy,
            total_read_tool_calls: 0,
            written_files: &[],
            explore_files_read: &HashSet::new(),
            tool_guard: &default_tool_guard(),
            all_tools: &all_tools,
            read_set: &read_set(),
            segment_max_turns: 200,
            turn: 1,
            agent_step_clarify_pending: false,
            ambiguous_term_clarification_pending: false,
            nudge_mode: "build",
        };
        let _ = apply_turn_preflight(&mut params, &mut state, &mut flags);
        // First negation should not trigger nudge (needs 2+)
        assert!(
            messages.is_empty(),
            "first negation should not send nudge, got: {messages:?}"
        );

        // Second negation (reusing state with consecutive_user_negations == 1)
        let mut params2 = TurnPreflightParams {
            messages: &mut messages,
            mode: "build",
            prompt: "还是不对，完全重写",
            is_read_only_run: false,
            is_execute_plan: false,
            is_plan_explore: false,
            is_plan_text_only_follow_up: false,
            run_policy: &policy,
            total_read_tool_calls: 0,
            written_files: &[],
            explore_files_read: &HashSet::new(),
            tool_guard: &default_tool_guard(),
            all_tools: &all_tools,
            read_set: &read_set(),
            segment_max_turns: 200,
            turn: 2,
            agent_step_clarify_pending: false,
            ambiguous_term_clarification_pending: false,
            nudge_mode: "build",
        };
        let _ = apply_turn_preflight(&mut params2, &mut state, &mut flags);
        assert!(!messages.is_empty(), "second negation should trigger nudge");
    }

    #[test]
    fn preflight_force_patch_when_hard_cap_reached() {
        let mut messages = Vec::new();
        let mut state = TurnPreflightState::new();
        let mut flags = TurnPreflightMut {
            ui_defect_force_patch_nudge_sent: false,
            build_explore_force_patch_nudge_sent: false,
            patch_anchor_force_patch_nudge_sent: false,
            patch_anchor_force_pending: false,
            force_write_only_tools: false,
            consultative_force_answer_pending: false,
        };
        let all_tools = json!([
            make_tool("read_file"),
            make_tool("write_file"),
            make_tool("grep")
        ]);
        let mut policy = default_policy();
        policy.explore_hard_cap = 5;
        policy.explore_soft_cap = 3;
        let mut params = TurnPreflightParams {
            messages: &mut messages,
            mode: "build",
            prompt: "fix it",
            is_read_only_run: false,
            is_execute_plan: false,
            is_plan_explore: false,
            is_plan_text_only_follow_up: false,
            run_policy: &policy,
            total_read_tool_calls: 5, // reached hard cap
            written_files: &[],
            explore_files_read: &HashSet::new(),
            tool_guard: &default_tool_guard(),
            all_tools: &all_tools,
            read_set: &read_set(),
            segment_max_turns: 200,
            turn: 10,
            agent_step_clarify_pending: false,
            ambiguous_term_clarification_pending: false,
            nudge_mode: "build",
        };
        let outcome = apply_turn_preflight(&mut params, &mut state, &mut flags);
        assert!(!messages.is_empty(), "should send force patch nudge");
        // Force patch tools should be limited
        let active: Vec<&str> = outcome
            .active_tools
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["function"]["name"].as_str().unwrap())
            .collect();
        // write_file, patch_file, read_file, grep, list_dir, search_files, run_command
        assert!(active.contains(&"write_file"));
        assert!(active.contains(&"read_file"));
        assert!(flags.force_write_only_tools);
    }

    #[test]
    fn preflight_file_breadth_nudge() {
        let mut messages = Vec::new();
        let mut state = TurnPreflightState::new();
        let mut flags = TurnPreflightMut {
            ui_defect_force_patch_nudge_sent: false,
            build_explore_force_patch_nudge_sent: false,
            patch_anchor_force_patch_nudge_sent: false,
            patch_anchor_force_pending: false,
            force_write_only_tools: false,
            consultative_force_answer_pending: false,
        };
        let all_tools = json!([make_tool("read_file")]);
        let many_files: HashSet<String> = (0..25).map(|i| format!("file_{i}.rs")).collect();
        let mut params = TurnPreflightParams {
            messages: &mut messages,
            mode: "build",
            prompt: "fix it",
            is_read_only_run: false,
            is_execute_plan: false,
            is_plan_explore: false,
            is_plan_text_only_follow_up: false,
            run_policy: &default_policy(),
            total_read_tool_calls: 10,
            written_files: &[],
            explore_files_read: &many_files,
            tool_guard: &default_tool_guard(),
            all_tools: &all_tools,
            read_set: &read_set(),
            segment_max_turns: 200,
            turn: 5,
            agent_step_clarify_pending: false,
            ambiguous_term_clarification_pending: false,
            nudge_mode: "build",
        };
        let _ = apply_turn_preflight(&mut params, &mut state, &mut flags);
        assert!(!messages.is_empty(), "should send file breadth nudge");
        assert!(state.file_breadth_nudge_sent);
    }
}
