//! Headless desktop Agent smoke — drives `app_lib::agent::agent_run_headless`.
//!
//! Usage (from repo root via npm, or):
//!   cd src-tauri && cargo run --bin agent-smoke -- --prompt "..."
//!
//! Env: AIALL_ENDPOINT, AIALL_API_KEY, AIALL_MODEL, AIALL_PROJECT, AIALL_TIMEOUT_MS

use app_lib::agent::{agent_run_headless, AgentRunRequest};
use base64::Engine;
use serde_json::Value;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Default)]
struct SmokeOptions {
  prompt: Option<String>,
  session_id: Option<String>,
  project_root: Option<String>,
  mode: Option<String>,
  max_turns: Option<u32>,
  timeout_ms: Option<u64>,
  no_image: bool,
  help: bool,
}

#[derive(Default)]
struct SmokeState {
  tool_sigs: Vec<String>,
  duplicate_tools: u32,
  last_assistant: String,
  turns: u32,
  failed: bool,
  error_message: String,
  timed_out: bool,
}

fn print_help() {
  println!(
    "agent-smoke — desktop Agent (Rust / src-tauri). See AGENT_SSOT.md

Options:
  --prompt <text>       User message (required unless --session)
  --session <id>        Replay last user turn from AppData session JSON
  --no-image            Skip attached images when replaying a session
  --project <path>      Project root (default: cwd or AIALL_PROJECT)
  --mode ask|build|plan|explore Default: build
  --max-turns <n>       Default: 6
  --timeout <ms>        Abort after N ms (default: 180000)

Env: AIALL_ENDPOINT, AIALL_API_KEY, AIALL_MODEL, AIALL_PROJECT, AIALL_TIMEOUT_MS

Examples:
  npm run agent:smoke -- --prompt \"hello\"
  npm run agent:smoke -- --session 1782207555782-50f5d22bae53a8 --no-image
"
  );
}

fn parse_args(argv: &[String]) -> SmokeOptions {
  let mut out = SmokeOptions::default();
  let mut i = 0usize;
  while i < argv.len() {
    let arg = argv[i].as_str();
    if arg == "--help" || arg == "-h" {
      out.help = true;
      i += 1;
      continue;
    }
    if arg == "--no-image" {
      out.no_image = true;
      i += 1;
      continue;
    }
    let next = argv.get(i + 1).map(|s| s.as_str());
    match (arg, next) {
      ("--prompt", Some(v)) => {
        out.prompt = Some(v.to_string());
        i += 2;
      }
      ("--session", Some(v)) => {
        out.session_id = Some(v.to_string());
        i += 2;
      }
      ("--project", Some(v)) => {
        out.project_root = Some(v.to_string());
        i += 2;
      }
      ("--mode", Some(v)) => {
        out.mode = Some(v.to_string());
        i += 2;
      }
      ("--max-turns", Some(v)) => {
        out.max_turns = v.parse().ok();
        i += 2;
      }
      ("--timeout", Some(v)) => {
        out.timeout_ms = v.parse().ok();
        i += 2;
      }
      _ => {
        eprintln!("[agent-smoke] unknown arg: {arg}");
        i += 1;
      }
    }
  }
  out
}

fn sessions_dir() -> PathBuf {
  if let Ok(appdata) = env::var("APPDATA") {
    return PathBuf::from(appdata).join("aiall").join("vibe-chat-sessions");
  }
  env::var("HOME")
    .or_else(|_| env::var("USERPROFILE"))
    .map(|h| PathBuf::from(h).join(".config").join("aiall").join("vibe-chat-sessions"))
    .unwrap_or_else(|_| PathBuf::from(".").join("aiall").join("vibe-chat-sessions"))
}

fn safe_session_id(id: &str) -> String {
  id.chars()
    .map(|c| {
      if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
        c
      } else {
        '_'
      }
    })
    .collect()
}

