use super::{is_text_extension, should_list_directory_entry};
use regex::Regex;
use serde::Serialize;
use std::path::Path;
use std::sync::LazyLock;

static RG_LINE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(.+?):(\d+):(.*)$").unwrap());
static SKIP_GREP_PATH_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"node_modules|(^|/)dist/|(^|/)\.git/|(^|/)build/|(^|/)coverage/").unwrap()
});

const RG_SKIP_GLOBS: &[&str] = &[
    "!node_modules/**",
    "!dist/**",
    "!.git/**",
    "!build/**",
    "!coverage/**",
];
use tokio::fs;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct GrepMatch {
    pub file: String,
    pub relative: String,
    pub line: u32,
    pub text: String,
}

pub(crate) fn should_skip_grep_relative(relative: &str) -> bool {
    SKIP_GREP_PATH_RE.is_match(relative)
}

pub async fn grep_in_project(
    project_root: &str,
    pattern: &str,
    max_matches: usize,
) -> Result<Vec<GrepMatch>, String> {
    let query = pattern.trim();
    if query.is_empty() {
        return Err("搜索内容不能为空".into());
    }
    let max_count = max_matches.to_string();
    let mut rg_args = vec!["-n", "--max-count", max_count.as_str()];
    for glob in RG_SKIP_GLOBS {
        rg_args.push("--glob");
        rg_args.push(glob);
    }
    rg_args.push(query);
    rg_args.push(project_root);

    let output = Command::new("rg").args(rg_args).output().await;

    match output {
        Ok(out) if out.status.success() || out.status.code() == Some(1) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            Ok(parse_rg_output(&stdout, project_root, max_matches))
        }
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            if !stdout.trim().is_empty() {
                return Ok(parse_rg_output(&stdout, project_root, max_matches));
            }
            grep_in_project_node(project_root, query, max_matches).await
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            grep_in_project_node(project_root, query, max_matches).await
        }
        Err(e) => Err(format!("grep 失败: {e}")),
    }
}

pub(crate) fn parse_rg_output(output: &str, root: &str, max_matches: usize) -> Vec<GrepMatch> {
    let root_path = Path::new(root);
    let mut matches = Vec::new();
    for line in output.lines() {
        if matches.len() >= max_matches {
            break;
        }
        if let Some(caps) = RG_LINE_RE.captures(line) {
            let file = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let relative = Path::new(file)
                .strip_prefix(root_path)
                .unwrap_or(Path::new(file))
                .to_string_lossy()
                .replace('\\', "/");
            if should_skip_grep_relative(&relative) {
                continue;
            }
            matches.push(GrepMatch {
                file: file.to_string(),
                relative,
                line: caps
                    .get(2)
                    .and_then(|m| m.as_str().parse().ok())
                    .unwrap_or(0),
                text: caps
                    .get(3)
                    .map(|m| m.as_str())
                    .unwrap_or("")
                    .trim()
                    .chars()
                    .take(200)
                    .collect(),
            });
        }
    }
    matches
}

async fn grep_in_project_node(
    root: &str,
    pattern: &str,
    max_matches: usize,
) -> Result<Vec<GrepMatch>, String> {
    let regex = Regex::new(pattern)
        .or_else(|_| Regex::new(&regex::escape(pattern)))
        .map_err(|e| e.to_string())?;
    let mut matches = Vec::new();
    walk_grep(
        Path::new(root),
        Path::new(root),
        &regex,
        0,
        max_matches,
        &mut matches,
    )
    .await;
    Ok(matches)
}

