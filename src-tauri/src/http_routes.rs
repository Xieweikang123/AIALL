//! HTTP route handlers for the headless agent-server.
//!
//! These mirror the `/backend/vibe/*` contract that `src/services/*.ts` clients
//! already call in their HTTP fallback (kept from the old Node sidecar). The
//! handlers simply call the same `commands::*` fns the Tauri desktop app uses,
//! so behavior has a single source of truth in Rust (see AGENT_SSOT.md).

use crate::commands;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::pin::Pin;
use tauri::ipc::{Channel, InvokeResponseBody};

pub struct HttpResponse {
    pub status: u16,
    pub content_type: String,
    pub body: Vec<u8>,
}

fn sse_http_response(events: &[(String, String)]) -> HttpResponse {
    let mut body = String::new();
    for (ty, data) in events {
        body.push_str(&format!("event: {ty}\ndata: {data}\n\n"));
    }
    HttpResponse {
        status: 200,
        content_type: "text/event-stream".into(),
        body: body.into_bytes(),
    }
}

fn ok_json(v: Value) -> HttpResponse {
    HttpResponse {
        status: 200,
        content_type: "application/json".into(),
        body: serde_json::to_vec(&v).unwrap_or_default(),
    }
}

fn ok_value(v: impl serde::Serialize) -> HttpResponse {
    ok_json(serde_json::to_value(v).unwrap_or(Value::Null))
}

fn ok_bytes(bytes: Vec<u8>, content_type: &str) -> HttpResponse {
    HttpResponse {
        status: 200,
        content_type: content_type.into(),
        body: bytes,
    }
}

fn error_response(status: u16, message: &str) -> HttpResponse {
    HttpResponse {
        status,
        content_type: "text/plain".into(),
        body: message.as_bytes().to_vec(),
    }
}

fn parse_query(query: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        if let Some((k, v)) = pair.split_once('=') {
            let key = urlencoding::decode(k).unwrap_or_default().into_owned();
            let val = urlencoding::decode(v).unwrap_or_default().into_owned();
            map.insert(key, val);
        } else {
            let key = urlencoding::decode(pair).unwrap_or_default().into_owned();
            map.insert(key, String::new());
        }
    }
    map
}

fn parse_body_json(body: &[u8]) -> Result<Value, String> {
    if body.is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_slice(body).map_err(|e| format!("JSON 解析失败: {e}"))
}

fn body_str(v: &Value, name: &str) -> String {
    v.get(name).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

fn body_opt_str(v: &Value, name: &str) -> Option<String> {
    v.get(name)
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

fn body_str_array(v: &Value, name: &str) -> Vec<String> {
    v.get(name)
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str())
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default()
}

fn body_opt_bool(v: &Value, name: &str) -> Option<bool> {
    v.get(name).and_then(|x| x.as_bool())
}

fn body_u32(v: &Value, name: &str) -> Option<u32> {
    v.get(name).and_then(|x| x.as_u64()).map(|x| x as u32)
}

fn q_get<'a>(q: &'a HashMap<String, String>, name: &str) -> Option<&'a String> {
    q.get(name).filter(|s| !s.is_empty())
}

fn image_content_type(path: &str) -> &'static str {
    let ext = path
        .split('.')
        .next_back()
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/png",
    }
}

/// 把「带 `Channel<Value>` 的 command」跑起来，事件经假 Channel 转成 mpsc，
/// 收集后返回 `(event_type, data_json)` 列表，供组 SSE。与 `agent/run.rs::agent_run_headless` 同法。
async fn collect_channel_events<F>(run: F) -> Vec<(String, String)>
where
    F: FnOnce(Channel<Value>) -> Pin<Box<dyn std::future::Future<Output = ()> + Send>>,
{
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Value>();
    let tx_clone = tx.clone();
    let channel = Channel::new(move |body: InvokeResponseBody| {
        let value = match body {
            InvokeResponseBody::Json(s) => {
                serde_json::from_str(&s).unwrap_or_else(|_| json!({ "type": "error", "data": { "message": "event json" } }))
            }
            InvokeResponseBody::Raw(bytes) => {
                serde_json::from_slice(&bytes).unwrap_or_else(|_| json!({ "type": "error", "data": { "message": "event raw" } }))
            }
        };
        let _ = tx_clone.send(value);
        Ok(())
    });
    run(channel).await;
    drop(tx);
    let mut events = Vec::new();
    while let Some(event) = rx.recv().await {
        let ty = event
            .get("type")
            .and_then(|t| t.as_str())
            .unwrap_or("message")
            .to_string();
        let data = event.get("data").cloned().unwrap_or(Value::Null);
        events.push((
            ty,
            serde_json::to_string(&data).unwrap_or_else(|_| "{}".to_string()),
        ));
    }
    events
}

