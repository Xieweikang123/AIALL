use serde_json::Value;

use super::explore_guard::{
  build_blocked_grep_after_locate_message, build_blocked_grep_message,
  build_low_signal_vision_locate_grep_message, build_overly_broad_vision_grep_message,
  build_search_files_content_query_message, check_overlapping_read, check_patch_old_string_from_reads,
  consume_patch_recovery_read, invalidate_file_read_cache, invalidate_file_read_state, is_blocked_grep_after_locate,
  is_blocked_grep_after_vision_misread, is_low_signal_vision_locate_grep, is_overly_broad_vision_grep,
  is_search_files_content_query, is_vision_grep_low_spread, mark_patch_recovery_file,
  read_line_range_from_args, record_grep_hit_vue_files, record_read_range, require_prior_read,
  ToolGuardState,
};
use super::exploration::{
  build_exploration_archive_write_blocked_message, is_exploration_archive_path,
};
use super::plan_path::plan_document_build_mode_block;
use super::probe_guard::{
  build_introspect_probe_blocked_message, is_introspect_business_route_patch,
  LARGE_FILE_LINE_THRESHOLD,
};
use super::tools;
use super::vision::is_runtime_visible_text_grep_pattern;

const MAX_AUTO_BUG_FIX_WRITES: usize = 5;

pub struct ToolExecContext<'a> {
  pub project_path: &'a str,
  pub mode: &'a str,
  pub web_proxy_url: Option<&'a str>,
  pub automated_bug_fix: bool,
  pub written_files: &'a mut Vec<String>,
  pub tool_guard: &'a mut ToolGuardState,
}

pub async fn execute_tool(ctx: &mut ToolExecContext<'_>, name: &str, args: &Value) -> (bool, String) {
  if tools::is_write_tool(name) {
    if let Some(path) = args.get("path").and_then(|v| v.as_str()) {
      if is_exploration_archive_path(path) {
        return (
          false,
          build_exploration_archive_write_blocked_message().to_string(),
        );
      }
    }
    if let Some(msg) = block_write(ctx.mode, name) {
      return (false, msg);
    }
    if ctx.automated_bug_fix && ctx.written_files.len() >= MAX_AUTO_BUG_FIX_WRITES {
      return (
        false,
        format!(
          "错误：扫描修复已达写入上限（{MAX_AUTO_BUG_FIX_WRITES} 个文件），请 run_command 复验或输出总结。"
        ),
      );
    }
  }

  let result = match name {
    "read_file" => exec_read_file(ctx, args).await,
    "list_dir" | "list_directory" => exec_list_dir(ctx.project_path, args).await,
    "grep" => exec_grep(ctx, args).await,
    "search_files" => exec_search_files(ctx, args).await,
    "write_file" => exec_write_file(ctx, args).await,
    "patch_file" => exec_patch_file(ctx, args).await,
    "delete_file" => exec_delete_file(ctx, args).await,
    "git_status" => {
      let text = super::agent_git_tools::run_git_status_tool(ctx.project_path).await;
      let ok = !text.starts_with("错误：");
      (ok, text)
    }
    "git_diff" => {
      let file_path = args.get("path").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
      let staged = args.get("staged").and_then(|v| v.as_bool()).unwrap_or(false);
      let text = super::agent_git_tools::run_git_diff_tool(ctx.project_path, file_path, staged).await;
      let ok = !text.starts_with("错误：");
      (ok, text)
    }
    "run_command" => exec_run_command(ctx.project_path, args, ctx.mode).await,
    "web_search" => exec_web_search(args, ctx.web_proxy_url).await,
    "web_extract" => exec_web_extract(args, ctx.web_proxy_url).await,
    _ => (false, format!("未知工具: {name}")),
  };

  if result.0 && tools::is_write_tool(name) {
    if let Some(path) = args.get("path").and_then(|v| v.as_str()) {
      let norm = path.replace('\\', "/");
      if !ctx.written_files.contains(&norm) {
        ctx.written_files.push(norm);
      }
    }
  }

  result
}

