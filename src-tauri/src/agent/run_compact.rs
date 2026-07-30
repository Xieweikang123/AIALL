//! Compact message list before model calls (ported from shared/agentMessageCompact.ts).

use serde_json::{json, Value};

use super::context_limits::{
  MAX_TOOL_RESULT_MODEL_CHARS, SOFT_COMPACT_CONTEXT_CHARS,
};

const PROTECTED_RECENT_TOOL_RESULTS: usize = 2;

pub struct CompactResult {
  pub messages: Vec<Value>,
  pub did_compact: bool,
}

static LINE_HINT_RE: std::sync::LazyLock<regex::Regex> =
  std::sync::LazyLock::new(|| regex::Regex::new(r"lines \d+-\d+").unwrap());

fn truncate_text(text: &str, max: usize, suffix: &str) -> String {
  if text.chars().count() <= max {
    return text.to_string();
  }
  let truncated: String = text.chars().take(max).collect();
  format!(
    "{truncated}\n\n{}",
    suffix.replace("{n}", &text.chars().count().to_string())
  )
}

fn truncate_tool_result_for_model(text: &str) -> String {
  truncate_text(
    text,
    MAX_TOOL_RESULT_MODEL_CHARS,
    "…（内容已截断，共 {n} 字符。如需更多请用 read_file 的 offset/limit 分段读取）",
  )
}

fn content_char_size(content: &Value) -> usize {
  match content {
    Value::String(text) => text.chars().count(),
    Value::Array(parts) => parts
      .iter()
      .map(|part| match part.get("type").and_then(|v| v.as_str()) {
        Some("text") => part
          .get("text")
          .and_then(|v| v.as_str())
          .map(|s| s.chars().count())
          .unwrap_or(0),
        Some("image_url") => part
          .get("image_url")
          .and_then(|v| v.get("url"))
          .and_then(|v| v.as_str())
          .map(|s| s.chars().count())
          .unwrap_or(0),
        _ => 0,
      })
      .sum(),
    _ => 0,
  }
}

fn message_char_size(message: &Value) -> usize {
  let mut size = message
    .get("content")
    .map(content_char_size)
    .unwrap_or(0);
  if let Some(tool_calls) = message.get("tool_calls") {
    size += tool_calls.to_string().chars().count();
  }
  size
}

pub fn messages_char_size(messages: &[Value]) -> usize {
  messages.iter().map(message_char_size).sum()
}

pub fn compact_messages_for_model(messages: &[Value], max_context_chars: usize) -> CompactResult {
  let mut result: Vec<Value> = messages
    .iter()
    .map(|message| {
      if message.get("role").and_then(|v| v.as_str()) != Some("tool") {
        return message.clone();
      }
      let content = message
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("");
      let mut updated = message.clone();
      if let Some(obj) = updated.as_object_mut() {
        obj.insert(
          "content".into(),
          json!(truncate_tool_result_for_model(content)),
        );
      }
      updated
    })
    .collect();

  let mut total: usize = result.iter().map(message_char_size).sum();
  let needs_hard_compact = total > max_context_chars;
  let needs_soft_compact = total > SOFT_COMPACT_CONTEXT_CHARS;
  if !needs_hard_compact && !needs_soft_compact {
    return CompactResult { messages: result, did_compact: false };
  }

  let compress_target = if needs_hard_compact {
    max_context_chars
  } else {
    SOFT_COMPACT_CONTEXT_CHARS
  };

  let tool_indexes: Vec<usize> = result
    .iter()
    .enumerate()
    .filter_map(|(i, m)| {
      if m.get("role").and_then(|v| v.as_str()) == Some("tool") {
        Some(i)
      } else {
        None
      }
    })
    .collect();
  let compressible = tool_indexes.len().saturating_sub(PROTECTED_RECENT_TOOL_RESULTS);

  for &index in tool_indexes.iter().take(compressible) {
    let raw = result[index]
      .get("content")
      .and_then(|v| v.as_str())
      .unwrap_or("")
      .to_string();
    let line_hint = LINE_HINT_RE
      .find(&raw)
      .map(|m| m.as_str())
      .unwrap_or("");
    let prev_size = message_char_size(&result[index]);
    let compressed = if line_hint.is_empty() {
      format!("（较早的工具输出已压缩，约 {} 字符）", raw.chars().count())
    } else {
      format!(
        "（较早的工具输出已压缩，{line_hint}，约 {} 字符）",
        raw.chars().count()
      )
    };
    if let Some(obj) = result[index].as_object_mut() {
      obj.insert("content".into(), json!(compressed));
    }
    total = total.saturating_sub(prev_size) + compressed.chars().count();
    if total <= compress_target {
      break;
    }
  }

  if total > max_context_chars {
    if let Some(system_idx) = result.iter().position(|m| {
      m.get("role").and_then(|v| v.as_str()) == Some("system")
    }) {
      let sys_content = result[system_idx]
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
      let excess = total.saturating_sub(max_context_chars);
      if sys_content.chars().count() > excess + 500 {
        let keep = sys_content.chars().count().saturating_sub(excess + 80);
        let truncated: String = sys_content.chars().take(keep).collect();
        if let Some(obj) = result[system_idx].as_object_mut() {
          obj.insert(
            "content".into(),
            json!(format!("{truncated}\n…（system 上下文已截断）")),
          );
        }
      }
    }
  }

  CompactResult { messages: result, did_compact: true }
}

