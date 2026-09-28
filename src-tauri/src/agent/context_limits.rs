//! Agent context limits — keep in sync with `shared/agentContextLimits.ts` and
//! `shared/agentMessageCompact.ts` (verified by `shared/agentConstantsParity.test.ts`).

// Per-mode context budgets (execute_plan / ask / consultative-ui-appearance /
// plan) used to have distinct ceilings here. They were unified to 256k in
// 2026-09 and their only consumer (the per-mode `max_context_chars` branch in
// `policy.rs`) was removed with it, so the split constants are gone.
pub const MAX_AGENT_CONTEXT_CHARS: usize = 256_000;

pub const SOFT_COMPACT_CONTEXT_CHARS: usize = 256_000;
pub const MAX_TOOL_RESULT_MODEL_CHARS: usize = 50_000;
pub const MAX_HISTORY_MESSAGES: usize = 40;
pub const MAX_HISTORY_CHARS: usize = 256_000;