pub fn block_write(mode: &str, tool: &str) -> Option<String> {
  if mode == "ask" {
    return Some(format!("Ask 模式下不支持 {tool}。"));
  }
  if mode == "explore" {
    return Some(format!("Explore 模式下不支持 {tool}。"));
  }
  if mode == "plan" {
    return Some(format!(
      "Plan 模式下不支持 {tool}。请先在 Plan 文档中规划，然后在 Build 模式下执行。"
    ));
  }
  None
}

async fn exec_read_file(ctx: &mut ToolExecContext<'_>, args: &Value) -> (bool, String) {
  let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
  if path.is_empty() {
    return (false, "错误：缺少 path".into());
  }
  match crate::paths::resolve_readable_path(ctx.project_path, path) {
    Ok((resolved, display, _outside_project)) => {
      let file_key = display.replace('\\', "/");
      let offset_u32 = args.get("offset").and_then(|v| v.as_u64()).unwrap_or(1).max(1) as u32;
      let limit_u32 = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(500)
        .min(800)
        .max(1) as u32;
      let line_range = read_line_range_from_args(offset_u32, limit_u32);
      let slice_key = format!("{file_key}:{offset_u32}:{limit_u32}");
      let patch_recovery = consume_patch_recovery_read(ctx.tool_guard, &file_key);

      if patch_recovery {
        invalidate_file_read_state(ctx.tool_guard, &file_key);
      } else if let Some(err) =
        check_overlapping_read(&file_key, line_range, &ctx.tool_guard.read_file_ranges)
      {
        return (false, err);
      } else if let Some(cached) = ctx.tool_guard.read_slice_cache.get(&slice_key) {
        let repeats = ctx
          .tool_guard
          .read_slice_repeat_counts
          .entry(slice_key.clone())
          .or_insert(0);
        *repeats += 1;
        if *repeats > super::exploration::MAX_READ_SLICE_REPEATS {
          return (
            false,
            format!(
              "错误：已连续 {repeats} 次读取相同片段 {file_key}（offset {offset_u32} limit {limit_u32}），请基于已有内容继续分析或 patch_file，若需更多行请一次读更大范围（300-500 行），勿重复读相同片段。"
            ),
          );
        }
        return (
          true,
          format!("{cached}\n（与上次 read_file 相同，已省略重复读取）"),
        );
      }

      let offset = offset_u32 as usize;
      let limit = limit_u32 as usize;
      let result = crate::fs::read_file_content(&resolved.to_string_lossy()).await;
      if !result.ok {
        return (false, result.error.unwrap_or_else(|| "读取失败".into()));
      }
      let content = if offset > 1 || limit < 800 {
        let lines: Vec<&str> = result.content.lines().skip(offset - 1).take(limit).collect();
        lines.join("\n")
      } else {
        result.content.clone()
      };
      if !patch_recovery {
        record_read_range(&file_key, line_range, &mut ctx.tool_guard.read_file_ranges);
      }
      ctx.tool_guard.read_slice_cache.insert(slice_key, content.clone());
      ctx.tool_guard.read_cache.insert(file_key.clone(), result.content);
      ctx.tool_guard.read_paths.insert(file_key);
      (true, content)
    }
    Err(e) => (false, e),
  }
}

async fn exec_list_dir(project_path: &str, args: &Value) -> (bool, String) {
  let input = args
    .get("path")
    .and_then(|v| v.as_str())
    .filter(|s| !s.is_empty());
  let path = match input {
    Some(p) => match crate::paths::resolve_readable_path(project_path, p) {
      Ok((resolved, _, _)) => resolved.to_string_lossy().to_string(),
      Err(e) => return (false, e),
    },
    None => project_path.to_string(),
  };
  match crate::fs::list_directory(&path).await {
    Ok(items) => {
      let lines: Vec<String> = items
        .iter()
        .map(|e| format!("{}{}", e.name, if e.is_directory { "/" } else { "" }))
        .collect();
      (
        true,
        if lines.is_empty() {
          "（空目录）".into()
        } else {
          lines.join("\n")
        },
      )
    }
    Err(e) => (false, e),
  }
}

