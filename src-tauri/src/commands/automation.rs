use crate::automation;
use base64::Engine;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

fn icon_templates_dirs() -> (PathBuf, PathBuf) {
    let mut base = crate::paths::resolve_aiall_session_data_dir();
    base.pop();
    base.push("icon-templates");
    (base.join("store.json"), base.join("images"))
}

static ICON_TEMPLATE_ID_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z0-9][a-z0-9_-]{0,63}$").unwrap());

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct IconTemplateItem {
    id: String,
    name: String,
    aliases: Vec<String>,
    note: String,
    image_file: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IconTemplateStoreFile {
    version: i32,
    updated_at: String,
    items: Vec<IconTemplateItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertIconTemplatePayload {
    id: String,
    name: String,
    aliases: Option<Vec<String>>,
    note: Option<String>,
    image_base64: Option<String>,
    clear_image: Option<bool>,
}

fn sanitize_icon_template_id(raw: &str) -> Option<String> {
    let id = raw.trim().to_lowercase();
    if ICON_TEMPLATE_ID_RE.is_match(&id) {
        Some(id)
    } else {
        None
    }
}

fn parse_base64_image(input: &str) -> Result<(String, Vec<u8>), String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("图片为空".into());
    }
    if trimmed.starts_with("data:image/") {
        let Some(comma) = trimmed.find(',') else {
            return Err("Base64 解码失败".into());
        };
        let header = &trimmed[..comma];
        let data = &trimmed[comma + 1..];
        let ext = if header.contains("jpeg") || header.contains("jpg") {
            "jpg"
        } else if header.contains("png") {
            "png"
        } else if header.contains("gif") {
            "gif"
        } else if header.contains("webp") {
            "webp"
        } else {
            "png"
        };
        let buffer = base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(|_| "Base64 解码失败".to_string())?;
        if buffer.is_empty() {
            return Err("图片解码后为空".into());
        }
        return Ok((ext.to_string(), buffer));
    }
    let buffer = base64::engine::general_purpose::STANDARD
        .decode(trimmed)
        .map_err(|_| "Base64 解码失败".to_string())?;
    if buffer.is_empty() {
        return Err("请使用 PNG/JPEG 的 data URL 或合法 base64".into());
    }
    Ok(("png".to_string(), buffer))
}

async fn ensure_icon_template_dirs(images_dir: &Path) -> Result<(), String> {
    tokio::fs::create_dir_all(images_dir)
        .await
        .map_err(|e| e.to_string())
}

async fn read_icon_template_store(store_path: &Path) -> IconTemplateStoreFile {
    match tokio::fs::read_to_string(store_path).await {
        Ok(raw) => {
            if let Ok(store) = serde_json::from_str::<IconTemplateStoreFile>(&raw) {
                if store.version == 1 {
                    return store;
                }
            }
            if let Ok(items) = serde_json::from_str::<Vec<IconTemplateItem>>(&raw) {
                return IconTemplateStoreFile {
                    version: 1,
                    updated_at: chrono::Utc::now().to_rfc3339(),
                    items,
                };
            }
            default_icon_template_store()
        }
        Err(_) => default_icon_template_store(),
    }
}

fn default_icon_template_store() -> IconTemplateStoreFile {
    IconTemplateStoreFile {
        version: 1,
        updated_at: chrono::Utc::now().to_rfc3339(),
        items: Vec::new(),
    }
}

async fn write_icon_template_store(
    store_path: &Path,
    store: &mut IconTemplateStoreFile,
) -> Result<(), String> {
    store.updated_at = chrono::Utc::now().to_rfc3339();
    if let Some(parent) = store_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    let json_str = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    tokio::fs::write(store_path, json_str)
        .await
        .map_err(|e| e.to_string())
}

async fn load_template_png_base64(item: &IconTemplateItem, images_dir: &Path) -> Option<String> {
    if let Some(file) = item.image_file.as_ref() {
        let path = images_dir.join(file);
        if let Ok(bytes) = tokio::fs::read(&path).await {
            return Some(base64::engine::general_purpose::STANDARD.encode(bytes));
        }
    }
    None
}

async fn template_to_json(item: &IconTemplateItem, images_dir: &Path) -> Value {
    let png_base64 = load_template_png_base64(item, images_dir).await;
    json!({
      "id": item.id,
      "name": item.name,
      "aliases": item.aliases,
      "note": item.note,
      "imageFile": item.image_file,
      "createdAt": item.created_at,
      "updatedAt": item.updated_at,
      "pngBase64": png_base64,
    })
}

