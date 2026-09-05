//! Project history store shared by desktop Tauri command and agent-server.
//!
//! Storage is a single JSON file under the aiall data dir
//! (`%APPDATA%/aiall/project-history.json` on Windows, `~/.config/aiall/`
//! elsewhere). Both the desktop runtime and the agent-server read/write this
//! same file so recent projects are consistent across web / desktop.

use crate::paths::resolve_project_history_path;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::Path;

const STORE_VERSION: u32 = 1;
const MAX_ENTRIES: usize = 50;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectHistoryEntry {
    pub path: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "lastOpenedAt")]
    pub last_opened_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProjectHistoryStore {
    version: u32,
    entries: Vec<ProjectHistoryEntry>,
}

fn normalize_key(path: &str) -> String {
    path.trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_lowercase()
}

fn display_name_from_path(path: &str) -> String {
    let normalized = path.trim().replace('\\', "/").trim_end_matches('/').to_string();
    match normalized.rsplit('/').next() {
        Some(seg) if !seg.is_empty() => seg.to_string(),
        _ => normalized,
    }
}

fn empty_store() -> ProjectHistoryStore {
    ProjectHistoryStore {
        version: STORE_VERSION,
        entries: Vec::new(),
    }
}

fn read_store_at(path: &Path) -> ProjectHistoryStore {
    let Ok(text) = fs::read_to_string(path) else {
        return empty_store();
    };
    match serde_json::from_str::<ProjectHistoryStore>(&text) {
        Ok(mut store) => {
            store.entries.retain(|e| !e.path.trim().is_empty());
            store
        }
        Err(_) => empty_store(),
    }
}

fn write_store_at(path: &Path, store: &ProjectHistoryStore) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建项目历史目录失败: {e}"))?;
    }
    let text = serde_json::to_string_pretty(store)
        .map_err(|e| format!("序列化项目历史失败: {e}"))?;
    fs::write(path, text).map_err(|e| format!("写入项目历史失败: {e}"))
}

fn default_path() -> std::path::PathBuf {
    resolve_project_history_path()
}

/// List all recent projects, most-recently-opened first.
pub fn list_project_history() -> Vec<ProjectHistoryEntry> {
    read_store_at(&default_path()).entries
}

/// Upsert a project into history (move to front, keep newest timestamp).
pub fn add_project_to_history(path: &str) -> Result<(), String> {
    add_project_to_history_at(&default_path(), path)
}

fn add_project_to_history_at(store_path: &Path, path: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let key = normalize_key(trimmed);
    if key.is_empty() {
        return Ok(());
    }
    let mut store = read_store_at(store_path);
    let now = chrono_or_iso_now();
    let display = display_name_from_path(trimmed);
    if let Some(existing) = store
        .entries
        .iter_mut()
        .find(|e| normalize_key(&e.path) == key)
    {
        existing.path = trimmed.to_string();
        existing.display_name = display;
        existing.last_opened_at = now.clone();
        store.entries = std::iter::once(existing.clone())
            .chain(store.entries.into_iter().filter(|e| normalize_key(&e.path) != key))
            .collect();
    } else {
        store.entries.insert(
            0,
            ProjectHistoryEntry {
                path: trimmed.to_string(),
                display_name: display,
                last_opened_at: now,
            },
        );
    }
    if store.entries.len() > MAX_ENTRIES {
        store.entries.truncate(MAX_ENTRIES);
    }
    write_store_at(store_path, &store)
}

/// Remove a single project from history.
pub fn remove_project_from_history(path: &str) -> Result<(), String> {
    let key = normalize_key(path);
    if key.is_empty() {
        return Ok(());
    }
    let path = default_path();
    let mut store = read_store_at(&path);
    let before = store.entries.len();
    store
        .entries
        .retain(|e| normalize_key(&e.path) != key);
    if store.entries.len() == before {
        return Ok(());
    }
    write_store_at(&path, &store)
}

/// Clear all project history.
pub fn clear_project_history() -> Result<(), String> {
    let path = default_path();
    write_store_at(&path, &empty_store())
}

/// Convert a stored entry to a JSON value (camelCase) for HTTP responses.
pub fn entry_to_json(entry: &ProjectHistoryEntry) -> Value {
    serde_json::json!({
        "path": entry.path,
        "displayName": entry.display_name,
        "lastOpenedAt": entry.last_opened_at,
    })
}

fn chrono_or_iso_now() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_store(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "aiall-ph-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir.join("project-history.json")
    }

    #[test]
    fn add_deduplicates_and_moves_to_front() {
        let path = unique_store("dedup");
        add_project_to_history_at(&path, "D:/proj/a").unwrap();
        add_project_to_history_at(&path, "D:/proj/b").unwrap();
        add_project_to_history_at(&path, "D:/proj/a").unwrap();
        let list = read_store_at(&path).entries;
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].path, "D:/proj/a");
        assert_eq!(list[1].path, "D:/proj/b");
        assert!(list[0].last_opened_at >= list[1].last_opened_at);
    }

    #[test]
    fn remove_and_clear() {
        let path = unique_store("remove");
        add_project_to_history_at(&path, "D:/proj/a").unwrap();
        add_project_to_history_at(&path, "D:/proj/b").unwrap();

        // remove via primitives
        let mut store = read_store_at(&path);
        store.entries.retain(|e| normalize_key(&e.path) != "d:/proj/a");
        write_store_at(&path, &store).unwrap();
        let list = read_store_at(&path).entries;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].path, "D:/proj/b");

        // clear
        write_store_at(&path, &empty_store()).unwrap();
        assert!(read_store_at(&path).entries.is_empty());
    }

    #[test]
    fn empty_path_is_ignored() {
        let path = unique_store("empty");
        add_project_to_history_at(&path, "   ").unwrap();
        assert!(read_store_at(&path).entries.is_empty());
    }
}
