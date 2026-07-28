use serde_json::{json, Value};
use tauri::ipc::Channel;

use super::consultative_trace::{
  build_behavior_purpose_trace_retry_hint, build_consultative_accuracy_trace_retry_hint,
  build_consultative_ui_behavior_trace_retry_hint, should_block_behavior_purpose_finalize,
  should_block_consultative_accuracy_finalize, should_block_consultative_ui_behavior_finalize,
};
use super::explore_guard::{
  claims_ghost_modification_reply, claims_success_despite_patch_failures,
  build_ghost_reply_retry_nudge, build_manual_handoff_retry_nudge,
  is_analysis_only_reply_under_force_patch, is_manual_handoff_without_write_reply,
  PatchFailureEntry, ToolGuardState,
};
use super::ambiguous_term::{looks_like_clarification_question, looks_like_premature_plan_or_scaffold};
use super::exploration::{
  build_ambiguous_term_clarification_retry_nudge, build_auto_bug_fix_empty_reply_nudge,
  build_empty_reply_retry_nudge, build_modification_audit_message,
  build_patch_failure_completion_retry_nudge, build_patch_required_retry_nudge,
  build_premature_completion_retry_nudge, claims_premature_completion,
};
use super::finish_gate::{
  build_finish_gate_retry_nudge, evaluate_finish_gate, is_empty_or_insufficient_final_reply,
  FinishGateInput, WriteStage,
};
use super::policy::AgentRunPolicy;
use super::probe_guard::{build_workspace_cleanup_nudge, ProbeArtifactTracker};
use super::run_emit::emit;
use super::vision_consultative::{
  build_consultative_ui_appearance_retry_hint, build_vision_consultative_locate_retry_hint,
  consultative_appearance_needs_vue_read, should_block_consultative_vision_locate_finalize,
  ConsultativeVisionFinalizeInput,
};
use super::vision_pregrep::build_vision_consultative_read_after_prefgrep_hint;

pub(crate) struct FinalizeTurnParams<'a> {
  pub messages: &'a mut Vec<Value>,
  pub assistant_text: &'a str,
  pub written_files: &'a [String],
  pub tool_guard: &'a ToolGuardState,
  pub run_policy: &'a AgentRunPolicy,
  pub mode: &'a str,
  pub is_read_only_run: bool,
  pub is_execute_plan: bool,
  pub verify_script_available: bool,
  pub task_prompt: &'a str,
  pub target_files: Option<Vec<String>>,
  pub pregrep_unique_files: &'a [String],
  pub consultative_read_paths: &'a [String],
  pub consultative_read_failed_paths: &'a [String],
  pub consultative_grep_patterns: &'a [String],
  pub vision_locate_tools_used: bool,
  pub vision_auto_grep_had_matches: bool,
  pub vision_locate_read_used: bool,
  pub effective_read_only_build: bool,
  pub patch_failure_log: &'a [PatchFailureEntry],
  pub probe_tracker: &'a ProbeArtifactTracker,
  pub build_explore_force_patch_sent: bool,
  pub patch_anchor_force_pending: bool,
  pub turn: u32,
  pub segment_max_turns: u32,
  pub channel: &'a Channel<Value>,
  pub ambiguous_term_clarification_pending: bool,
  pub ambiguous_term_clarification_terms: &'a [String],
}

pub(crate) struct FinalizeTurnMut {
  pub consultative_force_answer_pending: bool,
  pub vision_consultative_locate_retries: u32,
  pub accuracy_retries: u32,
  pub behavior_purpose_retries: u32,
  pub ui_behavior_retries: u32,
  pub modification_audit_sent: bool,
  pub patch_required_retries: u32,
  pub patch_failure_completion_retries: u32,
  pub manual_handoff_retries: u32,
  pub premature_completion_retries: u32,
  pub empty_reply_retries: u32,
  pub workspace_cleanup_nudge_sent: bool,
  pub ambiguous_term_clarification_pending: bool,
  pub ambiguous_term_clarification_retries: u32,
}

#[derive(Debug, PartialEq)]
pub(crate) enum FinalizeTurnOutcome {
  Continue,
  Break,
}

