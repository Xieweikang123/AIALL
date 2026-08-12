use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub const MEMORY_REL_DIR: &str = ".aiall/memory";
pub const MEMORY_INDEX_REL: &str = ".aiall/memory/index.json";

const MEMORY_MAX_ACTIVE_PER_SCOPE: usize = 50;
const MEMORY_MIN_CONFLICT_OVERLAP_CHARS: usize = 8;
const MEMORY_FORMAT_MAX_CHARS: usize = 4_000;
const MEMORY_DEFAULT_CONFIDENCE: f32 = 0.9;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEntry {
    pub id: String,
    pub content: String,
    pub scope: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub confidence: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub superseded_by: Option<String>,
    #[serde(default = "default_active")]
    pub active: bool,
}

fn default_active() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryIndex {
    pub version: u32,
    pub entries: Vec<MemoryEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryWriteResult {
    pub entry_id: String,
    pub scope: String,
    pub superseded: Vec<String>,
    pub archived: Vec<String>,
    pub total_active: usize,
}

pub fn memory_index_file(root: &str) -> std::path::PathBuf {
    Path::new(root).join(MEMORY_INDEX_REL)
}

/// Normalize for conflict comparison: lowercase, collapse whitespace.
fn normalize_text(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn content_hash(content: &str) -> String {
    let mut hasher = DefaultHasher::new();
    content.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn make_entry_id(content: &str) -> String {
    format!("mem-{}-{}", now_millis(), content_hash(content))
}

/// Determine whether a path would land inside `.aiall/memory/`.
pub fn is_memory_path(path: &str) -> bool {
    let norm = path.replace('\\', "/");
    norm == MEMORY_REL_DIR
        || norm == format!("{MEMORY_REL_DIR}/")
        || norm.contains(&format!("{MEMORY_REL_DIR}/"))
}

pub async fn read_memory_index(root: &str) -> MemoryIndex {
    let path = memory_index_file(root);
    match tokio::fs::read_to_string(&path).await {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_else(|_| MemoryIndex {
            version: 1,
            entries: vec![],
        }),
        Err(_) => MemoryIndex {
            version: 1,
            entries: vec![],
        },
    }
}

/// Remove a single entry from the index (UI-level delete / rollback).
/// Returns `Ok(false)` when no entry with `id` exists.
pub async fn delete_memory_entry(root: &str, id: &str) -> Result<bool, String> {
    let mut index = read_memory_index(root).await;
    let before = index.entries.len();
    index.entries.retain(|e| e.id != id);
    if index.entries.len() == before {
        return Ok(false);
    }
    write_memory_index(root, &index).await?;
    Ok(true)
}

pub async fn write_memory_index(root: &str, index: &MemoryIndex) -> Result<(), String> {
    let path = memory_index_file(root);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(index).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, raw)
        .await
        .map_err(|e| e.to_string())
}

pub fn active_memory_entries(index: &MemoryIndex) -> Vec<MemoryEntry> {
    let mut active: Vec<MemoryEntry> = index
        .entries
        .iter()
        .filter(|e| e.active)
        .cloned()
        .collect();
    active.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    active
}

/// Simple conflict detection: normalized exact match, or one side is a
/// (long-enough) substring of the other. Returns ids to supersede.
fn find_conflicts(entries: &[MemoryEntry], content: &str) -> Vec<String> {
    let needle = normalize_text(content);
    if needle.chars().count() < MEMORY_MIN_CONFLICT_OVERLAP_CHARS {
        return vec![];
    }
    entries
        .iter()
        .filter(|e| e.active)
        .filter(|e| {
            let other = normalize_text(&e.content);
            if other.chars().count() < MEMORY_MIN_CONFLICT_OVERLAP_CHARS {
                return false;
            }
            other == needle || needle.contains(&other) || other.contains(&needle)
        })
        .map(|e| e.id.clone())
        .collect()
}

pub async fn add_memory_entry(
    root: &str,
    content: &str,
    scope: &str,
    source: Option<String>,
    confidence: Option<f32>,
) -> Result<MemoryWriteResult, String> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err("记忆内容不能为空".into());
    }
    let scope = scope.trim();
    if scope.is_empty() {
        return Err("缺少记忆类别".into());
    }

    let mut index = read_memory_index(root).await;
    let ts = now_millis().to_string();
    let superseded = find_conflicts(&index.entries, trimmed);
    let mut archived: Vec<String> = Vec::new();

    let conf = confidence.unwrap_or(MEMORY_DEFAULT_CONFIDENCE).clamp(0.0, 1.0);

    // If the new entry supersedes the most recent conflicting one, the older
    // siblings stay; only direct conflicts are superseded.
    for id in superseded.iter() {
        if let Some(entry) = index.entries.iter_mut().find(|e| e.id.as_str() == id) {
            entry.active = false;
            entry.superseded_by = Some("superseded".into());
        }
    }

    // Scope cap: archive the oldest active entries of the same scope when full.
    let same_scope_active: Vec<String> = index
        .entries
        .iter()
        .filter(|e| e.active && e.scope == scope)
        .map(|e| e.id.clone())
        .collect();
    let overflow = same_scope_active.len().saturating_sub(MEMORY_MAX_ACTIVE_PER_SCOPE.saturating_sub(1));
    if overflow > 0 {
        for id in same_scope_active.into_iter().take(overflow) {
            if let Some(entry) = index.entries.iter_mut().find(|e| e.id.as_str() == id) {
                entry.active = false;
                entry.superseded_by = Some("archived".into());
                archived.push(id);
            }
        }
    }

    let entry_id = make_entry_id(trimmed);
    index.entries.push(MemoryEntry {
        id: entry_id.clone(),
        content: trimmed.to_string(),
        scope: scope.to_string(),
        source: source.filter(|s| !s.trim().is_empty()).map(|s| s.trim().to_string()),
        created_at: ts.clone(),
        updated_at: ts,
        confidence: conf,
        superseded_by: None,
        active: true,
    });

    write_memory_index(root, &index).await?;

    let total_active = index.entries.iter().filter(|e| e.active).count();
    Ok(MemoryWriteResult {
        entry_id,
        scope: scope.to_string(),
        superseded,
        archived,
        total_active,
    })
}

