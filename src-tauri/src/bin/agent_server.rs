//! Headless Agent HTTP server — Web/remote access to the desktop Agent.
//!
//! Reuses `app_lib::agent::agent_run_headless` (the same loop as the Tauri desktop
//! app), so Agent behavior has a single source of truth in Rust (see AGENT_SSOT.md).
//!
//! Endpoints:
//!   GET  /healthz                → 200 text/plain "ok" (anonymous)
//!   POST /api/server/login       → exchange AIALL_SERVER_TOKEN for a session token
//!   POST /api/server/logout      → revoke session token
//!   GET  /api/server/ai-config   → server AI config (endpoint/model/proxy, NO key)
//!   POST /api/agent/run          → SSE stream of VibeAgentEvent JSON
//!   POST /api/agent/cancel       → cancel the in-flight run
//!   /backend/vibe/*, /backend/web/*, /backend/ai/*, /backend/automation/* → HTTP fallback routes
//!
//! Env:
//!   AIALL_SERVER_BIND             default 127.0.0.1
//!   AIALL_SERVER_PORT             default 8787
//!   AIALL_SERVER_TOKEN            required for auth (`Authorization: Bearer <token>` or login)
//!   AIALL_SERVER_ALLOWED_PROJECTS comma-separated allowed project roots (empty = allow all)
//!   AIALL_SERVER_AI_ENDPOINT/KEY/MODEL/PROXY  server-side AI config (key never sent to browser)
//!   AIALL_SERVER_RESTRICT_COMMANDS=1          whitelist Agent run_command in server mode

use app_lib::agent::{agent_run_headless, AgentRunRequest};
use app_lib::http_routes::{
    handle_backend_vibe, handle_other_route, project_allowed, HttpResponse, ServerAiConfig,
};
use rand::RngCore;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{tcp::OwnedWriteHalf, TcpListener, TcpStream};

#[derive(Default)]
struct RunCancelState {
    cancel: Mutex<Option<Arc<AtomicBool>>>,
}

/// 登录会话：token → 过期时刻。
#[derive(Default)]
struct SessionStore {
    sessions: Mutex<HashMap<String, Instant>>,
}

const SESSION_TTL: Duration = Duration::from_secs(12 * 3600);

impl SessionStore {
    fn issue(&self) -> String {
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        let token = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
        let mut guard = self.sessions.lock().unwrap();
        guard.retain(|_, exp| *exp > Instant::now());
        guard.insert(token.clone(), Instant::now() + SESSION_TTL);
        token
    }

    fn valid(&self, token: &str) -> bool {
        let mut guard = self.sessions.lock().unwrap();
        guard.retain(|_, exp| *exp > Instant::now());
        guard.contains_key(token)
    }

    fn revoke(&self, token: &str) {
        if let Ok(mut guard) = self.sessions.lock() {
            guard.remove(token);
        }
    }
}

