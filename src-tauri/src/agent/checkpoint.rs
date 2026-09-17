//! Server-side agent run checkpoints.
//!
//! Written by the Rust agent loop so page reload / HMR does not depend on the
//! browser receiving `done` and persisting the session. Slim payload mirrors
//! what `hasRecoverableAgentProgress` needs (tools / turns / content).

use crate::paths::project_chat_store_dir;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const TOOL_SUMMARY_MAX_CHARS: usize = 400;

#[derive(Debug, Clone)]
pub struct RunCheckpoint {
    enabled: bool,
    project_path: String,
    session_id: String,
    assistant_msg_id: String,
    run_id: String,
    phase: String,
    turn: u32,
    max_turns: u32,
    content: String,
    status_log: Vec<String>,
    tools: Vec<Value>,
    written_files: Vec<String>,
    failure_reason: Option<String>,
}

impl RunCheckpoint {
    /// Build from request identity fields. Disabled when session/assistant ids are missing.
    pub fn from_request(
        project_path: &str,
        session_id: Option<&str>,
        assistant_msg_id: Option<&str>,
        run_id: Option<&str>,
        max_turns: u32,
    ) -> Self {
        let session_id = session_id.map(str::trim).filter(|s| !s.is_empty()).unwrap_or("");
        let assistant_msg_id = assistant_msg_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("");
        let enabled = !project_path.trim().is_empty()
            && !session_id.is_empty()
            && !assistant_msg_id.is_empty();
        let run_id = run_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        Self {
            enabled,
            project_path: project_path.to_string(),
            session_id: session_id.to_string(),
            assistant_msg_id: assistant_msg_id.to_string(),
            run_id,
            phase: "running".into(),
            turn: 0,
            max_turns,
            content: String::new(),
            status_log: Vec::new(),
            tools: Vec::new(),
            written_files: Vec::new(),
            failure_reason: None,
        }
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    pub fn push_status(&mut self, line: &str) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return;
        }
        if self.status_log.last().map(|s| s.as_str()) == Some(trimmed) {
            return;
        }
        self.status_log.push(trimmed.to_string());
        if self.status_log.len() > 40 {
            let drain = self.status_log.len() - 40;
            self.status_log.drain(0..drain);
        }
    }

    pub fn note_turn(&mut self, turn: u32, max_turns: u32, assistant_text: &str) {
        self.turn = turn;
        self.max_turns = max_turns;
        let text = assistant_text.trim();
        if !text.is_empty() {
            self.content = text.to_string();
        }
    }

    pub fn note_tool(
        &mut self,
        id: &str,
        name: &str,
        ok: bool,
        summary: &str,
        turn: u32,
    ) {
        let summary = truncate_chars(summary.trim(), TOOL_SUMMARY_MAX_CHARS);
        self.tools.push(json!({
            "id": id,
            "name": name,
            "label": name,
            "ok": ok,
            "running": false,
            "summary": summary,
            "turn": turn,
        }));
    }

    pub fn set_written_files(&mut self, files: &[String]) {
        self.written_files = files.to_vec();
    }

    pub async fn flush_running(&self) {
        if !self.enabled {
            return;
        }
        let _ = write_checkpoint_file(&self.path(), &self.to_value("running")).await;
    }

    pub async fn finish_done(&mut self, written_files: &[String], turns: u32) {
        if !self.enabled {
            return;
        }
        self.phase = "done".into();
        self.turn = turns.max(self.turn);
        self.set_written_files(written_files);
        self.failure_reason = None;
        let _ = write_checkpoint_file(&self.path(), &self.to_value("done")).await;
    }

    pub async fn finish_aborted(&mut self, written_files: &[String], turns: u32) {
        if !self.enabled {
            return;
        }
        self.phase = "aborted".into();
        self.turn = turns.max(self.turn);
        self.set_written_files(written_files);
        self.failure_reason = Some("页面刷新或热更新导致运行中断".into());
        self.push_status("运行中断（服务端已保存进度快照）");
        let _ = write_checkpoint_file(&self.path(), &self.to_value("aborted")).await;
    }

    pub async fn finish_error(&mut self, message: &str, written_files: &[String], turns: u32) {
        if !self.enabled {
            return;
        }
        self.phase = "error".into();
        self.turn = turns.max(self.turn);
        self.set_written_files(written_files);
        let reason = message.trim();
        self.failure_reason = Some(if reason.is_empty() {
            "Agent 运行出错".into()
        } else {
            reason.to_string()
        });
        let status_line = self
            .failure_reason
            .clone()
            .unwrap_or_else(|| "error".into());
        self.push_status(&status_line);
        let _ = write_checkpoint_file(&self.path(), &self.to_value("error")).await;
    }

    fn path(&self) -> PathBuf {
        checkpoint_path(&self.project_path, &self.session_id)
    }

    fn to_value(&self, phase: &str) -> Value {
        let recoverable = phase == "running" || phase == "aborted" || phase == "error";
        json!({
            "version": 1,
            "runId": self.run_id,
            "sessionId": self.session_id,
            "assistantMsgId": self.assistant_msg_id,
            "projectPath": self.project_path,
            "updatedAt": chrono::Utc::now().to_rfc3339(),
            "phase": phase,
            "turn": self.turn,
            "maxTurns": self.max_turns,
            "totalTurns": self.turn,
            "content": self.content,
            "statusLog": self.status_log,
            "tools": self.tools,
            "writtenFiles": self.written_files,
            "agentFailed": recoverable && phase != "running",
            "agentRecoverable": recoverable,
            "agentFailureReason": self.failure_reason,
            "agentAborted": phase == "aborted",
            "agentAbortReason": if phase == "aborted" {
                self.failure_reason.clone()
            } else {
                None
            },
        })
    }
}

fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    text.chars().take(max).collect::<String>() + "…"
}

fn safe_session_part(session_id: &str) -> String {
    session_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

pub fn checkpoint_path(project_path: &str, session_id: &str) -> PathBuf {
    project_chat_store_dir(project_path)
        .join("checkpoints")
        .join(format!("active-{}.json", safe_session_part(session_id)))
}

async fn write_checkpoint_file(path: &Path, value: &Value) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let tmp_name = format!(
        ".tmp-{}",
        path.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "checkpoint.json".to_string())
    );
    let tmp = path.with_file_name(tmp_name);
    let body = serde_json::to_string_pretty(value).unwrap_or_default();
    tokio::fs::write(&tmp, body).await?;
    tokio::fs::rename(&tmp, path).await
}

/// Load the latest checkpoint for a session (if any).
pub async fn load_run_checkpoint(project_path: &str, session_id: &str) -> Value {
    let project_path = project_path.trim();
    let session_id = session_id.trim();
    if project_path.is_empty() || session_id.is_empty() {
        return json!({ "ok": false, "error": "projectPath 与 sessionId 不能为空" });
    }
    let path = checkpoint_path(project_path, session_id);
    match tokio::fs::read_to_string(&path).await {
        Ok(raw) => match serde_json::from_str::<Value>(&raw) {
            Ok(data) => json!({ "ok": true, "checkpoint": data, "path": path.to_string_lossy() }),
            Err(e) => json!({ "ok": false, "error": format!("checkpoint 解析失败: {e}") }),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            json!({ "ok": true, "checkpoint": Value::Null })
        }
        Err(e) => json!({ "ok": false, "error": format!("读取 checkpoint 失败: {e}") }),
    }
}

/// Clear checkpoint after the client has merged/persisted it (or run completed cleanly client-side).
pub async fn clear_run_checkpoint(project_path: &str, session_id: &str) -> Value {
    let project_path = project_path.trim();
    let session_id = session_id.trim();
    if project_path.is_empty() || session_id.is_empty() {
        return json!({ "ok": false, "error": "projectPath 与 sessionId 不能为空" });
    }
    let path = checkpoint_path(project_path, session_id);
    match tokio::fs::remove_file(&path).await {
        Ok(()) => json!({ "ok": true, "cleared": true }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            json!({ "ok": true, "cleared": false })
        }
        Err(e) => json!({ "ok": false, "error": format!("清除 checkpoint 失败: {e}") }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::{set_session_root_override, SessionRootOverrideGuard};
    use std::time::{SystemTime, UNIX_EPOCH};

    /// Project path plus a guard redirecting the chat store to a temp dir for this
    /// test thread, so checkpoint writes never land in the real AppData store.
    fn temp_project() -> (String, SessionRootOverrideGuard) {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("aiall-ckpt-root-{nanos}"));
        let _ = std::fs::create_dir_all(&root);
        let guard = set_session_root_override(root.clone());
        let project = root.join("project");
        let _ = std::fs::create_dir_all(&project);
        (project.to_string_lossy().to_string(), guard)
    }

    #[tokio::test]
    async fn disabled_without_session_ids() {
        let ck = RunCheckpoint::from_request("/tmp/p", None, None, None, 12);
        assert!(!ck.enabled());
        ck.flush_running().await; // no-op
    }

    #[tokio::test]
    async fn writes_and_loads_checkpoint() {
        let (project, _guard) = temp_project();
        let mut ck = RunCheckpoint::from_request(
            &project,
            Some("sess-1"),
            Some("asst-1"),
            Some("run-1"),
            12,
        );
        assert!(ck.enabled());
        ck.note_turn(1, 12, "正在排查");
        ck.note_tool("t1", "read_file", true, "ok: src/foo.ts", 1);
        ck.flush_running().await;

        let loaded = load_run_checkpoint(&project, "sess-1").await;
        assert_eq!(loaded["ok"], true);
        let cp = &loaded["checkpoint"];
        assert_eq!(cp["phase"], "running");
        assert_eq!(cp["runId"], "run-1");
        assert_eq!(cp["assistantMsgId"], "asst-1");
        assert_eq!(cp["content"], "正在排查");
        assert_eq!(cp["tools"].as_array().unwrap().len(), 1);
        assert_eq!(cp["totalTurns"], 1);

        ck.finish_aborted(&["src/foo.ts".into()], 1).await;
        let loaded = load_run_checkpoint(&project, "sess-1").await;
        assert_eq!(loaded["checkpoint"]["phase"], "aborted");
        assert_eq!(loaded["checkpoint"]["agentRecoverable"], true);

        let cleared = clear_run_checkpoint(&project, "sess-1").await;
        assert_eq!(cleared["ok"], true);
        let loaded = load_run_checkpoint(&project, "sess-1").await;
        assert!(loaded["checkpoint"].is_null());
    }

    #[test]
    fn truncate_summary() {
        let long = "x".repeat(500);
        let out = truncate_chars(&long, 400);
        assert!(out.ends_with('…'));
        assert_eq!(out.chars().count(), 401);
    }
}
