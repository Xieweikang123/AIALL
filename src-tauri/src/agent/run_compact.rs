//! Request-size measurement for model calls.
//!
//! The message-compaction machinery that used to live here (ported from
//! `shared/agentMessageCompact.ts`) was removed: `run.rs` sends messages to the
//! model as-is ("No auto-compression"), so nothing called it. The size helpers
//! below remain because `run.rs` still emits `contextChars` on each
//! `turn_request` event.

use serde_json::Value;

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
    let mut size = message.get("content").map(content_char_size).unwrap_or(0);
    if let Some(tool_calls) = message.get("tool_calls") {
        size += tool_calls.to_string().chars().count();
    }
    size
}

pub fn messages_char_size(messages: &[Value]) -> usize {
    messages.iter().map(message_char_size).sum()
}

/// Size of the `tools` array as serialized into the request body.
///
/// Tool schemas are sent with every model call but live outside the message
/// list, so measuring only messages under-counts the real payload. They are a
/// fixed per-turn overhead worth including in the reported size.
pub fn tools_char_size(tools: &Value) -> usize {
    if tools.as_array().map_or(true, |a| a.is_empty()) {
        return 0;
    }
    tools.to_string().chars().count()
}

/// Messages + tool definitions: the true size of what the model receives.
pub fn request_char_size(messages: &[Value], tools: &Value) -> usize {
    messages_char_size(messages) + tools_char_size(tools)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn messages_char_size_counts_text_and_tool_calls() {
        let messages = vec![
            json!({ "role": "user", "content": "hello" }),
            json!({
              "role": "assistant",
              "tool_calls": [{ "id": "1", "function": { "name": "read_file" } }]
            }),
        ];
        assert!(messages_char_size(&messages) >= "hello".len());
    }

    #[test]
    fn tools_char_size_is_zero_for_empty_or_missing() {
        assert_eq!(tools_char_size(&json!([])), 0);
        assert_eq!(tools_char_size(&Value::Null), 0);
        assert!(tools_char_size(&json!([{ "function": { "name": "x" } }])) > 0);
    }

    #[test]
    fn request_char_size_sums_messages_and_tools() {
        let messages = vec![json!({ "role": "user", "content": "hi" })];
        let tools = json!([{ "function": { "name": "x" } }]);
        assert_eq!(
            request_char_size(&messages, &tools),
            messages_char_size(&messages) + tools_char_size(&tools)
        );
    }
}