pub(crate) fn handle_final_turn(
  params: &mut FinalizeTurnParams<'_>,
  state: &mut FinalizeTurnMut,
) -> FinalizeTurnOutcome {
  if params.ambiguous_term_clarification_pending {
    if looks_like_premature_plan_or_scaffold(params.assistant_text) {
      state.ambiguous_term_clarification_retries += 1;
      params.messages.push(json!({
        "role": "assistant",
        "content": params.assistant_text
      }));
      params.messages.push(json!({
        "role": "system",
        "content": build_ambiguous_term_clarification_retry_nudge(params.ambiguous_term_clarification_terms)
      }));
      emit(
        params.channel,
        json!({
          "type": "status",
          "data": {
            "phase": "ambiguous_term_clarify_retry",
            "turn": params.turn,
            "maxTurns": params.segment_max_turns,
            "detail": format!(
              "歧义词未澄清即输出方案，第 {} 次要求改为提问",
              state.ambiguous_term_clarification_retries
            )
          }
        }),
      );
      if state.ambiguous_term_clarification_retries <= 2 {
        return FinalizeTurnOutcome::Continue;
      }
    }
    if looks_like_clarification_question(params.assistant_text)
      || !looks_like_premature_plan_or_scaffold(params.assistant_text)
    {
      state.ambiguous_term_clarification_pending = false;
    }
  }

  let stage = WriteStage {
    files: std::collections::HashMap::new(),
    written_list: params.written_files.to_vec(),
  };
  let gate_input = FinishGateInput {
    raw_content: params.assistant_text.to_string(),
    write_stage: Some(stage),
    is_read_only_agent: params.is_read_only_run,
    is_plan_explore: params.mode == "plan",
    read_only_build_run: params.run_policy.read_only_build_run,
    is_execute_plan: params.is_execute_plan,
    implement_follow_up_run: params.run_policy.implement_follow_up_run,
    target_files: params.target_files.clone(),
    task_prompt: Some(params.task_prompt.to_string()),
    automated_bug_fix_run: Some(params.run_policy.automated_bug_fix_run),
    verify_script_available: Some(params.verify_script_available),
    last_verify_run_succeeded: Some(None),
  };
  let gate_result = evaluate_finish_gate(&gate_input);
  if gate_result.blocked {
    let nudge = build_finish_gate_retry_nudge(&gate_result);
    params.messages.push(json!({ "role": "user", "content": nudge }));
    return FinalizeTurnOutcome::Continue;
  }

  let grep_hit_vue_files: Vec<String> = params.tool_guard.grep_hit_vue_files.iter().cloned().collect();
  if !state.consultative_force_answer_pending
    && params.run_policy.consultative_vision_run
    && state.vision_consultative_locate_retries < 2
    && should_block_consultative_vision_locate_finalize(&ConsultativeVisionFinalizeInput {
      consultative_vision_run: params.run_policy.consultative_vision_run,
      vision_locate_active: params.tool_guard.vision_locate_active,
      vision_locate_tools_used: params.vision_locate_tools_used,
      vision_auto_grep_had_matches: params.vision_auto_grep_had_matches,
      vision_locate_read_used: params.vision_locate_read_used,
      prompt: params.task_prompt,
      reply_text: params.assistant_text,
      vision_first_turn_text: params.tool_guard.vision_narrative_text.as_deref(),
      grep_hit_vue_files: &grep_hit_vue_files,
      consultative_read_paths: params.consultative_read_paths,
    })
  {
    state.vision_consultative_locate_retries += 1;
    let file_candidates = if !params.pregrep_unique_files.is_empty() {
      params.pregrep_unique_files
    } else {
      &grep_hit_vue_files
    };
    let appearance_needs_read = params.run_policy.consultative_ui_appearance_run
      && consultative_appearance_needs_vue_read(
        &grep_hit_vue_files,
        params.consultative_read_paths,
        params.vision_locate_read_used,
      );
    let nudge = if appearance_needs_read {
      build_consultative_ui_appearance_retry_hint(file_candidates)
    } else if params.vision_auto_grep_had_matches && !params.vision_locate_read_used {
      build_vision_consultative_read_after_prefgrep_hint(file_candidates)
    } else {
      build_vision_consultative_locate_retry_hint(&params.tool_guard.vision_anchor_quotes)
    };
    if appearance_needs_read || state.vision_consultative_locate_retries >= 2 {
      state.consultative_force_answer_pending = true;
    }
    params
      .messages
      .push(json!({ "role": "assistant", "content": params.assistant_text }));
    params.messages.push(json!({ "role": "system", "content": nudge }));
    emit(
      params.channel,
      json!({
        "type": "status",
        "data": {
          "phase": "vision_consultative_locate_retry",
          "turn": params.turn,
          "maxTurns": params.segment_max_turns,
          "detail": "咨询读图定位需先 grep/read 再作答"
        }
      }),
    );
    return FinalizeTurnOutcome::Continue;
  }

  let mut consultative_nudge: Option<String> = None;
  if params.run_policy.accuracy_consultative_run
    && !state.consultative_force_answer_pending
    && state.accuracy_retries < 2
    && should_block_consultative_accuracy_finalize(
      true,
      params.vision_locate_tools_used,
      params.consultative_read_paths,
      params.assistant_text,
    )
  {
    state.accuracy_retries += 1;
    consultative_nudge = Some(build_consultative_accuracy_trace_retry_hint(
      params.consultative_read_paths,
    ));
  } else if params.run_policy.behavior_purpose_run
    && state.behavior_purpose_retries < 2
    && should_block_behavior_purpose_finalize(
      true,
      params.consultative_read_paths,
      params.assistant_text,
    )
  {
    state.behavior_purpose_retries += 1;
    consultative_nudge = Some(build_behavior_purpose_trace_retry_hint(
      params.consultative_read_paths,
    ));
  } else if params.effective_read_only_build
    && !state.consultative_force_answer_pending
    && state.ui_behavior_retries < 2
    && should_block_consultative_ui_behavior_finalize(
      true,
      params.task_prompt,
      params.assistant_text,
      params.consultative_read_paths,
      params.consultative_read_failed_paths,
      params.vision_locate_tools_used,
      params.consultative_grep_patterns,
    )
  {
    state.ui_behavior_retries += 1;
    consultative_nudge = Some(build_consultative_ui_behavior_trace_retry_hint(
      params.consultative_read_paths,
      params.consultative_read_failed_paths,
    ));
  }

  if let Some(nudge) = consultative_nudge {
    params
      .messages
      .push(json!({ "role": "assistant", "content": params.assistant_text }));
    params.messages.push(json!({ "role": "user", "content": nudge }));
    return FinalizeTurnOutcome::Continue;
  }

  if !params.is_read_only_run
    && !params.patch_failure_log.is_empty()
    && !state.modification_audit_sent
  {
    state.modification_audit_sent = true;
    let fail_files: String = params
      .patch_failure_log
      .iter()
      .map(|e| e.path.as_str())
      .collect::<std::collections::HashSet<_>>()
      .into_iter()
      .collect::<Vec<_>>()
      .join("、");
    params.messages.push(json!({
      "role": "system",
      "content": build_modification_audit_message(
        params.written_files.len(),
        params.written_files,
        params.patch_failure_log.len(),
        &fail_files,
      )
    }));
  }

  if !params.is_read_only_run
    && params.mode != "plan"
    && !params.run_policy.read_only_build_run
    && params.written_files.is_empty()
    && params.turn > 1
    && claims_ghost_modification_reply(params.assistant_text)
  {
    params
      .messages
      .push(json!({ "role": "assistant", "content": params.assistant_text }));
    params.messages.push(json!({
      "role": "system",
      "content": build_ghost_reply_retry_nudge()
    }));
    emit(
      params.channel,
      json!({
        "type": "status",
        "data": {
          "phase": "ghost_reply_retry",
          "turn": params.turn,
          "maxTurns": params.segment_max_turns,
          "detail": "检测到幻觉回复（声称修改但未执行工具），已要求重试"
        }
      }),
    );
    return FinalizeTurnOutcome::Continue;
  }

  if state.patch_required_retries < 1
    && params.build_explore_force_patch_sent
    && is_analysis_only_reply_under_force_patch(params.assistant_text)
  {
    state.patch_required_retries += 1;
    params
      .messages
      .push(json!({ "role": "assistant", "content": params.assistant_text }));
    params.messages.push(json!({
      "role": "user",
      "content": build_patch_required_retry_nudge()
    }));
    return FinalizeTurnOutcome::Continue;
  }

  if !params.is_read_only_run
    && params.mode != "plan"
    && !params.run_policy.read_only_build_run
    && params.written_files.is_empty()
    && state.manual_handoff_retries < 1
    && is_manual_handoff_without_write_reply(
      params.assistant_text,
      !params.patch_failure_log.is_empty(),
    )
  {
    state.manual_handoff_retries += 1;
    params
      .messages
      .push(json!({ "role": "assistant", "content": params.assistant_text }));
    params.messages.push(json!({
      "role": "user",
      "content": build_manual_handoff_retry_nudge()
    }));
    emit(
      params.channel,
      json!({
        "type": "status",
        "data": {
          "phase": "manual_handoff_retry",
          "turn": params.turn,
          "maxTurns": params.segment_max_turns,
          "detail": "有方案但未落盘，已禁止手动粘贴收尾"
        }
      }),
    );
    return FinalizeTurnOutcome::Continue;
  }

  if !params.is_read_only_run
    && !params.patch_failure_log.is_empty()
    && state.patch_failure_completion_retries < 2
    && claims_success_despite_patch_failures(params.assistant_text, params.patch_failure_log.len())
  {
    state.patch_failure_completion_retries += 1;
    let failed_paths: Vec<String> = params
      .patch_failure_log
      .iter()
      .map(|e| e.path.clone())
      .collect::<std::collections::HashSet<_>>()
      .into_iter()
      .collect();
    params
      .messages
      .push(json!({ "role": "assistant", "content": params.assistant_text }));
    params.messages.push(json!({
      "role": "user",
      "content": build_patch_failure_completion_retry_nudge(&failed_paths, params.written_files)
    }));
    return FinalizeTurnOutcome::Continue;
  }

  let allow_premature_retry = params.run_policy.user_failure_report_run
    || params.run_policy.code_review_run
    || params.run_policy.same_issue_follow_up_run;
  if allow_premature_retry
    && state.premature_completion_retries < 2
    && claims_premature_completion(params.assistant_text)
  {
    state.premature_completion_retries += 1;
    params
      .messages
      .push(json!({ "role": "assistant", "content": params.assistant_text }));
    params.messages.push(json!({
      "role": "user",
      "content": build_premature_completion_retry_nudge(params.run_policy.user_recently_reported_failure)
    }));
    return FinalizeTurnOutcome::Continue;
  }

  if state.empty_reply_retries < 2 && is_empty_or_insufficient_final_reply(params.assistant_text) {
    state.empty_reply_retries += 1;
    params
      .messages
      .push(json!({ "role": "assistant", "content": params.assistant_text }));
    let nudge = if params.run_policy.automated_bug_fix_run {
      build_auto_bug_fix_empty_reply_nudge()
    } else {
      build_empty_reply_retry_nudge()
    };
    params.messages.push(json!({ "role": "user", "content": nudge }));
    emit(
      params.channel,
      json!({
        "type": "status",
        "data": {
          "phase": "empty_reply_retry",
          "turn": params.turn,
          "maxTurns": params.segment_max_turns
        }
      }),
    );
    return FinalizeTurnOutcome::Continue;
  }

  if !params.is_read_only_run
    && params.mode != "plan"
    && !params.run_policy.read_only_build_run
    && !state.workspace_cleanup_nudge_sent
  {
    let uncleaned = params.probe_tracker.list_uncleaned();
    if !uncleaned.is_empty() {
      state.workspace_cleanup_nudge_sent = true;
      params
        .messages
        .push(json!({ "role": "assistant", "content": params.assistant_text }));
      params.messages.push(json!({
        "role": "system",
        "content": build_workspace_cleanup_nudge(&uncleaned)
      }));
      emit(
        params.channel,
        json!({
          "type": "status",
          "data": {
            "phase": "workspace_cleanup_retry",
            "turn": params.turn,
            "maxTurns": params.segment_max_turns,
            "detail": "检测到临时探针文件未清理，已要求删除"
          }
        }),
      );
      return FinalizeTurnOutcome::Continue;
    }
  }

  if state.empty_reply_retries >= 2 && is_empty_or_insufficient_final_reply(params.assistant_text) {
    emit(
      params.channel,
      json!({
        "type": "error",
        "data": { "message": "空回复重试次数已达上限" }
      }),
    );
  }

  FinalizeTurnOutcome::Break
}

