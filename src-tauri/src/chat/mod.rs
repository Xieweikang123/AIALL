use crate::paths::resolve_aiall_session_data_dir;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

fn chat_dir() -> PathBuf {
  resolve_aiall_session_data_dir()
}

pub(crate) fn store_file() -> PathBuf {
  chat_dir().join("chat-store.json")
}

pub(crate) fn session_file(session_id: &str) -> PathBuf {
  let safe: String = session_id
    .chars()
    .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
    .collect();
  chat_dir().join(format!("chat-{safe}.json"))
}

pub async fn chat_store_load(project_path: &str, load_messages: bool) -> Value {
  let store_path = store_file();
  let raw = match tokio::fs::read_to_string(&store_path).await {
    Ok(s) => s,
    Err(_) => return json!({ "ok": false, "error": "磁盘上没有会话备份" }),
  };
  let mut index: Value = match serde_json::from_str(&raw) {
    Ok(v) => v,
    Err(e) => return json!({ "ok": false, "error": e.to_string() }),
  };
  // 校验 projectPath 是否匹配，防止跨项目污染
  let stored_path = index.get("projectPath").and_then(|v| v.as_str()).unwrap_or("");
  let norm = |p: &str| p.trim().replace('\\', "/").trim_end_matches('/').to_lowercase();
  if !stored_path.is_empty() && norm(stored_path) != norm(project_path) {
    return json!({ "ok": false, "error": "磁盘上没有会话备份" });
  }
  if !load_messages {
    return json!({ "ok": true, "data": index });
  }
  let sessions = index
    .get_mut("sessions")
    .and_then(|s| s.as_array_mut());
  if let Some(metas) = sessions {
    for meta in metas.iter_mut() {
      let sid = meta.get("id").and_then(|v| v.as_str()).unwrap_or("");
      if sid.is_empty() {
        continue;
      }
      let path = session_file(sid);
      if let Ok(content) = tokio::fs::read_to_string(&path).await {
        if let Ok(session) = serde_json::from_str::<Value>(&content) {
          if let Some(msgs) = session.get("messages") {
            meta.as_object_mut()
              .map(|o| o.insert("messages".into(), msgs.clone()));
          }
        }
      }
    }
  }
  json!({ "ok": true, "data": index })
}

pub async fn chat_session_messages(project_path: &str, session_id: &str) -> Value {
  let _ = project_path;
  let path = session_file(session_id);
  match tokio::fs::read_to_string(&path).await {
    Ok(content) => {
      let session: Value = serde_json::from_str(&content).unwrap_or(json!({}));
      json!({
        "ok": true,
        "data": {
          "sessionId": session_id,
          "messages": session.get("messages").cloned().unwrap_or(json!([]))
        }
      })
    }
    Err(_) => json!({ "ok": false, "error": "会话文件不存在" }),
  }
}

pub async fn chat_store_sync(_project_path: &str, data: Value) -> Value {
  let dir = chat_dir();
  let _ = tokio::fs::create_dir_all(&dir).await;
  let store_path = store_file();
  if let Some(sessions) = data.get("sessions").and_then(|s| s.as_array()) {
    for session in sessions {
      if let Some(id) = session.get("id").and_then(|v| v.as_str()) {
        let file = session_file(id);
        let _ = tokio::fs::write(&file, serde_json::to_string_pretty(session).unwrap_or_default()).await;
      }
    }
  }
  match tokio::fs::write(&store_path, serde_json::to_string_pretty(&data).unwrap_or_default()).await {
    Ok(_) => {
      let count = data.get("sessions").and_then(|s| s.as_array()).map(|a| a.len()).unwrap_or(0);
      json!({
        "ok": true,
        "sessionCount": count,
        "activeSessionId": data.get("activeSessionId").cloned().unwrap_or(json!("")),
        "syncedAt": chrono::Utc::now().to_rfc3339(),
        "sessions": data.get("sessions").cloned().unwrap_or(json!([]))
      })
    }
    Err(e) => json!({ "ok": false, "error": e.to_string() }),
  }
}

