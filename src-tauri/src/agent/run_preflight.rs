use serde_json::{json, Value};
use std::collections::HashSet;

use super::continuation::detect_user_negation;
use super::exploration::{
  build_ask_explore_soft_cap_nudge, build_ask_force_answer_nudge,
  build_build_explore_force_patch_nudge, build_explore_abort_partial_report_nudge,
  build_explore_explore_soft_cap_nudge, build_explore_force_report_nudge,
  build_explore_interim_diagnosis_nudge, build_explore_soft_cap_nudge,
  build_file_breadth_nudge, build_force_output_nudge, build_patch_anchor_force_patch_nudge,
  build_plan_force_answer_nudge, build_same_issue_follow_up_force_summary_nudge,
  build_ui_defect_force_patch_nudge, build_user_negation_nudge, is_productive_write_path,
  EXPLORE_INTERIM_DIAGNOSIS_TURN, EXPLORE_MAX_TOTAL_EXPLORE_HARD, EXPLORE_MAX_TOTAL_EXPLORE_SOFT,
  ASK_MAX_TOTAL_EXPLORE_HARD, ASK_MAX_TOTAL_EXPLORE_SOFT, MAX_UNIQUE_READ_FILES_BEFORE_NUDGE,
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
  pub vision_first_turn_pending: bool,
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

  if !params.is_read_only_run
    && !params.is_plan_explore
    && detect_user_negation(params.prompt)
  {
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
        && (flags.consultative_force_answer_pending || total >= PLAN_MAX_TOTAL_EXPLORE_HARD))
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
    params.messages.push(json!({ "role": "system", "content": content }));
  } else if strip_wide_search {
    let content = if is_explore {
      build_explore_explore_soft_cap_nudge(total)
    } else if params.is_read_only_run || read_only_build {
      build_ask_explore_soft_cap_nudge(total)
    } else {
      build_explore_soft_cap_nudge(total, params.mode)
    };
    params.messages.push(json!({ "role": "system", "content": content }));
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

  let active_tools = if params.vision_first_turn_pending
    || force_text_output
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
