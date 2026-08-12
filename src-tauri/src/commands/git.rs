use crate::ai;
use crate::git;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tokio::time::timeout;

#[tauri::command]
pub async fn git_status(path: String) -> git::GitStatusResult {
    git::git_status(&path).await
}

#[tauri::command]
pub async fn git_list_repos(path: String) -> git::GitReposResult {
    git::git_list_repos(&path).await
}

#[tauri::command]
pub async fn git_changed_since(path: String, since: String) -> serde_json::Value {
    git::git_changed_files_since(&path, &since).await
}

#[tauri::command]
pub async fn git_diff(
    path: String,
    staged: Option<bool>,
    file: Option<String>,
) -> git::GitDiffResult {
    git::git_diff(&path, file.as_deref(), staged.unwrap_or(false)).await
}

#[tauri::command]
pub async fn git_diff_content(
    path: String,
    file: String,
    staged: Option<bool>,
) -> git::GitDiffContentResult {
    git::git_diff_content(&path, &file, staged.unwrap_or(false)).await
}

#[tauri::command]
pub async fn git_commit_file_diff(
    path: String,
    hash: String,
    file: String,
    old_file: Option<String>,
) -> git::GitDiffContentResult {
    git::git_commit_file_diff(&path, &hash, &file, old_file.as_deref()).await
}

#[tauri::command]
pub async fn git_commit(path: String, message: String) -> git::GitCommitResult {
    git::git_commit(&path, &message).await
}

