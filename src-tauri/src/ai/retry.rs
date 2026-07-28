//! AI request retry helpers — keep in sync with `shared/aiRetry.ts`.

use std::time::Duration;

pub const DEFAULT_AI_MAX_RETRIES: u32 = 3;
pub const AGENT_AI_MAX_RETRIES: u32 = DEFAULT_AI_MAX_RETRIES + 1;
pub const MODEL_FIRST_BYTE_TIMEOUT_MS: u64 = 60_000;

static RETRYABLE_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
  regex::Regex::new(
    r"(?i)gateway error|请求超时|timeout|timed out|econnreset|etimedout|socket hang up|fetch failed|network error|overload|rate.?limit|too many requests|service unavailable|bad gateway",
  )
  .unwrap()
});

static RATE_LIMIT_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
  regex::Regex::new(r"(?i)too many requests|rate.?limit").unwrap()
});

pub fn resolve_first_byte_timeout_ms(context_chars: usize) -> u64 {
  let extra_seconds = (context_chars / 1500).min(120) as u64;
  MODEL_FIRST_BYTE_TIMEOUT_MS + extra_seconds * 1000
}

pub fn is_rate_limit_ai_error(status: u16, error: &str, raw_text: &str) -> bool {
  if status == 429 {
    return true;
  }
  let haystack = format!("{error} {raw_text}");
  RATE_LIMIT_RE.is_match(&haystack)
}

pub fn is_retryable_ai_error(status: u16, error: &str, raw_text: &str, fetch_error: bool) -> bool {
  if fetch_error {
    let lower = error.to_lowercase();
    return !(lower.contains("aborted") || lower.contains("cancelled") || lower.contains("canceled"));
  }

  if matches!(status, 408 | 429 | 502 | 503 | 504) {
    return true;
  }

  if error.contains("模型返回为空") || error.contains("模型响应超时") {
    return true;
  }

  let haystack = format!("{error} {raw_text}");
  RETRYABLE_RE.is_match(&haystack)
}

pub fn retry_delay_for_attempt(attempt: u32, rate_limited: bool) -> Duration {
  let base_ms: u64 = if rate_limited { 5000 } else { 2000 };
  let cap_ms: u64 = if rate_limited { 90_000 } else { 30_000 };
  let delay_ms = base_ms.saturating_mul(2u64.saturating_pow(attempt.saturating_sub(1)));
  Duration::from_millis(delay_ms.min(cap_ms))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn resolve_first_byte_timeout_scales_with_context() {
    assert_eq!(resolve_first_byte_timeout_ms(0), MODEL_FIRST_BYTE_TIMEOUT_MS);
    assert_eq!(
      resolve_first_byte_timeout_ms(30_000),
      MODEL_FIRST_BYTE_TIMEOUT_MS + 20_000
    );
    assert_eq!(
      resolve_first_byte_timeout_ms(500_000),
      MODEL_FIRST_BYTE_TIMEOUT_MS + 120_000
    );
  }

  #[test]
  fn agent_retry_budget_has_one_extra_attempt() {
    assert_eq!(AGENT_AI_MAX_RETRIES, DEFAULT_AI_MAX_RETRIES + 1);
  }

  #[test]
  fn retries_rate_limit_and_empty_model_errors() {
    assert!(is_retryable_ai_error(
      429,
      "请求失败，HTTP 429：Too many requests",
      "",
      false
    ));
    assert!(is_retryable_ai_error(0, "模型返回为空", "", false));
    assert!(is_retryable_ai_error(0, "模型响应超时（等待首包超过 60s）", "", false));
    assert!(!is_retryable_ai_error(0, "Aborted", "", true));
  }

  #[test]
  fn detects_rate_limit_messages() {
    assert!(is_rate_limit_ai_error(429, "", ""));
    assert!(is_rate_limit_ai_error(
      0,
      "Error from provider: Too many requests",
      "",
    ));
    assert!(!is_rate_limit_ai_error(502, "bad gateway", ""));
  }
}