/// Render active memory entries as a system-prompt block, freshest first.
pub fn format_memory_block(entries: &[MemoryEntry]) -> String {
    if entries.is_empty() {
        return String::new();
    }
    let mut lines = vec![format!(
        "【长期记忆】共 {} 条，按更新时间倒序（记忆是快照，引用具体代码位置前请用 grep/read_file 核实）：",
        entries.len()
    )];
    let mut total = 0usize;
    for entry in entries {
        let source = entry
            .source
            .as_deref()
            .filter(|s| !s.is_empty())
            .map(|s| format!("（来源 {s}）"))
            .unwrap_or_default();
        let line = format!(
            "- [{}] {} {}{}",
            entry.scope,
            entry.content,
            source,
            entry.updated_at
        );
        if total + line.len() > MEMORY_FORMAT_MAX_CHARS {
            lines.push(format!("…（已截断，剩余 {} 条）", entries.len() - lines.len()));
            break;
        }
        total += line.len();
        lines.push(line);
    }
    lines.join("\n")
}

/// Search the AppData session store for conversation fragments matching `query`.
/// Returns a markdown-ish text listing session id + matched user/assistant lines.
pub async fn search_sessions(query: &str, max_results: usize) -> Result<String, String> {
    let dir = crate::paths::resolve_aiall_session_data_dir();
    search_sessions_in_dir(&dir, query, max_results).await
}

