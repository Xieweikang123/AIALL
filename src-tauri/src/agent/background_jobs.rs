//! 后台长任务：`run_command { background: true }` 起一个不阻塞当轮的后台进程，
//! 输出重定向到 `debug-logs/<项目>/bg-<id>.log`，由 `command_status` / `command_kill`
//! 查询与终止。用于耗时长命令（测试、构建、安装），避免前台 120s 超时把整轮卡死。
//!
//! 真相源约定：行为只在 Rust；前端只渲染 `run_command` / `command_status` 的工具行。

use serde_json::json;
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};

use crate::paths::resolve_debug_log_path;

/// 单条后台任务的运行结果。
#[derive(Debug, Clone)]
pub struct JobExit {
    pub code: Option<i32>,
    pub killed: bool,
}

struct JobEntry {
    command: String,
    log_path: String,
    started_ms: i64,
    pid: Option<u32>,
    exit: Arc<Mutex<Option<JobExit>>>,
}

static JOBS: OnceLock<Mutex<HashMap<String, JobEntry>>> = OnceLock::new();

fn jobs() -> &'static Mutex<HashMap<String, JobEntry>> {
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 启动后台任务：立即返回 `(id, log_path)`，不等待命令结束。
pub fn start_background_job(project_path: &str, command: &str) -> Result<(String, String), String> {
    let id = format!("job-{}", &uuid::Uuid::new_v4().to_string()[..8]);
    let log_name = format!("bg-{id}.log");
    let log_path = resolve_debug_log_path(&log_name, Some(project_path))?;
    if let Some(parent) = log_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建后台任务日志目录失败: {e}"))?;
    }
    let stdout = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&log_path)
        .map_err(|e| format!("打开后台任务日志失败: {e}"))?;
    let stderr = stdout
        .try_clone()
        .map_err(|e| format!("复制后台任务日志句柄失败: {e}"))?;

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
    let mut cmd = Command::new(shell);
    cmd.args([flag, command])
        .current_dir(project_path)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .env("GIT_PAGER", "cat")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("PAGER", "cat");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let mut child = cmd.spawn().map_err(|e| format!("启动后台任务失败: {e}"))?;
    let pid = child.id();
    let exit = Arc::new(Mutex::new(None::<JobExit>));
    let exit_slot = exit.clone();
    // 独立线程等待进程结束，写入退出状态；主流程不等它。
    std::thread::spawn(move || {
        let result = child.wait();
        let recorded = match result {
            Ok(status) => JobExit {
                code: status.code(),
                killed: false,
            },
            Err(_) => JobExit {
                code: None,
                killed: true,
            },
        };
        if let Ok(mut guard) = exit_slot.lock() {
            *guard = Some(recorded);
        }
    });

    let log_display = log_path.to_string_lossy().replace('\\', "/");
    jobs().lock().map_err(|_| "后台任务表锁失败".to_string())?.insert(
        id.clone(),
        JobEntry {
            command: command.to_string(),
            log_path: log_display.clone(),
            started_ms: now_ms(),
            pid: Some(pid),
            exit,
        },
    );
    Ok((id, log_display))
}

/// 后台任务是否仍在运行（供外部判断）。
pub fn job_is_running(id: &str) -> bool {
    let guard = match jobs().lock() {
        Ok(g) => g,
        Err(_) => return false,
    };
    match guard.get(id) {
        Some(entry) => entry
            .exit
            .lock()
            .map(|e| e.is_none())
            .unwrap_or(false),
        None => false,
    }
}

fn status_label(exit: &Option<JobExit>) -> String {
    match exit {
        None => "运行中".to_string(),
        Some(e) if e.killed => "已终止".to_string(),
        Some(e) if e.code == Some(0) => "已完成".to_string(),
        Some(e) => match e.code {
            Some(code) => format!("已失败（exit {code}）"),
            None => "已失败".to_string(),
        },
    }
}

/// 读取日志尾部若干行。
fn read_log_tail(log_path: &str, tail_lines: usize) -> String {
    match std::fs::read_to_string(log_path) {
        Ok(content) => {
            let lines: Vec<&str> = content.lines().collect();
            let start = lines.len().saturating_sub(tail_lines);
            lines[start..].join("\n")
        }
        Err(_) => String::new(),
    }
}