#[cfg(test)]
mod tests {
  use super::*;

  fn dummy_channel() -> Channel<Value> {
    Channel::new(|_| Ok(()))
  }

  #[test]
  fn finalize_ambiguous_term_clarify_blocked_then_cleared() {
    let mut messages = Vec::new();
    let mut state = FinalizeTurnMut {
      consultative_force_answer_pending: false,
      vision_consultative_locate_retries: 0,
      accuracy_retries: 0,
      behavior_purpose_retries: 0,
      ui_behavior_retries: 0,
      modification_audit_sent: false,
      patch_required_retries: 0,
      patch_failure_completion_retries: 0,
      manual_handoff_retries: 0,
      premature_completion_retries: 0,
      empty_reply_retries: 0,
      workspace_cleanup_nudge_sent: false,
      ambiguous_term_clarification_pending: true,
      ambiguous_term_clarification_retries: 0,
    };
    // Reply that looks like a premature plan/scaffold — triggers retry
    let mut params = FinalizeTurnParams {
      messages: &mut messages,
      assistant_text: "## 修改方案\n1. 修改 src/main.rs",
      written_files: &[],
      tool_guard: &ToolGuardState::default(),
      run_policy: &AgentRunPolicy::default(),
      mode: "build",
      is_read_only_run: false,
      is_execute_plan: false,
      verify_script_available: false,
      task_prompt: "implement feature",
      target_files: None,
      pregrep_unique_files: &[],
      consultative_read_paths: &[],
      consultative_read_failed_paths: &[],
      consultative_grep_patterns: &[],
      vision_locate_tools_used: false,
      vision_auto_grep_had_matches: false,
      vision_locate_read_used: false,
      effective_read_only_build: false,
      patch_failure_log: &[],
      probe_tracker: &ProbeArtifactTracker::default(),
      build_explore_force_patch_sent: false,
      patch_anchor_force_pending: false,
      turn: 2,
      segment_max_turns: 200,
      channel: &dummy_channel(),
      ambiguous_term_clarification_pending: true,
      ambiguous_term_clarification_terms: &["歧义词1".to_string()],
    };
    let result = handle_final_turn(&mut params, &mut state);
    assert_eq!(result, FinalizeTurnOutcome::Continue);
    assert_eq!(state.ambiguous_term_clarification_retries, 1);
    assert!(state.ambiguous_term_clarification_pending); // still pending after 1 retry
  }

