use crate::agent;
use serde_json::Value;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::ipc::Channel;
use tauri::State;

pub struct AgentRunState {
    pub cancel: Mutex<Option<Arc<AtomicBool>>>,
}

impl Default for AgentRunState {
    fn default() -> Self {
        Self {
            cancel: Mutex::new(None),
        }
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
pub async fn agent_run(
    request: agent::AgentRunRequest,
    on_event: Channel<Value>,
    state: State<'_, AgentRunState>,
) -> Result<(), String> {
    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut guard = state
            .cancel
            .lock()
            .map_err(|_| "Agent 状态锁失败".to_string())?;
        *guard = Some(cancel_flag.clone());
    }

    let result = agent::agent_run(request, on_event, cancel_flag).await;

    {
        let mut guard = state
            .cancel
            .lock()
            .map_err(|_| "Agent 状态锁失败".to_string())?;
        *guard = None;
    }

    result
}
