use serde_json::{json, Value};
use std::io::BufRead;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::State;

/// 正在运行的 npm script 句柄：子进程通过 `shared_child` 在读取任务与 stop 命令之间共享。
pub struct NpmScriptHandle {
    pub shared_child: Arc<Mutex<Option<Child>>>,
    pub pid: u32,
    pub project_dir: String,
    pub script: String,
}

pub struct NpmScriptState(pub Mutex<Option<NpmScriptHandle>>);

impl Default for NpmScriptState {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

/// 脚本名白名单：仅允许 npm 脚本名的常规字符，防止注入到 `cmd /C npm run <script>`。
fn is_valid_script_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name.chars().all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, '@' | '/' | '.' | '_' | '-' | ':' | '+')
        })
}

fn spawn_npm(project_dir: &str, script: &str) -> Result<Child, String> {
    let mut cmd = Command::new("cmd");
    cmd.args(["/C", "npm", "run", script])
        .current_dir(project_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.spawn().map_err(|e| format!("启动失败: {e}"))
}

/// 启动 `npm run <script>` 并通过 Channel 流式输出 stdout/stderr。
#[tauri::command]
pub async fn npm_script_run(
    project_dir: String,
    script: String,
    on_event: Channel<Value>,
    state: State<'_, NpmScriptState>,
) -> Result<Value, String> {
    if !is_valid_script_name(&script) {
        return Ok(json!({ "ok": false, "error": "无效的脚本名" }));
    }

    {
        let guard = state.0.lock().map_err(|_| "状态锁失败".to_string())?;
        if let Some(handle) = guard.as_ref() {
            let alive = {
                let mut g = handle.shared_child.lock().unwrap();
                g.as_mut()
                    .map(|c| c.try_wait().map(|s| s.is_none()).unwrap_or(false))
                    .unwrap_or(false)
            };
            if alive {
                return Ok(json!({ "ok": false, "error": "已有脚本在运行，请先停止" }));
            }
        }
    }

    let child = spawn_npm(&project_dir, &script)?;
    let pid = child.id();
    let shared_child: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(Some(child)));

    {
        let mut guard = state.0.lock().map_err(|_| "状态锁失败".to_string())?;
        *guard = Some(NpmScriptHandle {
            shared_child: shared_child.clone(),
            pid,
            project_dir: project_dir.clone(),
            script: script.clone(),
        });
    }

    let _ = on_event.send(json!({ "type": "started", "data": { "pid": pid } }));

    let stdout = {
        let mut g = shared_child.lock().unwrap();
        g.as_mut().and_then(|c| c.stdout.take())
    };
    let stderr = {
        let mut g = shared_child.lock().unwrap();
        g.as_mut().and_then(|c| c.stderr.take())
    };

    let out_channel = on_event.clone();
    if let Some(out) = stdout {
        tauri::async_runtime::spawn_blocking(move || {
            let reader = std::io::BufReader::new(out);
            for line in reader.lines() {
                match line {
                    Ok(text) => {
                        let _ = out_channel.send(json!({ "type": "stdout", "data": { "line": text } }));
                    }
                    Err(_) => break,
                }
            }
        });
    }

    let err_channel = on_event.clone();
    if let Some(err) = stderr {
        tauri::async_runtime::spawn_blocking(move || {
            let reader = std::io::BufReader::new(err);
            for line in reader.lines() {
                match line {
                    Ok(text) => {
                        let _ = err_channel.send(json!({ "type": "stderr", "data": { "line": text } }));
                    }
                    Err(_) => break,
                }
            }
        });
    }

    let wait_child = shared_child.clone();
    let finish_channel = on_event.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let exit_code = {
            let mut guard = wait_child.lock().unwrap();
            guard
                .take()
                .and_then(|mut c| c.wait().ok())
                .and_then(|s| s.code())
                .unwrap_or(-1)
        };
        let _ = finish_channel.send(json!({ "type": "finished", "data": { "code": exit_code } }));
    });

    Ok(json!({ "ok": true, "pid": pid }))
}

#[tauri::command]
pub async fn npm_script_stop(state: State<'_, NpmScriptState>) -> Result<Value, String> {
    let mut guard = state.0.lock().map_err(|_| "状态锁失败".to_string())?;
    match guard.take() {
        Some(handle) => {
            let pid = handle.pid;
            let script = handle.script.clone();
            if let Some(mut child) = handle.shared_child.lock().unwrap().take() {
                let _ = child.kill();
                let _ = child.wait();
            }
            #[cfg(windows)]
            {
                // 结束整棵进程树（cmd -> npm -> node）
                let _ = Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid.to_string()])
                    .spawn();
            }
            Ok(json!({ "ok": true, "pid": pid, "script": script }))
        }
        None => Ok(json!({ "ok": false, "error": "没有运行中的脚本" })),
    }
}

#[tauri::command]
pub async fn npm_script_status(state: State<'_, NpmScriptState>) -> Result<Value, String> {
    let guard = state.0.lock().map_err(|_| "状态锁失败".to_string())?;
    match guard.as_ref() {
        Some(handle) => {
            let running = {
                let mut g = handle.shared_child.lock().unwrap();
                g.as_mut()
                    .map(|c| c.try_wait().map(|s| s.is_none()).unwrap_or(false))
                    .unwrap_or(false)
            };
            Ok(json!({
                "running": running,
                "pid": handle.pid,
                "projectDir": handle.project_dir,
                "script": handle.script
            }))
        }
        None => Ok(json!({ "running": false })),
    }
}