  #[test]
  fn finalize_ambiguous_term_cleared_when_looks_like_clarification() {
    let mut messages = Vec::new();
    let mut state = FinalizeTurnMut {
      consultative_force_answer_pending: false,
      vision_consultative_locate_retries: 0,
      accuracy_retries: 0,
      behavior_purpose_retries: 0,
      ui_behavior_retries: 0,
      modification_audit_sent: false,
      patch_required_retries: 0,
      patch_failure_completion_retries: 0,
      manual_handoff_retries: 0,
      premature_completion_retries: 0,
      empty_reply_retries: 0,
      workspace_cleanup_nudge_sent: false,
      ambiguous_term_clarification_pending: true,
      ambiguous_term_clarification_retries: 0,
    };
    let mut params = FinalizeTurnParams {
      messages: &mut messages,
      assistant_text: "请问你指的是哪个模块？",
      written_files: &[],
      tool_guard: &ToolGuardState::default(),
      run_policy: &AgentRunPolicy::default(),
      mode: "build",
      is_read_only_run: false,
      is_execute_plan: false,
      verify_script_available: false,
      task_prompt: "implement feature",
      target_files: None,
      pregrep_unique_files: &[],
      consultative_read_paths: &[],
      consultative_read_failed_paths: &[],
      consultative_grep_patterns: &[],
      vision_locate_tools_used: false,
      vision_auto_grep_had_matches: false,
      vision_locate_read_used: false,
      effective_read_only_build: false,
      patch_failure_log: &[],
      probe_tracker: &ProbeArtifactTracker::default(),
      build_explore_force_patch_sent: false,
      patch_anchor_force_pending: false,
      turn: 2,
      segment_max_turns: 200,
      channel: &dummy_channel(),
      ambiguous_term_clarification_pending: true,
      ambiguous_term_clarification_terms: &[],
    };
    let _ = handle_final_turn(&mut params, &mut state);
    // The reply looks like a clarification question, so pending should clear
    assert!(!state.ambiguous_term_clarification_pending);
  }

