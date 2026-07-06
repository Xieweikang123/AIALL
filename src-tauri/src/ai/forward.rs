use super::retry::MODEL_FIRST_BYTE_TIMEOUT_MS;

pub fn resolve_chat_endpoint(endpoint: &str) -> String {
  let input = endpoint.trim();
  if input.is_empty() {
    return input.to_string();
  }
  if input.ends_with("/chat/completions") {
    return input.to_string();
  }
  if input.ends_with("/completions") {
    return input.replace("/completions", "/chat/completions");
  }
  if input.ends_with("/audio/speech") {
    return input.replace("/audio/speech", "/chat/completions");
  }
  format!("{}/chat/completions", input.trim_end_matches('/'))
}

pub async fn chat_completion(
  endpoint: &str,
  api_key: Option<&str>,
  body: serde_json::Value,
) -> Result<serde_json::Value, String> {
  let url = resolve_chat_endpoint(endpoint);
  let client = reqwest::Client::new();
  let mut req = client.post(url).json(&body);
  if let Some(key) = api_key.filter(|k| !k.is_empty()) {
    req = req.bearer_auth(key);
  }
  let resp = req.send().await.map_err(|e| e.to_string())?;
  let status = resp.status();
  let text = resp.text().await.map_err(|e| e.to_string())?;
  if !status.is_success() {
    return Err(format!("HTTP {status}: {text}"));
  }
  serde_json::from_str(&text).map_err(|e| e.to_string())
}

pub async fn chat_completion_stream_raw(
  endpoint: &str,
  api_key: Option<&str>,
  body: serde_json::Value,
) -> Result<reqwest::Response, String> {
  chat_completion_stream_once(endpoint, api_key, &body, MODEL_FIRST_BYTE_TIMEOUT_MS)
    .await
    .map_err(|err| err.error)
}

struct StreamAttemptError {
  status: u16,
  error: String,
  raw_text: String,
  fetch_error: bool,
}

async fn chat_completion_stream_once(
  endpoint: &str,
  api_key: Option<&str>,
  body: &serde_json::Value,
  first_byte_timeout_ms: u64,
) -> Result<reqwest::Response, StreamAttemptError> {
  let url = resolve_chat_endpoint(endpoint);
  let client = reqwest::Client::new();
  let mut req = client.post(url).json(&body);
  if let Some(key) = api_key.filter(|k| !k.is_empty()) {
    req = req.bearer_auth(key);
  }

  let send_result = tokio::time::timeout(
    std::time::Duration::from_millis(first_byte_timeout_ms),
    req.send(),
  )
  .await;

  let resp = match send_result {
    Ok(Ok(resp)) => resp,
    Ok(Err(err)) => {
      return Err(StreamAttemptError {
        status: 0,
        error: err.to_string(),
        raw_text: String::new(),
        fetch_error: true,
      });
    }
    Err(_) => {
      let seconds = first_byte_timeout_ms.div_ceil(1000);
      return Err(StreamAttemptError {
        status: 0,
        error: format!("模型响应超时（等待首包超过 {seconds}s）"),
        raw_text: String::new(),
        fetch_error: false,
      });
    }
  };

  let status = resp.status().as_u16();
  if status < 200 || status >= 300 {
    let raw_text = resp.text().await.unwrap_or_default();
    let error = if raw_text.is_empty() {
      format!("请求失败，HTTP {status}")
    } else {
      format!("请求失败，HTTP {status}：{raw_text}")
    };
    return Err(StreamAttemptError {
      status,
      error,
      raw_text,
      fetch_error: false,
    });
  }

  Ok(resp)
}

