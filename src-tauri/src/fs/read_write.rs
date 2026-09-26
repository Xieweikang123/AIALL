use super::decode_text_bytes;
use std::path::Path;
use tokio::fs;

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
    let bytes = match fs::read(path).await {
        Ok(b) => b,
        Err(e) => {
            return ReadFileResult {
                ok: false,
                content: String::new(),
                size: meta.len(),
                error: Some(e.to_string()),
            };
        }
    };
    match decode_text_bytes(&bytes) {
        Some(content) => ReadFileResult {
            ok: true,
            content,
            size: meta.len(),
            error: None,
        },
        None => ReadFileResult {
            ok: false,
            content: String::new(),
            size: meta.len(),
            error: Some("二进制文件，无法读取".into()),
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

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("aiall-fs-{name}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

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

    /// PowerShell 5.1 `> out.txt` 的产物（UTF-16LE + BOM）必须能读出来。
    #[test]
    fn test_read_file_decodes_utf16_txt_instead_of_binary() {
        let dir = temp_dir("utf16");
        let path = dir.join("out.txt");
        let mut bytes = vec![0xFFu8, 0xFE];
        for unit in "hello\nworld\n".encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        std::fs::write(&path, &bytes).unwrap();

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = runtime.block_on(read_file_content(&path.to_string_lossy()));

        assert!(result.ok, "utf16 txt 不该被判二进制: {:?}", result.error);
        assert_eq!(result.content, "hello\nworld\n");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_read_file_reports_binary_for_png_bytes() {
        let dir = temp_dir("binary");
        let path = dir.join("fake.txt");
        let png = [
            0x89u8, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52,
        ];
        std::fs::write(&path, png).unwrap();

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = runtime.block_on(read_file_content(&path.to_string_lossy()));

        assert!(!result.ok);
        assert_eq!(result.error.as_deref(), Some("二进制文件，无法读取"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