  #[test]
  fn finalize_breaks_when_no_issues() {
    let mut messages = Vec::new();
    let mut state = FinalizeTurnMut {
      consultative_force_answer_pending: false,
      vision_consultative_locate_retries: 0,
      accuracy_retries: 0,
      behavior_purpose_retries: 0,
      ui_behavior_retries: 0,
      modification_audit_sent: false,
      patch_required_retries: 0,
      patch_failure_completion_retries: 0,
      manual_handoff_retries: 0,
      premature_completion_retries: 0,
      empty_reply_retries: 0,
      workspace_cleanup_nudge_sent: false,
      ambiguous_term_clarification_pending: false,
      ambiguous_term_clarification_retries: 0,
    };
    let mut params = FinalizeTurnParams {
      messages: &mut messages,
      assistant_text: "已经完成了修改，添加了新文件 src/foo.ts",
      written_files: &["src/foo.ts".to_string()],
      tool_guard: &ToolGuardState::default(),
      run_policy: &AgentRunPolicy::default(),
      mode: "build",
      is_read_only_run: false,
      is_execute_plan: false,
      verify_script_available: false,
      task_prompt: "implement feature",
      target_files: None,
      pregrep_unique_files: &[],
      consultative_read_paths: &[],
      consultative_read_failed_paths: &[],
      consultative_grep_patterns: &[],
      vision_locate_tools_used: false,
      vision_auto_grep_had_matches: false,
      vision_locate_read_used: false,
      effective_read_only_build: false,
      patch_failure_log: &[],
      probe_tracker: &ProbeArtifactTracker::default(),
      build_explore_force_patch_sent: false,
      patch_anchor_force_pending: false,
      turn: 5,
      segment_max_turns: 200,
      channel: &dummy_channel(),
      ambiguous_term_clarification_pending: false,
      ambiguous_term_clarification_terms: &[],
    };
    let result = handle_final_turn(&mut params, &mut state);
    assert_eq!(result, FinalizeTurnOutcome::Break,
      "should break when no issues detected");
  }