async fn exec_grep(ctx: &mut ToolExecContext<'_>, args: &Value) -> (bool, String) {
  let pattern = args
    .get("pattern")
    .or_else(|| args.get("q"))
    .and_then(|v| v.as_str())
    .unwrap_or("");
  if pattern.is_empty() {
    return (false, "错误：缺少 pattern".into());
  }
  if is_blocked_grep_after_vision_misread(pattern, ctx.tool_guard.vision_misread_active) {
    return (false, build_blocked_grep_message(pattern));
  }
  if ctx.tool_guard.vision_locate_active && !ctx.tool_guard.vision_anchor_quotes.is_empty() {
    let extra: Vec<&str> = ctx
      .tool_guard
      .vision_narrative_text
      .as_deref()
      .into_iter()
      .collect();
    if is_overly_broad_vision_grep(pattern, &ctx.tool_guard.vision_anchor_quotes, &extra) {
      let probe = crate::fs::grep_in_project(ctx.project_path, pattern, 10).await;
      let low_spread = probe
        .as_ref()
        .ok()
        .map(|matches| {
          is_vision_grep_low_spread(&matches.iter().map(|m| m.relative.clone()).collect::<Vec<_>>())
        })
        .unwrap_or(false);
      if !low_spread {
        return (
          false,
          build_overly_broad_vision_grep_message(pattern, &ctx.tool_guard.vision_anchor_quotes),
        );
      }
    }
  }
  if ctx.tool_guard.vision_locate_active && is_low_signal_vision_locate_grep(pattern) {
    return (false, build_low_signal_vision_locate_grep_message(pattern));
  }
  if ctx.tool_guard.vision_locate_active && is_runtime_visible_text_grep_pattern(pattern) {
    return (false, build_low_signal_vision_locate_grep_message(pattern));
  }
  if is_blocked_grep_after_locate(
    pattern,
    ctx.tool_guard.patch_anchor_located,
    ctx.tool_guard.teleport_body_confirmed,
  ) {
    return (false, build_blocked_grep_after_locate_message(pattern));
  }
  let max_matches = args
    .get("max_matches")
    .and_then(|v| v.as_u64())
    .unwrap_or(40)
    .min(80) as usize;
  let grep_key = format!("{pattern}:{max_matches}");
  if let Some(cached) = ctx.tool_guard.grep_cache.get(&grep_key) {
    return (
      true,
      format!("{cached}\n（与上次 grep 相同，已省略重复搜索）"),
    );
  }
  match crate::fs::grep_in_project(ctx.project_path, pattern, max_matches).await {
    Ok(matches) => {
      if matches.is_empty() {
        let empty = "（无匹配）".to_string();
        ctx.tool_guard.grep_cache.insert(grep_key, empty.clone());
        return (true, empty);
      }
      let text = matches
        .iter()
        .map(|m| format!("{}:{}: {}", m.relative, m.line, m.text))
        .collect::<Vec<_>>()
        .join("\n");
      record_grep_hit_vue_files(
        ctx.tool_guard,
        &matches.iter().map(|m| m.relative.clone()).collect::<Vec<_>>(),
      );
      ctx.tool_guard.grep_cache.insert(grep_key, text.clone());
      (true, text)
    }
    Err(e) => (false, e),
  }
}

