//! Headless Agent HTTP server — Web/remote access to the desktop Agent.
//!
//! Reuses `app_lib::agent::agent_run_headless` (the same loop as the Tauri desktop
//! app), so Agent behavior has a single source of truth in Rust (see AGENT_SSOT.md).
//!
//! Endpoints:
//!   GET  /healthz                → 200 text/plain "ok"
//!   POST /api/agent/run          → SSE stream of VibeAgentEvent JSON
//!   POST /api/agent/cancel       → cancel the in-flight run
//!
//! Env:
//!   AIALL_SERVER_BIND             default 127.0.0.1
//!   AIALL_SERVER_PORT             default 8787
//!   AIALL_SERVER_TOKEN            optional bearer token (`Authorization: Bearer <token>`)
//!   AIALL_SERVER_ALLOWED_PROJECTS comma-separated allowed project roots (empty = allow all)

use app_lib::agent::{agent_run_headless, AgentRunRequest};
use app_lib::http_routes::{handle_backend_vibe, handle_other_route, HttpResponse};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{tcp::OwnedWriteHalf, TcpListener, TcpStream};

#[derive(Default)]
struct RunCancelState {
    cancel: Mutex<Option<Arc<AtomicBool>>>,
}

#[derive(Clone)]
struct ServerConfig {
    token: Option<String>,
    allowed_projects: Vec<String>,
}

struct HttpRequest {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

fn read_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn header_value<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(k, _)| k == name)
        .map(|(_, v)| v.as_str())
}

fn authorized(headers: &[(String, String)], config: &ServerConfig) -> bool {
    let Some(token) = &config.token else {
        return true;
    };
    let bearer = format!("Bearer {token}");
    header_value(headers, "authorization")
        .map(|v| v.trim() == bearer)
        .unwrap_or(false)
        || header_value(headers, "x-aiall-token")
            .map(|v| v.trim() == token)
            .unwrap_or(false)
}

fn project_allowed(project_path: &str, allowed: &[String]) -> bool {
    if allowed.is_empty() {
        return true;
    }
    let norm = |p: &str| p.replace('\\', "/").trim_end_matches('/').to_lowercase();
    let target = std::fs::canonicalize(project_path)
        .map(|c| norm(&c.to_string_lossy()))
        .unwrap_or_else(|_| norm(project_path));
    allowed
        .iter()
        .map(|a| norm(a))
        .any(|a| target == a || target.starts_with(&format!("{a}/")))
}

async fn write_headers(
    w: &mut OwnedWriteHalf,
    status: &str,
    content_type: &str,
    extra: &[(&str, &str)],
) -> Result<(), String> {
    let mut resp = format!("HTTP/1.1 {status}\r\n");
    resp.push_str(&format!("Content-Type: {content_type}\r\n"));
    resp.push_str("Access-Control-Allow-Origin: *\r\n");
    resp.push_str("Access-Control-Allow-Headers: authorization, content-type, x-aiall-token\r\n");
    resp.push_str("Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n");
    resp.push_str("Connection: close\r\n");
    for (k, v) in extra {
        resp.push_str(&format!("{k}: {v}\r\n"));
    }
    resp.push_str("\r\n");
    w.write_all(resp.as_bytes()).await.map_err(|e| e.to_string())
}

async fn read_request(read_half: tokio::net::tcp::OwnedReadHalf) -> Result<HttpRequest, String> {
    let mut reader = BufReader::new(read_half);
    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .await
        .map_err(|e| format!("读请求行失败: {e}"))?;
    let mut parts = request_line.trim().split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();
    if method.is_empty() || path.is_empty() {
        return Err("非法请求行".into());
    }
    let mut headers: Vec<(String, String)> = Vec::new();
    let mut content_length = 0usize;
    loop {
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .await
            .map_err(|e| format!("读请求头失败: {e}"))?;
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some((k, v)) = trimmed.split_once(':') {
            let key = k.trim().to_ascii_lowercase();
            let value = v.trim().to_string();
            if key == "content-length" {
                content_length = value.parse().unwrap_or(0);
            }
            headers.push((key, value));
        }
    }
    let mut body = Vec::new();
    if content_length > 0 {
        body.resize(content_length, 0);
        reader
            .read_exact(&mut body)
            .await
            .map_err(|e| format!("读请求体失败: {e}"))?;
    }
    Ok(HttpRequest {
        method,
        path,
        headers,
        body,
    })
}

