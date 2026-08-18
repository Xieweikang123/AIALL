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
    // OpenAI Responses / Anthropic Messages 是独立 API 路径，不是 chat/completions
    // 的 Base URL：若再拼 /chat/completions 会打到不存在的路径（网关常返回 HTML 页面而非 JSON）。
    if input.ends_with("/responses") || input.ends_with("/messages") {
        return input.to_string();
    }
    format!("{}/chat/completions", input.trim_end_matches('/'))
}

/// 去掉响应体开头的 UTF-8 BOM：部分网关会在 JSON 前带 BOM，导致 serde 解析失败。
fn strip_utf8_bom(text: &str) -> &str {
    text.strip_prefix('\u{feff}').unwrap_or(text)
}

/// 截取响应开头用于报错提示（控制字符替换为「·」，限制长度）。
fn escaped_preview(text: &str, max_chars: usize) -> String {
    let total = text.chars().count();
    let mut out: String = text
        .chars()
        .take(max_chars)
        .map(|c| if c.is_control() { '·' } else { c })
        .collect();
    if total > max_chars {
        out.push('…');
    }
    out
}

/// 提取 HTML 页面标题，用于识别网关/代理返回的错误页。
fn html_title(text: &str) -> Option<String> {
    let lower = text.to_lowercase();
    let start = lower.find("<title>")? + "<title>".len();
    let end = lower[start..].find("</title>")? + start;
    let title = lower[start..end].trim();
    if title.is_empty() {
        None
    } else {
        Some(title.chars().take(80).collect())
    }
}

/// 判断响应体是否像二进制/压缩数据（如 gzip 被当 UTF-8 读出的乱码）。
fn looks_binary(text: &str) -> bool {
    let total = text.chars().count();
    if total == 0 {
        return false;
    }
    let suspicious = text
        .chars()
        .filter(|c| c.is_control() || *c == '\u{FFFD}')
        .count();
    suspicious * 100 / total >= 20
}

/// 生成「响应不是合法 JSON」的可操作错误提示：识别 HTML / 二进制，并附响应开头预览。
fn invalid_json_hint(status: reqwest::StatusCode, text: &str) -> String {
    let trimmed = text.trim_start();
    let preview = escaped_preview(text, 160);
    if trimmed.starts_with('<') {
        let title_suffix = html_title(text)
            .map(|t| format!("（页面标题：{t}）"))
            .unwrap_or_default();
        return format!(
            "服务商返回了 HTML 页面（HTTP {status}）{title_suffix}，可能被网关/代理拦截，或接口地址指向了错误页面；响应开头：{preview}"
        );
    }
    if looks_binary(text) {
        return format!(
            "服务商响应疑似压缩或二进制数据（HTTP {status}），不是可解析的 JSON（客户端未开启自动解压，或接口返回了非文本内容）"
        );
    }
    format!("服务商响应不是有效 JSON（HTTP {status}）；响应开头：{preview}")
}

/// 解析 OpenAI 风格 SSE 流式响应（`data: {...}` 逐行），聚合成一个 chat.completion。
/// 用于服务商无视 stream:false、非流式请求也返回 SSE 的情况。
fn parse_sse_chat_completion(text: &str) -> Option<serde_json::Value> {
    let mut contents: Vec<String> = Vec::new();
    let mut saw_data = false;
    for line in text.lines() {
        let line = line.trim();
        if !line.starts_with("data:") {
            continue;
        }
        let data_str = line["data:".len()..].trim();
        if data_str.is_empty() || data_str == "[DONE]" {
            continue;
        }
        saw_data = true;
        let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data_str) else {
            continue;
        };
        if let Some(c) = parsed
            .pointer("/choices/0/delta/content")
            .and_then(|v| v.as_str())
        {
            contents.push(c.to_string());
        } else if let Some(c) = parsed
            .pointer("/choices/0/message/content")
            .and_then(|v| v.as_str())
        {
            contents.push(c.to_string());
        }
    }
    if !saw_data {
        return None;
    }
    Some(serde_json::json!({
        "object": "chat.completion",
        "choices": [{
            "message": {
                "role": "assistant",
                "content": contents.concat(),
            }
        }],
    }))
}

