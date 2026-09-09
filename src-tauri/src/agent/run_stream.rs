use futures_util::StreamExt;
use reqwest::Response;
use serde_json::{json, Value};
use std::sync::atomic::AtomicBool;
use std::time::Instant;
use tauri::ipc::Channel;

use super::run_emit::{emit, emit_aborted_done, is_cancelled};

/// Token usage reported by the provider for a single model turn.
///
/// Covers both OpenAI-style (`prompt_tokens_details.cached_tokens`) and
/// Anthropic-style (`cache_read_input_tokens` / `cache_creation_input_tokens`)
/// cache accounting. Fields are `None` when the provider did not report them.
#[derive(Debug, Default, Clone)]
pub(crate) struct UsageStats {
    /// Total input (prompt) tokens for the turn.
    pub prompt_tokens: Option<u64>,
    /// OpenAI-style: tokens served from the prompt cache.
    pub cached_tokens: Option<u64>,
    /// Anthropic-style: tokens read from the cache.
    pub cache_read_tokens: Option<u64>,
    /// Anthropic-style: tokens written into the cache.
    pub cache_creation_tokens: Option<u64>,
}

impl UsageStats {
    /// Best-effort cache-hit ratio in `[0.0, 1.0]`, or `None` when the provider
    /// did not report enough data to compute it.
    pub fn hit_ratio(&self) -> Option<f64> {
        // OpenAI-style: cached / prompt.
        if let (Some(cached), Some(prompt)) = (self.cached_tokens, self.prompt_tokens) {
            if prompt > 0 {
                return Some(cached as f64 / prompt as f64);
            }
        }
        // Anthropic-style: cache_read / (cache_read + cache_creation + non-cached input).
        if let Some(read) = self.cache_read_tokens {
            let creation = self.cache_creation_tokens.unwrap_or(0);
            let prompt = self.prompt_tokens.unwrap_or(0);
            let denominator = read + creation + prompt;
            if denominator > 0 {
                return Some(read as f64 / denominator as f64);
            }
        }
        None
    }
}

pub(crate) struct ModelTurnOutput {
    pub assistant_text: String,
    pub tool_calls: Vec<Value>,
    pub tool_calls_value: Value,
    pub is_final: bool,
    /// Structured choice options the model emitted via `<ai_options>` block (stripped from assistant_text).
    pub options: Vec<Value>,
    /// Token usage reported by the provider for this turn.
    pub usage: UsageStats,
}

const AI_OPTIONS_START: &str = "<ai_options>";
const AI_OPTIONS_END: &str = "</ai_options>";

/// Extract a trailing `<ai_options>["a","b"]</ai_options>` block from model text.
/// Returns (clean_text_without_block, options). Options must be a JSON array of >=2 non-empty strings.
fn extract_structured_options(text: &str) -> (String, Vec<Value>) {
    let Some(start_idx) = text.find(AI_OPTIONS_START) else {
        return (text.to_string(), Vec::new());
    };
    let after_start = &text[start_idx + AI_OPTIONS_START.len()..];
    let Some(end_idx) = after_start.find(AI_OPTIONS_END) else {
        return (text.to_string(), Vec::new());
    };
    let json_str = after_start[..end_idx].trim();
    let clean = format!(
        "{}{}",
        text[..start_idx].trim_end(),
        &after_start[end_idx + AI_OPTIONS_END.len()..]
    );
    let Ok(parsed) = serde_json::from_str::<Value>(json_str) else {
        return (text.to_string(), Vec::new());
    };
    let Some(arr) = parsed.as_array() else {
        return (text.to_string(), Vec::new());
    };
    let options: Vec<Value> = arr
        .iter()
        .filter_map(|v| v.as_str())
        .map(|s| json!(s.trim()))
        .filter(|v| !v.as_str().unwrap_or("").is_empty())
        .collect();
    if options.len() >= 2 {
        (clean, options)
    } else {
        (text.to_string(), Vec::new())
    }
}

/// Batch content deltas before sending via IPC to reduce per-character overhead.
/// Flushes when: buffer >= 80 chars, 8ms elapsed, newline encountered, or stream ends.
struct DeltaBatcher {
    buffer: String,
    last_flush: Instant,
}

