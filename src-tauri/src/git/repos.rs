use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use serde::Serialize;

use super::exec::{git_exec, git_exec_ok};

/// Guard rails for walking down: never descend into VCS internals, generated
/// output, dependency caches or the AIALL project state directory.
const SKIP_DIRS: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    ".aiall",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".output",
    ".vercel",
    ".cache",
    ".idea",
    ".vscode",
    ".vs",
    ".venv",
    "venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".cargo",
    ".gradle",
    ".terraform",
    ".parcel-cache",
    ".turbo",
];

/// Max directory depth for nested-repo discovery (repos are usually shallow).
const MAX_DEPTH: usize = 10;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoInfo {
    /// Absolute repo root path.
    pub path: String,
    /// Directory name of the repo root (display name).
    pub name: String,
    /// Path relative to the project root ("" for the project-root repo itself).
    pub rel_path: String,
    /// True when the project root itself belongs to this repo (git walks up).
    pub is_root: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReposResult {
    pub ok: bool,
    pub repos: Vec<GitRepoInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn normalize_path(p: &Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    s.trim_end_matches('/').to_string()
}

fn normalize_key(p: &Path) -> String {
    normalize_path(p).to_lowercase()
}

fn dir_name(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| p.to_string_lossy().into_owned())
}

/// Relative path of `repo` under `root` ("" when they are the same).
fn rel_path_of(root: &Path, repo: &Path) -> String {
    let root_norm = normalize_path(root);
    let repo_norm = normalize_path(repo);
    if repo_norm == root_norm {
        return String::new();
    }
    if let Some(rest) = repo_norm.strip_prefix(&format!("{}/", root_norm)) {
        return rest.to_string();
    }
    repo_norm
}

fn is_repo_root(dir: &Path) -> bool {
    dir.join(".git").exists()
}

/// Walk down from `root` (non-inclusive) and collect directories that contain a
/// `.git` entry, skipping heavy/generated directories. Depth-limited.
pub(crate) fn discover_nested_repos(root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut stack: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];
    while let Some((dir, depth)) = stack.pop() {
        if depth >= MAX_DEPTH {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut children = Vec::new();
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            if !ft.is_dir() {
                continue;
            }
            let child = entry.path();
            if is_repo_root(&child) {
                found.push(child.clone());
            }
            children.push(child);
        }
        stack.extend(children.into_iter().map(|d| (d, depth + 1)));
    }
    found
}

/// Discover every git repo under `project_root`:
/// 1. the repo the project root itself belongs to (git walks up), if any;
/// 2. nested repos found by walking down.
/// The project-root repo is listed first, then repos by depth then name.
pub async fn git_list_repos(project_root: &str) -> GitReposResult {
    let root = PathBuf::from(project_root);
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut items: Vec<GitRepoInfo> = Vec::new();

    // 1. Repo the project root belongs to (walks up, same resolution as git status).
    if let Ok(out) = git_exec(project_root, &["rev-parse", "--show-toplevel"]).await {
        let line = out.stdout.trim().to_string();
        if !line.is_empty() {
            let cand = PathBuf::from(&line);
            if cand.is_absolute() {
                let key = normalize_key(&cand);
                if seen.insert(key) {
                    items.push(GitRepoInfo {
                        path: normalize_path(&cand),
                        name: dir_name(&cand),
                        rel_path: String::new(),
                        is_root: true,
                    });
                }
            }
        }
    }

    // 2. Nested repos (submodules / independent repos in subdirectories).
    for repo in discover_nested_repos(&root) {
        let key = normalize_key(&repo);
        if seen.insert(key) {
            items.push(GitRepoInfo {
                path: normalize_path(&repo),
                name: dir_name(&repo),
                rel_path: rel_path_of(&root, &repo),
                is_root: false,
            });
        }
    }

    let root_rank = |i: &GitRepoInfo| if i.is_root { 0 } else { 1 };
    items.sort_by_key(|i| {
        let depth = i.rel_path.matches('/').count() as u32;
        (root_rank(i), depth, i.name.clone())
    });

    GitReposResult {
        ok: true,
        repos: items,
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_temp(name: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "aiall-repos-test-{}-{}",
            std::process::id(),
            name
        ));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        base
    }

    fn remove_temp(p: &Path) {
        let _ = std::fs::remove_dir_all(p);
    }

    fn init_repo(dir: &Path) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join(".git"), "").unwrap();
    }

    #[test]
    fn discover_nested_finds_nested_repos() {
        let base = make_temp("nested");
        let root = base.join("multi");
        init_repo(&root.join("repo-a"));
        init_repo(&root.join("sub/repo-b"));
        init_repo(&root.join("sub/node_modules/repo-ignored"));
        std::fs::create_dir_all(root.join("sub/plain")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();

        let found = discover_nested_repos(&root);
        let paths: BTreeSet<String> = found
            .iter()
            .map(|p| normalize_path(p))
            .collect();
        assert!(paths.contains(&normalize_path(&root.join("repo-a"))));
        assert!(paths.contains(&normalize_path(&root.join("sub/repo-b"))));
        assert!(!paths.contains(&normalize_path(&root.join("sub/node_modules/repo-ignored"))));
        assert_eq!(paths.len(), 2);
        remove_temp(&base);
    }

    #[test]
    fn discover_nested_skips_deep_below_depth_limit() {
        let base = make_temp("deep");
        let root = base.join("deep");
        let mut deep_dir = root.clone();
        for _ in 0..(MAX_DEPTH + 2) {
            deep_dir = deep_dir.join("d");
        }
        init_repo(&deep_dir);
        let found = discover_nested_repos(&root);
        assert!(found.is_empty(), "repo deeper than limit should be skipped");
        remove_temp(&base);
    }

    #[test]
    fn rel_path_of_handles_root_and_children() {
        let root = Path::new("D:/project/multi");
        assert_eq!(rel_path_of(root, &root.join("repo-a")), "repo-a");
        assert_eq!(rel_path_of(root, &root.join("sub/repo-b")), "sub/repo-b");
        assert_eq!(rel_path_of(root, root), "");
    }

    #[test]
    fn normalize_path_squashes_backslashes() {
        assert_eq!(normalize_path(Path::new(r"D:\project\foo\")), "D:/project/foo");
    }
}
