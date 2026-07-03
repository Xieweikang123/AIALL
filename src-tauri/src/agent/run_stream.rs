use futures_util::StreamExt;
use reqwest::Response;
use serde_json::{json, Value};
use std::sync::atomic::AtomicBool;
use tauri::ipc::Channel;

use super::run_emit::{emit, emit_aborted_done, is_cancelled};

pub(crate) struct ModelTurnOutput {
  pub assistant_text: String,
  pub tool_calls: Vec<Value>,
  pub tool_calls_value: Value,
  pub is_final: bool,
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
  let mut line_buf = String::new();

  while let Some(chunk_result) = byte_stream.next().await {
    if is_cancelled(cancel) {
      emit_aborted_done(channel, written_files, actual_turns);
      return Ok(None);
    }
    let chunk = chunk_result.map_err(|e| e.to_string())?;
    let chunk_str = String::from_utf8_lossy(&chunk);
    for ch in chunk_str.chars() {
      if ch == '\n' {
        parse_sse_line(&line_buf, &mut accumulated_content, &mut accumulated_tool_calls, channel);
        line_buf.clear();
      } else {
        line_buf.push(ch);
      }
    }
  }
  if !line_buf.is_empty() {
    parse_sse_line(&line_buf, &mut accumulated_content, &mut accumulated_tool_calls, channel);
  }

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
    emit(
      channel,
      json!({ "type": "message_delta", "data": { "delta": content } }),
    );
  }
  if let Some(tcs) = delta.get("tool_calls").and_then(|t| t.as_array()) {
    for tc in tcs {
      let idx = tc.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as usize;
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
