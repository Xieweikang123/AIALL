pub use super::context_limits::{
    ASK_MAX_CONTEXT_CHARS, CONSULTATIVE_UI_APPEARANCE_MAX_CONTEXT_CHARS,
    EXECUTE_PLAN_MAX_CONTEXT_CHARS, MAX_AGENT_CONTEXT_CHARS, PLAN_MAX_CONTEXT_CHARS,
};

pub const MAX_TOTAL_EXPLORE_TURNS: u32 = 30;
pub const MAX_TOTAL_EXPLORE_TURNS_SOFT: u32 = 25;
pub const SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE: u32 = 20;
pub const SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE_SOFT: u32 = 15;
pub const AUTO_BUG_FIX_EXPLORE_HARD_CAP: u32 = 6;

#[derive(Debug, Clone, Default)]
pub struct AgentRunPolicy {
    pub implement_follow_up_run: bool,
    pub same_issue_follow_up_run: bool,
    pub code_review_run: bool,
    pub user_error_quote_run: bool,
    pub user_failure_report_run: bool,
    pub session_audit_run: bool,
    pub behavior_contradiction_run: bool,
    pub consultative_resume_run: bool,
    pub locate_status_follow_up_run: bool,
    pub read_only_build_run: bool,
    pub behavior_purpose_run: bool,
    pub accuracy_consultative_run: bool,
    pub consultative_vision_run: bool,
    pub consultative_ui_appearance_run: bool,
    pub ui_defect_build_run: bool,
    pub agent_step_clarify_run: bool,
    pub ultra_short_open_task_run: bool,
    pub pending_plan_amend_run: bool,
    pub pending_plan_clarify_run: bool,
    pub needs_clarification_run: bool,
    pub quoted_amend_run: bool,
    pub quoted_amend_intent: Option<super::quoted_amend::QuotedAmendIntent>,
    pub effective_task_prompt: String,
    pub automated_bug_fix_run: bool,
    pub disable_segment_auto_extend: bool,
    pub explore_hard_cap: u32,
    pub explore_soft_cap: u32,
    pub max_context_chars: usize,
    pub user_recently_reported_failure: bool,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub enum AgentMode {
    #[default]
    Ask,
    Build,
    Plan,
    Explore,
    Auto,
}

impl AgentMode {
    pub fn from_str(s: &str) -> Self {
        match s {
            "ask" => AgentMode::Ask,
            "plan" => AgentMode::Plan,
            "explore" => AgentMode::Explore,
            "auto" => AgentMode::Auto,
            _ => AgentMode::Build,
        }
    }

    pub fn is_read_only(&self) -> bool {
        matches!(self, AgentMode::Ask | AgentMode::Explore)
    }
}

#[derive(Debug, Clone, Default)]
pub struct UserIntent {
    pub implement_follow_up: bool,
    pub code_review: bool,
    pub user_error_quote: bool,
    pub consultative: bool,
    pub consultative_topic: Option<String>,
    pub behavior_contradiction: bool,
    pub behavior_purpose: bool,
    pub locate_status_follow_up: bool,
    pub accuracy_question: bool,
    pub ui_appearance: bool,
    pub ui_defect: bool,
    pub agent_step_clarification: bool,
    pub ultra_short_open_task: bool,
    pub pending_plan_amend: bool,
    pub pending_plan_clarify: bool,
    pub needs_clarification: bool,
}

#[derive(Debug, Clone, Default)]
pub struct ResolvePolicyInput {
    pub prompt: String,
    pub mode: AgentMode,
    pub user_intent: UserIntent,
    pub has_image: bool,
    pub is_execute_plan: bool,
    pub is_plan_explore: bool,
    pub trigger_source: Option<String>,
    pub history: Option<Vec<super::context::HistoryMessage>>,
}

static IMPLEMENT_INTENT_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    regex::Regex::new(
    r"(?i)(?:帮我|请|麻烦)?(?:改|修|修复|实现|添加|新增|删除|创建|优化|调整|更新|写入|落地|开发|执行|替换|重构|改成|改为|改一下|改下|写一[个份]?|做一[个份]?|fix|implement|add\b|create\b|update\b|refactor\b)",
  )
  .unwrap()
});

pub fn prompt_has_implement_intent_without_question(text: &str) -> bool {
    let has_question = text.contains('?') || text.contains('？');
    IMPLEMENT_INTENT_RE.is_match(text) && !has_question
}

