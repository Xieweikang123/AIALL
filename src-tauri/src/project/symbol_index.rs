use crate::fs::{is_text_extension, should_list_directory_entry};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

const MAX_FILE_BYTES: u64 = 512 * 1024;
const MAX_INDEX_FILES: usize = 8_000;
const CACHE_TTL: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolEntry {
    pub name: String,
    pub kind: String,
    pub file: String,
    pub line: u32,
    pub container: Option<String>,
}

#[derive(Clone)]
struct CachedIndex {
    built_at: Instant,
    symbols: Vec<SymbolEntry>,
}

static INDEX_CACHE: LazyLock<Mutex<HashMap<String, CachedIndex>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

static TS_PATTERNS: &[(&str, &str)] = &[
    (
        r"(?m)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)",
        "function",
    ),
    (r"(?m)(?:export\s+)?class\s+([A-Za-z_$][\w$]*)", "class"),
    (
        r"(?m)(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)",
        "interface",
    ),
    (r"(?m)(?:export\s+)?type\s+([A-Za-z_$][\w$]*)", "type"),
    (r"(?m)(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)", "enum"),
    (r"(?m)(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=", "const"),
    (
        r"(?m)(?:export\s+)?(?:let|var)\s+([A-Za-z_$][\w$]*)\s*=",
        "variable",
    ),
];

static RUST_PATTERNS: &[(&str, &str)] = &[
    (
        r"(?m)^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)",
        "function",
    ),
    (
        r"(?m)^(?:pub\s+)?struct\s+([A-Za-z_][A-Za-z0-9_]*)",
        "struct",
    ),
    (r"(?m)^(?:pub\s+)?enum\s+([A-Za-z_][A-Za-z0-9_]*)", "enum"),
    (r"(?m)^(?:pub\s+)?trait\s+([A-Za-z_][A-Za-z0-9_]*)", "trait"),
    (r"(?m)^(?:pub\s+)?type\s+([A-Za-z_][A-Za-z0-9_]*)", "type"),
    (r"(?m)^(?:pub\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)", "const"),
];

fn patterns_for_ext(ext: &str) -> &'static [(&'static str, &'static str)] {
    if ext == "rs" {
        RUST_PATTERNS
    } else {
        TS_PATTERNS
    }
}

fn line_number_at(content: &str, byte_offset: usize) -> u32 {
    (content[..byte_offset.min(content.len())]
        .bytes()
        .filter(|b| *b == b'\n')
        .count() as u32)
        + 1
}

fn extract_symbols_from_content(relative: &str, content: &str, ext: &str) -> Vec<SymbolEntry> {
    let mut out = Vec::new();
    for (pattern, kind) in patterns_for_ext(ext) {
        let Ok(re) = regex::Regex::new(pattern) else {
            continue;
        };
        for cap in re.captures_iter(content) {
            let Some(name_match) = cap.get(1) else {
                continue;
            };
            let name = name_match.as_str().to_string();
            if name.len() < 2 {
                continue;
            }
            out.push(SymbolEntry {
                name,
                kind: (*kind).to_string(),
                file: relative.to_string(),
                line: line_number_at(content, name_match.start()),
                container: None,
            });
        }
    }
    out
}

fn collect_index_files(root: &Path, dir: &Path, files: &mut Vec<PathBuf>, count: &mut usize) {
    if *count >= MAX_INDEX_FILES {
        return;
    }
    let Ok(read) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in read.flatten() {
        if *count >= MAX_INDEX_FILES {
            break;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if !should_list_directory_entry(&name, is_dir) {
            continue;
        }
        let path = entry.path();
        if is_dir {
            collect_index_files(root, &path, files, count);
        } else {
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if is_text_extension(&format!(".{ext}")) {
                files.push(path);
                *count += 1;
            }
        }
    }
}

fn build_symbol_index(project_path: &str) -> Vec<SymbolEntry> {
    let root = Path::new(project_path);
    let mut files = Vec::new();
    let mut count = 0;
    collect_index_files(root, root, &mut files, &mut count);

    let mut symbols = Vec::new();
    for abs in files {
        let Ok(meta) = std::fs::metadata(&abs) else {
            continue;
        };
        if meta.len() > MAX_FILE_BYTES {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&abs) else {
            continue;
        };
        let relative = abs
            .strip_prefix(root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| abs.to_string_lossy().replace('\\', "/"));
        let ext = abs
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        symbols.extend(extract_symbols_from_content(&relative, &content, &ext));
    }
    symbols
}

fn cached_index(project_path: &str) -> Vec<SymbolEntry> {
    let key = project_path.replace('\\', "/");
    {
        let cache = INDEX_CACHE.lock().unwrap();
        if let Some(entry) = cache.get(&key) {
            if entry.built_at.elapsed() < CACHE_TTL {
                return entry.symbols.clone();
            }
        }
    }
    let symbols = build_symbol_index(project_path);
    let mut cache = INDEX_CACHE.lock().unwrap();
    cache.insert(
        key,
        CachedIndex {
            built_at: Instant::now(),
            symbols: symbols.clone(),
        },
    );
    symbols
}

pub fn project_symbol_search(
    project_path: &str,
    query: &str,
    max_results: usize,
) -> Vec<SymbolEntry> {
    let q = query.trim().to_ascii_lowercase();
    if q.is_empty() {
        return Vec::new();
    }
    let max = max_results.clamp(1, 80);
    let symbols = cached_index(project_path);
    let mut scored: Vec<(i32, SymbolEntry)> = symbols
        .into_iter()
        .filter_map(|entry| {
            let name_lower = entry.name.to_ascii_lowercase();
            let file_lower = entry.file.to_ascii_lowercase();
            let score = if name_lower == q {
                100
            } else if name_lower.starts_with(&q) {
                80
            } else if name_lower.contains(&q) {
                60
            } else if file_lower.contains(&q) {
                30
            } else {
                return None;
            };
            Some((score, entry))
        })
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.name.cmp(&b.1.name)));
    scored.into_iter().take(max).map(|(_, e)| e).collect()
}

pub fn format_symbol_search_results(entries: &[SymbolEntry]) -> String {
    if entries.is_empty() {
        return "（无匹配符号）".into();
    }
    entries
        .iter()
        .map(|e| format!("{} {} · {}:{}", e.kind, e.name, e.file, e.line))
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_typescript_symbols() {
        let content = "export function hello() {}\nexport class Foo {}\nconst bar = 1;";
        let symbols = extract_symbols_from_content("src/a.ts", content, "ts");
        let names: Vec<&str> = symbols.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"hello"));
        assert!(names.contains(&"Foo"));
        assert!(names.contains(&"bar"));
    }

    #[test]
    fn search_ranks_exact_match_higher() {
        let dir = std::env::temp_dir().join("aiall-symbol-index-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(
            dir.join("src/util.ts"),
            "export function formatPendingApprovalLabel() {}\nexport function formatOther() {}",
        )
        .unwrap();
        let results =
            project_symbol_search(dir.to_str().unwrap(), "formatPendingApprovalLabel", 10);
        assert!(!results.is_empty());
        assert_eq!(results[0].name, "formatPendingApprovalLabel");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