pub async fn handle_backend_vibe(
    method: &str,
    path: &str,
    query: &str,
    body: &[u8],
) -> Result<HttpResponse, String> {
    let q = parse_query(query);
    let route = path.strip_prefix("/backend/vibe").unwrap_or(path);
    match (method, route) {
        // ── filesystem ──
        ("GET", "/list") => {
            let path = q_get(&q, "path").cloned().unwrap_or_default();
            return Ok(ok_value(commands::fs::fs_list_core(path).await?));
        }
        ("POST", "/read") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::fs::fs_read(
                    body_str(&body, "path"),
                    body_opt_str(&body, "projectRoot"),
                )
                .await,
            ));
        }
        ("POST", "/write") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::fs::fs_write(
                    body_str(&body, "path"),
                    body_str(&body, "content"),
                    body_opt_str(&body, "projectRoot"),
                )
                .await,
            ));
        }
        ("GET", "/search") => {
            let path = q_get(&q, "path").cloned().unwrap_or_default();
            let query = q_get(&q, "q").cloned().unwrap_or_default();
            return Ok(ok_value(commands::fs::fs_search(path, query).await));
        }
        ("GET", "/grep") => {
            let path = q_get(&q, "path").cloned().unwrap_or_default();
            let query = q_get(&q, "q").cloned().unwrap_or_default();
            return Ok(ok_value(commands::fs::fs_grep(path, query).await));
        }
        ("POST", "/create") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::fs::fs_create(
                    body_str(&body, "path"),
                    body.get("isDirectory").and_then(|x| x.as_bool()).unwrap_or(false),
                    body_opt_str(&body, "content"),
                    body_opt_str(&body, "projectRoot"),
                )
                .await,
            ));
        }
        ("DELETE", "/delete") => {
            let path = q_get(&q, "path").cloned().unwrap_or_default();
            let project_root = q_get(&q, "projectRoot").cloned();
            return Ok(ok_value(commands::fs::fs_delete(path, project_root).await));
        }
        ("POST", "/rename") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::fs::fs_rename(
                    body_str(&body, "from"),
                    body_str(&body, "to"),
                    body_opt_str(&body, "projectRoot"),
                )
                .await,
            ));
        }

        // ── chat sessions ──
        ("GET", "/chat-store-load") => {
            let project_path = q_get(&q, "projectPath").cloned().unwrap_or_default();
            let load_messages = q.get("loadMessages").map(|v| v == "1" || v == "true");
            return Ok(ok_json(
                commands::chat::chat_store_load(project_path, load_messages).await,
            ));
        }
        ("GET", "/chat-session-messages") => {
            let project_path = q_get(&q, "projectPath").cloned().unwrap_or_default();
            let session_id = q_get(&q, "sessionId").cloned().unwrap_or_default();
            return Ok(ok_json(
                commands::chat::chat_session_messages(project_path, session_id).await,
            ));
        }
        ("POST", "/chat-store-sync") => {
            let body = parse_body_json(body)?;
            let project_path = body_str(&body, "projectPath");
            return Ok(ok_json(
                commands::chat::chat_store_sync(
                    project_path,
                    body.get("data").cloned().unwrap_or(Value::Null),
                )
                .await,
            ));
        }
        ("POST", "/chat-session-sync") => {
            let body = parse_body_json(body)?;
            let project_path = body_str(&body, "projectPath");
            let session_id = body_str(&body, "sessionId");
            let data = body.get("data").cloned().unwrap_or(Value::Null);
            let active_session_id = body_opt_str(&body, "activeSessionId");
            return Ok(ok_json(
                commands::chat::chat_session_sync(
                    project_path,
                    session_id,
                    data,
                    active_session_id,
                )
                .await,
            ));
        }
        ("POST", "/chat-session-delete") => {
            let body = parse_body_json(body)?;
            let project_path = body_str(&body, "projectPath");
            let session_id = body_str(&body, "sessionId");
            let active_session_id = body_opt_str(&body, "activeSessionId");
            return Ok(ok_json(
                commands::chat::chat_session_delete(project_path, session_id, active_session_id).await,
            ));
        }
        ("GET", "/chat-image") => {
            let project_path = q_get(&q, "projectPath").cloned().unwrap_or_default();
            let path = q_get(&q, "path").cloned().unwrap_or_default();
            return Ok(ok_json(commands::chat::chat_image(project_path, path).await));
        }
        ("GET", "/chat-image-file") => {
            let project_path = q_get(&q, "projectPath").cloned().unwrap_or_default();
            let path = q_get(&q, "path").cloned().unwrap_or_default();
            let content_type = image_content_type(&path);
            return match commands::chat::chat_image_file(project_path, path).await {
                Ok(bytes) => Ok(ok_bytes(bytes, content_type)),
                Err(e) => Ok(error_response(404, &e)),
            };
        }

        // ── git ──
        ("GET", "/git/status") => {
            let path = q_get(&q, "path").cloned().unwrap_or_default();
            return Ok(ok_value(commands::git::git_status(path).await));
        }
        ("GET", "/git/repos") => {
            let path = q_get(&q, "path").cloned().unwrap_or_default();
            return Ok(ok_value(commands::git::git_list_repos(path).await));
        }
        ("GET", "/git/changed-since") => {
            let path = q_get(&q, "path").cloned().unwrap_or_default();
            let since = q_get(&q, "since").cloned().unwrap_or_default();
            return Ok(ok_json(commands::git::git_changed_since(path, since).await));
        }
        ("GET", "/git/diff") => {
            let path = q_get(&q, "path").cloned().unwrap_or_default();
            let staged = q.get("staged").and_then(|v| v.parse::<bool>().ok());
            let file = q_get(&q, "file").cloned();
            return Ok(ok_value(commands::git::git_diff(path, staged, file).await));
        }
        ("GET", "/git/diff-content") => {
            let path = q_get(&q, "path").cloned().unwrap_or_default();
            let file = q_get(&q, "file").cloned().unwrap_or_default();
            let staged = q.get("staged").and_then(|v| v.parse::<bool>().ok());
            return Ok(ok_value(commands::git::git_diff_content(path, file, staged).await));
        }
        ("GET", "/git/commit-file-diff") => {
            let path = q_get(&q, "path").cloned().unwrap_or_default();
            let hash = q_get(&q, "hash").cloned().unwrap_or_default();
            let file = q_get(&q, "file").cloned().unwrap_or_default();
            let old_file = q_get(&q, "oldFile").cloned();
            return Ok(ok_value(
                commands::git::git_commit_file_diff(path, hash, file, old_file).await,
            ));
        }
        ("POST", "/git/commit") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::git::git_commit(body_str(&body, "path"), body_str(&body, "message")).await,
            ));
        }
        ("GET", "/git/log") => {
            let path = q_get(&q, "path").cloned().unwrap_or_default();
            let count = q_get(&q, "count").and_then(|v| v.parse::<u32>().ok());
            let search = q_get(&q, "search").cloned();
            let author = q_get(&q, "author").cloned();
            let file_path = q_get(&q, "file").cloned();
            let since = q_get(&q, "since").cloned();
            let until = q_get(&q, "until").cloned();
            let all = q.get("all").and_then(|v| v.parse::<bool>().ok());
            let branch = q_get(&q, "branch").cloned();
            return Ok(ok_value(
                commands::git::git_log(
                    path, count, search, author, file_path, since, until, all, branch,
                )
                .await,
            ));
        }
        ("GET", "/git/ahead-commits") => {
            let path = q_get(&q, "path").cloned().unwrap_or_default();
            let count = q_get(&q, "count").and_then(|v| v.parse::<u32>().ok());
            return Ok(ok_value(commands::git::git_ahead_commits(path, count).await));
        }
        ("GET", "/git/behind-commits") => {
            let path = q_get(&q, "path").cloned().unwrap_or_default();
            let count = q_get(&q, "count").and_then(|v| v.parse::<u32>().ok());
            return Ok(ok_value(commands::git::git_behind_commits(path, count).await));
        }
        ("POST", "/git/add") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::git::git_add(body_str(&body, "path"), body_str_array(&body, "files")).await,
            ));
        }
        ("POST", "/git/reset") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::git::git_reset(body_str(&body, "path"), body_str_array(&body, "files")).await,
            ));
        }
        ("POST", "/git/reset-to-commit") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::git::git_reset_to_commit(
                    body_str(&body, "path"),
                    body_str(&body, "commit"),
                    body_opt_str(&body, "mode"),
                )
                .await,
            ));
        }
        ("POST", "/git/resolve-conflict") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::git::git_resolve_conflict(
                    body_str(&body, "path"),
                    body_str(&body, "file"),
                    body_str(&body, "side"),
                )
                .await,
            ));
        }
        ("POST", "/git/discard") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::git::git_discard(body_str(&body, "path"), body_str_array(&body, "files")).await,
            ));
        }
        ("POST", "/git/ignore-local") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::git::git_ignore_local_changes(
                    body_str(&body, "path"),
                    body_str_array(&body, "files"),
                )
                .await,
            ));
        }
        ("POST", "/git/unignore-local") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::git::git_unignore_local_changes(
                    body_str(&body, "path"),
                    body_str_array(&body, "files"),
                )
                .await,
            ));
        }
        ("GET", "/git/ignored-local") => {
            let path = q_get(&q, "path").cloned().unwrap_or_default();
            return Ok(ok_value(commands::git::git_list_ignored_local_changes(path).await));
        }
        ("GET", "/git/remotes") => {
            let path = q_get(&q, "path").cloned().unwrap_or_default();
            return Ok(ok_value(commands::git::git_remotes(path).await));
        }
        ("POST", "/git/fetch") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::git::git_fetch(body_str(&body, "path"), body_opt_str(&body, "remote")).await,
            ));
        }
        ("POST", "/git/pull") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::git::git_pull(
                    body_str(&body, "path"),
                    body_opt_str(&body, "remote"),
                    body_opt_str(&body, "branch"),
                )
                .await,
            ));
        }
        ("POST", "/git/push") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::git::git_push(
                    body_str(&body, "path"),
                    body_opt_str(&body, "remote"),
                    body_opt_str(&body, "branch"),
                    body_opt_bool(&body, "setUpstream"),
                )
                .await,
            ));
        }
        ("GET", "/git/stash-list") => {
            let path = q_get(&q, "path").cloned().unwrap_or_default();
            return Ok(ok_value(commands::git::git_stash_list(path).await));
        }
        ("POST", "/git/stash-save") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::git::git_stash_save(body_str(&body, "path"), body_opt_str(&body, "message"))
                    .await,
            ));
        }
        ("POST", "/git/stash-pop") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::git::git_stash_pop(body_str(&body, "path"), body_u32(&body, "stashIndex")).await,
            ));
        }
        ("POST", "/git/stash-apply") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::git::git_stash_apply(
                    body_str(&body, "path"),
                    body_u32(&body, "stashIndex").unwrap_or(0),
                )
                .await,
            ));
        }
        ("POST", "/git/stash-drop") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::git::git_stash_drop(
                    body_str(&body, "path"),
                    body_u32(&body, "stashIndex").unwrap_or(0),
                )
                .await,
            ));
        }
        ("GET", "/git/branches") => {
            let path = q_get(&q, "path").cloned().unwrap_or_default();
            return Ok(ok_value(commands::git::git_branches(path).await));
        }
        ("POST", "/git/checkout") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::git::git_checkout(
                    body_str(&body, "path"),
                    body_str(&body, "branch"),
                    body_opt_bool(&body, "createNew"),
                    body_opt_str(&body, "startPoint"),
                )
                .await,
            ));
        }
        ("POST", "/git/branch/delete") => {
            let body = parse_body_json(body)?;
            return Ok(ok_json(
                commands::git::git_branch_delete(
                    body_str(&body, "path"),
                    body_str(&body, "branch"),
                    body_opt_bool(&body, "force"),
                )
                .await,
            ));
        }
        ("GET", "/git/op-state") => {
            let path = q_get(&q, "path").cloned().unwrap_or_default();
            return Ok(ok_value(commands::git::git_op_state(path).await));
        }
        ("POST", "/git/merge") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::git::git_merge(body_str(&body, "path"), body_str(&body, "branch")).await,
            ));
        }
        ("POST", "/git/merge-abort") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(commands::git::git_merge_abort(body_str(&body, "path")).await));
        }
        ("POST", "/git/rebase") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::git::git_rebase(body_str(&body, "path"), body_str(&body, "onto")).await,
            ));
        }
        ("POST", "/git/rebase-abort") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(commands::git::git_rebase_abort(body_str(&body, "path")).await));
        }
        ("POST", "/git/cherry-pick") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::git::git_cherry_pick(body_str(&body, "path"), body_str(&body, "commit")).await,
            ));
        }
        ("POST", "/git/revert-commit") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::git::git_revert_commit(body_str(&body, "path"), body_str(&body, "commit")).await,
            ));
        }
        ("GET", "/git/tag-list") => {
            let path = q_get(&q, "path").cloned().unwrap_or_default();
            return Ok(ok_value(commands::git::git_tag_list(path).await));
        }
        ("POST", "/git/tag-create") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::git::git_tag_create(
                    body_str(&body, "path"),
                    body_str(&body, "name"),
                    body_opt_str(&body, "commit"),
                    body_opt_str(&body, "message"),
                )
                .await,
            ));
        }
        ("POST", "/git/tag-delete") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::git::git_tag_delete(body_str(&body, "path"), body_str(&body, "name")).await,
            ));
        }
        ("GET", "/git/submodule-status") => {
            let path = q_get(&q, "path").cloned().unwrap_or_default();
            return Ok(ok_value(commands::git::git_submodule_status(path).await));
        }
        ("POST", "/git/submodule-update") => {
            let body = parse_body_json(body)?;
            return Ok(ok_value(
                commands::git::git_submodule_update(body_str(&body, "path"), body_opt_bool(&body, "init"))
                    .await,
            ));
        }
        ("POST", "/git/generate-message") => {
            let body = parse_body_json(body)?;
            let path = body_str(&body, "path");
            let endpoint = body_str(&body, "endpoint");
            let api_key = body_opt_str(&body, "apiKey");
            let model = body_str(&body, "model");
            let events = collect_channel_events(move |channel| {
                Box::pin(async move {
                    commands::git::git_generate_message(path, endpoint, api_key, model, channel).await;
                })
            })
            .await;
            return Ok(sse_http_response(&events));
        }
        ("POST", "/git/ai-batch-groups") => {
            let body = parse_body_json(body)?;
            let path = body_str(&body, "path");
            let endpoint = body_str(&body, "endpoint");
            let api_key = body_opt_str(&body, "apiKey");
            let model = body_str(&body, "model");
            let events = collect_channel_events(move |channel| {
                Box::pin(async move {
                    commands::git::git_ai_batch_groups(path, endpoint, api_key, model, channel).await;
                })
            })
            .await;
            return Ok(sse_http_response(&events));
        }

        // ── project ──
        ("POST", "/project-context") => {
            let body = parse_body_json(body)?;
            return Ok(ok_json(commands::project::project_context(body_str(&body, "path")).await));
        }
        ("GET", "/project-architect-review") => {
            let project_path = q_get(&q, "projectPath").cloned().unwrap_or_default();
            return Ok(ok_json(
                commands::project::project_architect_review_get(project_path).await,
            ));
        }
        ("POST", "/project-architect-review") => {
            let body = parse_body_json(body)?;
            return Ok(ok_json(
                commands::project::project_architect_review_save(
                    body_str(&body, "projectPath"),
                    body_str(&body, "body"),
                )
                .await,
            ));
        }
        ("GET", "/project-architect-review/context") => {
            let project_path = q_get(&q, "projectPath").cloned().unwrap_or_default();
            return Ok(ok_json(
                commands::project::project_architect_review_context(project_path).await,
            ));
        }
        ("GET", "/project-architect-review/history") => {
            let project_path = q_get(&q, "projectPath").cloned().unwrap_or_default();
            let review_id = q_get(&q, "reviewId").cloned();
            return Ok(ok_json(
                commands::project::project_architect_review_history(project_path, review_id).await,
            ));
        }
        ("DELETE", "/project-architect-review/history") => {
            let project_path = q_get(&q, "projectPath").cloned().unwrap_or_default();
            let review_id = q_get(&q, "reviewId").cloned().unwrap_or_default();
            return Ok(ok_json(
                commands::project::project_architect_review_history_delete(project_path, review_id).await,
            ));
        }
        ("GET", "/project-memory") => {
            let project_path = q_get(&q, "projectPath").cloned().unwrap_or_default();
            return Ok(ok_json(commands::project::project_memory_get(project_path).await));
        }
        ("POST", "/project-memory") => {
            let body = parse_body_json(body)?;
            return Ok(ok_json(
                commands::project::project_memory_save(
                    body_str(&body, "projectPath"),
                    body_str(&body, "content"),
                )
                .await,
            ));
        }
        ("GET", "/project-knowledge") => {
            let project_path = q_get(&q, "projectPath").cloned().unwrap_or_default();
            return Ok(ok_json(commands::project::project_knowledge_get(project_path).await));
        }
        ("POST", "/project-knowledge") => {
            let body = parse_body_json(body)?;
            return Ok(ok_json(
                commands::project::project_knowledge_save(
                    body_str(&body, "projectPath"),
                    body_str(&body, "content"),
                )
                .await,
            ));
        }
        ("GET", "/project-skills") => {
            let project_path = q_get(&q, "projectPath").cloned().unwrap_or_default();
            let slug = q_get(&q, "slug").cloned();
            return Ok(ok_json(
                commands::project::project_skills_list(project_path, slug).await,
            ));
        }
        ("POST", "/project-skills") => {
            let body = parse_body_json(body)?;
            return Ok(ok_json(
                commands::project::project_skills_save(
                    body_str(&body, "projectPath"),
                    body_str(&body, "slug"),
                    body_str(&body, "content"),
                )
                .await,
            ));
        }
        ("GET", "/project-health-scan") => {
            let project_path = q_get(&q, "projectPath").cloned().unwrap_or_default();
            return Ok(ok_json(commands::project::project_health_scan(project_path).await));
        }
        ("GET", "/project-verify-run") => {
            let project_path = q_get(&q, "projectPath").cloned().unwrap_or_default();
            return Ok(ok_json(commands::project::project_verify_run(project_path).await));
        }
        ("POST", "/memory-usage") => {
            let body = parse_body_json(body)?;
            return Ok(ok_json(commands::project::memory_usage(body).await));
        }

        // ── desktop-only stubs ──
        ("POST", "/open-folder") => Ok(ok_json(json!({ "ok": false, "error": "服务器模式不支持在服务器上打开文件夹" }))),
        ("POST", "/pick-folder") => Ok(ok_json(json!({ "ok": false, "cancelled": true }))),

        _ => Ok(error_response(404, "not found")),
    }
}