static USER_FAILURE_REPORT_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    regex::Regex::new(
      r"试了.{0,20}(?:没有|没|不|无效)|并没有|没效果|没有效果|没生效|不生效|未生效|没变化|不起作用|仍然(?:没有|没|不)|还是(?:没有|没|不|不(?:显示|可见|出来))|明明(?:没有|没|不)|看不到|看不见|电脑没|系统没|实际没|并未",
    )
    .unwrap()
});

static IMPLEMENTATION_FAILURE_REPORT_RE: std::sync::LazyLock<regex::Regex> =
    std::sync::LazyLock::new(|| {
        regex::Regex::new(
      r"没生效|不生效|未生效|没效果|没有效果|没变化|不起作用|试了.{0,16}(?:没有|没|不|无效)|仍然(?:没有|没|不)|还是(?:没有|没|不)|明明(?:没有|没|不)",
    )
    .unwrap()
    });

static PRIOR_FIX_CLAIM_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    regex::Regex::new(
      r"(?:✅|修复完成|修改已完成|已完成修复|问题已修复|已修复|已改完|应该(?:可以|没问题|能看到)了|(?:现在|已).{0,8}(?:可见|清晰|能看))|刷新(?:应用|页面)?(?:后|看看)",
    )
    .unwrap()
});

static SAME_ISSUE_FOLLOW_UP_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(
    || {
        regex::Regex::new(
      r"(?:还有|仍(?:然)?有|依然).{0,8}问题|发现.{0,12}问题|问题.{0,8}(?:没|吗)[？?]?|还是有问题|没(?:解决|修好)|(?:排查|检查).{0,8}(?:下|一下)",
    )
    .unwrap()
    },
);

pub fn detect_user_failure_report(text: &str) -> bool {
    USER_FAILURE_REPORT_RE.is_match(text.trim())
}

fn history_recent_user_failure_report(
    history: Option<&[super::context::HistoryMessage]>,
    max_user_turns: usize,
) -> bool {
    let Some(history) = history else {
        return false;
    };
    history
        .iter()
        .filter(|m| m.role == "user")
        .rev()
        .take(max_user_turns)
        .any(|m| detect_user_failure_report(&m.content))
}

fn history_prior_assistant_claimed_fix(history: Option<&[super::context::HistoryMessage]>) -> bool {
    let Some(history) = history else {
        return false;
    };
    history
        .iter()
        .filter(|m| m.role == "assistant")
        .rev()
        .take(2)
        .any(|m| PRIOR_FIX_CLAIM_RE.is_match(&m.content))
}

pub fn is_same_issue_follow_up_run(
    prompt: &str,
    history: Option<&[super::context::HistoryMessage]>,
    behavior_contradiction: bool,
) -> bool {
    let text = prompt.trim();
    if text.is_empty() || !history_prior_assistant_claimed_fix(history) {
        return false;
    }
    if SAME_ISSUE_FOLLOW_UP_RE.is_match(text) {
        return true;
    }
    if IMPLEMENTATION_FAILURE_REPORT_RE.is_match(text) {
        return true;
    }
    behavior_contradiction
}

fn resolve_original_task_from_resume_prompt(prompt: &str) -> Option<String> {
    const MARKER: &str = "原始任务（摘要）：";
    let idx = prompt.find(MARKER)?;
    let rest = prompt[idx + MARKER.len()..].trim();
    if rest.is_empty() {
        None
    } else {
        Some(rest.to_string())
    }
}

pub fn history_suggests_quote_position_fix(
    history: Option<&[super::context::HistoryMessage]>,
) -> bool {
    let text: String = history
        .unwrap_or(&[])
        .iter()
        .rev()
        .take(6)
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");
    if text.trim().is_empty() {
        return false;
    }
    static POSITION_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"定位|坐标|位置|浮层|fixed|absolute|Teleport|锚点|偏移").unwrap()
    });
    static CONCLUSION_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"根因|原因|问题在于|分析|诊断|排查").unwrap()
    });
    static FIX_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"修复方案|修改方案|建议|patch|改法").unwrap()
    });
    POSITION_RE.is_match(&text) && (CONCLUSION_RE.is_match(&text) || FIX_RE.is_match(&text))
}