fn load_session_user_turn(
  session_id: &str,
  no_image: bool,
) -> Result<(String, Option<Vec<String>>, Option<String>), String> {
  let file = sessions_dir().join(format!("chat-{}.json", safe_session_id(session_id)));
  if !file.exists() {
    return Err(format!("Session file not found: {}", file.display()));
  }
  let parsed: Value = serde_json::from_str(
    &fs::read_to_string(&file).map_err(|e| e.to_string())?,
  )
  .map_err(|e| e.to_string())?;
  let messages = parsed
    .get("messages")
    .and_then(|m| m.as_array())
    .cloned()
    .unwrap_or_default();

  for m in messages.iter().rev() {
    if m.get("role").and_then(|r| r.as_str()) != Some("user") {
      continue;
    }
    let prompt = m
      .get("content")
      .and_then(|c| c.as_str())
      .unwrap_or("")
      .trim()
      .to_string();
    let chat_mode = m
      .get("chatMode")
      .and_then(|c| c.as_str())
      .map(|s| s.to_string());
    let mut image_data_urls: Option<Vec<String>> = None;
    if !no_image {
      if let Some(urls) = m.get("imageDataUrls").and_then(|u| u.as_array()) {
        let loaded: Vec<String> = urls
          .iter()
          .filter_map(|u| u.as_str())
          .filter(|u| u.starts_with("data:image/"))
          .map(|s| s.to_string())
          .collect();
        if !loaded.is_empty() {
          image_data_urls = Some(loaded);
        }
      } else if let Some(refs) = m.get("imageRefs").and_then(|r| r.as_array()) {
        let mut loaded = Vec::new();
        for r in refs {
          let rel = r.get("path").and_then(|p| p.as_str()).unwrap_or("");
          if rel.is_empty() {
            continue;
          }
          let img_path = sessions_dir().join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
          if !img_path.exists() {
            continue;
          }
          let buf = fs::read(&img_path).map_err(|e| e.to_string())?;
          let ext = img_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("png")
            .to_lowercase();
          let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
          loaded.push(format!("data:image/{ext};base64,{b64}"));
        }
        if !loaded.is_empty() {
          image_data_urls = Some(loaded);
        }
      }
    }
    return Ok((prompt, image_data_urls, chat_mode));
  }
  Err(format!("No user message in session {session_id}"))
}

fn tool_signature(name: &str, args: &Value) -> String {
  let path = args.get("path").and_then(|p| p.as_str()).unwrap_or("");
  let pattern = args.get("pattern").and_then(|p| p.as_str()).unwrap_or("");
  format!("{name}:{path}:{pattern}")
}

fn handle_event(state: &Mutex<SmokeState>, event: &Value) {
  let ty = event.get("type").and_then(|t| t.as_str()).unwrap_or("");
  let data = event.get("data").cloned().unwrap_or(Value::Null);
  let mut s = state.lock().expect("smoke state");
  match ty {
    "status" => {
      let phase = data.get("phase").and_then(|p| p.as_str()).unwrap_or("?");
      let turn = data
        .get("turn")
        .and_then(|t| t.as_u64())
        .map(|t| {
          let max = data
            .get("maxTurns")
            .and_then(|m| m.as_u64())
            .map(|m| m.to_string())
            .unwrap_or_else(|| "?".into());
          format!(" turn {t}/{max}")
        })
        .unwrap_or_default();
      let detail = data
        .get("detail")
        .and_then(|d| d.as_str())
        .map(|d| format!(" · {d}"))
        .unwrap_or_default();
      println!("[status] {phase}{turn}{detail}");
    }
    "tool_start" => {
      let name = data.get("name").and_then(|n| n.as_str()).unwrap_or("?");
      let args = data.get("args").cloned().unwrap_or(Value::Null);
      let sig = tool_signature(name, &args);
      if s.tool_sigs.iter().any(|x| x == &sig) {
        s.duplicate_tools += 1;
      }
      s.tool_sigs.push(sig);
      let args_preview = serde_json::to_string(&args).unwrap_or_default();
      let preview: String = args_preview.chars().take(120).collect();
      println!("[tool] {name} {preview}");
    }
    "tool_end" => {
      let name = data.get("name").and_then(|n| n.as_str()).unwrap_or("?");
      let ok = data.get("ok").and_then(|o| o.as_bool()).unwrap_or(false);
      let summary = data.get("summary").and_then(|x| x.as_str()).unwrap_or("");
      let preview: String = summary.chars().take(100).collect();
      println!(
        "[tool-end] {name} {}: {preview}",
        if ok { "ok" } else { "FAIL" }
      );
    }
    "message" => {
      if let Some(text) = data.get("text").and_then(|t| t.as_str()) {
        s.last_assistant = text.to_string();
      }
    }
    "error" => {
      s.failed = true;
      s.error_message = data
        .get("message")
        .and_then(|m| m.as_str())
        .unwrap_or("unknown error")
        .to_string();
      eprintln!("[error] {}", s.error_message);
    }
    "done" => {
      s.turns = data.get("turns").and_then(|t| t.as_u64()).unwrap_or(0) as u32;
    }
    _ => {}
  }
}

