use crate::paths::{resolve_aiall_debug_log_dir, resolve_debug_log_path};
use serde_json::json;
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tokio::io::AsyncWriteExt;

#[tauri::command]
pub async fn system_open_url(app: AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn system_open_folder(app: AppHandle, path: String) -> serde_json::Value {
    match app.opener().open_path(&path, None::<&str>) {
        Ok(_) => json!({ "ok": true, "path": path }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

/// Append a line to an AppData debug log (`%APPDATA%/aiall/debug-logs[/project-slug]/name`).
/// `path` must be a bare filename (e.g. `debug.log`). `project_root` scopes the file per project.
#[tauri::command]
pub async fn system_debug_log_append(
    path: String,
    line: String,
    project_root: Option<String>,
) -> Result<(), String> {
    let resolved = resolve_debug_log_path(&path, project_root.as_deref())?;
    if let Some(parent) = resolved.parent() {
        if !parent.as_os_str().is_empty() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&resolved)
        .await
        .map_err(|e| e.to_string())?;
    file.write_all(line.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    file.write_all(b"\n").await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn system_pick_folder(app: AppHandle, initial_path: Option<String>) -> serde_json::Value {
    let mut dialog = app.dialog().file().set_title("选择项目文件夹");
    if let Some(path) = initial_path
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
    {
        dialog = dialog.set_directory(path);
    }
    match dialog.blocking_pick_folder() {
        Some(path) => match path.into_path() {
            Ok(p) => json!({ "ok": true, "path": p.to_string_lossy() }),
            Err(e) => json!({ "ok": false, "error": e.to_string() }),
        },
        None => json!({ "ok": false, "cancelled": true }),
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugLogEntry {
    relative_path: String,
    name: String,
    scope: String,
    project_slug: Option<String>,
}

fn is_safe_log_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

/// List all `.log` files under the AppData debug-logs dir (root level + one project-slug level).
#[tauri::command]
pub async fn system_debug_log_list() -> Result<Vec<DebugLogEntry>, String> {
    let root = resolve_aiall_debug_log_dir();
    let mut entries: Vec<DebugLogEntry> = Vec::new();
    let mut project_slugs: Vec<String> = Vec::new();
    if let Ok(mut rd) = tokio::fs::read_dir(&root).await {
        while let Ok(Some(entry)) = rd.next_entry().await {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                    if name.ends_with(".log") && is_safe_log_name(name) {
                        entries.push(DebugLogEntry {
                            relative_path: name.to_string(),
                            name: name.to_string(),
                            scope: "app".to_string(),
                            project_slug: None,
                        });
                    }
                }
            } else if path.is_dir() {
                let slug = entry.file_name().to_string_lossy().to_string();
                if is_safe_log_name(&slug) {
                    project_slugs.push(slug);
                }
            }
        }
    }
    for slug in project_slugs {
        let proj_dir = root.join(&slug);
        if let Ok(mut srd) = tokio::fs::read_dir(&proj_dir).await {
            while let Ok(Some(sub)) = srd.next_entry().await {
                let sp = sub.path();
                if sp.is_file() {
                    if let Some(sname) = sp.file_name().and_then(|s| s.to_str()) {
                        if sname.ends_with(".log") && is_safe_log_name(sname) {
                            entries.push(DebugLogEntry {
                                relative_path: format!("{}/{}", slug, sname),
                                name: sname.to_string(),
                                scope: "project".to_string(),

                                project_slug: Some(slug.clone()),
                            });
                        }
                    }
                }
            }
        }
    }
    entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(entries)
}

/// Read a debug log file by relative path (`name.log` or `slug/name.log`). Must stay within debug-logs root.
#[tauri::command]
pub async fn system_debug_log_read(
    relative_path: String,
    limit_lines: Option<usize>,
) -> Result<String, String> {
    let trimmed = relative_path.trim();
    if trimmed.is_empty() {
        return Err("日志路径不能为空".into());
    }
    let normalized = trimmed.replace('\\', "/");
    if Path::new(trimmed).is_absolute() || normalized.contains("..") {
        return Err("不允许访问该日志路径".into());
    }
    if normalized.matches('/').count() > 1 {
        return Err("不允许访问该日志路径".into());
    }
    for comp in normalized.split('/') {
        if !is_safe_log_name(comp) {
            return Err("不允许访问该日志路径".into());
        }
    }
    let root = resolve_aiall_debug_log_dir();
    let full = root.join(&normalized);
    let root_canon = root.canonicalize().unwrap_or_else(|_| root.clone());
    let full_canon = full.canonicalize().unwrap_or_else(|_| full.clone());
    if !full_canon.starts_with(&root_canon) {
        return Err("不允许访问该日志路径".into());
    }
    let data = tokio::fs::read_to_string(&full)
        .await
        .map_err(|e| e.to_string())?;
    match limit_lines {
        Some(n) if n > 0 => {
            let lines: Vec<&str> = data.lines().collect();
            let start = lines.len().saturating_sub(n);
            Ok(lines[start..].join("\n"))
        }
        _ => Ok(data),
    }
}
