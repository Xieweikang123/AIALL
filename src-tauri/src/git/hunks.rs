use super::exec::git_exec;
use super::ops::GitActionResult;
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHunkInfo {
    pub index: u32,
    pub header: String,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHunksResult {
    pub ok: bool,
    pub hunks: Vec<GitHunkInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Split a unified diff into (file_header, hunk_bodies).
pub(crate) fn split_unified_diff_hunks(diff: &str) -> (String, Vec<String>) {
    let lines: Vec<&str> = diff.lines().collect();
    let mut header_lines = Vec::new();
    let mut hunks: Vec<String> = Vec::new();
    let mut current: Option<Vec<&str>> = None;
    let mut seen_hunk = false;

    for line in lines {
        if line.starts_with("@@") {
            seen_hunk = true;
            if let Some(h) = current.take() {
                hunks.push(h.join("\n"));
            }
            current = Some(vec![line]);
            continue;
        }
        if !seen_hunk {
            header_lines.push(line);
        } else if let Some(ref mut h) = current {
            h.push(line);
        }
    }
    if let Some(h) = current {
        hunks.push(h.join("\n"));
    }

    let mut header = header_lines.join("\n");
    if !header.is_empty() && !header.ends_with('\n') {
        header.push('\n');
    }
    (header, hunks)
}

fn hunk_preview(hunk: &str) -> String {
    let mut parts = Vec::new();
    for line in hunk.lines().skip(1) {
        if line.starts_with('+') || line.starts_with('-') {
            parts.push(line);
            if parts.len() >= 3 {
                break;
            }
        }
    }
    if parts.is_empty() {
        hunk.lines().next().unwrap_or("").to_string()
    } else {
        parts.join("\n")
    }
}

fn list_hunks_from_diff(diff: &str) -> Vec<GitHunkInfo> {
    if diff.trim().is_empty() {
        return vec![];
    }
    let (_header, hunks) = split_unified_diff_hunks(diff);
    hunks
        .into_iter()
        .enumerate()
        .map(|(i, body)| {
            let header = body.lines().next().unwrap_or("").to_string();
            GitHunkInfo {
                index: i as u32,
                header,
                preview: hunk_preview(&body),
            }
        })
        .collect()
}

pub async fn git_list_hunks(project_root: &str, file_path: &str, staged: bool) -> GitHunksResult {
    if file_path.trim().is_empty() || file_path.ends_with('/') {
        return GitHunksResult {
            ok: true,
            hunks: vec![],
            error: None,
        };
    }
    let args: Vec<&str> = if staged {
        vec!["diff", "--cached", "--no-color", "--", file_path]
    } else {
        vec!["diff", "--no-color", "--", file_path]
    };
    match git_exec(project_root, &args).await {
        Ok(out) => GitHunksResult {
            ok: true,
            hunks: list_hunks_from_diff(&out.stdout),
            error: None,
        },
        Err(error) => GitHunksResult {
            ok: false,
            hunks: vec![],
            error: Some(error),
        },
    }
}

async fn apply_hunk_patch(
    project_root: &str,
    file_path: &str,
    hunk_index: u32,
    staged_diff: bool,
    reverse: bool,
) -> GitActionResult {
    if super::stage_guard::is_git_path_stage_blocked(file_path) {
        return GitActionResult {
            ok: false,
            error: Some(super::stage_guard::format_git_stage_skipped_hint(&[
                file_path.to_string(),
            ])),
            warning: None,
        };
    }
    let diff_args: Vec<&str> = if staged_diff {
        vec!["diff", "--cached", "--no-color", "--", file_path]
    } else {
        vec!["diff", "--no-color", "--", file_path]
    };
    let diff = match git_exec(project_root, &diff_args).await {
        Ok(out) => out.stdout,
        Err(error) => {
            return GitActionResult {
                ok: false,
                error: Some(error),
                warning: None,
            };
        }
    };
    if diff.trim().is_empty() {
        return GitActionResult {
            ok: false,
            error: Some(if reverse {
                "没有可取消暂存的变更块".into()
            } else {
                "没有可暂存的变更块".into()
            }),
            warning: None,
        };
    }
    let (header, hunks) = split_unified_diff_hunks(&diff);
    let idx = hunk_index as usize;
    if idx >= hunks.len() {
        return GitActionResult {
            ok: false,
            error: Some(format!("变更块索引无效（{hunk_index}）")),
            warning: None,
        };
    }
    let mut patch = header;
    if !patch.ends_with('\n') && !patch.is_empty() {
        patch.push('\n');
    }
    patch.push_str(&hunks[idx]);
    if !patch.ends_with('\n') {
        patch.push('\n');
    }

    let tmp = match write_temp_patch(&patch) {
        Ok(p) => p,
        Err(error) => {
            return GitActionResult {
                ok: false,
                error: Some(error),
                warning: None,
            };
        }
    };
    let tmp_str = tmp.to_string_lossy().to_string();
    let apply_args: Vec<&str> = if reverse {
        vec![
            "apply",
            "--cached",
            "--reverse",
            "--whitespace=nowarn",
            &tmp_str,
        ]
    } else {
        vec!["apply", "--cached", "--whitespace=nowarn", &tmp_str]
    };
    let result = git_exec(project_root, &apply_args).await;
    let _ = std::fs::remove_file(&tmp);
    match result {
        Ok(_) => GitActionResult {
            ok: true,
            error: None,
            warning: None,
        },
        Err(error) => GitActionResult {
            ok: false,
            error: Some(error),
            warning: None,
        },
    }
}

pub async fn git_stage_hunk(
    project_root: &str,
    file_path: &str,
    hunk_index: u32,
) -> GitActionResult {
    apply_hunk_patch(project_root, file_path, hunk_index, false, false).await
}

pub async fn git_unstage_hunk(
    project_root: &str,
    file_path: &str,
    hunk_index: u32,
) -> GitActionResult {
    apply_hunk_patch(project_root, file_path, hunk_index, true, true).await
}

fn write_temp_patch(patch: &str) -> Result<PathBuf, String> {
    let mut path = std::env::temp_dir();
    let name = format!(
        "aiall-git-hunk-{}-{}.patch",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    path.push(name);
    std::fs::write(&path, patch).map_err(|e| e.to_string())?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_unified_diff_hunks() {
        let diff = "\
diff --git a/f.txt b/f.txt
--- a/f.txt
+++ b/f.txt
@@ -1,2 +1,3 @@
 a
-b
+c
+d
@@ -10,1 +11,1 @@
-x
+y
";
        let (header, hunks) = split_unified_diff_hunks(diff);
        assert!(header.contains("diff --git"));
        assert_eq!(hunks.len(), 2);
        assert!(hunks[0].starts_with("@@ -1,2 +1,3 @@"));
        assert!(hunks[1].starts_with("@@ -10,1 +11,1 @@"));
    }

    #[test]
    fn test_hunk_preview() {
        let hunk = "@@ -1 +1 @@\n-old\n+new\n context";
        let preview = hunk_preview(hunk);
        assert!(preview.contains("-old"));
        assert!(preview.contains("+new"));
    }
}
