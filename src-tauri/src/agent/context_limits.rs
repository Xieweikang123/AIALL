//! Agent context limits — keep in sync with `shared/agentContextLimits.ts`
//! (verified by `shared/agentConstantsParity.test.ts`).
//!
//! History: per-mode context budgets, the shared char ceiling
//! (`MAX_AGENT_CONTEXT_CHARS`), the tool-result truncation cap and the
//! soft-compact threshold all used to live here. They were removed once the
//! agent switched to sending messages as-is (`run.rs`: "No auto-compression"):
//! nothing in Rust enforced them anymore. What remains are the history-window
//! limits that `context.rs` actually applies when assembling the prompt.

pub const MAX_HISTORY_MESSAGES: usize = 40;
pub const MAX_HISTORY_CHARS: usize = 256_000;
