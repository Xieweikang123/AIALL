use serde::Serialize;
use serde_json::Value;

use super::exploration::{
    build_exploration_archive_write_blocked_message, is_exploration_archive_path,
};
use super::explore_guard::{
    build_blocked_grep_after_locate_message,
    build_low_signal_vision_locate_grep_message, build_overly_broad_vision_grep_message,
    build_search_files_content_query_message,
    check_patch_old_string_from_reads, consume_patch_recovery_read, invalidate_file_read_cache,
    invalidate_file_read_state, is_blocked_grep_after_locate,
    is_low_signal_vision_locate_grep, is_overly_broad_vision_grep, is_search_files_content_query,
    is_vision_grep_low_spread, mark_patch_recovery_file,
    record_grep_hit_vue_files, require_prior_read, ToolGuardState,
};
use super::plan_path::plan_document_build_mode_block;
use super::probe_guard::{
    build_introspect_probe_blocked_message, is_introspect_business_route_patch,
    LARGE_FILE_LINE_THRESHOLD,
};
use super::tools;
use super::vision::is_runtime_visible_text_grep_pattern;
use crate::paths::resolve_debug_log_path;
use std::fs::OpenOptions;
use std::io::Write;

const MAX_AUTO_BUG_FIX_WRITES: usize = 5;

fn slice_content(content: &str, offset: usize, limit: usize) -> String {
    if offset > 1 || limit < 800 {
        content
            .lines()
            .skip(offset - 1)
            .take(limit)
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        content.to_string()
    }
}

fn append_tool_exec_log(project_path: &str, tool_name: &str, path: &str, ok: bool, error: &str) {
    let log_file = match resolve_debug_log_path("tool-exec.log", Some(project_path)) {
        Ok(p) => p,
        Err(_) => return,
    };
    let mut file = match OpenOptions::new().create(true).append(true).open(&log_file) {
        Ok(f) => f,
        Err(_) => return,
    };
    let status = if ok { "OK" } else { "FAIL" };
    let _ = writeln!(
        file,
        "{} path=\"{}\" status={} error=\"{}\"",
        tool_name, path, status, error
    );
}

pub struct ToolExecContext<'a> {
    pub project_path: &'a str,
    pub mode: &'a str,
    pub web_proxy_url: Option<&'a str>,
    pub automated_bug_fix: bool,
    pub written_files: &'a mut Vec<String>,
    pub tool_guard: &'a mut ToolGuardState,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolFileDiff {
    pub path: String,
    pub before: String,
    pub after: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created: Option<bool>,
}

pub struct ToolExecOutcome {
    pub ok: bool,
    pub message: String,
    pub file_diff: Option<ToolFileDiff>,
}

