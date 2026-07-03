use crate::git;

const MAX_PATCH_CHARS: usize = 8000;

pub fn parse_git_virtual_path(input_path: &str) -> Option<GitVirtualPath> {
    let trimmed = input_path.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(rest) = trimmed.strip_prefix("git-index://").or_else(|| trimmed.strip_prefix("git-index:/")) {
        let relative = rest.trim().replace('\\', "/");
        if !relative.is_empty() {
            return Some(GitVirtualPath { kind: "index".into(), relative });
        }
    }
    if let Some(rest) = trimmed.strip_prefix("git-history://").or_else(|| trimmed.strip_prefix("git-history:/")) {
        let relative = rest.trim().replace('\\', "/");
        if !relative.is_empty() {
            return Some(GitVirtualPath { kind: "history".into(), relative });
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
        file.status.chars().next().map(|c| c.to_uppercase().to_string()).unwrap_or_default()
    } else {
        trimmed.to_string()
    }
}

pub fn format_git_status_for_agent(status: &git::GitStatusResult) -> String {
    if !status.ok {
        return format!(
            "错误：{}",
            status.error.as_deref().unwrap_or("获取 Git 状态失败")
        );
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
        lines.push(format!("HEAD：{}", &status.head_commit[..status.head_commit.len().min(12)]));
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
    let untracked: Vec<&git::GitStatusFile> =
        status.files.iter().filter(|f| f.status == "untracked").collect();

    if !staged.is_empty() {
        lines.push(format!("已暂存（{}）：", staged.len()));
        for f in &staged {
            lines.push(format!("  {} {}", status_label(f), f.path));
        }
    }
    if !unstaged.is_empty() {
        lines.push(format!("未暂存（{}）：", unstaged.len()));
        for f in &unstaged {
            lines.push(format!("  {} {}", status_label(f), f.path));
        }
    }
    if !untracked.is_empty() {
        lines.push(format!("未跟踪（{}）：", untracked.len()));
        for f in &untracked {
            lines.push(format!("  ?? {}", f.path));
        }
    }
    lines.join("\n")
}

fn truncate_patch(patch: &str) -> String {
    let trimmed = patch.trim();
    if trimmed.is_empty() {
        return "（无 diff 输出）".into();
    }
    if trimmed.len() <= MAX_PATCH_CHARS {
        return trimmed.to_string();
    }
    format!(
        "{}\n…（diff 已截断，共 {} 字符）",
        &trimmed[..MAX_PATCH_CHARS],
        trimmed.len()
    )
}

pub async fn run_git_status_tool(project_root: &str) -> String {
    let status = git::git_status(project_root).await;
    format_git_status_for_agent(&status)
}

pub async fn run_git_diff_tool(
    project_root: &str,
    file_path: Option<&str>,
    staged: bool,
) -> String {
    let scope = if staged { "已暂存" } else { "未暂存/工作区" };
    let result = git::git_diff(project_root, file_path, staged).await;
    if !result.ok {
        return format!(
            "错误：{}",
            result.error.as_deref().unwrap_or("获取 diff 失败")
        );
    }
    if let Some(fp) = file_path {
        let stat = result.files.first().map(|f| format!("+{}/-{}", f.additions, f.deletions)).unwrap_or_default();
        let header = vec![
            format!("文件：{fp}"),
            format!("范围：{scope}"),
            if stat.is_empty() { String::new() } else { format!("统计：{stat}") },
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
        .map(|f| format!("  {} | +{} -{}", f.path, f.additions, f.deletions))
        .collect();
    let header = vec![
        format!("范围：{scope}"),
        "变更文件：".into(),
    ]
    .into_iter()
    .chain(stat_lines.into_iter())
    .collect::<Vec<_>>()
    .join("\n");
    format!("{header}\n\n{}", truncate_patch(&result.patch))
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
