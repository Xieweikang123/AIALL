use futures_util::StreamExt;
use reqwest::Response;
use serde_json::{json, Value};
use std::sync::atomic::AtomicBool;
use std::time::Instant;
use tauri::ipc::Channel;

use super::run_emit::{emit, emit_aborted_done, is_cancelled};

pub(crate) struct ModelTurnOutput {
    pub assistant_text: String,
    pub tool_calls: Vec<Value>,
    pub tool_calls_value: Value,
    pub is_final: bool,
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
    let mut byte_stream = stream_resp.bytes_stream();
    let mut line_buf: Vec<u8> = Vec::new();
    let mut batcher = DeltaBatcher::new();

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
                &mut batcher,
                channel,
            );
        }
    }
    if !line_buf.is_empty() {
        let line_str = String::from_utf8_lossy(&line_buf);
        parse_sse_line(
            &line_str,
            &mut accumulated_content,
            &mut accumulated_tool_calls,
            &mut batcher,
            channel,
        );
    }
    batcher.flush(channel);

    let tool_calls_value = if accumulated_tool_calls.is_empty() {
        json!([])
    } else {
        json!(accumulated_tool_calls)
    };
    let tool_calls = tool_calls_value.as_array().cloned().unwrap_or_default();
    Ok(Some(ModelTurnOutput {
        assistant_text: accumulated_content,
        tool_calls,
        tool_calls_value,
        is_final: accumulated_tool_calls.is_empty(),
    }))
}

fn parse_sse_line(
    line_buf: &str,
    accumulated_content: &mut String,
    accumulated_tool_calls: &mut Vec<Value>,
    batcher: &mut DeltaBatcher,
    channel: &Channel<Value>,
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
        batcher.push(content, channel);
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

    #[test]
    fn parse_sse_line_skips_empty_line() {
        let mut content = String::new();
        let mut calls = Vec::new();
        parse_sse_line(
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
        parse_sse_line(
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
        parse_sse_line(
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
        parse_sse_line(
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
        parse_sse_line(
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
        parse_sse_line(
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
        parse_sse_line(
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
        parse_sse_line(
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}",
            &mut content,
            &mut calls,
            &mut new_batcher(),
            &dummy_channel(),
        );
        parse_sse_line(
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
        parse_sse_line(
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
        parse_sse_line(
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"read_file\",\"arguments\":\"{\\\"path\\\":\\\"\"}}]}}]}",
      &mut content, &mut calls, &mut new_batcher(), &dummy_channel(),
    );
        // Second chunk: argument continues
        parse_sse_line(
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
        parse_sse_line(
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
        parse_sse_line(
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
        // Index 2, but indices 0 and 1 don't exist yet — should fill with empty placeholders
        parse_sse_line(
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
        parse_sse_line(
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":999,\"function\":{\"name\":\"x\",\"arguments\":\"{}\"}}]}}]}",
      &mut content, &mut calls, &mut new_batcher(), &dummy_channel(),
    );
        assert_eq!(calls.len(), 101, "index 999 capped to 100 → vec len 101");
        assert_eq!(calls[100]["function"]["name"], "x");
    }

    #[test]
    fn parse_sse_line_interleaved_content_and_tool_calls() {
        let mut content = String::new();
        let mut calls = Vec::new();
        // First: text content
        parse_sse_line(
            "data: {\"choices\":[{\"delta\":{\"content\":\"Let me check\"}}]}",
            &mut content,
            &mut calls,
            &mut new_batcher(),
            &dummy_channel(),
        );
        // Then: tool call
        parse_sse_line(
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
        parse_sse_line(
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
        parse_sse_line(
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
        parse_sse_line(
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
        parse_sse_line(
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
        parse_sse_line(
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
}