pub async fn execute_tool(
    ctx: &mut ToolExecContext<'_>,
    name: &str,
    args: &Value,
) -> ToolExecOutcome {
    if tools::is_write_tool(name) {
        if let Some(path) = args.get("path").and_then(|v| v.as_str()) {
            if is_exploration_archive_path(path) {
                return ToolExecOutcome {
                    ok: false,
                    message: build_exploration_archive_write_blocked_message().to_string(),
                    file_diff: None,
                };
            }
            if super::memory_store::is_memory_path(path) {
                return ToolExecOutcome {
                    ok: false,
                    message: "错误：.aiall/memory/ 为长期记忆受控目录，请使用 memory_write 工具写入。".into(),
                    file_diff: None,
                };
            }
        }
        if let Some(msg) = block_write(ctx.mode, name) {
            return ToolExecOutcome {
                ok: false,
                message: msg,
                file_diff: None,
            };
        }
        if ctx.automated_bug_fix && ctx.written_files.len() >= MAX_AUTO_BUG_FIX_WRITES {
            return ToolExecOutcome {
        ok: false,
        message: format!(
          "错误：扫描修复已达写入上限（{MAX_AUTO_BUG_FIX_WRITES} 个文件），请 run_command 复验或输出总结。"
        ),
        file_diff: None,
      };
        }
    }

    let (ok, message, file_diff) = match name {
        "read_file" => {
            let (ok, msg) = exec_read_file(ctx, args).await;
            (ok, msg, None)
        }
        "list_dir" | "list_directory" => {
            let (ok, msg) = exec_list_dir(ctx.project_path, args).await;
            (ok, msg, None)
        }
        "grep" => {
            let (ok, msg) = exec_grep(ctx, args).await;
            (ok, msg, None)
        }
        "search_files" => {
            let (ok, msg) = exec_search_files(ctx, args).await;
            (ok, msg, None)
        }
        "search_symbols" => {
            let (ok, msg) = exec_search_symbols(ctx, args).await;
            (ok, msg, None)
        }
        "write_file" => exec_write_file(ctx, args).await,
        "patch_file" => exec_patch_file(ctx, args).await,
        "delete_file" => exec_delete_file(ctx, args).await,
        "git_status" => {
            let text = super::agent_git_tools::run_git_status_tool(ctx.project_path).await;
            let ok = !text.starts_with("错误：");
            (ok, text, None)
        }
        "git_diff" => {
            let file_path = args
                .get("path")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty());
            let staged = args
                .get("staged")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let text =
                super::agent_git_tools::run_git_diff_tool(ctx.project_path, file_path, staged)
                    .await;
            let ok = !text.starts_with("错误：");
            (ok, text, None)
        }
        "run_command" => {
            let (ok, msg) = exec_run_command(ctx.project_path, args, ctx.mode).await;
            (ok, msg, None)
        }
        "web_search" => {
            let (ok, msg) = exec_web_search(args, ctx.web_proxy_url).await;
            (ok, msg, None)
        }
        "web_extract" => {
            let (ok, msg) = exec_web_extract(args, ctx.web_proxy_url).await;
            (ok, msg, None)
        }
        "memory_write" => {
            let (ok, msg) = exec_memory_write(ctx, args).await;
            (ok, msg, None)
        }
        "search_sessions" => {
            let (ok, msg) = exec_search_sessions(ctx, args).await;
            (ok, msg, None)
        }
        _ => (false, format!("未知工具: {name}"), None),
    };

    if ok && tools::is_write_tool(name) {
        if let Some(path) = args.get("path").and_then(|v| v.as_str()) {
            let norm = path.replace('\\', "/");
            if !ctx.written_files.contains(&norm) {
                ctx.written_files.push(norm);
            }
        }
    }

    ToolExecOutcome {
        ok,
        message,
        file_diff,
    }
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
        append_tool_exec_log(ctx.project_path, "read_file", "", false, "缺少 path");
        return (false, "错误：缺少 path".into());
    }
    match crate::paths::resolve_readable_path(ctx.project_path, path) {
        Ok((resolved, display, _outside_project)) => {
            let file_key = display.replace('\\', "/");
            let offset_u32 = args
                .get("offset")
                .and_then(|v| v.as_u64())
                .unwrap_or(1)
                .max(1) as u32;
            let limit_u32 = args
                .get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(500)
                .min(800)
                .max(1) as u32;
            let slice_key = format!("{file_key}:{offset_u32}:{limit_u32}");
            let patch_recovery = consume_patch_recovery_read(ctx.tool_guard, &file_key);

            if patch_recovery {
                invalidate_file_read_state(ctx.tool_guard, &file_key);
            } else if let Some(cached) = ctx.tool_guard.read_slice_cache.get(&slice_key) {
                // Same slice re-read: serve cached content, never error.
                append_tool_exec_log(
                    ctx.project_path,
                    "read_file",
                    &file_key,
                    true,
                    "served from cache",
                );
                return (true, format!("{cached}\n（命中已读缓存，已返回该区间内容）"));
            } else if let Some(full) = ctx.tool_guard.read_cache.get(&file_key) {
                // Full file already read: serve the requested window from cache instead of
                // re-reading (overlapping / shifted windows are cheap this way).
                let content = slice_content(full, offset_u32 as usize, limit_u32 as usize);
                ctx.tool_guard
                    .read_slice_cache
                    .insert(slice_key, content.clone());
                append_tool_exec_log(
                    ctx.project_path,
                    "read_file",
                    &file_key,
                    true,
                    "served from cache (full file)",
                );
                return (true, format!("{content}\n（命中已读缓存，已返回该区间内容）"));
            }

            let offset = offset_u32 as usize;
            let limit = limit_u32 as usize;
            let result = crate::fs::read_file_content(&resolved.to_string_lossy()).await;
            if !result.ok {
                // Bare filename (e.g. `mixin.js`) resolves against project root and misses;
                // fall back to exact-basename lookup across the project (ignore rules applied).
                let is_not_found = result.error.as_deref() == Some("文件不存在");
                let is_bare_name = !path.contains('/')
                    && !path.contains('\\')
                    && !std::path::Path::new(path).is_absolute();
                if is_not_found && is_bare_name {
                    match crate::fs::resolve_basename_candidate(ctx.project_path, path).await {
                        Ok((abs, rel)) => {
                            let r2 = crate::fs::read_file_content(&abs).await;
                            if r2.ok {
                                let content = slice_content(&r2.content, offset, limit);
                                let resolved_key = rel.replace('\\', "/");
                                ctx.tool_guard.read_paths.insert(resolved_key);
                                append_tool_exec_log(
                                    ctx.project_path,
                                    "read_file",
                                    &format!("{path}->{rel}"),
                                    true,
                                    "basename auto-resolved",
                                );
                                return (
                                    true,
                                    format!(
                                        "✅ 裸文件名 `{path}` 已自动解析到 `{rel}`，后续请直接使用该完整相对路径。\n\n{content}"
                                    ),
                                );
                            }
                        }
                        Err(candidate_err) => {
                            append_tool_exec_log(
                                ctx.project_path,
                                "read_file",
                                &file_key,
                                false,
                                &candidate_err,
                            );
                            return (false, candidate_err);
                        }
                    }
                }
                let err_msg = result.error.unwrap_or_else(|| "读取失败".into());
                append_tool_exec_log(ctx.project_path, "read_file", &file_key, false, &err_msg);
                return (false, err_msg);
            }
            let content = slice_content(&result.content, offset, limit);
            ctx.tool_guard
                .read_slice_cache
                .insert(slice_key, content.clone());
            ctx.tool_guard
                .read_cache
                .insert(file_key.clone(), result.content);
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
                    is_vision_grep_low_spread(
                        &matches
                            .iter()
                            .map(|m| m.relative.clone())
                            .collect::<Vec<_>>(),
                    )
                })
                .unwrap_or(false);
            if !low_spread {
                return (
                    false,
                    build_overly_broad_vision_grep_message(
                        pattern,
                        &ctx.tool_guard.vision_anchor_quotes,
                    ),
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
                &matches
                    .iter()
                    .map(|m| m.relative.clone())
                    .collect::<Vec<_>>(),
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

async fn exec_search_symbols(ctx: &ToolExecContext<'_>, args: &Value) -> (bool, String) {
    let query = args
        .get("query")
        .or_else(|| args.get("q"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if query.is_empty() {
        return (false, "错误：缺少 query".into());
    }
    let max_results = args
        .get("max_results")
        .and_then(|v| v.as_u64())
        .unwrap_or(20)
        .min(80) as usize;
    let results = crate::project::project_symbol_search(ctx.project_path, query, max_results);
    (true, crate::project::format_symbol_search_results(&results))
}

async fn exec_write_file(
    ctx: &mut ToolExecContext<'_>,
    args: &Value,
) -> (bool, String, Option<ToolFileDiff>) {
    let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
    let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
    if path.is_empty() {
        return (false, "错误：缺少 path".into(), None);
    }
    if content.is_empty() {
        return (false, "错误：缺少 content".into(), None);
    }
    match crate::paths::resolve_project_path(ctx.project_path, path) {
        Ok((resolved, relative)) => {
            let file_key = relative.replace('\\', "/");
            if let Some(msg) = plan_document_build_mode_block(ctx.mode, &file_key, "write_file") {
                return (false, msg, None);
            }
            let exists = tokio::fs::metadata(&resolved)
                .await
                .map(|m| m.is_file())
                .unwrap_or(false);
            if let Some(err) = require_prior_read(&ctx.tool_guard.read_paths, &file_key, exists) {
                return (false, err, None);
            }
            let before = if exists {
                let read_result = crate::fs::read_file_content(&resolved.to_string_lossy()).await;
                if !read_result.ok {
                    return (
                        false,
                        read_result.error.unwrap_or_else(|| "读取失败".into()),
                        None,
                    );
                }
                let existing_lines = read_result.content.lines().count();
                let new_lines = content.lines().count();
                let line_count = existing_lines.max(new_lines);
                if line_count >= LARGE_FILE_LINE_THRESHOLD {
                    return (
            false,
            format!("错误：{file_key} 为大文件（{line_count} 行），请用 patch_file 局部修改"),
            None,
          );
                }
                read_result.content
            } else {
                String::new()
            };
            match crate::fs::write_file_content(&resolved.to_string_lossy(), content).await {
                Ok(_) => {
                    invalidate_file_read_state(ctx.tool_guard, &file_key);
                    ctx.tool_guard.vision_locate_active = false;
                    (
                        true,
                        format!("已写入 {path}（{} 字符）", content.len()),
                        Some(ToolFileDiff {
                            path: file_key,
                            before,
                            after: content.to_string(),
                            deleted: None,
                            created: Some(!exists),
                        }),
                    )
                }
                Err(e) => (false, e, None),
            }
        }
        Err(e) => (false, e, None),
    }
}

async fn exec_patch_file(
    ctx: &mut ToolExecContext<'_>,
    args: &Value,
) -> (bool, String, Option<ToolFileDiff>) {
    let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
    let old_str = args
        .get("old_string")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let new_str = args
        .get("new_string")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if path.is_empty() {
        return (false, "错误：缺少 path".into(), None);
    }
    if old_str.is_empty() {
        return (false, "错误：缺少 old_string".into(), None);
    }
    match crate::paths::resolve_project_path(ctx.project_path, path) {
        Ok((resolved, relative)) => {
            let file_key = relative.replace('\\', "/");
            if let Some(msg) = plan_document_build_mode_block(ctx.mode, &file_key, "patch_file") {
                return (false, msg, None);
            }
            let exists = tokio::fs::metadata(&resolved)
                .await
                .map(|m| m.is_file())
                .unwrap_or(false);
            if let Some(err) = require_prior_read(&ctx.tool_guard.read_paths, &file_key, exists) {
                return (false, err, None);
            }
            if let Some(err) = check_patch_old_string_from_reads(
                &file_key,
                old_str,
                &ctx.tool_guard.read_slice_cache,
                Some(&ctx.tool_guard.read_cache),
            ) {
                mark_patch_recovery_file(ctx.tool_guard, &file_key);
                invalidate_file_read_cache(ctx.tool_guard, &file_key);
                return (false, err, None);
            }
            if is_introspect_business_route_patch(&file_key, old_str, new_str) {
                return (false, build_introspect_probe_blocked_message(), None);
            }
            let read_result = crate::fs::read_file_content(&resolved.to_string_lossy()).await;
            if !read_result.ok {
                return (
                    false,
                    read_result.error.unwrap_or_else(|| "读取失败".into()),
                    None,
                );
            }
            let before = read_result.content.clone();
            match super::patch::apply_unique_patch(&read_result.content, old_str, new_str) {
                super::patch::UniquePatchResult::Ok { patched } => {
                    match crate::fs::write_file_content(&resolved.to_string_lossy(), &patched).await
                    {
                        Ok(_) => {
                            invalidate_file_read_state(ctx.tool_guard, &file_key);
                            ctx.tool_guard.vision_locate_active = false;
                            (
                                true,
                                format!("已修改 {path}"),
                                Some(ToolFileDiff {
                                    path: file_key,
                                    before,
                                    after: patched,
                                    deleted: None,
                                    created: None,
                                }),
                            )
                        }
                        Err(e) => (false, e, None),
                    }
                }
                super::patch::UniquePatchResult::Err { error, .. } => {
                    mark_patch_recovery_file(ctx.tool_guard, &file_key);
                    invalidate_file_read_cache(ctx.tool_guard, &file_key);
                    (false, error, None)
                }
            }
        }
        Err(e) => (false, e, None),
    }
}

async fn exec_delete_file(
    ctx: &mut ToolExecContext<'_>,
    args: &Value,
) -> (bool, String, Option<ToolFileDiff>) {
    let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
    if path.is_empty() {
        return (false, "错误：缺少 path".into(), None);
    }
    match crate::paths::resolve_project_path(ctx.project_path, path) {
        Ok((resolved, relative)) => {
            let file_key = relative.replace('\\', "/");
            if let Some(msg) = plan_document_build_mode_block(ctx.mode, &file_key, "delete_file") {
                return (false, msg, None);
            }
            let before = {
                let read_result = crate::fs::read_file_content(&resolved.to_string_lossy()).await;
                if read_result.ok {
                    read_result.content
                } else {
                    String::new()
                }
            };
            match crate::fs::delete_item(&resolved.to_string_lossy()).await {
                Ok(_) => (
                    true,
                    format!("已删除 {path}"),
                    Some(ToolFileDiff {
                        path: file_key,
                        before,
                        after: String::new(),
                        deleted: Some(true),
                        created: None,
                    }),
                ),
                Err(e) => (false, e, None),
            }
        }
        Err(e) => (false, e, None),
    }
}

fn is_dangerous_command(command: &str) -> bool {
    let lower = command.to_ascii_lowercase();
    // Unix: rm with recursive+force flags (e.g. rm -rf /, rm -fr .)
    let unix_rm = lower.contains("rm ")
        && (lower.contains("-rf") || lower.contains("-fr") || lower.contains("--recursive"))
        && (lower.contains("-f")
            || lower.contains("--force")
            || lower.contains("-rf")
            || lower.contains("-fr"));
    // Windows: del /s or erase /s (recursive delete)
    let win_del = (lower.contains("del ") || lower.contains("erase "))
        && (lower.contains("/s") || lower.contains("-recurse"));
    // rmdir /s (Windows)
    let cmd_rm = lower.contains("rmdir ") && (lower.contains("/s") || lower.contains("-recurse"));
    // PowerShell: Remove-Item with Recurse+Force
    let ps_rm =
        lower.contains("remove-item") && lower.contains("-recurse") && lower.contains("-force");
    // Dangerous system modifications (format with drive or filesystem flags)
    let dangerous_cmd = lower.contains("format ")
        && (lower.contains("c:")
            || lower.contains("d:")
            || lower.contains("/fs:")
            || lower.contains("/q"));
    unix_rm || win_del || cmd_rm || ps_rm || dangerous_cmd
}

async fn exec_run_command(project_path: &str, args: &Value, mode: &str) -> (bool, String) {
    if let Some(msg) = block_write(mode, "执行命令") {
        return (false, msg);
    }
    let command = args.get("command").and_then(|v| v.as_str()).unwrap_or("");
    if command.is_empty() {
        return (false, "错误：缺少 command".into());
    }
    if is_dangerous_command(command) {
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

const MEMORY_SCOPES: [&str; 4] = ["architecture", "decision", "preference", "fact"];

async fn exec_memory_write(ctx: &ToolExecContext<'_>, args: &Value) -> (bool, String) {
    if let Some(msg) = block_write(ctx.mode, "memory_write") {
        return (false, msg);
    }
    let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
    let scope = args.get("scope").and_then(|v| v.as_str()).unwrap_or("");
    if content.trim().is_empty() {
        return (false, "错误：缺少 content".into());
    }
    if !MEMORY_SCOPES.contains(&scope) {
        return (
            false,
            format!("错误：scope 必须是 {} 之一", MEMORY_SCOPES.join(" / ")),
        );
    }
    let source = args
        .get("source")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string());
    match super::memory_store::add_memory_entry(
        ctx.project_path,
        content,
        scope,
        source,
        None,
    )
    .await
    {
        Ok(result) => {
            let mut parts = vec![format!("已写入长期记忆 [{}]：{}", result.scope, content.trim())];
            if !result.superseded.is_empty() {
                parts.push(format!("（覆盖 {} 条旧记忆）", result.superseded.len()));
            }
            if !result.archived.is_empty() {
                parts.push(format!(
                    "（该类别达上限，归档 {} 条最旧记忆）",
                    result.archived.len()
                ));
            }
            parts.push(format!("当前活跃记忆 {} 条", result.total_active));
            (true, parts.join(" "))
        }
        Err(e) => (false, e),
    }
}

async fn exec_search_sessions(ctx: &ToolExecContext<'_>, args: &Value) -> (bool, String) {
    let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
    if query.trim().is_empty() {
        return (false, "错误：缺少 query".into());
    }
    let max_results = args
        .get("max_results")
        .and_then(|v| v.as_u64())
        .unwrap_or(5)
        .min(10) as usize;
    match super::memory_store::search_sessions(query, max_results).await {
        Ok(text) => (true, text),
        Err(e) => (false, e),
    }
}

#[cfg(test)]
mod tests {
    use super::{block_write, exec_list_dir, is_dangerous_command};
    use super::{check_patch_old_string_from_reads, ToolGuardState};
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
        assert!(
            out.contains("root-file.ts"),
            "should list root-file.ts, got: {out}"
        );
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
            "read_file",
            "write_file",
            "patch_file",
            "delete_file",
            "grep",
            "list_dir",
            "git_status",
            "git_diff",
            "run_command",
            "web_extract",
        ] {
            assert!(
                block_write("ask", tool).is_some(),
                "ask should block {tool}"
            );
        }
    }

    #[test]
    fn block_write_explore_blocks_tools() {
        for tool in &[
            "read_file",
            "write_file",
            "patch_file",
            "delete_file",
            "grep",
            "list_dir",
            "git_status",
            "git_diff",
            "run_command",
            "web_extract",
        ] {
            assert!(
                block_write("explore", tool).is_some(),
                "explore should block {tool}"
            );
        }
    }

    #[test]
    fn block_write_plan_blocks_tools() {
        for tool in &[
            "read_file",
            "write_file",
            "patch_file",
            "delete_file",
            "grep",
            "list_dir",
            "git_status",
            "git_diff",
            "run_command",
            "web_extract",
        ] {
            assert!(
                block_write("plan", tool).is_some(),
                "plan should block {tool}"
            );
        }
    }

    #[test]
    fn block_write_build_does_not_block() {
        for tool in &[
            "read_file",
            "write_file",
            "patch_file",
            "delete_file",
            "grep",
            "list_dir",
            "git_status",
            "git_diff",
            "run_command",
            "web_extract",
        ] {
            assert!(
                block_write("build", tool).is_none(),
                "build should not block {tool}"
            );
        }
    }

    // ── is_dangerous_command ──

    #[test]
    fn dangerous_unix_rm_rf_detected() {
        assert!(is_dangerous_command("rm -rf /"));
        assert!(is_dangerous_command("rm -rf *"));
        assert!(is_dangerous_command("rm -rf ."));
        assert!(is_dangerous_command("rm -rf directory"));
        assert!(is_dangerous_command("rm -fr /"));
        assert!(is_dangerous_command("rm --recursive --force ."));
    }

    #[test]
    fn dangerous_safe_rm_not_blocked() {
        assert!(!is_dangerous_command("rm file.txt"));
        assert!(!is_dangerous_command("rm -i file.txt"));
        assert!(!is_dangerous_command("rmdir empty_dir"));
        assert!(!is_dangerous_command("remove-item file.txt"));
    }

    #[test]
    fn dangerous_powershell_remove_item_detected() {
        assert!(is_dangerous_command(
            "Remove-Item -Recurse -Force C:\\Windows"
        ));
        assert!(is_dangerous_command("remove-item -recurse -force ."));
        assert!(is_dangerous_command("Remove-Item -Recurse -Force -Path ."));
    }

    #[test]
    fn dangerous_windows_del_recurse_detected() {
        assert!(is_dangerous_command("del /s /q *"));
        assert!(is_dangerous_command("erase /s *"));
        assert!(is_dangerous_command("del -recurse -force *"));
    }

    #[test]
    fn dangerous_rmdir_s_detected() {
        assert!(is_dangerous_command("rmdir /s C:\\"));
        assert!(is_dangerous_command("rmdir -recurse C:\\"));
    }

    #[test]
    fn dangerous_format_detected() {
        assert!(is_dangerous_command("format c:"));
        assert!(is_dangerous_command("format d: /fs:ntfs"));
        assert!(is_dangerous_command("format C: /q"));
    }

    #[test]
    fn dangerous_harmless_format_not_blocked() {
        assert!(!is_dangerous_command("fmt.Println(\"hello\")"));
        assert!(!is_dangerous_command("echo \"format string\""));
        assert!(!is_dangerous_command("Prettier.format(code)"));
        assert!(!is_dangerous_command("format!("));
        assert!(!is_dangerous_command("JSON.stringify({})"));
    }

    #[test]
    fn dangerous_innocent_commands_allowed() {
        assert!(!is_dangerous_command("ls -la"));
        assert!(!is_dangerous_command("cat file.txt"));
        assert!(!is_dangerous_command("npm install"));
        assert!(!is_dangerous_command("git status"));
        assert!(!is_dangerous_command("python script.py"));
        assert!(!is_dangerous_command("cargo build"));
    }

    #[test]
    fn dangerous_empty_command_safe() {
        assert!(!is_dangerous_command(""));
    }
}
