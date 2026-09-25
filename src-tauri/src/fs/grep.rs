use super::is_text_extension;
use ignore::WalkBuilder;
use regex::Regex;
use serde::Serialize;
use std::path::Path;
use std::sync::LazyLock;

/// Hard safety net when `.gitignore` is missing or incomplete.
/// Prefer project ignore rules; do not treat this list as stack-specific playbooks.
/// Note: do not skip every `bin/` — Rust `src/bin` is source. Only skip common build outputs.
static SKIP_GREP_PATH_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?x)
        node_modules
        | (^|/)dist/
        | (^|/)\.git/
        | (^|/)build/
        | (^|/)coverage/
        | (^|/)target/
        | (^|/)obj/
        | (^|/)vendor/
        | (^|/)__pycache__/
        | (^|/)\.venv/
        | (^|/)venv/
        | (^|/)\.next/
        | (^|/)\.nuxt/
        | (^|/)\.cache/
        | (^|/)bin/(Debug|Release|x64|x86|AnyCPU)/
        | \.log$
        ",
    )
    .unwrap()
});

/// Directory names pruned early while walking (unambiguous junk / VCS).
const SKIP_DIR_NAMES: &[&str] = &[
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    "dist",
    "build",
    "coverage",
    "target",
    "obj",
    "vendor",
    "__pycache__",
    ".venv",
    "venv",
    ".next",
    ".nuxt",
    ".cache",
];

const MAX_GREP_FILE_BYTES: u64 = 512 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct GrepMatch {
    pub file: String,
    pub relative: String,
    pub line: u32,
    pub text: String,
}

pub(crate) fn should_skip_grep_relative(relative: &str) -> bool {
    let normalized = relative.replace('\\', "/");
    SKIP_GREP_PATH_RE.is_match(&normalized)
}

fn should_prune_dir_name(name: &str) -> bool {
    SKIP_DIR_NAMES.contains(&name)
}

pub async fn grep_in_project(
    project_root: &str,
    pattern: &str,
    max_matches: usize,
) -> Result<Vec<GrepMatch>, String> {
    let query = pattern.trim().to_string();
    if query.is_empty() {
        return Err("搜索内容不能为空".into());
    }
    let root = project_root.to_string();
    let max_matches = max_matches.max(1);
    tokio::task::spawn_blocking(move || grep_in_project_sync(&root, &query, max_matches))
        .await
        .map_err(|e| format!("grep 任务失败: {e}"))?
}

