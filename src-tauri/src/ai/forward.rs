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
  let url = resolve_chat_endpoint(endpoint);
  let client = reqwest::Client::new();
  let mut req = client.post(url).json(&body);
  if let Some(key) = api_key.filter(|k| !k.is_empty()) {
    req = req.bearer_auth(key);
  }
  let resp = req.send().await.map_err(|e| e.to_string())?;
  let status = resp.status();
  if !status.is_success() {
    let text = resp.text().await.map_err(|e| e.to_string())?;
    return Err(format!("HTTP {status}: {text}"));
  }
  Ok(resp)
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
