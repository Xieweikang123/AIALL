//! Mutable loop state for `agent_run` — grouped to keep `run.rs` readable.

use std::collections::HashSet;

use serde_json::Value;

use super::explore_guard::{PatchFailureEntry, ToolGuardState};
use super::probe_guard::ProbeArtifactTracker;
use super::run_finalize::FinalizeTurnMut;
use super::run_post_tools::PostToolTurnMut;
use super::run_preflight::{TurnPreflightMut, TurnPreflightState};

/// Segment / turn budget tracking.
#[derive(Debug)]
pub(crate) struct SegmentState {
    pub max_turns: u32,
    pub index: u32,
    pub actual_turns: u32,
    pub turn_cap_final_summary_attempts: u32,
}

impl SegmentState {
    pub fn new(max_turns: u32) -> Self {
        Self {
            max_turns,
            index: 1,
            actual_turns: 0,
            turn_cap_final_summary_attempts: 0,
        }
    }
}

/// Consultative / explore read tracking across turns.
#[derive(Debug, Default)]
pub(crate) struct ConsultativeTrackState {
    pub consecutive_read_turns: u32,
    pub total_read_tool_calls: u32,
    pub read_paths: Vec<String>,
    pub read_failed_paths: Vec<String>,
    pub grep_patterns: Vec<String>,
    pub search_queries: Vec<String>,
    pub force_answer_pending: bool,
    pub last_explore_sig: Option<String>,
    pub explore_files_read: HashSet<String>,
}

/// Vision / screenshot locate state.
#[derive(Debug)]
pub(crate) struct VisionRunState {
    pub locate_tools_used: bool,
    pub locate_read_used: bool,
    pub auto_grep_had_matches: bool,
    pub pregrep_unique_files: Vec<String>,
    pub consultative_locate_retries: u32,
    pub pregrep_done: bool,
}

impl VisionRunState {
    pub fn new() -> Self {
        Self {
            locate_tools_used: false,
            locate_read_used: false,
            auto_grep_had_matches: false,
            pregrep_unique_files: Vec::new(),
            consultative_locate_retries: 0,
            pregrep_done: false,
        }
    }
}

/// Patch / force-write nudge flags.
#[derive(Debug, Default)]
pub(crate) struct PatchNudgeState {
    pub build_explore_force_patch_sent: bool,
    pub ui_defect_force_patch_sent: bool,
    pub patch_anchor_force_patch_nudge_sent: bool,
    pub patch_anchor_force_pending: bool,
    pub force_write_only_tools: bool,
    pub failure_log: Vec<PatchFailureEntry>,
}

/// Retry counters consumed by finalize / post-tool nudges.
#[derive(Debug, Default)]
pub(crate) struct RunRetryCounters {
    pub accuracy: u32,
    pub behavior_purpose: u32,
    pub ui_behavior: u32,
    pub empty_reply: u32,
    pub premature_completion: u32,
    pub patch_required: u32,
    pub patch_failure_completion: u32,
    pub manual_handoff: u32,
    pub ambiguous_term_clarification: u32,
}

/// Miscellaneous one-shot nudge / audit flags.
#[derive(Debug, Default)]
pub(crate) struct RunNudgeFlags {
    pub agent_step_clarify_pending: bool,
    pub modification_audit_sent: bool,
    pub workspace_cleanup_nudge_sent: bool,
    pub consecutive_runtime_tool_failure_turns: u32,
}

/// All mutable state for the agent main loop.
pub(crate) struct AgentRunState {
    pub segment: SegmentState,
    pub written_files: Vec<String>,
    pub consultative: ConsultativeTrackState,
    pub vision: VisionRunState,
    pub patch: PatchNudgeState,
    pub retries: RunRetryCounters,
    pub nudge_flags: RunNudgeFlags,
    pub probe_tracker: ProbeArtifactTracker,
    pub preflight_state: TurnPreflightState,
    pub tool_guard: ToolGuardState,
    pub active_tools: Value,
    pub messages: Vec<Value>,
    pub ambiguous_term_clarification_pending: bool,
    pub ambiguous_term_clarification_terms: Vec<String>,
}

impl AgentRunState {
    pub fn preflight_mut(&self) -> TurnPreflightMut {
        TurnPreflightMut {
            ui_defect_force_patch_nudge_sent: self.patch.ui_defect_force_patch_sent,
            build_explore_force_patch_nudge_sent: self.patch.build_explore_force_patch_sent,
            patch_anchor_force_patch_nudge_sent: self.patch.patch_anchor_force_patch_nudge_sent,
            patch_anchor_force_pending: self.patch.patch_anchor_force_pending,
            force_write_only_tools: self.patch.force_write_only_tools,
            consultative_force_answer_pending: self.consultative.force_answer_pending,
        }
    }