/// 处理不在 `/backend/vibe/` 前缀下的路由：网页抓取与 AI 配置页探测。
pub async fn handle_other_route(
    method: &str,
    path: &str,
    query: &str,
    body: &[u8],
) -> Result<HttpResponse, String> {
    let q = parse_query(query);
    match (method, path) {
        ("POST", "/backend/web/extract") => {
            let body = parse_body_json(body)?;
            let url = body_str(&body, "url");
            let mode = body_opt_str(&body, "mode");
            let limit = body.get("limit").and_then(|v| v.as_u64()).map(|x| x as u32);
            let proxy_url = body_opt_str(&body, "proxyUrl");
            let result = commands::web::web_extract(url, mode, limit, proxy_url).await;
            let result_json = serde_json::to_string(&json!({ "httpStatus": 200, "body": result }))
                .unwrap_or_else(|_| "{}".to_string());
            let progress = serde_json::to_string(&json!({ "message": "抓取网页…" }))
                .unwrap_or_else(|_| "{}".to_string());
            return Ok(sse_http_response(&[
                ("progress".to_string(), progress),
                ("result".to_string(), result_json),
            ]));
        }
        ("POST", "/api/ai/test") => {
            let body = parse_body_json(body)?;
            let endpoint = body_str(&body, "endpoint");
            let api_key = body_opt_str(&body, "apiKey");
            let payload = body.get("body").cloned().unwrap_or(Value::Null);
            return Ok(ok_json(commands::ai::ai_test(endpoint, api_key, payload).await));
        }
        ("GET", "/api/ai/models") => {
            let endpoint = q_get(&q, "endpoint").cloned().unwrap_or_default();
            let api_key = q_get(&q, "apiKey").cloned();
            return Ok(ok_json(commands::ai::ai_models(endpoint, api_key).await));
        }
        ("POST", "/api/ai/tts") => {
            let body = parse_body_json(body)?;
            let endpoint = body_str(&body, "endpoint");
            let api_key = body_opt_str(&body, "apiKey");
            let payload = body.get("body").cloned().unwrap_or(Value::Null);
            return Ok(ok_json(commands::ai::ai_tts(endpoint, api_key, payload).await));
        }
        _ => Ok(error_response(404, "not found")),
    }
}