  #[test]
  fn finalize_empty_reply_triggers_retry() {
    let mut messages = Vec::new();
    let mut state = FinalizeTurnMut {
      consultative_force_answer_pending: false,
      vision_consultative_locate_retries: 0,
      accuracy_retries: 0,
      behavior_purpose_retries: 0,
      ui_behavior_retries: 0,
      modification_audit_sent: false,
      patch_required_retries: 0,
      patch_failure_completion_retries: 0,
      manual_handoff_retries: 0,
      premature_completion_retries: 0,
      empty_reply_retries: 0,
      workspace_cleanup_nudge_sent: false,
      ambiguous_term_clarification_pending: false,
      ambiguous_term_clarification_retries: 0,
    };
    let mut params = FinalizeTurnParams {
      messages: &mut messages,
      assistant_text: "ok",
      written_files: &[],
      tool_guard: &ToolGuardState::default(),
      run_policy: &AgentRunPolicy::default(),
      mode: "build",
      is_read_only_run: false,
      is_execute_plan: false,
      verify_script_available: false,
      task_prompt: "implement feature",
      target_files: None,
      pregrep_unique_files: &[],
      consultative_read_paths: &[],
      consultative_read_failed_paths: &[],
      consultative_grep_patterns: &[],
      vision_locate_tools_used: false,
      vision_auto_grep_had_matches: false,
      vision_locate_read_used: false,
      effective_read_only_build: false,
      patch_failure_log: &[],
      probe_tracker: &ProbeArtifactTracker::default(),
      build_explore_force_patch_sent: false,
      patch_anchor_force_pending: false,
      turn: 5,
      segment_max_turns: 200,
      channel: &dummy_channel(),
      ambiguous_term_clarification_pending: false,
      ambiguous_term_clarification_terms: &[],
    };
    let result = handle_final_turn(&mut params, &mut state);
    assert_eq!(result, FinalizeTurnOutcome::Continue);
    assert_eq!(state.empty_reply_retries, 1);
    assert!(!messages.is_empty(), "retry nudge should be added");
  }