#[derive(Clone)]
struct ServerConfig {
    token: Option<String>,
    allowed_projects: Vec<String>,
    ai: Option<ServerAiConfig>,
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

/// 认证：静态 `AIALL_SERVER_TOKEN`（Bearer）或登录会话 token 任一中即可。
/// 未配置任何凭证时（本地开发）默认放行。
fn authorized(
    headers: &[(String, String)],
    config: &ServerConfig,
    sessions: &SessionStore,
) -> bool {
    let Some(token) = &config.token else {
        return true;
    };
    let bearer = format!("Bearer {token}");
    let static_ok = header_value(headers, "authorization")
        .map(|v| v.trim() == bearer)
        .unwrap_or(false)
        || header_value(headers, "x-aiall-token")
            .map(|v| v.trim() == token)
            .unwrap_or(false);
    if static_ok {
        return true;
    }
    if let Some(bearer) = header_value(headers, "authorization") {
        if let Some(session) = bearer.trim().strip_prefix("Bearer ") {
            if sessions.valid(session) {
                return true;
            }
        }
    }
    if let Some(session) = header_value(headers, "x-aiall-token") {
        if sessions.valid(session.trim()) {
            return true;
        }
    }
    false
}

/// 读取服务端 AI 配置：优先环境变量，回退 `~/.config/aiall/server-config.json`。
fn load_server_ai_config() -> Option<ServerAiConfig> {
    let read_env = |k: &str| {
        std::env::var(k)
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    };
    let env_endpoint = read_env("AIALL_SERVER_AI_ENDPOINT");
    let env_key = read_env("AIALL_SERVER_AI_KEY");
    if let (Some(endpoint), Some(api_key)) = (env_endpoint, env_key) {
        return Some(ServerAiConfig {
            endpoint,
            api_key,
            model: read_env("AIALL_SERVER_AI_MODEL").unwrap_or_default(),
            web_proxy_url: read_env("AIALL_SERVER_AI_PROXY"),
        });
    }
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).ok()?;
    let cfg_path = std::path::Path::new(&home)
        .join(".config")
        .join("aiall")
        .join("server-config.json");
    let text = std::fs::read_to_string(cfg_path).ok()?;
    let parsed: Value = serde_json::from_str(&text).ok()?;
    let endpoint = parsed.get("endpoint").and_then(|v| v.as_str()).unwrap_or("");
    let api_key = parsed.get("apiKey").and_then(|v| v.as_str()).unwrap_or("");
    if endpoint.trim().is_empty() || api_key.trim().is_empty() {
        return None;
    }
    Some(ServerAiConfig {
        endpoint: endpoint.trim().to_string(),
        api_key: api_key.trim().to_string(),
        model: parsed
            .get("model")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string(),
        web_proxy_url: parsed
            .get("webProxyUrl")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.trim().to_string()),
    })
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
    let mut request: AgentRunRequest = serde_json::from_slice(&body)
        .map_err(|e| format!("JSON 解析失败: {e}"))?;
    // 服务端模式：浏览器不传明文 key / endpoint / model 时，用服务端配置补齐。
    if let Some(ai) = &config.ai {
        request.apply_server_ai(
            &ai.endpoint,
            Some(&ai.api_key),
            &ai.model,
            ai.web_proxy_url.as_deref(),
        );
    }
    let project_path = request.project_path().to_string();
    println!("[agent-server] run: project={project_path}");
    if project_path.trim().is_empty() {
        write_headers(w, "400 Bad Request", "text/plain", &[]).await?;
        return w
            .write_all(b"missing projectPath")
            .await
            .map_err(|e| e.to_string());
    }
    if !project_allowed(&project_path, &config.allowed_projects) {
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

async fn handle_login(
    w: &mut OwnedWriteHalf,
    body: Vec<u8>,
    config: &ServerConfig,
    sessions: &SessionStore,
) -> Result<(), String> {
    let parsed: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => Value::Null,
    };
    let password = parsed
        .get("password")
        .or_else(|| parsed.get("token"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let token_matches = config
        .token
        .as_deref()
        .map(|t| t == password)
        .unwrap_or(false);
    if !token_matches {
        write_headers(w, "401 Unauthorized", "text/plain", &[]).await?;
        return w
            .write_all(b"invalid credentials")
            .await
            .map_err(|e| e.to_string());
    }
    let session = sessions.issue();
    let expires_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        + SESSION_TTL.as_secs();
    let payload = serde_json::to_string(&json!({
        "ok": true,
        "token": session,
        "expiresAt": expires_at,
        "ttlSeconds": SESSION_TTL.as_secs(),
    }))
    .unwrap_or_else(|_| "{}".into());
    write_headers(w, "200 OK", "application/json", &[]).await?;
    w.write_all(payload.as_bytes()).await.map_err(|e| e.to_string())
}

async fn handle_logout(
    w: &mut OwnedWriteHalf,
    headers: &[(String, String)],
    sessions: &SessionStore,
) -> Result<(), String> {
    let session = header_value(headers, "authorization")
        .and_then(|v| v.trim().strip_prefix("Bearer "))
        .map(|s| s.to_string())
        .or_else(|| header_value(headers, "x-aiall-token").map(|s| s.trim().to_string()));
    if let Some(token) = session {
        sessions.revoke(&token);
    }
    write_headers(w, "200 OK", "text/plain", &[]).await?;
    w.write_all(b"logged out").await.map_err(|e| e.to_string())
}

async fn handle_connection(
    stream: TcpStream,
    config: &ServerConfig,
    state: Arc<RunCancelState>,
    sessions: Arc<SessionStore>,
) -> Result<(), String> {
    let (read_half, mut write_half) = stream.into_split();
    let request = read_request(read_half).await?;

    if request.path == "/healthz" && request.method == "GET" {
        return handle_healthz(&mut write_half).await;
    }
    if request.path == "/api/server/login" && request.method == "POST" {
        return handle_login(&mut write_half, request.body, config, &sessions).await;
    }
    if request.path == "/api/server/logout" && request.method == "POST" {
        return handle_logout(&mut write_half, &request.headers, &sessions).await;
    }
    if request.path == "/api/agent/cancel" && request.method == "POST" {
        if !authorized(&request.headers, config, &sessions) {
            return write_unauthorized(&mut write_half).await;
        }
        return handle_cancel(&mut write_half, &state).await;
    }
    if request.path == "/api/agent/run" && request.method == "POST" {
        if !authorized(&request.headers, config, &sessions) {
            return write_unauthorized(&mut write_half).await;
        }
        return handle_agent_run(&mut write_half, request.body, config, &state).await;
    }
    if request.path.starts_with("/backend/vibe/")
        || request.path.starts_with("/backend/web/")
        || request.path.starts_with("/backend/ai/")
        || request.path.starts_with("/backend/automation/")
        || request.path.starts_with("/api/server/")
    {
        if !authorized(&request.headers, config, &sessions) {
            return write_unauthorized(&mut write_half).await;
        }
        let (path, query) = match request.path.split_once('?') {
            Some((p, qs)) => (p.to_string(), qs.to_string()),
            None => (request.path.clone(), String::new()),
        };
        let resp: HttpResponse = if path.starts_with("/backend/vibe/") {
            match handle_backend_vibe(
                &request.method,
                &path,
                &query,
                &request.body,
                &config.allowed_projects,
                config.ai.as_ref(),
            )
            .await
            {
                Ok(r) => r,
                Err(e) => HttpResponse {
                    status: 400,
                    content_type: "text/plain".into(),
                    body: e.into_bytes(),
                },
            }
        } else {
            match handle_other_route(
                &request.method,
                &path,
                &query,
                &request.body,
                &config.allowed_projects,
                config.ai.as_ref(),
            )
            .await
            {
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

async fn write_unauthorized(w: &mut OwnedWriteHalf) -> Result<(), String> {
    write_headers(w, "401 Unauthorized", "text/plain", &[]).await?;
    w.write_all(b"unauthorized").await.map_err(|e| e.to_string())
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
    let ai = load_server_ai_config();
    let config = ServerConfig {
        token,
        allowed_projects,
        ai,
    };
    let state = Arc::new(RunCancelState::default());
    let sessions = Arc::new(SessionStore::default());

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
        println!("[agent-server] token auth: enabled (POST /api/server/login)");
    }
    if config.ai.is_some() {
        println!("[agent-server] server AI config: loaded (endpoint/model from server)");
    }

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let cfg = config.clone();
                let st = state.clone();
                let ss = sessions.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_connection(stream, &cfg, st, ss).await {
                        eprintln!("[agent-server] 连接错误: {e}");
                    }
                });
            }
            Err(e) => eprintln!("[agent-server] accept 失败: {e}"),
        }
    }
}