#[cfg(test)]
mod tests {
  use super::*;
  use super::super::policy::{EXECUTE_PLAN_MAX_CONTEXT_CHARS, MAX_AGENT_CONTEXT_CHARS};

  #[test]
  fn truncates_long_tool_results() {
    let long = "x".repeat(MAX_TOOL_RESULT_MODEL_CHARS + 100);
    let messages = vec![
      json!({ "role": "system", "content": "sys" }),
      json!({ "role": "user", "content": "hi" }),
      json!({ "role": "tool", "tool_call_id": "1", "content": long }),
    ];
    let compacted = compact_messages_for_model(&messages, MAX_AGENT_CONTEXT_CHARS);
    let tool_content = compacted.messages[2]["content"].as_str().unwrap();
    assert!(tool_content.chars().count() < 20_000);
    assert!(tool_content.contains("截断"));
  }

  #[test]
  fn compresses_older_tool_outputs_when_total_context_is_too_large() {
    let messages = vec![
      json!({ "role": "system", "content": "s".repeat(90_000) }),
      json!({ "role": "user", "content": "u".repeat(90_000) }),
      json!({
        "role": "tool",
        "tool_call_id": "1",
        "content": format!("// lines 1-200 of 9000\n{}", "a".repeat(60_000))
      }),
      json!({
        "role": "tool",
        "tool_call_id": "2",
        "content": format!("// lines 201-400 of 9000\n{}", "b".repeat(60_000))
      }),
      json!({
        "role": "tool",
        "tool_call_id": "3",
        "content": format!("// lines 401-600 of 9000\n{}", "c".repeat(60_000))
      }),
    ];
    let compacted = compact_messages_for_model(&messages, MAX_AGENT_CONTEXT_CHARS);
    assert!(compacted.messages[2]["content"].as_str().unwrap().contains("已压缩"));
    assert!(compacted.messages[3]["content"].as_str().unwrap().contains("lines 201-400"));
    assert!(compacted.messages[4]["content"].as_str().unwrap().contains("lines 401-600"));
  }

  #[test]
  fn uses_lower_context_ceiling_for_execute_plan_runs() {
    let messages = vec![
      json!({ "role": "system", "content": "s".repeat(40_000) }),
      json!({ "role": "user", "content": "u".repeat(40_000) }),
      json!({
        "role": "tool",
        "tool_call_id": "1",
        "content": format!("lines 1-100\n{}", "a".repeat(30_000))
      }),
      json!({
        "role": "tool",
        "tool_call_id": "2",
        "content": format!("lines 101-200\n{}", "b".repeat(30_000))
      }),
      json!({
        "role": "tool",
        "tool_call_id": "3",
        "content": format!("lines 201-300\n{}", "c".repeat(30_000))
      }),
    ];
    assert_eq!(EXECUTE_PLAN_MAX_CONTEXT_CHARS, 100_000);
    assert!(
      compact_messages_for_model(&messages, MAX_AGENT_CONTEXT_CHARS).messages[2]["content"]
        .as_str()
        .unwrap()
        .contains("已压缩")
    );
    assert!(
      compact_messages_for_model(&messages, EXECUTE_PLAN_MAX_CONTEXT_CHARS).messages[2]["content"]
        .as_str()
        .unwrap()
        .contains("已压缩")
    );
  }

  #[test]
  fn soft_compacts_older_tool_outputs_before_hard_context_ceiling() {
    let messages = vec![
      json!({ "role": "system", "content": "s".repeat(8_000) }),
      json!({ "role": "user", "content": "u".repeat(8_000) }),
      json!({
        "role": "tool",
        "tool_call_id": "1",
        "content": format!("lines 1-100\n{}", "a".repeat(12_000))
      }),
      json!({
        "role": "tool",
        "tool_call_id": "2",
        "content": format!("lines 101-200\n{}", "b".repeat(12_000))
      }),
      json!({
        "role": "tool",
        "tool_call_id": "3",
        "content": format!("lines 201-300\n{}", "c".repeat(12_000))
      }),
    ];
    assert_eq!(SOFT_COMPACT_CONTEXT_CHARS, 36_000);
    let total_before: usize = messages
      .iter()
      .map(|m| m["content"].as_str().unwrap_or("").chars().count())
      .sum();
    assert!(total_before > SOFT_COMPACT_CONTEXT_CHARS);
    let compacted = compact_messages_for_model(&messages, MAX_AGENT_CONTEXT_CHARS);
    assert!(compacted.messages[2]["content"].as_str().unwrap().contains("已压缩"));
    assert!(compacted.messages[4]["content"].as_str().unwrap().contains("lines 201-300"));
  }

  #[test]
  fn compresses_older_tool_messages_when_over_soft_cap() {
    let mut messages = vec![json!({ "role": "system", "content": "s".repeat(40_000) })];
    for i in 0..4 {
      messages.push(json!({
        "role": "tool",
        "tool_call_id": format!("t{i}"),
        "content": "y".repeat(8_000)
      }));
    }
    let compacted = compact_messages_for_model(&messages, 200_000);
    let first_tool = compacted.messages[1]["content"].as_str().unwrap();
    assert!(first_tool.contains("已压缩"));
  }
}
