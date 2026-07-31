use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Component, Path, PathBuf};

pub const AIALL_SESSION_LOGICAL_PREFIX: &str = "aiall/vibe-chat-sessions/";

pub fn resolve_aiall_session_data_dir() -> PathBuf {
    if cfg!(windows) {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return PathBuf::from(appdata)
                .join("aiall")
                .join("vibe-chat-sessions");
        }
    }
    dirs_home()
        .join(".config")
        .join("aiall")
        .join("vibe-chat-sessions")
}

/// App-private debug logs: `%APPDATA%/aiall/debug-logs` (Windows) or `~/.config/aiall/debug-logs`.
pub fn resolve_aiall_debug_log_dir() -> PathBuf {
    if cfg!(windows) {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return PathBuf::from(appdata).join("aiall").join("debug-logs");
        }
    }
    dirs_home().join(".config").join("aiall").join("debug-logs")
}

/// Resolve a debug log file under AppData. `filename` must be a bare name (no dirs / `..`).
/// When `project_root` is set, logs go under `debug-logs/<project-slug>/`.
pub fn resolve_debug_log_path(
    filename: &str,
    project_root: Option<&str>,
) -> Result<PathBuf, String> {
    let trimmed = filename.trim();
    if trimmed.is_empty() {
        return Err("路径不能为空".into());
    }
    let normalized = trimmed.replace('\\', "/");
    if Path::new(trimmed).is_absolute()
        || normalized.contains('/')
        || normalized.contains("..")
        || !is_safe_debug_log_filename(trimmed)
    {
        return Err("调试日志仅允许安全文件名".into());
    }
    let mut dir = resolve_aiall_debug_log_dir();
    if let Some(root) = project_root.map(str::trim).filter(|s| !s.is_empty()) {
        dir = dir.join(project_debug_log_slug(root));
    }
    Ok(dir.join(trimmed))
}

fn is_safe_debug_log_filename(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

fn project_debug_log_slug(project_root: &str) -> String {
    let normalized = project_root
        .trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_lowercase();
    let base = Path::new(&normalized)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("project");
    let safe_base: String = base
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let mut hasher = DefaultHasher::new();
    normalized.hash(&mut hasher);
    format!("{}_{:016x}", safe_base, hasher.finish())
}

fn dirs_home() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

pub fn resolve_project_path(
    project_root: &str,
    input_path: &str,
) -> Result<(PathBuf, String), String> {
    let root = PathBuf::from(project_root)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let trimmed = input_path.trim();
    if trimmed.is_empty() {
        return Err("路径不能为空".into());
    }
    let resolved = if Path::new(trimmed).is_absolute() {
        PathBuf::from(trimmed)
    } else {
        root.join(trimmed)
    };
    let resolved = if resolved.exists() {
        resolved.canonicalize().unwrap_or(resolved)
    } else {
        resolved
    };
    let root = if root.exists() {
        root.canonicalize().unwrap_or(root)
    } else {
        root
    };
    let relative = path_relative(&root, &resolved).replace('\\', "/");
    if relative.starts_with("..") {
        return Err("路径超出项目根目录".into());
    }
    Ok((resolved, relative))
}

pub fn resolve_path_inside_optional_root(
    input_path: &str,
    project_root: Option<&str>,
) -> Result<PathBuf, String> {
    let trimmed = input_path.trim();
    if trimmed.is_empty() {
        return Err("路径不能为空".into());
    }
    match project_root.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(PathBuf::from(trimmed)),
        Some(root) => Ok(resolve_readable_path(root, trimmed)?.0),
    }
}

pub fn resolve_readable_path(
    project_root: &str,
    input_path: &str,
) -> Result<(PathBuf, String, bool), String> {
    let trimmed = input_path.trim();
    if trimmed.is_empty() {
        return Err("路径不能为空".into());
    }
    if Path::new(trimmed).is_absolute() {
        let resolved = PathBuf::from(trimmed);
        let display = resolved.to_string_lossy().replace('\\', "/");
        return Ok((resolved, display, true));
    }
    let normalized = trimmed.replace('\\', "/");
    if normalized.starts_with(AIALL_SESSION_LOGICAL_PREFIX) {
        let tail = &normalized[AIALL_SESSION_LOGICAL_PREFIX.len()..];
        if tail.is_empty() || tail.contains("..") {
            return Err("非法会话路径".into());
        }
        let resolved =
            resolve_aiall_session_data_dir().join(tail.replace('/', std::path::MAIN_SEPARATOR_STR));
        let display = resolved.to_string_lossy().replace('\\', "/");
        return Ok((resolved, display, true));
    }
    let (path, relative) = resolve_project_path(project_root, trimmed)?;
    Ok((path, relative, false))
}

