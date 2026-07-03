use crate::chat;
use serde_json::Value;

#[tauri::command]
pub async fn chat_store_load(project_path: String, load_messages: Option<bool>) -> Value {
  chat::chat_store_load(&project_path, load_messages.unwrap_or(false)).await
}

#[tauri::command]
pub async fn chat_session_messages(project_path: String, session_id: String) -> Value {
  chat::chat_session_messages(&project_path, &session_id).await
}

#[tauri::command]
pub async fn chat_store_sync(project_path: String, data: Value) -> Value {
  chat::chat_store_sync(&project_path, data).await
}

#[tauri::command]
pub async fn chat_session_sync(
  project_path: String,
  session_id: String,
  data: Value,
  active_session_id: Option<String>,
) -> Value {
  chat::chat_session_sync(
    &project_path,
    &session_id,
    data,
    active_session_id.as_deref(),
  )
  .await
}

#[tauri::command]
pub async fn chat_session_delete(
  project_path: String,
  session_id: String,
  active_session_id: Option<String>,
) -> Value {
  chat::chat_session_delete(
    &project_path,
    &session_id,
    active_session_id.as_deref(),
  )
  .await
}

#[tauri::command]
pub async fn chat_image(project_path: String, path: String) -> Value {
  chat::chat_image_data_url(&project_path, &path).await
}

#[tauri::command]
pub async fn chat_image_file(project_path: String, path: String) -> Result<Vec<u8>, String> {
  chat::chat_image_file_bytes(&project_path, &path).await
}
