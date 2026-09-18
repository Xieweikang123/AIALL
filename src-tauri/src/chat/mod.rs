use crate::paths::{
    chat_store_root, normalize_project_key, project_chat_meta_file, project_chat_store_dir,
    resolve_aiall_session_data_dir,
};
use base64::Engine;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

/// Per-project session dir. Empty project path falls back to the shared root
/// (legacy behavior) so callers that cannot supply a path still work.
fn chat_dir(project_path: &str) -> PathBuf {
    let scoped = project_chat_store_dir(project_path);
    if scoped == chat_store_root() {
        resolve_aiall_session_data_dir()
    } else {
        scoped
    }
}

pub(crate) fn store_file(project_path: &str) -> PathBuf {
    chat_dir(project_path).join("chat-store.json")
}

fn deleted_file(project_path: &str) -> PathBuf {
    deleted_file_in(&chat_dir(project_path))
}

/// Dir-scoped tombstone path; injectable so migration tests never touch AppData.
fn deleted_file_in(dir: &Path) -> PathBuf {
    dir.join("deleted.json")
}

fn store_file_in(dir: &Path) -> PathBuf {
    dir.join("chat-store.json")
}

pub(crate) const STORE_VERSION: i64 = 3;

fn session_id_safe(session_id: &str) -> String {
    let sanitized: String = session_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if sanitized.chars().all(|c| c == '_') && !session_id.is_empty() {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        session_id.hash(&mut hasher);
        format!("session_{:016x}", hasher.finish())
    } else {
        sanitized
    }
}

/// Canonical on-disk name for a session. The index stores exactly this name so
/// the `file` linkage can never drift from reality.
pub(crate) fn session_file_name(session_id: &str) -> String {
    format!("chat-{}.json", session_id_safe(session_id))
}

pub(crate) fn session_file(project_path: &str, session_id: &str) -> PathBuf {
    chat_dir(project_path).join(session_file_name(session_id))
}

/// Session ids are the single source of truth for filenames; recover the id back
/// from a scanned file by stripping the `chat-`/`.json` wrapper.
fn session_id_from_file_name(name: &str) -> Option<String> {
    if name.starts_with("chat-store") || name.starts_with(".tmp-") {
        return None;
    }
    name.strip_prefix("chat-")
        .and_then(|s| s.strip_suffix(".json"))
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Write a JSON payload atomically: `.tmp-<name>` then rename over the target.
/// Readers never observe a half-written file.
async fn write_json_atomic(path: &Path, value: &Value) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    let tmp_name = format!(
        ".tmp-{}",
        path.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "chat.json".to_string())
    );
    let tmp = path.with_file_name(tmp_name);
    let body = serde_json::to_string_pretty(value).unwrap_or_default();
    tokio::fs::write(&tmp, body).await?;
    tokio::fs::rename(&tmp, path).await
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}


fn safe_file_part(value: &str) -> String {
    value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn extension_for_mime(mime: &str) -> &'static str {
    let m = mime.to_ascii_lowercase();
    if m.contains("jpeg") || m.contains("jpg") {
        "jpg"
    } else if m.contains("webp") {
        "webp"
    } else if m.contains("gif") {
        "gif"
    } else {
        "png"
    }
}

fn mime_from_ext(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/png",
    }
}

fn parse_data_url(data_url: &str) -> Option<(String, Vec<u8>)> {
    let trimmed = data_url.trim();
    let rest = trimmed.strip_prefix("data:")?;
    let (meta, b64) = rest.split_once(";base64,")?;
    if !meta.starts_with("image/") {
        return None;
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).ok()?;
    if bytes.is_empty() {
        return None;
    }
    Some((meta.to_string(), bytes))
}

fn normalize_image_ref_path(ref_path: &str) -> Option<String> {
    let normalized = ref_path
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_string();
    if !normalized.starts_with("images/") || normalized.contains("..") {
        return None;
    }
    Some(normalized)
}

fn image_ref_abs(dir: &Path, ref_path: &str) -> Option<PathBuf> {
    let normalized = normalize_image_ref_path(ref_path)?;
    Some(dir.join(normalized.replace('/', std::path::MAIN_SEPARATOR_STR)))
}

async fn image_ref_exists(dir: &Path, ref_path: &str) -> bool {
    let Some(abs) = image_ref_abs(dir, ref_path) else {
        return false;
    };
    tokio::fs::metadata(abs).await.is_ok()
}

async fn write_image_ref(
    dir: &Path,
    session_id: &str,
    message_id: &str,
    index: usize,
    data_url: &str,
) -> Option<String> {
    let (mime, bytes) = parse_data_url(data_url)?;
    let ext = extension_for_mime(&mime);
    let rel = format!(
        "images/{}/{}-{}.{}",
        safe_file_part(session_id),
        safe_file_part(message_id),
        index,
        ext
    );
    let abs = image_ref_abs(dir, &rel)?;
    if let Some(parent) = abs.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    tokio::fs::write(&abs, bytes).await.ok()?;
    Some(rel)
}

/// Persist `imageDataUrls` under the project session dir; strip base64 from the payload.
/// Returns `(payload, imageRefsByMessageId)`.
async fn externalize_session_images(
    dir: &Path,
    session_id: &str,
    mut data: Value,
) -> (Value, Map<String, Value>) {
    let mut refs_by_message = Map::new();
    let Some(messages) = data.get_mut("messages").and_then(|m| m.as_array_mut()) else {
        return (data, refs_by_message);
    };

    for (idx, message) in messages.iter_mut().enumerate() {
        let role = message
            .get("role")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if role != "user" {
            if let Some(obj) = message.as_object_mut() {
                obj.remove("imageDataUrls");
            }
            continue;
        }

        let message_id = message
            .get("id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| format!("msg-{idx}"));

        let urls: Vec<String> = message
            .get("imageDataUrls")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|u| u.as_str())
                    .filter(|u| u.starts_with("data:image/"))
                    .map(|u| u.to_string())
                    .collect()
            })
            .unwrap_or_default();

        let mut refs: Vec<Value> = message
            .get("imageRefs")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        for (i, url) in urls.iter().enumerate() {
            let existing_path = refs
                .get(i)
                .and_then(|r| r.get("path"))
                .and_then(|p| p.as_str())
                .map(|s| s.to_string());
            if let Some(path) = existing_path {
                if image_ref_exists(dir, &path).await {
                    continue;
                }
            }
            if let Some(rel) = write_image_ref(dir, session_id, &message_id, i, url).await {
                let entry = json!({ "path": rel });
                if i < refs.len() {
                    refs[i] = entry;
                } else {
                    refs.push(entry);
                }
            }
        }

        let mut verified = Vec::new();
        for r in refs {
            if let Some(path) = r.get("path").and_then(|p| p.as_str()) {
                if image_ref_exists(dir, path).await {
                    verified.push(json!({ "path": path }));
                }
            }
        }

        if let Some(obj) = message.as_object_mut() {
            obj.remove("imageDataUrls");
            if verified.is_empty() {
                obj.remove("imageRefs");
                obj.remove("imageCount");
            } else {
                obj.insert("imageRefs".into(), Value::Array(verified.clone()));
                obj.insert("imageCount".into(), json!(verified.len()));
                refs_by_message.insert(message_id, Value::Array(verified));
            }
        }
    }

    (data, refs_by_message)
}

