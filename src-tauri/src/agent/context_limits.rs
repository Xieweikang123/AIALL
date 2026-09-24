//! Agent context limits — keep in sync with `shared/agentContextLimits.ts` and
//! `shared/agentMessageCompact.ts` (verified by `shared/agentConstantsParity.test.ts`).

pub const MAX_AGENT_CONTEXT_CHARS: usize = 256_000;
pub const EXECUTE_PLAN_MAX_CONTEXT_CHARS: usize = 256_000;
pub const ASK_MAX_CONTEXT_CHARS: usize = 256_000;
pub const CONSULTATIVE_UI_APPEARANCE_MAX_CONTEXT_CHARS: usize = 256_000;
pub const PLAN_MAX_CONTEXT_CHARS: usize = 256_000;

pub const SOFT_COMPACT_CONTEXT_CHARS: usize = 256_000;
pub const MAX_TOOL_RESULT_MODEL_CHARS: usize = 50_000;
pub const MAX_HISTORY_MESSAGES: usize = 40;
pub const MAX_HISTORY_CHARS: usize = 256_000;
