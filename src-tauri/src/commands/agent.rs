use crate::agent;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::ipc::Channel;
use tauri::State;

#[derive(Clone, Default)]
pub struct ActiveRunInfo {
    pub project_path: String,
    pub session_id: Option<String>,
    pub assistant_msg_id: Option<String>,
    pub run_id: Option<String>,
}

pub struct AgentRunState {
    pub cancel: Mutex<Option<Arc<AtomicBool>>>,
    pub active: Mutex<Option<ActiveRunInfo>>,
}

impl Default for AgentRunState {
    fn default() -> Self {
        Self {
            cancel: Mutex::new(None),
            active: Mutex::new(None),
        }
    }
}

fn clear_active(state: &AgentRunState) {
    if let Ok(mut guard) = state.cancel.lock() {
        *guard = None;
    }
    if let Ok(mut guard) = state.active.lock() {
        *guard = None;
    }
}

#[tauri::command]
pub async fn agent_cancel(state: State<'_, AgentRunState>) -> Result<(), String> {
    let guard = state
        .cancel
        .lock()
        .map_err(|_| "Agent 状态锁失败".to_string())?;
    if let Some(flag) = guard.as_ref() {
        flag.store(true, Ordering::Relaxed);
        Ok(())
    } else {
        Err("当前没有运行中的 Agent".into())
    }
}

#[tauri::command]
pub async fn agent_active_run(state: State<'_, AgentRunState>) -> Result<Value, String> {
    let active = state
        .active
        .lock()
        .map_err(|_| "Agent 状态锁失败".to_string())?
        .clone();
    Ok(if let Some(info) = active {
        json!({
            "ok": true,
            "active": true,
            "projectPath": info.project_path,
            "sessionId": info.session_id,
            "assistantMsgId": info.assistant_msg_id,
            "runId": info.run_id,
        })
    } else {
        json!({ "ok": true, "active": false })
    })
}

#[tauri::command]
pub async fn agent_run(
    request: agent::AgentRunRequest,
    on_event: Channel<Value>,
    state: State<'_, AgentRunState>,
) -> Result<(), String> {
    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut cancel_guard = state
            .cancel
            .lock()
            .map_err(|_| "Agent 状态锁失败".to_string())?;
        let mut active_guard = state
            .active
            .lock()
            .map_err(|_| "Agent 状态锁失败".to_string())?;
        *cancel_guard = Some(cancel_flag.clone());
        *active_guard = Some(ActiveRunInfo {
            project_path: request.project_path().to_string(),
            session_id: request.session_id().map(str::to_string),
            assistant_msg_id: request.assistant_msg_id().map(str::to_string),
            run_id: request.run_id().map(str::to_string),
        });
    }

    let result = agent::agent_run(request, on_event, cancel_flag).await;
    clear_active(&state);
    result
}