async fn exec_search_files(ctx: &mut ToolExecContext<'_>, args: &Value) -> (bool, String) {
  let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
  if query.is_empty() {
    return (false, "错误：缺少 query".into());
  }
  if ctx.tool_guard.vision_locate_active && is_search_files_content_query(query) {
    return (false, build_search_files_content_query_message(query));
  }
  let max_results = args
    .get("max_results")
    .and_then(|v| v.as_u64())
    .unwrap_or(30)
    .min(50) as usize;
  match crate::fs::search_files(ctx.project_path, query, max_results).await {
    Ok(items) => {
      if items.is_empty() {
        return (true, format!("未找到包含「{query}」的文件"));
      }
      let lines: Vec<String> = items
        .iter()
        .map(|e| format!("{}{}", e.name, if e.is_directory { "/" } else { "" }))
        .collect();
      (true, lines.join("\n"))
    }
    Err(e) => (false, e),
  }
}

async fn exec_write_file(ctx: &mut ToolExecContext<'_>, args: &Value) -> (bool, String) {
  let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
  let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
  if path.is_empty() {
    return (false, "错误：缺少 path".into());
  }
  if content.is_empty() {
    return (false, "错误：缺少 content".into());
  }
  match crate::paths::resolve_project_path(ctx.project_path, path) {
    Ok((resolved, relative)) => {
      let file_key = relative.replace('\\', "/");
      if let Some(msg) = plan_document_build_mode_block(ctx.mode, &file_key, "write_file") {
        return (false, msg);
      }
      let exists = tokio::fs::metadata(&resolved)
        .await
        .map(|m| m.is_file())
        .unwrap_or(false);
      if let Some(err) = require_prior_read(&ctx.tool_guard.read_paths, &file_key, exists) {
        return (false, err);
      }
      if exists {
        let read_result = crate::fs::read_file_content(&resolved.to_string_lossy()).await;
        if read_result.ok {
          let existing_lines = read_result.content.lines().count();
          let new_lines = content.lines().count();
          let line_count = existing_lines.max(new_lines);
          if line_count >= LARGE_FILE_LINE_THRESHOLD {
            return (
              false,
              format!("错误：{file_key} 为大文件（{line_count} 行），请用 patch_file 局部修改"),
            );
          }
        }
      }
      match crate::fs::write_file_content(&resolved.to_string_lossy(), content).await {
        Ok(_) => {
          invalidate_file_read_state(ctx.tool_guard, &file_key);
          ctx.tool_guard.vision_locate_active = false;
          (true, format!("已写入 {path}（{} 字符）", content.len()))
        }
        Err(e) => (false, e),
      }
    }
    Err(e) => (false, e),
  }
}

async fn exec_patch_file(ctx: &mut ToolExecContext<'_>, args: &Value) -> (bool, String) {
  let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
  let old_str = args.get("old_string").and_then(|v| v.as_str()).unwrap_or("");
  let new_str = args.get("new_string").and_then(|v| v.as_str()).unwrap_or("");
  if path.is_empty() {
    return (false, "错误：缺少 path".into());
  }
  if old_str.is_empty() {
    return (false, "错误：缺少 old_string".into());
  }
  match crate::paths::resolve_project_path(ctx.project_path, path) {
    Ok((resolved, relative)) => {
      let file_key = relative.replace('\\', "/");
      if let Some(msg) = plan_document_build_mode_block(ctx.mode, &file_key, "patch_file") {
        return (false, msg);
      }
      let exists = tokio::fs::metadata(&resolved)
        .await
        .map(|m| m.is_file())
        .unwrap_or(false);
      if let Some(err) = require_prior_read(&ctx.tool_guard.read_paths, &file_key, exists) {
        return (false, err);
      }
      if let Some(err) = check_patch_old_string_from_reads(
        &file_key,
        old_str,
        &ctx.tool_guard.read_slice_cache,
        Some(&ctx.tool_guard.read_cache),
      ) {
        mark_patch_recovery_file(ctx.tool_guard, &file_key);
        invalidate_file_read_cache(ctx.tool_guard, &file_key);
        return (false, err);
      }
      if is_introspect_business_route_patch(&file_key, old_str, new_str) {
        return (false, build_introspect_probe_blocked_message());
      }
      let read_result = crate::fs::read_file_content(&resolved.to_string_lossy()).await;
      if !read_result.ok {
        return (false, read_result.error.unwrap_or_else(|| "读取失败".into()));
      }
      match super::patch::apply_unique_patch(&read_result.content, old_str, new_str) {
        super::patch::UniquePatchResult::Ok { patched } => {
          match crate::fs::write_file_content(&resolved.to_string_lossy(), &patched).await {
            Ok(_) => {
              invalidate_file_read_state(ctx.tool_guard, &file_key);
              ctx.tool_guard.vision_locate_active = false;
              (true, format!("已修改 {path}"))
            }
            Err(e) => (false, e),
          }
        }
        super::patch::UniquePatchResult::Err { error, .. } => {
          mark_patch_recovery_file(ctx.tool_guard, &file_key);
          invalidate_file_read_cache(ctx.tool_guard, &file_key);
          (false, error)
        }
      }
    }
    Err(e) => (false, e),
  }
}

