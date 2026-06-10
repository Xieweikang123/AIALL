use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, RunEvent};

const BACKEND_PORT: u16 = 37891;

struct BackendProcess(Mutex<Option<Child>>);

#[tauri::command]
fn get_backend_url() -> String {
  format!("http://127.0.0.1:{BACKEND_PORT}")
}

fn resolve_project_root(app: &tauri::App) -> Result<std::path::PathBuf, String> {
  if cfg!(debug_assertions) {
    // tauri dev 的 cargo 进程工作目录是 src-tauri/，
    // 需要向上查找 package.json 来定位真正的项目根目录
    let mut dir = std::env::current_dir().map_err(|e| e.to_string())?;
    while !dir.join("package.json").exists() {
      match dir.parent() {
        Some(parent) => dir = parent.to_path_buf(),
        None => break,
      }
    }
    Ok(dir)
  } else if let Ok(resource_dir) = app.path().resource_dir() {
    Ok(resource_dir)
  } else {
    std::env::current_dir().map_err(|e| e.to_string())
  }
}

fn start_backend_process(app: &tauri::App) -> Result<(), String> {
  let project_root = resolve_project_root(app)?;
  let port = BACKEND_PORT.to_string();

  let mut child = if cfg!(debug_assertions) {
    let npx = if cfg!(windows) { "npx.cmd" } else { "npx" };
    Command::new(npx)
      .args(["tsx", "sidecar/main.ts"])
      .current_dir(&project_root)
      .env("AIALL_PROJECT_ROOT", &project_root)
      .env("AIALL_BACKEND_PORT", &port)
      .stdout(Stdio::piped())
      .stderr(Stdio::piped())
      .spawn()
      .map_err(|e| format!("启动 Node 后端失败（开发模式需要 Node.js + tsx）：{e}"))?
  } else {
    let script = project_root.join("sidecar/dist/main.cjs");
    Command::new("node")
      .arg(&script)
      .current_dir(&project_root)
      .env("AIALL_PROJECT_ROOT", &project_root)
      .env("AIALL_BACKEND_PORT", &port)
      .stdout(Stdio::piped())
      .stderr(Stdio::piped())
      .spawn()
      .map_err(|e| format!("启动 Node 后端失败（需要系统已安装 Node.js）：{e}"))?
  };

  if let Some(stdout) = child.stdout.take() {
    std::thread::spawn(move || {
      use std::io::{BufRead, BufReader};
      let reader = BufReader::new(stdout);
      for line in reader.lines().map_while(Result::ok) {
        log::info!("[backend] {line}");
      }
    });
  }

  if let Some(stderr) = child.stderr.take() {
    std::thread::spawn(move || {
      use std::io::{BufRead, BufReader};
      let reader = BufReader::new(stderr);
      for line in reader.lines().map_while(Result::ok) {
        log::warn!("[backend] {line}");
      }
    });
  }

  app.manage(BackendProcess(Mutex::new(Some(child))));
  log::info!("Node backend starting on http://127.0.0.1:{BACKEND_PORT}");
  Ok(())
}

fn stop_backend_process(app: &tauri::AppHandle) {
  let Some(state) = app.try_state::<BackendProcess>() else {
    return;
  };
  let Ok(mut guard) = state.0.lock() else {
    return;
  };
  if let Some(mut child) = guard.take() {
    let _ = child.kill();
    let _ = child.wait();
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      start_backend_process(app)?;
      app.handle().plugin(tauri_plugin_dialog::init())?;
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![get_backend_url])
    .build(tauri::generate_context!())
    .expect("error while running tauri application")
    .run(|app, event| {
      if let RunEvent::Exit = event {
        stop_backend_process(app);
      }
    });
}
