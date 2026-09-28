/** History limits — keep in sync with `src-tauri/src/agent/context_limits.rs`. */
export const MAX_HISTORY_MESSAGES = 40;
export const MAX_HISTORY_CHARS = 256_000;

/**
 * UI-only hint threshold. When the live request size (messages + tool schemas)
 * exceeds this many **chars**, the running-status line appends「上下文较大」.
 *
 * This is *not* a limit: the agent sends messages to the model as-is (see
 * `run.rs` "No auto-compression"). The old message-compaction machinery that
 * shared this value was removed, so it now only drives that status hint.
 * Measured in chars because token usage is not always reported by providers.
 */
export const AGENT_LARGE_CONTEXT_HINT_CHARS = 256_000;