/// Lightweight prompt heuristics when frontend does not pass resolvedUserIntent.
pub fn infer_user_intent_from_prompt(prompt: &str) -> UserIntent {
    let text = prompt.trim();
    if text.is_empty() {
        return UserIntent::default();
    }

    let has_question = text.contains('?')
        || text.contains('？')
        || text.contains("会不会")
        || text.contains("是不是")
        || text.contains("是否会")
        || text.contains("吗")
        || text.contains("么");
    let has_implement = IMPLEMENT_INTENT_RE.is_match(text) && !has_question;

    UserIntent {
        consultative: has_question && !has_implement,
        behavior_purpose: text.contains("有什么用")
            || text.contains("做什么用")
            || text.contains("用途")
            || text.contains("作用")
            || text.contains("干什么"),
        accuracy_question: (text.contains("准确")
            || text.contains("会不会发生")
            || text.contains("是否会")
            || text.contains("是不是会"))
            && has_question,
        ..Default::default()
    }
}

/// Resolve Auto mode to a concrete mode based on prompt intent heuristics.
/// Returns (resolved_mode, was_auto).
pub fn resolve_auto_mode(
    prompt: &str,
    resolved_user_intent: Option<&super::run_types::ResolvedUserIntentPayload>,
) -> (AgentMode, bool) {
    let text = prompt.trim();
    if text.is_empty() {
        return (AgentMode::Build, false);
    }

    // Use the richer resolvedUserIntent from frontend (AI classifier result) if available
    if let Some(intent) = resolved_user_intent {
        // AI 分类器的 primary 字段是最可靠的信号
        let mode = match intent.primary.as_deref() {
            Some("implement") => AgentMode::Build,
            Some("automation") => AgentMode::Build,
            Some("consultative") => AgentMode::Ask,
            None => {
                // Fallback: 使用字段级信号
                if intent.implement_follow_up
                    || intent.ui_defect
                    || intent.ui_appearance
                    || intent.behavior_contradiction
                {
                    AgentMode::Build
                } else if intent.consultative {
                    AgentMode::Ask
                } else {
                    AgentMode::Build
                }
            }
            _ => AgentMode::Build,
        };
        return (mode, true);
    }

    // Fallback: lightweight heuristics from prompt text
    let intent = infer_user_intent_from_prompt(text);
    let has_implement = IMPLEMENT_INTENT_RE.is_match(text);

    let mode = if has_implement {
        // 有实施动词（不管是不是问句）→ Build
        AgentMode::Build
    } else if intent.consultative || intent.behavior_purpose || intent.accuracy_question {
        // 纯咨询、用途问题、准确性问题 → Ask
        AgentMode::Ask
    } else {
        // 默认 Build
        AgentMode::Build
    };
    (mode, true)
}

impl AgentRunPolicy {
    pub fn uses_read_only_tools(&self, is_read_only_agent: bool, is_plan_explore: bool) -> bool {
        is_read_only_agent || is_plan_explore || self.read_only_build_run
    }
}