#[tauri::command]
pub async fn git_log(
    path: String,
    count: Option<u32>,
    search: Option<String>,
    author: Option<String>,
    file_path: Option<String>,
    since: Option<String>,
    until: Option<String>,
    all: Option<bool>,
    branch: Option<String>,
) -> git::GitLogResult {
    git::git_log(
        &path,
        count.unwrap_or(20),
        search.as_deref(),
        author.as_deref(),
        file_path.as_deref(),
        since.as_deref(),
        until.as_deref(),
        all.unwrap_or(false),
        branch.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn git_ahead_commits(path: String, count: Option<u32>) -> git::GitAheadCommitsResult {
    git::git_ahead_commits(&path, count.unwrap_or(20)).await
}

#[tauri::command]
pub async fn git_behind_commits(path: String, count: Option<u32>) -> git::GitBehindCommitsResult {
    git::git_behind_commits(&path, count.unwrap_or(20)).await
}

#[tauri::command]
pub async fn git_add(path: String, files: Vec<String>) -> git::GitActionResult {
    git::git_add(&path, files).await
}

#[tauri::command]
pub async fn git_list_hunks(
    path: String,
    file: String,
    staged: Option<bool>,
) -> git::GitHunksResult {
    git::git_list_hunks(&path, &file, staged.unwrap_or(false)).await
}

#[tauri::command]
pub async fn git_stage_hunk(path: String, file: String, hunk_index: u32) -> git::GitActionResult {
    git::git_stage_hunk(&path, &file, hunk_index).await
}

#[tauri::command]
pub async fn git_unstage_hunk(path: String, file: String, hunk_index: u32) -> git::GitActionResult {
    git::git_unstage_hunk(&path, &file, hunk_index).await
}

#[tauri::command]
pub async fn git_reset(path: String, files: Vec<String>) -> git::GitActionResult {
    git::git_reset(&path, files).await
}

#[tauri::command]
pub async fn git_reset_to_commit(
    path: String,
    commit: String,
    mode: Option<String>,
) -> git::GitActionResult {
    git::git_reset_to_commit(&path, &commit, mode.as_deref().unwrap_or("mixed")).await
}

#[tauri::command]
pub async fn git_resolve_conflict(
    path: String,
    file: String,
    side: String,
) -> git::GitActionResult {
    git::git_resolve_conflict(&path, &file, &side).await
}

#[tauri::command]
pub async fn git_discard(path: String, files: Vec<String>) -> git::GitActionResult {
    git::git_discard(&path, files).await
}

#[tauri::command]
pub async fn git_ignore_local_changes(
    path: String,
    files: Vec<String>,
) -> git::GitIgnoreLocalResult {
    git::git_ignore_local_changes(&path, files).await
}

#[tauri::command]
pub async fn git_unignore_local_changes(
    path: String,
    files: Vec<String>,
) -> git::GitIgnoreLocalResult {
    git::git_unignore_local_changes(&path, files).await
}

#[tauri::command]
pub async fn git_list_ignored_local_changes(path: String) -> git::GitIgnoreLocalResult {
    git::git_list_ignored_local_changes(&path).await
}

#[tauri::command]
pub async fn git_remotes(path: String) -> git::GitRemotesResult {
    git::git_remotes(&path).await
}

#[tauri::command]
pub async fn git_fetch(path: String, remote: Option<String>) -> git::GitRemoteActionResult {
    git::git_fetch(&path, remote.as_deref()).await
}

#[tauri::command]
pub async fn git_pull(
    path: String,
    remote: Option<String>,
    branch: Option<String>,
) -> git::GitRemoteActionResult {
    git::git_pull(&path, remote.as_deref(), branch.as_deref()).await
}

#[tauri::command]
pub async fn git_push(
    path: String,
    remote: Option<String>,
    branch: Option<String>,
    set_upstream: Option<bool>,
) -> git::GitRemoteActionResult {
    git::git_push(
        &path,
        remote.as_deref(),
        branch.as_deref(),
        set_upstream.unwrap_or(false),
    )
    .await
}

#[tauri::command]
pub async fn git_stash_list(path: String) -> git::GitStashListResult {
    git::git_stash_list(&path).await
}

#[tauri::command]
pub async fn git_stash_save(path: String, message: Option<String>) -> git::GitStashResult {
    git::git_stash_save(&path, message.as_deref()).await
}

#[tauri::command]
pub async fn git_stash_pop(path: String, stash_index: Option<u32>) -> git::GitStashResult {
    git::git_stash_pop(&path, stash_index).await
}

#[tauri::command]
pub async fn git_stash_apply(path: String, stash_index: u32) -> git::GitStashResult {
    git::git_stash_apply(&path, stash_index).await
}

#[tauri::command]
pub async fn git_stash_drop(path: String, stash_index: u32) -> git::GitStashResult {
    git::git_stash_drop(&path, stash_index).await
}

#[tauri::command]
pub async fn git_branches(path: String) -> git::GitBranchesResult {
    git::git_list_branches(&path).await
}

#[tauri::command]
pub async fn git_checkout(
    path: String,
    branch: String,
    create_new: Option<bool>,
    start_point: Option<String>,
) -> serde_json::Value {
    git::git_checkout_branch(
        &path,
        &branch,
        create_new.unwrap_or(false),
        start_point.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn git_branch_delete(
    path: String,
    branch: String,
    force: Option<bool>,
) -> serde_json::Value {
    git::git_delete_branch(&path, &branch, force.unwrap_or(false)).await
}

#[tauri::command]
pub async fn git_op_state(path: String) -> git::GitOpStateResult {
    git::git_op_state(&path).await
}

#[tauri::command]
pub async fn git_merge(path: String, branch: String) -> git::GitActionResult {
    git::git_merge(&path, &branch).await
}

#[tauri::command]
pub async fn git_merge_abort(path: String) -> git::GitActionResult {
    git::git_merge_abort(&path).await
}

#[tauri::command]
pub async fn git_rebase(path: String, onto: String) -> git::GitActionResult {
    git::git_rebase(&path, &onto).await
}

#[tauri::command]
pub async fn git_rebase_abort(path: String) -> git::GitActionResult {
    git::git_rebase_abort(&path).await
}

#[tauri::command]
pub async fn git_cherry_pick(path: String, commit: String) -> git::GitActionResult {
    git::git_cherry_pick(&path, &commit).await
}

#[tauri::command]
pub async fn git_revert_commit(path: String, commit: String) -> git::GitActionResult {
    git::git_revert_commit(&path, &commit).await
}

#[tauri::command]
pub async fn git_tag_list(path: String) -> git::GitTagsResult {
    git::git_tag_list(&path).await
}

#[tauri::command]
pub async fn git_tag_create(
    path: String,
    name: String,
    commit: Option<String>,
    message: Option<String>,
) -> git::GitActionResult {
    git::git_tag_create(&path, &name, commit.as_deref(), message.as_deref()).await
}

#[tauri::command]
pub async fn git_tag_delete(path: String, name: String) -> git::GitActionResult {
    git::git_tag_delete(&path, &name).await
}

#[tauri::command]
pub async fn git_submodule_status(path: String) -> git::GitSubmodulesResult {
    git::git_submodule_status(&path).await
}

#[tauri::command]
pub async fn git_submodule_update(path: String, init: Option<bool>) -> git::GitActionResult {
    git::git_submodule_update(&path, init.unwrap_or(true)).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitGenerateMessageResult {
    pub ok: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn truncate_at_char_boundary(s: &str, max_chars: usize) -> &str {
    match s.char_indices().nth(max_chars) {
        Some((i, _)) => &s[..i],
        None => s,
    }
}

/// Topic key for multi-feature detection: first two path segments (or file name).
fn change_topic_key(path: &str) -> String {
    let p = path.replace('\\', "/");
    let parts: Vec<&str> = p.split('/').filter(|s| !s.is_empty()).collect();
    match parts.as_slice() {
        [] => String::new(),
        [only] => (*only).to_string(),
        [a, b, ..] => format!("{a}/{b}"),
    }
}

fn is_likely_multi_topic(paths: &[&str]) -> bool {
    if paths.len() < 4 {
        return false;
    }
    let mut keys = std::collections::BTreeSet::new();
    for p in paths {
        let key = change_topic_key(p);
        if !key.is_empty() {
            keys.insert(key);
        }
    }
    keys.len() >= 3
}

fn looks_like_ident_start(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '_' || c == '$'
}

fn looks_like_ident_cont(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '$'
}

fn take_ident(s: &str) -> Option<&str> {
    let mut chars = s.char_indices();
    let (start, first) = chars.next()?;
    if !looks_like_ident_start(first) {
        return None;
    }
    let mut end = start + first.len_utf8();
    for (i, c) in chars {
        if !looks_like_ident_cont(c) {
            break;
        }
        end = i + c.len_utf8();
    }
    let ident = &s[..end];
    if ident.len() < 2 {
        return None;
    }
    Some(ident)
}

/// Pull declaration-like names from a source line (best-effort, multi-language).
fn extract_decl_name(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty()
        || trimmed.starts_with("//")
        || trimmed.starts_with('#')
        || trimmed.starts_with('*')
    {
        return None;
    }
    const DECL_STARTERS: &[&str] = &[
        "function",
        "fn",
        "def",
        "class",
        "interface",
        "type",
        "struct",
        "enum",
        "const",
        "let",
        "var",
    ];
    const SKIP: &[&str] = &[
        "export",
        "async",
        "pub",
        "public",
        "private",
        "protected",
        "internal",
        "override",
        "virtual",
        "readonly",
        "static",
        "default",
    ];
    let mut rest = trimmed;
    let mut saw_decl = false;
    for _ in 0..6 {
        let Some(tok) = take_ident(rest) else { break };
        if SKIP.iter().any(|k| *k == tok) {
            rest = rest[tok.len()..].trim_start();
            continue;
        }
        if DECL_STARTERS.iter().any(|k| *k == tok) {
            saw_decl = true;
            rest = rest[tok.len()..].trim_start();
            // type Foo = / const Foo = — name follows
            continue;
        }
        if saw_decl {
            return Some(tok.to_string());
        }
        // Hunk context without keyword: accept first ident (e.g. `foo(bar) {`)
        return Some(tok.to_string());
    }
    None
}

fn extract_symbols_from_patch(patch: &str, limit: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    const NOISE: &[&str] = &[
        "return", "if", "else", "for", "while", "switch", "case", "break", "continue", "throw",
        "try", "catch", "import", "from", "await", "yield", "new", "this", "super", "true",
        "false", "null",
    ];
    for line in patch.lines() {
        if out.len() >= limit {
            break;
        }
        if let Some(after) = line.strip_prefix("@@") {
            if let Some(idx) = after.find("@@") {
                let ctx = after[idx + 2..].trim();
                if let Some(name) = extract_decl_name(ctx) {
                    if !NOISE.iter().any(|n| *n == name) && seen.insert(name.clone()) {
                        out.push(name);
                    }
                }
            }
            continue;
        }
        if line.starts_with('+') && !line.starts_with("+++") {
            let body = &line[1..];
            let trimmed = body.trim_start();
            let looks_decl = trimmed.starts_with("function ")
                || trimmed.starts_with("async function ")
                || trimmed.starts_with("export ")
                || trimmed.starts_with("fn ")
                || trimmed.starts_with("pub ")
                || trimmed.starts_with("def ")
                || trimmed.starts_with("class ")
                || trimmed.starts_with("interface ")
                || trimmed.starts_with("type ")
                || trimmed.starts_with("struct ")
                || trimmed.starts_with("enum ")
                || trimmed.starts_with("const ")
                || trimmed.starts_with("let ");
            if !looks_decl {
                continue;
            }
            if let Some(name) = extract_decl_name(body) {
                if !NOISE.iter().any(|n| *n == name) && seen.insert(name.clone()) {
                    out.push(name);
                }
            }
        }
    }
    out
}

fn symbols_for_file_patch(file_patch: &str, limit: usize) -> Vec<String> {
    extract_symbols_from_patch(file_patch, limit)
}

fn split_patch_by_file(patch: &str) -> Vec<(String, String)> {
    let mut files = Vec::new();
    for section in patch.split("diff --git ") {
        let section = section.trim();
        if section.is_empty() {
            continue;
        }
        let header = section.lines().next().unwrap_or("");
        // header like: a/path b/path
        let path = header
            .split_whitespace()
            .nth(1)
            .map(|p| p.trim_start_matches("b/").replace('\\', "/"))
            .filter(|p| !p.is_empty())
            .unwrap_or_else(|| {
                header
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .trim_start_matches("a/")
                    .replace('\\', "/")
            });
        if path.is_empty() {
            continue;
        }
        files.push((path, format!("diff --git {section}")));
    }
    files
}

fn build_change_checklist(
    staged_paths: &[&str],
    numstat: &[git::GitNumstatEntry],
    patch: &str,
) -> String {
    let mut numstat_map = std::collections::HashMap::<String, (u32, u32)>::new();
    for e in numstat {
        numstat_map.insert(e.path.replace('\\', "/"), (e.additions, e.deletions));
    }
    let file_patches = split_patch_by_file(patch);
    let mut patch_map = std::collections::HashMap::<String, &str>::new();
    for (p, body) in &file_patches {
        patch_map.insert(p.clone(), body.as_str());
    }

    let mut lines = Vec::new();
    for path in staged_paths {
        let norm = path.replace('\\', "/");
        let (add, del) = numstat_map.get(&norm).copied().unwrap_or((0, 0));
        let symbols = patch_map
            .get(&norm)
            .map(|p| symbols_for_file_patch(p, 4))
            .unwrap_or_default();
        if symbols.is_empty() {
            lines.push(format!("- {norm} (+{add}/-{del})"));
        } else {
            lines.push(format!(
                "- {norm} (+{add}/-{del}) 符号: {}",
                symbols.join(", ")
            ));
        }
    }
    if lines.is_empty() {
        String::new()
    } else {
        format!("改动清单：\n{}", lines.join("\n"))
    }
}

fn preprocess_diff(patch: &str, max_chars_per_file: usize, total_max_chars: usize) -> String {
    if patch.is_empty() {
        return String::new();
    }
    // Cap before section scan — AI budget is small; avoid walking multi-MB patches.
    const RAW_SCAN_CAP: usize = 200_000;
    let patch = truncate_at_char_boundary(patch, RAW_SCAN_CAP);
    let mut result = String::new();
    let mut current_total = 0;

    for section in patch.split("diff --git ") {
        let section = section.trim();
        if section.is_empty() {
            continue;
        }
        let header_line = section.lines().next().unwrap_or("");
        let is_lock_file = header_line.contains("package-lock.json")
            || header_line.contains("pnpm-lock.yaml")
            || header_line.contains("yarn.lock");
        let is_minified_or_build = header_line.contains("dist/")
            || header_line.contains("build/")
            || header_line.contains("out/")
            || header_line.contains(".min.js")
            || header_line.contains(".min.css");

        let file_patch = format!("diff --git {section}");
        let char_len = file_patch.chars().count();
        let processed = if is_lock_file || is_minified_or_build {
            let lines: Vec<&str> = file_patch.lines().take(4).collect();
            format!(
                "{}\n\n[Diff omitted: lock file or generated/minified asset]\n",
                lines.join("\n")
            )
        } else if char_len > max_chars_per_file {
            format!(
                "{}...\n\n[Diff truncated: exceeded {max_chars_per_file} characters]\n",
                truncate_at_char_boundary(&file_patch, max_chars_per_file)
            )
        } else {
            file_patch
        };

        if current_total + processed.len() > total_max_chars {
            let lines: Vec<&str> = processed.lines().take(4).collect();
            let truncated = format!(
                "{}\n\n[Diff omitted: total AI budget limit reached]\n",
                lines.join("\n")
            );
            if current_total + truncated.len() <= total_max_chars + 1000 {
                result.push_str(&truncated);
            }
            break;
        }
        result.push_str(&processed);
        current_total += processed.len();
    }
    result
}

async fn stream_ai_completion(
    endpoint: &str,
    api_key: Option<&str>,
    model: &str,
    messages: Value,
    channel: &Channel<Value>,
    event_type: &str,
    temperature: Option<f32>,
) -> Result<String, String> {
    let mut body = json!({
      "model": model,
      "messages": messages,
      "stream": true
    });
    if let Some(temp) = temperature {
        body["temperature"] = json!(temp);
    }
    let resp = ai::chat_completion_stream_raw(endpoint, api_key, body).await?;
    let mut stream = resp.bytes_stream();
    let mut sse_buffer: Vec<u8> = Vec::new();
    let mut full_content = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        sse_buffer.extend_from_slice(&chunk);

        while let Some(pos) = sse_buffer.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = sse_buffer.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line_bytes).trim().to_string();
            if !line.starts_with("data: ") {
                continue;
            }
            let data_str = line[6..].trim().to_string();
            if data_str == "[DONE]" {
                continue;
            }
            if let Ok(parsed) = serde_json::from_str::<Value>(&data_str) {
                if let Some(delta) = parsed["choices"][0]["delta"]["content"].as_str() {
                    full_content.push_str(delta);
                    let _ = channel.send(json!({
                      "type": event_type,
                      "data": { "text": delta }
                    }));
                }
            }
        }
    }
    Ok(full_content)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiBatchGroup {
    name: String,
    files: Vec<String>,
    message: String,
}

fn normalize_ai_batch_path(path: &str) -> String {
    path.trim()
        .replace('\\', "/")
        .trim_start_matches("./")
        .to_string()
}

fn resolve_ai_batch_path<'a>(raw: &str, known: &'a [String]) -> Option<&'a str> {
    let norm = normalize_ai_batch_path(raw);
    if norm.is_empty() {
        return None;
    }
    if let Some(exact) = known.iter().find(|p| p.as_str() == norm) {
        return Some(exact.as_str());
    }
    let lower = norm.to_ascii_lowercase();
    known
        .iter()
        .find(|p| p.eq_ignore_ascii_case(&norm) || p.to_ascii_lowercase().ends_with(&lower))
        .map(|p| p.as_str())
}

/// Recover only fully closed group objects from a truncated JSON response.
/// This is diagnostic/preview data; callers must not treat it as complete AI output.
fn extract_complete_ai_batch_groups(content: &str, known_paths: &[String]) -> Vec<AiBatchGroup> {
    let Some(groups_start) = content.find('[') else {
        return Vec::new();
    };
    let bytes = content.as_bytes();
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    let mut object_start = None;
    let mut result = Vec::new();

    for i in groups_start..bytes.len() {
        let c = bytes[i] as char;
        if escaped {
            escaped = false;
            continue;
        }
        if c == '\\' && in_string {
            escaped = true;
            continue;
        }
        if c == '"' {
            in_string = !in_string;
            continue;
        }
        if in_string {
            continue;
        }
        match c {
            '{' => {
                if depth == 0 {
                    object_start = Some(i);
                }
                depth += 1;
            }
            '}' if depth > 0 => {
                depth -= 1;
                if depth == 0 {
                    if let Some(start) = object_start.take() {
                        if let Ok(value) = serde_json::from_slice::<Value>(&bytes[start..=i]) {
                            let name = value
                                .get("name")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .trim()
                                .to_string();
                            let message = value
                                .get("message")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .trim()
                                .to_string();
                            let Some(files_val) = value.get("files").and_then(Value::as_array)
                            else {
                                continue;
                            };
                            let files: Vec<String> = files_val
                                .iter()
                                .filter_map(Value::as_str)
                                .filter_map(|raw| {
                                    resolve_ai_batch_path(raw, known_paths).map(str::to_string)
                                })
                                .collect();
                            if !files.is_empty() {
                                result.push(AiBatchGroup {
                                    name,
                                    files,
                                    message,
                                });
                            }
                        }
                    }
                }
            }
            ']' if depth == 0 => break,
            _ => {}
        }
    }
    result
}

/// Strip a wrapping markdown code fence (```json ... ```) so the JSON body
/// can be located even when the model wraps the answer in a fenced block.
fn strip_markdown_code_fence(input: &str) -> &str {
    let trimmed = input.trim();
    if !trimmed.starts_with("```") {
        return trimmed;
    }
    let after_fence = match trimmed.find('\n') {
        Some(idx) => &trimmed[idx + 1..],
        None => return trimmed,
    };
    match after_fence.rfind("```") {
        Some(end) => after_fence[..end].trim(),
        None => after_fence.trim(),
    }
}

fn parse_ai_batch_groups_json(
    content: &str,
    known_paths: &[String],
) -> Result<Vec<AiBatchGroup>, String> {
    let cleaned = strip_markdown_code_fence(content);
    let Some(start) = cleaned.find('{') else {
        if cleaned.trim().is_empty() {
            return Err("模型未返回任何内容。请检查模型服务是否可用，或更换模型后重试".into());
        }
        return Err("模型未返回 JSON 分组（模型输出了文字而非 JSON，或模型不支持结构化输出）。可尝试更换模型后重试".into());
    };
    let Some(end_rel) = cleaned[start..].rfind('}') else {
        return Err("模型返回的 JSON 不完整".into());
    };
    let json_str = &cleaned[start..=start + end_rel];
    let parsed: Value =
        serde_json::from_str(json_str).map_err(|_| "模型返回的 JSON 无法解析".to_string())?;
    let Some(arr) = parsed.get("groups").and_then(|v| v.as_array()) else {
        return Err("模型 JSON 缺少 groups 数组".into());
    };

    let mut groups: Vec<AiBatchGroup> = Vec::new();
    let mut used = std::collections::HashSet::<String>::new();

    for g in arr {
        let name = g
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let message = g
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let Some(files_val) = g.get("files").and_then(|v| v.as_array()) else {
            continue;
        };
        let mut files: Vec<String> = Vec::new();
        for f in files_val {
            let Some(raw) = f.as_str() else { continue };
            let Some(resolved) = resolve_ai_batch_path(raw, known_paths) else {
                continue;
            };
            if used.insert(resolved.to_string()) {
                files.push(resolved.to_string());
            }
        }
        if files.is_empty() {
            continue;
        }
        let name = if name.is_empty() {
            files
                .first()
                .map(|p| {
                    let parts: Vec<_> = p.split('/').collect();
                    if parts.len() > 1 {
                        parts[0].to_string()
                    } else {
                        "变更".to_string()
                    }
                })
                .unwrap_or_else(|| "变更".to_string())
        } else {
            name
        };
        groups.push(AiBatchGroup {
            name,
            files,
            message,
        });
    }

    if groups.is_empty() {
        return Err("模型未产出可用分组（路径可能对不上当前变更）".into());
    }
    Ok(groups)
}

#[tauri::command]
pub async fn git_generate_message(
    path: String,
    endpoint: String,
    api_key: Option<String>,
    model: String,
    on_event: Channel<Value>,
) {
    let send_error = |msg: &str| {
        let _ = on_event.send(json!({ "type": "error", "data": { "error": msg } }));
    };

    let status_result = git::git_status(&path).await;
    if !status_result.ok {
        send_error(
            &status_result
                .error
                .unwrap_or_else(|| "获取 Git 状态失败".into()),
        );
        return;
    }

    let staged_files: Vec<_> = status_result.files.iter().filter(|f| f.staged).collect();
    if staged_files.is_empty() {
        let _ = on_event.send(json!({ "type": "done", "data": { "message": "" } }));
        return;
    }

    let staged_paths: Vec<&str> = staged_files.iter().map(|f| f.path.as_str()).collect();
    let multi_topic = is_likely_multi_topic(&staged_paths);

    let path_for_diff = path.clone();
    let (diff_result, numstat) = tokio::join!(git::git_diff(&path_for_diff, None, true), async {
        git::git_diff_numstat(&path_for_diff, true)
            .await
            .unwrap_or_default()
    });

    let (per_file_budget, total_budget) = if staged_files.len() <= 5 {
        (8000, 24000)
    } else {
        (3000, 12000)
    };
    let raw_patch = if diff_result.ok {
        diff_result.patch
    } else {
        String::new()
    };
    let checklist = build_change_checklist(&staged_paths, &numstat, &raw_patch);
    let diff_text = if raw_patch.is_empty() {
        String::new()
    } else {
        preprocess_diff(&raw_patch, per_file_budget, total_budget)
    };

    let file_list: Vec<String> = staged_files
        .iter()
        .map(|f| format!("{}: {}", f.status, f.path))
        .collect();
    let file_list_str = file_list.join("\n");

    let multi_topic_hint = if multi_topic {
        "\n- 暂存变更看起来跨多个功能/目录：只写覆盖面最大的主改动，或一句能概括共同主题的话；不要把无关功能硬拼进一条"
    } else {
        ""
    };

    let checklist_block = if checklist.is_empty() {
        String::new()
    } else {
        format!("\n\n{checklist}")
    };

    let prompt = format!(
        "你是一个 Git 提交信息生成器。根据以下已暂存变更，生成一条中文提交信息。

已暂存文件列表：
{file_list_str}{checklist_block}

Diff 内容：
{diff_text}

输出格式（必须）：
- 一句说完，结构为「[功能/模块] + [具体改了啥]」
- 优先依据「改动清单」里的路径、+/- 与符号，再对照 Diff；禁止写清单/Diff 未出现的能力或原因
- 功能/模块名只能从路径、符号、diff 上下文推断；推断不出就直接写更具体的改动，禁止瞎编功能名
- 中文口语即可（可用「修了」「加了」「改了」），但信息要准，不要空话
- 默认一行、不超过72字；不要 feat:/fix: 前缀，不要引号或句号
- 禁止「提升可维护性」「优化用户体验」等套话{multi_topic_hint}

示例：
登录态偶发丢失修好了
Git 面板 AI 注释改成按功能写清改动
支付回调状态同步修了
用户模块拆开整理了一下"
    );

    match stream_ai_completion(
        &endpoint,
        api_key.as_deref(),
        &model,
        json!([{ "role": "user", "content": prompt }]),
        &on_event,
        "delta",
        Some(0.2),
    )
    .await
    {
        Ok(content) => {
            let cleaned = content.trim().trim_matches('"').trim().to_string();
            let mut data = json!({ "message": cleaned });
            if multi_topic {
                data["warning"] =
                    json!("变更可能跨多个功能，单条注释容易不准；建议用下方「AI 分批」拆开提交");
            }
            let _ = on_event.send(json!({ "type": "done", "data": data }));
        }
        Err(e) => {
            send_error(&format!("AI 请求失败: {e}"));
        }
    }
}

#[tauri::command]
pub async fn git_ai_batch_groups(
    path: String,
    endpoint: String,
    api_key: Option<String>,
    model: String,
    on_event: Channel<Value>,
) {
    // Fail fast: do not wait for hung git child teardown (Windows can stall on drop).
    const DIFF_TIMEOUT: Duration = Duration::from_secs(8);
    // Abort if the model stream goes silent mid-response.
    const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(45);
    // Only sample file patches when the change set is small; otherwise paths+numstat are enough.
    const SAMPLE_PATCH_FILE_LIMIT: usize = 8;
    const SAMPLE_PATCH_MAX_FILES: usize = 4;

    let send_event = |event_type: &str, data: Value| {
        let _ = on_event.send(json!({ "type": event_type, "data": data }));
    };

    send_event("progress", json!({ "step": "读取变更…" }));

    let status_result = git::git_status(&path).await;
    if !status_result.ok {
        send_event(
            "error",
            json!({ "error": status_result.error.unwrap_or_else(|| "获取 Git 状态失败".into()) }),
        );
        return;
    }

    let unstaged_files: Vec<_> = status_result
        .files
        .iter()
        .filter(|f| !f.staged && f.status != "ignored")
        .collect();
    let staged_files: Vec<_> = status_result.files.iter().filter(|f| f.staged).collect();

    // 与前端分批数据源一致：有未暂存则只划未暂存；否则划已暂存。
    let source_files: Vec<_> = if !unstaged_files.is_empty() {
        unstaged_files.clone()
    } else {
        staged_files.clone()
    };

    if source_files.is_empty() {
        send_event("done", json!({ "groups": [] }));
        return;
    }

    let source_files_len = source_files.len();
    let need_unstaged = source_files.iter().any(|f| !f.staged);
    let need_staged = source_files.iter().any(|f| f.staged);
    let allow_patch_samples = source_files_len <= SAMPLE_PATCH_FILE_LIMIT;

    send_event(
        "progress",
        json!({ "step": format!("读取变更摘要（{} 个文件）…", source_files_len) }),
    );

    let path_for_diff = path.clone();
    let diff_context_fut = async move {
        // Numstat only by default — grouping is mostly path-driven; avoid N parallel git diffs.
        let (unstaged_ns, staged_ns) = tokio::join!(
            async {
                if need_unstaged {
                    git::git_diff_numstat(&path_for_diff, false)
                        .await
                        .unwrap_or_default()
                } else {
                    Vec::new()
                }
            },
            async {
                if need_staged {
                    git::git_diff_numstat(&path_for_diff, true)
                        .await
                        .unwrap_or_default()
                } else {
                    Vec::new()
                }
            }
        );

        let mut summary_lines: Vec<String> = Vec::new();
        for e in &staged_ns {
            summary_lines.push(format!(
                "+{}/-{} {} [已暂存]",
                e.additions, e.deletions, e.path
            ));
        }
        for e in &unstaged_ns {
            summary_lines.push(format!(
                "+{}/-{} {} [未暂存]",
                e.additions, e.deletions, e.path
            ));
        }

        let mut parts: Vec<String> = Vec::new();
        if !summary_lines.is_empty() {
            parts.push(format!("变更量摘要：\n{}", summary_lines.join("\n")));
        }

        if allow_patch_samples {
            #[derive(Clone)]
            struct SampleTarget {
                path: String,
                staged: bool,
                churn: u32,
            }
            let mut samples: Vec<SampleTarget> = Vec::new();
            for e in &staged_ns {
                if git::is_low_value_ai_diff_path(&e.path) {
                    continue;
                }
                samples.push(SampleTarget {
                    path: e.path.clone(),
                    staged: true,
                    churn: e.churn().max(1),
                });
            }
            for e in &unstaged_ns {
                if git::is_low_value_ai_diff_path(&e.path) {
                    continue;
                }
                if samples.iter().any(|s| s.path == e.path) {
                    continue;
                }
                samples.push(SampleTarget {
                    path: e.path.clone(),
                    staged: false,
                    churn: e.churn().max(1),
                });
            }
            samples.sort_by(|a, b| b.churn.cmp(&a.churn));
            let samples: Vec<_> = samples.into_iter().take(SAMPLE_PATCH_MAX_FILES).collect();

            // Sequential short fetches — avoids Windows multi-process lock / drop stalls.
            let mut kept: Vec<String> = Vec::new();
            let mut used = 0usize;
            const PATCH_BUDGET: usize = 8_000;
            for s in samples {
                let label = if s.staged { "已暂存" } else { "未暂存" };
                let Ok(patch) =
                    git::git_diff_file_patch_quick(&path_for_diff, &s.path, s.staged).await
                else {
                    continue;
                };
                if patch.trim().is_empty() {
                    continue;
                }
                let block = format!(
                    "### {} [{label}]\n{}",
                    s.path,
                    preprocess_diff(&patch, 2000, 3000)
                );
                if used + block.len() > PATCH_BUDGET {
                    break;
                }
                used += block.len();
                kept.push(block);
            }
            if !kept.is_empty() {
                parts.push(format!("抽样 diff：\n{}", kept.join("\n\n")));
            }
        }

        if parts.is_empty() {
            "（无可用 diff 摘要，请仅根据上方文件列表按功能相关性分组）".to_string()
        } else {
            parts.join("\n\n")
        }
    };

    // Spawn so DIFF_TIMEOUT can return immediately without awaiting hung child teardown.
    let (diff_tx, diff_rx) = tokio::sync::oneshot::channel::<String>();
    tokio::spawn(async move {
        let text = diff_context_fut.await;
        let _ = diff_tx.send(text);
    });

    let diff_text = match timeout(DIFF_TIMEOUT, diff_rx).await {
        Ok(Ok(text)) => {
            send_event("progress", json!({ "step": "整理上下文…" }));
            text
        }
        Ok(Err(_)) => {
            send_event("progress", json!({ "step": "摘要中断，改用文件列表…" }));
            "（diff 摘要中断，请仅根据上方文件列表按功能相关性分组）".to_string()
        }
        Err(_) => {
            send_event("progress", json!({ "step": "摘要超时，改用文件列表…" }));
            "（diff 摘要超时，请仅根据上方文件列表按功能相关性分组）".to_string()
        }
    };

    let mut file_list_parts = Vec::new();
    let source_staged: Vec<_> = source_files.iter().filter(|f| f.staged).collect();
    let source_unstaged: Vec<_> = source_files.iter().filter(|f| !f.staged).collect();
    if !source_staged.is_empty() {
        let staged_list: Vec<String> = source_staged
            .iter()
            .map(|f| format!("{}: {} [已暂存]", f.status, f.path))
            .collect();
        file_list_parts.push(staged_list.join("\n"));
    }
    if !source_unstaged.is_empty() {
        let unstaged_list: Vec<String> = source_unstaged
            .iter()
            .map(|f| format!("{}: {} [未暂存]", f.status, f.path))
            .collect();
        file_list_parts.push(unstaged_list.join("\n"));
    }
    let file_list_str = file_list_parts.join("\n");
    let known_paths: Vec<String> = source_files
        .iter()
        .map(|f| normalize_ai_batch_path(&f.path))
        .collect();

    let prompt = format!(
    "你是一个 Git 提交分组助手。根据以下文件变更，将文件按功能/逻辑相关性分成多个批次，每个批次生成一条口语化的中文提交信息。
每个文件标注了 [已暂存] 或 [未暂存] 状态，请一并纳入分组考虑。

文件列表：
{file_list_str}

Diff 内容：
{diff_text}

要求：
- 按功能模块或逻辑相关性分组，不要简单按目录分
- 每组用简洁的中文名称命名（如「登录相关」「界面样式」）
- 每组生成一条口语化 commit message：默认一行、不超过72字，像开发者随手备注（「修了」「加了」「改了」等）
- 分组名称不超过20字，commit message 不超过72字；内容越短越好，避免解释过程
- 避免公文腔和「提升可维护性」这类空泛套话；不要加 feat:/fix: 前缀
- 每个文件只能出现在一个组中
- 如果只有一个逻辑变更，分成一组即可
- 使用中文
- 文件列表中的每个文件都必须出现在某一组中（即使抽样 diff 未覆盖该文件）

请严格以 JSON 格式输出，不要包含任何其他文字或 markdown 标记（禁止 ``` 代码块、禁止开头寒暄、禁止结尾解释）：
{{\"groups\":[{{\"name\":\"分组名称\",\"files\":[\"文件路径\"],\"message\":\"提交信息\"}}]}}"
  );

    send_event("progress", json!({ "step": "请求模型…" }));

    // File paths dominate the JSON response. Long paths (e.g. nested C# folders)
    // can consume several tokens each, so budget generously and scale with the
    // change-set size. Hard cap lifted to avoid mid-array truncation.
    let max_tokens = (1600usize + source_files_len.saturating_mul(120)).min(12000);
    let body = json!({
      "model": model,
      "messages": [{ "role": "user", "content": prompt }],
      "stream": true,
      "temperature": 0,
      "max_tokens": max_tokens
    });

    let resp = match ai::chat_completion_stream_raw(&endpoint, api_key.as_deref(), body).await {
        Ok(r) => r,
        Err(e) => {
            send_event("error", json!({ "error": format!("AI 请求失败: {e}") }));
            return;
        }
    };

    send_event("progress", json!({ "step": "等待模型首包…" }));

    let mut stream = resp.bytes_stream();
    let mut sse_buffer: Vec<u8> = Vec::new();
    let mut content = String::new();
    let mut got_delta = false;
    let output_started_at = Instant::now();
    let mut last_progress_at = Instant::now();
    let mut last_progress_chars = 0usize;

    loop {
        let next = match timeout(STREAM_IDLE_TIMEOUT, stream.next()).await {
            Ok(item) => item,
            Err(_) => {
                let msg = if got_delta {
                    format!(
                        "模型输出中断：超过 {}s 无新数据",
                        STREAM_IDLE_TIMEOUT.as_secs()
                    )
                } else {
                    format!("等待模型首包超时（{}s）", STREAM_IDLE_TIMEOUT.as_secs())
                };
                send_event("error", json!({ "error": msg, "partialContent": content }));
                return;
            }
        };
        let Some(chunk) = next else { break };
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                send_event(
                    "error",
                    json!({ "error": e.to_string(), "partialContent": content }),
                );
                return;
            }
        };
        sse_buffer.extend_from_slice(&chunk);

        while let Some(pos) = sse_buffer.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = sse_buffer.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line_bytes).trim().to_string();
            if !line.starts_with("data: ") {
                continue;
            }
            let data_str = line[6..].trim().to_string();
            if data_str == "[DONE]" {
                continue;
            }
            if let Ok(parsed) = serde_json::from_str::<Value>(&data_str) {
                if let Some(delta) = parsed["choices"][0]["delta"]["content"].as_str() {
                    if !got_delta {
                        got_delta = true;
                        send_event("progress", json!({ "step": "模型输出中…" }));
                    }
                    content.push_str(delta);
                    send_event("delta", json!({ "text": delta }));
                    if last_progress_at.elapsed() >= Duration::from_millis(500)
                        || content.chars().count().saturating_sub(last_progress_chars) >= 120
                    {
                        let chars = content.chars().count();
                        send_event(
                            "progress",
                            json!({
                              "step": format!("模型生成分组 · {} 字 · {}s", chars, output_started_at.elapsed().as_secs()),
                              "chars": chars,
                              "elapsedMs": output_started_at.elapsed().as_millis()
                            }),
                        );
                        last_progress_at = Instant::now();
                        last_progress_chars = chars;
                    }
                }
            }
        }
    }

    let cleaned = content.trim().to_string();
    match parse_ai_batch_groups_json(&cleaned, &known_paths) {
        Ok(groups) => {
            send_event("done", json!({ "groups": groups }));
        }
        Err(err) => {
            let preview: String = cleaned.chars().take(180).collect();
            let detail = if preview.is_empty() {
                err
            } else {
                format!("{err}。原文摘要：{preview}")
            };
            send_event(
                "error",
                json!({
                  "error": detail,
                  "partialContent": cleaned,
                  "partialGroups": extract_complete_ai_batch_groups(&cleaned, &known_paths)
                }),
            );
        }
    }
}

#[cfg(test)]
mod ai_batch_parse_tests {
    use super::*;

    #[test]
    fn parses_groups_without_message() {
        let known = vec!["src/a.ts".into(), "pkg/b.ts".into()];
        let raw = r#"{"groups":[{"name":"src","files":["src/a.ts"]},{"name":"pkg","files":["pkg/b.ts"],"message":"改了 b"}]}"#;
        let groups = parse_ai_batch_groups_json(raw, &known).unwrap();
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].message, "");
        assert_eq!(groups[1].message, "改了 b");
    }

    #[test]
    fn remaps_backslash_and_dedupes() {
        let known = vec!["src/a.ts".into()];
        let raw = r#"{"groups":[{"name":"x","files":["src\\a.ts","src/a.ts"],"message":"m"}]}"#;
        let groups = parse_ai_batch_groups_json(raw, &known).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].files, vec!["src/a.ts"]);
    }

    #[test]
    fn rejects_unusable_payload() {
        let known = vec!["src/a.ts".into()];
        let err = parse_ai_batch_groups_json("sorry I cannot", &known).unwrap_err();
        assert!(err.contains("JSON"));
    }

    #[test]
    fn empty_payload_gets_service_hint() {
        let known = vec!["src/a.ts".into()];
        let err = parse_ai_batch_groups_json("", &known).unwrap_err();
        assert!(err.contains("模型未返回任何内容"), "got: {err}");
        assert!(err.contains("模型服务"), "got: {err}");
    }

    #[test]
    fn parses_json_inside_markdown_code_fence() {
        let known = vec!["src/a.ts".into(), "pkg/b.ts".into()];
        let raw = "```json\n{\"groups\":[{\"name\":\"src\",\"files\":[\"src/a.ts\"],\"message\":\"改了 a\"},{\"name\":\"pkg\",\"files\":[\"pkg/b.ts\"],\"message\":\"改了 b\"}]}\n```";
        let groups = parse_ai_batch_groups_json(raw, &known).unwrap();
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].name, "src");
    }

    #[test]
    fn strips_fence_even_when_unclosed() {
        let known = vec!["src/a.ts".into()];
        let raw = "```json\n{\"groups\":[{\"name\":\"src\",\"files\":[\"src/a.ts\"],\"message\":\"m\"}]}";
        let groups = parse_ai_batch_groups_json(raw, &known).unwrap();
        assert_eq!(groups.len(), 1);
    }

    #[test]
    fn recovers_closed_groups_from_truncated_json() {
        let known = vec!["src/a.ts".into(), "src/b.ts".into()];
        let raw = r#"{"groups":[{"name":"src","files":["src/a.ts"],"message":"改了 a"},{"name":"src 2","files":["src/b.ts"#;
        let groups = extract_complete_ai_batch_groups(raw, &known);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].files, vec!["src/a.ts"]);
    }
}