pub async fn chat_completion_stream_with_retry<F>(
  endpoint: &str,
  api_key: Option<&str>,
  mut body: serde_json::Value,
  max_retries: u32,
  context_chars: usize,
  mut on_retry: F,
  is_cancelled: impl Fn() -> bool,
) -> Result<reqwest::Response, String>
where
  F: FnMut(u32, u32, &str),
{
  use super::normalize::normalize_messages_for_chat_api;
  use super::retry::{
    is_rate_limit_ai_error, is_retryable_ai_error, resolve_first_byte_timeout_ms,
    retry_delay_for_attempt,
  };
  let max_attempts = max_retries.saturating_add(1);
  let first_byte_timeout_ms = resolve_first_byte_timeout_ms(context_chars);
  let mut last_error = String::from("模型请求失败");

  if let Some(messages) = body.get("messages").and_then(|v| v.as_array()) {
    let normalized = normalize_messages_for_chat_api(messages.clone());
    if let Some(obj) = body.as_object_mut() {
      obj.insert("messages".into(), serde_json::Value::Array(normalized));
    }
  }

  let request_body = body.clone();

  for attempt in 1..=max_attempts {
    if is_cancelled() {
      return Err("已取消".into());
    }

    match chat_completion_stream_once(
      endpoint,
      api_key,
      &request_body,
      first_byte_timeout_ms,
    )
    .await
    {
      Ok(resp) => return Ok(resp),
      Err(err) => {
        last_error = err.error.clone();
        let retryable = is_retryable_ai_error(err.status, &err.error, &err.raw_text, err.fetch_error);
        if !retryable || attempt >= max_attempts {
          return Err(err.error);
        }
        let rate_limited = is_rate_limit_ai_error(err.status, &err.error, &err.raw_text);
        let delay = retry_delay_for_attempt(attempt, rate_limited);
        on_retry(attempt, max_attempts, &err.error);
        tokio::time::sleep(delay).await;
      }
    }
  }

  Err(last_error)
}


#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_resolve_chat_endpoint_empty() {
    assert_eq!(resolve_chat_endpoint(""), "");
  }

  #[test]
  fn test_resolve_chat_endpoint_already_chat_completions() {
    let url = "https://api.openai.com/v1/chat/completions";
    assert_eq!(resolve_chat_endpoint(url), url);
  }

  #[test]
  fn test_resolve_chat_endpoint_completions_replaced() {
    let result = resolve_chat_endpoint("https://api.openai.com/v1/completions");
    assert_eq!(result, "https://api.openai.com/v1/chat/completions");
  }

  #[test]
  fn test_resolve_chat_endpoint_audio_speech_replaced() {
    let result = resolve_chat_endpoint("https://api.openai.com/v1/audio/speech");
    assert_eq!(result, "https://api.openai.com/v1/chat/completions");
  }

  #[test]
  fn test_resolve_chat_endpoint_no_trailing_path() {
    let result = resolve_chat_endpoint("https://api.openai.com/v1");
    assert_eq!(result, "https://api.openai.com/v1/chat/completions");
  }

  #[test]
  fn test_resolve_chat_endpoint_trailing_slash() {
    let result = resolve_chat_endpoint("https://api.openai.com/v1/");
    assert_eq!(result, "https://api.openai.com/v1/chat/completions");
  }

  #[test]
  fn test_resolve_chat_endpoint_double_trailing_slash() {
    let result = resolve_chat_endpoint("https://api.openai.com/v1//");
    assert_eq!(result, "https://api.openai.com/v1/chat/completions");
  }

  #[test]
  fn test_resolve_chat_endpoint_whitespace_trimmed() {
    let result = resolve_chat_endpoint("  https://api.openai.com/v1/chat/completions  ");
    assert_eq!(result, "https://api.openai.com/v1/chat/completions");
  }

  #[test]
  fn test_resolve_chat_endpoint_custom_base() {
    let result = resolve_chat_endpoint("http://localhost:11434");
    assert_eq!(result, "http://localhost:11434/chat/completions");
  }

  #[test]
  fn test_resolve_chat_endpoint_substring_safe() {
    let result = resolve_chat_endpoint("https://api.example.com/v1/my-endpoint");
    assert_eq!(result, "https://api.example.com/v1/my-endpoint/chat/completions");
  }
}

pub async fn fetch_models(endpoint: &str, api_key: Option<&str>) -> Result<serde_json::Value, String> {
  let base = endpoint.trim().trim_end_matches('/');
  let url = if base.ends_with("/models") {
    base.to_string()
  } else {
    format!("{base}/models")
  };
  let client = reqwest::Client::new();
  let mut req = client.get(url);
  if let Some(key) = api_key.filter(|k| !k.is_empty()) {
    req = req.bearer_auth(key);
  }
  let resp = req.send().await.map_err(|e| e.to_string())?;
  let text = resp.text().await.map_err(|e| e.to_string())?;
  serde_json::from_str(&text).map_err(|e| e.to_string())
}
