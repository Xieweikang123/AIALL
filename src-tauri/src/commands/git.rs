use crate::ai;
use crate::git;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;

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
pub async fn git_log(path: String, count: Option<u32>, search: Option<String>) -> git::GitLogResult {
  git::git_log(&path, count.unwrap_or(20), search.as_deref()).await
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
pub async fn git_reset(path: String, files: Vec<String>) -> git::GitActionResult {
  git::git_reset(&path, files).await
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
  let mut sse_buffer = String::new();
  let mut full_content = String::new();

  while let Some(chunk) = stream.next().await {
    let chunk = chunk.map_err(|e| e.to_string())?;
    sse_buffer.push_str(&String::from_utf8_lossy(&chunk));

    loop {
      if let Some(pos) = sse_buffer.find('\n') {
        let line = sse_buffer[..pos].trim().to_string();
        sse_buffer = sse_buffer[pos + 1..].to_string();
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
      } else {
        break;
      }
    }
  }
  Ok(full_content)
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiBatchGroup {
  name: String,
  files: Vec<String>,
  message: String,
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

  let prompt = format!(
    "你是一个 Git 提交信息生成器。根据以下已暂存的文件变更生成一条准确的中文提交信息。

已暂存文件列表：
{file_list_str}

Diff 内容：
{diff_text}

要求：
- 使用中文
- 第一行：简洁概括变更（不超过72字符），使用动词开头，描述'做了什么'
- 如果需要，在第一行后空一行，提供更详细的说明（可选）
- 分析变更类型：新功能、修复、重构、文档、样式、测试、构建、配置等
- 描述变更的目的和影响，而不仅仅是代码改动
- 不要加前缀如 'feat:' 或 'fix:'，直接描述变更内容
- 不要加引号或句号

示例：
添加用户登录功能，支持邮箱和手机号验证
修复订单支付状态同步问题，确保库存及时更新
重构用户模块代码结构，提升可维护性和测试覆盖率
更新项目文档，补充API接口使用说明"
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

  if unstaged_files.is_empty() && staged_files.is_empty() {
    send_event("done", json!({ "groups": [] }));
    return;
  }

  let source_files: Vec<_> = staged_files.iter().chain(unstaged_files.iter()).collect();

  send_event("progress", json!({ "step": format!("读取 diff（{} 个文件）…", source_files.len()) }));

  let unstaged_diff = git::git_diff(&path, None, false).await;
  let staged_diff = git::git_diff(&path, None, true).await;

  let mut diff_parts = Vec::new();
  if !unstaged_files.is_empty() {
    if unstaged_diff.ok {
      diff_parts.push(format!("未暂存 diff：\n{}", preprocess_diff(&unstaged_diff.patch, 3000, 15000)));
    }
  }
  if !staged_files.is_empty() {
    if staged_diff.ok {
      diff_parts.push(format!("已暂存 diff：\n{}", preprocess_diff(&staged_diff.patch, 3000, 15000)));
    }
  }
  let diff_text = diff_parts.join("\n\n");

  let mut file_list_parts = Vec::new();
  if !staged_files.is_empty() {
    let staged_list: Vec<String> = staged_files.iter().map(|f| format!("{}: {} [已暂存]", f.status, f.path)).collect();
    file_list_parts.push(staged_list.join("\n"));
  }
  if !unstaged_files.is_empty() {
    let unstaged_list: Vec<String> = unstaged_files.iter().map(|f| format!("{}: {} [未暂存]", f.status, f.path)).collect();
    file_list_parts.push(unstaged_list.join("\n"));
  }
  let file_list_str = file_list_parts.join("\n");

  let prompt = format!(
    "你是一个 Git 提交分组助手。根据以下文件变更，将文件按功能/逻辑相关性分成多个批次，每个批次生成一条中文提交信息。
每个文件标注了 [已暂存] 或 [未暂存] 状态，请一并纳入分组考虑。

文件列表：
{file_list_str}

Diff 内容：
{diff_text}

要求：
- 按功能模块或逻辑相关性分组，不要简单按目录分
- 每组用简洁的中文名称命名（如「认证模块」「UI 样式调整」）
- 每组生成一条中文 commit message（动词开头，描述做了什么）
- 每个文件只能出现在一个组中
- 如果只有一个逻辑变更，分成一组即可
- 使用中文

请严格以 JSON 格式输出，不要包含任何其他文字或 markdown 标记：
{{\"groups\":[{{\"name\":\"分组名称\",\"files\":[\"文件路径\"],\"message\":\"提交信息\"}}]}}"
  );

  send_event("progress", json!({ "step": "AI 分析中…" }));

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

  let mut stream = resp.bytes_stream();
  let mut sse_buffer = String::new();
  let mut content = String::new();

  while let Some(chunk) = stream.next().await {
    let chunk = match chunk {
      Ok(c) => c,
      Err(e) => {
        send_event("error", json!({ "error": e.to_string() }));
        return;
      }
    };
    sse_buffer.push_str(&String::from_utf8_lossy(&chunk));

    loop {
      if let Some(pos) = sse_buffer.find('\n') {
        let line = sse_buffer[..pos].trim().to_string();
        sse_buffer = sse_buffer[pos + 1..].to_string();
        if !line.starts_with("data: ") {
          continue;
        }
        let data_str = line[6..].trim().to_string();
        if data_str == "[DONE]" {
          continue;
        }
        if let Ok(parsed) = serde_json::from_str::<Value>(&data_str) {
          if let Some(delta) = parsed["choices"][0]["delta"]["content"].as_str() {
            content.push_str(delta);
            send_event("delta", json!({ "text": delta }));
          }
        }
      } else {
        break;
      }
    }
  }

  let cleaned = content.trim().to_string();
  let mut groups: Vec<AiBatchGroup> = Vec::new();
  if let Some(json_match) = cleaned.find('{') {
    let json_str = &cleaned[json_match..];
    if let Some(end) = json_str.rfind('}') {
      let json_str = &json_str[..=end];
      if let Ok(parsed) = serde_json::from_str::<Value>(json_str) {
        if let Some(arr) = parsed["groups"].as_array() {
          for g in arr {
            if let (Some(name), Some(files), Some(message)) = (
              g["name"].as_str(),
              g["files"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()),
              g["message"].as_str(),
            ) {
              groups.push(AiBatchGroup {
                name: name.to_string(),
                files,
                message: message.to_string(),
              });
            }
          }
        }
      }
    }
  }

  send_event("done", json!({ "groups": groups }));
}
