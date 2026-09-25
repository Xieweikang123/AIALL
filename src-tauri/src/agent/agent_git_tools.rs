use crate::git;

const MAX_PATCH_CHARS: usize = 8000;

pub fn parse_git_virtual_path(input_path: &str) -> Option<GitVirtualPath> {
    let trimmed = input_path.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(rest) = trimmed
        .strip_prefix("git-index://")
        .or_else(|| trimmed.strip_prefix("git-index:/"))
    {
        let relative = rest.trim().replace('\\', "/");
        if !relative.is_empty() {
            return Some(GitVirtualPath {
                kind: "index".into(),
                relative,
            });
        }
    }
    if let Some(rest) = trimmed
        .strip_prefix("git-history://")
        .or_else(|| trimmed.strip_prefix("git-history:/"))
    {
        let relative = rest.trim().replace('\\', "/");
        if !relative.is_empty() {
            return Some(GitVirtualPath {
                kind: "history".into(),
                relative,
            });
        }
    }
    None
}

pub struct GitVirtualPath {
    pub kind: String,
    pub relative: String,
}

fn status_label(file: &git::GitStatusFile) -> String {
    let code = if file.staged {
        &file.index_status
    } else {
        &file.worktree_status
    };
    if file.status == "untracked" {
        return "??".into();
    }
    if file.status == "ignored" {
        return "!!".into();
    }
    let trimmed = code.trim();
    if trimmed.is_empty() {
        file.status
            .chars()
            .next()
            .map(|c| c.to_uppercase().to_string())
            .unwrap_or_default()
    } else {
        trimmed.to_string()
    }
}

fn normalize_rel(path: &str) -> String {
    path.trim().replace('\\', "/").trim_matches('/').to_string()
}

fn with_path_prefix(prefix: &str, path: &str) -> String {
    let p = normalize_rel(path);
    if prefix.is_empty() {
        p
    } else if p.is_empty() {
        normalize_rel(prefix)
    } else {
        format!("{}/{}", normalize_rel(prefix), p)
    }
}

/// Match a project-relative path to the longest nested-repo `rel_path` prefix.
/// Returns `(repo, path_inside_repo)`.
fn resolve_path_to_repo<'a>(
    repos: &'a [git::GitRepoInfo],
    file_path: &str,
) -> Option<(&'a git::GitRepoInfo, String)> {
    let norm = normalize_rel(file_path);
    if norm.is_empty() {
        return None;
    }
    let mut best: Option<(&git::GitRepoInfo, String)> = None;
    let mut best_len = 0usize;
    for repo in repos {
        let rel = normalize_rel(&repo.rel_path);
        if rel.is_empty() {
            // Project-root repo: path stays as-is when no better nested match.
            if best.is_none() {
                best = Some((repo, norm.clone()));
                best_len = 0;
            }
            continue;
        }
        if norm == rel || norm.starts_with(&format!("{rel}/")) {
            if rel.len() >= best_len {
                let inside = if norm == rel {
                    String::new()
                } else {
                    norm[rel.len() + 1..].to_string()
                };
                best = Some((repo, inside));
                best_len = rel.len();
            }
        }
    }
    best
}

pub fn format_git_status_for_agent(status: &git::GitStatusResult) -> String {
    format_git_status_for_agent_prefixed(status, "")
}

fn format_git_status_for_agent_prefixed(status: &git::GitStatusResult, path_prefix: &str) -> String {
    if !status.ok {
        return format!(
            "错误：{}",
            status.error.as_deref().unwrap_or("获取 Git 状态失败")
        );
    }
    if status.is_repo == Some(false) {
        return "项目根不是 Git 仓库。".into();
    }
    let mut lines: Vec<String> = vec![];
    lines.push(format!(
        "分支：{}",
        if status.branch.is_empty() {
            "（无分支）"
        } else {
            &status.branch
        }
    ));
    if !status.head_commit.is_empty() {
        lines.push(format!(
            "HEAD：{}",
            &status.head_commit[..status.head_commit.len().min(12)]
        ));
    }
    if status.files.is_empty() {
        lines.push("工作区干净，无待提交变更。".into());
        return lines.join("\n");
    }

    let staged: Vec<&git::GitStatusFile> = status.files.iter().filter(|f| f.staged).collect();
    let unstaged: Vec<&git::GitStatusFile> = status
        .files
        .iter()
        .filter(|f| !f.staged && f.status != "untracked" && f.status != "ignored")
        .collect();
    let untracked: Vec<&git::GitStatusFile> = status
        .files
        .iter()
        .filter(|f| f.status == "untracked")
        .collect();

    if !staged.is_empty() {
        lines.push(format!("已暂存（{}）：", staged.len()));
        for f in &staged {
            lines.push(format!(
                "  {} {}",
                status_label(f),
                with_path_prefix(path_prefix, &f.path)
            ));
        }
    }
    if !unstaged.is_empty() {
        lines.push(format!("未暂存（{}）：", unstaged.len()));
        for f in &unstaged {
            lines.push(format!(
                "  {} {}",
                status_label(f),
                with_path_prefix(path_prefix, &f.path)
            ));
        }
    }
    if !untracked.is_empty() {
        lines.push(format!("未跟踪（{}）：", untracked.len()));
        for f in &untracked {
            lines.push(format!(
                "  ?? {}",
                with_path_prefix(path_prefix, &f.path)
            ));
        }
    }
    lines.join("\n")
}

