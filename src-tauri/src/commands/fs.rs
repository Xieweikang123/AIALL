use crate::fs;
use crate::paths::resolve_path_inside_optional_root;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::State;

#[derive(Default)]
pub struct DirCache(Mutex<HashMap<String, (Vec<fs::FileEntry>, Instant)>>);

const CACHE_TTL: Duration = Duration::from_secs(30);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResult {
    pub ok: bool,
    pub path: String,
    pub items: Vec<fs::FileEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub async fn fs_list(path: String, cache: State<'_, DirCache>) -> Result<ListResult, String> {
    let resolved = match path.trim().is_empty() {
        true => {
            return Ok(ListResult {
                ok: false,
                path,
                items: vec![],
                error: Some("缺少 path 参数".into()),
            })
        }
        false => path.clone(),
    };

    if let Ok(guard) = cache.0.lock() {
        if let Some((items, ts)) = guard.get(&resolved) {
            if ts.elapsed() < CACHE_TTL {
                return Ok(ListResult {
                    ok: true,
                    path: resolved,
                    items: items.clone(),
                    error: None,
                });
            }
        }
    }

    let result = fs_list_core(resolved.clone()).await;
    if let Ok(ok) = &result {
        if ok.ok {
            if let Ok(mut guard) = cache.0.lock() {
                guard.insert(resolved.clone(), (ok.items.clone(), Instant::now()));
            }
        }
    }
    result
}

/// Directory listing without the Tauri `State` cache — shared by the desktop
/// command and the HTTP server (see `http_routes`).
pub async fn fs_list_core(path: String) -> Result<ListResult, String> {
    let resolved = match path.trim().is_empty() {
        true => {
            return Ok(ListResult {
                ok: false,
                path,
                items: vec![],
                error: Some("缺少 path 参数".into()),
            })
        }
        false => path.clone(),
    };

    if let Ok(meta) = tokio::fs::metadata(&resolved).await {
        if !meta.is_dir() {
            return Ok(ListResult {
                ok: false,
                path: resolved,
                items: vec![],
                error: Some("路径不存在或不是目录".into()),
            });
        }
    } else {
        return Ok(ListResult {
            ok: false,
            path: resolved,
            items: vec![],
            error: Some("路径不存在或不是目录".into()),
        });
    }

    match fs::list_directory(&resolved).await {
        Ok(items) => Ok(ListResult {
            ok: true,
            path: resolved,
            items,
            error: None,
        }),
        Err(error) => Ok(ListResult {
            ok: false,
            path: resolved,
            items: vec![],
            error: Some(error),
        }),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    pub ok: bool,
    pub content: String,
    pub path: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub async fn fs_read(path: String, project_root: Option<String>) -> ReadResult {
    let resolved = match resolve_path_inside_optional_root(&path, project_root.as_deref()) {
        Ok(p) => p,
        Err(error) => {
            return ReadResult {
                ok: false,
                content: String::new(),
                path,
                size: 0,
                error: Some(error),
            }
        }
    };
    let meta = tokio::fs::metadata(&resolved).await;
    match meta {
        Err(e) => {
            return ReadResult {
                ok: false,
                content: String::new(),
                path: resolved.to_string_lossy().into_owned(),
                size: 0,
                error: Some(format!("无法读取文件元数据: {}", e)),
            };
        }
        Ok(m) if !m.is_file() => {
            return ReadResult {
                ok: false,
                content: String::new(),
                path: resolved.to_string_lossy().into_owned(),
                size: 0,
                error: Some("文件不存在".into()),
            };
        }
        _ => {}
    }
    let result = fs::read_file_content(&resolved.to_string_lossy()).await;
    ReadResult {
        ok: result.ok,
        content: result.content,
        path: resolved.to_string_lossy().into_owned(),
        size: result.size,
        error: result.error,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub ok: bool,
    pub path: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub async fn fs_write(path: String, content: String, project_root: Option<String>) -> WriteResult {
    let resolved = match resolve_path_inside_optional_root(&path, project_root.as_deref()) {
        Ok(p) => p,
        Err(error) => {
            return WriteResult {
                ok: false,
                path,
                size: 0,
                error: Some(error),
            }
        }
    };
    match fs::write_file_content(&resolved.to_string_lossy(), &content).await {
        Ok(size) => WriteResult {
            ok: true,
            path: resolved.to_string_lossy().into_owned(),
            size,
            error: None,
        },
        Err(error) => WriteResult {
            ok: false,
            path: resolved.to_string_lossy().into_owned(),
            size: 0,
            error: Some(error),
        },
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub ok: bool,
    pub results: Vec<SearchHit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub async fn fs_search(path: String, q: String) -> SearchResult {
    if path.trim().is_empty() || q.trim().is_empty() {
        return SearchResult {
            ok: false,
            results: vec![],
            error: Some("缺少 path 或 q 参数".into()),
        };
    }
    match fs::search_files(&path, &q, 30).await {
        Ok(items) => SearchResult {
            ok: true,
            results: items
                .into_iter()
                .map(|e| SearchHit {
                    name: e.name,
                    path: e.path,
                    is_directory: e.is_directory,
                })
                .collect(),
            error: None,
        },
        Err(error) => SearchResult {
            ok: false,
            results: vec![],
            error: Some(error),
        },
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepHit {
    pub path: String,
    pub relative: String,
    pub line: u32,
    pub text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepResult {
    pub ok: bool,
    pub results: Vec<GrepHit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub async fn fs_grep(path: String, q: String) -> GrepResult {
    if path.trim().is_empty() || q.trim().is_empty() {
        return GrepResult {
            ok: false,
            results: vec![],
            error: Some("缺少 path 或 q 参数".into()),
        };
    }
    match fs::grep_in_project(&path, &q, 50).await {
        Ok(matches) => GrepResult {
            ok: true,
            results: matches
                .into_iter()
                .map(|m| GrepHit {
                    path: m.file,
                    relative: m.relative,
                    line: m.line,
                    text: m.text,
                })
                .collect(),
            error: None,
        },
        Err(error) => GrepResult {
            ok: false,
            results: vec![],
            error: Some(error),
        },
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateResult {
    pub ok: bool,
    pub path: String,
    pub r#type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub async fn fs_create(
    path: String,
    is_directory: bool,
    content: Option<String>,
    project_root: Option<String>,
) -> CreateResult {
    let resolved = match resolve_path_inside_optional_root(&path, project_root.as_deref()) {
        Ok(p) => p,
        Err(error) => {
            return CreateResult {
                ok: false,
                path,
                r#type: String::new(),
                error: Some(error),
            }
        }
    };
    let resolved_str = resolved.to_string_lossy().into_owned();
    match fs::create_item(&resolved_str, is_directory, content.as_deref()).await {
        Ok(_) => CreateResult {
            ok: true,
            path: resolved_str,
            r#type: if is_directory { "directory" } else { "file" }.into(),
            error: None,
        },
        Err(error) => CreateResult {
            ok: false,
            path: resolved_str,
            r#type: String::new(),
            error: Some(error),
        },
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    pub ok: bool,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub async fn fs_delete(path: String, project_root: Option<String>) -> DeleteResult {
    let resolved = match resolve_path_inside_optional_root(&path, project_root.as_deref()) {
        Ok(p) => p,
        Err(error) => {
            return DeleteResult {
                ok: false,
                path,
                error: Some(error),
            }
        }
    };
    let resolved_str = resolved.to_string_lossy().into_owned();
    match fs::delete_item(&resolved_str).await {
        Ok(p) => DeleteResult {
            ok: true,
            path: p,
            error: None,
        },
        Err(error) => DeleteResult {
            ok: false,
            path: resolved_str,
            error: Some(error),
        },
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameResult {
    pub ok: bool,
    pub from: String,
    pub to: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub async fn fs_rename(from: String, to: String, project_root: Option<String>) -> RenameResult {
    let from_resolved = match resolve_path_inside_optional_root(&from, project_root.as_deref()) {
        Ok(p) => p,
        Err(error) => {
            return RenameResult {
                ok: false,
                from,
                to,
                error: Some(error),
            }
        }
    };
    let to_resolved = match resolve_path_inside_optional_root(&to, project_root.as_deref()) {
        Ok(p) => p,
        Err(error) => {
            return RenameResult {
                ok: false,
                from: from_resolved.to_string_lossy().into_owned(),
                to,
                error: Some(error),
            }
        }
    };
    match fs::rename_item(
        &from_resolved.to_string_lossy(),
        &to_resolved.to_string_lossy(),
    )
    .await
    {
        Ok((f, t)) => RenameResult {
            ok: true,
            from: f,
            to: t,
            error: None,
        },
        Err(error) => RenameResult {
            ok: false,
            from: from_resolved.to_string_lossy().into_owned(),
            to: to_resolved.to_string_lossy().into_owned(),
            error: Some(error),
        },
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    pub name: String,
    pub path: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DrivesResult {
    pub ok: bool,
    pub system: String,
    pub drives: Vec<DriveInfo>,
    pub current_dir: String,
    pub home_dir: Option<String>,
}

#[tauri::command]
pub async fn fs_drives() -> Result<DrivesResult, String> {
    Ok(fs_drives_core())
}

pub fn fs_drives_core() -> DrivesResult {
    let mut drives = Vec::new();
    #[cfg(target_os = "windows")]
    {
        for letter in b'A'..=b'Z' {
            let drive_str = format!("{}:\\", letter as char);
            let path = std::path::Path::new(&drive_str);
            if path.exists() {
                drives.push(DriveInfo {
                    name: format!("{}: 盘", letter as char),
                    path: drive_str,
                });
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        drives.push(DriveInfo {
            name: "根目录 (/)".into(),
            path: "/".into(),
        });
        if let Some(home) = std::env::var("HOME").ok().filter(|s| !s.is_empty()) {
            drives.push(DriveInfo {
                name: "用户主目录 (~/)".into(),
                path: home,
            });
        }
    }

    let current_dir = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let home_dir = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .filter(|s| !s.is_empty());

    DrivesResult {
        ok: true,
        system: std::env::consts::OS.to_string(),
        drives,
        current_dir,
        home_dir,
    }
}

