mod agent_git_tools;
mod agent_regression;
mod ambiguous_term;
mod classifier;
mod consultative_topics;
mod consultative_trace;
mod context;
mod context_limits;
mod continuation;
pub mod exploration;
mod explore_guard;
mod explore_prompt;
pub mod finish_gate;
mod intent_hints;
mod knowledge_explore;
mod knowledge_manifest;
mod patch;
mod plan_path;
mod policy;
mod probe_guard;
mod prompt_hints;
pub mod prompts;
mod quoted_amend;
mod run;
mod run_compact;
mod run_emit;
mod run_finalize;
mod run_post_tools;
mod run_preflight;
mod run_startup_hints;
mod run_state;
mod run_stream;
mod run_system_prompt;
mod run_types;
pub mod runtime_hint;
mod tool_exec;
pub mod tools;
mod vision;
mod vision_consultative;
mod vision_pregrep;

pub use classifier::tool_summary;
pub use consultative_trace::is_ui_state_behavior_question;
pub use exploration::{
    build_ask_force_answer_nudge, build_consultative_segment_cap_nudge, build_explore_budget_nudge,
    build_explore_force_report_nudge, build_plan_force_answer_nudge, build_plan_segment_cap_nudge,
    build_segment_emergency_finish_nudge, build_soft_cap_nudge, build_turn_cap_final_summary_nudge,
    EXPLORE_MAX_TOTAL_EXPLORE_SOFT,
};
pub use policy::AgentMode;
pub use run::*;
pub use run_types::AgentRunRequest;
pub use vision::{
    build_click_focus_interaction_hint, build_consultative_ui_appearance_hint,
    build_floating_control_positioning_hint, build_model_identity_hint,
    build_vision_build_continue_hint, build_vision_first_turn_rule, build_vision_grep_anchor_hint,
    build_vision_ui_locate_hint, build_vision_user_content, has_ui_image_keywords,
    is_ui_positioning_bug_prompt, mentions_control_proportion_imbalance, sanitize_image_data_urls,
    UI_CLICK_FOCUS_INTERACTION_RE,
};