/// Core implementation, directory-parameterized for tests.
async fn search_sessions_in_dir(
    dir: &Path,
    query: &str,
    max_results: usize,
) -> Result<String, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err("缺少搜索关键词".into());
    }
    let tokens = split_query_tokens(trimmed);
    if tokens.is_empty() {
        return Err("缺少有效搜索关键词".into());
    }
    let mut files: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(|e| {
            e.metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis())
                .unwrap_or(0)
        });
        for entry in entries.into_iter().rev() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with("chat-") && name.ends_with(".json") {
                files.push(entry.path());
            }
            if files.len() >= 50 {
                break;
            }
        }
    }
    if files.is_empty() {
        return Ok("（没有可检索的历史会话）".into());
    }

    let mut hits: Vec<String> = Vec::new();
    for path in files {
        let Ok(raw) = tokio::fs::read_to_string(&path).await else {
            continue;
        };
        let Ok(data) = serde_json::from_str::<serde_json::Value>(&raw) else {
            continue;
        };
        let session_id = data
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let title = data
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let updated = data
            .get("updatedAt")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let Some(messages) = data.get("messages").and_then(|m| m.as_array()) else {
            continue;
        };

        let mut matched_lines: Vec<String> = Vec::new();
        for msg in messages {
            let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("");
            if role != "user" && role != "assistant" {
                continue;
            }
            let content = msg.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let cleaned = clean_session_content(content);
            if cleaned.is_empty() {
                continue;
            }
            if tokens.iter().any(|t| cleaned.to_lowercase().contains(t)) {
                let label = if role == "user" { "用户" } else { "Agent" };
                matched_lines.push(format!("  {label}：{}", clip(&cleaned, 400)));
            }
            if matched_lines.len() >= 6 {
                break;
            }
        }
        if matched_lines.is_empty() {
            continue;
        }
        let mut block = format!("[会话 {}]", if session_id.is_empty() { path.file_name().unwrap_or_default().to_string_lossy().into_owned() } else { session_id });
        if !title.is_empty() {
            block.push_str(&format!("（{}）", clip(&title, 60)));
        }
        if !updated.is_empty() {
            block.push_str(&format!(" 更新于 {updated}"));
        }
        block.push('\n');
        block.push_str(&matched_lines.join("\n"));
        hits.push(block);
        if hits.len() >= max_results {
            break;
        }
    }

    if hits.is_empty() {
        return Ok(format!("（未找到与「{trimmed}」相关的历史会话）"));
    }
    Ok(hits.join("\n\n"))
}

/// Split a query into lowercase search tokens (ASCII words + CJK runs).
fn split_query_tokens(query: &str) -> Vec<String> {
    let mut tokens: Vec<String> = Vec::new();
    let mut current: Vec<char> = Vec::new();
    for c in query.chars() {
        if c.is_alphanumeric() {
            current.push(c);
        } else if !current.is_empty() {
            tokens.push(current.iter().collect::<String>().to_lowercase());
            current.clear();
        }
    }
    if !current.is_empty() {
        tokens.push(current.iter().collect::<String>().to_lowercase());
    }
    tokens
}

fn clip(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_string()
    } else {
        format!("{}…", text.chars().take(max).collect::<String>())
    }
}