#[tauri::command]
pub async fn automation_capture_screen() -> Value {
    match automation::capture_primary_screen_png().await {
        Ok(png_data) => {
            let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &png_data);
            json!({ "ok": true, "data": b64 })
        }
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

#[tauri::command]
pub async fn automation_click_at(x: i32, y: i32) -> Value {
    match automation::click_left_at_screen(x, y).await {
        Ok(_) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

#[tauri::command]
pub async fn automation_find_template(
    screen_png: String,
    template_png: String,
    min_score: Option<f64>,
) -> Value {
    let screen_bytes =
        match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &screen_png) {
            Ok(b) => b,
            Err(e) => {
                return json!({ "ok": false, "error": format!("截屏图片 Base64 解码失败: {e}") })
            }
        };
    let template_bytes =
        match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &template_png) {
            Ok(b) => b,
            Err(e) => {
                return json!({ "ok": false, "error": format!("模板图片 Base64 解码失败: {e}") })
            }
        };
    let mut opts = automation::MatchOptions::default();
    if let Some(ms) = min_score {
        opts.min_score = ms;
        opts.tolerant_min_score = ms;
    }
    match automation::find_template_match(&screen_bytes, &template_bytes, &opts).await {
        Ok(hit) => json!({
          "ok": true,
          "topLeftX": hit.top_left_x,
          "topLeftY": hit.top_left_y,
          "clickX": hit.click_x,
          "clickY": hit.click_y,
          "score": hit.score,
          "matchAlgorithm": hit.match_algorithm,
        }),
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

#[tauri::command]
pub async fn automation_open_by_template(template_id: String) -> Value {
    let (store_path, images_dir) = icon_templates_dirs();
    let store = read_icon_template_store(&store_path).await;
    let tmpl = match store.items.iter().find(|t| t.id == template_id) {
        Some(t) => t,
        None => return json!({ "ok": false, "error": format!("未找到模板: {template_id}") }),
    };
    let png_b64 = match load_template_png_base64(tmpl, &images_dir).await {
        Some(b64) => b64,
        None => return json!({ "ok": false, "error": "模板缺少图片数据" }),
    };
    let hit_value = automation_test_match(png_b64, None).await;
    if hit_value.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return hit_value;
    }
    let hit_obj = hit_value
        .get("hit")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    let click_x = hit_obj.get("clickX").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    let click_y = hit_obj.get("clickY").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    let score = hit_obj.get("score").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let top_left_x = hit_obj
        .get("topLeftX")
        .and_then(|v| v.as_i64())
        .unwrap_or(0) as i32;
    let top_left_y = hit_obj
        .get("topLeftY")
        .and_then(|v| v.as_i64())
        .unwrap_or(0) as i32;
    let match_algo = hit_obj
        .get("matchAlgorithm")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    match automation::click_left_at_screen(click_x, click_y).await {
        Ok(()) => json!({
          "ok": true,
          "id": template_id,
          "name": tmpl.name,
          "score": score,
          "clickX": click_x,
          "clickY": click_y,
          "topLeftX": top_left_x,
          "topLeftY": top_left_y,
          "matchAlgorithm": match_algo,
        }),
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

#[tauri::command]
pub async fn automation_test_icon_template(template_id: String) -> Value {
    let id = template_id.trim().to_lowercase();
    if id.is_empty() {
        return json!({ "ok": false, "error": "缺少 id" });
    }
    let (store_path, images_dir) = icon_templates_dirs();
    let store = read_icon_template_store(&store_path).await;
    let tmpl = match store.items.iter().find(|t| t.id == id) {
        Some(t) => t,
        None => return json!({ "ok": false, "error": format!("未找到模板: {id}") }),
    };
    let png_b64 = match load_template_png_base64(tmpl, &images_dir).await {
        Some(b64) => b64,
        None => return json!({ "ok": false, "error": "模板缺少图片数据" }),
    };

    let screen_png = match automation::capture_primary_screen_png().await {
        Ok(d) => d,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    let screen_b64 = base64::engine::general_purpose::STANDARD.encode(&screen_png);
    let template_png =
        match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &png_b64) {
            Ok(d) => d,
            Err(e) => {
                return json!({
                  "ok": false,
                  "error": format!("模板图片解码失败: {e}"),
                  "screenPngBase64": screen_b64,
                });
            }
        };

    let opts = automation::MatchOptions::default();
    match automation::find_template_match(&screen_png, &template_png, &opts).await {
        Ok(hit) => json!({
          "ok": true,
          "id": id,
          "name": tmpl.name,
          "score": hit.score,
          "clickX": hit.click_x,
          "clickY": hit.click_y,
          "topLeftX": hit.top_left_x,
          "topLeftY": hit.top_left_y,
          "matchAlgorithm": hit.match_algorithm,
          "screenPngBase64": screen_b64,
        }),
        Err(e) => json!({
          "ok": false,
          "error": e,
          "screenPngBase64": screen_b64,
        }),
    }
}

#[tauri::command]
pub async fn automation_test_match(
    template_png_b64: String,
    screen_png_b64: Option<String>,
) -> Value {
    let screen_png = if let Some(b64) = screen_png_b64 {
        match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &b64) {
            Ok(d) => d,
            Err(e) => return json!({ "ok": false, "error": format!("截屏图片解码失败: {e}") }),
        }
    } else {
        match automation::capture_primary_screen_png().await {
            Ok(d) => d,
            Err(e) => return json!({ "ok": false, "error": e }),
        }
    };
    let template_png = match base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &template_png_b64,
    ) {
        Ok(d) => d,
        Err(e) => return json!({ "ok": false, "error": format!("模板图片解码失败: {e}") }),
    };
    let opts = automation::MatchOptions::default();
    match automation::find_template_match(&screen_png, &template_png, &opts).await {
        Ok(hit) => json!({ "ok": true, "hit": hit }),
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

#[tauri::command]
pub async fn icon_templates_list() -> Value {
    let (store_path, images_dir) = icon_templates_dirs();
    let store = read_icon_template_store(&store_path).await;
    let mut templates = Vec::with_capacity(store.items.len());
    for item in &store.items {
        templates.push(template_to_json(item, &images_dir).await);
    }
    json!({
      "ok": true,
      "storePath": store_path.to_string_lossy(),
      "imagesPath": images_dir.to_string_lossy(),
      "templates": templates,
    })
}

#[tauri::command]
pub async fn icon_templates_save(payload: UpsertIconTemplatePayload) -> Value {
    let id = match sanitize_icon_template_id(&payload.id) {
        Some(id) => id,
        None => {
            return json!({
              "ok": false,
              "error": "id 须为小写字母/数字/下划线/短横线，长度 1～64，且以字母或数字开头"
            });
        }
    };
    let name = payload.name.trim();
    if name.is_empty() {
        return json!({ "ok": false, "error": "名称不能为空" });
    }

    let (store_path, images_dir) = icon_templates_dirs();
    if let Err(e) = ensure_icon_template_dirs(&images_dir).await {
        return json!({ "ok": false, "error": e });
    }

    let mut store = read_icon_template_store(&store_path).await;
    let now = chrono::Utc::now().to_rfc3339();
    let idx = store.items.iter().position(|x| x.id == id);
    let prev = idx.map(|i| store.items[i].clone());
    let mut image_file = prev.as_ref().and_then(|p| p.image_file.clone());

    if payload.clear_image == Some(true) {
        if let Some(ref file) = image_file {
            let _ = tokio::fs::remove_file(images_dir.join(file)).await;
        }
        image_file = None;
    } else if let Some(ref raw) = payload.image_base64 {
        if !raw.trim().is_empty() {
            match parse_base64_image(raw) {
                Ok((ext, buffer)) => {
                    let new_name = format!("{id}.{ext}");
                    if let Some(ref old) = image_file {
                        if old != &new_name {
                            let _ = tokio::fs::remove_file(images_dir.join(old)).await;
                        }
                    }
                    let target = images_dir.join(&new_name);
                    if let Err(e) = tokio::fs::write(&target, buffer).await {
                        return json!({ "ok": false, "error": e.to_string() });
                    }
                    image_file = Some(new_name);
                }
                Err(error) => return json!({ "ok": false, "error": error }),
            }
        }
    }

    if prev.is_none() && image_file.is_none() {
        return json!({ "ok": false, "error": "新建条目必须上传一张模板小图" });
    }

    let aliases = payload
        .aliases
        .unwrap_or_default()
        .into_iter()
        .map(|a| a.trim().to_string())
        .filter(|a| !a.is_empty())
        .take(32)
        .collect::<Vec<_>>();
    let note = payload
        .note
        .unwrap_or_default()
        .trim()
        .chars()
        .take(500)
        .collect::<String>();

    let item = IconTemplateItem {
        id: id.clone(),
        name: name.to_string(),
        aliases,
        note,
        image_file,
        created_at: prev
            .as_ref()
            .map(|p| p.created_at.clone())
            .unwrap_or_else(|| now.clone()),
        updated_at: now,
    };

    if let Some(i) = idx {
        store.items[i] = item.clone();
    } else {
        store.items.push(item.clone());
    }

    if let Err(e) = write_icon_template_store(&store_path, &mut store).await {
        return json!({ "ok": false, "error": e });
    }

    json!({
      "ok": true,
      "item": template_to_json(&item, &images_dir).await
    })
}

#[tauri::command]
pub async fn icon_templates_delete(id: String) -> Value {
    let id = match sanitize_icon_template_id(&id) {
        Some(id) => id,
        None => return json!({ "ok": false, "error": "缺少合法 id" }),
    };
    let (store_path, images_dir) = icon_templates_dirs();
    let mut store = read_icon_template_store(&store_path).await;
    let idx = match store.items.iter().position(|x| x.id == id) {
        Some(i) => i,
        None => return json!({ "ok": false, "error": "未找到该 id" }),
    };
    let removed = store.items.remove(idx);
    if let Some(ref file) = removed.image_file {
        let _ = tokio::fs::remove_file(images_dir.join(file)).await;
    }
    if let Err(e) = write_icon_template_store(&store_path, &mut store).await {
        return json!({ "ok": false, "error": e });
    }
    json!({ "ok": true, "id": id })
}
