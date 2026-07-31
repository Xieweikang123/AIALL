use super::{is_text_extension, TEXT_EXTENSIONS};
use std::path::Path;
use tokio::fs;
use tokio::io::AsyncReadExt;

const MAX_READ_BYTES: u64 = 2 * 1024 * 1024;

pub struct ReadFileResult {
    pub ok: bool,
    pub content: String,
    pub size: u64,
    pub error: Option<String>,
}

pub async fn read_file_content(file_path: &str) -> ReadFileResult {
    let path = Path::new(file_path);
    let meta = match fs::metadata(path).await {
        Ok(m) => m,
        Err(_) => {
            return ReadFileResult {
                ok: false,
                content: String::new(),
                size: 0,
                error: Some("文件不存在".into()),
            };
        }
    };
    if meta.len() > MAX_READ_BYTES {
        return ReadFileResult {
            ok: false,
            content: String::new(),
            size: meta.len(),
            error: Some("文件过大（超过 2MB）".into()),
        };
    }
    let ext = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
        .unwrap_or_default();
    if !TEXT_EXTENSIONS.contains(&ext.as_str()) && meta.len() > 0 {
        let mut file = match fs::File::open(path).await {
            Ok(f) => f,
            Err(e) => {
                return ReadFileResult {
                    ok: false,
                    content: String::new(),
                    size: meta.len(),
                    error: Some(e.to_string()),
                };
            }
        };
        let mut buf = vec![0u8; 512.min(meta.len() as usize)];
        if let Ok(n) = file.read(&mut buf).await {
            if buf[..n].contains(&0) {
                return ReadFileResult {
                    ok: false,
                    content: String::new(),
                    size: meta.len(),
                    error: Some("二进制文件，无法读取".into()),
                };
            }
        }
    }
    match fs::read_to_string(path).await {
        Ok(content) => ReadFileResult {
            ok: true,
            content,
            size: meta.len(),
            error: None,
        },
        Err(e) => ReadFileResult {
            ok: false,
            content: String::new(),
            size: meta.len(),
            error: Some(e.to_string()),
        },
    }
}

pub async fn write_file_content(file_path: &str, content: &str) -> Result<u64, String> {
    let path = Path::new(file_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    fs::write(path, content).await.map_err(|e| e.to_string())?;
    let meta = fs::metadata(path).await.map_err(|e| e.to_string())?;
    Ok(meta.len())
}

pub async fn create_item_impl(
    path: &str,
    is_directory: bool,
    content: Option<&str>,
) -> Result<String, String> {
    let p = Path::new(path);
    if is_directory {
        fs::create_dir_all(p).await.map_err(|e| e.to_string())?;
    } else {
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| e.to_string())?;
        }
        fs::write(p, content.unwrap_or(""))
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(path.to_string())
}

pub async fn delete_item_impl(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    let meta = fs::metadata(p)
        .await
        .map_err(|_| "文件或目录不存在".to_string())?;
    if meta.is_dir() {
        fs::remove_dir_all(p).await.map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(p).await.map_err(|e| e.to_string())?;
    }
    Ok(path.to_string())
}

pub async fn rename_item_impl(from: &str, to: &str) -> Result<(String, String), String> {
    let from_p = Path::new(from);
    let to_p = Path::new(to);
    if fs::metadata(from_p).await.is_err() {
        return Err("源路径不存在".into());
    }
    if let Some(parent) = to_p.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    fs::rename(from_p, to_p).await.map_err(|e| e.to_string())?;
    Ok((from.to_string(), to.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_file_result_success() {
        let result = ReadFileResult {
            ok: true,
            content: "hello".into(),
            size: 5,
            error: None,
        };
        assert!(result.ok);
        assert_eq!(result.content, "hello");
        assert_eq!(result.size, 5);
    }

    #[test]
    fn test_read_file_result_error() {
        let result = ReadFileResult {
            ok: false,
            content: String::new(),
            size: 0,
            error: Some("file not found".into()),
        };
        assert!(!result.ok);
        assert_eq!(result.error, Some("file not found".to_string()));
    }

    #[test]
    fn test_text_extensions_import_works() {
        assert!(TEXT_EXTENSIONS.contains(&".rs"));
        assert!(is_text_extension(".rs"));
        assert!(!is_text_extension(".exe"));
    }
}
