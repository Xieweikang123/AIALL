use reqwest::Proxy;
use std::time::Duration;

pub fn build_http_client(proxy_url: Option<&str>, timeout_secs: u64) -> Result<reqwest::Client, String> {
  let mut builder = reqwest::Client::builder().timeout(Duration::from_secs(timeout_secs));
  if let Some(proxy) = proxy_url.map(str::trim).filter(|p| !p.is_empty()) {
    builder = builder.proxy(Proxy::all(proxy).map_err(|e| e.to_string())?);
  }
  builder.build().map_err(|e| e.to_string())
}

pub async fn fetch_url_text(
  url: &str,
  proxy_url: Option<&str>,
  timeout_secs: u64,
) -> Result<(u16, String), String> {
  let client = build_http_client(proxy_url, timeout_secs)?;
  let resp = client
    .get(url)
    .header(
      "User-Agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    )
    .header("Accept", "text/html,application/json;q=0.9,*/*;q=0.8")
    .send()
    .await
    .map_err(|e| e.to_string())?;
  let status = resp.status().as_u16();
  let text = resp.text().await.map_err(|e| e.to_string())?;
  Ok((status, text))
}

fn strip_html_tags(html: &str) -> String {
  let mut out = String::new();
  let mut in_tag = false;
  for ch in html.chars() {
    match ch {
      '<' => in_tag = true,
      '>' => in_tag = false,
      _ if !in_tag => out.push(ch),
      _ => {}
    }
  }
  out.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub async fn web_search_text(
  query: &str,
  max_results: u32,
  proxy_url: Option<&str>,
) -> Result<String, String> {
  let q = query.trim();
  if q.is_empty() {
    return Err("搜索关键词不能为空".into());
  }
  let limit = max_results.clamp(1, 10);
  let encoded = urlencoding::encode(q);
  let search_url = format!("https://www.baidu.com/s?wd={encoded}&rn={limit}");
  let (status, html) = fetch_url_text(&search_url, proxy_url, 45).await?;
  if status >= 400 {
    return Err(format!("搜索请求失败，HTTP {status}"));
  }
  let text = strip_html_tags(&html);
  let truncated: String = text.chars().take(12_000).collect();
  Ok(format!("百度搜索「{q}」结果（节选）：\n{truncated}"))
}

fn looks_like_cloudflare_challenge(html: &str) -> bool {
  let sample: String = html.chars().take(120_000).collect::<String>().to_lowercase();
  sample.contains("just a moment")
    || sample.contains("cf-browser-verification")
    || sample.contains("/cdn-cgi/challenge")
    || sample.contains("challenge-platform")
    || sample.contains("checking your browser")
}

fn extract_visible_text_from_html(html: &str) -> String {
  strip_html_tags(html)
}

pub async fn web_extract_text(url: &str, proxy_url: Option<&str>) -> Result<String, String> {
  let trimmed = url.trim();
  if trimmed.is_empty() {
    return Err("url 不能为空".into());
  }
  if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
    return Err("url 必须以 http:// 或 https:// 开头".into());
  }
  let (status, text) = fetch_url_text(trimmed, proxy_url, 45).await?;
  if status >= 400 {
    return Err(format!("HTTP {status}"));
  }
  let content: String = text.chars().take(120_000).collect();
  Ok(format!("网页抓取成功\n正文：\n{content}"))
}

/// auto/html: HTTP first; on 403, Cloudflare challenge, or very short body → browser fallback.
pub async fn web_extract_auto(url: &str, proxy_url: Option<&str>, mode: &str) -> Result<String, String> {
  let trimmed = url.trim();
  if trimmed.is_empty() {
    return Err("url 不能为空".into());
  }
  if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
    return Err("url 必须以 http:// 或 https:// 开头".into());
  }

  if mode == "browser" {
    return browser_extract_text(trimmed, proxy_url).await;
  }

  let try_browser_fallback = mode == "auto" || mode == "html";
  let (status, raw) = fetch_url_text(trimmed, proxy_url, 45).await?;

  if status >= 400 {
    if try_browser_fallback && (status == 403 || mode == "auto") {
      return browser_extract_text(trimmed, proxy_url).await;
    }
    return Err(format!("HTTP {status}"));
  }

  if try_browser_fallback && looks_like_cloudflare_challenge(&raw) {
    return browser_extract_text(trimmed, proxy_url).await;
  }

  let visible = extract_visible_text_from_html(&raw);
  if try_browser_fallback && mode == "auto" && visible.chars().count() < 120 {
    if let Ok(browser_text) = browser_extract_text(trimmed, proxy_url).await {
      return Ok(browser_text);
    }
  }

  let content: String = raw.chars().take(120_000).collect();
  Ok(format!("网页抓取成功\n正文：\n{content}"))
}