#[tokio::main]
async fn main() -> ExitCode {
  let argv: Vec<String> = env::args().skip(1).collect();
  let raw = parse_args(&argv);
  if raw.help {
    print_help();
    return ExitCode::SUCCESS;
  }

  let endpoint = env::var("AIALL_ENDPOINT").unwrap_or_default().trim().to_string();
  let api_key = {
    let k = env::var("AIALL_API_KEY").unwrap_or_default().trim().to_string();
    if k.is_empty() {
      None
    } else {
      Some(k)
    }
  };
  let model = env::var("AIALL_MODEL").unwrap_or_default().trim().to_string();
  if endpoint.is_empty() || model.is_empty() {
    eprintln!(
      "Missing AIALL_ENDPOINT / AIALL_MODEL. Set env vars or copy from AI 配置页 (ai-config)."
    );
    return ExitCode::from(1);
  }

  let mut prompt = raw.prompt.unwrap_or_default().trim().to_string();
  let mut image_data_urls: Option<Vec<String>> = None;
  let mut mode = raw.mode.unwrap_or_else(|| "build".into());

  if let Some(session_id) = &raw.session_id {
    match load_session_user_turn(session_id, raw.no_image) {
      Ok((p, imgs, chat_mode)) => {
        if prompt.is_empty() {
          prompt = p;
        }
        if !raw.no_image {
          image_data_urls = imgs;
        }
        if let Some(cm) = chat_mode {
          mode = cm;
        }
      }
      Err(e) => {
        eprintln!("[agent-smoke] {e}");
        return ExitCode::from(1);
      }
    }
  }

  if prompt.is_empty() && image_data_urls.as_ref().map(|v| v.is_empty()).unwrap_or(true) {
    eprintln!("Provide --prompt or --session with a user message.");
    return ExitCode::from(1);
  }

  let project_root = raw
    .project_root
    .or_else(|| env::var("AIALL_PROJECT").ok())
    .unwrap_or_else(|| {
      env::current_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| ".".into())
    });
  let project_root = Path::new(&project_root)
    .canonicalize()
    .map(|p| p.to_string_lossy().into_owned())
    .unwrap_or(project_root);

  let max_turns = raw.max_turns.filter(|n| *n > 0).unwrap_or(6);
  let timeout_ms = raw
    .timeout_ms
    .filter(|n| *n > 0)
    .or_else(|| {
      env::var("AIALL_TIMEOUT_MS")
        .ok()
        .and_then(|s| s.parse().ok())
        .filter(|n: &u64| *n > 0)
    })
    .unwrap_or(180_000);

  println!("[agent-smoke] backend: rust (src-tauri)");
  println!("[agent-smoke] project: {project_root}");
  println!("[agent-smoke] model: {model}");
  println!(
    "[agent-smoke] prompt: {}",
    if prompt.is_empty() {
      "(image only)"
    } else {
      &prompt
    }
  );
  if let Some(sid) = &raw.session_id {
    println!("[agent-smoke] session: {sid}");
  }
  if let Some(imgs) = &image_data_urls {
    println!("[agent-smoke] images: {}", imgs.len());
  }
  println!("[agent-smoke] maxTurns: {max_turns} timeout: {timeout_ms} ms");
  println!("---");

  let state = Arc::new(Mutex::new(SmokeState::default()));
  let cancel = Arc::new(AtomicBool::new(false));
  {
    let cancel = cancel.clone();
    let state = state.clone();
    tokio::spawn(async move {
      tokio::time::sleep(Duration::from_millis(timeout_ms)).await;
      eprintln!("\n[agent-smoke] TIMEOUT — aborting");
      if let Ok(mut s) = state.lock() {
        s.timed_out = true;
      }
      cancel.store(true, Ordering::Relaxed);
    });
  }

  let state_for_cb = state.clone();
  let on_event: Arc<dyn Fn(Value) + Send + Sync> = Arc::new(move |event: Value| {
    handle_event(&state_for_cb, &event);
  });

  let request = AgentRunRequest::for_smoke(
    project_root,
    prompt,
    endpoint,
    api_key,
    model,
    Some(mode),
    Some(max_turns),
    image_data_urls,
  );

  if let Err(e) = agent_run_headless(request, on_event, cancel.clone()).await {
    if let Ok(mut s) = state.lock() {
      s.failed = true;
      if s.error_message.is_empty() {
        s.error_message = e.clone();
      }
    }
    eprintln!("[agent-smoke] exception: {e}");
  }

  let s = state.lock().expect("smoke state");
  println!("---");
  println!("[agent-smoke] turns: {}", s.turns);
  println!(
    "[agent-smoke] tools: {} duplicate: {}",
    s.tool_sigs.len(),
    s.duplicate_tools
  );
  let preview: String = s.last_assistant.trim().chars().take(400).collect();
  println!(
    "[agent-smoke] answer preview: {}",
    if preview.is_empty() {
      "(empty)"
    } else {
      &preview
    }
  );

  let answer_empty = s.last_assistant.trim().is_empty();
  if s.timed_out && answer_empty {
    eprintln!("[agent-smoke] FAIL: timeout with empty answer");
    return ExitCode::from(2);
  }
  if s.duplicate_tools >= 2 {
    eprintln!("[agent-smoke] FAIL: repeated identical tool calls (explore loop)");
    return ExitCode::from(3);
  }
  if s.failed && answer_empty {
    eprintln!("[agent-smoke] FAIL: {}", s.error_message);
    return ExitCode::from(1);
  }
  if answer_empty {
    eprintln!("[agent-smoke] FAIL: no assistant text");
    return ExitCode::from(1);
  }
  println!("[agent-smoke] OK");
  ExitCode::SUCCESS
}
