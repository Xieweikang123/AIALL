use serde_json::{json, Value};
use std::path::Path;

use super::ambiguous_term::{resolve_ambiguous_clarification_terms, ResolveAmbiguousInput};
use super::context::HistoryMessage;
use super::continuation::{
    extract_plan_file_paths, is_plan_quote_informational_prompt, is_plan_quote_revision_prompt,
    resolve_pending_plan_state, strip_quoted_reply_prefix,
};
use super::exploration::{
    build_ambiguous_term_clarification_hint, build_plan_no_target_path_hint,
    build_plan_quote_informational_hint, build_plan_revision_follow_up_hint,
};
use super::explore_prompt::{
    build_explore_changes_nudge, build_explore_continue_nudge, build_explore_follow_up_hint,
    build_explore_quoted_follow_up_hint, build_explore_section_fill_nudge,
};
use super::knowledge_explore::{
    classify_explore_knowledge_intent, is_explore_changes_prompt, is_explore_continue_prompt,
    is_explore_section_fill_prompt, is_knowledge_quote_follow_up_prompt, ExploreKnowledgeIntent,
};
use super::policy::AgentRunPolicy;

const PROJECT_KNOWLEDGE_REL: &str = ".aiall/project-knowledge.md";

pub struct RunStartupHintsOutcome {
    pub ambiguous_term_clarification_pending: bool,
    pub ambiguous_term_clarification_terms: Vec<String>,
}

pub struct RunStartupHintsParams<'a> {
    pub messages: &'a mut Vec<Value>,
    pub prompt: &'a str,
    pub mode: &'a str,
    pub project_path: &'a str,
    pub history: Option<&'a [HistoryMessage]>,
    pub is_execute_plan: bool,
    pub is_plan_explore: bool,
    pub run_policy: &'a AgentRunPolicy,
}

fn has_existing_knowledge_body(project_path: &str) -> bool {
    let path = Path::new(project_path).join(PROJECT_KNOWLEDGE_REL);
    path.is_file()
        && std::fs::read_to_string(&path)
            .map(|body| !body.trim().is_empty())
            .unwrap_or(false)
}

pub fn apply_run_startup_hints(params: &mut RunStartupHintsParams<'_>) -> RunStartupHintsOutcome {
    let ambiguous_terms = resolve_ambiguous_clarification_terms(ResolveAmbiguousInput {
        prompt: params.prompt,
        history: params.history,
        project_path: params.project_path,
        mode: params.mode,
        is_execute_plan: params.is_execute_plan,
        is_plan_explore: params.is_plan_explore,
        read_only_build_run: params.run_policy.read_only_build_run,
    });

    if !ambiguous_terms.is_empty() {
        params.messages.push(json!({
          "role": "system",
          "content": build_ambiguous_term_clarification_hint(&ambiguous_terms)
        }));
        return RunStartupHintsOutcome {
            ambiguous_term_clarification_pending: true,
            ambiguous_term_clarification_terms: ambiguous_terms,
        };
    }

    if params.mode == "explore" {
        if is_explore_continue_prompt(params.prompt) {
            params.messages.push(json!({
              "role": "system",
              "content": build_explore_continue_nudge()
            }));
        } else if is_explore_section_fill_prompt(params.prompt) {
            params.messages.push(json!({
              "role": "system",
              "content": build_explore_section_fill_nudge()
            }));
        } else if is_explore_changes_prompt(params.prompt) {
            params.messages.push(json!({
              "role": "system",
              "content": build_explore_changes_nudge()
            }));
        } else {
            let has_body = has_existing_knowledge_body(params.project_path);
            let intent = classify_explore_knowledge_intent(params.prompt, has_body);
            if intent == ExploreKnowledgeIntent::Followup {
                let hint = if is_knowledge_quote_follow_up_prompt(params.prompt) {
                    build_explore_quoted_follow_up_hint()
                } else {
                    build_explore_follow_up_hint()
                };
                params
                    .messages
                    .push(json!({ "role": "system", "content": hint }));
            }
        }
    } else if params.is_plan_explore && params.run_policy.pending_plan_clarify_run {
        // Hint already in system prompt via run_system_prompt.rs
    } else if params.is_plan_explore && params.run_policy.pending_plan_amend_run {
        // Hint already in system prompt via run_system_prompt.rs
    } else if params.is_plan_explore && is_plan_quote_informational_prompt(params.prompt) {
        params.messages.push(json!({
          "role": "system",
          "content": build_plan_quote_informational_hint()
        }));
    } else if params.is_plan_explore && is_plan_quote_revision_prompt(params.prompt) {
        params.messages.push(json!({
          "role": "system",
          "content": build_plan_revision_follow_up_hint()
        }));
    } else if params.is_plan_explore
        && extract_plan_file_paths(&strip_quoted_reply_prefix(params.prompt)).is_empty()
        && !resolve_pending_plan_state(params.history).has_pending_plan
    {
        params.messages.push(json!({
          "role": "system",
          "content": build_plan_no_target_path_hint()
        }));
    }

    RunStartupHintsOutcome {
        ambiguous_term_clarification_pending: false,
        ambiguous_term_clarification_terms: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_quote_informational_injects_hint() {
        let mut messages = Vec::new();
        let outcome = apply_run_startup_hints(&mut RunStartupHintsParams {
            messages: &mut messages,
            prompt: "> 方案: x\n日志写到哪里？",
            mode: "plan",
            project_path: ".",
            history: None,
            is_execute_plan: false,
            is_plan_explore: true,
            run_policy: &AgentRunPolicy::default(),
        });
        assert!(!outcome.ambiguous_term_clarification_pending);
        assert_eq!(messages.len(), 1);
        assert!(messages[0]["content"]
            .as_str()
            .unwrap_or("")
            .contains("方案答疑"));
    }

    #[test]
    fn explore_continue_injects_nudge() {
        let mut messages = Vec::new();
        apply_run_startup_hints(&mut RunStartupHintsParams {
            messages: &mut messages,
            prompt: "请继续探索项目中尚未覆盖的部分",
            mode: "explore",
            project_path: ".",
            history: None,
            is_execute_plan: false,
            is_plan_explore: false,
            run_policy: &AgentRunPolicy::default(),
        });
        assert!(messages[0]["content"]
            .as_str()
            .unwrap_or("")
            .contains("继续探索"));
    }
}