fn browser_launch_options(proxy_url: Option<&str>) -> headless_chrome::LaunchOptions {
  let mut opts = headless_chrome::LaunchOptions::default();
  opts.headless = true;
  opts.sandbox = false;
  opts.window_size = Some((1280, 800));
  opts.idle_browser_timeout = Duration::from_secs(120);
  if let Some(proxy) = proxy_url.map(str::trim).filter(|p| !p.is_empty()) {
    opts.proxy_server = Some(proxy);
  }
  opts
}

fn eval_js_string(tab: &headless_chrome::Tab, expr: &str) -> String {
  use headless_chrome::protocol::cdp::Runtime::RemoteObject;
  let object: RemoteObject = match tab.evaluate(expr, false) {
    Ok(o) => o,
    Err(_) => return String::new(),
  };
  match object.value {
    Some(serde_json::Value::String(s)) => s,
    Some(other) => other.as_str().unwrap_or("").to_string(),
    None => String::new(),
  }
}

pub async fn browser_extract_inner(url: &str, proxy_url: Option<&str>) -> Result<(String, String), String> {
  let trimmed = url.trim();
  if trimmed.is_empty() {
    return Err("url 不能为空".into());
  }
  if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
    return Err("url 必须以 http:// 或 https:// 开头".into());
  }

  let target = trimmed.to_string();
  let proxy = proxy_url.map(|s| s.to_string());
  tokio::task::spawn_blocking(move || {
    let proxy_ref = proxy.as_deref();
    let browser = headless_chrome::Browser::new(browser_launch_options(proxy_ref))
      .map_err(|e| format!("启动 Chrome 失败: {e}。请确认已安装 Chrome/Chromium 并加入 PATH。"))?;
    let tab = browser
      .new_tab()
      .map_err(|e| format!("创建标签页失败: {e}"))?;
    tab
      .navigate_to(&target)
      .map_err(|e| format!("导航到 {target} 失败: {e}"))?;
    let _ = tab.wait_until_navigated();
    std::thread::sleep(Duration::from_millis(1500));

    let title = eval_js_string(&tab, "document.title");
    let body = eval_js_string(&tab, "document.body ? document.body.innerText : ''");
    let content: String = body.chars().take(120_000).collect();
    Ok((title, content))
  })
  .await
  .map_err(|e| format!("browser 抓取任务失败: {e}"))?
}

pub async fn browser_extract_text(url: &str, proxy_url: Option<&str>) -> Result<String, String> {
  let (title, content) = browser_extract_inner(url, proxy_url).await?;
  Ok(format!("网页抓取成功（browser 模式）\n标题：{title}\n正文：\n{content}"))
}

/// Structured page extract for Tauri `web_extract` command and clients.
pub async fn web_extract_structured(
  url: &str,
  mode: &str,
  proxy_url: Option<&str>,
) -> Result<(u16, String, String, Option<String>, Option<String>), String> {
  let trimmed = url.trim();
  if trimmed.is_empty() {
    return Err("url 不能为空".into());
  }
  if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
    return Err("url 必须以 http:// 或 https:// 开头".into());
  }

  if mode == "browser" {
    let (title, text) = browser_extract_inner(trimmed, proxy_url).await?;
    return Ok((200, "browser".into(), text, Some(title), None));
  }

  let try_browser_fallback = mode == "auto" || mode == "html";
  let (status, raw) = fetch_url_text(trimmed, proxy_url, 45).await?;

  if status >= 400 {
    if try_browser_fallback && (status == 403 || mode == "auto") {
      let (title, text) = browser_extract_inner(trimmed, proxy_url).await?;
      return Ok((200, "browser".into(), text, Some(title), Some(raw)));
    }
    return Err(format!("HTTP {status}"));
  }

  if try_browser_fallback && looks_like_cloudflare_challenge(&raw) {
    let (title, text) = browser_extract_inner(trimmed, proxy_url).await?;
    return Ok((200, "browser".into(), text, Some(title), Some(raw)));
  }

  let visible = extract_visible_text_from_html(&raw);
  if try_browser_fallback && mode == "auto" && visible.chars().count() < 120 {
    if let Ok((title, text)) = browser_extract_inner(trimmed, proxy_url).await {
      return Ok((200, "browser".into(), text, Some(title), Some(raw)));
    }
  }

  let content: String = raw.chars().take(120_000).collect();
  Ok((status, "html".into(), content, None, None))
}