/// 解析服务商 JSON 响应：去 BOM、识别空响应/HTML/二进制，给出可操作报错。
/// 服务商无视 stream:false 强制返回 SSE 时，自动按流式聚合兜底。
fn parse_json_body(text: &str, status: reqwest::StatusCode) -> Result<serde_json::Value, String> {
    let body = strip_utf8_bom(text);
    if body.trim().is_empty() {
        return Err(format!(
            "服务商返回了空响应（HTTP {status}）：请检查接口地址、API Key 与模型名是否有效"
        ));
    }
    match serde_json::from_str(body) {
        Ok(value) => Ok(value),
        Err(json_err) => {
            if let Some(value) = parse_sse_chat_completion(body) {
                return Ok(value);
            }
            Err(format!(
                "{}（原始错误：{json_err}）",
                invalid_json_hint(status, body)
            ))
        }
    }
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

    let send_result = tokio::time::timeout(
        std::time::Duration::from_millis(MODEL_FIRST_BYTE_TIMEOUT_MS),
        req.send(),
    )
    .await;

    let resp = match send_result {
        Ok(Ok(resp)) => resp,
        Ok(Err(err)) => return Err(err.to_string()),
        Err(_) => {
            let seconds = MODEL_FIRST_BYTE_TIMEOUT_MS.div_ceil(1000);
            return Err(format!("模型响应超时（等待首包超过 {seconds}s）"));
        }
    };
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("HTTP {status}: {text}"));
    }
    parse_json_body(&text, status)
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

        match chat_completion_stream_once(endpoint, api_key, &request_body, first_byte_timeout_ms)
            .await
        {
            Ok(resp) => return Ok(resp),
            Err(err) => {
                last_error = err.error.clone();
                let retryable =
                    is_retryable_ai_error(err.status, &err.error, &err.raw_text, err.fetch_error);
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
    fn test_resolve_chat_endpoint_responses_kept() {
        let result = resolve_chat_endpoint("https://api.example.com/v1/responses");
        assert_eq!(result, "https://api.example.com/v1/responses");
    }

    #[test]
    fn test_resolve_chat_endpoint_messages_kept() {
        let result = resolve_chat_endpoint("https://api.example.com/v1/messages");
        assert_eq!(result, "https://api.example.com/v1/messages");
    }

    #[test]
    fn test_resolve_chat_endpoint_substring_safe() {
        let result = resolve_chat_endpoint("https://api.example.com/v1/my-endpoint");
        assert_eq!(
            result,
            "https://api.example.com/v1/my-endpoint/chat/completions"
        );
    }

    #[test]
    fn test_strip_utf8_bom() {
        assert_eq!(strip_utf8_bom("\u{feff}{\"a\":1}"), "{\"a\":1}");
        assert_eq!(strip_utf8_bom("{\"a\":1}"), "{\"a\":1}");
    }

    #[test]
    fn test_parse_json_body_strips_bom() {
        let value = parse_json_body("\u{feff}{\"a\":1}", reqwest::StatusCode::OK).unwrap();
        assert_eq!(value["a"], 1);
    }

    #[test]
    fn test_parse_json_body_empty() {
        let err = parse_json_body("", reqwest::StatusCode::OK).unwrap_err();
        assert!(err.contains("空响应"));
    }

    #[test]
    fn test_invalid_json_hint_html() {
        let text =
            "<html><head><title>401 Unauthorized</title></head><body>nope</body></html>";
        let hint = invalid_json_hint(reqwest::StatusCode::OK, text);
        assert!(hint.contains("HTML 页面"));
        assert!(hint.contains("401 Unauthorized"));
    }

    #[test]
    fn test_invalid_json_hint_plain_text() {
        let hint = invalid_json_hint(reqwest::StatusCode::OK, "hello world");
        assert!(hint.contains("响应开头：hello world"));
    }

    #[test]
    fn test_parse_sse_chat_completion_aggregates() {
        let sse = "data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"好\"}}]}\r\n\r\ndata: [DONE]\r\n\r\n";
        let value = parse_sse_chat_completion(sse).unwrap();
        assert_eq!(value["choices"][0]["message"]["content"], "你好");
    }

    #[test]
    fn test_parse_json_body_falls_back_to_sse() {
        let sse = "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\r\n\r\ndata: [DONE]\r\n\r\n";
        let value = parse_json_body(sse, reqwest::StatusCode::OK).unwrap();
        assert_eq!(value["choices"][0]["message"]["content"], "hi");
    }
}

pub async fn fetch_models(
    endpoint: &str,
    api_key: Option<&str>,
) -> Result<serde_json::Value, String> {
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
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("HTTP {status}: {text}"));
    }
    parse_json_body(&text, status)
}