fn cancel_state_clear(state: &RunCancelState) {
    if let Ok(mut guard) = state.cancel.lock() {
        *guard = None;
    }
}

async fn handle_healthz(w: &mut OwnedWriteHalf) -> Result<(), String> {
    write_headers(w, "200 OK", "text/plain", &[]).await?;
    w.write_all(b"ok").await.map_err(|e| e.to_string())
}

async fn handle_cancel(w: &mut OwnedWriteHalf, state: &RunCancelState) -> Result<(), String> {
    let flag = state
        .cancel
        .lock()
        .map_err(|_| "Agent 状态锁失败".to_string())?
        .clone();
    if let Some(flag) = flag {
        flag.store(true, Ordering::Relaxed);
        write_headers(w, "200 OK", "text/plain", &[]).await?;
        w.write_all(b"cancelled").await.map_err(|e| e.to_string())
    } else {
        write_headers(w, "409 Conflict", "text/plain", &[]).await?;
        w.write_all(b"no run in flight").await.map_err(|e| e.to_string())
    }
}

async fn handle_agent_run(
    w: &mut OwnedWriteHalf,
    body: Vec<u8>,
    config: &ServerConfig,
    state: &RunCancelState,
) -> Result<(), String> {
    let request: AgentRunRequest = serde_json::from_slice(&body)
        .map_err(|e| format!("JSON 解析失败: {e}"))?;
    let project_path = request.project_path();
    println!("[agent-server] run: project={project_path}");
    if project_path.trim().is_empty() {
        write_headers(w, "400 Bad Request", "text/plain", &[]).await?;
        return w
            .write_all(b"missing projectPath")
            .await
            .map_err(|e| e.to_string());
    }
    if !project_allowed(project_path, &config.allowed_projects) {
        write_headers(w, "403 Forbidden", "text/plain", &[]).await?;
        return w
            .write_all(b"project not allowed")
            .await
            .map_err(|e| e.to_string());
    }

    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut guard = state.cancel.lock().map_err(|_| "Agent 状态锁失败".to_string())?;
        *guard = Some(cancel_flag.clone());
    }

    write_headers(
        w,
        "200 OK",
        "text/event-stream",
        &[("Cache-Control", "no-cache"), ("X-Accel-Buffering", "no")],
    )
    .await
    .map_err(|e| {
        println!("[agent-server] write_headers err: {e}");
        e
    })?;
    println!("[agent-server] headers sent, starting run");

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Value>();
    let on_event: Arc<dyn Fn(Value) + Send + Sync> = {
        let tx = tx.clone();
        Arc::new(move |event: Value| {
            let _ = tx.send(event);
        })
    };

    println!("[agent-server] calling agent_run_headless");
    let run_result = agent_run_headless(request, on_event, cancel_flag.clone()).await;
    println!("[agent-server] agent_run_headless done: {:?}", run_result.is_err());
    if let Err(e) = &run_result {
        let _ = tx.send(json!({ "type": "error", "data": { "message": e } }));
    }
    drop(tx);

    let mut failed = false;
    while let Some(event) = rx.recv().await {
        let line = serde_json::to_string(&event).map_err(|e| e.to_string())?;
        let payload = format!("data: {line}\n\n");
        if let Err(e) = w.write_all(payload.as_bytes()).await {
            cancel_flag.store(true, Ordering::Relaxed);
            failed = true;
            return Err(format!("写 SSE 失败: {e}"));
        }
        if let Err(e) = w.flush().await {
            cancel_flag.store(true, Ordering::Relaxed);
            failed = true;
            return Err(format!("刷 SSE 失败: {e}"));
        }
    }

    if !failed {
        let _ = w.flush().await;
    }
    cancel_state_clear(state);
    Ok(())
}