fn grep_in_project_sync(
    root: &str,
    pattern: &str,
    max_matches: usize,
) -> Result<Vec<GrepMatch>, String> {
    let regex = Regex::new(pattern)
        .or_else(|_| Regex::new(&regex::escape(pattern)))
        .map_err(|e| e.to_string())?;
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(format!("项目目录不存在: {root}"));
    }

    let mut matches = Vec::new();
    let walker = WalkBuilder::new(root_path)
        // Allow searching files like `.env` / `.gitignore`; `.git` is still pruned below.
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .parents(true)
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            if entry.depth() > 0 && entry.file_type().is_some_and(|t| t.is_dir()) {
                return !should_prune_dir_name(name.as_ref());
            }
            true
        })
        .build();

    for dent in walker {
        if matches.len() >= max_matches {
            break;
        }
        let Ok(dent) = dent else {
            continue;
        };
        let ft = match dent.file_type() {
            Some(t) => t,
            None => continue,
        };
        if !ft.is_file() {
            continue;
        }
        let full = dent.path();
        let relative = full
            .strip_prefix(root_path)
            .unwrap_or(full)
            .to_string_lossy()
            .replace('\\', "/");
        if should_skip_grep_relative(&relative) {
            continue;
        }
        let name = dent.file_name().to_string_lossy();
        let ext = Path::new(name.as_ref())
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
            .unwrap_or_default();
        // Extensionless text-ish configs (e.g. Dockerfile) are skipped; keep prior text-ext gate.
        if !ext.is_empty() && !is_text_extension(&ext) {
            continue;
        }
        if ext.is_empty() {
            continue;
        }
        let meta = match dent.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.len() > MAX_GREP_FILE_BYTES {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(full) else {
            continue;
        };
        for (i, line) in content.lines().enumerate() {
            if matches.len() >= max_matches {
                break;
            }
            if regex.is_match(line) {
                matches.push(GrepMatch {
                    file: full.to_string_lossy().into_owned(),
                    relative: relative.clone(),
                    line: (i + 1) as u32,
                    text: line.trim().chars().take(200).collect(),
                });
            }
        }
    }

    Ok(matches)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_project(name: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("aiall-grep-{name}-{nanos}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_should_skip_grep_relative() {
        assert!(should_skip_grep_relative("node_modules/pkg/index.js"));
        assert!(should_skip_grep_relative("dist/bundle.js"));
        assert!(should_skip_grep_relative("src/.git/config"));
        assert!(should_skip_grep_relative(
            "Mall.API/1.API/Admin.Api/bin/Debug/netcoreapp3.1/logs/request_audit.txt"
        ));
        assert!(should_skip_grep_relative("Api/obj/Debug/foo.cs"));
        assert!(should_skip_grep_relative("target/debug/build/out"));
        assert!(should_skip_grep_relative("server/app.log"));
        // Rust binary sources must remain searchable.
        assert!(!should_skip_grep_relative("src/bin/agent_server.rs"));
        assert!(!should_skip_grep_relative("src/main.rs"));
    }

    #[test]
    fn grep_respects_gitignore_and_finds_source() {
        let root = temp_project("gitignore");
        fs::write(root.join(".gitignore"), "bin/\nobj/\n*.log\n").unwrap();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("bin/Debug/logs")).unwrap();
        fs::write(
            root.join("src/WorkOrderController.cs"),
            "public async Task<object> GetWorkOrderPageList() {}\n",
        )
        .unwrap();
        fs::write(
            root.join("bin/Debug/logs/request_audit.txt"),
            "POST /api/WorkOrder/GetWorkOrderPageList | 200\n",
        )
        .unwrap();

        let hits = grep_in_project_sync(root.to_str().unwrap(), "GetWorkOrderPageList", 40).unwrap();
        assert_eq!(hits.len(), 1, "hits={hits:?}");
        assert!(hits[0].relative.contains("WorkOrderController.cs"));
        assert!(!hits.iter().any(|h| h.relative.contains("bin/")));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn grep_safety_net_skips_dotnet_bin_without_gitignore() {
        let root = temp_project("nogi");
        fs::create_dir_all(root.join("Controllers")).unwrap();
        fs::create_dir_all(root.join("bin/Debug/logs")).unwrap();
        fs::write(
            root.join("Controllers/WorkOrderController.cs"),
            "public void GetWorkOrderPageList() {}\n",
        )
        .unwrap();
        fs::write(
            root.join("bin/Debug/logs/request_audit.txt"),
            "GetWorkOrderPageList in audit log\n",
        )
        .unwrap();

        let hits = grep_in_project_sync(root.to_str().unwrap(), "GetWorkOrderPageList", 40).unwrap();
        assert_eq!(hits.len(), 1, "hits={hits:?}");
        assert!(hits[0].relative.replace('\\', "/").contains("Controllers/"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn grep_max_matches_caps_results() {
        let root = temp_project("cap");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/a.rs"), "HIT\nHIT\nHIT\n").unwrap();
        let hits = grep_in_project_sync(root.to_str().unwrap(), "HIT", 2).unwrap();
        assert_eq!(hits.len(), 2);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn grep_literal_fallback_for_invalid_regex() {
        let root = temp_project("lit");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/a.rs"), "foo(bar\n").unwrap();
        let hits = grep_in_project_sync(root.to_str().unwrap(), "foo(bar", 10).unwrap();
        assert_eq!(hits.len(), 1);
        let _ = fs::remove_dir_all(&root);
    }
}
