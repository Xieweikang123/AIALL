use crate::project;
use serde_json::Value;

#[tauri::command]
pub async fn project_memory_get(project_path: String) -> Value {
  project::read_text_file(&project_path, ".aiall/project-memory.md").await
}

#[tauri::command]
pub async fn project_memory_save(project_path: String, content: String) -> Value {
  project::write_text_file(&project_path, ".aiall/project-memory.md", &content).await
}

#[tauri::command]
pub async fn project_knowledge_get(project_path: String) -> Value {
  project::read_text_file(&project_path, ".aiall/project-knowledge.md").await
}

#[tauri::command]
pub async fn project_knowledge_save(project_path: String, content: String) -> Value {
  project::write_text_file(&project_path, ".aiall/project-knowledge.md", &content).await
}

#[tauri::command]
pub async fn project_skills_list(project_path: String, slug: Option<String>) -> Value {
  project::list_skills(&project_path, slug.as_deref()).await
}

#[tauri::command]
pub async fn project_skills_save(project_path: String, slug: String, content: String) -> Value {
  project::upsert_skill(&project_path, &slug, &content).await
}

#[tauri::command]
pub async fn project_architect_review_get(project_path: String) -> Value {
  project::read_text_file(&project_path, ".aiall/architect-review/latest.md").await
}

#[tauri::command]
pub async fn project_architect_review_save(project_path: String, content: String) -> Value {
  project::write_text_file(&project_path, ".aiall/architect-review/latest.md", &content).await
}

#[tauri::command]
pub async fn project_architect_review_context(project_path: String) -> Value {
  project::project_context(&project_path).await
}

#[tauri::command]
pub async fn project_architect_review_history(project_path: String, review_id: Option<String>) -> Value {
  let rel = review_id
    .map(|id| format!(".aiall/architect-review/history/{id}.json"))
    .unwrap_or_else(|| ".aiall/architect-review/history/index.json".into());
  project::read_text_file(&project_path, &rel).await
}

#[tauri::command]
pub async fn project_architect_review_history_delete(project_path: String, review_id: String) -> Value {
  let path = std::path::Path::new(&project_path)
    .join(".aiall/architect-review/history")
    .join(format!("{review_id}.json"));
  match tokio::fs::remove_file(&path).await {
    Ok(_) => serde_json::json!({ "ok": true }),
    Err(e) => serde_json::json!({ "ok": false, "error": e.to_string() }),
  }
}

#[tauri::command]
pub async fn project_health_scan(project_path: String) -> Value {
  project::project_health_scan(&project_path).await
}

#[tauri::command]
pub async fn project_verify_run(project_path: String) -> Value {
  project::project_verify_run(&project_path).await
}

#[tauri::command]
pub async fn project_context(path: String) -> Value {
  project::project_context(&path).await
}

#[tauri::command]
pub async fn code_map_build(project_path: String, git_head: Option<String>) -> Value {
  project::build_code_map(&project_path, git_head.as_deref()).await
}

#[tauri::command]
pub async fn project_symbol_search(
  project_path: String,
  query: String,
  max_results: Option<u32>,
) -> Value {
  let max = max_results.unwrap_or(20) as usize;
  let results = project::project_symbol_search(&project_path, &query, max);
  serde_json::json!({ "ok": true, "results": results })
}

#[tauri::command]
pub async fn memory_usage(payload: serde_json::Value) -> Value {
  let project_path = payload
    .get("projectPath")
    .or_else(|| payload.get("project_path"))
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .to_string();
  let memory_content = payload
    .get("memoryContent")
    .or_else(|| payload.get("memory_content"))
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .to_string();
  let assistant_response = payload
    .get("assistantResponse")
    .or_else(|| payload.get("assistant_response"))
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .to_string();
  project::memory_usage_track_command(project_path, memory_content, assistant_response).await
}

#[tauri::command]
pub async fn debug_log_write(label: String, data: Option<String>) -> Value {
  use crate::paths::resolve_debug_log_path;
  use std::fs::{create_dir_all, OpenOptions};
  use std::io::Write;

  let timestamp = chrono::Utc::now().format("%H:%M:%S%.3f").to_string();
  let line = if let Some(d) = &data {
    format!("[{}] {}: {}\n", timestamp, label, d)
  } else {
    format!("[{}] {}\n", timestamp, label)
  };

  let log_path = match resolve_debug_log_path("debug.log", None) {
    Ok(p) => p,
    Err(e) => return serde_json::json!({ "ok": false, "error": e }),
  };
  if let Some(parent) = log_path.parent() {
    let _ = create_dir_all(parent);
  }

  match OpenOptions::new()
    .create(true)
    .append(true)
    .open(&log_path)
  {
    Ok(mut f) => {
      let _ = f.write_all(line.as_bytes());
      serde_json::json!({ "ok": true })
    }
    Err(e) => serde_json::json!({ "ok": false, "error": e.to_string() }),
  }
}