async fn exec_delete_file(ctx: &mut ToolExecContext<'_>, args: &Value) -> (bool, String) {
  let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
  if path.is_empty() {
    return (false, "错误：缺少 path".into());
  }
  match crate::paths::resolve_project_path(ctx.project_path, path) {
    Ok((resolved, relative)) => {
      let file_key = relative.replace('\\', "/");
      if let Some(msg) = plan_document_build_mode_block(ctx.mode, &file_key, "delete_file") {
        return (false, msg);
      }
      match crate::fs::delete_item(&resolved.to_string_lossy()).await {
        Ok(_) => (true, format!("已删除 {path}")),
        Err(e) => (false, e),
      }
    }
    Err(e) => (false, e),
  }
}

async fn exec_run_command(project_path: &str, args: &Value, mode: &str) -> (bool, String) {
  if let Some(msg) = block_write(mode, "执行命令") {
    return (false, msg);
  }
  let command = args.get("command").and_then(|v| v.as_str()).unwrap_or("");
  if command.is_empty() {
    return (false, "错误：缺少 command".into());
  }
  if command.contains("rm -rf") || command.contains("format ") {
    return (false, "错误：禁止执行危险命令".into());
  }
  let timeout_ms = args
    .get("timeout_ms")
    .and_then(|v| v.as_u64())
    .unwrap_or(30000)
    .min(120000)
    .max(5000);
  let shell = if cfg!(target_os = "windows") {
    "powershell.exe"
  } else {
    "/bin/sh"
  };
  let flag = if cfg!(target_os = "windows") {
    "-Command"
  } else {
    "-c"
  };
  let cmd = tokio::process::Command::new(shell)
    .args([flag, command])
    .current_dir(project_path)
    .output();
  let result = tokio::time::timeout(std::time::Duration::from_millis(timeout_ms), cmd).await;
  match result {
    Ok(Ok(output)) => {
      let out = String::from_utf8_lossy(&output.stdout).trim().to_string();
      let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
      if out.is_empty() && err.is_empty() {
        return (true, "（命令执行完成，无输出）".into());
      }
      let mut parts = Vec::new();
      if !out.is_empty() {
        parts.push(format!("stdout:\n{out}"));
      }
      if !err.is_empty() {
        parts.push(format!("stderr:\n{err}"));
      }
      (true, parts.join("\n\n"))
    }
    Ok(Err(e)) => (false, format!("命令执行失败: {e}")),
    Err(_) => (false, format!("错误：命令超时（{timeout_ms}ms）")),
  }
}

async fn exec_web_search(args: &Value, proxy_url: Option<&str>) -> (bool, String) {
  let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
  if query.is_empty() {
    return (false, "错误：缺少 query".into());
  }
  let max_results = args
    .get("max_results")
    .and_then(|v| v.as_u64())
    .unwrap_or(5)
    .min(10) as u32;
  match crate::web_fetch::web_search_text(query, max_results, proxy_url).await {
    Ok(text) => (true, text),
    Err(e) => (false, e),
  }
}

