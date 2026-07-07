use crate::ai;
use crate::agent::AgentMode;
use serde_json::{json, Value};
use std::sync::{
  atomic::AtomicBool,
  Arc,
};
use tauri::ipc::Channel;

use super::run_emit::{
  build_segment_continue_nudge, build_turn_cap_exhausted_message, emit, emit_aborted_done,
  extend_segment_max_turns, is_cancelled,
  AGENT_SAFETY_MAX_TURNS,
};
use super::run_preflight::{
  apply_turn_preflight, TurnPreflightMut, TurnPreflightParams, TurnPreflightState,
};
use super::run_startup_hints::{apply_run_startup_hints, RunStartupHintsParams};
use super::run_compact::{compact_messages_for_model, messages_char_size};
use super::run_finalize::{handle_final_turn, FinalizeTurnMut, FinalizeTurnOutcome, FinalizeTurnParams};
use super::run_post_tools::{apply_post_tool_turn, PostToolNudgeParams, PostToolTurnMut};
use super::run_stream::consume_model_sse_stream;
use super::run_system_prompt::{build_agent_system_prompt, SystemPromptBuildParams};
use super::run_types::AgentRunRequest;
use super::{context, intent_hints, policy, runtime_hint, tool_exec, tools};
use super::exploration::AUTO_BUG_FIX_WALL_CLOCK_MS;
use super::explore_guard::{
  build_english_planning_nudge, is_tool_result_failure, should_nudge_english_planning,
  PatchFailureEntry, ToolGuardState,
};
use super::vision_pregrep::{
  apply_vision_anchor_pgrep_messages,
  build_vision_first_turn_retry_hint,
};
use super::vision_consultative::{
  should_bypass_vision_first_turn, should_run_vision_anchor_pgrep,
};
use super::probe_guard::{is_ephemeral_probe_path, ProbeArtifactTracker};