pub fn resolve_run_policy(input: ResolvePolicyInput) -> AgentRunPolicy {
    let is_read_only_agent = input.mode.is_read_only();
    let is_ask = input.mode == AgentMode::Ask;
    let is_explore = input.mode == AgentMode::Explore;

    let automated_bug_fix_run =
        input.is_execute_plan && input.trigger_source.as_deref() == Some("auto_bug_fix");

    let implement_follow_up_run = !is_read_only_agent
        && !input.is_plan_explore
        && !input.is_execute_plan
        && input.user_intent.implement_follow_up;

    let same_issue_follow_up_run = !is_read_only_agent
        && !input.is_plan_explore
        && !input.is_execute_plan
        && !implement_follow_up_run
        && is_same_issue_follow_up_run(
            &input.prompt,
            input.history.as_deref(),
            input.user_intent.behavior_contradiction,
        );

    let explore_hard_cap = if automated_bug_fix_run {
        AUTO_BUG_FIX_EXPLORE_HARD_CAP
    } else if same_issue_follow_up_run {
        SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE
    } else {
        MAX_TOTAL_EXPLORE_TURNS
    };

    let explore_soft_cap = if same_issue_follow_up_run {
        SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE_SOFT
    } else {
        MAX_TOTAL_EXPLORE_TURNS_SOFT
    };

    let code_review_run = !is_read_only_agent
        && !input.is_plan_explore
        && !input.is_execute_plan
        && input.user_intent.code_review
        && !implement_follow_up_run;

    let user_error_quote_run = !is_read_only_agent
        && !input.is_plan_explore
        && !input.is_execute_plan
        && input.user_intent.user_error_quote
        && !implement_follow_up_run;

    let user_failure_report_run = !is_read_only_agent
        && !input.is_plan_explore
        && !input.is_execute_plan
        && detect_user_failure_report(&input.prompt);

    let user_recently_reported_failure =
        history_recent_user_failure_report(input.history.as_deref(), 4);

    let session_audit_run = !is_read_only_agent
        && !input.is_plan_explore
        && !input.is_execute_plan
        && input.user_intent.consultative_topic.as_deref() == Some("session_audit");

    let behavior_contradiction_run = !input.is_plan_explore
        && !input.is_execute_plan
        && !implement_follow_up_run
        && input.user_intent.behavior_contradiction;

    let loc_status_follow_up_run = !is_read_only_agent
        && !input.is_plan_explore
        && !input.is_execute_plan
        && !implement_follow_up_run
        && input.user_intent.locate_status_follow_up;

    let resume_original_task = resolve_original_task_from_resume_prompt(&input.prompt);

    let consultative_resume_run = !is_read_only_agent
        && !input.is_plan_explore
        && !input.is_execute_plan
        && resume_original_task
            .as_ref()
            .map(|task| infer_user_intent_from_prompt(task).consultative)
            .unwrap_or(false);

    let read_only_build_run = !is_ask
        && !is_explore
        && !input.is_plan_explore
        && !input.is_execute_plan
        && (input.user_intent.consultative
            || consultative_resume_run
            || code_review_run
            || session_audit_run
            || loc_status_follow_up_run)
        && !implement_follow_up_run;

    let behavior_purpose_run = !input.is_plan_explore
        && !input.is_execute_plan
        && !implement_follow_up_run
        && input.user_intent.behavior_purpose;

    let accuracy_consultative_run = read_only_build_run && input.user_intent.accuracy_question;

    let consultative_vision_run = input.has_image && (is_read_only_agent || read_only_build_run);

    let consultative_ui_appearance_run =
        read_only_build_run && consultative_vision_run && input.user_intent.ui_appearance;

    let ui_defect_build_run = !is_read_only_agent
        && !input.is_plan_explore
        && !read_only_build_run
        && input.has_image
        && input.user_intent.ui_defect;

    let agent_step_clarify_run =
        !is_read_only_agent && !input.is_plan_explore && input.user_intent.agent_step_clarification;

    let ultra_short_open_task_run = !is_read_only_agent
        && !input.is_plan_explore
        && !input.is_execute_plan
        && !read_only_build_run
        && resume_original_task.is_none()
        && input.user_intent.ultra_short_open_task;

    let pending_plan_amend_run = input.is_plan_explore && input.user_intent.pending_plan_amend;
    let pending_plan_clarify_run = input.is_plan_explore && input.user_intent.pending_plan_clarify;

    let needs_clarification_run = !is_read_only_agent
        && !input.is_plan_explore
        && !input.is_execute_plan
        && !read_only_build_run
        && !implement_follow_up_run
        && input.user_intent.needs_clarification;

    let quoted_amend_intent = if resume_original_task.is_some() {
        None
    } else {
        super::quoted_amend::resolve_quoted_amend_intent(&input.prompt)
    };
    let quoted_amend_run = !is_read_only_agent
        && !input.is_plan_explore
        && !input.is_execute_plan
        && quoted_amend_intent
            .as_ref()
            .map(|i| i.kind != super::quoted_amend::QuotedAmendKind::Ambiguous)
            .unwrap_or(false);
    let effective_task_prompt = resume_original_task.clone().unwrap_or_else(|| {
        if quoted_amend_run {
            quoted_amend_intent.as_ref().map_or_else(
                || input.prompt.clone(),
                |intent| super::quoted_amend::expand_quoted_amend_prompt(&input.prompt, intent),
            )
        } else {
            input.prompt.clone()
        }
    });

    let max_context_chars = if input.is_execute_plan {
        EXECUTE_PLAN_MAX_CONTEXT_CHARS
    } else if input.is_plan_explore {
        PLAN_MAX_CONTEXT_CHARS
    } else if consultative_ui_appearance_run {
        CONSULTATIVE_UI_APPEARANCE_MAX_CONTEXT_CHARS
    } else if is_read_only_agent {
        ASK_MAX_CONTEXT_CHARS
    } else {
        MAX_AGENT_CONTEXT_CHARS
    };

    AgentRunPolicy {
        implement_follow_up_run,
        same_issue_follow_up_run,
        code_review_run,
        user_error_quote_run,
        user_failure_report_run,
        session_audit_run,
        behavior_contradiction_run,
        consultative_resume_run,
        locate_status_follow_up_run: loc_status_follow_up_run,
        read_only_build_run,
        behavior_purpose_run,
        accuracy_consultative_run,
        consultative_vision_run,
        consultative_ui_appearance_run,
        ui_defect_build_run,
        agent_step_clarify_run,
        ultra_short_open_task_run,
        pending_plan_amend_run,
        pending_plan_clarify_run,
        needs_clarification_run,
        quoted_amend_run,
        quoted_amend_intent,
        effective_task_prompt,
        automated_bug_fix_run,
        disable_segment_auto_extend: automated_bug_fix_run,
        explore_hard_cap,
        explore_soft_cap,
        max_context_chars,
        user_recently_reported_failure,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── AgentMode::from_str ──
    #[test]
    fn test_agent_mode_from_str_ask() {
        assert_eq!(AgentMode::from_str("ask"), AgentMode::Ask);
    }

    #[test]
    fn test_agent_mode_from_str_plan() {
        assert_eq!(AgentMode::from_str("plan"), AgentMode::Plan);
    }

    #[test]
    fn test_agent_mode_from_str_explore() {
        assert_eq!(AgentMode::from_str("explore"), AgentMode::Explore);
    }

    #[test]
    fn test_agent_mode_from_str_build() {
        assert_eq!(AgentMode::from_str("build"), AgentMode::Build);
    }

    #[test]
    fn test_agent_mode_from_str_unknown_defaults_build() {
        assert_eq!(AgentMode::from_str("unknown"), AgentMode::Build);
    }

    #[test]
    fn test_agent_mode_from_str_empty_string() {
        assert_eq!(AgentMode::from_str(""), AgentMode::Build);
    }

    // ── AgentMode::is_read_only ──
    #[test]
    fn test_agent_mode_is_read_only_ask() {
        assert!(AgentMode::Ask.is_read_only());
    }

    #[test]
    fn test_agent_mode_is_read_only_explore() {
        assert!(AgentMode::Explore.is_read_only());
    }

    #[test]
    fn test_agent_mode_is_read_only_build() {
        assert!(!AgentMode::Build.is_read_only());
    }

    #[test]
    fn test_agent_mode_is_read_only_plan() {
        assert!(!AgentMode::Plan.is_read_only());
    }

    // ── AgentMode default ──
    #[test]
    fn test_agent_mode_default() {
        let mode: AgentMode = Default::default();
        assert_eq!(mode, AgentMode::Ask);
    }

    // ── infer_user_intent_from_prompt ──
    #[test]
    fn test_infer_user_intent_from_prompt_empty() {
        let intent = infer_user_intent_from_prompt("");
        assert!(!intent.consultative);
        assert!(!intent.behavior_purpose);
        assert!(!intent.accuracy_question);
    }

    #[test]
    fn test_infer_user_intent_from_prompt_whitespace() {
        let intent = infer_user_intent_from_prompt("  ");
        assert!(!intent.consultative);
    }

    #[test]
    fn test_infer_user_intent_from_prompt_implement_verb() {
        let intent = infer_user_intent_from_prompt("帮我实现登录功能");
        assert!(!intent.consultative);
        assert!(!intent.accuracy_question);
    }

    #[test]
    fn test_infer_user_intent_from_prompt_implement_english() {
        let intent = infer_user_intent_from_prompt("implement user authentication");
        assert!(!intent.consultative);
    }

    #[test]
    fn test_infer_user_intent_from_prompt_fix() {
        let intent = infer_user_intent_from_prompt("帮我修这个 bug");
        assert!(!intent.consultative);
    }

    #[test]
    fn test_infer_user_intent_from_prompt_implement_with_question() {
        let intent = infer_user_intent_from_prompt("帮我实现登录功能？");
        assert!(intent.consultative);
    }

    #[test]
    fn test_infer_user_intent_from_prompt_consultative_question() {
        let intent = infer_user_intent_from_prompt("这个功能是做什么的？");
        assert!(intent.consultative);
    }

    #[test]
    fn test_infer_user_intent_from_prompt_consultative_ma() {
        let intent = infer_user_intent_from_prompt("这段代码有什么问题吗");
        assert!(intent.consultative);
    }

    #[test]
    fn test_infer_user_intent_from_prompt_behavior_purpose() {
        let intent = infer_user_intent_from_prompt("这个模块有什么用");
        assert!(intent.behavior_purpose);
    }

    #[test]
    fn test_infer_user_intent_from_prompt_behavior_purpose_synonyms() {
        let intent = infer_user_intent_from_prompt("这个函数的作用是什么");
        assert!(intent.behavior_purpose);
    }

    #[test]
    fn test_infer_user_intent_from_prompt_behavior_purpose_yongtu() {
        let intent = infer_user_intent_from_prompt("这个配置有什么用");
        assert!(intent.behavior_purpose);
    }

    #[test]
    fn test_infer_user_intent_from_prompt_accuracy_question() {
        let intent = infer_user_intent_from_prompt("这个结果准确吗？");
        assert!(intent.accuracy_question);
    }

    #[test]
    fn test_infer_user_intent_from_prompt_accuracy_will_happen() {
        let intent = infer_user_intent_from_prompt("重启后会不会发生数据丢失？");
        assert!(intent.accuracy_question);
    }

    #[test]
    fn test_infer_user_intent_from_prompt_accuracy_shi_bu_shi() {
        let intent = infer_user_intent_from_prompt("是不是会覆盖已有文件？");
        assert!(intent.accuracy_question);
    }

    #[test]
    fn test_infer_user_intent_from_prompt_implement_overrides_accuracy() {
        // implement with question — implement takes precedence for has_implement check,
        // but since has_implement && has_question -> is it implement?
        // Let me trace: prompt = "改一下这个，准确吗？"
        // text.contains('？') -> true, has_question = true
        // IMPLEMENT_INTENT_RE matches "改" -> has_implement = true
        // consultative = true && false = false
        // accuracy_question = (... contains 准确) && has_question -> true
        // implement_follow_up is set in UserIntent only via default... but it's not set here.
        // Actually infer_user_intent does NOT set implement_follow_up. Let me re-check.
        // It returns UserIntent { consultative, behavior_purpose, accuracy_question, ..Default::default() }
        // So implement_follow_up is NOT set from this function. Good.
        let intent = infer_user_intent_from_prompt("改一下，这个准确吗？");
        assert!(intent.accuracy_question);
    }

    // ── AgentRunPolicy::uses_read_only_tools ──
    #[test]
    fn test_uses_read_only_tools_read_only_agent() {
        let policy = AgentRunPolicy::default();
        assert!(policy.uses_read_only_tools(true, false));
    }

    #[test]
    fn test_uses_read_only_tools_plan_explore() {
        let policy = AgentRunPolicy::default();
        assert!(policy.uses_read_only_tools(false, true));
    }

    #[test]
    fn test_uses_read_only_tools_read_only_build() {
        let mut policy = AgentRunPolicy::default();
        policy.read_only_build_run = true;
        assert!(policy.uses_read_only_tools(false, false));
    }

    #[test]
    fn test_uses_read_only_tools_false() {
        let policy = AgentRunPolicy::default();
        assert!(!policy.uses_read_only_tools(false, false));
    }

    #[test]
    fn test_uses_read_only_tools_all_true() {
        let mut policy = AgentRunPolicy::default();
        policy.read_only_build_run = true;
        assert!(policy.uses_read_only_tools(true, true));
    }

    // ── resolve_run_policy ──
    #[test]
    fn test_resolve_run_policy_ask_mode_default() {
        let input = ResolvePolicyInput {
            mode: AgentMode::Ask,
            ..Default::default()
        };
        let policy = resolve_run_policy(input);
        assert!(!policy.implement_follow_up_run);
        assert!(!policy.read_only_build_run);
        assert!(!policy.consultative_vision_run);
        assert!(!policy.automated_bug_fix_run);
        assert!(!policy.consultative_ui_appearance_run);
        assert_eq!(policy.max_context_chars, ASK_MAX_CONTEXT_CHARS);
        assert_eq!(policy.explore_hard_cap, MAX_TOTAL_EXPLORE_TURNS);
        assert_eq!(policy.explore_soft_cap, MAX_TOTAL_EXPLORE_TURNS_SOFT);
    }

    #[test]
    fn test_resolve_run_policy_build_mode_default() {
        let input = ResolvePolicyInput {
            mode: AgentMode::Build,
            ..Default::default()
        };
        let policy = resolve_run_policy(input);
        assert!(!policy.implement_follow_up_run);
        assert!(!policy.read_only_build_run);
        assert!(!policy.consultative_vision_run);
        assert_eq!(policy.max_context_chars, MAX_AGENT_CONTEXT_CHARS);
    }

    #[test]
    fn test_resolve_run_policy_execute_plan() {
        let input = ResolvePolicyInput {
            mode: AgentMode::Build,
            is_execute_plan: true,
            ..Default::default()
        };
        let policy = resolve_run_policy(input);
        assert_eq!(policy.max_context_chars, EXECUTE_PLAN_MAX_CONTEXT_CHARS);
    }

    #[test]
    fn test_resolve_run_policy_plan_explore() {
        let input = ResolvePolicyInput {
            mode: AgentMode::Plan,
            is_plan_explore: true,
            ..Default::default()
        };
        let policy = resolve_run_policy(input);
        assert_eq!(policy.max_context_chars, PLAN_MAX_CONTEXT_CHARS);
    }

    #[test]
    fn test_resolve_run_policy_automated_bug_fix() {
        let input = ResolvePolicyInput {
            mode: AgentMode::Build,
            is_execute_plan: true,
            trigger_source: Some("auto_bug_fix".to_string()),
            ..Default::default()
        };
        let policy = resolve_run_policy(input);
        assert!(policy.automated_bug_fix_run);
        assert!(policy.disable_segment_auto_extend);
        assert_eq!(policy.explore_hard_cap, AUTO_BUG_FIX_EXPLORE_HARD_CAP);
        assert_eq!(policy.explore_soft_cap, MAX_TOTAL_EXPLORE_TURNS_SOFT);
    }

    #[test]
    fn test_resolve_run_policy_ask_with_image() {
        let input = ResolvePolicyInput {
            mode: AgentMode::Ask,
            has_image: true,
            ..Default::default()
        };
        let policy = resolve_run_policy(input);
        assert!(policy.consultative_vision_run);
        assert!(!policy.consultative_ui_appearance_run);
    }

    #[test]
    fn test_resolve_run_policy_behavior_purpose() {
        let input = ResolvePolicyInput {
            mode: AgentMode::Build,
            user_intent: UserIntent {
                behavior_purpose: true,
                ..Default::default()
            },
            ..Default::default()
        };
        let policy = resolve_run_policy(input);
        assert!(policy.behavior_purpose_run);
    }

    #[test]
    fn test_resolve_run_policy_plan_explore_with_pending_amend() {
        let input = ResolvePolicyInput {
            mode: AgentMode::Plan,
            is_plan_explore: true,
            user_intent: UserIntent {
                pending_plan_amend: true,
                ..Default::default()
            },
            ..Default::default()
        };
        let policy = resolve_run_policy(input);
        assert!(policy.pending_plan_amend_run);
        assert!(!policy.pending_plan_clarify_run);
    }

    #[test]
    fn test_resolve_run_policy_plan_explore_with_pending_clarify() {
        let input = ResolvePolicyInput {
            mode: AgentMode::Plan,
            is_plan_explore: true,
            user_intent: UserIntent {
                pending_plan_clarify: true,
                ..Default::default()
            },
            ..Default::default()
        };
        let policy = resolve_run_policy(input);
        assert!(!policy.pending_plan_amend_run);
        assert!(policy.pending_plan_clarify_run);
    }

    #[test]
    fn test_resolve_run_policy_build_with_consultative_and_image_ui_appearance() {
        let input = ResolvePolicyInput {
            mode: AgentMode::Build,
            has_image: true,
            user_intent: UserIntent {
                consultative: true,
                ui_appearance: true,
                ..Default::default()
            },
            ..Default::default()
        };
        let policy = resolve_run_policy(input);
        // read_only_build_run = !is_ask && !is_explore && !plan_explore && !execute_plan
        //                  && (consultative || ...) && !implement_follow_up
        //                  = true && true && true && true && (true || ...) && true = true
        // consultative_vision_run = has_image && (is_read_only || read_only_build)
        //                         = true && (false || true) = true
        // consultative_ui_appearance_run = read_only_build && consultative_vision && ui_appearance
        //                                = true && true && true = true
        assert!(policy.read_only_build_run);
        assert!(policy.consultative_vision_run);
        assert!(policy.consultative_ui_appearance_run);
        assert_eq!(
            policy.max_context_chars,
            CONSULTATIVE_UI_APPEARANCE_MAX_CONTEXT_CHARS
        );
    }

    #[test]
    fn test_resolve_run_policy_agent_step_clarify() {
        let input = ResolvePolicyInput {
            mode: AgentMode::Build,
            user_intent: UserIntent {
                agent_step_clarification: true,
                ..Default::default()
            },
            ..Default::default()
        };
        let policy = resolve_run_policy(input);
        assert!(policy.agent_step_clarify_run);
    }

    #[test]
    fn test_resolve_run_policy_needs_clarification() {
        let input = ResolvePolicyInput {
            mode: AgentMode::Build,
            user_intent: UserIntent {
                needs_clarification: true,
                ..Default::default()
            },
            ..Default::default()
        };
        let policy = resolve_run_policy(input);
        assert!(policy.needs_clarification_run);
    }

    #[test]
    fn test_resolve_run_policy_needs_clarification_blocked_in_ask() {
        let input = ResolvePolicyInput {
            mode: AgentMode::Ask,
            user_intent: UserIntent {
                needs_clarification: true,
                ..Default::default()
            },
            ..Default::default()
        };
        let policy = resolve_run_policy(input);
        assert!(!policy.needs_clarification_run);
    }

    #[test]
    fn test_resolve_run_policy_build_with_image_ui_defect() {
        let input = ResolvePolicyInput {
            mode: AgentMode::Build,
            has_image: true,
            user_intent: UserIntent {
                ui_defect: true,
                ..Default::default()
            },
            ..Default::default()
        };
        let policy = resolve_run_policy(input);
        assert!(policy.ui_defect_build_run);
    }

    #[test]
    fn test_resolve_run_policy_session_audit() {
        let input = ResolvePolicyInput {
            mode: AgentMode::Build,
            user_intent: UserIntent {
                consultative_topic: Some("session_audit".to_string()),
                ..Default::default()
            },
            ..Default::default()
        };
        let policy = resolve_run_policy(input);
        assert!(policy.session_audit_run);
        assert!(policy.read_only_build_run);
    }

    #[test]
    fn test_resolve_run_policy_behavior_contradiction() {
        let input = ResolvePolicyInput {
            mode: AgentMode::Build,
            user_intent: UserIntent {
                behavior_contradiction: true,
                ..Default::default()
            },
            ..Default::default()
        };
        let policy = resolve_run_policy(input);
        assert!(policy.behavior_contradiction_run);
    }

    #[test]
    fn test_resolve_run_policy_locate_status_follow_up() {
        let input = ResolvePolicyInput {
            mode: AgentMode::Build,
            user_intent: UserIntent {
                locate_status_follow_up: true,
                ..Default::default()
            },
            ..Default::default()
        };
        let policy = resolve_run_policy(input);
        assert!(policy.locate_status_follow_up_run);
    }

    #[test]
    fn test_resolve_run_policy_explore_mode_default() {
        let input = ResolvePolicyInput {
            mode: AgentMode::Explore,
            ..Default::default()
        };
        let policy = resolve_run_policy(input);
        assert!(!policy.implement_follow_up_run);
        assert!(!policy.read_only_build_run);
        assert_eq!(policy.max_context_chars, ASK_MAX_CONTEXT_CHARS);
    }

    #[test]
    fn test_detect_user_failure_report() {
        assert!(detect_user_failure_report("试了没有效果"));
        assert!(!detect_user_failure_report("帮我改一下"));
    }

    #[test]
    fn test_resolve_run_policy_user_failure_report() {
        let input = ResolvePolicyInput {
            mode: AgentMode::Build,
            prompt: "试了没有效果".to_string(),
            ..Default::default()
        };
        let policy = resolve_run_policy(input);
        assert!(policy.user_failure_report_run);
    }

    #[test]
    fn test_is_same_issue_follow_up_run_with_prior_fix_claim() {
        use crate::agent::context::HistoryMessage;
        let history = vec![
            HistoryMessage {
                role: "assistant".to_string(),
                content: "已修复，刷新页面看看".to_string(),
            },
            HistoryMessage {
                role: "user".to_string(),
                content: "还是有问题".to_string(),
            },
        ];
        assert!(is_same_issue_follow_up_run(
            "还是有问题",
            Some(&history),
            false
        ));
    }

    #[test]
    fn test_resolve_run_policy_quoted_amend_remove() {
        let input = ResolvePolicyInput {
            mode: AgentMode::Build,
            prompt: "> Agent: scopeA：保留 `TargetSymbol`\n\n也移除".to_string(),
            ..Default::default()
        };
        let policy = resolve_run_policy(input);
        assert!(policy.quoted_amend_run);
        assert!(policy.effective_task_prompt.contains("操作：remove"));
        assert!(policy.effective_task_prompt.contains("TargetSymbol"));
    }
}