    pub fn apply_preflight_mut(&mut self, flags: TurnPreflightMut) {
        self.patch.ui_defect_force_patch_sent = flags.ui_defect_force_patch_nudge_sent;
        self.patch.build_explore_force_patch_sent = flags.build_explore_force_patch_nudge_sent;
        self.patch.patch_anchor_force_patch_nudge_sent = flags.patch_anchor_force_patch_nudge_sent;
        self.patch.patch_anchor_force_pending = flags.patch_anchor_force_pending;
        self.patch.force_write_only_tools = flags.force_write_only_tools;
        self.consultative.force_answer_pending = flags.consultative_force_answer_pending;
    }

    pub fn finalize_mut(&self) -> FinalizeTurnMut {
        FinalizeTurnMut {
            consultative_force_answer_pending: self.consultative.force_answer_pending,
            vision_consultative_locate_retries: self.vision.consultative_locate_retries,
            accuracy_retries: self.retries.accuracy,
            behavior_purpose_retries: self.retries.behavior_purpose,
            ui_behavior_retries: self.retries.ui_behavior,
            modification_audit_sent: self.nudge_flags.modification_audit_sent,
            patch_required_retries: self.retries.patch_required,
            patch_failure_completion_retries: self.retries.patch_failure_completion,
            manual_handoff_retries: self.retries.manual_handoff,
            premature_completion_retries: self.retries.premature_completion,
            empty_reply_retries: self.retries.empty_reply,
            workspace_cleanup_nudge_sent: self.nudge_flags.workspace_cleanup_nudge_sent,
            ambiguous_term_clarification_pending: self.ambiguous_term_clarification_pending,
            ambiguous_term_clarification_retries: self.retries.ambiguous_term_clarification,
        }
    }

    pub fn apply_finalize_mut(&mut self, m: FinalizeTurnMut) {
        self.consultative.force_answer_pending = m.consultative_force_answer_pending;
        self.vision.consultative_locate_retries = m.vision_consultative_locate_retries;
        self.retries.accuracy = m.accuracy_retries;
        self.retries.behavior_purpose = m.behavior_purpose_retries;
        self.retries.ui_behavior = m.ui_behavior_retries;
        self.nudge_flags.modification_audit_sent = m.modification_audit_sent;
        self.retries.patch_required = m.patch_required_retries;
        self.retries.patch_failure_completion = m.patch_failure_completion_retries;
        self.retries.manual_handoff = m.manual_handoff_retries;
        self.retries.premature_completion = m.premature_completion_retries;
        self.retries.empty_reply = m.empty_reply_retries;
        self.nudge_flags.workspace_cleanup_nudge_sent = m.workspace_cleanup_nudge_sent;
        self.ambiguous_term_clarification_pending = m.ambiguous_term_clarification_pending;
        self.retries.ambiguous_term_clarification = m.ambiguous_term_clarification_retries;
    }

    pub fn post_tool_mut(&self) -> PostToolTurnMut {
        PostToolTurnMut {
            consecutive_runtime_tool_failure_turns: self
                .nudge_flags
                .consecutive_runtime_tool_failure_turns,
            last_consultative_explore_sig: self.consultative.last_explore_sig.clone(),
            consecutive_read_turns: self.consultative.consecutive_read_turns,
            total_read_tool_calls: self.consultative.total_read_tool_calls,
            build_explore_force_patch_sent: self.patch.build_explore_force_patch_sent,
            patch_anchor_force_pending: self.patch.patch_anchor_force_pending,
            force_write_only_tools: self.patch.force_write_only_tools,
            consultative_force_answer_pending: self.consultative.force_answer_pending,
        }
    }

    pub fn apply_post_tool_mut(&mut self, m: PostToolTurnMut) {
        self.nudge_flags.consecutive_runtime_tool_failure_turns =
            m.consecutive_runtime_tool_failure_turns;
        self.consultative.last_explore_sig = m.last_consultative_explore_sig;
        self.consultative.consecutive_read_turns = m.consecutive_read_turns;
        self.consultative.total_read_tool_calls = m.total_read_tool_calls;
        self.patch.build_explore_force_patch_sent = m.build_explore_force_patch_sent;
        self.patch.patch_anchor_force_pending = m.patch_anchor_force_pending;
        self.patch.force_write_only_tools = m.force_write_only_tools;
        self.consultative.force_answer_pending = m.consultative_force_answer_pending;
    }
}