#[cfg(test)]
mod commit_message_context_tests {
    use super::*;

    #[test]
    fn topic_key_uses_first_two_segments() {
        assert_eq!(change_topic_key("src/git/foo.ts"), "src/git");
        assert_eq!(change_topic_key("README.md"), "README.md");
    }

    #[test]
    fn multi_topic_needs_enough_distinct_dirs() {
        let few = ["src/a/x.ts", "src/a/y.ts", "src/a/z.ts", "src/a/w.ts"];
        assert!(!is_likely_multi_topic(&few));
        let many = [
            "src/git/a.ts",
            "src/auth/b.ts",
            "src/pay/c.ts",
            "docs/readme.md",
        ];
        assert!(is_likely_multi_topic(&many));
    }

    #[test]
    fn extracts_symbols_from_decl_and_hunk_context() {
        let patch = r#"diff --git a/src/a.ts b/src/a.ts
@@ -1,3 +1,5 @@ function oldName() {
+export function generateCommitMessage() {
+  return 1;
+}
"#;
        let symbols = extract_symbols_from_patch(patch, 8);
        assert!(symbols.iter().any(|s| s == "generateCommitMessage"));
        assert!(!symbols.iter().any(|s| s == "return"));
    }

    #[test]
    fn checklist_includes_numstat_and_symbols() {
        let paths = ["src/a.ts"];
        let numstat = vec![git::GitNumstatEntry {
            path: "src/a.ts".into(),
            additions: 3,
            deletions: 1,
        }];
        let patch = r#"diff --git a/src/a.ts b/src/a.ts
@@ -1 +1 @@
+function helloWorld() {}
"#;
        let text = build_change_checklist(&paths, &numstat, patch);
        assert!(text.contains("src/a.ts (+3/-1)"));
        assert!(text.contains("helloWorld"));
    }
}
