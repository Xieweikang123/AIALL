use super::context::{self, ContextBlocks};
use super::exploration::{
  build_automated_bug_fix_hint, AUTO_BUG_FIX_LOGIC_REVIEW_MARKER,
};
use super::intent_hints;
use super::policy::{AgentRunPolicy, UserIntent};
use super::prompts;
use super::runtime_hint::{self, ProjectRuntimeProfile};
use super::run_types::AgentRunRequest;
use super::vision_consultative::is_ui_appearance_question_prompt;

pub struct SystemPromptBuildParams<'a> {
  pub request: &'a AgentRunRequest,
  pub mode: &'a str,
  pub tool_names: &'a str,
  pub is_execute_plan: bool,
  pub has_image: bool,
  pub vision_locate_single_turn_run: bool,
  pub user_intent: &'a UserIntent,
  pub run_policy: &'a AgentRunPolicy,
  pub effective_task_prompt: &'a str,
  pub runtime_profile: &'a ProjectRuntimeProfile,
}

pub async fn build_agent_system_prompt(
  params: SystemPromptBuildParams<'_>,
) -> (String, ContextBlocks) {
  let explore_incremental = if params.mode == "explore" {
    context::resolve_explore_uses_manifest(
      &params.request.project_path,
      params.effective_task_prompt,
    )
    .await
  } else {
    false
  };

  let mut system_prompt = format!("项目根：{}\n", params.request.project_path);
  system_prompt.push_str(&format!("模式：{}\n", params.mode));
  system_prompt.push_str(&format!("可用工具：{}\n", params.tool_names));
  system_prompt.push_str(&format!(
    "{}\n",
    crate::agent::build_model_identity_hint(&params.request.model)
  ));

  if params.mode == "explore" {
    for line in prompts::build_explore_system_prompt_lines(explore_incremental) {
      system_prompt.push_str(&line);
      system_prompt.push('\n');
    }
  } else {
    let prompt_lines: Vec<&str> = match params.mode {
      "ask" => prompts::build_ask_system_prompt_lines(),
      "plan" => prompts::build_plan_system_prompt_lines(),
      _ => prompts::build_build_system_prompt_lines(),
    };
    for line in &prompt_lines {
      system_prompt.push_str(line);
      system_prompt.push('\n');
    }
  }

  if params.has_image {
    append_vision_system_hints(&mut system_prompt, &params);
  }

  let inject_consultative_topics =
    params.mode == "ask" || (params.mode == "build" && !params.is_execute_plan);
  if inject_consultative_topics {
    system_prompt.push_str(&super::consultative_topics::build_consultative_topic_hints(
      params.effective_task_prompt,
      params.request.history.as_deref(),
      params.user_intent,
      params.run_policy,
    ));
  }
  if params.mode == "build" && !params.is_execute_plan && params.run_policy.read_only_build_run {
    system_prompt.push_str(super::consultative_topics::build_consultative_build_hint());
    system_prompt.push('\n');
  }
  if params.run_policy.consultative_resume_run {
    system_prompt.push_str(&super::consultative_topics::build_consultative_resume_hint(
      params.run_policy.behavior_purpose_run,
    ));
    system_prompt.push('\n');
  }

  if params.mode == "build" && !params.is_execute_plan {
    system_prompt.push_str(&intent_hints::build_interactive_build_hints(
      params.run_policy,
      params.run_policy.user_recently_reported_failure,
      params.request.history.as_deref(),
    ));
  }
  if params.mode == "plan" && params.run_policy.pending_plan_clarify_run {
    system_prompt.push_str(intent_hints::build_pending_plan_clarification_hint());
    system_prompt.push('\n');
  }
  if params.mode == "plan" && params.run_policy.pending_plan_amend_run {
    system_prompt.push_str(&intent_hints::build_pending_plan_amend_hint(None));
    system_prompt.push('\n');
  }

  let mut open_file_rel = None;
  if !params.run_policy.consultative_ui_appearance_run {
    if let Some(open_path) = params
      .request
      .open_file_path
      .as_deref()
      .filter(|p| !p.trim().is_empty())
    {
      if let Some((relative, block)) =
        context::build_open_file_prompt_block(&params.request.project_path, open_path).await
      {
        open_file_rel = Some(relative);
        system_prompt.push_str(&block);
      }
    }
  }

  let mut context_blocks = context::build_context_blocks(context::ContextBuildInput {
    project_path: &params.request.project_path,
    task_context: Some(params.effective_task_prompt),
    mode: params.mode,
    is_plan_explore: params.mode == "plan",
    is_execute_plan: params.is_execute_plan,
    consultative_ui_appearance_run: params.run_policy.consultative_ui_appearance_run,
    target_files: params
      .request
      .run_profile
      .as_ref()
      .and_then(|p| p.target_files.as_deref()),
  })
  .await;
  context_blocks.open_file_rel = open_file_rel;
  system_prompt.push_str(&context_blocks.system_suffix);

  let runtime_hint_text = runtime_hint::build_runtime_awareness_hint(params.runtime_profile);
  let shell_hint = runtime_hint::build_shell_awareness_hint();
  if !runtime_hint_text.is_empty() {
    system_prompt.push_str(&format!("\n{runtime_hint_text}"));
  }
  if !shell_hint.is_empty() {
    system_prompt.push_str(&format!("\n{shell_hint}"));
  }

  if params.run_policy.automated_bug_fix_run {
    let verify_script = if params.runtime_profile.verify_scripts.is_empty() {
      params.runtime_profile.verify_script.as_deref()
    } else {
      None
    };
    let verify_joined = if params.runtime_profile.verify_scripts.is_empty() {
      None
    } else {
      Some(params.runtime_profile.verify_scripts.join("; "))
    };
    let include_logic_review = params
      .request
      .prompt
      .contains(AUTO_BUG_FIX_LOGIC_REVIEW_MARKER);
    system_prompt.push_str(&build_automated_bug_fix_hint(
      verify_script.or(verify_joined.as_deref()),
      include_logic_review,
    ));
    system_prompt.push('\n');
  }

  (system_prompt, context_blocks)
}

fn append_vision_system_hints(system_prompt: &mut String, params: &SystemPromptBuildParams<'_>) {
  system_prompt.push_str(crate::agent::build_vision_first_turn_rule());
  system_prompt.push('\n');
  system_prompt.push_str(crate::agent::build_vision_grep_anchor_hint());
  system_prompt.push('\n');
  if crate::agent::UI_CLICK_FOCUS_INTERACTION_RE.is_match(&params.request.prompt) {
    system_prompt.push_str(crate::agent::build_click_focus_interaction_hint());
    system_prompt.push('\n');
  }
  if crate::agent::is_ui_positioning_bug_prompt(&params.request.prompt) {
    system_prompt.push_str(crate::agent::build_floating_control_positioning_hint());
    system_prompt.push('\n');
  } else if crate::agent::has_ui_image_keywords(&params.request.prompt) {
    system_prompt.push_str(crate::agent::build_vision_ui_locate_hint());
    system_prompt.push('\n');
  }
  if params.mode == "build" {
    system_prompt.push_str(crate::agent::build_vision_build_continue_hint());
    system_prompt.push('\n');
  }
  if crate::agent::mentions_control_proportion_imbalance(&params.request.prompt) {
    system_prompt.push_str(crate::agent::build_consultative_ui_appearance_hint());
    system_prompt.push('\n');
  }
  if params.vision_locate_single_turn_run
    && is_ui_appearance_question_prompt(&params.request.prompt)
  {
    system_prompt.push_str(crate::agent::build_consultative_ui_appearance_hint());
    system_prompt.push('\n');
  }
}
