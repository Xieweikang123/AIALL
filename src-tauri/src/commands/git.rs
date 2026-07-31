use crate::ai;
use crate::git;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::ipc::Channel;
use tokio::time::timeout;

#[tauri::command]
pub async fn git_status(path: String) -> git::GitStatusResult {
  git::git_status(&path).await
}

#[tauri::command]
pub async fn git_changed_since(path: String, since: String) -> serde_json::Value {
  git::git_changed_files_since(&path, &since).await
}

#[tauri::command]
pub async fn git_diff(path: String, staged: Option<bool>, file: Option<String>) -> git::GitDiffResult {
  git::git_diff(&path, file.as_deref(), staged.unwrap_or(false)).await
}

#[tauri::command]
pub async fn git_diff_content(path: String, file: String, staged: Option<bool>) -> git::GitDiffContentResult {
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
  all: Option<bool>,
) -> git::GitLogResult {
  git::git_log(
    &path,
    count.unwrap_or(20),
    search.as_deref(),
    all.unwrap_or(false),
  )
  .await
}

#[tauri::command]
pub async fn git_ahead_commits(path: String, count: Option<u32>) -> git::GitAheadCommitsResult {
  git::git_ahead_commits(&path, count.unwrap_or(20)).await
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
pub async fn git_remotes(path: String) -> git::GitRemotesResult {
  git::git_remotes(&path).await
}

#[tauri::command]
pub async fn git_fetch(path: String, remote: Option<String>) -> git::GitRemoteActionResult {
  git::git_fetch(&path, remote.as_deref()).await
}

#[tauri::command]
pub async fn git_pull(path: String, remote: Option<String>, branch: Option<String>) -> git::GitRemoteActionResult {
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
  git::git_checkout_branch(&path, &branch, create_new.unwrap_or(false), start_point.as_deref()).await
}

#[tauri::command]
pub async fn git_branch_delete(path: String, branch: String, force: Option<bool>) -> serde_json::Value {
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

fn preprocess_diff(patch: &str, max_chars_per_file: usize, total_max_chars: usize) -> String {
  if patch.is_empty() {
    return String::new();
  }
  // Cap before section scan — AI budget is small; avoid walking multi-MB patches.
  const RAW_SCAN_CAP: usize = 200_000;
  let patch = if patch.len() > RAW_SCAN_CAP {
    let cutoff = patch.char_indices().nth(RAW_SCAN_CAP).map(|(i, _)| i).unwrap_or(patch.len());
    &patch[..cutoff]
  } else {
    patch
  };
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
    let processed = if is_lock_file || is_minified_or_build {
      let lines: Vec<&str> = file_patch.lines().take(4).collect();
      format!("{}\n\n[Diff omitted: lock file or generated/minified asset]\n", lines.join("\n"))
    } else if file_patch.len() > max_chars_per_file {
      format!("{}...\n\n[Diff truncated: exceeded {max_chars_per_file} characters]\n", &file_patch[..max_chars_per_file])
    } else {
      file_patch
    };

    if current_total + processed.len() > total_max_chars {
      let lines: Vec<&str> = processed.lines().take(4).collect();
      let truncated = format!("{}\n\n[Diff omitted: total AI budget limit reached]\n", lines.join("\n"));
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
) -> Result<String, String> {
  let body = json!({
    "model": model,
    "messages": messages,
    "stream": true
  });
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
  path.trim().replace('\\', "/").trim_start_matches("./").to_string()
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

fn parse_ai_batch_groups_json(content: &str, known_paths: &[String]) -> Result<Vec<AiBatchGroup>, String> {
  let cleaned = content.trim();
  let Some(start) = cleaned.find('{') else {
    return Err("模型未返回 JSON 分组".into());
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
    groups.push(AiBatchGroup { name, files, message });
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
    send_error(&status_result.error.unwrap_or_else(|| "获取 Git 状态失败".into()));
    return;
  }

  let staged_files: Vec<_> = status_result.files.iter().filter(|f| f.staged).collect();
  if staged_files.is_empty() {
    let _ = on_event.send(json!({ "type": "done", "data": { "message": "" } }));
    return;
  }

  let diff_result = git::git_diff(&path, None, true).await;
  let diff_text = if diff_result.ok {
    preprocess_diff(&diff_result.patch, 3000, 12000)
  } else {
    String::new()
  };

  let file_list: Vec<String> = staged_files
    .iter()
    .map(|f| format!("{}: {}", f.status, f.path))
    .collect();
  let file_list_str = file_list.join("\n");

  let recent_style = {
    let log = git::git_log(&path, 8, None, false).await;
    if log.ok && !log.entries.is_empty() {
      let lines: Vec<String> = log
        .entries
        .iter()
        .filter_map(|e| {
          let subject = e.message.lines().next().unwrap_or("").trim();
          if subject.is_empty() {
            None
          } else {
            Some(format!("- {subject}"))
          }
        })
        .collect();
      if lines.is_empty() {
        String::new()
      } else {
        format!(
          "\n\n本仓库近期提交（请贴近其语气与长度，不要照抄内容）：\n{}",
          lines.join("\n")
        )
      }
    } else {
      String::new()
    }
  };

  let prompt = format!(
    "你是一个 Git 提交信息生成器。根据以下已暂存的文件变更生成一条准确、口语化的中文提交信息。

已暂存文件列表：
{file_list_str}

Diff 内容：
{diff_text}{recent_style}

要求：
- 使用中文，语气像开发者随手写的备注，自然口语，不要公文腔或宣传口号
- 默认只输出一行（不超过72字符），说清改了啥即可；仅当变更很大、一行说不清时，才空一行再补一两句
- 可用「修了」「加了」「改了」「整理了」等日常说法
- 说清改动意图即可，不必罗列文件名或技术细节堆砌
- 不要加前缀如 'feat:' 或 'fix:'，不要加引号或句号
- 避免「提升可维护性」「优化用户体验」这类空泛套话

示例：
修了支付状态不同步
加了登录，邮箱手机号都能验
把用户模块拆开整理了一下
文档补了几段 API 用法"
  );

  match stream_ai_completion(
    &endpoint,
    api_key.as_deref(),
    &model,
    json!([{ "role": "user", "content": prompt }]),
    &on_event,
    "delta",
  )
  .await
  {
    Ok(content) => {
      let cleaned = content.trim().trim_matches('"').trim().to_string();
      let _ = on_event.send(json!({ "type": "done", "data": { "message": cleaned } }));
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
  const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(90);
  // Only sample file patches when the change set is small; otherwise paths+numstat are enough.
  const SAMPLE_PATCH_FILE_LIMIT: usize = 8;
  const SAMPLE_PATCH_MAX_FILES: usize = 4;

  let send_event = |event_type: &str, data: Value| {
    let _ = on_event.send(json!({ "type": event_type, "data": data }));
  };

  send_event("progress", json!({ "step": "读取变更…" }));

  let status_result = git::git_status(&path).await;
  if !status_result.ok {
    send_event("error", json!({ "error": status_result.error.unwrap_or_else(|| "获取 Git 状态失败".into()) }));
    return;
  }

  let unstaged_files: Vec<_> = status_result.files.iter().filter(|f| !f.staged && f.status != "ignored").collect();
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
          git::git_diff_numstat(&path_for_diff, false).await.unwrap_or_default()
        } else {
          Vec::new()
        }
      },
      async {
        if need_staged {
          git::git_diff_numstat(&path_for_diff, true).await.unwrap_or_default()
        } else {
          Vec::new()
        }
      }
    );

    let mut summary_lines: Vec<String> = Vec::new();
    for e in &staged_ns {
      summary_lines.push(format!("+{}/-{} {} [已暂存]", e.additions, e.deletions, e.path));
    }
    for e in &unstaged_ns {
      summary_lines.push(format!("+{}/-{} {} [未暂存]", e.additions, e.deletions, e.path));
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
        let Ok(patch) = git::git_diff_file_patch_quick(&path_for_diff, &s.path, s.staged).await else {
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
    let staged_list: Vec<String> = source_staged.iter().map(|f| format!("{}: {} [已暂存]", f.status, f.path)).collect();
    file_list_parts.push(staged_list.join("\n"));
  }
  if !source_unstaged.is_empty() {
    let unstaged_list: Vec<String> = source_unstaged.iter().map(|f| format!("{}: {} [未暂存]", f.status, f.path)).collect();
    file_list_parts.push(unstaged_list.join("\n"));
  }
  let file_list_str = file_list_parts.join("\n");
  let known_paths: Vec<String> = source_files.iter().map(|f| normalize_ai_batch_path(&f.path)).collect();

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
- 避免公文腔和「提升可维护性」这类空泛套话；不要加 feat:/fix: 前缀
- 每个文件只能出现在一个组中
- 如果只有一个逻辑变更，分成一组即可
- 使用中文
- 文件列表中的每个文件都必须出现在某一组中（即使抽样 diff 未覆盖该文件）

请严格以 JSON 格式输出，不要包含任何其他文字或 markdown 标记：
{{\"groups\":[{{\"name\":\"分组名称\",\"files\":[\"文件路径\"],\"message\":\"提交信息\"}}]}}"
  );

  send_event("progress", json!({ "step": "请求模型…" }));

  let body = json!({
    "model": model,
    "messages": [{ "role": "user", "content": prompt }],
    "stream": true
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

  loop {
    let next = match timeout(STREAM_IDLE_TIMEOUT, stream.next()).await {
      Ok(item) => item,
      Err(_) => {
        let msg = if got_delta {
          format!("模型输出中断：超过 {}s 无新数据", STREAM_IDLE_TIMEOUT.as_secs())
        } else {
          format!("等待模型首包超时（{}s）", STREAM_IDLE_TIMEOUT.as_secs())
        };
        send_event("error", json!({ "error": msg }));
        return;
      }
    };
    let Some(chunk) = next else { break };
    let chunk = match chunk {
      Ok(c) => c,
      Err(e) => {
        send_event("error", json!({ "error": e.to_string() }));
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
      send_event("error", json!({ "error": detail }));
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
}