const DELTA_BATCH_MAX_CHARS: usize = 80;
const DELTA_BATCH_MAX_MS: u128 = 8;

impl DeltaBatcher {
    fn new() -> Self {
        Self {
            buffer: String::with_capacity(256),
            last_flush: Instant::now(),
        }
    }

    fn push(&mut self, delta: &str, channel: &Channel<Value>) {
        self.buffer.push_str(delta);
        let has_newline = delta.contains('\n');
        let size_exceeded = self.buffer.len() >= DELTA_BATCH_MAX_CHARS;
        let time_exceeded = self.last_flush.elapsed().as_millis() >= DELTA_BATCH_MAX_MS;
        if has_newline || size_exceeded || time_exceeded {
            self.flush(channel);
        }
    }

    fn flush(&mut self, channel: &Channel<Value>) {
        if self.buffer.is_empty() {
            return;
        }
        let batched = std::mem::take(&mut self.buffer);
        self.last_flush = Instant::now();
        emit(
            channel,
            json!({ "type": "message_delta", "data": { "delta": batched } }),
        );
    }
}

/// Returns `None` when the run was cancelled mid-stream.
pub(crate) async fn consume_model_sse_stream(
    stream_resp: Response,
    channel: &Channel<Value>,
    cancel: &AtomicBool,
    written_files: &[String],
    actual_turns: u32,
) -> Result<Option<ModelTurnOutput>, String> {
    let mut accumulated_content = String::new();
    let mut accumulated_tool_calls: Vec<Value> = Vec::new();
    let mut usage = UsageStats::default();
    let mut byte_stream = stream_resp.bytes_stream();
    let mut line_buf: Vec<u8> = Vec::new();
    let mut batcher = DeltaBatcher::new();
    let mut suppress_stream = false;

    while let Some(chunk_result) = byte_stream.next().await {
        if is_cancelled(cancel) {
            batcher.flush(channel);
            emit_aborted_done(channel, written_files, actual_turns);
            return Ok(None);
        }
        let chunk = chunk_result.map_err(|e| e.to_string())?;
        line_buf.extend_from_slice(&chunk);
        while let Some(pos) = line_buf.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = line_buf.drain(..=pos).collect();
            let line_str = String::from_utf8_lossy(&line_bytes);
            parse_sse_line(
                &line_str,
                &mut accumulated_content,
                &mut accumulated_tool_calls,
                &mut usage,
                &mut batcher,
                channel,
                &mut suppress_stream,
            );
        }
    }
    if !line_buf.is_empty() {
        let line_str = String::from_utf8_lossy(&line_buf);
        parse_sse_line(
            &line_str,
            &mut accumulated_content,
            &mut accumulated_tool_calls,
            &mut usage,
            &mut batcher,
            channel,
            &mut suppress_stream,
        );
    }
    batcher.flush(channel);

    let tool_calls_value = if accumulated_tool_calls.is_empty() {
        json!([])
    } else {
        json!(accumulated_tool_calls)
    };
    let tool_calls = tool_calls_value.as_array().cloned().unwrap_or_default();
    let (assistant_text, options) = extract_structured_options(&accumulated_content);
    Ok(Some(ModelTurnOutput {
        assistant_text,
        tool_calls,
        tool_calls_value,
        is_final: accumulated_tool_calls.is_empty(),
        options,
        usage,
    }))
}

