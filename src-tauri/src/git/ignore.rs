use super::exec::git_exec;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitIgnoreLocalResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignored: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Mark tracked paths as `--skip-worktree` so their local edits stop
/// appearing in `git status` and cannot be accidentally staged/committed.
/// Local changes are preserved on disk.
pub async fn git_ignore_local_changes(
    project_root: &str,
    files: Vec<String>,
) -> GitIgnoreLocalResult {
    let (tracked, skipped) = split_tracked_paths(project_root, &files).await;
    if tracked.is_empty() {
        return GitIgnoreLocalResult {
            ok: false,
            ignored: None,
            error: Some(format_ignored_hint(&skipped)),
        };
    }
    match run_update_index(project_root, "--skip-worktree", &tracked).await {
        Ok(()) => GitIgnoreLocalResult {
            ok: true,
            ignored: Some(tracked),
            error: None,
        },
        Err(error) => GitIgnoreLocalResult {
            ok: false,
            ignored: None,
            error: Some(error),
        },
    }
}

/// Remove the `--skip-worktree` flag so the file participates in status/commit again.
pub async fn git_unignore_local_changes(
    project_root: &str,
    files: Vec<String>,
) -> GitIgnoreLocalResult {
    if files.is_empty() {
        return GitIgnoreLocalResult {
            ok: false,
            ignored: None,
            error: Some("未指定文件".into()),
        };
    }
    match run_update_index(project_root, "--no-skip-worktree", &files).await {
        Ok(()) => GitIgnoreLocalResult {
            ok: true,
            ignored: Some(files),
            error: None,
        },
        Err(error) => GitIgnoreLocalResult {
            ok: false,
            ignored: None,
            error: Some(error),
        },
    }
}

/// List currently `--skip-worktree` tracked paths via `ls-files -v` (flag `S`).
pub async fn git_list_ignored_local_changes(project_root: &str) -> GitIgnoreLocalResult {
    let paths = match git_exec(
        project_root,
        &["ls-files", "-v", "--", "."],
    )
    .await
    {
        Ok(out) => parse_skip_worktree_paths(&out.stdout),
        Err(error) => {
            return GitIgnoreLocalResult {
                ok: false,
                ignored: None,
                error: Some(error),
            };
        }
    };
    GitIgnoreLocalResult {
        ok: true,
        ignored: Some(paths),
        error: None,
    }
}

fn parse_skip_worktree_paths(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim_start();
            if trimmed.starts_with('S') {
                Some(trimmed[1..].trim_start_matches(' ').to_string())
            } else {
                None
            }
        })
        .collect()
}

async fn split_tracked_paths(project_root: &str, files: &[String]) -> (Vec<String>, Vec<String>) {
    let mut tracked = Vec::new();
    let mut skipped = Vec::new();
    for file in files {
        let ok = git_exec(project_root, &["ls-files", "--error-unmatch", "--", file])
            .await
            .is_ok();
        if ok {
            tracked.push(file.clone());
        } else {
            skipped.push(file.clone());
        }
    }
    (tracked, skipped)
}

async fn run_update_index(
    project_root: &str,
    flag: &str,
    files: &[String],
) -> Result<(), String> {
    let mut args = vec!["update-index", flag, "--"];
    for f in files {
        args.push(f.as_str());
    }
    git_exec(project_root, &args).await.map(|_| ())
}

fn format_ignored_hint(untracked: &[String]) -> String {
    if untracked.is_empty() {
        "没有可忽略的文件（仅支持已跟踪文件）".into()
    } else {
        format!(
            "以下文件未跟踪或不在仓库中，无法忽略：{}",
            untracked.join("、")
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_skip_worktree_lines() {
        let out = "H src/main.rs\nS src/local.conf\nS src/debug.rs\n";
        let paths = parse_skip_worktree_paths(out);
        assert_eq!(paths, vec!["src/local.conf", "src/debug.rs"]);
    }

    #[test]
    fn parses_empty_output() {
        assert!(parse_skip_worktree_paths("").is_empty());
    }

    #[test]
    fn ignores_non_skip_flags() {
        let out = "H a.rs\nM b.rs\nS c.rs\n";
        assert_eq!(parse_skip_worktree_paths(out), vec!["c.rs"]);
    }

    #[test]
    fn hint_covers_untracked_paths() {
        assert_eq!(format_ignored_hint(&[]), "没有可忽略的文件（仅支持已跟踪文件）");
        let hint = format_ignored_hint(&["a.txt".into()]);
        assert!(hint.contains("a.txt"));
    }
}