fn truncate_patch(patch: &str) -> String {
    let trimmed = patch.trim();
    if trimmed.is_empty() {
        return "（无 diff 输出）".into();
    }
    // 按字符数截断，避免 &trimmed[..N] 把多字节字符切成两半而 panic。
    if trimmed.chars().count() <= MAX_PATCH_CHARS {
        return trimmed.to_string();
    }
    crate::agent::classifier::truncate_chars_suffix(
        trimmed,
        MAX_PATCH_CHARS,
        &format!("\n…（diff 已截断，共 {} 字符）", trimmed.chars().count()),
    )
}

fn format_single_repo_diff(
    scope: &str,
    file_path: Option<&str>,
    result: &git::GitDiffResult,
    path_prefix: &str,
) -> String {
    if !result.ok {
        return format!(
            "错误：{}",
            result.error.as_deref().unwrap_or("获取 diff 失败")
        );
    }
    if let Some(fp) = file_path {
        let display = with_path_prefix(path_prefix, fp);
        let stat = result
            .files
            .first()
            .map(|f| format!("+{}/-{}", f.additions, f.deletions))
            .unwrap_or_default();
        let header = vec![
            format!("文件：{display}"),
            format!("范围：{scope}"),
            if stat.is_empty() {
                String::new()
            } else {
                format!("统计：{stat}")
            },
        ]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
        return format!("{header}\n\n{}", truncate_patch(&result.patch));
    }

    if result.files.is_empty() && result.patch.trim().is_empty() {
        return format!("（{scope} 无变更）");
    }
    let stat_lines: Vec<String> = result
        .files
        .iter()
        .map(|f| {
            format!(
                "  {} | +{} -{}",
                with_path_prefix(path_prefix, &f.path),
                f.additions,
                f.deletions
            )
        })
        .collect();
    let header = vec![format!("范围：{scope}"), "变更文件：".into()]
        .into_iter()
        .chain(stat_lines.into_iter())
        .collect::<Vec<_>>()
        .join("\n");
    format!("{header}\n\n{}", truncate_patch(&result.patch))
}

fn needs_nested_aggregation(repos: &[git::GitRepoInfo]) -> bool {
    if repos.is_empty() {
        return false;
    }
    if repos.len() == 1 && repos[0].is_root && repos[0].rel_path.is_empty() {
        return false;
    }
    // Only nested children, or multiple repos (root + children / several children).
    true
}

pub async fn run_git_status_tool(project_root: &str) -> String {
    let listed = git::git_list_repos(project_root).await;
    if !listed.ok {
        return format!(
            "错误：{}",
            listed.error.as_deref().unwrap_or("列举 Git 仓库失败")
        );
    }
    let repos = listed.repos;
    if repos.is_empty() {
        return "项目根不是 Git 仓库。".into();
    }
    if !needs_nested_aggregation(&repos) {
        let status = git::git_status(project_root).await;
        return format_git_status_for_agent(&status);
    }

    let mut sections: Vec<String> = Vec::new();
    sections.push(format!("检测到 {} 个 Git 仓库：", repos.len()));
    for repo in &repos {
        let label = if repo.rel_path.is_empty() {
            ".（项目根）".to_string()
        } else {
            repo.rel_path.replace('\\', "/")
        };
        let status = git::git_status(&repo.path).await;
        let body = format_git_status_for_agent_prefixed(&status, &repo.rel_path);
        sections.push(format!("### 仓库：{label}\n{body}"));
    }
    sections.join("\n\n")
}

