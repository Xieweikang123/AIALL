use super::exec::{git_exec, git_exec_ok, git_exec_remote};
use super::ops::{is_safe_git_rev, GitActionResult};
use serde::Serialize;

fn is_safe_ref_name(name: &str) -> bool {
  let name = name.trim();
  if name.is_empty() || name.len() > 255 {
    return false;
  }
  if name.starts_with('-') || name.contains('\0') || name.contains("..") {
    return false;
  }
  // allow branch / remote/branch / tag-like names
  name
    .chars()
    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '_' | '-' | '.' | '+'))
}

fn action_from_exec(result: Result<super::exec::GitOutput, String>) -> GitActionResult {
  match result {
    Ok(out) => GitActionResult {
      ok: true,
      error: None,
      warning: {
        let msg = format!("{}{}", out.stdout, out.stderr).trim().to_string();
        if msg.is_empty() {
          None
        } else {
          Some(msg)
        }
      },
    },
    Err(error) => GitActionResult {
      ok: false,
      error: Some(error),
      warning: None,
    },
  }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitOpStateResult {
  pub ok: bool,
  pub merge_in_progress: bool,
  pub rebase_in_progress: bool,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error: Option<String>,
}

pub async fn git_op_state(project_root: &str) -> GitOpStateResult {
  let merge_in_progress = git_exec_ok(project_root, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).await;
  let rebase_in_progress = git_exec_ok(project_root, &["rev-parse", "-q", "--verify", "REBASE_HEAD"]).await
    || std::path::Path::new(project_root).join(".git/rebase-merge").exists()
    || std::path::Path::new(project_root).join(".git/rebase-apply").exists();
  GitOpStateResult {
    ok: true,
    merge_in_progress,
    rebase_in_progress,
    error: None,
  }
}

pub async fn git_merge(project_root: &str, branch: &str) -> GitActionResult {
  if !is_safe_ref_name(branch) {
    return GitActionResult {
      ok: false,
      error: Some("无效的分支名".into()),
      warning: None,
    };
  }
  action_from_exec(git_exec(project_root, &["merge", "--no-edit", branch.trim()]).await)
}

pub async fn git_merge_abort(project_root: &str) -> GitActionResult {
  action_from_exec(git_exec(project_root, &["merge", "--abort"]).await)
}

pub async fn git_rebase(project_root: &str, onto: &str) -> GitActionResult {
  if !is_safe_ref_name(onto) && !is_safe_git_rev(onto) {
    return GitActionResult {
      ok: false,
      error: Some("无效的 rebase 目标".into()),
      warning: None,
    };
  }
  action_from_exec(git_exec(project_root, &["rebase", onto.trim()]).await)
}

pub async fn git_rebase_abort(project_root: &str) -> GitActionResult {
  action_from_exec(git_exec(project_root, &["rebase", "--abort"]).await)
}

pub async fn git_cherry_pick(project_root: &str, commit: &str) -> GitActionResult {
  if !is_safe_git_rev(commit) {
    return GitActionResult {
      ok: false,
      error: Some("无效的提交引用".into()),
      warning: None,
    };
  }
  action_from_exec(git_exec(project_root, &["cherry-pick", commit.trim()]).await)
}

pub async fn git_revert_commit(project_root: &str, commit: &str) -> GitActionResult {
  if !is_safe_git_rev(commit) {
    return GitActionResult {
      ok: false,
      error: Some("无效的提交引用".into()),
      warning: None,
    };
  }
  action_from_exec(git_exec(project_root, &["revert", "--no-edit", commit.trim()]).await)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitTagInfo {
  pub name: String,
  pub commit: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitTagsResult {
  pub ok: bool,
  pub tags: Vec<GitTagInfo>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error: Option<String>,
}

pub async fn git_tag_list(project_root: &str) -> GitTagsResult {
  match git_exec(
    project_root,
    &["for-each-ref", "--sort=-creatordate", "--format=%(refname:short)|%(objectname:short)", "refs/tags"],
  )
  .await
  {
    Ok(out) => {
      let mut tags = Vec::new();
      for line in out.stdout.lines().filter(|l| !l.trim().is_empty()) {
        let mut parts = line.splitn(2, '|');
        let name = parts.next().unwrap_or("").trim();
        let commit = parts.next().unwrap_or("").trim();
        if !name.is_empty() {
          tags.push(GitTagInfo {
            name: name.to_string(),
            commit: commit.to_string(),
          });
        }
      }
      GitTagsResult {
        ok: true,
        tags,
        error: None,
      }
    }
    Err(error) => GitTagsResult {
      ok: false,
      tags: vec![],
      error: Some(error),
    },
  }
}

pub async fn git_tag_create(
  project_root: &str,
  name: &str,
  commit: Option<&str>,
  message: Option<&str>,
) -> GitActionResult {
  if !is_safe_ref_name(name) {
    return GitActionResult {
      ok: false,
      error: Some("无效的标签名".into()),
      warning: None,
    };
  }
  let commit = commit.map(str::trim).filter(|s| !s.is_empty());
  if let Some(c) = commit {
    if !is_safe_git_rev(c) && !is_safe_ref_name(c) {
      return GitActionResult {
        ok: false,
        error: Some("无效的提交引用".into()),
        warning: None,
      };
    }
  }
  let msg = message.map(str::trim).filter(|s| !s.is_empty());
  let name = name.trim();
  let result = if let Some(m) = msg {
    if let Some(c) = commit {
      git_exec(project_root, &["tag", "-a", name, "-m", m, c]).await
    } else {
      git_exec(project_root, &["tag", "-a", name, "-m", m]).await
    }
  } else if let Some(c) = commit {
    git_exec(project_root, &["tag", name, c]).await
  } else {
    git_exec(project_root, &["tag", name]).await
  };
  action_from_exec(result)
}

pub async fn git_tag_delete(project_root: &str, name: &str) -> GitActionResult {
  if !is_safe_ref_name(name) {
    return GitActionResult {
      ok: false,
      error: Some("无效的标签名".into()),
      warning: None,
    };
  }
  action_from_exec(git_exec(project_root, &["tag", "-d", name.trim()]).await)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSubmoduleInfo {
  pub path: String,
  pub status: String,
  pub sha: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSubmodulesResult {
  pub ok: bool,
  pub submodules: Vec<GitSubmoduleInfo>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error: Option<String>,
}

pub async fn git_submodule_status(project_root: &str) -> GitSubmodulesResult {
  match git_exec(project_root, &["submodule", "status"]).await {
    Ok(out) => {
      let mut submodules = Vec::new();
      for line in out.stdout.lines().filter(|l| !l.trim().is_empty()) {
        let trimmed = line.trim_start();
        let status = trimmed.chars().next().unwrap_or(' ');
        let rest = if matches!(status, ' ' | '-' | '+' | 'U') {
          &trimmed[status.len_utf8()..]
        } else {
          trimmed
        };
        let mut parts = rest.split_whitespace();
        let sha = parts.next().unwrap_or("").to_string();
        let path = parts.next().unwrap_or("").to_string();
        if path.is_empty() {
          continue;
        }
        let status_label = match status {
          '-' => "uninitialized",
          '+' => "modified",
          'U' => "conflict",
          _ => "ok",
        }
        .to_string();
        submodules.push(GitSubmoduleInfo {
          path,
          status: status_label,
          sha,
        });
      }
      GitSubmodulesResult {
        ok: true,
        submodules,
        error: None,
      }
    }
    Err(error) => GitSubmodulesResult {
      ok: false,
      submodules: vec![],
      error: Some(error),
    },
  }
}

pub async fn git_submodule_update(project_root: &str, init: bool) -> GitActionResult {
  let result = if init {
    git_exec_remote(project_root, &["submodule", "update", "--init", "--recursive"]).await
  } else {
    git_exec_remote(project_root, &["submodule", "update", "--recursive"]).await
  };
  action_from_exec(result)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_safe_ref_name() {
    assert!(is_safe_ref_name("main"));
    assert!(is_safe_ref_name("feature/foo-bar"));
    assert!(is_safe_ref_name("origin/main"));
    assert!(is_safe_ref_name("v1.2.3"));
    assert!(!is_safe_ref_name(""));
    assert!(!is_safe_ref_name("-bad"));
    assert!(!is_safe_ref_name("a..b"));
    assert!(!is_safe_ref_name("has space"));
  }
}
