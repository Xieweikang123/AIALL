use super::exec::{git_exec, git_exec_remote};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct GitRemoteInfo {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemotesResult {
    pub ok: bool,
    pub remotes: Vec<GitRemoteInfo>,
    pub tracking_branch: String,
    pub ahead: u32,
    pub behind: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteActionResult {
    pub ok: bool,
    pub output: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub async fn git_remotes(project_root: &str) -> GitRemotesResult {
    match git_exec(project_root, &["remote", "-v"]).await {
        Ok(out) => {
            let mut remotes = Vec::new();
            let mut seen = std::collections::HashSet::new();
            for line in out.stdout.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 && seen.insert(parts[0].to_string()) {
                    remotes.push(GitRemoteInfo {
                        name: parts[0].to_string(),
                        url: parts[1].to_string(),
                    });
                }
            }
            let tracking_branch =
                git_exec(project_root, &["rev-parse", "--abbrev-ref", "@{upstream}"])
                    .await
                    .map(|o| o.stdout.trim().to_string())
                    .unwrap_or_default();

            let (ahead, behind) = if !tracking_branch.is_empty() {
                let count_result = git_exec(
                    project_root,
                    &[
                        "rev-list",
                        "--count",
                        "--left-right",
                        &format!("HEAD...{tracking_branch}"),
                    ],
                )
                .await;
                match count_result {
                    Ok(o) => {
                        let parts: Vec<&str> = o.stdout.trim().split_whitespace().collect();
                        let a = parts
                            .first()
                            .and_then(|s| s.parse::<u32>().ok())
                            .unwrap_or(0);
                        let b = parts
                            .get(1)
                            .and_then(|s| s.parse::<u32>().ok())
                            .unwrap_or(0);
                        (a, b)
                    }
                    Err(_) => (0, 0),
                }
            } else {
                (0, 0)
            };

            GitRemotesResult {
                ok: true,
                remotes,
                tracking_branch,
                ahead,
                behind,
                error: None,
            }
        }
        Err(error) => GitRemotesResult {
            ok: false,
            remotes: vec![],
            tracking_branch: String::new(),
            ahead: 0,
            behind: 0,
            error: Some(error),
        },
    }
}

pub async fn git_fetch(project_root: &str, remote: Option<&str>) -> GitRemoteActionResult {
    let mut args = vec!["fetch"];
    if let Some(r) = remote.filter(|s| !s.is_empty()) {
        args.push(r);
    }
    run_remote_action(project_root, &args).await
}

pub async fn git_pull(
    project_root: &str,
    remote: Option<&str>,
    branch: Option<&str>,
) -> GitRemoteActionResult {
    let mut args = vec!["pull"];
    if let Some(r) = remote.filter(|s| !s.is_empty()) {
        args.push(r);
        if let Some(b) = branch.filter(|s| !s.is_empty()) {
            args.push(b);
        }
    }
    run_remote_action(project_root, &args).await
}

pub async fn git_push(
    project_root: &str,
    remote: Option<&str>,
    branch: Option<&str>,
    set_upstream: bool,
) -> GitRemoteActionResult {
    let mut args = vec!["push"];
    if set_upstream {
        args.push("-u");
    }
    if let Some(r) = remote.filter(|s| !s.is_empty()) {
        args.push(r);
        if let Some(b) = branch.filter(|s| !s.is_empty()) {
            args.push(b);
        }
    }
    run_remote_action(project_root, &args).await
}

async fn run_remote_action(project_root: &str, args: &[&str]) -> GitRemoteActionResult {
    match git_exec_remote(project_root, args).await {
        Ok(out) => GitRemoteActionResult {
            ok: true,
            output: format!("{}{}", out.stdout, out.stderr).trim().to_string(),
            error: None,
        },
        Err(error) => GitRemoteActionResult {
            ok: false,
            output: String::new(),
            error: Some(error),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_remote_info_serialization() {
        let info = GitRemoteInfo {
            name: "origin".into(),
            url: "https://github.com/user/repo.git".into(),
        };
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["name"], "origin");
        assert_eq!(json["url"], "https://github.com/user/repo.git");
    }

    #[test]
    fn test_remotes_result_defaults() {
        let result = GitRemotesResult {
            ok: true,
            remotes: vec![],
            tracking_branch: "main".into(),
            ahead: 0,
            behind: 0,
            error: None,
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["ok"], true);
        assert_eq!(json["trackingBranch"], "main");
        assert_eq!(json["ahead"], 0);
        assert_eq!(json["behind"], 0);
        assert!(json.get("error").is_none());
    }

    #[test]
    fn test_remote_action_result() {
        let result = GitRemoteActionResult {
            ok: false,
            output: String::new(),
            error: Some("failed to connect".into()),
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["ok"], false);
        assert_eq!(json["error"], "failed to connect");
    }
}
