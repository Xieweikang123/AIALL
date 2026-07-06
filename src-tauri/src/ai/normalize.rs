//! Normalize chat message shapes for picky OpenAI-compatible gateways.

use serde_json::{json, Value};

pub fn normalize_messages_for_chat_api(messages: Vec<Value>) -> Vec<Value> {
  messages
    .into_iter()
    .map(|message| {
      let role = message.get("role").and_then(|v| v.as_str()).unwrap_or("");
      if role == "assistant" {
        if let Some(tool_calls) = message.get("tool_calls").and_then(|v| v.as_array()) {
          let filtered: Vec<Value> = tool_calls
            .iter()
            .filter(|call| {
              let id = call.get("id").and_then(|v| v.as_str()).unwrap_or("");
              let name = call
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
              !id.is_empty() && !name.is_empty()
            })
            .cloned()
            .collect();
          let content = match message.get("content") {
            None | Some(Value::Null) => json!(""),
            Some(value) => value.clone(),
          };
          return json!({
            "role": "assistant",
            "content": content,
            "tool_calls": filtered,
          });
        }
      }
      if role == "tool" {
        let content = match message.get("content") {
          None | Some(Value::Null) => json!(""),
          Some(Value::String(s)) => json!(s),
          Some(other) => json!(other.to_string()),
        };
        let mut normalized = message;
        if let Some(obj) = normalized.as_object_mut() {
          obj.insert("content".into(), content);
        }
        return normalized;
      }
      message
    })
    .collect()
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  #[test]
  fn uses_empty_string_when_tool_calls_present_and_content_null() {
    let normalized = normalize_messages_for_chat_api(vec![json!({
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "c1",
        "type": "function",
        "function": { "name": "read_file", "arguments": "{}" }
      }]
    })]);
    assert_eq!(normalized[0]["content"], "");
  }

  #[test]
  fn drops_tool_calls_missing_id_or_name() {
    let normalized = normalize_messages_for_chat_api(vec![json!({
      "role": "assistant",
      "content": "",
      "tool_calls": [
        { "id": "", "type": "function", "function": { "name": "grep", "arguments": "{}" } },
        { "id": "ok", "type": "function", "function": { "name": "read_file", "arguments": "{}" } }
      ]
    })]);
    let calls = normalized[0]["tool_calls"].as_array().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0]["id"], "ok");
  }

  #[test]
  fn coerces_null_tool_content_to_empty_string() {
    let normalized = normalize_messages_for_chat_api(vec![json!({
      "role": "tool",
      "tool_call_id": "1",
      "content": null
    })]);
    assert_eq!(normalized[0]["content"], "");
  }
}
