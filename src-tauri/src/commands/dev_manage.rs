use serde_json::json;
use std::io::BufRead;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::State;

pub struct DevServerState(pub Mutex<Option<(Child, String)>>);

impl Default for DevServerState {
  fn default() -> Self {
    Self(Mutex::new(None))
  }
}

#[tauri::command]
pub async fn dev_server_start(state: State<'_, DevServerState>) -> Result<serde_json::Value, String> {
  let mut guard = state.0.lock().map_err(|_| "状态锁失败")?;
  if let Some((_, _)) = guard.as_ref() {
    return Ok(json!({ "ok": false, "error": "开发服务器已在运行中" }));
  }

  let child = Command::new("cmd")
    .args(["/C", "npm", "run", "dev"])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|e| format!("启动失败: {e}"))?;

  let pid = child.id();
  *guard = Some((child, pid.to_string()));
  Ok(json!({ "ok": true, "pid": pid }))
}

#[tauri::command]
pub async fn dev_server_stop(state: State<'_, DevServerState>) -> Result<serde_json::Value, String> {
  let mut guard = state.0.lock().map_err(|_| "状态锁失败")?;
  match guard.take() {
    Some((mut child, pid)) => {
      let _ = child.kill();
      let _ = child.wait();
      Ok(json!({ "ok": true, "pid": pid }))
    }
    None => Ok(json!({ "ok": false, "error": "没有运行中的开发服务器" })),
  }
}

#[tauri::command]
pub async fn dev_server_status(state: State<'_, DevServerState>) -> Result<serde_json::Value, String> {
  let mut guard = state.0.lock().map_err(|_| "状态锁失败")?;
  match guard.as_mut() {
    Some((child, pid)) => {
      let running = child.try_wait().map(|s| s.is_none()).unwrap_or(false);
      Ok(json!({ "running": running, "pid": pid }))
    }
    None => Ok(json!({ "running": false })),
  }
}

#[tauri::command]
pub async fn dev_build() -> Result<serde_json::Value, String> {
  let output = Command::new("cmd")
    .args(["/C", "npm", "run", "tauri:build"])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .output()
    .map_err(|e| format!("构建失败: {e}"))?;

  let stdout = String::from_utf8_lossy(&output.stdout).to_string();
  let stderr = String::from_utf8_lossy(&output.stderr).to_string();
  let success = output.status.success();

  let mut lines: Vec<String> = stdout
    .lines()
    .chain(stderr.lines())
    .map(|l| l.to_string())
    .collect();
  lines.reverse();
  let last_lines: Vec<String> = lines.into_iter().take(50).rev().collect();

  Ok(json!({
    "ok": success,
    "output": stdout + &stderr,
    "tail": last_lines,
    "code": output.status.code()
  }))
}