pub async fn chat_session_sync(project_path: &str, session_id: &str, data: Value, active_session_id: Option<&str>) -> Value {
  let dir = chat_dir();
  let _ = tokio::fs::create_dir_all(&dir).await;
  let _ = tokio::fs::write(session_file(session_id), serde_json::to_string_pretty(&data).unwrap_or_default()).await;
  let store_path = store_file();
  let mut index: Value = tokio::fs::read_to_string(&store_path)
    .await
    .ok()
    .and_then(|s| serde_json::from_str(&s).ok())
    .unwrap_or(json!({
      "version": 3,
      "projectPath": project_path,
      "activeSessionId": active_session_id.unwrap_or(session_id),
      "sessions": []
    }));
  let messages_len = data.get("messages").and_then(|m| m.as_array()).map(|a| a.len()).unwrap_or(0);
  let entry = json!({
    "id": session_id,
    "title": data.get("title").cloned().unwrap_or(json!("新会话")),
    "createdAt": data.get("createdAt").cloned().unwrap_or(json!(chrono::Utc::now().to_rfc3339())),
    "updatedAt": data.get("updatedAt").cloned().unwrap_or(json!(chrono::Utc::now().to_rfc3339())),
    "messageCount": messages_len,
    "file": format!("chat-{}.json", session_id.replace(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_', "_")),
    "status": data.get("status").cloned().unwrap_or(json!("active"))
  });
  if let Some(sessions) = index.get_mut("sessions").and_then(|s| s.as_array_mut()) {
    if let Some(pos) = sessions.iter().position(|s| s.get("id") == Some(&json!(session_id))) {
      sessions[pos] = entry;
    } else {
      sessions.insert(0, entry);
    }
  } else {
    index["sessions"] = json!([entry]);
  }
  if let Some(active) = active_session_id {
    index["activeSessionId"] = json!(active);
  }
  index["syncedAt"] = json!(chrono::Utc::now().to_rfc3339());
  let _ = tokio::fs::write(&store_path, serde_json::to_string_pretty(&index).unwrap_or_default()).await;
  json!({ "ok": true })
}

pub async fn chat_session_delete(project_path: &str, session_id: &str, active_session_id: Option<&str>) -> Value {
  let _ = project_path;
  let _ = tokio::fs::remove_file(session_file(session_id)).await;
  let store_path = store_file();
  let mut index: Value = tokio::fs::read_to_string(&store_path)
    .await
    .ok()
    .and_then(|s| serde_json::from_str(&s).ok())
    .unwrap_or(json!({ "sessions": [], "activeSessionId": "" }));
  if let Some(sessions) = index.get_mut("sessions").and_then(|s| s.as_array_mut()) {
    sessions.retain(|s| s.get("id") != Some(&json!(session_id)));
  }
  let active = active_session_id.unwrap_or("");
  if index.get("activeSessionId") == Some(&json!(session_id)) {
    index["activeSessionId"] = json!(index.get("sessions").and_then(|s| s.as_array()).and_then(|a| a.first()).and_then(|s| s.get("id")).cloned().unwrap_or(json!("")));
  } else if !active.is_empty() {
    index["activeSessionId"] = json!(active);
  }
  index["syncedAt"] = json!(chrono::Utc::now().to_rfc3339());
  let _ = tokio::fs::write(&store_path, serde_json::to_string_pretty(&index).unwrap_or_default()).await;
  json!({
    "ok": true,
    "activeSessionId": index.get("activeSessionId").cloned().unwrap_or(json!("")),
    "sessionCount": index.get("sessions").and_then(|s| s.as_array()).map(|a| a.len()).unwrap_or(0),
    "syncedAt": index.get("syncedAt").cloned().unwrap_or(json!("")),
    "sessions": index.get("sessions").cloned().unwrap_or(json!([]))
  })
}

pub async fn chat_image_data_url(project_path: &str, ref_path: &str) -> Value {
  let full = Path::new(project_path).join(ref_path);
  match tokio::fs::read(&full).await {
    Ok(bytes) => {
      let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes);
      json!({ "ok": true, "dataUrl": format!("data:image/png;base64,{b64}") })
    }
    Err(e) => json!({ "ok": false, "error": e.to_string() }),
  }
}

pub async fn chat_image_file_bytes(project_path: &str, ref_path: &str) -> Result<Vec<u8>, String> {
  let full = Path::new(project_path).join(ref_path);
  tokio::fs::read(&full).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_session_file_sanitizes_alphanumeric() {
    let path = session_file("abc-123_def");
    let name = path.file_name().unwrap().to_string_lossy();
    assert_eq!(name, "chat-abc-123_def.json");
  }

  #[test]
  fn test_session_file_replaces_special_chars() {
    let path = session_file("hello/world:test?foo=bar&baz");
    let name = path.file_name().unwrap().to_string_lossy();
    assert!(!name.contains('/'));
    assert!(!name.contains(':'));
    assert!(!name.contains('?'));
    assert_eq!(name, "chat-hello_world_test_foo_bar_baz.json");
  }

  #[test]
  fn test_session_file_empty_id() {
    let path = session_file("");
    let name = path.file_name().unwrap().to_string_lossy();
    assert_eq!(name, "chat-.json");
  }

  #[test]
  fn test_session_file_unicode_becomes_underscore() {
    let path = session_file("会话测试");
    let name = path.file_name().unwrap().to_string_lossy();
    assert_eq!(name, "chat-____.json");
  }

  #[test]
  fn test_session_file_all_special_chars() {
    let path = session_file("!@#$%^&*()");
    let name = path.file_name().unwrap().to_string_lossy();
    assert_eq!(name, "chat-__________.json");
  }

  #[test]
  fn test_store_file_path() {
    let path = store_file();
    let name = path.file_name().unwrap().to_string_lossy();
    assert_eq!(name, "chat-store.json");
  }

  #[test]
  fn test_session_and_store_share_parent() {
    let store = store_file();
    let session = session_file("test");
    assert_eq!(store.parent(), session.parent());
  }
}
