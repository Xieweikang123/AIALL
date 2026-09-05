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
    #[serde(default)]
    pub needs_clarification: bool,
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
            needs_clarification: self.needs_clarification,
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
    #[serde(default)]
    pub(crate) debug: bool,
}

impl AgentRunRequest {
    pub fn project_path(&self) -> &str {
        &self.project_path
    }

    /// 日志用：最终生效的模型（key 永不入日志）。
    pub fn effective_endpoint(&self) -> &str {
        &self.endpoint
    }

    pub fn effective_model(&self) -> &str {
        &self.model
    }

    /// 服务端模式：服务端配置是唯一真相源（agent-server）。
    /// 有服务端配置时 endpoint / apiKey / model / webProxyUrl 全部以服务端为准；
    /// 浏览器传来的同名字段只作展示，不参与请求。未配置服务端 AI 时保持请求原值（多为本地桌面直跑）。
    pub fn apply_server_ai(
        &mut self,
        endpoint: &str,
        api_key: Option<&str>,
        model: &str,
        web_proxy_url: Option<&str>,
    ) {
        let has_server_endpoint = !endpoint.trim().is_empty();
        let has_server_model = !model.trim().is_empty();
        let has_server_key = api_key.map(|k| !k.trim().is_empty()).unwrap_or(false);
        // 服务端至少要有 endpoint + key 才算配置完整，避免只配了一半时把请求改坏。
        if !(has_server_endpoint && has_server_key) {
            return;
        }
        if has_server_endpoint {
            self.endpoint = endpoint.trim().to_string();
        }
        if let Some(k) = api_key {
            self.api_key = Some(k.trim().to_string());
        }
        if has_server_model {
            self.model = model.trim().to_string();
        }
        if self.web_proxy_url.is_none() && web_proxy_url.filter(|p| !p.trim().is_empty()).is_some() {
            self.web_proxy_url = web_proxy_url.map(|p| p.trim().to_string());
        }
    }

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
            debug: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::run_types::*;
    use super::AgentRunProfile;

    fn request_with(endpoint: &str, api_key: Option<&str>, model: &str) -> AgentRunRequest {
        serde_json::from_value(serde_json::json!({
            "prompt": "hi",
            "projectPath": "/tmp/p",
            "endpoint": endpoint,
            "apiKey": api_key,
            "model": model,
        }))
        .unwrap()
    }

    #[test]
    fn apply_server_ai_overrides_browser_values_when_server_config_complete() {
        // 浏览器带了 Ollama 的 endpoint/model 但没带 key：服务端配置是唯一真相源，整体覆盖
        let mut req = request_with("http://localhost:11434/v1", None, "qwen2.5-coder:7b");
        req.apply_server_ai("https://ai.example/v1", Some("sk-server"), "gpt-4o", None);
        assert_eq!(req.effective_endpoint(), "https://ai.example/v1");
        assert_eq!(req.effective_model(), "gpt-4o");
        assert_eq!(req.api_key.as_deref(), Some("sk-server"));
    }

    #[test]
    fn apply_server_ai_noop_when_server_config_incomplete() {
        // 服务端只配了 endpoint 没 key（半配置）：不动请求，避免把请求改坏
        let mut req = request_with("http://localhost:11434/v1", None, "qwen2.5-coder:7b");
        req.apply_server_ai("https://ai.example/v1", None, "gpt-4o", None);
        assert_eq!(req.effective_endpoint(), "http://localhost:11434/v1");
        assert_eq!(req.effective_model(), "qwen2.5-coder:7b");
        assert!(req.api_key.is_none());

        // 只有 key 没 endpoint 同样不注入
        let mut req = request_with("http://localhost:11434/v1", None, "qwen2.5-coder:7b");
        req.apply_server_ai("", Some("sk-server"), "gpt-4o", None);
        assert_eq!(req.effective_endpoint(), "http://localhost:11434/v1");
    }

    #[test]
    fn apply_server_ai_keeps_request_when_no_server_config() {
        let mut req = request_with("http://localhost:11434/v1", Some("sk-local"), "qwen2.5-coder:7b");
        req.apply_server_ai("", None, "", None);
        assert_eq!(req.effective_endpoint(), "http://localhost:11434/v1");
        assert_eq!(req.api_key.as_deref(), Some("sk-local"));
    }

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