fn message_array_len(value: &Value) -> usize {
    value
        .get("messages")
        .and_then(|m| m.as_array())
        .map(|a| a.len())
        .unwrap_or(0)
}

fn messages_len(messages: &Value) -> usize {
    messages.as_array().map(|a| a.len()).unwrap_or(0)
}

fn messages_from_session_json(session: &Value) -> Value {
    session.get("messages").cloned().unwrap_or(json!([]))
}

/// List `chat-*.json` session files directly inside `dir` (non-recursive).
/// The index file and atomic-write temp files are never sessions.
fn scan_session_files_sync(dir: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with("chat-") || !name.ends_with(".json") || name.starts_with("chat-store") {
            continue;
        }
        if let Some(id) = session_id_from_file_name(&name) {
            out.push((id, entry.path()));
        }
    }
    out
}

fn read_json_file_sync(path: &Path) -> Option<Value> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Deleted-session tombstones, persisted per project so "deleted" survives
/// browser cache clears, other browsers and other machines.
fn read_tombstones(project_path: &str) -> Vec<String> {
    read_tombstones_in(&deleted_file(project_path))
}

fn read_tombstones_in(path: &Path) -> Vec<String> {
    match read_json_file_sync(path) {
        Some(Value::Array(arr)) => arr
            .into_iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect(),
        Some(Value::Object(obj)) => obj
            .get("deletedSessionIds")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

async fn write_tombstones(project_path: &str, ids: &[String]) {
    write_tombstones_in(&deleted_file(project_path), ids).await;
}

async fn write_tombstones_in(path: &Path, ids: &[String]) {
    let trimmed: Vec<String> = ids
        .iter()
        .rev()
        .take(500)
        .rev()
        .cloned()
        .collect();
    let _ = write_json_atomic(path, &json!({ "deletedSessionIds": trimmed })).await;
}

fn meta_from_file(id: &str, path: &Path, previous: Option<&Value>) -> Option<Value> {
    let data = read_json_file_sync(path).unwrap_or_else(|| json!({}));
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| session_file_name(id));
    let prev = |key: &str| previous.and_then(|p| p.get(key)).cloned();
    let message_count = message_array_len(&data);
    let title = data
        .get("title")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
        .or_else(|| prev("title").and_then(|v| v.as_str().map(str::to_string)))
        .unwrap_or_else(|| "新会话".to_string());
    let field = |key: &str, fallback: String| {
        data.get(key)
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(str::to_string)
            .or_else(|| prev(key).and_then(|v| v.as_str().map(str::to_string)))
            .unwrap_or(fallback)
    };
    let mut entry = json!({
      "id": id,
      "title": title,
      "createdAt": field("createdAt", now_iso()),
      "updatedAt": field("updatedAt", now_iso()),
      "messageCount": message_count,
      "file": file_name,
    });
    if let Some(obj) = entry.as_object_mut() {
        let status = data
            .get("status")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(str::to_string)
            .or_else(|| prev("status").and_then(|v| v.as_str().map(str::to_string)));
        if let Some(status) = status {
            obj.insert("status".into(), json!(status));
        }
        for key in ["providerId", "modelId", "sessionGoal"] {
            let value = data
                .get(key)
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .map(str::to_string)
                .or_else(|| prev(key).and_then(|v| v.as_str().map(str::to_string)));
            if let Some(value) = value {
                obj.insert(key.into(), json!(value));
            }
        }
    }
    Some(entry)
}

/// Rebuild the project index by scanning its session files. The files on disk are
/// the source of truth: an index that lost entries (old overwrite bug), was
/// truncated, deleted or corrupted self-heals here on the next read.
fn build_index_from_disk(project_path: &str, previous: Option<&Value>) -> Value {
    let dir = chat_dir(project_path);
    let tombstones = read_tombstones(project_path);
    build_index_at(&dir, project_path, previous, &tombstones)
}

/// Scan `dir` and rebuild an index for `project_path`. Split out from
/// `build_index_from_disk` so the scan dir can be injected in tests.
fn build_index_at(
    dir: &Path,
    project_path: &str,
    previous: Option<&Value>,
    tombstones: &[String],
) -> Value {
    let tomb: std::collections::HashSet<&str> = tombstones.iter().map(String::as_str).collect();
    let previous_by_id = |id: &str| {
        previous
            .and_then(|p| p.get("sessions"))
            .and_then(|s| s.as_array())
            .and_then(|arr| {
                arr.iter()
                    .find(|s| s.get("id").and_then(|v| v.as_str()) == Some(id))
            })
    };

    let mut sessions: Vec<Value> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (id, path) in scan_session_files_sync(dir) {
        if tomb.contains(id.as_str()) || !seen.insert(id.clone()) {
            continue;
        }
        if let Some(meta) = meta_from_file(&id, &path, previous_by_id(&id)) {
            sessions.push(meta);
        }
    }

    // A scan that finds nothing must never erase a known-good index: the files may
    // simply not have been flushed yet (or the dir is temporarily unreadable).
    let previous_sessions = previous
        .and_then(|p| p.get("sessions"))
        .and_then(|s| s.as_array())
        .map(|a| {
            a.iter()
                .filter(|s| {
                    s.get("id")
                        .and_then(|v| v.as_str())
                        .map(|id| !tomb.contains(id))
                        .unwrap_or(false)
                })
                .cloned()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if sessions.is_empty() && !previous_sessions.is_empty() {
        sessions = previous_sessions;
    }

    sessions.sort_by(|a, b| {
        let au = a.get("updatedAt").and_then(|v| v.as_str()).unwrap_or("");
        let bu = b.get("updatedAt").and_then(|v| v.as_str()).unwrap_or("");
        bu.cmp(au)
    });

    let previous_active = previous
        .and_then(|p| p.get("activeSessionId"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let active_session_id = if !previous_active.is_empty()
        && sessions
            .iter()
            .any(|s| s.get("id").and_then(|v| v.as_str()) == Some(previous_active))
    {
        previous_active.to_string()
    } else {
        sessions
            .first()
            .and_then(|s| s.get("id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };

    json!({
      "version": STORE_VERSION,
      "projectPath": project_path,
      "activeSessionId": active_session_id,
      "deletedSessionIds": tombstones,
      "sessions": sessions,
    })
}

/// Copy a session file aside before it is overwritten with fewer messages, so a
/// client-side message cap can never destroy stored history.
async fn archive_before_shrink(dir: &Path, session_id: &str, incoming_messages: usize) {
    let path = dir.join(session_file_name(session_id));
    let Ok(raw) = tokio::fs::read_to_string(&path).await else {
        return;
    };
    let Ok(existing) = serde_json::from_str::<Value>(&raw) else {
        return;
    };
    if message_array_len(&existing) <= incoming_messages {
        return;
    }
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let target = archive_dir_of(dir).join(format!("{}-{}.json", session_id_safe(session_id), stamp));
    let _ = write_json_atomic(&target, &existing).await;
}

fn archive_dir_of(dir: &Path) -> PathBuf {
    dir.join("archive")
}

/// Ensure the bucket exists and record which project path it belongs to.
async fn ensure_project_bucket(project_path: &str) {
    let dir = chat_dir(project_path);
    let _ = tokio::fs::create_dir_all(&dir).await;
    if project_path.trim().is_empty() {
        return;
    }
    let meta_path = project_chat_meta_file(project_path);
    if tokio::fs::try_exists(&meta_path).await.unwrap_or(false) {
        return;
    }
    let _ = write_json_atomic(&meta_path, &json!({ "projectPath": project_path })).await;
}

/// Recover from a half-written `.tmp-chat-<id>.json` left by an interrupted atomic write.
async fn recover_messages_from_tmp_backups(dir: &Path, session_id: &str) -> Option<Value> {
    let prefix = format!(".tmp-{}", session_file_name(session_id));
    let mut entries = tokio::fs::read_dir(dir).await.ok()?;
    let mut candidates: Vec<(u64, PathBuf)> = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with(&prefix) {
            continue;
        }
        let len = entry.metadata().await.ok()?.len();
        candidates.push((len, entry.path()));
    }
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in candidates {
        let content = tokio::fs::read_to_string(&path).await.ok()?;
        let session: Value = serde_json::from_str(&content).ok()?;
        let messages = messages_from_session_json(&session);
        if messages_len(&messages) > 0 {
            return Some(messages);
        }
    }
    None
}

async fn load_session_messages_with_recovery(dir: &Path, session_id: &str) -> Value {
    let path = dir.join(session_file_name(session_id));
    let mut session: Value = json!({});
    if let Ok(content) = tokio::fs::read_to_string(&path).await {
        session = serde_json::from_str(&content).unwrap_or(json!({}));
    }
    let mut messages = messages_from_session_json(&session);
    if messages_len(&messages) == 0 {
        if let Some(recovered) = recover_messages_from_tmp_backups(dir, session_id).await {
            messages = recovered;
            if session.is_object() {
                if let Some(obj) = session.as_object_mut() {
                    obj.insert("messages".into(), messages.clone());
                    let _ = write_json_atomic(&path, &session).await;
                }
            }
        }
    }
    messages
}

async fn should_skip_empty_session_overwrite(file: &Path, incoming: &Value) -> bool {
    if message_array_len(incoming) > 0 {
        return false;
    }
    let Ok(existing_raw) = tokio::fs::read_to_string(file).await else {
        return false;
    };
    let Ok(existing) = serde_json::from_str::<Value>(&existing_raw) else {
        return false;
    };
    message_array_len(&existing) > 0
}

/// One-time migration of the pre-per-project layout: the root dir held a single
/// `chat-store.json` naming one project. Move exactly the sessions that index
/// listed into that project's bucket. Everything else in the root is of unknown
/// ownership (the old global store mixed projects), so it goes to `_unassigned`
/// where the user can import it instead of being lost.
async fn migrate_legacy_root_store(project_path: &str) {
    if project_path.trim().is_empty() || normalize_project_key(project_path).is_empty() {
        return;
    }
    let root = chat_store_root();
    let target = chat_dir(project_path);
    if target == root {
        return;
    }
    migrate_legacy_root_store_at(project_path, &root, &target).await;
}

/// Injectable-root implementation so the migration is unit-testable.
async fn migrate_legacy_root_store_at(project_path: &str, root: &Path, target: &Path) {
    let legacy_store = root.join("chat-store.json");
    if !tokio::fs::try_exists(&legacy_store).await.unwrap_or(false) {
        return;
    }
    let Some(legacy) = read_json_file_sync(&legacy_store) else {
        return;
    };
    let legacy_project = legacy
        .get("projectPath")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if legacy_project.trim().is_empty()
        || normalize_project_key(legacy_project) != normalize_project_key(project_path)
    {
        return;
    }

    let _ = tokio::fs::create_dir_all(target).await;
    // Only sessions the legacy index actually claimed belong to this project.
    let owned: Vec<String> = legacy
        .get("sessions")
        .and_then(|s| s.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| s.get("id").and_then(|v| v.as_str()).map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    for id in &owned {
        let from = root.join(session_file_name(id));
        let to = target.join(session_file_name(id));
        if !tokio::fs::try_exists(&from).await.unwrap_or(false) {
            continue;
        }
        if tokio::fs::try_exists(&to).await.unwrap_or(false) {
            continue;
        }
        let _ = tokio::fs::rename(&from, &to).await;
    }
    // Images are keyed by session id, so only the owned sessions' image folders
    // travel with the project. The rest follow their session to `_unassigned`.
    let legacy_images = root.join("images");
    if tokio::fs::try_exists(&legacy_images).await.unwrap_or(false) {
        let target_images = target.join("images");
        let _ = tokio::fs::create_dir_all(&target_images).await;
        for id in &owned {
            let from = legacy_images.join(safe_file_part(id));
            if !tokio::fs::try_exists(&from).await.unwrap_or(false) {
                continue;
            }
            let to = target_images.join(safe_file_part(id));
            let _ = tokio::fs::create_dir_all(&to).await;
            if let Ok(mut rd) = tokio::fs::read_dir(&from).await {
                while let Ok(Some(entry)) = rd.next_entry().await {
                    let name = entry.file_name();
                    let _ = tokio::fs::rename(entry.path(), to.join(name)).await;
                }
            }
        }
    }

    // Carry over tombstones, then rebuild from the files we just moved in.
    let mut tombstones = read_tombstones_in(&deleted_file_in(target));
    for id in read_tombstones_from_index(&legacy) {
        if !tombstones.contains(&id) {
            tombstones.push(id);
        }
    }
    write_tombstones_in(&deleted_file_in(target), &tombstones).await;

    let previous = read_json_file_sync(&store_file_in(target));
    let index = build_index_at(target, project_path, previous.as_ref(), &tombstones);
    let _ = write_json_atomic(&store_file_in(target), &index).await;

    // Unclaimed files have unknown ownership: park them in the import pool.
    // Their image folders ride along so the images stay reachable after import.
    let leftover: Vec<(String, PathBuf)> = scan_session_files_sync(&root);
    if !leftover.is_empty() {
        let unassigned = root.join("_unassigned");
        let _ = tokio::fs::create_dir_all(&unassigned).await;
        let unassigned_images = unassigned.join("images");
        let _ = tokio::fs::create_dir_all(&unassigned_images).await;
        for (id, path) in leftover {
            let _ = tokio::fs::rename(path, unassigned.join(session_file_name(&id))).await;
            let from = root.join("images").join(safe_file_part(&id));
            if tokio::fs::try_exists(&from).await.unwrap_or(false) {
                let to = unassigned_images.join(safe_file_part(&id));
                let _ = tokio::fs::create_dir_all(&to).await;
                if let Ok(mut rd) = tokio::fs::read_dir(&from).await {
                    while let Ok(Some(entry)) = rd.next_entry().await {
                        let name = entry.file_name();
                        let _ = tokio::fs::rename(entry.path(), to.join(name)).await;
                    }
                }
            }
        }
    }
    let done = root.join("chat-store.migrated.json");
    let _ = tokio::fs::rename(&legacy_store, done).await;
}

fn read_tombstones_from_index(index: &Value) -> Vec<String> {
    index
        .get("deletedSessionIds")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

pub async fn chat_store_load(project_path: &str, load_messages: bool) -> Value {
    migrate_legacy_root_store(project_path).await;
    ensure_project_bucket(project_path).await;
    let dir = chat_dir(project_path);
    let store_path = store_file(project_path);
    let previous = read_json_file_sync(&store_path);
    let mut index = build_index_from_disk(project_path, previous.as_ref());
    let _ = write_json_atomic(&store_path, &index).await;

    if !load_messages {
        return json!({ "ok": true, "data": index });
    }
    if let Some(metas) = index.get_mut("sessions").and_then(|s| s.as_array_mut()) {
        for meta in metas.iter_mut() {
            let sid = meta.get("id").and_then(|v| v.as_str()).unwrap_or("");
            if sid.is_empty() {
                continue;
            }
            let messages = load_session_messages_with_recovery(&dir, sid).await;
            if messages_len(&messages) > 0 {
                if let Some(obj) = meta.as_object_mut() {
                    obj.insert("messages".into(), messages);
                }
            }
        }
    }
    json!({ "ok": true, "data": index })
}

pub async fn chat_session_messages(project_path: &str, session_id: &str) -> Value {
    let dir = chat_dir(project_path);
    let path = dir.join(session_file_name(session_id));
    let file_exists = tokio::fs::try_exists(&path).await.unwrap_or(false);
    let messages = load_session_messages_with_recovery(&dir, session_id).await;
    let message_len = messages_len(&messages);
    if !file_exists && message_len == 0 {
        return json!({ "ok": false, "error": "会话文件不存在" });
    }
    json!({
      "ok": true,
      "data": {
        "sessionId": session_id,
        "messages": messages
      }
    })
}

pub async fn chat_store_sync(project_path: &str, data: Value) -> Value {
    migrate_legacy_root_store(project_path).await;
    ensure_project_bucket(project_path).await;
    let dir = chat_dir(project_path);
    let store_path = store_file(project_path);

    // The per-project index is a cache; the session files are the truth. Load
    // whatever we have, upsert the incoming sessions, then rebuild from a scan so
    // sessions the index lost come back automatically.
    let incoming = data
        .get("sessions")
        .and_then(|s| s.as_array())
        .cloned()
        .unwrap_or_default();
    let mut incoming_by_id: std::collections::HashMap<String, Value> =
        std::collections::HashMap::new();
    for session in incoming {
        let id = session
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if id.is_empty() {
            // id-less entries cannot be a durable source of truth; ignore.
            continue;
        }
        let mut session = session;
        // Derive file linkage + id server-side; any client value is untrusted.
        let file_name = session_file_name(&id);
        if let Some(obj) = session.as_object_mut() {
            obj.insert("file".into(), json!(file_name));
            obj.insert("id".into(), json!(id.clone()));
        }
        let (externalized, _) = externalize_session_images(&dir, &id, session.clone()).await;
        let session = externalized;
        let file = dir.join(session_file_name(&id));
        if should_skip_empty_session_overwrite(&file, &session).await {
            incoming_by_id.insert(id.clone(), session.clone());
            continue;
        }
        archive_before_shrink(&dir, &id, message_array_len(&session)).await;
        if let Err(e) = write_json_atomic(&file, &session).await {
            return json!({ "ok": false, "error": format!("写入会话文件失败：{}", e) });
        }
        incoming_by_id.insert(id.clone(), session.clone());
    }

    let previous = read_json_file_sync(&store_path);
    let mut index = build_index_from_disk(project_path, previous.as_ref());
    if !incoming_by_id.is_empty() {
        if let Some(sessions) = index.get_mut("sessions").and_then(|s| s.as_array_mut()) {
            for (id, incoming) in &incoming_by_id {
                if let Some(pos) = sessions
                    .iter()
                    .position(|s| s.get("id").and_then(|v| v.as_str()) == Some(id.as_str()))
                {
                    let merged = meta_from_file(id, &dir.join(session_file_name(id)), Some(incoming));
                    if let Some(merged) = merged {
                        sessions[pos] = merged;
                    }
                }
            }
            sessions.sort_by(|a, b| {
                let au = a.get("updatedAt").and_then(|v| v.as_str()).unwrap_or("");
                let bu = b.get("updatedAt").and_then(|v| v.as_str()).unwrap_or("");
                bu.cmp(au)
            });
        }
    }
    if let Some(active) = data.get("activeSessionId") {
        if active.as_str().map(|s| !s.is_empty()).unwrap_or(false) {
            index["activeSessionId"] = active.clone();
        }
    }

    match write_json_atomic(&store_path, &index).await {
        Ok(_) => {
            let session_count = index
                .get("sessions")
                .and_then(|s| s.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            json!({
              "ok": true,
              "sessionCount": session_count,
              "activeSessionId": index.get("activeSessionId").cloned().unwrap_or(json!("")),
              "syncedAt": now_iso(),
              "sessions": index.get("sessions").cloned().unwrap_or(json!([]))
            })
        }
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

pub async fn chat_session_sync(
    project_path: &str,
    session_id: &str,
    data: Value,
    active_session_id: Option<&str>,
) -> Value {
    migrate_legacy_root_store(project_path).await;
    ensure_project_bucket(project_path).await;
    let dir = chat_dir(project_path);
    let (data, image_refs_by_message_id) =
        externalize_session_images(&dir, session_id, data).await;
    let session_path = dir.join(session_file_name(session_id));
    if !should_skip_empty_session_overwrite(&session_path, &data).await {
        archive_before_shrink(&dir, session_id, message_array_len(&data)).await;
        let _ = write_json_atomic(&session_path, &data).await;
    }
    let store_path = store_file(project_path);
    let previous = read_json_file_sync(&store_path);
    let mut index = build_index_from_disk(project_path, previous.as_ref());
    if let Some(active) = active_session_id {
        if !active.is_empty() {
            index["activeSessionId"] = json!(active);
        }
    }
    index["syncedAt"] = json!(now_iso());
    let _ = write_json_atomic(&store_path, &index).await;
    json!({
      "ok": true,
      "imageRefsByMessageId": Value::Object(image_refs_by_message_id)
    })
}

pub async fn chat_session_delete(
    project_path: &str,
    session_id: &str,
    active_session_id: Option<&str>,
) -> Value {
    ensure_project_bucket(project_path).await;
    let dir = chat_dir(project_path);
    let _ = tokio::fs::remove_file(dir.join(session_file_name(session_id))).await;

    // Tombstone on disk so a deleted session never resurrects from a stale
    // browser cache or another machine's copy.
    let mut tombstones = read_tombstones(project_path);
    if !tombstones.iter().any(|id| id == session_id) {
        tombstones.push(session_id.to_string());
    }
    write_tombstones(project_path, &tombstones).await;

    let store_path = store_file(project_path);
    let previous = read_json_file_sync(&store_path);
    let mut index = build_index_from_disk(project_path, previous.as_ref());
    if index.get("activeSessionId") == Some(&json!(session_id)) {
        index["activeSessionId"] = json!(index
            .get("sessions")
            .and_then(|s| s.as_array())
            .and_then(|a| a.first())
            .and_then(|s| s.get("id"))
            .cloned()
            .unwrap_or(json!("")));
    } else if let Some(active) = active_session_id {
        if !active.is_empty() {
            index["activeSessionId"] = json!(active);
        }
    }
    index["syncedAt"] = json!(now_iso());
    let _ = write_json_atomic(&store_path, &index).await;
    json!({
      "ok": true,
      "activeSessionId": index.get("activeSessionId").cloned().unwrap_or(json!("")),
      "sessionCount": index.get("sessions").and_then(|s| s.as_array()).map(|a| a.len()).unwrap_or(0),
      "syncedAt": index.get("syncedAt").cloned().unwrap_or(json!("")),
      "sessions": index.get("sessions").cloned().unwrap_or(json!([]))
    })
}

pub async fn chat_image_data_url(project_path: &str, ref_path: &str) -> Value {
    let Some(full) = image_ref_abs(&chat_dir(project_path), ref_path) else {
        return json!({ "ok": false, "error": "invalid image ref path" });
    };
    match tokio::fs::read(&full).await {
        Ok(bytes) => {
            let ext = full.extension().and_then(|e| e.to_str()).unwrap_or("png");
            let mime = mime_from_ext(ext);
            let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes);
            json!({ "ok": true, "dataUrl": format!("data:{mime};base64,{b64}") })
        }
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

pub async fn chat_image_file_bytes(project_path: &str, ref_path: &str) -> Result<Vec<u8>, String> {
    let full = image_ref_abs(&chat_dir(project_path), ref_path)
        .ok_or_else(|| "invalid image ref path".to_string())?;
    tokio::fs::read(&full).await.map_err(|e| e.to_string())
}

fn unassigned_dir() -> PathBuf {
    chat_store_root().join("_unassigned")
}

/// Sessions whose owning project could not be determined during migration.
pub async fn chat_unassigned_list() -> Value {
    json!({ "ok": true, "sessions": list_unassigned_in(&unassigned_dir()) })
}

fn list_unassigned_in(dir: &Path) -> Vec<Value> {
    let mut sessions: Vec<Value> = Vec::new();
    for (id, path) in scan_session_files_sync(dir) {
        if let Some(meta) = meta_from_file(&id, &path, None) {
            sessions.push(meta);
        }
    }
    sessions.sort_by(|a, b| {
        let au = a.get("updatedAt").and_then(|v| v.as_str()).unwrap_or("");
        let bu = b.get("updatedAt").and_then(|v| v.as_str()).unwrap_or("");
        bu.cmp(au)
    });
    sessions
}

/// Adopt an unassigned session into `project_path`, moving its file and images.
pub async fn chat_unassigned_import(project_path: &str, session_id: &str) -> Value {
    let id = session_id.trim();
    if id.is_empty() {
        return json!({ "ok": false, "error": "缺少会话 id" });
    }
    if normalize_project_key(project_path).is_empty() {
        return json!({ "ok": false, "error": "缺少项目路径" });
    }
    let from = unassigned_dir().join(session_file_name(id));
    if !tokio::fs::try_exists(&from).await.unwrap_or(false) {
        return json!({ "ok": false, "error": "未认领会话不存在" });
    }
    ensure_project_bucket(project_path).await;
    let result = import_unassigned_into(&unassigned_dir(), &chat_dir(project_path), id).await;
    if !result.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        return result;
    }
    let store_path = store_file(project_path);
    let previous = read_json_file_sync(&store_path);
    let index = build_index_from_disk(project_path, previous.as_ref());
    let _ = write_json_atomic(&store_path, &index).await;
    json!({ "ok": true, "sessionCount": index.get("sessions").and_then(|s| s.as_array()).map(|a| a.len()).unwrap_or(0) })
}

async fn import_unassigned_into(from_dir: &Path, target: &Path, id: &str) -> Value {
    let from = from_dir.join(session_file_name(id));
    if !tokio::fs::try_exists(&from).await.unwrap_or(false) {
        return json!({ "ok": false, "error": "未认领会话不存在" });
    }
    let _ = tokio::fs::create_dir_all(target).await;
    let to = target.join(session_file_name(id));
    if tokio::fs::try_exists(&to).await.unwrap_or(false) {
        return json!({ "ok": false, "error": "当前项目已有同 id 会话" });
    }
    if let Err(e) = tokio::fs::rename(&from, &to).await {
        return json!({ "ok": false, "error": e.to_string() });
    }
    // Session ids are unique, so the image folder is unambiguous.
    let images_from = from_dir.join("images").join(safe_file_part(id));
    if tokio::fs::try_exists(&images_from).await.unwrap_or(false) {
        let images_to = target.join("images").join(safe_file_part(id));
        let _ = tokio::fs::create_dir_all(&images_to).await;
        if let Ok(mut rd) = tokio::fs::read_dir(&images_from).await {
            while let Ok(Some(entry)) = rd.next_entry().await {
                let name = entry.file_name();
                let _ = tokio::fs::rename(entry.path(), images_to.join(name)).await;
            }
        }
    }
    json!({ "ok": true })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::{set_session_root_override, SessionRootOverrideGuard};

    const TEST_PROJECT: &str = "D:/projects/chat-tests";

    /// Redirect the session store root to a temp dir for this test thread, so no
    /// test can ever read or write the real `%APPDATA%/aiall/vibe-chat-sessions`.
    fn test_store(name: &str) -> (PathBuf, SessionRootOverrideGuard) {
        let root = std::env::temp_dir().join(format!("aiall-chat-store-{name}"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let guard = set_session_root_override(root.clone());
        (root, guard)
    }

    #[test]
    fn test_session_file_sanitizes_alphanumeric() {
        let name = session_file_name("abc-123_def");
        assert_eq!(name, "chat-abc-123_def.json");
    }

    #[test]
    fn test_session_file_replaces_special_chars() {
        let name = session_file_name("hello/world:test?foo=bar&baz");
        assert!(!name.contains('/'));
        assert!(!name.contains(':'));
        assert!(!name.contains('?'));
        assert_eq!(name, "chat-hello_world_test_foo_bar_baz.json");
    }

    #[test]
    fn test_session_file_empty_id() {
        let name = session_file_name("");
        assert_eq!(name, "chat-.json");
    }

    #[test]
    fn test_session_file_unicode_becomes_hash_slug() {
        let name = session_file_name("会话测试");
        // Non-ASCII session IDs get a hash-based name to avoid collision
        assert!(name.starts_with("chat-session_"), "got: {name}");
        assert!(name.ends_with(".json"), "got: {name}");
        // Hash is 16 hex chars
        let stem = name
            .strip_prefix("chat-session_")
            .unwrap()
            .strip_suffix(".json")
            .unwrap();
        assert_eq!(stem.len(), 16, "hash should be 16 hex chars, got: {stem}");
        assert!(
            stem.chars().all(|c| c.is_ascii_hexdigit()),
            "hash should be hex, got: {stem}"
        );
    }

    #[test]
    fn test_session_file_all_special_chars() {
        let name = session_file_name("!@#$%^&*()");
        // All-special-char session IDs get a hash-based name
        assert!(name.starts_with("chat-session_"), "got: {name}");
        assert!(name.ends_with(".json"), "got: {name}");
        let stem = name
            .strip_prefix("chat-session_")
            .unwrap()
            .strip_suffix(".json")
            .unwrap();
        assert_eq!(stem.len(), 16);
    }

    #[test]
    fn test_index_file_name_matches_session_file_name() {
        // The index must advertise the same name the writer produces, or the
        // index→file linkage drifts (this regressed for non-ASCII ids before).
        let name = session_file_name("会话测试");
        let path = session_file(TEST_PROJECT, "会话测试");
        assert_eq!(path.file_name().unwrap().to_string_lossy(), name);
    }

    #[test]
    fn test_store_file_is_per_project() {
        let a = store_file("D:/projects/a");
        let b = store_file("D:/projects/b");
        assert_ne!(a, b);
        assert_eq!(a.file_name().unwrap(), "chat-store.json");
    }

    #[test]
    fn test_session_and_store_share_parent() {
        let store = store_file(TEST_PROJECT);
        let session = session_file(TEST_PROJECT, "test");
        assert_eq!(store.parent(), session.parent());
    }

    #[test]
    fn test_session_id_round_trips_through_file_name() {
        for id in ["abc-123_def", "会话测试", "!@#$%^&*()", "1789623631488-33dd4ff5b4c15"] {
            let name = session_file_name(id);
            assert!(session_id_from_file_name(&name).is_some(), "id: {id}");
        }
        assert_eq!(
            session_id_from_file_name("chat-abc.json").as_deref(),
            Some("abc")
        );
        assert!(session_id_from_file_name("chat-store.json").is_none());
        assert!(session_id_from_file_name(".tmp-chat-abc.json").is_none());
    }

    #[test]
    fn test_parse_data_url_jpeg() {
        let raw = "data:image/jpeg;base64,QQ==";
        let (mime, bytes) = parse_data_url(raw).expect("parse");
        assert_eq!(mime, "image/jpeg");
        assert_eq!(bytes, b"A");
        assert_eq!(extension_for_mime(&mime), "jpg");
    }

    #[test]
    fn test_normalize_image_ref_path_rejects_escape() {
        assert!(normalize_image_ref_path("images/s/a.jpg").is_some());
        assert!(normalize_image_ref_path("../etc/passwd").is_none());
        assert!(normalize_image_ref_path("images/../x.jpg").is_none());
    }

    #[test]
    fn test_image_ref_abs_stays_inside_project_dir() {
        let dir = chat_dir(TEST_PROJECT);
        let abs = image_ref_abs(&dir, "images/sess/msg-0.jpg").expect("abs");
        assert!(abs.starts_with(&dir));
        assert!(abs.ends_with(
            std::path::Path::new("images")
                .join("sess")
                .join("msg-0.jpg")
        ));
    }

    struct TempProject {
        root: PathBuf,
        project: String,
        _guard: SessionRootOverrideGuard,
    }

    impl TempProject {
        async fn new(name: &str) -> Self {
            let (root, guard) = test_store(name);
            let project = root
                .join("project")
                .to_string_lossy()
                .to_string();
            tokio::fs::create_dir_all(&project).await.unwrap();
            TempProject {
                root,
                project,
                _guard: guard,
            }
        }

        fn path(&self) -> String {
            self.project.clone()
        }
    }

    impl Drop for TempProject {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    async fn seed_session(dir: &Path, id: &str, message_count: usize) {
        let messages: Vec<Value> = (0..message_count)
            .map(|i| json!({ "id": format!("m{i}"), "role": "user", "content": format!("msg {i}") }))
            .collect();
        let payload = json!({
          "id": id,
          "title": format!("session {id}"),
          "createdAt": "2026-01-01T00:00:00.000Z",
          "updatedAt": "2026-01-02T00:00:00.000Z",
          "messages": messages,
        });
        write_json_atomic(&dir.join(session_file_name(id)), &payload)
            .await
            .unwrap();
    }

    fn session_ids(index: &Value) -> Vec<String> {
        index
            .get("sessions")
            .and_then(|s| s.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|s| s.get("id").and_then(|v| v.as_str()).map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    }

    #[test]
    fn build_index_recovers_sessions_missing_from_previous_index() {
        // Old index knew only "known" (a phantom with no file); "orphan" exists on
        // disk with no entry. The rebuild trusts the files: orphan comes back and
        // the file-less phantom is dropped.
        let (_root, _guard) = test_store("selfheal");
        let project = "D:/projects/chat-selfheal-test".to_string();
        let dir = chat_dir(&project);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(session_file_name("orphan")),
            json!({ "id": "orphan", "messages": [{ "id": "m", "role": "user", "content": "x" }] })
                .to_string(),
        )
        .unwrap();
        let previous = json!({
          "version": 3,
          "projectPath": project,
          "activeSessionId": "known",
          "sessions": [{ "id": "known", "title": "k", "createdAt": "", "updatedAt": "2026-01-01T00:00:00.000Z", "messageCount": 2 }]
        });
        let index = build_index_from_disk(&project, Some(&previous));
        let ids = session_ids(&index);
        assert!(ids.contains(&"orphan".to_string()), "got: {ids:?}");
        assert!(
            !ids.contains(&"known".to_string()),
            "file-less phantom must not linger: {ids:?}"
        );
        // Active pointer must follow a real session, not a phantom.
        assert_eq!(
            index.get("activeSessionId").and_then(|v| v.as_str()),
            Some("orphan")
        );
    }

    #[test]
    fn build_index_keeps_known_sessions_when_scan_is_empty() {
        // Files not flushed yet must not wipe a known-good index.
        let (_root, _guard) = test_store("empty-scan");
        let project = "D:/projects/definitely-missing-dir".to_string();
        let previous = json!({
          "version": 3,
          "projectPath": project,
          "activeSessionId": "keep",
          "sessions": [{ "id": "keep", "title": "k", "createdAt": "", "updatedAt": "2026-01-01T00:00:00.000Z", "messageCount": 3 }]
        });
        let index = build_index_from_disk(&project, Some(&previous));
        assert_eq!(session_ids(&index), vec!["keep".to_string()]);
    }

    #[test]
    fn build_index_drops_tombstoned_sessions() {
        let (_root, _guard) = test_store("tombstone");
        let project = "D:/projects/chat-tombstone-test".to_string();
        let dir = chat_dir(&project);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(session_file_name("dead")),
            json!({ "id": "dead", "messages": [{ "id": "m", "role": "user", "content": "x" }] })
                .to_string(),
        )
        .unwrap();
        std::fs::write(
            deleted_file(&project),
            json!({ "deletedSessionIds": ["dead"] }).to_string(),
        )
        .unwrap();
        let index = build_index_from_disk(&project, None);
        assert!(session_ids(&index).is_empty(), "tombstoned must stay deleted");
    }

    #[tokio::test]
    async fn store_sync_then_load_roundtrip() {
        let project = TempProject::new("roundtrip").await;
        let path = project.path();
        let session = json!({
          "id": "s1",
          "title": "第一",
          "createdAt": "2026-01-01T00:00:00.000Z",
          "updatedAt": "2026-01-01T00:00:00.000Z",
          "messages": [{ "id": "m1", "role": "user", "content": "hi" }],
        });
        let synced = chat_store_sync(
            &path,
            json!({ "projectPath": path, "activeSessionId": "s1", "sessions": [session] }),
        )
        .await;
        assert_eq!(synced.get("ok"), Some(&json!(true)));

        let loaded = chat_store_load(&path, true).await;
        assert_eq!(loaded.get("ok"), Some(&json!(true)));
        let data = loaded.get("data").unwrap();
        assert_eq!(session_ids(data), vec!["s1".to_string()]);
        assert_eq!(data.get("projectPath").and_then(|v| v.as_str()), Some(path.as_str()));
    }

    #[tokio::test]
    async fn store_sync_does_not_drop_sessions_absent_from_payload() {
        // The whole point of the fix: a short payload must not erase on-disk sessions.
        let project = TempProject::new("no-drop").await;
        let path = project.path();
        let dir = chat_dir(&path);
        seed_session(&dir, "old", 2).await;

        let synced = chat_store_sync(
            &path,
            json!({
              "projectPath": path,
              "activeSessionId": "new",
              "sessions": [{
                "id": "new", "title": "n",
                "createdAt": "2026-02-01T00:00:00.000Z",
                "updatedAt": "2026-02-01T00:00:00.000Z",
                "messages": [{ "id": "m1", "role": "user", "content": "hi" }]
              }]
            }),
        )
        .await;
        assert_eq!(synced.get("ok"), Some(&json!(true)));

        let ids = session_ids(&chat_store_load(&path, false).await.get("data").unwrap().clone());
        assert!(ids.contains(&"old".to_string()), "got: {ids:?}");
        assert!(ids.contains(&"new".to_string()), "got: {ids:?}");
    }

    #[tokio::test]
    async fn delete_is_tombstoned_and_survives_reload() {
        let project = TempProject::new("delete").await;
        let path = project.path();
        let dir = chat_dir(&path);
        seed_session(&dir, "keep", 1).await;
        seed_session(&dir, "gone", 1).await;

        let deleted = chat_session_delete(&path, "gone", None).await;
        assert_eq!(deleted.get("ok"), Some(&json!(true)));
        assert!(!dir.join(session_file_name("gone")).exists());
        assert!(deleted_file(&path).exists(), "tombstone must be persisted");

        let ids = session_ids(&chat_store_load(&path, false).await.get("data").unwrap().clone());
        assert_eq!(ids, vec!["keep".to_string()]);
        // A stale client re-uploading the deleted session must not resurrect it.
        chat_store_sync(
            &path,
            json!({
              "projectPath": path,
              "activeSessionId": "gone",
              "sessions": [{
                "id": "gone", "title": "g",
                "createdAt": "2026-01-01T00:00:00.000Z",
                "updatedAt": "2026-01-03T00:00:00.000Z",
                "messages": [{ "id": "m", "role": "user", "content": "back?" }]
              }]
            }),
        )
        .await;
        let ids = session_ids(&chat_store_load(&path, false).await.get("data").unwrap().clone());
        assert!(!ids.contains(&"gone".to_string()), "got: {ids:?}");
    }

    #[tokio::test]
    async fn shrink_archives_previous_full_session() {
        let project = TempProject::new("archive").await;
        let path = project.path();
        let dir = chat_dir(&path);
        seed_session(&dir, "s", 5).await;

        // Same session arrives with fewer messages: the full copy must be archived.
        chat_session_sync(
            &path,
            "s",
            json!({
              "id": "s", "title": "s",
              "createdAt": "2026-01-01T00:00:00.000Z",
              "updatedAt": "2026-01-02T00:00:00.000Z",
              "messages": [{ "id": "m0", "role": "user", "content": "msg 0" }]
            }),
            Some("s"),
        )
        .await;

        let archived = std::fs::read_dir(archive_dir_of(&dir))
            .unwrap()
            .flatten()
            .count();
        assert_eq!(archived, 1, "one archive copy expected");
    }

    #[tokio::test]
    async fn empty_session_overwrite_is_skipped() {
        let project = TempProject::new("empty-skip").await;
        let path = project.path();
        let dir = chat_dir(&path);
        seed_session(&dir, "s", 3).await;
        chat_session_sync(
            &path,
            "s",
            json!({ "id": "s", "messages": [] }),
            None,
        )
        .await;
        let raw = std::fs::read_to_string(dir.join(session_file_name("s"))).unwrap();
        let stored: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(message_array_len(&stored), 3, "stored history preserved");
    }

    /// A fake "AppData root" with its own project dirs, so migration/unassigned
    /// flows can be exercised without touching the real AppData store.
    struct TempRoot(PathBuf);

    impl TempRoot {
        async fn new(name: &str) -> Self {
            let root = std::env::temp_dir().join(format!("aiall-chat-root-{name}"));
            let _ = tokio::fs::remove_dir_all(&root).await;
            tokio::fs::create_dir_all(&root).await.unwrap();
            TempRoot(root)
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    async fn write_session(dir: &Path, id: &str, content: &str) {
        let _ = tokio::fs::create_dir_all(dir).await;
        write_json_atomic(
            &dir.join(session_file_name(id)),
            &json!({
              "id": id,
              "title": format!("t-{id}"),
              "createdAt": "2026-01-01T00:00:00.000Z",
              "updatedAt": "2026-01-02T00:00:00.000Z",
              "messages": [{ "id": "m", "role": "user", "content": content }],
            }),
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn migration_moves_owned_sessions_and_parks_the_rest() {
        let root = TempRoot::new("migrate").await;
        let project = "D:/projects/migrate-me".to_string();
        let target = root.0.join("bucket");

        write_session(&root.0, "owned", "mine").await;
        write_session(&root.0, "other", "someone else").await;
        write_json_atomic(
            &root.0.join("chat-store.json"),
            &json!({
              "version": 3,
              "projectPath": project,
              "activeSessionId": "owned",
              "sessions": [{ "id": "owned", "title": "t", "createdAt": "", "updatedAt": "2026-01-02T00:00:00.000Z", "messageCount": 1 }],
            }),
        )
        .await
        .unwrap();

        migrate_legacy_root_store_at(&project, &root.0, &target).await;

        assert!(target.join(session_file_name("owned")).exists(), "owned moved in");
        assert!(!root.0.join(session_file_name("owned")).exists(), "owned left root");
        assert!(
            root.0.join("_unassigned").join(session_file_name("other")).exists(),
            "unknown ownership parked for import"
        );
        assert!(
            root.0.join("chat-store.migrated.json").exists(),
            "legacy index retired so migration runs once"
        );
    }

    #[tokio::test]
    async fn migration_is_skipped_for_other_projects() {
        let root = TempRoot::new("migrate-skip").await;
        let target = root.0.join("bucket");
        write_session(&root.0, "owned", "mine").await;
        write_json_atomic(
            &root.0.join("chat-store.json"),
            &json!({ "version": 3, "projectPath": "D:/projects/someone-else", "sessions": [] }),
        )
        .await
        .unwrap();
        migrate_legacy_root_store_at("D:/projects/mine", &root.0, &target).await;
        assert!(
            root.0.join("chat-store.json").exists(),
            "index for another project must not be consumed"
        );
        assert!(!target.join(session_file_name("owned")).exists());
    }

    #[tokio::test]
    async fn unassigned_list_and_import_roundtrip() {
        let root = TempRoot::new("unassigned").await;
        let from = root.0.join("_unassigned");
        let target = root.0.join("bucket");
        write_session(&from, "lost", "recover me").await;
        let img_dir = from.join("images").join(safe_file_part("lost"));
        tokio::fs::create_dir_all(&img_dir).await.unwrap();
        tokio::fs::write(img_dir.join("m-0.png"), b"png").await.unwrap();

        let listed = list_unassigned_in(&from);
        assert_eq!(listed.len(), 1);
        assert_eq!(
            listed[0].get("id").and_then(|v| v.as_str()),
            Some("lost"),
            "list exposes the session id for import"
        );

        let imported = import_unassigned_into(&from, &target, "lost").await;
        assert_eq!(imported.get("ok"), Some(&json!(true)));
        assert!(target.join(session_file_name("lost")).exists());
        assert!(
            target
                .join("images")
                .join(safe_file_part("lost"))
                .join("m-0.png")
                .exists(),
            "images follow the session on import"
        );
        assert!(list_unassigned_in(&from).is_empty(), "imported session leaves the pool");
        // Re-importing the same id must fail rather than overwrite.
        let again = import_unassigned_into(&from, &target, "lost").await;
        assert_eq!(again.get("ok"), Some(&json!(false)));
    }

    #[tokio::test]
    async fn migration_recovers_orphans_for_the_owning_project() {
        // Mirrors the real-world state: the legacy index named one project but the
        // root held far more files than it listed. Listed ones move in (and the new
        // index rebuilds from them); unlisted ones wait in `_unassigned` instead of
        // silently disappearing from the UI.
        let root = TempRoot::new("migrate-orphans").await;
        let project = "D:/projects/aiall".to_string();
        let target = root.0.join("bucket");

        for id in ["listed-a", "listed-b"] {
            write_session(&root.0, id, "listed").await;
        }
        for id in ["orphan-1", "orphan-2", "orphan-3"] {
            write_session(&root.0, id, "orphan").await;
        }
        write_json_atomic(
            &root.0.join("chat-store.json"),
            &json!({
              "version": 3,
              "projectPath": project,
              "activeSessionId": "listed-a",
              "sessions": [
                { "id": "listed-a", "title": "a", "createdAt": "", "updatedAt": "2026-01-03T00:00:00.000Z", "messageCount": 1 },
                { "id": "listed-b", "title": "b", "createdAt": "", "updatedAt": "2026-01-02T00:00:00.000Z", "messageCount": 1 },
              ],
            }),
        )
        .await
        .unwrap();

        let legacy = read_json_file_sync(&root.0.join("chat-store.json")).unwrap();
        assert_eq!(
            legacy.get("projectPath").and_then(|v| v.as_str()),
            Some(project.as_str())
        );
        migrate_legacy_root_store_at(&project, &root.0, &target).await;

        // The project bucket holds exactly the sessions the index claimed.
        let mut owned: Vec<String> = std::fs::read_dir(&target)
            .unwrap()
            .flatten()
            .filter_map(|e| {
                session_id_from_file_name(&e.file_name().to_string_lossy())
            })
            .collect();
        owned.sort();
        assert_eq!(owned, vec!["listed-a".to_string(), "listed-b".to_string()]);

        let unassigned = list_unassigned_in(&root.0.join("_unassigned"));
        let mut unassigned_ids: Vec<String> = unassigned
            .iter()
            .filter_map(|s| s.get("id").and_then(|v| v.as_str()).map(str::to_string))
            .collect();
        unassigned_ids.sort();
        assert_eq!(
            unassigned_ids,
            vec!["orphan-1".to_string(), "orphan-2".to_string(), "orphan-3".to_string()],
            "orphans must stay recoverable, not vanish"
        );
    }

    #[tokio::test]
    async fn atomic_write_leaves_no_temp_file_and_no_partial_json() {
        let project = TempProject::new("atomic").await;
        let path = project.path();
        let dir = chat_dir(&path);
        seed_session(&dir, "s", 1).await;
        let names: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert!(
            !names.iter().any(|n| n.starts_with(".tmp-")),
            "leftover temp files: {names:?}"
        );
        let raw = std::fs::read_to_string(dir.join(session_file_name("s"))).unwrap();
        assert!(serde_json::from_str::<Value>(&raw).is_ok());
    }
}