pub async fn run_git_diff_tool(
    project_root: &str,
    file_path: Option<&str>,
    staged: bool,
) -> String {
    let scope = if staged {
        "已暂存"
    } else {
        "未暂存/工作区"
    };

    let listed = git::git_list_repos(project_root).await;
    let repos = if listed.ok {
        listed.repos
    } else {
        Vec::new()
    };

    if let Some(fp) = file_path {
        if !repos.is_empty() {
            if let Some((repo, inside)) = resolve_path_to_repo(&repos, fp) {
                let inside_opt = if inside.is_empty() {
                    None
                } else {
                    Some(inside.as_str())
                };
                let result = git::git_diff(&repo.path, inside_opt, staged).await;
                // Display the original project-relative path in the header.
                return format_single_repo_diff(scope, Some(fp), &result, "");
            }
        }
        let result = git::git_diff(project_root, Some(fp), staged).await;
        return format_single_repo_diff(scope, Some(fp), &result, "");
    }

    if repos.is_empty() || !needs_nested_aggregation(&repos) {
        let result = git::git_diff(project_root, None, staged).await;
        return format_single_repo_diff(scope, None, &result, "");
    }

    let mut sections: Vec<String> = Vec::new();
    let mut combined_patch = String::new();
    let mut any_change = false;
    sections.push(format!("范围：{scope}（多仓）"));
    sections.push(format!("仓库数：{}", repos.len()));

    for repo in &repos {
        let label = if repo.rel_path.is_empty() {
            ".（项目根）".to_string()
        } else {
            repo.rel_path.replace('\\', "/")
        };
        let result = git::git_diff(&repo.path, None, staged).await;
        if !result.ok {
            sections.push(format!(
                "### 仓库：{label}\n错误：{}",
                result.error.as_deref().unwrap_or("获取 diff 失败")
            ));
            continue;
        }
        if result.files.is_empty() && result.patch.trim().is_empty() {
            sections.push(format!("### 仓库：{label}\n（无变更）"));
            continue;
        }
        any_change = true;
        let file_lines: Vec<String> = result
            .files
            .iter()
            .map(|f| {
                format!(
                    "  {} | +{} -{}",
                    with_path_prefix(&repo.rel_path, &f.path),
                    f.additions,
                    f.deletions
                )
            })
            .collect();
        sections.push(format!(
            "### 仓库：{label}\n变更文件：\n{}",
            file_lines.join("\n")
        ));
        if !result.patch.trim().is_empty() {
            if !combined_patch.is_empty() {
                combined_patch.push_str("\n\n");
            }
            combined_patch.push_str(&format!("# repo: {label}\n"));
            combined_patch.push_str(result.patch.trim());
        }
    }

    if !any_change {
        return format!("（{scope} 无变更）");
    }
    format!("{}\n\n{}", sections.join("\n\n"), truncate_patch(&combined_patch))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn test_parse_git_virtual_path_index() {
        let result = parse_git_virtual_path("git-index://src/foo.ts");
        assert!(result.is_some());
        let p = result.unwrap();
        assert_eq!(p.kind, "index");
        assert_eq!(p.relative, "src/foo.ts");
    }

    #[test]
    fn test_parse_git_virtual_path_history() {
        let result = parse_git_virtual_path("git-history:/bar/baz.rs");
        assert!(result.is_some());
        let p = result.unwrap();
        assert_eq!(p.kind, "history");
        assert_eq!(p.relative, "bar/baz.rs");
    }

    #[test]
    fn test_parse_git_virtual_path_invalid() {
        assert!(parse_git_virtual_path("").is_none());
        assert!(parse_git_virtual_path("   ").is_none());
        assert!(parse_git_virtual_path("regular/path.ts").is_none());
    }

    #[test]
    fn test_format_git_status_ok_clean() {
        let status = git::GitStatusResult {
            ok: true,
            is_repo: Some(true),
            branch: "main".into(),
            head_commit: "abc123def456".into(),
            files: vec![],
            staged_count: 0,
            unstaged_count: 0,
            error: None,
        };
        let output = format_git_status_for_agent(&status);
        assert!(output.contains("main"));
        assert!(output.contains("干净"));
    }

    #[test]
    fn test_format_git_status_not_a_repo() {
        let status = git::GitStatusResult {
            ok: true,
            is_repo: Some(false),
            branch: String::new(),
            head_commit: String::new(),
            files: vec![],
            staged_count: 0,
            unstaged_count: 0,
            error: None,
        };
        let output = format_git_status_for_agent(&status);
        assert!(output.contains("不是 Git 仓库"));
        assert!(!output.contains("干净"));
    }

    #[test]
    fn test_format_git_status_error() {
        let status = git::GitStatusResult {
            ok: false,
            is_repo: Some(false),
            branch: String::new(),
            head_commit: String::new(),
            files: vec![],
            staged_count: 0,
            unstaged_count: 0,
            error: Some("not a git repo".into()),
        };
        let output = format_git_status_for_agent(&status);
        assert!(output.contains("错误"));
        assert!(output.contains("not a git repo"));
    }

    #[test]
    fn test_truncate_patch_empty() {
        assert_eq!(truncate_patch("  "), "（无 diff 输出）");
    }

    #[test]
    fn test_truncate_patch_short() {
        assert_eq!(truncate_patch("diff --git a/x b/x"), "diff --git a/x b/x");
    }

    #[test]
    fn test_truncate_patch_long() {
        let long = "a".repeat(10000);
        let result = truncate_patch(&long);
        assert!(result.contains("截断"));
        assert!(result.len() < long.len() + 50);
    }

    #[test]
    fn test_status_label_untracked() {
        let f = git::GitStatusFile {
            path: "new.ts".into(),
            old_path: None,
            status: "untracked".into(),
            index_status: "?".into(),
            worktree_status: "?".into(),
            staged: false,
        };
        assert_eq!(status_label(&f), "??");
    }

    #[test]
    fn test_status_label_staged() {
        let f = git::GitStatusFile {
            path: "a.ts".into(),
            old_path: None,
            status: "modified".into(),
            index_status: "M".into(),
            worktree_status: " ".into(),
            staged: true,
        };
        assert_eq!(status_label(&f), "M");
    }

    #[test]
    fn test_resolve_path_to_repo_longest_prefix() {
        let repos = vec![
            git::GitRepoInfo {
                path: "/ws/web".into(),
                name: "web".into(),
                rel_path: "web".into(),
                is_root: false,
            },
            git::GitRepoInfo {
                path: "/ws/web/pkg".into(),
                name: "pkg".into(),
                rel_path: "web/pkg".into(),
                is_root: false,
            },
        ];
        let (repo, inside) = resolve_path_to_repo(&repos, "web/pkg/src/a.ts").unwrap();
        assert_eq!(repo.rel_path, "web/pkg");
        assert_eq!(inside, "src/a.ts");
        let (repo2, inside2) = resolve_path_to_repo(&repos, "web/src/b.ts").unwrap();
        assert_eq!(repo2.rel_path, "web");
        assert_eq!(inside2, "src/b.ts");
    }

    fn init_git_repo(dir: &std::path::Path) {
        std::fs::create_dir_all(dir).unwrap();
        let status = Command::new("git")
            .args(["init"])
            .current_dir(dir)
            .status()
            .expect("git init");
        assert!(status.success());
        let _ = Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(dir)
            .status();
        let _ = Command::new("git")
            .args(["config", "user.name", "test"])
            .current_dir(dir)
            .status();
    }

    #[tokio::test]
    async fn test_run_git_status_nested_repos_prefix() {
        let base = std::env::temp_dir().join(format!(
            "aiall-nested-status-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let web = base.join("frontend");
        let api = base.join("backend");
        init_git_repo(&web);
        init_git_repo(&api);
        std::fs::write(web.join("app.ts"), "console.log(1)\n").unwrap();
        std::fs::write(api.join("main.rs"), "fn main() {}\n").unwrap();

        let out = run_git_status_tool(base.to_str().unwrap()).await;
        assert!(
            out.contains("frontend") && out.contains("backend"),
            "expected both repos in output, got: {out}"
        );
        assert!(
            out.contains("frontend/app.ts") || out.contains("?? frontend/app.ts"),
            "expected prefixed frontend path, got: {out}"
        );
        assert!(
            out.contains("backend/main.rs") || out.contains("?? backend/main.rs"),
            "expected prefixed backend path, got: {out}"
        );
        assert!(!out.contains("干净") || out.matches("仓库").count() >= 1);

        let _ = std::fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn test_run_git_diff_resolves_nested_path() {
        let base = std::env::temp_dir().join(format!(
            "aiall-nested-diff-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let web = base.join("frontend");
        init_git_repo(&web);
        std::fs::write(web.join("app.ts"), "console.log(1)\n").unwrap();
        let add = Command::new("git")
            .args(["add", "app.ts"])
            .current_dir(&web)
            .status()
            .unwrap();
        assert!(add.success());
        let commit = Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(&web)
            .status()
            .unwrap();
        assert!(commit.success());
        std::fs::write(web.join("app.ts"), "console.log(2)\n").unwrap();

        let out = run_git_diff_tool(
            base.to_str().unwrap(),
            Some("frontend/app.ts"),
            false,
        )
        .await;
        assert!(
            out.contains("文件：frontend/app.ts") || out.contains("app.ts"),
            "expected nested file diff, got: {out}"
        );
        assert!(
            !out.contains("Not a git repository") && !out.starts_with("错误："),
            "diff should succeed against nested repo, got: {out}"
        );

        let _ = std::fs::remove_dir_all(&base);
    }
}
