use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeProfile {
    pub has_desktop_shell: bool,
    pub web_dev_script: Option<String>,
    pub desktop_dev_script: Option<String>,
    pub verify_script: Option<String>,
    pub verify_scripts: Vec<String>,
}

pub async fn detect_project_runtime_profile(project_root: &str) -> ProjectRuntimeProfile {
    let pkg_path = Path::new(project_root).join("package.json");
    let has_tauri = Path::new(project_root).join("src-tauri").exists();
    let has_electron = Path::new(project_root).join("electron").exists()
        || Path::new(project_root)
            .join("electron.vite.config.ts")
            .exists();
    let has_desktop_shell = has_tauri || has_electron;

    let mut web_dev: Option<String> = None;
    let mut desktop_dev: Option<String> = None;
    let mut verify_scripts: Vec<String> = Vec::new();

    if let Ok(content) = tokio::fs::read_to_string(&pkg_path).await {
        if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&content) {
            let scripts = pkg.get("scripts");
            if let Some(scripts) = scripts {
                if scripts
                    .get("dev:web")
                    .and_then(|v| v.as_str())
                    .is_some_and(|s| !s.is_empty())
                {
                    web_dev = Some("dev:web".to_string());
                }
                if has_tauri {
                    if scripts
                        .get("tauri:dev")
                        .or_else(|| scripts.get("tauri-dev"))
                        .and_then(|v| v.as_str())
                        .is_some_and(|s| !s.is_empty())
                    {
                        desktop_dev = Some("tauri:dev".to_string());
                    } else if scripts
                        .get("dev")
                        .and_then(|v| v.as_str())
                        .is_some_and(|s| s.contains("tauri"))
                    {
                        desktop_dev = Some("dev".to_string());
                    }
                }
                if has_electron {
                    if scripts
                        .get("electron:dev")
                        .or_else(|| scripts.get("electron-dev"))
                        .and_then(|v| v.as_str())
                        .is_some_and(|s| !s.is_empty())
                    {
                        desktop_dev = Some("electron:dev".to_string());
                    }
                }
                if web_dev.is_none() && desktop_dev.as_deref() != Some("dev") {
                    if scripts
                        .get("dev")
                        .and_then(|v| v.as_str())
                        .is_some_and(|s| !s.is_empty() && !s.contains("tauri"))
                    {
                        web_dev = Some("dev".to_string());
                    }
                }
                for script_name in &["typecheck", "check", "lint", "test"] {
                    if let Some(val) = scripts.get(*script_name).and_then(|v| v.as_str()) {
                        if !val.is_empty() {
                            verify_scripts.push(format!("npm run {script_name}"));
                        }
                    }
                }
            }
        }
    }

    if verify_scripts.is_empty() {
        if Path::new(project_root).join("tsconfig.json").exists()
            || Path::new(project_root).join("tsconfig.app.json").exists()
        {
            if Path::new(project_root)
                .join("node_modules/.bin/vue-tsc")
                .exists()
            {
                verify_scripts.push("npx vue-tsc --noEmit".to_string());
            } else if Path::new(project_root)
                .join("node_modules/.bin/tsc")
                .exists()
            {
                verify_scripts.push("npx tsc --noEmit".to_string());
            }
        }
    }

    let verify_script = verify_scripts.first().cloned();

    ProjectRuntimeProfile {
        has_desktop_shell,
        web_dev_script: web_dev,
        desktop_dev_script: desktop_dev,
        verify_script,
        verify_scripts,
    }
}

pub fn build_runtime_awareness_hint(profile: &ProjectRuntimeProfile) -> String {
    if !profile.has_desktop_shell {
        return String::new();
    }
    let mut hints = vec!["项目包含桌面端壳层（src-tauri/electron）。".to_string()];
    if let Some(ref dev) = profile.desktop_dev_script {
        hints.push(format!("桌面开发命令：npm run {dev}"));
    } else if let Some(ref dev) = profile.web_dev_script {
        hints.push(format!("Web 开发命令：npm run {dev}（壳层可能需额外启动）"));
    }
    hints.join("\n")
}

pub fn build_shell_awareness_hint() -> &'static str {
    if cfg!(target_os = "windows") {
        "当前为 Windows PowerShell。多命令用 `;` 连接。路径含空格时用双引号包裹。"
    } else {
        "当前为 Unix Shell。多命令用 `&&` 连接。"
    }
}

