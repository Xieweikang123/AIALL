use crate::ai;
use futures_util::StreamExt;
use serde_json::{json, Value};
use tauri::ipc::Channel;

fn stream_delta_text(parsed: &Value) -> Option<String> {
    let content = parsed.pointer("/choices/0/delta/content")?;
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }
    if let Some(parts) = content.as_array() {
        let mut out = String::new();
        for part in parts {
            if let Some(text) = part.as_str() {
                out.push_str(text);
            } else if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
                out.push_str(text);
            }
        }
        if !out.is_empty() {
            return Some(out);
        }
    }
    parsed
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

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

    let resp =
        match ai::chat_completion_stream_raw(&endpoint, api_key.as_deref(), stream_body).await {
            Ok(r) => r,
            Err(error) => return json!({ "ok": false, "error": error }),
        };

    let status = resp.status().as_u16();
    let mut byte_stream = resp.bytes_stream();
    let mut sse_buffer: Vec<u8> = Vec::new();
    let mut full_text = String::new();

    while let Some(chunk) = byte_stream.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(error) => {
                return json!({ "ok": false, "error": error.to_string(), "status": status })
            }
        };
        sse_buffer.extend_from_slice(&chunk);

        while let Some(pos) = sse_buffer.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = sse_buffer.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line_bytes).trim().to_string();
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
            if let Some(delta) = stream_delta_text(&parsed).filter(|s| !s.is_empty()) {
                full_text.push_str(&delta);
                let _ = on_chunk.send(delta);
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

/// TTS 请求结果：`audio` 为原始音频字节（非 base64），供 HTTP 服务端直接返回二进制。
pub struct TtsAudioResult {
    pub ok: bool,
    pub mime: Option<String>,
    pub audio: Option<Vec<u8>>,
    pub error: Option<String>,
}

/// 非流式 TTS 底层实现（桌面 `ai_tts` 与 HTTP `/backend/ai/tts` 共用）。
pub async fn ai_tts_impl(endpoint: &str, api_key: Option<&str>, body: &Value) -> TtsAudioResult {
    let model = body.get("model").and_then(|v| v.as_str()).unwrap_or("");
    let input = body.get("input").and_then(|v| v.as_str()).unwrap_or("");
    let voice = body.get("voice").and_then(|v| v.as_str()).unwrap_or("");
    let format = body.get("format").and_then(|v| v.as_str());

    if model.is_empty() || input.is_empty() || voice.is_empty() {
        return TtsAudioResult {
            ok: false,
            mime: None,
            audio: None,
            error: Some("请求参数不完整".into()),
        };
    }

    let use_mimo_tts = model.to_lowercase().contains("tts")
        && (model.contains("mimo") || model.to_lowercase().contains("mimo"));

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return TtsAudioResult {
                ok: false,
                mime: None,
                audio: None,
                error: Some(format!("创建 HTTP 客户端失败: {e}")),
            }
        }
    };

    if use_mimo_tts {
        let chat_endpoint = ai::resolve_chat_endpoint(endpoint);
        let mut req = client.post(&chat_endpoint).json(&json!({
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
            Err(e) => {
                return TtsAudioResult {
                    ok: false,
                    mime: None,
                    audio: None,
                    error: Some(format!("TTS 请求失败: {e}")),
                }
            }
        };
        let status = resp.status();
        let text = match resp.text().await {
            Ok(t) => t,
            Err(e) => {
                return TtsAudioResult {
                    ok: false,
                    mime: None,
                    audio: None,
                    error: Some(format!("读取响应失败: {e}")),
                }
            }
        };
        if !status.is_success() {
            return TtsAudioResult {
                ok: false,
                mime: None,
                audio: None,
                error: Some(format!("HTTP {status}: {text}")),
            };
        }
        if let Ok(parsed) = serde_json::from_str::<Value>(&text) {
            if let Some(audio_data) = parsed["choices"][0]["message"]["audio"]["data"].as_str() {
                if !audio_data.is_empty() {
                    let mime = tts_format_to_mime(format);
                    let bytes = base64::Engine::decode(
                        &base64::engine::general_purpose::STANDARD,
                        audio_data,
                    )
                    .unwrap_or_default();
                    return TtsAudioResult {
                        ok: true,
                        mime: Some(mime.to_string()),
                        audio: Some(bytes),
                        error: None,
                    };
                }
            }
        }
        return TtsAudioResult {
            ok: false,
            mime: None,
            audio: None,
            error: Some("TTS 响应中未找到音频数据".into()),
        };
    }

    let speech_endpoint = resolve_speech_endpoint(endpoint);
    let mut req = client.post(&speech_endpoint).json(&json!({
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
                Err(e) => {
                    return TtsAudioResult {
                        ok: false,
                        mime: None,
                        audio: None,
                        error: Some(format!("读取音频数据失败: {e}")),
                    }
                }
            };
            TtsAudioResult {
                ok: status.is_success(),
                mime: Some(mime),
                audio: Some(bytes.to_vec()),
                error: None,
            }
        }
        Err(e) => TtsAudioResult {
            ok: false,
            mime: None,
            audio: None,
            error: Some(format!("TTS 请求失败: {e}")),
        },
    }
}

#[tauri::command]
pub async fn ai_tts(endpoint: String, api_key: Option<String>, body: Value) -> Value {
    let result = ai_tts_impl(&endpoint, api_key.as_deref(), &body).await;
    match (result.ok, result.audio) {
        (true, Some(bytes)) => {
            let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
            json!({ "ok": true, "mime": result.mime.unwrap_or_else(|| "audio/mpeg".into()), "data": b64 })
        }
        (true, None) => json!({ "ok": false, "error": "TTS 响应为空" }),
        (false, _) => json!({ "ok": false, "error": result.error.unwrap_or_else(|| "TTS 请求失败".into()) }),
    }
}