/// 查询后台任务状态与日志尾部。
pub fn background_job_status(id: &str, tail_lines: usize) -> Result<String, String> {
    let (command, log_path, started_ms, exit) = {
        let guard = jobs().lock().map_err(|_| "后台任务表锁失败".to_string())?;
        let entry = guard
            .get(id)
            .ok_or_else(|| format!("错误：未找到后台任务 {id}"))?;
        let exit = entry.exit.lock().map(|e| e.clone()).unwrap_or(None);
        (
            entry.command.clone(),
            entry.log_path.clone(),
            entry.started_ms,
            exit,
        )
    };
    let tail = read_log_tail(&log_path, tail_lines);
    let elapsed_sec = ((now_ms() - started_ms).max(0)) / 1000;
    let mut out = format!(
        "后台任务 {id}\n状态：{label}\n命令：{command}\n已运行：{elapsed_sec}s\n日志：{log_path}",
        label = status_label(&exit)
    );
    if tail.is_empty() {
        out.push_str("\n--- 日志（暂无输出） ---");
    } else {
        out.push_str(&format!("\n--- 日志最后 {tail_lines} 行 ---\n{tail}"));
    }
    Ok(out)
}

/// 终止后台任务及其子进程树。
pub fn kill_background_job(id: &str) -> Result<String, String> {
    let (pid, already_done) = {
        let guard = jobs().lock().map_err(|_| "后台任务表锁失败".to_string())?;
        let entry = guard
            .get(id)
            .ok_or_else(|| format!("错误：未找到后台任务 {id}"))?;
        let done = entry.exit.lock().map(|e| e.is_some()).unwrap_or(true);
        (entry.pid, done)
    };
    if already_done {
        return Ok(format!("后台任务 {id} 已结束，无需终止。"));
    }
    if let Some(pid) = pid {
        crate::agent::tool_exec::kill_command_process_tree(pid);
    }
    // 标记为已终止，让后续 status 明确显示（进程退出码可能为 1）。
    if let Ok(guard) = jobs().lock() {
        if let Some(entry) = guard.get(id) {
            if let Ok(mut slot) = entry.exit.lock() {
                if slot.is_none() {
                    *slot = Some(JobExit {
                        code: None,
                        killed: true,
                    });
                }
            }
        }
    }
    Ok(format!("已终止后台任务 {id}。"))
}

/// 后台任务相关工具的执行入口（被 tool_exec 分发表调用）。
pub fn exec_command_status(args: &serde_json::Value) -> (bool, String) {
    let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
    if id.is_empty() {
        return (false, "错误：缺少 id".into());
    }
    let tail_lines = args
        .get("tail_lines")
        .and_then(|v| v.as_u64())
        .unwrap_or(40)
        .clamp(1, 200) as usize;
    match background_job_status(id, tail_lines) {
        Ok(text) => (true, text),
        Err(e) => (false, e),
    }
}

pub fn exec_command_kill(args: &serde_json::Value) -> (bool, String) {
    let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
    if id.is_empty() {
        return (false, "错误：缺少 id".into());
    }
    match kill_background_job(id) {
        Ok(text) => (true, text),
        Err(e) => (false, e),
    }
}

/// 工具结果 JSON 摘要（供测试/未来扩展）。
#[allow(dead_code)]
pub fn job_summary_json(id: &str) -> serde_json::Value {
    json!({ "id": id, "running": job_is_running(id) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_project(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("aiall-bg-{tag}-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        dir
    }

    #[test]
    fn status_unknown_job_reports_error() {
        let (ok, msg) = exec_command_status(&json!({ "id": "job-nope" }));
        assert!(!ok);
        assert!(msg.contains("未找到后台任务"), "got: {msg}");
    }

    #[test]
    fn command_status_requires_id() {
        let (ok, msg) = exec_command_status(&json!({}));
        assert!(!ok);
        assert!(msg.contains("缺少 id"));
    }

    #[test]
    fn background_job_runs_and_reports_finished() {
        let dir = temp_project("run");
        let cmd = if cfg!(windows) {
            "Write-Output 'bg-done'"
        } else {
            "echo bg-done"
        };
        let (id, log_path) = start_background_job(dir.to_str().unwrap(), cmd).unwrap();
        assert!(id.starts_with("job-"));
        assert!(log_path.contains("bg-"));
        // 等待进程结束（短命令）。
        for _ in 0..50 {
            if !job_is_running(&id) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        assert!(!job_is_running(&id), "后台任务应已结束");
        let (ok, out) = exec_command_status(&json!({ "id": id, "tail_lines": 10 }));
        assert!(ok, "status should succeed: {out}");
        assert!(out.contains("已完成"), "got: {out}");
        assert!(out.contains("bg-done"), "log tail should contain output: {out}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn kill_marks_job_terminated() {
        let dir = temp_project("kill");
        let cmd = if cfg!(windows) {
            "Start-Sleep -Seconds 60"
        } else {
            "sleep 60"
        };
        let (id, _log) = start_background_job(dir.to_str().unwrap(), cmd).unwrap();
        assert!(job_is_running(&id));
        let (ok, msg) = exec_command_kill(&json!({ "id": id }));
        assert!(ok, "kill should succeed: {msg}");
        assert!(msg.contains("已终止"));
        let (_, out) = exec_command_status(&json!({ "id": id }));
        assert!(out.contains("已终止"), "got: {out}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
