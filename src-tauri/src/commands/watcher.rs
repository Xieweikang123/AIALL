use notify::{
  event::{CreateKind, EventKind, RemoveKind},
  Config, Event, RecommendedWatcher, RecursiveMode, Watcher,
};
use serde_json::json;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

pub struct WatcherState(pub Mutex<Option<RecommendedWatcher>>);

impl Default for WatcherState {
  fn default() -> Self {
    Self(Mutex::new(None))
  }
}

fn map_event_type(kind: &EventKind) -> &'static str {
  match kind {
    EventKind::Create(CreateKind::Folder) => "addDir",
    EventKind::Create(_) => "add",
    EventKind::Modify(_) => "change",
    EventKind::Remove(RemoveKind::Folder) => "unlinkDir",
    EventKind::Remove(_) => "unlink",
    _ => "change",
  }
}

#[tauri::command]
pub async fn file_watcher_start(
  app: AppHandle,
  paths: Vec<String>,
  state: State<'_, WatcherState>,
) -> Result<serde_json::Value, String> {
  let mut guard = state.0.lock().map_err(|_| "watcher lock failed".to_string())?;
  if let Some(mut w) = guard.take() {
    let _ = w.unwatch(Path::new("."));
  }
  let app_handle = app.clone();
  let mut watcher = RecommendedWatcher::new(
    move |res: Result<Event, notify::Error>| {
      if let Ok(event) = res {
        let change_type = map_event_type(&event.kind);
        let timestamp = chrono::Utc::now().timestamp_millis();
        for path in event.paths {
          let path_str = path.to_string_lossy().to_string();
          let _ = app_handle.emit(
            "file-watcher",
            json!({
              "type": change_type,
              "path": path_str,
              "timestamp": timestamp,
            }),
          );
        }
      }
    },
    Config::default(),
  )
  .map_err(|e| e.to_string())?;
  for path in paths {
    watcher
      .watch(Path::new(&path), RecursiveMode::Recursive)
      .map_err(|e| e.to_string())?;
  }
  *guard = Some(watcher);
  Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn file_watcher_stop(state: State<'_, WatcherState>) -> Result<serde_json::Value, String> {
  let mut guard = state.0.lock().map_err(|_| "watcher lock failed".to_string())?;
  *guard = None;
  Ok(json!({ "ok": true }))
}