async fn exec_web_extract(args: &Value, proxy_url: Option<&str>) -> (bool, String) {
  let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
  if url.is_empty() {
    return (false, "错误：缺少 url".into());
  }
  let mode = args.get("mode").and_then(|v| v.as_str()).unwrap_or("auto");
  match crate::web_fetch::web_extract_auto(url, proxy_url, mode).await {
    Ok(text) => (true, text),
    Err(e) => (false, e),
  }
}

#[cfg(test)]
mod tests {
  use super::{block_write, exec_list_dir};
  use serde_json::json;

  #[tokio::test]
  async fn exec_list_dir_resolves_relative_path() {
    let tmp = std::env::temp_dir().join("opencode-test-list-dir");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(tmp.join("subdir")).unwrap();
    std::fs::write(tmp.join("subdir").join("a.txt"), "").unwrap();
    std::fs::write(tmp.join("subdir").join("b.rs"), "").unwrap();
    let args = json!({ "path": "subdir" });
    let (ok, out) = exec_list_dir(tmp.to_str().unwrap(), &args).await;
    assert!(ok, "expected Ok, got error: {out}");
    assert!(out.contains("a.txt"), "should list a.txt, got: {out}");
    assert!(out.contains("b.rs"), "should list b.rs, got: {out}");
    let _ = std::fs::remove_dir_all(&tmp);
  }

  #[tokio::test]
  async fn exec_list_dir_defaults_to_project_root() {
    let tmp = std::env::temp_dir().join("opencode-test-list-dir-root");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();
    std::fs::write(tmp.join("root-file.ts"), "").unwrap();
    let args = json!({});
    let (ok, out) = exec_list_dir(tmp.to_str().unwrap(), &args).await;
    assert!(ok, "expected Ok, got error: {out}");
    assert!(out.contains("root-file.ts"), "should list root-file.ts, got: {out}");
    let _ = std::fs::remove_dir_all(&tmp);
  }

  #[test]
  fn block_write_ask_returns_some() {
    assert!(block_write("ask", "写文件").is_some());
  }

  #[test]
  fn block_write_explore_returns_some() {
    assert!(block_write("explore", "删除文件").is_some());
  }

  #[test]
  fn block_write_plan_returns_some() {
    assert!(block_write("plan", "patch_file").is_some());
  }

  #[test]
  fn block_write_build_returns_none() {
    assert!(block_write("build", "写文件").is_none());
  }

  #[test]
  fn block_write_ask_blocks_tools() {
    for tool in &[
      "read_file", "write_file", "patch_file", "delete_file", "grep", "list_dir", "git_status",
      "git_diff", "run_command", "web_extract",
    ] {
      assert!(block_write("ask", tool).is_some(), "ask should block {tool}");
    }
  }

  #[test]
  fn block_write_explore_blocks_tools() {
    for tool in &[
      "read_file", "write_file", "patch_file", "delete_file", "grep", "list_dir", "git_status",
      "git_diff", "run_command", "web_extract",
    ] {
      assert!(block_write("explore", tool).is_some(), "explore should block {tool}");
    }
  }

  #[test]
  fn block_write_plan_blocks_tools() {
    for tool in &[
      "read_file", "write_file", "patch_file", "delete_file", "grep", "list_dir", "git_status",
      "git_diff", "run_command", "web_extract",
    ] {
      assert!(block_write("plan", tool).is_some(), "plan should block {tool}");
    }
  }

  #[test]
  fn block_write_build_does_not_block() {
    for tool in &[
      "read_file", "write_file", "patch_file", "delete_file", "grep", "list_dir", "git_status",
      "git_diff", "run_command", "web_extract",
    ] {
      assert!(block_write("build", tool).is_none(), "build should not block {tool}");
    }
  }
}
