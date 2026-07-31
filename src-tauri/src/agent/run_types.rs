use serde::Deserialize;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedUserIntentPayload {
    pub primary: Option<String>,
    pub consultative: bool,
    pub consultative_topic: Option<String>,
    pub implement_follow_up: bool,
    pub ui_defect: bool,
    pub code_review: bool,
    pub behavior_contradiction: bool,
    pub behavior_purpose: bool,
    pub accuracy_question: bool,
    pub agent_step_clarification: bool,
    pub user_error_quote: bool,
    pub ui_appearance: bool,
    pub ultra_short_open_task: bool,
    pub locate_status_follow_up: bool,
    pub pending_plan_amend: bool,
    pub pending_plan_clarify: bool,
}

impl ResolvedUserIntentPayload {
    pub fn to_user_intent(&self) -> super::policy::UserIntent {
        super::policy::UserIntent {
            implement_follow_up: self.implement_follow_up,
            code_review: self.code_review,
            user_error_quote: self.user_error_quote,
            consultative: self.consultative,
            consultative_topic: self.consultative_topic.clone(),
            behavior_contradiction: self.behavior_contradiction,
            behavior_purpose: self.behavior_purpose,
            locate_status_follow_up: self.locate_status_follow_up,
            accuracy_question: self.accuracy_question,
            ui_appearance: self.ui_appearance,
            ui_defect: self.ui_defect,
            agent_step_clarification: self.agent_step_clarification,
            ultra_short_open_task: self.ultra_short_open_task,
            pending_plan_amend: self.pending_plan_amend,
            pending_plan_clarify: self.pending_plan_clarify,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunProfile {
    pub(crate) kind: Option<String>,
    pub(crate) target_files: Option<Vec<String>>,
    pub(crate) user_intent: Option<String>,
    pub(crate) trigger_source: Option<String>,
}

impl AgentRunProfile {
    pub fn is_execute_plan(&self) -> bool {
        self.kind.as_deref() == Some("execute_plan")
            || self.trigger_source.as_deref() == Some("execute_plan")
    }

    pub fn is_auto_bug_fix(&self) -> bool {
        self.trigger_source.as_deref() == Some("auto_bug_fix")
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunRequest {
    pub(crate) prompt: String,
    pub(crate) history: Option<Vec<super::context::HistoryMessage>>,
    pub(crate) project_path: String,
    pub(crate) endpoint: String,
    pub(crate) api_key: Option<String>,
    pub(crate) model: String,
    pub(crate) mode: Option<String>,
    pub(crate) max_turns: Option<u32>,
    pub(crate) open_file_path: Option<String>,
    pub(crate) image_data_urls: Option<Vec<String>>,
    pub(crate) task_written_files: Option<Vec<String>>,
    pub(crate) web_proxy_url: Option<String>,
    pub(crate) run_profile: Option<AgentRunProfile>,
    pub(crate) resolved_user_intent: Option<ResolvedUserIntentPayload>,
}

impl AgentRunRequest {
    /// Headless / CLI smoke entry — no UI history or run profile.
    pub fn for_smoke(
        project_path: String,
        prompt: String,
        endpoint: String,
        api_key: Option<String>,
        model: String,
        mode: Option<String>,
        max_turns: Option<u32>,
        image_data_urls: Option<Vec<String>>,
    ) -> Self {
        Self {
            prompt,
            history: None,
            project_path,
            endpoint,
            api_key,
            model,
            mode,
            max_turns,
            open_file_path: None,
            image_data_urls,
            task_written_files: None,
            web_proxy_url: None,
            run_profile: None,
            resolved_user_intent: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::AgentRunProfile;

    #[test]
    fn execute_plan_detects_kind_and_trigger_source() {
        let by_kind = AgentRunProfile {
            kind: Some("execute_plan".into()),
            target_files: None,
            user_intent: None,
            trigger_source: None,
        };
        assert!(by_kind.is_execute_plan());

        let by_trigger = AgentRunProfile {
            kind: Some("interactive".into()),
            target_files: None,
            user_intent: None,
            trigger_source: Some("execute_plan".into()),
        };
        assert!(by_trigger.is_execute_plan());

        let auto_bug_fix = AgentRunProfile {
            kind: Some("execute_plan".into()),
            target_files: None,
            user_intent: None,
            trigger_source: Some("auto_bug_fix".into()),
        };
        assert!(auto_bug_fix.is_execute_plan());
        assert!(auto_bug_fix.is_auto_bug_fix());
    }
}
