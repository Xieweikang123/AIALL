//! Process crash / lifecycle logging for release diagnostics.
//! Writes to `%APPDATA%/aiall/debug-logs/crash.log` (sync I/O so panic hooks work).

use crate::paths::resolve_aiall_debug_log_dir;
use std::fs::OpenOptions;
use std::io::Write;
use std::panic;
use std::path::Path;

const CRASH_LOG_FILE: &str = "crash.log";

fn timestamp() -> String {
  chrono::Local::now()
    .format("%Y-%m-%d %H:%M:%S%.3f")
    .to_string()
}

fn build_mode() -> &'static str {
  if cfg!(debug_assertions) {
    "debug"
  } else {
    "release"
  }
}

fn append_line(kind: &str, message: &str) {
  let dir = resolve_aiall_debug_log_dir();
  let path = dir.join(CRASH_LOG_FILE);
  if let Some(parent) = path.parent() {
    if !parent.as_os_str().is_empty() {
      let _ = std::fs::create_dir_all(parent);
    }
  }
  let line = format!(
    "[{}] [{}] [v{} {}] {}\n",
    timestamp(),
    kind,
    env!("CARGO_PKG_VERSION"),
    build_mode(),
    message.replace('\n', " | ")
  );
  if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
    let _ = file.write_all(line.as_bytes());
    let _ = file.flush();
  }
}

/// Append a lifecycle / diagnostic line (boot, exit, etc.).
pub fn log_lifecycle(event: &str) {
  append_line("lifecycle", event);
}

fn format_panic_info(info: &panic::PanicInfo<'_>) -> String {
  let location = info
    .location()
    .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
    .unwrap_or_else(|| "unknown".into());
  let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
    (*s).to_string()
  } else if let Some(s) = info.payload().downcast_ref::<String>() {
    s.clone()
  } else {
    "non-string panic payload".into()
  };
  format!("location={location} payload={payload}")
}

/// Install a panic hook that appends to crash.log, then chains the previous hook.
pub fn install_panic_hook() {
  let previous = panic::take_hook();
  panic::set_hook(Box::new(move |info| {
    append_line("rust-panic", &format_panic_info(info));
    previous(info);
  }));
}

/// Best-effort note that the process is about to abort without a Rust panic (unused for now).
#[allow(dead_code)]
pub fn log_fatal(message: &str) {
  append_line("fatal", message);
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn crash_log_path_is_under_debug_logs() {
    let path = resolve_aiall_debug_log_dir().join(CRASH_LOG_FILE);
    let s = path.to_string_lossy().replace('\\', "/");
    assert!(s.contains("aiall/debug-logs/crash.log"), "got: {s}");
    assert!(!Path::new(&path).is_relative() || s.contains("debug-logs"));
  }
}