  #[test]
  fn finalize_empty_reply_exhaustion_emits_error() {
    let mut messages = Vec::new();
    let mut state = FinalizeTurnMut {
      consultative_force_answer_pending: false,
      vision_consultative_locate_retries: 0,
      accuracy_retries: 0,
      behavior_purpose_retries: 0,
      ui_behavior_retries: 0,
      modification_audit_sent: false,
      patch_required_retries: 0,
      patch_failure_completion_retries: 0,
      manual_handoff_retries: 0,
      premature_completion_retries: 0,
      empty_reply_retries: 2, // Already exhausted 2 retries
      workspace_cleanup_nudge_sent: false,
      ambiguous_term_clarification_pending: false,
      ambiguous_term_clarification_retries: 0,
    };
    let mut params = FinalizeTurnParams {
      messages: &mut messages,
      assistant_text: "好的",
      written_files: &[],
      tool_guard: &ToolGuardState::default(),
      run_policy: &AgentRunPolicy::default(),
      mode: "build",
      is_read_only_run: false,
      is_execute_plan: false,
      verify_script_available: false,
      task_prompt: "implement feature",
      target_files: None,
      pregrep_unique_files: &[],
      consultative_read_paths: &[],
      consultative_read_failed_paths: &[],
      consultative_grep_patterns: &[],
      vision_locate_tools_used: false,
      vision_auto_grep_had_matches: false,
      vision_locate_read_used: false,
      effective_read_only_build: false,
      patch_failure_log: &[],
      probe_tracker: &ProbeArtifactTracker::default(),
      build_explore_force_patch_sent: false,
      patch_anchor_force_pending: false,
      turn: 5,
      segment_max_turns: 200,
      channel: &dummy_channel(),
      ambiguous_term_clarification_pending: false,
      ambiguous_term_clarification_terms: &[],
    };
    let result = handle_final_turn(&mut params, &mut state);
    // Despite exhausted retries, still Break because empty_reply >= 2 + insufficient
    assert_eq!(result, FinalizeTurnOutcome::Break);
  }

  #[test]
  fn finalize_breaks_with_non_empty_reply_after_retries_exhausted() {
    let mut messages = Vec::new();
    let mut state = FinalizeTurnMut {
      consultative_force_answer_pending: false,
      vision_consultative_locate_retries: 0,
      accuracy_retries: 0,
      behavior_purpose_retries: 0,
      ui_behavior_retries: 0,
      modification_audit_sent: false,
      patch_required_retries: 0,
      patch_failure_completion_retries: 0,
      manual_handoff_retries: 0,
      premature_completion_retries: 0,
      empty_reply_retries: 2,
      workspace_cleanup_nudge_sent: false,
      ambiguous_term_clarification_pending: false,
      ambiguous_term_clarification_retries: 0,
    };
    let mut params = FinalizeTurnParams {
      messages: &mut messages,
      assistant_text: "已修改 src/main.rs 中的 bug，添加了空值检查。",
      written_files: &["src/main.rs".to_string()],
      tool_guard: &ToolGuardState::default(),
      run_policy: &AgentRunPolicy::default(),
      mode: "build",
      is_read_only_run: false,
      is_execute_plan: false,
      verify_script_available: false,
      task_prompt: "implement feature",
      target_files: None,
      pregrep_unique_files: &[],
      consultative_read_paths: &[],
      consultative_read_failed_paths: &[],
      consultative_grep_patterns: &[],
      vision_locate_tools_used: false,
      vision_auto_grep_had_matches: false,
      vision_locate_read_used: false,
      effective_read_only_build: false,
      patch_failure_log: &[],
      probe_tracker: &ProbeArtifactTracker::default(),
      build_explore_force_patch_sent: false,
      patch_anchor_force_pending: false,
      turn: 5,
      segment_max_turns: 200,
      channel: &dummy_channel(),
      ambiguous_term_clarification_pending: false,
      ambiguous_term_clarification_terms: &[],
    };
    // Non-empty, substantive reply should break even if retries exhausted
    let result = handle_final_turn(&mut params, &mut state);
    assert_eq!(result, FinalizeTurnOutcome::Break);
  }
}