pub async fn agent_run(
  request: AgentRunRequest,
  channel: Channel<Value>,
  cancel: Arc<AtomicBool>,
) -> Result<(), String> {
  emit(&channel, json!({ "type": "status", "data": { "phase": "starting", "model": request.model } }));

  let max_turns = request.max_turns.unwrap_or(12).min(40);
  let segment_budget = max_turns;
  let mut segment_max_turns = max_turns;
  let mut segment_index = 1u32;
  let mode = request.mode.as_deref().unwrap_or("build");
  let agent_mode = AgentMode::from_str(mode);

  let image_data_urls = request
    .image_data_urls
    .as_ref()
    .map(|urls| crate::agent::sanitize_image_data_urls(urls))
    .unwrap_or_default();
  let has_image = !image_data_urls.is_empty();

  let is_execute_plan = request.run_profile.as_ref().map_or(false, |p| p.is_execute_plan());
  let automated_bug_fix = request.run_profile.as_ref().map_or(false, |p| p.is_auto_bug_fix());
  let web_proxy_url = request.web_proxy_url.as_deref().map(str::trim).filter(|s| !s.is_empty());

  let user_intent = request
    .resolved_user_intent
    .as_ref()
    .map(|p| p.to_user_intent())
    .unwrap_or_else(|| policy::infer_user_intent_from_prompt(&request.prompt));

  let resolve_input = policy::ResolvePolicyInput {
    prompt: request.prompt.clone(),
    mode: agent_mode.clone(),
    user_intent: user_intent.clone(),
    has_image,
    is_execute_plan,
    is_plan_explore: mode == "plan",
    trigger_source: request.run_profile.as_ref().and_then(|p| p.trigger_source.clone()),
    history: request.history.clone(),
  };
  let run_policy = policy::resolve_run_policy(resolve_input);
  let effective_task_prompt = run_policy.effective_task_prompt.clone();
  let vision_locate_single_turn_run = should_bypass_vision_first_turn(
    image_data_urls.len(),
    run_policy.consultative_vision_run,
    &request.prompt,
  );

  let all_tools = tools::agent_tool_definitions();
  let read_set: std::collections::HashSet<&str> = tools::read_only_tool_names().iter().cloned().collect();
  let is_read_only_run = agent_mode.is_read_only() || run_policy.read_only_build_run;
  let mut active_tools: Value = if is_read_only_run {
    let filtered = all_tools.as_array().map(|a| {
      a.iter().filter(|t| {
        t["function"]["name"].as_str().map_or(false, |n| read_set.contains(n))
      }).cloned().collect::<Vec<_>>()
    }).unwrap_or_default();
    json!(filtered)
  } else { all_tools.clone() };

  let tool_names: String = active_tools.as_array().map(|a| {
    a.iter().filter_map(|t| t["function"]["name"].as_str()).collect::<Vec<&str>>().join("、")
  }).unwrap_or_default();

  let runtime_profile = runtime_hint::detect_project_runtime_profile(&request.project_path).await;
  let verify_script_available = !runtime_profile.verify_scripts.is_empty();

  let (system_prompt, context_blocks) = build_agent_system_prompt(SystemPromptBuildParams {
    request: &request,
    mode,
    tool_names: &tool_names,
    is_execute_plan,
    has_image,
    vision_locate_single_turn_run,
    user_intent: &user_intent,
    run_policy: &run_policy,
    effective_task_prompt: &effective_task_prompt,
    runtime_profile: &runtime_profile,
  })
  .await;

  let history_messages = context::build_history_messages(request.history.as_deref().unwrap_or(&[]));
  let user_content = crate::agent::build_vision_user_content(&request.prompt, &image_data_urls);
  let mut messages = vec![json!({ "role": "system", "content": system_prompt })];
  messages.extend(history_messages);
  messages.push(json!({ "role": "user", "content": user_content }));

  let startup_outcome = apply_run_startup_hints(&mut RunStartupHintsParams {
    messages: &mut messages,
    prompt: &request.prompt,
    mode,
    project_path: &request.project_path,
    history: request.history.as_deref(),
    is_execute_plan,
    is_plan_explore: mode == "plan",
    run_policy: &run_policy,
  });
  let mut ambiguous_term_clarification_pending = startup_outcome.ambiguous_term_clarification_pending;
  let mut ambiguous_term_clarification_terms = startup_outcome.ambiguous_term_clarification_terms;
  let mut ambiguous_term_clarification_retries: u32 = 0;

  emit(&channel, json!({
    "type": "agent_context", "data": {
      "mode": mode, "systemPrompt": "Rust agent backend",
      "history": context::history_for_display(request.history.as_deref().unwrap_or(&[])),
      "model": request.model,
      "maxTurns": max_turns,
      "openFile": context_blocks.open_file_rel.or(request.open_file_path.clone()),
      "hasImage": has_image
    }
  }));

  let mut written_files: Vec<String> = Vec::new();
  if let Some(prior) = &request.task_written_files {
    for path in prior {
      let norm = path.replace('\\', "/");
      if !written_files.contains(&norm) {
        written_files.push(norm);
      }
    }
  }
  let mut consecutive_read_turns: u32 = 0;
  let mut total_read_tool_calls: u32 = 0;
  let mut consultative_read_paths: Vec<String> = Vec::new();
  let mut consultative_read_failed_paths: Vec<String> = Vec::new();
  let mut consultative_grep_patterns: Vec<String> = Vec::new();
  let mut vision_locate_tools_used = false;
  let mut vision_locate_read_used = false;
  let mut vision_auto_grep_had_matches = false;
  let mut pregrep_unique_files: Vec<String> = Vec::new();
  let mut vision_consultative_locate_retries: u32 = 0;
  let mut consultative_force_answer_pending = run_policy.locate_status_follow_up_run;
  let mut agent_step_clarify_pending = run_policy.agent_step_clarify_run;
  let mut modification_audit_sent = false;
  let mut workspace_cleanup_nudge_sent = false;
  let mut probe_tracker = ProbeArtifactTracker::default();
  let mut accuracy_retries: u32 = 0;
  let mut behavior_purpose_retries: u32 = 0;
  let mut ui_behavior_retries: u32 = 0;
  let mut turn_cap_final_summary_attempts: u32 = 0;
  let mut empty_reply_retries: u32 = 0;
  let mut premature_completion_retries: u32 = 0;
  let mut patch_required_retries: u32 = 0;
  let mut patch_failure_completion_retries: u32 = 0;
  let mut manual_handoff_retries: u32 = 0;
  let mut patch_failure_log: Vec<PatchFailureEntry> = Vec::new();
  let mut consecutive_runtime_tool_failure_turns: u32 = 0;
  let mut last_consultative_explore_sig: Option<String> = None;
  let mut build_explore_force_patch_sent = false;
  let mut ui_defect_force_patch_sent = false;
  let mut patch_anchor_force_patch_nudge_sent = false;
  let mut patch_anchor_force_pending = false;
  let mut force_write_only_tools = false;
  let mut scheduled_job_registration_nudge_sent = false;
  let mut preflight_state = TurnPreflightState::new();
  let mut explore_files_read: std::collections::HashSet<String> = std::collections::HashSet::new();
  let is_plan_explore = mode == "plan";
  let plan_quote_informational_run =
    is_plan_explore && super::continuation::is_plan_quote_informational_prompt(&request.prompt);
  let is_plan_text_only_follow_up =
    run_policy.pending_plan_clarify_run || plan_quote_informational_run;
  let nudge_mode = if mode == "ask" || mode == "explore" || mode == "plan" {
    mode
  } else {
    "build"
  };
  let mut tool_guard = ToolGuardState::new(has_image, has_image);
  if vision_locate_single_turn_run {
    tool_guard.vision_locate_active = true;
  }
  let mut vision_first_turn_pending = has_image && !vision_locate_single_turn_run;
  let mut vision_first_turn_retries = 0u32;
  let mut vision_pregrep_done = false;
  let effective_read_only_build =
    run_policy.read_only_build_run || crate::agent::is_ui_state_behavior_question(&request.prompt);
  let mut actual_turns = 0u32;
  let run_started_at = std::time::Instant::now();

  loop {
    if actual_turns >= segment_max_turns {
      if actual_turns >= AGENT_SAFETY_MAX_TURNS {
        emit(&channel, json!({
          "type": "error",
          "data": { "message": format!("已达安全上限（{AGENT_SAFETY_MAX_TURNS} 轮），任务可能未完成。") }
        }));
        break;
      }

      let is_plan_explore = mode == "plan";
      let read_only_segment_cap = is_read_only_run || run_policy.read_only_build_run;

      if read_only_segment_cap || mode == "explore" || is_plan_explore {
        let explore_turns = total_read_tool_calls.max(crate::agent::EXPLORE_MAX_TOTAL_EXPLORE_SOFT);
        let cap_nudge = if mode == "explore" {
          crate::agent::build_explore_force_report_nudge(explore_turns)
        } else if is_plan_explore {
          crate::agent::build_plan_segment_cap_nudge(actual_turns, total_read_tool_calls)
        } else {
          crate::agent::build_consultative_segment_cap_nudge(actual_turns, total_read_tool_calls)
        };
        messages.push(json!({ "role": "system", "content": cap_nudge }));
        if mode == "ask" || run_policy.read_only_build_run {
          messages.push(json!({
            "role": "system",
            "content": crate::agent::build_ask_force_answer_nudge(explore_turns)
          }));
        }
        if is_plan_explore {
          messages.push(json!({
            "role": "system",
            "content": crate::agent::build_plan_force_answer_nudge(total_read_tool_calls)
          }));
        }
        segment_max_turns = actual_turns + 1;
        let phase = if mode == "explore" {
          "explore_segment_cap"
        } else if is_plan_explore {
          "plan_segment_cap"
        } else {
          "consultative_segment_cap"
        };
        emit(&channel, json!({
          "type": "status",
          "data": {
            "phase": phase,
            "turn": actual_turns,
            "maxTurns": segment_max_turns,
            "detail": if mode == "explore" {
              "探索轮数已达上限，请输出报告"
            } else if is_plan_explore {
              "规划轮数已达上限，请输出方案"
            } else {
              "咨询探索轮数已达上限，请直接作答"
            }
          }
        }));
      } else if turn_cap_final_summary_attempts < 2 {
        turn_cap_final_summary_attempts += 1;
        messages.push(json!({
          "role": "system",
          "content": crate::agent::build_turn_cap_final_summary_nudge(
            actual_turns,
            &written_files,
            turn_cap_final_summary_attempts,
          )
        }));
        segment_max_turns = actual_turns + 1;
        emit(&channel, json!({
          "type": "status",
          "data": {
            "phase": "turn_cap_final_summary",
            "turn": actual_turns,
            "maxTurns": segment_max_turns,
            "detail": if turn_cap_final_summary_attempts >= 2 {
              "已达最终总结轮，请输出总结"
            } else {
              "轮数即将用尽，请输出总结"
            }
          }
        }));
      } else if run_policy.disable_segment_auto_extend {
        emit(&channel, json!({
          "type": "error",
          "data": { "message": build_turn_cap_exhausted_message(actual_turns) }
        }));
        break;
      } else {
        segment_index += 1;
        segment_max_turns = extend_segment_max_turns(actual_turns, segment_budget);
        messages.push(json!({
          "role": "system",
          "content": build_segment_continue_nudge(actual_turns, segment_index, "build")
        }));
        emit(&channel, json!({
          "type": "status",
          "data": {
            "phase": "continuing",
            "turn": actual_turns,
            "maxTurns": segment_max_turns,
            "detail": format!("自动续跑第 {segment_index} 段（累计 {actual_turns} 轮）…")
          }
        }));
      }
    }

    actual_turns += 1;
    let turn = actual_turns;
    if run_policy.automated_bug_fix_run
      && run_started_at.elapsed().as_millis() as u128 > AUTO_BUG_FIX_WALL_CLOCK_MS
    {
      emit(&channel, json!({
        "type": "status",
        "data": { "phase": "finished", "turn": turn, "maxTurns": segment_max_turns }
      }));
      emit(&channel, json!({
        "type": "error",
        "data": { "message": "扫描修复已达时间上限（10 分钟），任务可能未完成。" }
      }));
      emit(&channel, json!({
        "type": "done", "data": {
          "writtenFiles": written_files, "pendingFiles": [], "turns": actual_turns
        }
      }));
      return Ok(());
    }
    if is_cancelled(&cancel) {
      if mode == "explore" && !preflight_state.explore_abort_grace_turn_active {
        preflight_state.explore_abort_grace_turn_active = true;
        segment_max_turns = segment_max_turns.max(turn + 1);
        emit(&channel, json!({
          "type": "status",
          "data": {
            "phase": "aborted",
            "turn": turn,
            "maxTurns": segment_max_turns,
            "model": request.model,
            "detail": "正在整理不完整知识库…"
          }
        }));
      } else {
        emit_aborted_done(&channel, &written_files, actual_turns.saturating_sub(1).max(1));
        return Ok(());
      }
    }

    let mut preflight_flags = TurnPreflightMut {
      ui_defect_force_patch_nudge_sent: ui_defect_force_patch_sent,
      build_explore_force_patch_nudge_sent: build_explore_force_patch_sent,
      patch_anchor_force_patch_nudge_sent: patch_anchor_force_patch_nudge_sent,
      patch_anchor_force_pending,
      force_write_only_tools,
      consultative_force_answer_pending,
    };
    let preflight_outcome = apply_turn_preflight(
      &mut TurnPreflightParams {
        messages: &mut messages,
        mode,
        prompt: &request.prompt,
        is_read_only_run,
        is_execute_plan,
        is_plan_explore,
        is_plan_text_only_follow_up,
        run_policy: &run_policy,
        total_read_tool_calls,
        written_files: &written_files,
        explore_files_read: &explore_files_read,
        tool_guard: &tool_guard,
        all_tools: &all_tools,
        read_set: &read_set,
        segment_max_turns,
        turn,
        vision_first_turn_pending,
        agent_step_clarify_pending,
        ambiguous_term_clarification_pending,
        nudge_mode,
      },
      &mut preflight_state,
      &mut preflight_flags,
    );
    ui_defect_force_patch_sent = preflight_flags.ui_defect_force_patch_nudge_sent;
    build_explore_force_patch_sent = preflight_flags.build_explore_force_patch_nudge_sent;
    patch_anchor_force_patch_nudge_sent = preflight_flags.patch_anchor_force_patch_nudge_sent;
    patch_anchor_force_pending = preflight_flags.patch_anchor_force_pending;
    force_write_only_tools = preflight_flags.force_write_only_tools;
    consultative_force_answer_pending = preflight_flags.consultative_force_answer_pending;
    active_tools = preflight_outcome.active_tools;

    if !is_read_only_run && mode != "explore" && mode != "plan" {
      if turn + 3 >= segment_max_turns && turn < segment_max_turns {
        let remaining = segment_max_turns.saturating_sub(turn);
        messages.push(json!({
          "role": "system",
          "content": crate::agent::build_segment_emergency_finish_nudge(remaining)
        }));
      }
    }

    emit(&channel, json!({
      "type": "status",
      "data": {
        "phase": if vision_first_turn_pending { "vision_first_turn" } else { "waiting_model" },
        "turn": turn,
        "maxTurns": segment_max_turns,
        "model": request.model
      }
    }));

    let compacted_messages =
      compact_messages_for_model(&messages, run_policy.max_context_chars);
    let context_chars = messages_char_size(&compacted_messages);
    emit(&channel, json!({
      "type": "status",
      "data": {
        "phase": "compacting_context",
        "turn": turn,
        "maxTurns": segment_max_turns,
        "model": request.model,
        "contextMessages": compacted_messages.len(),
        "contextChars": context_chars,
      }
    }));
    emit(&channel, json!({
      "type": "turn_request",
      "data": {
        "turn": turn,
        "maxTurns": segment_max_turns,
        "contextMessages": compacted_messages.len(),
        "contextChars": context_chars,
      }
    }));
    let body = json!({
      "model": request.model,
      "messages": compacted_messages,
      "tools": active_tools,
      "tool_choice": "auto",
      "stream": true
    });

    let stream_resp = ai::chat_completion_stream_with_retry(
      &request.endpoint,
      request.api_key.as_deref(),
      body,
      ai::AGENT_AI_MAX_RETRIES,
      context_chars,
      |attempt, max_attempts, error| {
        emit(&channel, json!({
          "type": "status",
          "data": {
            "phase": "retrying_model",
            "turn": turn,
            "maxTurns": segment_max_turns,
            "model": request.model,
            "retryAttempt": attempt,
            "retryMaxAttempts": max_attempts,
            "retryError": error,
          }
        }));
      },
      || is_cancelled(&cancel),
    )
    .await
    .map_err(|e| e.to_string())?;
    let Some(turn_output) = consume_model_sse_stream(
      stream_resp,
      &channel,
      &cancel,
      &written_files,
      actual_turns,
    )
    .await?
    else {
      return Ok(());
    };

    let assistant_text = turn_output.assistant_text;
    tool_guard.note_vision_assistant_text(&assistant_text);
    let tool_calls_value = turn_output.tool_calls_value;
    let tool_calls = turn_output.tool_calls;
    let is_final = turn_output.is_final;

    if !assistant_text.trim().is_empty() && is_final {
      emit(&channel, json!({ "type": "message", "data": { "text": assistant_text } }));
    }

    emit(&channel, json!({
      "type": "turn_response", "data": {
        "turn": turn, "maxTurns": segment_max_turns,
        "assistantText": assistant_text, "toolCalls": tool_calls,
        "hasToolCalls": !is_final, "isFinal": is_final
      }
    }));

    messages.push(json!({
      "role": "assistant",
      "content": assistant_text,
      "tool_calls": tool_calls_value
    }));

    if is_final
      && vision_locate_single_turn_run
      && run_policy.consultative_vision_run
      && !vision_locate_tools_used
      && !vision_pregrep_done
    {
      if tool_guard.vision_anchor_quotes.is_empty() {
        let quotes = crate::agent::vision::extract_visible_anchor_quotes(&assistant_text);
        if !quotes.is_empty() {
          tool_guard.vision_anchor_quotes = quotes;
          tool_guard.vision_narrative_text = Some(assistant_text.clone());
          tool_guard.vision_locate_active = true;
        }
      }
      if should_run_vision_anchor_pgrep(
        run_policy.consultative_vision_run,
        &request.prompt,
        &tool_guard.vision_anchor_quotes,
      ) && !tool_guard.vision_anchor_quotes.is_empty()
      {
        let pregrep_state = apply_vision_anchor_pgrep_messages(
          &mut messages,
          &request.project_path,
          &tool_guard.vision_anchor_quotes,
        )
        .await;
        vision_pregrep_done = pregrep_state.vision_pregrep_done;
        if pregrep_state.vision_locate_tools_used {
          vision_locate_tools_used = true;
        }
        if pregrep_state.vision_auto_grep_had_matches {
          vision_auto_grep_had_matches = true;
        }
        pregrep_unique_files = pregrep_state.unique_files;
        emit(&channel, json!({
          "type": "status",
          "data": {
            "phase": "vision_consultative_locate_single_turn",
            "turn": turn,
            "maxTurns": segment_max_turns,
            "detail": "单轮读图定位需要 grep 确认，已继续"
          }
        }));
        continue;
      }
    }

    if vision_first_turn_pending {
      if !tool_calls.is_empty() {
        vision_first_turn_pending = false;
      } else if !crate::agent::vision::is_adequate_vision_first_turn_description(&assistant_text) {
        vision_first_turn_retries += 1;
        if vision_first_turn_retries >= 2 {
          vision_first_turn_pending = false;
          messages.push(json!({
            "role": "system",
            "content": "首轮读图描述不充分，已跳过多轮读图重试，请直接根据已有信息继续。"
          }));
        } else {
          messages.push(json!({
            "role": "user",
            "content": build_vision_first_turn_retry_hint(vision_first_turn_retries)
          }));
          emit(&channel, json!({
            "type": "status",
            "data": { "phase": "vision_first_turn_retry", "turn": turn, "maxTurns": segment_max_turns }
          }));
          continue;
        }
      } else if !vision_pregrep_done && !tool_guard.vision_anchor_quotes.is_empty() {
        vision_first_turn_pending = false;
        let pregrep_state = apply_vision_anchor_pgrep_messages(
          &mut messages,
          &request.project_path,
          &tool_guard.vision_anchor_quotes,
        )
        .await;
        vision_pregrep_done = pregrep_state.vision_pregrep_done;
        if pregrep_state.vision_locate_tools_used {
          vision_locate_tools_used = true;
        }
        if pregrep_state.vision_auto_grep_had_matches {
          vision_auto_grep_had_matches = true;
        }
        pregrep_unique_files = pregrep_state.unique_files;
        emit(&channel, json!({
          "type": "status",
          "data": { "phase": "vision_anchor_prefgrep", "turn": turn, "maxTurns": segment_max_turns }
        }));
        continue;
      } else {
        vision_first_turn_pending = false;
      }
    }

    if is_final && agent_step_clarify_pending {
      agent_step_clarify_pending = false;
      if run_policy.ui_defect_build_run
        || tool_guard.patch_anchor_located
        || patch_anchor_force_pending
      {
        messages.push(json!({
          "role": "system",
          "content": intent_hints::build_agent_step_clarify_continue_hint()
        }));
        emit(&channel, json!({
          "type": "status",
          "data": {
            "phase": "clarify_continue",
            "turn": turn,
            "maxTurns": segment_max_turns,
            "detail": "步骤澄清后继续完成修改"
          }
        }));
      }
      continue;
    }

    if is_final && should_nudge_english_planning(&assistant_text) {
      messages.push(json!({
        "role": "user",
        "content": build_english_planning_nudge()
      }));
      continue;
    }

    if is_final {
      let mut finalize_mut = FinalizeTurnMut {
        consultative_force_answer_pending,
        vision_consultative_locate_retries,
        accuracy_retries,
        behavior_purpose_retries,
        ui_behavior_retries,
        modification_audit_sent,
        patch_required_retries,
        patch_failure_completion_retries,
        manual_handoff_retries,
        premature_completion_retries,
        empty_reply_retries,
        workspace_cleanup_nudge_sent,
        ambiguous_term_clarification_pending,
        ambiguous_term_clarification_retries,
      };
      let outcome = handle_final_turn(
        &mut FinalizeTurnParams {
          messages: &mut messages,
          assistant_text: &assistant_text,
          written_files: &written_files,
          tool_guard: &tool_guard,
          run_policy: &run_policy,
          mode,
          is_read_only_run,
          is_execute_plan,
          verify_script_available,
          task_prompt: if run_policy.quoted_amend_run {
            effective_task_prompt.as_str()
          } else {
            request.prompt.as_str()
          },
          target_files: request.run_profile.as_ref().and_then(|p| p.target_files.clone()),
          pregrep_unique_files: &pregrep_unique_files,
          consultative_read_paths: &consultative_read_paths,
          consultative_read_failed_paths: &consultative_read_failed_paths,
          consultative_grep_patterns: &consultative_grep_patterns,
          vision_locate_tools_used,
          vision_auto_grep_had_matches,
          vision_locate_read_used,
          effective_read_only_build,
          patch_failure_log: &patch_failure_log,
          probe_tracker: &probe_tracker,
          build_explore_force_patch_sent,
          patch_anchor_force_pending,
          turn,
          segment_max_turns,
          channel: &channel,
          ambiguous_term_clarification_pending,
          ambiguous_term_clarification_terms: &ambiguous_term_clarification_terms,
        },
        &mut finalize_mut,
      );
      consultative_force_answer_pending = finalize_mut.consultative_force_answer_pending;
      vision_consultative_locate_retries = finalize_mut.vision_consultative_locate_retries;
      accuracy_retries = finalize_mut.accuracy_retries;
      behavior_purpose_retries = finalize_mut.behavior_purpose_retries;
      ui_behavior_retries = finalize_mut.ui_behavior_retries;
      modification_audit_sent = finalize_mut.modification_audit_sent;
      patch_required_retries = finalize_mut.patch_required_retries;
      patch_failure_completion_retries = finalize_mut.patch_failure_completion_retries;
      manual_handoff_retries = finalize_mut.manual_handoff_retries;
      premature_completion_retries = finalize_mut.premature_completion_retries;
      empty_reply_retries = finalize_mut.empty_reply_retries;
      workspace_cleanup_nudge_sent = finalize_mut.workspace_cleanup_nudge_sent;
      ambiguous_term_clarification_pending = finalize_mut.ambiguous_term_clarification_pending;
      ambiguous_term_clarification_retries = finalize_mut.ambiguous_term_clarification_retries;
      match outcome {
        FinalizeTurnOutcome::Continue => continue,
        FinalizeTurnOutcome::Break => break,
      }
    }

    let mut turn_grep_empty_patterns: Vec<String> = Vec::new();
    let mut turn_read_failed_paths: Vec<String> = Vec::new();
    let mut turn_tool_outcomes: Vec<String> = Vec::new();
    let mut turn_had_only_read_tools = true;
    let mut turn_had_grep = false;
    let mut turn_patch_failures: Vec<PatchFailureEntry> = Vec::new();
    let mut tool_ctx = tool_exec::ToolExecContext {
      project_path: &request.project_path,
      mode,
      web_proxy_url,
      automated_bug_fix,
      written_files: &mut written_files,
      tool_guard: &mut tool_guard,
    };
    for call in tool_calls {
      if is_cancelled(&cancel) {
        emit_aborted_done(&channel, &written_files, actual_turns);
        return Ok(());
      }
      let id = call.get("id").and_then(|v| v.as_str()).unwrap_or("");
      let function = call.get("function").cloned().unwrap_or(json!({}));
      let name = function.get("name").and_then(|v| v.as_str()).unwrap_or("");
      let args_raw = function.get("arguments").and_then(|v| v.as_str()).unwrap_or("{}");
      let args: Value = serde_json::from_str(args_raw).unwrap_or(json!({}));

      emit(&channel, json!({ "type": "tool_start", "data": { "id": id, "name": name, "args": args } }));

      let (ok, result) = tool_exec::execute_tool(&mut tool_ctx, name, &args).await;
      if !is_tool_result_failure(&result) {
        tool_ctx.tool_guard.note_tool_output(&result);
      }
      turn_tool_outcomes.push(result.clone());
      if !is_read_only_run
        && mode != "plan"
        && !run_policy.read_only_build_run
        && ok
      {
        if let Some(path) = args.get("path").and_then(|v| v.as_str()) {
          if name == "write_file" && is_ephemeral_probe_path(path) {
            probe_tracker.track_write(path);
          } else if name == "delete_file" && is_ephemeral_probe_path(path) {
            probe_tracker.track_delete(path);
          }
        }
      }
      if name == "patch_file" && !ok {
        if let Some(path) = args.get("path").and_then(|v| v.as_str()) {
          let norm = path.replace('\\', "/");
          let entry = PatchFailureEntry {
            turn,
            path: norm.clone(),
            reason: result.clone(),
          };
          patch_failure_log.push(entry.clone());
          turn_patch_failures.push(entry);
        }
      } else if name == "grep" {
        turn_had_grep = true;
      }
      let is_write = tools::is_write_tool(name);
      if name == "read_file" {
        if let Some(path) = args.get("path").and_then(|v| v.as_str()) {
          let norm = path.replace('\\', "/");
          if ok {
            if !consultative_read_paths.contains(&norm) {
              consultative_read_paths.push(norm.clone());
            }
            explore_files_read.insert(norm);
            if has_image {
              vision_locate_tools_used = true;
            }
            if run_policy.consultative_vision_run && tool_ctx.tool_guard.vision_locate_active {
              vision_locate_read_used = true;
            }
          } else if !consultative_read_failed_paths.contains(&norm) {
            consultative_read_failed_paths.push(norm.clone());
            if !turn_read_failed_paths.contains(&norm) {
              turn_read_failed_paths.push(norm);
            }
          }
        }
      } else if name == "grep" {
        if ok && has_image {
          vision_locate_tools_used = true;
        }
        if ok && result.contains("（无匹配）") {
          if let Some(pattern) = args.get("pattern").or_else(|| args.get("q")).and_then(|v| v.as_str()) {
            let trimmed = pattern.trim();
            if !trimmed.is_empty() && !turn_grep_empty_patterns.iter().any(|p| p == trimmed) {
              turn_grep_empty_patterns.push(trimmed.to_string());
            }
          }
        }
        if let Some(pattern) = args.get("pattern").or_else(|| args.get("q")).and_then(|v| v.as_str()) {
          let trimmed = pattern.trim();
          if !trimmed.is_empty() && !consultative_grep_patterns.iter().any(|p| p == trimmed) {
            consultative_grep_patterns.push(trimmed.to_string());
          }
        }
      }
      if is_write {
        turn_had_only_read_tools = false;
      }

      let summary = if ok { crate::agent::tool_summary(name, &result) } else { "failed".to_string() };
      emit(&channel, json!({
        "type": "tool_end", "data": {
          "id": id, "name": name, "ok": ok,
          "summary": summary,
          "result": result.chars().take(4000).collect::<String>()
        }
      }));

      messages.push(json!({ "role": "tool", "tool_call_id": id, "content": result }));
    }

    let mut post_tool_mut = PostToolTurnMut {
      consecutive_runtime_tool_failure_turns,
      last_consultative_explore_sig,
      consecutive_read_turns,
      total_read_tool_calls,
      build_explore_force_patch_sent,
      patch_anchor_force_pending,
      force_write_only_tools,
      scheduled_job_registration_nudge_sent,
      consultative_force_answer_pending,
    };
    apply_post_tool_turn(
      &mut PostToolNudgeParams {
        messages: &mut messages,
        turn,
        turn_grep_empty_patterns: &turn_grep_empty_patterns,
        turn_read_failed_paths: &turn_read_failed_paths,
        turn_patch_failures: &turn_patch_failures,
        patch_failure_log: &patch_failure_log,
        effective_read_only_build,
        consultative_vision_run: run_policy.consultative_vision_run,
        turn_had_only_read_tools,
        turn_had_grep,
        tool_guard: &tool_guard,
        consultative_read_paths: &consultative_read_paths,
        turn_tool_outcomes: &turn_tool_outcomes,
        consultative_grep_patterns: &consultative_grep_patterns,
        is_read_only_run,
        written_files: &written_files,
        scheduled_task_consultative_run: run_policy.scheduled_task_consultative_run,
        mode,
        is_execute_plan,
        is_plan_explore,
        is_plan_text_only_follow_up,
        read_only_build_run: run_policy.read_only_build_run,
      },
      &mut post_tool_mut,
    );
    consecutive_runtime_tool_failure_turns = post_tool_mut.consecutive_runtime_tool_failure_turns;
    last_consultative_explore_sig = post_tool_mut.last_consultative_explore_sig;
    consecutive_read_turns = post_tool_mut.consecutive_read_turns;
    total_read_tool_calls = post_tool_mut.total_read_tool_calls;
    build_explore_force_patch_sent = post_tool_mut.build_explore_force_patch_sent;
    patch_anchor_force_pending = post_tool_mut.patch_anchor_force_pending;
    force_write_only_tools = post_tool_mut.force_write_only_tools;
    scheduled_job_registration_nudge_sent = post_tool_mut.scheduled_job_registration_nudge_sent;
    consultative_force_answer_pending = post_tool_mut.consultative_force_answer_pending;
  }

  emit(&channel, json!({
    "type": "done", "data": {
      "writtenFiles": written_files, "pendingFiles": [], "turns": actual_turns
    }
  }));
  Ok(())
}
