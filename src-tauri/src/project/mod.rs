use crate::fs;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

mod health_scan;
mod memory_usage;
mod stack_profile;
mod verify_run;

pub use health_scan::project_health_scan;
pub use memory_usage::memory_usage_track_command;
pub use stack_profile::{
  detect_project_stack_profile, format_minimal_project_context_block, MinimalProjectContextRoute,
  ProjectStackProfile,
};
pub use verify_run::project_verify_run;

pub(crate) fn project_file(root: &str, rel: &str) -> PathBuf {
  Path::new(root).join(rel)
}

pub async fn read_text_file(root: &str, rel: &str) -> Value {
  let path = project_file(root, rel);
  match tokio::fs::read_to_string(&path).await {
    Ok(content) => json!({ "ok": true, "content": content, "path": path.to_string_lossy() }),
    Err(e) => json!({ "ok": false, "error": e.to_string() }),
  }
}

pub async fn write_text_file(root: &str, rel: &str, content: &str) -> Value {
  let path = project_file(root, rel);
  if let Some(parent) = path.parent() {
    let _ = tokio::fs::create_dir_all(parent).await;
  }
  match tokio::fs::write(&path, content).await {
    Ok(_) => json!({ "ok": true, "path": path.to_string_lossy() }),
    Err(e) => json!({ "ok": false, "error": e.to_string() }),
  }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthIssue {
  pub id: String,
  pub severity: String,
  pub title: String,
  pub detail: String,
  pub category: String,
  pub file: String,
  pub line: u32,
  pub pattern: String,
}

pub async fn project_context(project_path: &str) -> Value {
  let root = Path::new(project_path);
  let mut lines = Vec::new();
  fn walk(dir: &Path, prefix: &str, depth: usize, lines: &mut Vec<String>) {
    if depth > 4 {
      return;
    }
    let Ok(read) = std::fs::read_dir(dir) else { return };
    for entry in read.flatten() {
      let name = entry.file_name().to_string_lossy().into_owned();
      if fs::should_list_directory_entry(&name, entry.file_type().map(|t| t.is_dir()).unwrap_or(false)) {
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        lines.push(format!("{prefix}{name}{}", if is_dir { "/" } else { "" }));
        if is_dir {
          walk(&entry.path(), &format!("{prefix}  "), depth + 1, lines);
        }
      }
    }
  }
  walk(root, "", 0, &mut lines);
  json!({
    "ok": true,
    "path": project_path,
    "tree": lines.join("\n"),
    "keyFiles": [],
    "truncated": false
  })
}

pub async fn list_skills(project_path: &str, slug: Option<&str>) -> Value {
  let dir = project_file(project_path, ".aiall/skills");
  if let Some(slug) = slug {
    let path = dir.join(format!("{slug}.md"));
    return read_text_file(project_path, &format!(".aiall/skills/{slug}.md")).await;
  }
  let mut skills = Vec::new();
  if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
    while let Ok(Some(entry)) = entries.next_entry().await {
      if entry.path().extension().and_then(|e| e.to_str()) == Some("md") {
        skills.push(json!({ "slug": entry.path().file_stem().and_then(|s| s.to_str()).unwrap_or("") }));
      }
    }
  }
  json!({ "ok": true, "skills": skills })
}

pub async fn upsert_skill(project_path: &str, slug: &str, content: &str) -> Value {
  write_text_file(project_path, &format!(".aiall/skills/{slug}.md"), content).await
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_health_issue_struct() {
    let issue = HealthIssue {
      id: "test-0".into(),
      severity: "warning".into(),
      title: "test title".into(),
      detail: "detail text".into(),
      category: "smell".into(),
      file: "src/main.rs".into(),
      line: 42,
      pattern: "test".into(),
    };
    assert_eq!(issue.id, "test-0");
    assert_eq!(issue.severity, "warning");
    assert_eq!(issue.title, "test title");
    assert_eq!(issue.detail, "detail text");
    assert_eq!(issue.category, "smell");
    assert_eq!(issue.file, "src/main.rs");
    assert_eq!(issue.line, 42);
    assert_eq!(issue.pattern, "test");
  }

  #[test]
  fn test_health_issue_serialize() {
    let issue = HealthIssue {
      id: "err-0".into(),
      severity: "error".into(),
      title: "security".into(),
      detail: "eval use".into(),
      category: "security".into(),
      file: "app.js".into(),
      line: 1,
      pattern: "eval".into(),
    };
    let json = serde_json::to_value(&issue).unwrap();
    assert_eq!(json["id"], "err-0");
    assert_eq!(json["severity"], "error");
    assert_eq!(json["category"], "security");
    assert_eq!(json["line"], 1);
    // camelCase rename
    assert!(json.get("id").is_some());
    assert!(json.get("severity").is_some());
  }

  #[test]
  fn test_project_file_joins_path() {
    let path = project_file("/root", "sub/file.txt");
    assert_eq!(path.to_string_lossy().replace('\\', "/"), "/root/sub/file.txt");
  }
}