pub fn resolve_verify_scripts(scripts: &[String]) -> Vec<&str> {
    let default_order: &[&str] = &[
        "npm run typecheck",
        "npm run check",
        "npm run lint",
        "npm run test",
    ];
    default_order
        .iter()
        .filter(|s| scripts.iter().any(|x| x == *s))
        .copied()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── build_shell_awareness_hint ──
    #[test]
    fn test_build_shell_awareness_hint_windows() {
        let hint = build_shell_awareness_hint();
        // Compiling on windows should return the windows hint
        assert!(
            hint.contains("Windows PowerShell"),
            "expected windows shell hint, got: {}",
            hint
        );
    }

    #[test]
    fn test_build_shell_awareness_hint_not_empty() {
        let hint = build_shell_awareness_hint();
        assert!(!hint.is_empty());
    }

    // ── build_runtime_awareness_hint ──
    #[test]
    fn test_build_runtime_awareness_hint_no_desktop() {
        let profile = ProjectRuntimeProfile {
            has_desktop_shell: false,
            web_dev_script: None,
            desktop_dev_script: None,
            verify_script: None,
            verify_scripts: vec![],
        };
        assert_eq!(build_runtime_awareness_hint(&profile), "");
    }

    #[test]
    fn test_build_runtime_awareness_hint_desktop_without_dev_script() {
        let profile = ProjectRuntimeProfile {
            has_desktop_shell: true,
            web_dev_script: Some("dev".to_string()),
            desktop_dev_script: None,
            verify_script: None,
            verify_scripts: vec![],
        };
        let hint = build_runtime_awareness_hint(&profile);
        assert!(hint.contains("桌面端壳层"));
        assert!(hint.contains("Web 开发命令"));
    }

    #[test]
    fn test_build_runtime_awareness_hint_desktop_with_desktop_script() {
        let profile = ProjectRuntimeProfile {
            has_desktop_shell: true,
            web_dev_script: Some("dev".to_string()),
            desktop_dev_script: Some("tauri:dev".to_string()),
            verify_script: Some("npm run lint".to_string()),
            verify_scripts: vec!["npm run lint".to_string()],
        };
        let hint = build_runtime_awareness_hint(&profile);
        assert!(hint.contains("桌面端壳层"));
        assert!(hint.contains("tauri:dev"));
        assert!(!hint.contains("Web 开发命令"));
    }

    #[test]
    fn test_build_runtime_awareness_hint_desktop_no_scripts() {
        let profile = ProjectRuntimeProfile {
            has_desktop_shell: true,
            web_dev_script: None,
            desktop_dev_script: None,
            verify_script: None,
            verify_scripts: vec![],
        };
        let hint = build_runtime_awareness_hint(&profile);
        assert!(hint.contains("桌面端壳层"));
        assert!(!hint.contains("开发命令"));
    }

    // ── resolve_verify_scripts ──
    #[test]
    fn test_resolve_verify_scripts_empty() {
        let result = resolve_verify_scripts(&[]);
        assert!(result.is_empty());
    }

    #[test]
    fn test_resolve_verify_scripts_all() {
        let scripts = vec![
            "npm run typecheck".to_string(),
            "npm run check".to_string(),
            "npm run lint".to_string(),
            "npm run test".to_string(),
        ];
        let result = resolve_verify_scripts(&scripts);
        assert_eq!(result.len(), 4);
        assert_eq!(result[0], "npm run typecheck");
        assert_eq!(result[1], "npm run check");
        assert_eq!(result[2], "npm run lint");
        assert_eq!(result[3], "npm run test");
    }

    #[test]
    fn test_resolve_verify_scripts_partial() {
        let scripts = vec!["npm run lint".to_string(), "npm run test".to_string()];
        let result = resolve_verify_scripts(&scripts);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0], "npm run lint");
        assert_eq!(result[1], "npm run test");
    }

    #[test]
    fn test_resolve_verify_scripts_preserves_default_order() {
        let scripts = vec!["npm run test".to_string(), "npm run lint".to_string()];
        let result = resolve_verify_scripts(&scripts);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0], "npm run lint");
        assert_eq!(result[1], "npm run test");
    }

    #[test]
    fn test_resolve_verify_scripts_skips_unknown() {
        let scripts = vec!["npm run custom".to_string(), "npm run lint".to_string()];
        let result = resolve_verify_scripts(&scripts);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], "npm run lint");
    }

    #[test]
    fn test_resolve_verify_scripts_no_matches() {
        let scripts = vec!["npm run custom".to_string(), "npm run foo".to_string()];
        let result = resolve_verify_scripts(&scripts);
        assert!(result.is_empty());
    }
}
