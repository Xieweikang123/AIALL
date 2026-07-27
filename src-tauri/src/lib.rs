pub mod agent;
mod ai;
mod automation;
mod chat;
mod commands;
mod error;
mod fs;
mod git;
mod paths;
mod project;
mod web_fetch;

use commands::dev_manage::DevServerState;
use commands::fs::DirCache;
use commands::watcher::WatcherState;
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

#[tauri::command]
fn send_notification(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
  app
    .notification()
    .builder()
    .title(&title)
    .body(&body)
    .show()
    .map_err(|e| format!("发送通知失败: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      app.manage(DirCache::default());
      app.manage(WatcherState::default());
      app.manage(commands::agent::AgentRunState::default());
      app.manage(DevServerState::default());
      app.handle().plugin(tauri_plugin_dialog::init())?;
      app.handle().plugin(tauri_plugin_notification::init())?;
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      send_notification,
      commands::fs::fs_list,
      commands::fs::fs_read,
      commands::fs::fs_write,
      commands::fs::fs_search,
      commands::fs::fs_grep,
      commands::fs::fs_create,
      commands::fs::fs_delete,
      commands::fs::fs_rename,
      commands::git::git_status,
      commands::git::git_changed_since,
      commands::git::git_diff,
      commands::git::git_diff_content,
      commands::git::git_commit_file_diff,
      commands::git::git_commit,
      commands::git::git_log,
      commands::git::git_ahead_commits,
      commands::git::git_add,
      commands::git::git_reset,
      commands::git::git_reset_to_commit,
      commands::git::git_resolve_conflict,
      commands::git::git_discard,
      commands::git::git_remotes,
      commands::git::git_fetch,
      commands::git::git_pull,
      commands::git::git_push,
      commands::git::git_stash_list,
      commands::git::git_stash_save,
      commands::git::git_stash_pop,
      commands::git::git_stash_apply,
      commands::git::git_stash_drop,
      commands::git::git_branches,
      commands::git::git_checkout,
      commands::git::git_branch_delete,
      commands::git::git_op_state,
      commands::git::git_merge,
      commands::git::git_merge_abort,
      commands::git::git_rebase,
      commands::git::git_rebase_abort,
      commands::git::git_cherry_pick,
      commands::git::git_revert_commit,
      commands::git::git_amend,
      commands::git::git_tag_list,
      commands::git::git_tag_create,
      commands::git::git_tag_delete,
      commands::git::git_submodule_status,
      commands::git::git_submodule_update,
      commands::git::git_generate_message,
      commands::git::git_ai_batch_groups,
      commands::chat::chat_store_load,
      commands::chat::chat_session_messages,
      commands::chat::chat_store_sync,
      commands::chat::chat_session_sync,
      commands::chat::chat_session_delete,
      commands::chat::chat_image,
      commands::chat::chat_image_file,
      commands::project::project_memory_get,
      commands::project::project_memory_save,
      commands::project::project_knowledge_get,
      commands::project::project_knowledge_save,
      commands::project::project_skills_list,
      commands::project::project_skills_save,
      commands::project::project_architect_review_get,
      commands::project::project_architect_review_save,
      commands::project::project_architect_review_context,
      commands::project::project_architect_review_history,
      commands::project::project_architect_review_history_delete,
      commands::project::project_health_scan,
      commands::project::project_verify_run,
      commands::project::project_context,
      commands::project::code_map_build,
      commands::project::memory_usage,
      commands::system::system_open_url,
      commands::system::system_open_folder,
      commands::system::system_pick_folder,
      commands::system::system_debug_log_append,
      commands::ai::ai_test,
      commands::ai::ai_test_stream,
      commands::ai::ai_models,
      commands::ai::ai_tts,
      commands::web::web_extract,
      commands::web::web_screenshot_page,
      commands::automation::automation_capture_screen,
      commands::automation::automation_click_at,
      commands::automation::automation_find_template,
      commands::automation::automation_open_by_template,
      commands::automation::automation_test_match,
      commands::automation::automation_test_icon_template,
      commands::automation::icon_templates_list,
      commands::automation::icon_templates_save,
      commands::automation::icon_templates_delete,
      commands::watcher::file_watcher_start,
      commands::watcher::file_watcher_stop,
      commands::agent::agent_run,
      commands::agent::agent_cancel,
      commands::dev_manage::dev_server_start,
      commands::dev_manage::dev_server_stop,
      commands::dev_manage::dev_server_status,
      commands::dev_manage::dev_build,
    ])
    .build(tauri::generate_context!())
    .expect("error while running tauri application")
    .run(|_app, _event| {});
}