async fn walk_grep(
    root: &Path,
    current: &Path,
    regex: &Regex,
    depth: usize,
    max_matches: usize,
    matches: &mut Vec<GrepMatch>,
) {
    if depth > 8 || matches.len() >= max_matches {
        return;
    }
    let mut entries = match fs::read_dir(current).await {
        Ok(e) => e,
        Err(_) => return,
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        if matches.len() >= max_matches {
            break;
        }
        let Ok(meta) = entry.metadata().await else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_directory = meta.is_dir();
        if !should_list_directory_entry(&name, is_directory) {
            continue;
        }
        let full = entry.path();
        if is_directory {
            Box::pin(walk_grep(
                root,
                &full,
                regex,
                depth + 1,
                max_matches,
                matches,
            ))
            .await;
            continue;
        }
        let relative = full
            .strip_prefix(root)
            .unwrap_or(&full)
            .to_string_lossy()
            .replace('\\', "/");
        if should_skip_grep_relative(&relative) {
            continue;
        }
        let ext = Path::new(&name)
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
            .unwrap_or_default();
        if !is_text_extension(&ext) {
            continue;
        }
        if meta.len() > 512 * 1024 {
            continue;
        }
        let Ok(content) = fs::read_to_string(&full).await else {
            continue;
        };
        for (i, line) in content.lines().enumerate() {
            if matches.len() >= max_matches {
                break;
            }
            if regex.is_match(line) {
                matches.push(GrepMatch {
                    file: full.to_string_lossy().into_owned(),
                    relative: full
                        .strip_prefix(root)
                        .unwrap_or(&full)
                        .to_string_lossy()
                        .replace('\\', "/"),
                    line: (i + 1) as u32,
                    text: line.trim().chars().take(200).collect(),
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_should_skip_grep_relative() {
        assert!(should_skip_grep_relative("node_modules/pkg/index.js"));
        assert!(should_skip_grep_relative("dist/bundle.js"));
        assert!(should_skip_grep_relative("src/.git/config"));
        assert!(!should_skip_grep_relative("src/main.rs"));
    }

    #[test]
    fn test_parse_rg_output_empty() {
        let result = parse_rg_output("", "/project", 100);
        assert!(result.is_empty());
    }

    #[test]
    fn test_parse_rg_output_standard_format() {
        let output = "src/main.rs:42:fn main() {\nsrc/lib.rs:10:pub fn hello()\n";
        let result = parse_rg_output(output, "/project", 100);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].file, "src/main.rs");
        assert_eq!(result[0].line, 42);
        assert_eq!(result[0].text, "fn main() {");
        assert_eq!(result[1].file, "src/lib.rs");
        assert_eq!(result[1].line, 10);
        assert_eq!(result[1].text, "pub fn hello()");
    }

    #[test]
    fn test_parse_rg_output_max_matches() {
        let output = "a:1:x\na:2:y\na:3:z\n";
        let result = parse_rg_output(output, "/project", 2);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_parse_rg_output_long_text_truncated() {
        let long = "x".repeat(250);
        let output = format!("f:1:{long}\n");
        let result = parse_rg_output(&output, "/project", 100);
        assert_eq!(result[0].text.len(), 200);
    }

    #[test]
    fn test_parse_rg_output_malformed_lines() {
        let output = "no_colon_or_line\n:2:only_file_empty\nfile::3:double_colon\n";
        let result = parse_rg_output(output, "/project", 100);
        assert!(result.len() <= 3);
    }

    #[test]
    fn test_parse_rg_output_relative_paths() {
        let output = "/home/user/project/src/main.rs:5:code\n";
        let result = parse_rg_output(output, "/home/user/project", 100);
        assert_eq!(result[0].relative, "src/main.rs");
    }

    #[test]
    fn test_parse_rg_output_windows_path_in_relative() {
        let output = "C:\\Users\\me\\project\\src\\main.rs:10:code\n";
        let result = parse_rg_output(output, "C:\\Users\\me\\project", 100);
        assert_eq!(result[0].relative, "src/main.rs");
    }

    #[test]
    fn test_parse_rg_output_special_chars_in_text() {
        let output = "file.rs:1:let x = \"hello world\" & 'foo';\n";
        let result = parse_rg_output(output, "/project", 100);
        assert_eq!(result[0].text, "let x = \"hello world\" & 'foo';");
    }
}
