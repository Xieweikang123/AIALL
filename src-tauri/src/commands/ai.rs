use crate::ai;
use futures_util::StreamExt;
use serde_json::{json, Value};
use tauri::ipc::Channel;

#[tauri::command]
pub async fn ai_test(endpoint: String, api_key: Option<String>, body: Value) -> Value {
  match ai::chat_completion(&endpoint, api_key.as_deref(), body).await {
    Ok(data) => json!({ "ok": true, "data": data }),
    Err(error) => json!({ "ok": false, "error": error }),
  }
}

#[tauri::command]
pub async fn ai_test_stream(
  endpoint: String,
  api_key: Option<String>,
  body: Value,
  on_chunk: Channel<String>,
) -> Value {
  let mut stream_body = body;
  if let Some(obj) = stream_body.as_object_mut() {
    obj.insert("stream".into(), json!(true));
  }

  let resp = match ai::chat_completion_stream_raw(&endpoint, api_key.as_deref(), stream_body).await {
    Ok(r) => r,
    Err(error) => return json!({ "ok": false, "error": error }),
  };

  let status = resp.status().as_u16();
  let mut byte_stream = resp.bytes_stream();
  let mut sse_buffer = String::new();
  let mut full_text = String::new();

  while let Some(chunk) = byte_stream.next().await {
    let chunk = match chunk {
      Ok(c) => c,
      Err(error) => return json!({ "ok": false, "error": error.to_string(), "status": status }),
    };
    sse_buffer.push_str(&String::from_utf8_lossy(&chunk));

    loop {
      let Some(pos) = sse_buffer.find('\n') else {
        break;
      };
      let line = sse_buffer[..pos].trim().to_string();
      sse_buffer = sse_buffer[pos + 1..].to_string();
      if !line.starts_with("data:") {
        continue;
      }
      let data_str = line.strip_prefix("data:").unwrap_or("").trim();
      if data_str.is_empty() || data_str == "[DONE]" {
        continue;
      }
      let Ok(parsed) = serde_json::from_str::<Value>(data_str) else {
        continue;
      };
      let content = parsed["choices"][0]["delta"]["content"]
        .as_str()
        .or_else(|| parsed["choices"][0]["message"]["content"].as_str());
      if let Some(delta) = content.filter(|s| !s.is_empty()) {
        full_text.push_str(delta);
        let _ = on_chunk.send(delta.to_string());
      }
    }
  }

  json!({ "ok": true, "status": status, "rawText": full_text })
}

#[tauri::command]
pub async fn ai_models(endpoint: String, api_key: Option<String>) -> Value {
  match ai::fetch_models(&endpoint, api_key.as_deref()).await {
    Ok(data) => json!({ "ok": true, "data": data }),
    Err(error) => json!({ "ok": false, "error": error }),
  }
}

fn tts_format_to_mime(format: Option<&str>) -> &'static str {
  match format {
    Some("wav") => "audio/wav",
    Some("opus") => "audio/opus",
    _ => "audio/mpeg",
  }
}

fn resolve_speech_endpoint(endpoint: &str) -> String {
  let input = endpoint.trim();
  if input.is_empty() {
    return input.to_string();
  }
  if input.ends_with("/audio/speech") {
    return input.to_string();
  }
  if input.ends_with("/chat/completions") {
    return input.replace("/chat/completions", "/audio/speech");
  }
  format!("{}/audio/speech", input.trim_end_matches('/'))
}

#[tauri::command]
pub async fn ai_tts(endpoint: String, api_key: Option<String>, body: Value) -> Value {
  let model = body.get("model").and_then(|v| v.as_str()).unwrap_or("");
  let input = body.get("input").and_then(|v| v.as_str()).unwrap_or("");
  let voice = body.get("voice").and_then(|v| v.as_str()).unwrap_or("");
  let format = body.get("format").and_then(|v| v.as_str());

  if model.is_empty() || input.is_empty() || voice.is_empty() {
    return json!({ "ok": false, "error": "请求参数不完整" });
  }

  let use_mimo_tts = model.to_lowercase().contains("tts") && (model.contains("mimo") || model.to_lowercase().contains("mimo"));

  let client = match reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(120))
    .build()
  {
    Ok(c) => c,
    Err(e) => return json!({ "ok": false, "error": format!("创建 HTTP 客户端失败: {e}") }),
  };

  if use_mimo_tts {
    let chat_endpoint = ai::resolve_chat_endpoint(&endpoint);
    let mut req = client
      .post(&chat_endpoint)
      .json(&json!({
        "model": model,
        "messages": [
          { "role": "user", "content": "" },
          { "role": "assistant", "content": input }
        ],
        "audio": {
          "format": format.unwrap_or("mp3"),
          "voice": voice,
        }
      }));
    if let Some(key) = api_key.filter(|k| !k.is_empty()) {
      req = req.bearer_auth(key);
    }
    let resp = match req.send().await {
      Ok(r) => r,
      Err(e) => return json!({ "ok": false, "error": format!("TTS 请求失败: {e}") }),
    };
    let status = resp.status();
    let text = match resp.text().await {
      Ok(t) => t,
      Err(e) => return json!({ "ok": false, "error": format!("读取响应失败: {e}") }),
    };
    if !status.is_success() {
      return json!({ "ok": false, "error": format!("HTTP {status}: {text}") });
    }
    if let Ok(parsed) = serde_json::from_str::<Value>(&text) {
      if let Some(audio_data) = parsed["choices"][0]["message"]["audio"]["data"].as_str() {
        if !audio_data.is_empty() {
          let mime = tts_format_to_mime(format);
          return json!({ "ok": true, "mime": mime, "data": audio_data });
        }
      }
    }
    return json!({ "ok": false, "error": "TTS 响应中未找到音频数据" });
  }

  let speech_endpoint = resolve_speech_endpoint(&endpoint);
  let mut req = client
    .post(&speech_endpoint)
    .json(&json!({
      "model": model,
      "input": input,
      "voice": voice,
      "format": format.unwrap_or("mp3"),
    }));
  if let Some(key) = api_key.filter(|k| !k.is_empty()) {
    req = req.bearer_auth(key);
  }
  match req.send().await {
    Ok(resp) => {
      let status = resp.status();
      let mime = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or(tts_format_to_mime(format))
        .to_string();
      let bytes = match resp.bytes().await {
        Ok(b) => b,
        Err(e) => return json!({ "ok": false, "error": format!("读取音频数据失败: {e}") }),
      };
      let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
      json!({ "ok": status.is_success(), "mime": mime, "data": b64, "status": status.as_u16() })
    }
    Err(e) => json!({ "ok": false, "error": format!("TTS 请求失败: {e}") }),
  }
}
