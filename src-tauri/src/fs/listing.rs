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
}
