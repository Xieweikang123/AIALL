pub fn normalize_git_path(file_path: &str) -> String {
    file_path
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

pub fn is_git_path_stage_blocked(file_path: &str) -> bool {
    const BLOCKED: &[&str] = &[".aiall", ".vs", "obj", "bin", "node_modules", ".idea"];
    let normalized = normalize_git_path(file_path);
    if normalized.is_empty() {
        return false;
    }
    let first = normalized.split('/').next().unwrap_or("").to_lowercase();
    BLOCKED.contains(&first.as_str())
}

pub fn filter_stageable_git_paths(paths: &[String]) -> (Vec<String>, Vec<String>) {
    let mut stageable = Vec::new();
    let mut blocked = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for p in paths {
        if is_git_path_stage_blocked(p) {
            let root = normalize_git_path(p)
                .split('/')
                .next()
                .unwrap_or(p)
                .to_string();
            let key = root.to_lowercase();
            if seen.insert(key.clone()) {
                blocked.push(format!("{root}/"));
            }
        } else {
            stageable.push(p.clone());
        }
    }
    (stageable, blocked)
}

pub fn format_git_stage_skipped_hint(blocked_roots: &[String]) -> String {
    if blocked_roots.is_empty() {
        return String::new();
    }
    let unique: Vec<String> = blocked_roots
        .iter()
        .map(|p| {
            let normalized = normalize_git_path(p);
            let root = normalized.split('/').next().unwrap_or(p);
            format!("{root}/")
        })
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    format!(
        "已跳过不应提交的目录：{}（建议加入 .gitignore）",
        unique.join("、")
    )
}

pub fn should_show_git_status_path(file_path: &str) -> bool {
    // Hide directory-only entries (`dir/`); file visibility follows git status / .gitignore.
    // Stage blocking (`is_git_path_stage_blocked`) is applied only when staging, not here.
    !file_path.replace('\\', "/").ends_with('/')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_git_path_backslashes() {
        assert_eq!(normalize_git_path(r"foo\bar\baz"), "foo/bar/baz");
    }

    #[test]
    fn test_normalize_git_path_trailing_slash() {
        assert_eq!(normalize_git_path("foo/bar/"), "foo/bar");
    }

    #[test]
    fn test_normalize_git_path_empty() {
        assert_eq!(normalize_git_path(""), "");
    }

    #[test]
    fn test_normalize_git_path_no_change() {
        assert_eq!(normalize_git_path("foo/bar"), "foo/bar");
    }

    #[test]
    fn test_normalize_git_path_mixed() {
        assert_eq!(normalize_git_path(r"a\b/c\d"), "a/b/c/d");
    }

    #[test]
    fn test_is_git_path_stage_blocked_blocked() {
        assert!(is_git_path_stage_blocked(".aiall/foo"));
        assert!(is_git_path_stage_blocked(".vs/config"));
        assert!(is_git_path_stage_blocked("obj/Debug"));
        assert!(is_git_path_stage_blocked("bin/Release"));
        assert!(is_git_path_stage_blocked("node_modules/pkg"));
        assert!(is_git_path_stage_blocked(".idea/workspace.xml"));
    }

    #[test]
    fn test_is_git_path_stage_blocked_not_blocked() {
        assert!(!is_git_path_stage_blocked("src/main.rs"));
        assert!(!is_git_path_stage_blocked("README.md"));
        assert!(!is_git_path_stage_blocked(""));
    }

    #[test]
    fn test_is_git_path_stage_blocked_case_insensitive() {
        assert!(is_git_path_stage_blocked("Node_Modules/pkg"));
        assert!(is_git_path_stage_blocked(".IDEA/config"));
    }

    #[test]
    fn test_is_git_path_stage_blocked_nested() {
        assert!(!is_git_path_stage_blocked("src/node_modules/pkg"));
        assert!(!is_git_path_stage_blocked("project/.aiall/data"));
    }

    #[test]
    fn test_filter_stageable_git_paths_mixed() {
        let paths: Vec<String> = vec![
            "src/main.rs".into(),
            ".aiall/config".into(),
            "README.md".into(),
            "node_modules/pkg".into(),
            "src/lib.rs".into(),
        ];
        let (stageable, blocked) = filter_stageable_git_paths(&paths);
        assert_eq!(stageable, vec!["src/main.rs", "README.md", "src/lib.rs"]);
        assert_eq!(blocked, vec![".aiall/", "node_modules/"]);
    }

    #[test]
    fn test_filter_stageable_git_paths_duplicate_roots() {
        let paths: Vec<String> = vec![
            ".aiall/config".into(),
            ".aiall/secret".into(),
            "src/main.rs".into(),
        ];
        let (stageable, blocked) = filter_stageable_git_paths(&paths);
        assert_eq!(stageable, vec!["src/main.rs"]);
        assert_eq!(blocked, vec![".aiall/"]);
    }

    #[test]
    fn test_filter_stageable_git_paths_all_blocked() {
        let paths: Vec<String> = vec!["node_modules/pkg".into(), ".aiall/config".into()];
        let (stageable, blocked) = filter_stageable_git_paths(&paths);
        assert!(stageable.is_empty());
        assert_eq!(blocked, vec!["node_modules/", ".aiall/"]);
    }

    #[test]
    fn test_filter_stageable_git_paths_empty() {
        let (stageable, blocked) = filter_stageable_git_paths(&[]);
        assert!(stageable.is_empty());
        assert!(blocked.is_empty());
    }

    #[test]
    fn test_format_git_stage_skipped_hint_empty() {
        assert_eq!(format_git_stage_skipped_hint(&[]), "");
    }

    #[test]
    fn test_format_git_stage_skipped_hint_single() {
        let hint = format_git_stage_skipped_hint(&["node_modules/".into()]);
        assert!(hint.contains("node_modules/"));
        assert!(hint.contains("已跳过"));
        assert!(hint.contains(".gitignore"));
    }

    #[test]
    fn test_format_git_stage_skipped_hint_multiple() {
        let hint = format_git_stage_skipped_hint(&[
            ".aiall/".into(),
            "node_modules/".into(),
            "obj/".into(),
        ]);
        assert!(hint.contains(".aiall/"));
        assert!(hint.contains("node_modules/"));
        assert!(hint.contains("、"));
    }

    #[test]
    fn test_should_show_git_status_path_trailing_slash() {
        assert!(!should_show_git_status_path("dir/"));
        assert!(!should_show_git_status_path(r"dir\"));
    }

    #[test]
    fn test_should_show_git_status_path_file() {
        assert!(should_show_git_status_path("dir/file.txt"));
        assert!(should_show_git_status_path("README.md"));
    }

    #[test]
    fn test_should_show_git_status_path_empty() {
        assert!(should_show_git_status_path(""));
    }
}
