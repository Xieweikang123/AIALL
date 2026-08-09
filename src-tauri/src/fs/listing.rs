use super::{should_list_directory_entry, FileEntry};
use std::path::Path;
use tokio::fs;

pub async fn list_directory_impl(dir_path: &str) -> Result<Vec<FileEntry>, String> {
    let mut items = Vec::new();
    let mut entries = fs::read_dir(dir_path)
        .await
        .map_err(|e| format!("读取目录失败: {e}"))?;
    while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
        let meta = entry.metadata().await.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_directory = meta.is_dir();
        if !should_list_directory_entry(&name, is_directory) {
            continue;
        }
        let full_path = entry.path();
        let extension = if meta.is_file() {
            Path::new(&name)
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy()))
                .unwrap_or_default()
                .to_lowercase()
        } else {
            String::new()
        };
        items.push(FileEntry {
            name: name.clone(),
            path: full_path.to_string_lossy().into_owned(),
            relative: name,
            is_directory,
            is_file: meta.is_file(),
            extension,
            size: if meta.is_file() {
                Some(meta.len())
            } else {
                None
            },
        });
    }
    items.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(items)
}

pub async fn search_files_impl(
    dir_path: &str,
    query: &str,
    max_results: usize,
) -> Result<Vec<FileEntry>, String> {
    let root = Path::new(dir_path);
    let lower = query.to_lowercase();
    let mut results = Vec::new();
    walk(root, root, &lower, 0, max_results, &mut results).await;
    Ok(results)
}

async fn walk(
    root: &Path,
    current: &Path,
    query: &str,
    depth: usize,
    max_results: usize,
    results: &mut Vec<FileEntry>,
) {
    if depth > 6 || results.len() >= max_results {
        return;
    }
    let mut entries = match fs::read_dir(current).await {
        Ok(e) => e,
        Err(_) => return,
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        if results.len() >= max_results {
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
        if name.to_lowercase().contains(query) {
            let full = entry.path();
            results.push(FileEntry {
                name: name.clone(),
                path: full.to_string_lossy().into_owned(),
                relative: full
                    .strip_prefix(root)
                    .unwrap_or(&full)
                    .to_string_lossy()
                    .replace('\\', "/"),
                is_directory,
                is_file: meta.is_file(),
                extension: String::new(),
                size: None,
            });
        }
        if is_directory {
            Box::pin(walk(
                root,
                &entry.path(),
                query,
                depth + 1,
                max_results,
                results,
            ))
            .await;
        }
    }
}

/// Resolve a bare filename (no path separators, e.g. `mixin.js`) to a unique project
/// file by exact basename match, ignoring node_modules / hidden dirs. Used by read_file
/// so a model that passes only a filename instead of the full path can still make progress.
pub async fn resolve_basename_candidate(
    project_root: &str,
    basename: &str,
) -> Result<(String, String), String> {
    let root = Path::new(project_root);
    let target = basename.trim().to_lowercase();
    if target.is_empty() {
        return Err("文件名不能为空".into());
    }
    let mut matches: Vec<(String, String)> = Vec::new();
    walk_basename(root, root, &target, 0, 20, &mut matches).await;
    match matches.len() {
        0 => Err("文件不存在".into()),
        1 => Ok(matches.remove(0)),
        n => {
            let listed = matches
                .iter()
                .take(5)
                .map(|(_, rel)| format!("`{rel}`"))
                .collect::<Vec<_>>()
                .join("、");
            Err(format!(
                "文件名 `{basename}` 匹配到 {n} 个文件（{listed} 等），请使用 search_files / grep 返回的完整相对路径。"
            ))
        }
    }
}

async fn walk_basename(
    root: &Path,
    current: &Path,
    target: &str,
    depth: usize,
    max_results: usize,
    matches: &mut Vec<(String, String)>,
) {
    if depth > 12 || matches.len() >= max_results {
        return;
    }
    let mut entries = match fs::read_dir(current).await {
        Ok(e) => e,
        Err(_) => return,
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        if matches.len() >= max_results {
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
        if !is_directory && name.to_lowercase() == target {
            let full = entry.path();
            let rel = full
                .strip_prefix(root)
                .unwrap_or(&full)
                .to_string_lossy()
                .replace('\\', "/");
            matches.push((full.to_string_lossy().into_owned(), rel));
        }
        if is_directory {
            Box::pin(walk_basename(
                root,
                &entry.path(),
                target,
                depth + 1,
                max_results,
                matches,
            ))
            .await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_entry_struct_defaults() {
        let entry = FileEntry {
            name: "test.rs".into(),
            path: "/project/test.rs".into(),
            relative: "test.rs".into(),
            is_directory: false,
            is_file: true,
            extension: ".rs".into(),
            size: Some(42),
        };
        assert_eq!(entry.name, "test.rs");
        assert!(entry.is_file);
        assert!(!entry.is_directory);
        assert_eq!(entry.extension, ".rs");
        assert_eq!(entry.size, Some(42));
    }

    #[test]
    fn test_file_entry_directory() {
        let entry = FileEntry {
            name: "src".into(),
            path: "/project/src".into(),
            relative: "src".into(),
            is_directory: true,
            is_file: false,
            extension: String::new(),
            size: None,
        };
        assert!(entry.is_directory);
        assert!(!entry.is_file);
        assert_eq!(entry.extension, "");
        assert!(entry.size.is_none());
    }

    fn temp_project(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "aiall-basename-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[tokio::test]
    async fn test_resolve_basename_candidate_unique() {
        let root = temp_project("unique");
        let nested = root.join("APP/uview-ui/libs/mixin");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("mixin.js"), "x").unwrap();
        let (abs, rel) =
            resolve_basename_candidate(&root.to_string_lossy(), "mixin.js").await.unwrap();
        assert_eq!(rel, "APP/uview-ui/libs/mixin/mixin.js");
        assert!(abs.ends_with("mixin.js"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn test_resolve_basename_candidate_ignores_node_modules() {
        let root = temp_project("ignorenm");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::write(root.join("src/mixin.js"), "x").unwrap();
        std::fs::write(root.join("node_modules/pkg/mixin.js"), "y").unwrap();
        let (_, rel) =
            resolve_basename_candidate(&root.to_string_lossy(), "mixin.js").await.unwrap();
        assert_eq!(rel, "src/mixin.js");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn test_resolve_basename_candidate_ambiguous() {
        let root = temp_project("ambiguous");
        std::fs::create_dir_all(root.join("a")).unwrap();
        std::fs::create_dir_all(root.join("b")).unwrap();
        std::fs::write(root.join("a/mixin.js"), "x").unwrap();
        std::fs::write(root.join("b/mixin.js"), "y").unwrap();
        let err =
            resolve_basename_candidate(&root.to_string_lossy(), "mixin.js").await.unwrap_err();
        assert!(err.contains("匹配到 2 个文件"), "got: {err}");
        assert!(err.contains("a/mixin.js"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn test_resolve_basename_candidate_not_found() {
        let root = temp_project("notfound");
        let err =
            resolve_basename_candidate(&root.to_string_lossy(), "nope.js").await.unwrap_err();
        assert_eq!(err, "文件不存在");
        let _ = std::fs::remove_dir_all(&root);
    }
}
