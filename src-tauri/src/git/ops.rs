use super::exec::git_exec;
use super::stage_guard::{filter_stageable_git_paths, format_git_stage_skipped_hint};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitActionResult {
  pub ok: bool,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitResult {
  pub ok: bool,
  pub hash: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error: Option<String>,
}

pub async fn git_add(project_root: &str, files: Vec<String>) -> GitActionResult {
  if files.is_empty() {
    return match git_exec(project_root, &["add", "-A"]).await {
      Ok(_) => GitActionResult { ok: true, error: None, warning: None },
      Err(error) => GitActionResult {
        ok: false,
        error: Some(error),
        warning: None,
      },
    };
  }
  let (stageable, blocked) = filter_stageable_git_paths(&files);
  if stageable.is_empty() {
    return GitActionResult {
      ok: false,
      error: Some(format_git_stage_skipped_hint(&blocked)),
      warning: None,
    };
  }
  let mut args = vec!["add", "--"];
  for f in &stageable {
    args.push(f.as_str());
  }
  match git_exec(project_root, &args).await {
    Ok(_) => GitActionResult {
      ok: true,
      error: None,
      warning: if blocked.is_empty() {
        None
      } else {
        Some(format_git_stage_skipped_hint(&blocked))
      },
    },
    Err(error) => GitActionResult {
      ok: false,
      error: Some(error),
      warning: None,
    },
  }
}

pub async fn git_reset(project_root: &str, files: Vec<String>) -> GitActionResult {
  let has_head = super::exec::git_exec_ok(project_root, &["rev-parse", "--verify", "HEAD"]).await;
  let result = if has_head {
    if files.is_empty() {
      git_exec(project_root, &["reset", "HEAD"]).await
    } else {
      let mut args = vec!["reset", "HEAD", "--"];
      for f in &files {
        args.push(f.as_str());
      }
      git_exec(project_root, &args).await
    }
  } else if files.is_empty() {
    git_exec(project_root, &["read-tree", "--empty"]).await
  } else {
    for file in &files {
      let _ = git_exec(project_root, &["rm", "--cached", "-r", "-f", "--", file]).await;
    }
    Ok(super::exec::GitOutput {
      stdout: String::new(),
      stderr: String::new(),
    })
  };
  match result {
    Ok(_) => GitActionResult { ok: true, error: None, warning: None },
    Err(error) => GitActionResult {
      ok: false,
      error: Some(error),
      warning: None,
    },
  }
}

pub async fn git_discard(project_root: &str, files: Vec<String>) -> GitActionResult {
  for file in files {
    let tracked = git_exec(project_root, &["ls-files", "--error-unmatch", "--", &file])
      .await
      .is_ok();
    let result = if tracked {
      git_exec(project_root, &["checkout", "--", &file]).await
    } else {
      git_exec(project_root, &["clean", "-fd", "--", &file]).await
    };
    if let Err(error) = result {
      return GitActionResult {
        ok: false,
        error: Some(error),
        warning: None,
      };
    }
  }
  GitActionResult { ok: true, error: None, warning: None }
}

pub async fn git_discard_all(project_root: &str) -> GitActionResult {
  if let Err(error) = git_exec(project_root, &["checkout", "--", "."]).await {
    return GitActionResult {
      ok: false,
      error: Some(error),
      warning: None,
    };
  }
  match git_exec(project_root, &["clean", "-fd"]).await {
    Ok(_) => GitActionResult { ok: true, error: None, warning: None },
    Err(error) => GitActionResult {
      ok: false,
      error: Some(error),
      warning: None,
    },
  }
}

pub async fn git_commit(project_root: &str, message: &str) -> GitCommitResult {
  match git_exec(project_root, &["commit", "-m", message]).await {
    Ok(out) => {
      let hash = extract_commit_hash(&out.stdout);
      GitCommitResult {
        ok: true,
        hash,
        error: None,
      }
    }
    Err(error) => GitCommitResult {
      ok: false,
      hash: String::new(),
      error: Some(error),
    },
  }
}

pub(crate) fn extract_commit_hash(stdout: &str) -> String {
  stdout
    .split(' ')
    .find(|p| p.len() >= 7 && p.chars().all(|c| c.is_ascii_hexdigit()))
    .unwrap_or("")
    .to_string()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_extract_commit_hash_isolated() {
    assert_eq!(extract_commit_hash("abc1234"), "abc1234");
  }

  #[test]
  fn test_extract_commit_hash_long() {
    assert_eq!(extract_commit_hash("abc1234def5678"), "abc1234def5678");
  }

  #[test]
  fn test_extract_commit_hash_in_text() {
    assert_eq!(extract_commit_hash("a b abc1234def c d"), "abc1234def");
  }

  #[test]
  fn test_extract_commit_hash_empty() {
    assert_eq!(extract_commit_hash(""), "");
  }

  #[test]
  fn test_extract_commit_hash_no_hex() {
    assert_eq!(extract_commit_hash("no hex tokens here"), "");
  }

  #[test]
  fn test_extract_commit_hash_too_short() {
    assert_eq!(extract_commit_hash("a1b2c3d"), "a1b2c3d");
    assert_eq!(extract_commit_hash("abc"), "");
  }

  #[test]
  fn test_extract_commit_hash_first_match() {
    assert_eq!(
      extract_commit_hash("abc1234def abc5678gh xyz"),
      "abc1234def"
    );
  }

  #[test]
  fn test_extract_commit_hash_bracket_blocks() {
    assert_eq!(extract_commit_hash("[abc1234def]"), "");
  }

  #[test]
  fn test_extract_commit_hash_stdin_format() {
    let out = "[main abc1234def1234567890abc1234def1234567890] commit message";
    assert_eq!(extract_commit_hash(out), "");
  }
}
