use crate::web_fetch;
use serde_json::{json, Value};

#[tauri::command]
pub async fn web_extract(
    url: String,
    mode: Option<String>,
    limit: Option<u32>,
    proxy_url: Option<String>,
) -> Value {
    let limit = limit.unwrap_or(15).min(50).max(1);
    let proxy = proxy_url.as_deref();
    let mode_str = mode.as_deref().unwrap_or("auto");

    if mode_str == "discourse_latest" || mode_str == "auto" {
        let discourse = fetch_discourse_latest(&url, limit).await;
        if discourse.get("ok").and_then(|v| v.as_bool()) == Some(true) {
            return discourse;
        }
        if mode_str == "discourse_latest" {
            return discourse;
        }
    }

    match web_fetch::web_extract_structured(&url, mode_str, proxy).await {
        Ok((status, kind, text, title, raw_text)) => {
            let snippet: String = text.chars().take(12_000).collect();
            let mut out = json!({
              "ok": status < 400,
              "status": status,
              "url": url,
              "mode": kind,
              "kind": kind,
              "text": snippet,
              "content": snippet,
            });
            if let Some(t) = title.filter(|s| !s.is_empty()) {
                out["title"] = json!(t);
            }
            if let Some(raw) = raw_text {
                let raw_snip: String = raw.chars().take(12_000).collect();
                out["rawText"] = json!(raw_snip);
            }
            out
        }
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

async fn fetch_discourse_latest(url: &str, limit: u32) -> Value {
    let origin = match url.trim().trim_end_matches('/') {
        s if s.is_empty() => return json!({ "ok": false, "error": "URL 为空" }),
        s => s,
    };

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .build()
    {
        Ok(c) => c,
        Err(e) => return json!({ "ok": false, "error": e.to_string() }),
    };

    let latest_url = format!("{origin}/latest.json?no_definitions=true");
    let resp = match client
        .get(&latest_url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return json!({ "ok": false, "error": e.to_string() }),
    };

    let status = resp.status().as_u16();
    let raw_text = resp.text().await.unwrap_or_default();

    if status >= 400 {
        return json!({ "ok": false, "status": status, "error": format!("拉取 latest.json 失败，HTTP {status}"), "rawText": raw_text });
    }

    let parsed: Value = match serde_json::from_str(&raw_text) {
        Ok(v) => v,
        Err(_) => {
            return json!({ "ok": false, "status": 200, "error": "latest.json 解析失败", "rawText": raw_text })
        }
    };

    let topics = parsed["topic_list"]["topics"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let lines: Vec<String> = {
        let mut v = Vec::new();
        v.push(format!("站点：{origin}"));
        v.push("来源：Discourse latest.json".to_string());
        v.push("".to_string());
        v.push("最近主题：".to_string());
        for topic in topics.iter().take(limit as usize) {
            let id = topic["id"].as_i64().unwrap_or(0);
            let slug = topic["slug"].as_str().unwrap_or("");
            let title = topic["title"].as_str().unwrap_or("（无标题）");
            let created = topic["created_at"].as_str().unwrap_or("");
            let last_posted = topic["last_posted_at"].as_str().unwrap_or("");
            v.push(format!("- {title}"));
            if !slug.is_empty() && id > 0 {
                v.push(format!("  链接：{origin}/t/{slug}/{id}"));
            }
            if !created.is_empty() {
                v.push(format!("  创建：{created}"));
            }
            if !last_posted.is_empty() {
                v.push(format!("  最新回复：{last_posted}"));
            }
        }
        v
    };
    let title = parsed["title"].as_str().unwrap_or("").to_string();
    let text = lines.join("\n");

    json!({
      "ok": true,
      "status": 200,
      "kind": "discourse_latest",
      "mode": "discourse_latest",
      "title": title,
      "text": text,
      "content": text,
      "rawText": raw_text,
    })
}

#[tauri::command]
pub async fn web_screenshot_page(
    url: String,
    proxy_url: Option<String>,
    headed: Option<bool>,
    wait_after_goto_ms: Option<u64>,
    navigation_timeout_ms: Option<u64>,
) -> Value {
    use base64::Engine;

    if url.trim().is_empty() {
        return json!({ "ok": false, "error": "URL 为空" });
    }

    let wait_ms = wait_after_goto_ms.unwrap_or(0);
    let _nav_timeout_ms = navigation_timeout_ms.unwrap_or(90_000);
    let headless = !headed.unwrap_or(true);

    let launch_opts = {
        let mut opts = headless_chrome::LaunchOptions::default();
        opts.headless = headless;
        opts.sandbox = false;
        opts.window_size = Some((1280, 800));
        opts.idle_browser_timeout = std::time::Duration::from_secs(120);
        if let Some(ref p) = proxy_url {
            let t = p.trim();
            if !t.is_empty() {
                opts.proxy_server = Some(t);
            }
        }
        opts
    };

    let browser = match headless_chrome::Browser::new(launch_opts) {
        Ok(b) => b,
        Err(e) => {
            return json!({ "ok": false, "error": format!("启动 Chrome 失败: {e}。请确认已安装 Chrome/Chromium 并加入 PATH。") });
        }
    };

    let tab = match browser.new_tab() {
        Ok(t) => t,
        Err(e) => return json!({ "ok": false, "error": format!("创建标签页失败: {e}") }),
    };

    if let Err(e) = tab.navigate_to(&url) {
        return json!({ "ok": false, "error": format!("导航到 {url} 失败: {e}") });
    }

    let _ = tab.wait_until_navigated();

    if wait_ms > 0 {
        tokio::time::sleep(std::time::Duration::from_millis(wait_ms)).await;
    }

    let jpeg_data = match tab.capture_screenshot(
        headless_chrome::protocol::cdp::Page::CaptureScreenshotFormatOption::Jpeg,
        Some(78),
        None,
        false,
    ) {
        Ok(data) => data,
        Err(e) => return json!({ "ok": false, "error": format!("截图失败: {e}") }),
    };

    let b64 = base64::engine::general_purpose::STANDARD.encode(&jpeg_data);
    if b64.len() > 14 * 1024 * 1024 {
        return json!({ "ok": false, "error": "截图 Base64 超限（超过 14MB）" });
    }

    json!({
      "ok": true,
      "mime": "image/jpeg",
      "base64": b64,
      "byteLength": jpeg_data.len()
    })
}
