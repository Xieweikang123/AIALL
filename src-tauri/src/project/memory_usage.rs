use serde::{Deserialize, Serialize};
use serde_json::json;

const MEMORY_USAGE_REL: &str = ".aiall/memory-usage.json";
const MEMORY_USAGE_MAX_ENTRIES: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemoryUsageEntry {
  key: String,
  count: u32,
  last_used: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MemoryUsageStore {
  version: u32,
  entries: Vec<MemoryUsageEntry>,
}

fn empty_store() -> MemoryUsageStore {
  MemoryUsageStore {
    version: 1,
    entries: vec![],
  }
}

async fn read_store(project_root: &str) -> MemoryUsageStore {
  let path = crate::project::project_file(project_root, MEMORY_USAGE_REL);
  let Ok(raw) = tokio::fs::read_to_string(&path).await else {
    return empty_store();
  };
  serde_json::from_str(&raw).unwrap_or_else(|_| empty_store())
}

async fn write_store(project_root: &str, mut store: MemoryUsageStore) -> Result<(), String> {
  let path = crate::project::project_file(project_root, MEMORY_USAGE_REL);
  if let Some(parent) = path.parent() {
    tokio::fs::create_dir_all(parent)
      .await
      .map_err(|e| e.to_string())?;
  }
  store.entries.sort_by(|a, b| b.count.cmp(&a.count));
  store.entries.truncate(MEMORY_USAGE_MAX_ENTRIES);
  let raw = serde_json::to_string_pretty(&store).map_err(|e| e.to_string())?;
  tokio::fs::write(&path, raw).await.map_err(|e| e.to_string())
}

fn memory_line_key(line: &str) -> String {
  let mut stripped = line.trim_start_matches("- ").trim().to_string();
  if stripped.starts_with('[') {
    if let Some(end) = stripped.find(']') {
      stripped = stripped[end + 1..].trim().to_string();
    }
  }
  let stripped = stripped.to_lowercase();
  let mut hash: i32 = 0;
  for ch in stripped.chars() {
    hash = hash.wrapping_shl(5).wrapping_sub(hash).wrapping_add(ch as i32);
  }
  format!("m{}", (hash as u32).to_string())
}

pub fn extract_memory_snippets(content: &str) -> Vec<String> {
  content
    .lines()
    .filter(|l| l.starts_with("- "))
    .map(|l| {
      let mut s = l.trim_start_matches("- ").trim().to_string();
      if s.starts_with('[') {
        if let Some(end) = s.find(']') {
          s = s[end + 1..].trim().to_string();
        }
      }
      s.replace('`', "")
    })
    .filter(|s| s.len() >= 6)
    .collect()
}

pub async fn track_memory_usage(
  project_root: &str,
  memory_content: &str,
  assistant_response: &str,
) -> Result<(), String> {
  let snippets = extract_memory_snippets(memory_content);
  if snippets.is_empty() {
    return Ok(());
  }
  let response_lower = assistant_response.to_lowercase();
  let mut store = read_store(project_root).await;
  let now = chrono::Utc::now().to_rfc3339();
  let mut changed = false;

  for snippet in snippets {
    let snippet_lower = snippet.to_lowercase();
    if snippet_lower.len() < 6 {
      continue;
    }
    let prefix: String = snippet_lower.chars().take(20).collect();
    if !response_lower.contains(&prefix) {
      continue;
    }
    let key = memory_line_key(&snippet);
    if let Some(existing) = store.entries.iter_mut().find(|e| e.key == key) {
      existing.count += 1;
      existing.last_used = now.clone();
    } else {
      store.entries.push(MemoryUsageEntry {
        key,
        count: 1,
        last_used: now.clone(),
      });
    }
    changed = true;
  }

  if changed {
    write_store(project_root, store).await?;
  }
  Ok(())
}

pub async fn memory_usage_track_command(
  project_path: String,
  memory_content: String,
  assistant_response: String,
) -> serde_json::Value {
  match track_memory_usage(&project_path, &memory_content, &assistant_response).await {
    Ok(()) => json!({ "ok": true }),
    Err(error) => json!({ "ok": false, "error": error }),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn extract_memory_snippets_filters_short_lines() {
    let snippets = extract_memory_snippets("- ok\n- x\n- long enough snippet");
    assert_eq!(snippets.len(), 1);
    assert!(snippets[0].contains("long enough"));
  }

  #[test]
  fn memory_line_key_stable() {
    assert_eq!(memory_line_key("Hello World"), memory_line_key("Hello World"));
  }
}