fn path_relative(base: &Path, path: &Path) -> String {
    let mut base_components = base.components().peekable();
    let mut path_components = path.components().peekable();
    let mut shared = 0usize;
    loop {
        match (base_components.peek(), path_components.peek()) {
            (Some(Component::Prefix(p1)), Some(Component::Prefix(p2)))
                if p1.as_os_str() == p2.as_os_str() =>
            {
                base_components.next();
                path_components.next();
            }
            (Some(Component::RootDir), Some(Component::RootDir)) => {
                base_components.next();
                path_components.next();
            }
            (Some(Component::Normal(a)), Some(Component::Normal(b))) if a == b => {
                shared += 1;
                base_components.next();
                path_components.next();
            }
            _ => break,
        }
    }
    let ups: Vec<_> = base_components.map(|_| "..").collect();
    let rest: Vec<_> = path_components.collect();
    let mut out = PathBuf::new();
    for u in ups {
        out.push(u);
    }
    for c in rest {
        out.push(c);
    }
    out.to_string_lossy().into_owned()
}

pub fn project_chat_store_dir(_project_path: &str) -> PathBuf {
    resolve_aiall_session_data_dir()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_aiall_session_data_dir_ends_with_aiall() {
        let path = resolve_aiall_session_data_dir();
        let s = path.to_string_lossy().replace('\\', "/");
        assert!(s.ends_with("aiall/vibe-chat-sessions"), "got: {s}");
    }

    #[test]
    fn test_resolve_aiall_debug_log_dir_ends_with_aiall() {
        let path = resolve_aiall_debug_log_dir();
        let s = path.to_string_lossy().replace('\\', "/");
        assert!(s.ends_with("aiall/debug-logs"), "got: {s}");
    }

    #[test]
    fn test_resolve_debug_log_path_bare_filename() {
        let path = resolve_debug_log_path("debug.log", None).unwrap();
        let s = path.to_string_lossy().replace('\\', "/");
        assert!(s.ends_with("aiall/debug-logs/debug.log"), "got: {s}");
    }

    #[test]
    fn test_resolve_debug_log_path_with_project_slug() {
        let path = resolve_debug_log_path("tab-perf.log", Some(r"D:\work\MyApp")).unwrap();
        let s = path.to_string_lossy().replace('\\', "/");
        assert!(s.contains("aiall/debug-logs/myapp_"), "got: {s}");
        assert!(s.ends_with("/tab-perf.log"), "got: {s}");
    }

    #[test]
    fn test_resolve_debug_log_path_rejects_unsafe() {
        assert!(resolve_debug_log_path("../x.log", None).is_err());
        assert!(resolve_debug_log_path("a/b.log", None).is_err());
        assert!(resolve_debug_log_path("", None).is_err());
    }

    #[test]
    fn test_project_chat_store_dir_ends_with_aiall() {
        let path = project_chat_store_dir("/some/project");
        let s = path.to_string_lossy().replace('\\', "/");
        assert!(s.ends_with("aiall/vibe-chat-sessions"), "got: {s}");
    }

    #[test]
    fn test_resolve_project_path_relative() {
        let cwd = std::env::current_dir().unwrap();
        let root = cwd.to_string_lossy().to_string();
        let (resolved, relative) = resolve_project_path(&root, "package.json").unwrap();
        assert_eq!(relative, "package.json");
        assert!(resolved
            .to_string_lossy()
            .replace('\\', "/")
            .ends_with("package.json"));
    }

    #[test]
    fn test_resolve_project_path_absolute() {
        let cwd = std::env::current_dir().unwrap();
        let root = cwd.to_string_lossy().to_string();
        let abs = cwd.join("package.json").to_string_lossy().to_string();
        let (resolved, _) = resolve_project_path(&root, &abs).unwrap();
        assert!(resolved
            .to_string_lossy()
            .replace('\\', "/")
            .ends_with("package.json"));
    }

    #[test]
    fn test_resolve_project_path_empty_errors() {
        let cwd = std::env::current_dir().unwrap();
        let root = cwd.to_string_lossy().to_string();
        let result = resolve_project_path(&root, "");
        assert!(result.is_err());
    }

    #[test]
    fn test_resolve_project_path_out_of_bounds() {
        let cwd = std::env::current_dir().unwrap();
        let root = cwd.to_string_lossy().to_string();
        let result = resolve_project_path(&root, "..");
        assert!(result.is_err(), "expected Err, got {:?}", result);
    }

    #[test]
    fn test_resolve_project_path_current_dir() {
        let cwd = std::env::current_dir().unwrap();
        let root = cwd.to_string_lossy().to_string();
        let (resolved, relative) = resolve_project_path(&root, ".").unwrap();
        assert_eq!(relative, "");
    }

    #[test]
    fn test_resolve_readable_path_absolute() {
        let cwd = std::env::current_dir().unwrap();
        let root = cwd.to_string_lossy().to_string();
        let abs = cwd.join("package.json").to_string_lossy().to_string();
        let (resolved, display, is_absolute) = resolve_readable_path(&root, &abs).unwrap();
        assert!(is_absolute);
        assert!(display.contains("package.json"));
    }

    #[test]
    fn test_resolve_readable_path_relative_no_session() {
        let cwd = std::env::current_dir().unwrap();
        let root = cwd.to_string_lossy().to_string();
        let (resolved, relative, is_absolute) =
            resolve_readable_path(&root, "package.json").unwrap();
        assert!(!is_absolute);
        assert_eq!(relative, "package.json");
    }

    #[test]
    fn test_resolve_readable_path_session_prefix_valid() {
        let (resolved, display, is_absolute) =
            resolve_readable_path("/project", "aiall/vibe-chat-sessions/abc-123").unwrap();
        assert!(is_absolute);
        assert!(display.contains("aiall/vibe-chat-sessions/abc-123"));
    }

    #[test]
    fn test_resolve_readable_path_session_prefix_empty_tail() {
        let result = resolve_readable_path("/project", "aiall/vibe-chat-sessions/");
        assert!(result.is_err());
    }

    #[test]
    fn test_resolve_readable_path_session_prefix_dotdot() {
        let result = resolve_readable_path("/project", "aiall/vibe-chat-sessions/../etc");
        assert!(result.is_err());
    }

    #[test]
    fn test_resolve_readable_path_session_prefix_dotdot_after_id() {
        let result = resolve_readable_path("/project", "aiall/vibe-chat-sessions/some-id/..");
        assert!(result.is_err());
    }

    #[test]
    fn test_resolve_readable_path_empty_errors() {
        let result = resolve_readable_path("/project", "");
        assert!(result.is_err());
    }

    #[test]
    fn test_resolve_path_inside_optional_root_no_root() {
        let result = resolve_path_inside_optional_root("some/path", None);
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().to_string_lossy().replace('\\', "/"),
            "some/path"
        );
    }

    #[test]
    fn test_resolve_path_inside_optional_root_with_root() {
        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();
        let result = resolve_path_inside_optional_root("package.json", Some(&cwd));
        assert!(result.is_ok());
    }

    #[test]
    fn test_resolve_path_inside_optional_root_empty_errors() {
        let result = resolve_path_inside_optional_root("", None);
        assert!(result.is_err());
    }

    #[test]
    fn test_resolve_path_inside_optional_root_empty_root_treated_as_none() {
        let result = resolve_path_inside_optional_root("some/path", Some(""));
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().to_string_lossy().replace('\\', "/"),
            "some/path"
        );
    }

    #[test]
    fn test_resolve_readable_path_session_prefix_backslash_normalized() {
        let (resolved, display, is_absolute) =
            resolve_readable_path("/project", "aiall/vibe-chat-sessions/session-1").unwrap();
        assert!(is_absolute);
        assert_eq!(
            display.replace("\\", "/"),
            resolved.to_string_lossy().replace('\\', "/")
        );
    }

    // ── project_debug_log_slug ──

    #[test]
    fn test_project_debug_log_slug_ascii() {
        let slug = project_debug_log_slug(r"D:\project\MyApp");
        assert!(
            slug.starts_with("myapp_"),
            "slug should start with project name, got: {slug}"
        );
        // Should have 16 hex chars (full u64 hash)
        let suffix = slug.strip_prefix("myapp_").unwrap();
        assert_eq!(
            suffix.len(),
            16,
            "hash suffix should be 16 hex chars, got: {suffix}"
        );
        assert!(
            suffix.chars().all(|c| c.is_ascii_hexdigit()),
            "hash should be hex, got: {suffix}"
        );
    }

    #[test]
    fn test_project_debug_log_slug_cjk_path() {
        let slug = project_debug_log_slug("/home/user/中文项目");
        assert!(
            slug.starts_with("____"),
            "non-ASCII chars mapped to underscores"
        );
        assert!(slug.len() > 16, "should include hash suffix");
    }

    #[test]
    fn test_project_debug_log_slug_deterministic() {
        let a = project_debug_log_slug("/path/to/project");
        let b = project_debug_log_slug("/path/to/project");
        assert_eq!(a, b, "same input should produce same slug");
    }

    #[test]
    fn test_project_debug_log_slug_different_projects_differ() {
        let a = project_debug_log_slug("/path/to/project-a");
        let b = project_debug_log_slug("/path/to/project-b");
        assert_ne!(a, b, "different projects should produce different slugs");
    }
}
