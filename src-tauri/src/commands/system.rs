use serde_json::json;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub async fn system_open_url(app: AppHandle, url: String) -> Result<(), String> {
  app
    .opener()
    .open_url(&url, None::<&str>)
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn system_open_folder(app: AppHandle, path: String) -> serde_json::Value {
  match app.opener().open_path(&path, None::<&str>) {
    Ok(_) => json!({ "ok": true, "path": path }),
    Err(e) => json!({ "ok": false, "error": e.to_string() }),
  }
}

#[tauri::command]
pub async fn system_pick_folder(app: AppHandle, initial_path: Option<String>) -> serde_json::Value {
  let mut dialog = app.dialog().file().set_title("选择项目文件夹");
  if let Some(path) = initial_path.map(|p| p.trim().to_string()).filter(|p| !p.is_empty()) {
    dialog = dialog.set_directory(path);
  }
  match dialog.blocking_pick_folder() {
    Some(path) => match path.into_path() {
      Ok(p) => json!({ "ok": true, "path": p.to_string_lossy() }),
      Err(e) => json!({ "ok": false, "error": e.to_string() }),
    },
    None => json!({ "ok": false, "cancelled": true }),
  }
}