fn parse_sse_line(
    line_buf: &str,
    accumulated_content: &mut String,
    accumulated_tool_calls: &mut Vec<Value>,
    usage: &mut UsageStats,
    batcher: &mut DeltaBatcher,
    channel: &Channel<Value>,
    suppress_stream: &mut bool,
) {
    let line = line_buf.trim();
    if line.is_empty() || !line.starts_with("data: ") {
        return;
    }
    let data = line.strip_prefix("data: ").unwrap_or("");
    if data == "[DONE]" {
        return;
    }
    let Ok(chunk_json) = serde_json::from_str::<Value>(data) else {
        return;
    };
    // Usage may arrive on the final chunk (OpenAI) or on a dedicated event
    // (Anthropic). Capture it whenever present.
    if let Some(u) = chunk_json.get("usage") {
        capture_usage(u, usage);
    }
    let Some(choices) = chunk_json.get("choices").and_then(|c| c.as_array()) else {
        return;
    };
    let Some(choice) = choices.first() else {
        return;
    };
    let Some(delta) = choice.get("delta") else {
        return;
    };
    if let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
        accumulated_content.push_str(content);
        if !*suppress_stream {
            if let Some(start) = content.find(AI_OPTIONS_START) {
                *suppress_stream = true;
                let before = &content[..start];
                if !before.is_empty() {
                    batcher.push(before, channel);
                }
            } else {
                batcher.push(content, channel);
            }
        }
    }
    if let Some(tcs) = delta.get("tool_calls").and_then(|t| t.as_array()) {
        for tc in tcs {
            let idx = tc
                .get("index")
                .and_then(|i| i.as_u64())
                .unwrap_or(0)
                .min(100) as usize;
            while accumulated_tool_calls.len() <= idx {
                accumulated_tool_calls.push(json!({
                  "id": "", "type": "function",
                  "function": { "name": "", "arguments": "" }
                }));
            }
            if let Some(id) = tc.get("id").and_then(|v| v.as_str()) {
                if !id.is_empty() {
                    accumulated_tool_calls[idx]["id"] = json!(id);
                }
            }
            if let Some(func) = tc.get("function") {
                if let Some(name) = func.get("name").and_then(|v| v.as_str()) {
                    if !name.is_empty() {
                        accumulated_tool_calls[idx]["function"]["name"] = json!(name);
                    }
                }
                if let Some(args_delta) = func.get("arguments").and_then(|v| v.as_str()) {
                    let existing = accumulated_tool_calls[idx]["function"]["arguments"]
                        .as_str()
                        .unwrap_or("")
                        .to_string();
                    accumulated_tool_calls[idx]["function"]["arguments"] =
                        json!(format!("{existing}{args_delta}"));
                }
            }
        }
    }
}