/// Strip tool-invocation / tool-result / reference markup noise from session text.
fn clean_session_content(content: &str) -> String {
    let mut out = content.to_string();
    let re = regex::Regex::new(
        r"(?s)<tool_invocation[^>]*>.*?</tool_invocation>|<tool_result>.*?</tool_result>|<tool_end\s*/?>|<reference[^>]*>.*?</reference>|<reference[^>]*\s*/?>",
    )
    .expect("valid tool-noise regex");
    out = re.replace_all(&out, "").into_owned();
    out
        .lines()
        .map(|line| line.trim_end())
        .filter(|line| {
            let t = line.trim_start();
            !t.starts_with("<tool_") && !t.starts_with("<reference")
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> String {
        let p = std::env::temp_dir().join(format!("opencode-memory-{name}"));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p.to_string_lossy().to_string()
    }

    #[tokio::test]
    async fn add_then_read_roundtrip() {
        let root = temp_root("roundtrip");
        let result = add_memory_entry(&root, "生产 queue 统一使用 Redis", "architecture", Some("chat-1".into()), None).await.unwrap();
        assert!(result.entry_id.starts_with("mem-"));
        let index = read_memory_index(&root).await;
        assert_eq!(index.entries.len(), 1);
        assert!(index.entries[0].active);
        assert_eq!(index.entries[0].scope, "architecture");
        assert_eq!(index.entries[0].source.as_deref(), Some("chat-1"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn duplicate_content_supersedes_old() {
        let root = temp_root("supersede");
        add_memory_entry(&root, "统一使用 Redis，不再使用 database queue", "architecture", None, None).await.unwrap();
        let second = add_memory_entry(&root, "统一使用 Redis，不再使用 database queue", "architecture", None, None).await.unwrap();
        assert_eq!(second.superseded.len(), 1);
        let index = read_memory_index(&root).await;
        let active = active_memory_entries(&index);
        assert_eq!(active.len(), 1, "duplicate should leave one active entry");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn substring_conflict_supersedes() {
        let root = temp_root("substring");
        add_memory_entry(&root, "生产环境 queue 统一使用 Redis", "architecture", None, None).await.unwrap();
        let second = add_memory_entry(&root, "生产环境 queue 统一使用 Redis，禁止 database queue", "architecture", None, None).await.unwrap();
        assert_eq!(second.superseded.len(), 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn different_decisions_both_survive() {
        let root = temp_root("noconflict");
        add_memory_entry(&root, "以后使用 Redis", "decision", None, None).await.unwrap();
        let second = add_memory_entry(&root, "以后使用 RabbitMQ", "decision", None, None).await.unwrap();
        assert!(second.superseded.is_empty(), "unrelated decisions must not clobber each other");
        let index = read_memory_index(&root).await;
        assert_eq!(active_memory_entries(&index).len(), 2);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn scope_cap_archives_oldest() {
        let root = temp_root("cap");
        let small: Vec<String> = (0..(MEMORY_MAX_ACTIVE_PER_SCOPE + 2))
            .map(|i| format!("fact-{i:03}"))
            .collect();
        let mut archived_total = 0usize;
        for (i, content) in small.iter().enumerate() {
            let res = add_memory_entry(&root, content, "fact", None, None).await.unwrap();
            if i >= MEMORY_MAX_ACTIVE_PER_SCOPE {
                archived_total += res.archived.len();
            }
        }
        let index = read_memory_index(&root).await;
        let active = active_memory_entries(&index);
        assert!(active.len() <= MEMORY_MAX_ACTIVE_PER_SCOPE);
        assert!(archived_total > 0);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn memory_path_detection() {
        assert!(is_memory_path(".aiall/memory/index.json"));
        assert!(is_memory_path(".aiall/memory"));
        assert!(is_memory_path(r"C:\project\.aiall\memory\foo.json"));
        assert!(!is_memory_path(".aiall/skills/foo.md"));
        assert!(!is_memory_path("src/main.rs"));
    }

    #[test]
    fn format_block_orders_freshest_first() {
        let mut old = MemoryEntry {
            id: "a".into(), content: "old fact".into(), scope: "fact".into(), source: None,
            created_at: "1".into(), updated_at: "1".into(), confidence: 0.9,
            superseded_by: None, active: true,
        };
        let mut fresh = old.clone();
        fresh.id = "b".into();
        fresh.content = "new fact".into();
        fresh.updated_at = "2".into();
        let index = MemoryIndex {
            version: 1,
            entries: vec![old.clone(), fresh.clone()],
        };
        let block = format_memory_block(&active_memory_entries(&index));
        assert!(block.contains("[fact] old fact"));
        assert!(block.contains("[fact] new fact"));
        assert!(block.contains("共 2 条"));
        let new_pos = block.find("new fact").unwrap();
        let old_pos = block.find("old fact").unwrap();
        assert!(new_pos < old_pos, "freshest entry must come first");
    }

    #[test]
    fn clean_session_removes_tool_markup() {
        let raw = "我先看下代码。\n<tool_invocation name=\"grep\" arguments=\"{\\\"pattern\\\":\\\"foo\\\"}\">\nxxx\n</tool_invocation>\n<tool_result>结果</tool_result>\n然后修改。";
        let cleaned = clean_session_content(raw);
        assert!(cleaned.contains("我先看下代码"));
        assert!(cleaned.contains("然后修改"));
        assert!(!cleaned.contains("tool_invocation"));
    }

    #[tokio::test]
    async fn delete_removes_single_entry() {
        let root = temp_root("delete");
        add_memory_entry(&root, "第一条记忆", "fact", None, None).await.unwrap();
        add_memory_entry(&root, "第二条记忆", "fact", None, None).await.unwrap();
        let index = read_memory_index(&root).await;
        assert_eq!(index.entries.len(), 2);
        let target = index.entries[0].id.clone();
        let deleted = delete_memory_entry(&root, &target).await.unwrap();
        assert!(deleted);
        let after = read_memory_index(&root).await;
        assert_eq!(after.entries.len(), 1);
        assert!(!after.entries.iter().any(|e| e.id == target));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn delete_missing_returns_false() {
        let root = temp_root("delete-missing");
        let deleted = delete_memory_entry(&root, "no-such-id").await.unwrap();
        assert!(!deleted);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn query_tokens_split_ascii_and_cjk() {
        let tokens = split_query_tokens("Laravel queue deadlock 锁竞争");
        assert!(tokens.iter().any(|t| t == "laravel"));
        assert!(tokens.iter().any(|t| t == "queue"));
        assert!(tokens.iter().any(|t| t == "锁竞争"));
    }

    #[tokio::test]
    async fn search_sessions_finds_matching_fragment() {
        let dir = std::env::temp_dir().join("opencode-memory-sessions-1");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let payload = serde_json::json!({
            "id": "sess-abc",
            "title": "queue 排查",
            "updatedAt": "2026-06-01T10:00:00.000Z",
            "messages": [
                { "role": "user", "content": "生产环境 queue 出现 deadlock，怎么排查？" },
                { "role": "assistant", "content": "先看这段分析。\n<tool_invocation name=\"grep\" arguments=\"{}\">\n噪音\n</tool_invocation>\n<tool_result>结果</tool_result>\n然后确认是锁竞争。" }
            ]
        });
        std::fs::write(dir.join("chat-sess-abc.json"), payload.to_string()).unwrap();

        let out = search_sessions_in_dir(&dir, "deadlock", 5).await.unwrap();
        assert!(out.contains("[会话 sess-abc]"));
        assert!(out.contains("queue 出现 deadlock"));
        assert!(!out.contains("tool_invocation"), "tool noise must be stripped");
        assert!(!out.contains("锁竞争"), "assistant grep noise removed");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn search_sessions_no_match_reports_empty() {
        let dir = std::env::temp_dir().join("opencode-memory-sessions-2");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let payload = serde_json::json!({
            "id": "sess-zzz",
            "messages": [ { "role": "user", "content": "随便聊聊" } ]
        });
        std::fs::write(dir.join("chat-sess-zzz.json"), payload.to_string()).unwrap();
        let out = search_sessions_in_dir(&dir, "redis", 5).await.unwrap();
        assert!(out.contains("未找到"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn search_sessions_empty_dir() {
        let dir = std::env::temp_dir().join("opencode-memory-sessions-3");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let out = search_sessions_in_dir(&dir, "foo", 5).await.unwrap();
        assert!(out.contains("没有可检索的历史会话"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn search_sessions_cjk_query_matches() {
        let dir = std::env::temp_dir().join("opencode-memory-sessions-4");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let payload = serde_json::json!({
            "id": "sess-cjk",
            "messages": [ { "role": "user", "content": "我们讨论过锁竞争问题" } ]
        });
        std::fs::write(dir.join("chat-sess-cjk.json"), payload.to_string()).unwrap();
        let out = search_sessions_in_dir(&dir, "锁竞争", 5).await.unwrap();
        assert!(out.contains("[会话 sess-cjk]"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