async fn handle_connection(
    stream: TcpStream,
    config: &ServerConfig,
    state: Arc<RunCancelState>,
) -> Result<(), String> {
    let (read_half, mut write_half) = stream.into_split();
    let request = read_request(read_half).await?;

    if request.path == "/healthz" && request.method == "GET" {
        return handle_healthz(&mut write_half).await;
    }
    if request.path == "/api/agent/cancel" && request.method == "POST" {
        return handle_cancel(&mut write_half, &state).await;
    }
    if request.path == "/api/agent/run" && request.method == "POST" {
        if !authorized(&request.headers, config) {
            write_headers(&mut write_half, "401 Unauthorized", "text/plain", &[]).await?;
            return write_half
                .write_all(b"unauthorized")
                .await
                .map_err(|e| e.to_string());
        }
        return handle_agent_run(&mut write_half, request.body, config, &state).await;
    }
    if request.path.starts_with("/backend/vibe/")
        || request.path.starts_with("/backend/web/")
        || request.path.starts_with("/api/ai/")
    {
        if !authorized(&request.headers, config) {
            write_headers(&mut write_half, "401 Unauthorized", "text/plain", &[]).await?;
            return write_half
                .write_all(b"unauthorized")
                .await
                .map_err(|e| e.to_string());
        }
        let (path, query) = match request.path.split_once('?') {
            Some((p, qs)) => (p.to_string(), qs.to_string()),
            None => (request.path.clone(), String::new()),
        };
        let resp: HttpResponse = if path.starts_with("/backend/vibe/") {
            match handle_backend_vibe(&request.method, &path, &query, &request.body).await {
                Ok(r) => r,
                Err(e) => HttpResponse {
                    status: 400,
                    content_type: "text/plain".into(),
                    body: e.into_bytes(),
                },
            }
        } else {
            match handle_other_route(&request.method, &path, &query, &request.body).await {
                Ok(r) => r,
                Err(e) => HttpResponse {
                    status: 400,
                    content_type: "text/plain".into(),
                    body: e.into_bytes(),
                },
            }
        };
        let status_line = match resp.status {
            200 => "200 OK",
            400 => "400 Bad Request",
            401 => "401 Unauthorized",
            403 => "403 Forbidden",
            404 => "404 Not Found",
            409 => "409 Conflict",
            _ => "500 Internal Server Error",
        };
        write_headers(&mut write_half, status_line, &resp.content_type, &[]).await?;
        return write_half
            .write_all(&resp.body)
            .await
            .map_err(|e| e.to_string());
    }
    if request.method == "OPTIONS" {
        return write_headers(&mut write_half, "204 No Content", "text/plain", &[]).await;
    }
    write_headers(&mut write_half, "404 Not Found", "text/plain", &[]).await?;
    write_half
        .write_all(b"not found")
        .await
        .map_err(|e| e.to_string())
}

#[tokio::main]
async fn main() {
    let bind = read_env("AIALL_SERVER_BIND").unwrap_or_else(|| "127.0.0.1".into());
    let port: u16 = read_env("AIALL_SERVER_PORT")
        .and_then(|v| v.parse().ok())
        .unwrap_or(8787);
    let token = read_env("AIALL_SERVER_TOKEN");
    let allowed_projects: Vec<String> = read_env("AIALL_SERVER_ALLOWED_PROJECTS")
        .map(|v| {
            v.split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();
    let config = ServerConfig {
        token,
        allowed_projects,
    };
    let state = Arc::new(RunCancelState::default());

    let listener = match TcpListener::bind((bind.as_str(), port)).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[agent-server] 绑定 {bind}:{port} 失败: {e}");
            std::process::exit(1);
        }
    };
    println!("[agent-server] listening on http://{bind}:{port}");
    if config.allowed_projects.is_empty() {
        println!("[agent-server] allowed projects: (all)");
    } else {
        println!(
            "[agent-server] allowed projects: {}",
            config.allowed_projects.join(", ")
        );
    }
    if config.token.is_some() {
        println!("[agent-server] token auth: enabled");
    }

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let cfg = config.clone();
                let st = state.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_connection(stream, &cfg, st).await {
                        eprintln!("[agent-server] 连接错误: {e}");
                    }
                });
            }
            Err(e) => eprintln!("[agent-server] accept 失败: {e}"),
        }
    }
}