/// Extract cache/token usage from a provider `usage` object into `UsageStats`.
///
/// Handles both OpenAI-style (`prompt_tokens` + `prompt_tokens_details.cached_tokens`)
/// and Anthropic-style (`input_tokens` + `cache_read_input_tokens` +
/// `cache_creation_input_tokens`) shapes. Missing fields are left untouched so a
/// later chunk can fill them in.
fn capture_usage(usage_value: &Value, usage: &mut UsageStats) {
    let as_u64 = |v: &Value| v.as_u64();

    // OpenAI-style.
    if let Some(prompt) = usage_value.get("prompt_tokens").and_then(as_u64) {
        usage.prompt_tokens = Some(prompt);
    }
    if let Some(cached) = usage_value
        .pointer("/prompt_tokens_details/cached_tokens")
        .and_then(as_u64)
    {
        usage.cached_tokens = Some(cached);
    }

    // Anthropic-style.
    if let Some(input) = usage_value.get("input_tokens").and_then(as_u64) {
        usage.prompt_tokens = Some(input);
    }
    if let Some(read) = usage_value.get("cache_read_input_tokens").and_then(as_u64) {
        usage.cache_read_tokens = Some(read);
    }
    if let Some(created) = usage_value.get("cache_creation_input_tokens").and_then(as_u64) {
        usage.cache_creation_tokens = Some(created);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Construct a dummy channel for testing (events are silent no-ops).
    fn dummy_channel() -> Channel<Value> {
        Channel::new(|_| Ok(()))
    }

    fn new_batcher() -> DeltaBatcher {
        DeltaBatcher::new()
    }

    /// Test wrapper that supplies a fresh suppress flag (streaming not suppressed).
    fn parse_line(
        line_buf: &str,
        content: &mut String,
        calls: &mut Vec<Value>,
        batcher: &mut DeltaBatcher,
        channel: &Channel<Value>,
    ) {
        let mut suppress = false;
        let mut usage = UsageStats::default();
        parse_sse_line(line_buf, content, calls, &mut usage, batcher, channel, &mut suppress);
    }

    #[test]
    fn parse_sse_line_skips_empty_line() {
        let mut content = String::new();
        let mut calls = Vec::new();
        parse_line(
            "",
            &mut content,
            &mut calls,
            &mut new_batcher(),
            &dummy_channel(),
        );
        assert!(content.is_empty());
        assert!(calls.is_empty());
    }

    #[test]
    fn parse_sse_line_skips_non_data_line() {
        let mut content = String::new();
        let mut calls = Vec::new();
        parse_line(
            ": heartbeat",
            &mut content,
            &mut calls,
            &mut new_batcher(),
            &dummy_channel(),
        );
        assert!(content.is_empty());
    }

    #[test]
    fn parse_sse_line_skips_done_signal() {
        let mut content = String::new();
        let mut calls = Vec::new();
        parse_line(
            "data: [DONE]",
            &mut content,
            &mut calls,
            &mut new_batcher(),
            &dummy_channel(),
        );
        assert!(content.is_empty());
    }

    #[test]
    fn parse_sse_line_invalid_json() {
        let mut content = String::new();
        let mut calls = Vec::new();
        parse_line(
            "data: {invalid",
            &mut content,
            &mut calls,
            &mut new_batcher(),
            &dummy_channel(),
        );
        assert!(content.is_empty());
    }

    #[test]
    fn parse_sse_line_no_choices() {
        let mut content = String::new();
        let mut calls = Vec::new();
        parse_line(
            "data: {}",
            &mut content,
            &mut calls,
            &mut new_batcher(),
            &dummy_channel(),
        );
        assert!(content.is_empty());
    }

    #[test]
    fn parse_sse_line_empty_choices() {
        let mut content = String::new();
        let mut calls = Vec::new();
        parse_line(
            "data: {\"choices\":[]}",
            &mut content,
            &mut calls,
            &mut new_batcher(),
            &dummy_channel(),
        );
        assert!(content.is_empty());
    }

    #[test]
    fn parse_sse_line_content_delta() {
        let mut content = String::new();
        let mut calls = Vec::new();
        parse_line(
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}",
            &mut content,
            &mut calls,
            &mut new_batcher(),
            &dummy_channel(),
        );
        assert_eq!(content, "Hello");
        assert!(calls.is_empty());
    }

    #[test]
    fn parse_sse_line_accumulates_content() {
        let mut content = String::new();
        let mut calls = Vec::new();
        parse_line(
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}",
            &mut content,
            &mut calls,
            &mut new_batcher(),
            &dummy_channel(),
        );
        parse_line(
            "data: {\"choices\":[{\"delta\":{\"content\":\" World\"}}]}",
            &mut content,
            &mut calls,
            &mut new_batcher(),
            &dummy_channel(),
        );
        assert_eq!(content, "Hello World");
    }

    #[test]
    fn parse_sse_line_tool_call_creates_entry() {
        let mut content = String::new();
        let mut calls = Vec::new();
        parse_line(
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"read_file\",\"arguments\":\"{}\"}}]}}]}",
      &mut content, &mut calls, &mut new_batcher(), &dummy_channel(),
    );
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["function"]["name"], "read_file");
    }

    #[test]
    fn parse_sse_line_tool_call_accumulates_arguments() {
        let mut content = String::new();
        let mut calls = Vec::new();
        // First chunk: tool call starts
        parse_line(
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"read_file\",\"arguments\":\"{\\\"path\\\":\\\"\"}}]}}]}",
      &mut content, &mut calls, &mut new_batcher(), &dummy_channel(),
    );
        // Second chunk: argument continues
        parse_line(
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"src/foo.ts\\\"}\"}}]}}]}",
      &mut content, &mut calls, &mut new_batcher(), &dummy_channel(),
    );
        assert_eq!(
            calls[0]["function"]["arguments"],
            "{\"path\":\"src/foo.ts\"}"
        );
    }

    #[test]
    fn parse_sse_line_tool_call_with_id() {
        let mut content = String::new();
        let mut calls = Vec::new();
        parse_line(
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_abc123\",\"function\":{\"name\":\"grep\",\"arguments\":\"{}\"}}]}}]}",
      &mut content, &mut calls, &mut new_batcher(), &dummy_channel(),
    );
        assert_eq!(calls[0]["id"], "call_abc123");
        assert_eq!(calls[0]["function"]["name"], "grep");
    }

    #[test]
    fn parse_sse_line_multiple_tool_calls() {
        let mut content = String::new();
        let mut calls = Vec::new();
        parse_line(
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"read_file\",\"arguments\":\"{}\"}},{\"index\":1,\"function\":{\"name\":\"grep\",\"arguments\":\"{}\"}}]}}]}",
      &mut content, &mut calls, &mut new_batcher(), &dummy_channel(),
    );
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0]["function"]["name"], "read_file");
        assert_eq!(calls[1]["function"]["name"], "grep");
    }

    #[test]
    fn parse_sse_line_tool_call_fills_gaps() {
        let mut content = String::new();
        let mut calls = Vec::new();
        // Index 2, but indices 0 and 1 don't exist yet �?should fill with empty placeholders
        parse_line(
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":2,\"function\":{\"name\":\"write_file\",\"arguments\":\"{}\"}}]}}]}",
      &mut content, &mut calls, &mut new_batcher(), &dummy_channel(),
    );
        assert_eq!(calls.len(), 3);
        assert!(calls[0]["function"]["name"].as_str().unwrap().is_empty());
        assert!(calls[1]["function"]["name"].as_str().unwrap().is_empty());
        assert_eq!(calls[2]["function"]["name"], "write_file");
    }

    #[test]
    fn parse_sse_line_tool_call_index_capped_at_100() {
        let mut content = String::new();
        let mut calls = Vec::new();
        // Index 999 should be capped to 100, resulting in vec of 101 elements (0..=100)
        parse_line(
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":999,\"function\":{\"name\":\"x\",\"arguments\":\"{}\"}}]}}]}",
      &mut content, &mut calls, &mut new_batcher(), &dummy_channel(),
    );
        assert_eq!(calls.len(), 101, "index 999 capped to 100 �?vec len 101");
        assert_eq!(calls[100]["function"]["name"], "x");
    }

    #[test]
    fn parse_sse_line_interleaved_content_and_tool_calls() {
        let mut content = String::new();
        let mut calls = Vec::new();
        // First: text content
        parse_line(
            "data: {\"choices\":[{\"delta\":{\"content\":\"Let me check\"}}]}",
            &mut content,
            &mut calls,
            &mut new_batcher(),
            &dummy_channel(),
        );
        // Then: tool call
        parse_line(
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"read_file\",\"arguments\":\"{}\"}}]}}]}",
      &mut content, &mut calls, &mut new_batcher(), &dummy_channel(),
    );
        assert_eq!(content, "Let me check");
        assert_eq!(calls.len(), 1);
    }

    #[test]
    fn parse_sse_line_empty_name_skipped() {
        let mut content = String::new();
        let mut calls = Vec::new();
        parse_line(
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"\",\"arguments\":\"{}\"}}]}}]}",
      &mut content, &mut calls, &mut new_batcher(), &dummy_channel(),
    );
        // Name is empty, should remain as default ""
        assert_eq!(calls[0]["function"]["name"], "");
    }

    #[test]
    fn parse_sse_line_empty_id_skipped() {
        let mut content = String::new();
        let mut calls = Vec::new();
        parse_line(
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"\",\"function\":{\"name\":\"foo\",\"arguments\":\"{}\"}}]}}]}",
      &mut content, &mut calls, &mut new_batcher(), &dummy_channel(),
    );
        // ID is empty, should remain as default ""
        assert_eq!(calls[0]["id"], "");
    }

    #[test]
    fn parse_sse_line_malformed_choices_ignored() {
        let mut content = String::new();
        let mut calls = Vec::new();
        // choices is not an array
        parse_line(
            "data: {\"choices\":{\"delta\":{\"content\":\"x\"}}}",
            &mut content,
            &mut calls,
            &mut new_batcher(),
            &dummy_channel(),
        );
        assert!(content.is_empty());
    }

    #[test]
    fn parse_sse_line_no_delta_ignored() {
        let mut content = String::new();
        let mut calls = Vec::new();
        parse_line(
            "data: {\"choices\":[{}]}",
            &mut content,
            &mut calls,
            &mut new_batcher(),
            &dummy_channel(),
        );
        assert!(content.is_empty());
    }

    #[test]
    fn parse_sse_line_tool_call_without_function() {
        let mut content = String::new();
        let mut calls = Vec::new();
        parse_line(
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0}]}}]}",
            &mut content,
            &mut calls,
            &mut new_batcher(),
            &dummy_channel(),
        );
        assert_eq!(calls.len(), 1);
        // Should still have the placeholder entry
        assert!(calls[0]["function"]["name"].as_str().unwrap().is_empty());
    }

    #[test]
    fn extract_structured_options_strips_block() {
        let (clean, options) = extract_structured_options(
            "要我继续吗？\n<ai_options>[\"好，继续\",\"换个方案\"]</ai_options>",
        );
        assert_eq!(clean, "要我继续吗？");
        assert_eq!(options.len(), 2);
        assert_eq!(options[0], json!("好，继续"));
        assert_eq!(options[1], json!("换个方案"));
    }

    #[test]
    fn extract_structured_options_no_block() {
        let (clean, options) = extract_structured_options("普通回复，没有选项。");
        assert_eq!(clean, "普通回复，没有选项。");
        assert!(options.is_empty());
    }

    #[test]
    fn extract_structured_options_single_option_rejected() {
        let (clean, options) =
            extract_structured_options("<ai_options>[\"只有一个\"]</ai_options>");
        // Invalid (fewer than 2) → keep original text, no options.
        assert_eq!(clean, "<ai_options>[\"只有一个\"]</ai_options>");
        assert!(options.is_empty());
    }

    #[test]
    fn extract_structured_options_invalid_json_keeps_text() {
        let (clean, options) = extract_structured_options("<ai_options>not json</ai_options>");
        assert_eq!(clean, "<ai_options>not json</ai_options>");
        assert!(options.is_empty());
    }

    #[test]
    fn capture_usage_openai_style() {
        let mut usage = UsageStats::default();
        capture_usage(
            &json!({
                "prompt_tokens": 1000,
                "completion_tokens": 50,
                "prompt_tokens_details": { "cached_tokens": 400 }
            }),
            &mut usage,
        );
        assert_eq!(usage.prompt_tokens, Some(1000));
        assert_eq!(usage.cached_tokens, Some(400));
        assert_eq!(usage.cache_read_tokens, None);
        assert_eq!(usage.cache_creation_tokens, None);
        let ratio = usage.hit_ratio().unwrap();
        assert!((ratio - 0.4).abs() < 1e-9);
    }

    #[test]
    fn capture_usage_anthropic_style() {
        let mut usage = UsageStats::default();
        capture_usage(
            &json!({
                "input_tokens": 300,
                "output_tokens": 20,
                "cache_read_input_tokens": 200,
                "cache_creation_input_tokens": 100
            }),
            &mut usage,
        );
        assert_eq!(usage.prompt_tokens, Some(300));
        assert_eq!(usage.cache_read_tokens, Some(200));
        assert_eq!(usage.cache_creation_tokens, Some(100));
        // read / (read + creation + input) = 200 / (200 + 100 + 300) = 1/3
        let ratio = usage.hit_ratio().unwrap();
        assert!((ratio - 1.0 / 3.0).abs() < 1e-9);
    }

    #[test]
    fn capture_usage_missing_fields_yields_no_ratio() {
        let mut usage = UsageStats::default();
        capture_usage(&json!({ "completion_tokens": 5 }), &mut usage);
        assert!(usage.hit_ratio().is_none());
    }

    #[test]
    fn capture_usage_accumulates_across_chunks() {
        let mut usage = UsageStats::default();
        // First chunk: OpenAI prompt_tokens only.
        capture_usage(&json!({ "prompt_tokens": 1000 }), &mut usage);
        // Later chunk: cached_tokens arrives.
        capture_usage(
            &json!({ "prompt_tokens_details": { "cached_tokens": 300 } }),
            &mut usage,
        );
        assert_eq!(usage.prompt_tokens, Some(1000));
        assert_eq!(usage.cached_tokens, Some(300));
        let ratio = usage.hit_ratio().unwrap();
        assert!((ratio - 0.3).abs() < 1e-9);
    }
}
