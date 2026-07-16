use super::exec::git_exec;
use super::stage_guard::should_show_git_status_path;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusFile {
  pub path: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub old_path: Option<String>,
  pub status: String,
  pub index_status: String,
  pub worktree_status: String,
  pub staged: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusResult {
  pub ok: bool,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub is_repo: Option<bool>,
  pub branch: String,
  pub head_commit: String,
  pub files: Vec<GitStatusFile>,
  pub staged_count: u32,
  pub unstaged_count: u32,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error: Option<String>,
}

pub(crate) fn parse_git_status_porcelain(stdout: &str) -> Vec<GitStatusFile> {
  let mut files = Vec::new();
  let entries: Vec<&str> = stdout.split('\0').filter(|s| !s.is_empty()).collect();
  let mut i = 0;
  while i < entries.len() {
    let line = entries[i];
    if line.len() < 3 {
      i += 1;
      continue;
    }
    let index_status = line.chars().next().unwrap_or(' ').to_string();
    let worktree_status = line.chars().nth(1).unwrap_or(' ').to_string();
    let mut file_path = line[3..].to_string();
    let mut old_path = None;
    let idx = index_status.chars().next().unwrap_or(' ');
    let wt = worktree_status.chars().next().unwrap_or(' ');
    if idx == 'R' || idx == 'C' || wt == 'R' || wt == 'C' {
      i += 1;
      if i < entries.len() {
        old_path = Some(entries[i].to_string());
      }
    }
    let has_index = idx != ' ' && idx != '?' && idx != '!';
    let has_worktree = wt != ' ' && wt != '?' && wt != '!';
    fn status_label(c: char) -> String {
      match c {
        'A' => "added".into(),
        'D' => "deleted".into(),
        'R' | 'C' => "renamed".into(),
        _ => "modified".into(),
      }
    }
    if has_index {
      files.push(GitStatusFile {
        path: file_path.clone(),
        old_path: old_path.clone(),
        status: status_label(idx),
        index_status: index_status.clone(),
        worktree_status: " ".into(),
        staged: true,
      });
    }
    if has_worktree {
      files.push(GitStatusFile {
        path: file_path.clone(),
        old_path: old_path.clone(),
        status: status_label(wt),
        index_status: " ".into(),
        worktree_status: worktree_status.clone(),
        staged: false,
      });
    }
    if !has_index && !has_worktree {
      if idx == '?' && wt == '?' {
        files.push(GitStatusFile {
          path: file_path,
          old_path,
          status: "untracked".into(),
          index_status,
          worktree_status,
          staged: false,
        });
      } else if idx == '!' && wt == '!' {
        files.push(GitStatusFile {
          path: file_path,
          old_path,
          status: "ignored".into(),
          index_status,
          worktree_status,
          staged: false,
        });
      }
    }
    i += 1;
  }
  files
}

pub async fn git_status(project_root: &str) -> GitStatusResult {
  if !super::exec::git_exec_ok(project_root, &["rev-parse", "--git-dir"]).await {
    return GitStatusResult {
      ok: true,
      is_repo: Some(false),
      branch: String::new(),
      head_commit: String::new(),
      files: vec![],
      staged_count: 0,
      unstaged_count: 0,
      error: None,
    };
  }
  let branch = git_exec(project_root, &["rev-parse", "--abbrev-ref", "HEAD"])
    .await
    .map(|o| o.stdout.trim().to_string())
    .unwrap_or_else(|_| "main".into());
  let head_commit = git_exec(project_root, &["rev-parse", "HEAD"])
    .await
    .map(|o| o.stdout.trim().to_string())
    .unwrap_or_default();
  match git_exec(
    project_root,
    &["status", "--porcelain=v1", "-z", "-uall"],
  )
  .await
  {
    Ok(out) => {
      let visible: Vec<_> = parse_git_status_porcelain(&out.stdout)
        .into_iter()
        .filter(|f| {
          f.status == "ignored"
            || (should_show_git_status_path(&f.path)
              && !super::stage_guard::is_git_path_stage_blocked(&f.path))
        })
        .collect();
      let staged_count = visible.iter().filter(|f| f.staged).count() as u32;
      let unstaged_count = visible.iter().filter(|f| !f.staged).count() as u32;
      GitStatusResult {
        ok: true,
        is_repo: Some(true),
        branch,
        head_commit,
        files: visible,
        staged_count,
        unstaged_count,
        error: None,
      }
    }
    Err(error) => GitStatusResult {
      ok: false,
      is_repo: Some(false),
      branch: String::new(),
      head_commit: String::new(),
      files: vec![],
      staged_count: 0,
      unstaged_count: 0,
      error: Some(error),
    },
  }
}

pub async fn git_changed_files_since(
  project_root: &str,
  since_commit: &str,
) -> serde_json::Value {
  let base = since_commit.trim();
  let mut files = std::collections::BTreeSet::new();
  let has_head = super::exec::git_exec_ok(project_root, &["rev-parse", "--verify", "HEAD"]).await;
  if !base.is_empty() && has_head {
    if let Ok(out) = git_exec(project_root, &["diff", "--name-only", base, "HEAD"]).await {
      for line in out.stdout.lines() {
        let t = line.trim().replace('\\', "/");
        if !t.is_empty() {
          files.insert(t);
        }
      }
    }
  }
  serde_json::json!({ "ok": true, "files": files.into_iter().collect::<Vec<_>>() })
}

#[cfg(test)]
mod tests {
  use super::*;

  fn s(raw: &[&str]) -> String {
    raw.join("\0")
  }

  #[test]
  fn test_parse_modified_staged() {
    let result = parse_git_status_porcelain(&s(&["M  src/main.rs"]));
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].path, "src/main.rs");
    assert_eq!(result[0].status, "modified");
    assert!(result[0].staged);
    assert_eq!(result[0].index_status, "M");
    assert_eq!(result[0].worktree_status, " ");
  }

  #[test]
  fn test_parse_modified_worktree() {
    let result = parse_git_status_porcelain(&s(&[" M src/main.rs"]));
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].path, "src/main.rs");
    assert_eq!(result[0].status, "modified");
    assert!(!result[0].staged);
    assert_eq!(result[0].index_status, " ");
    assert_eq!(result[0].worktree_status, "M");
  }

  #[test]
  fn test_parse_added() {
    let result = parse_git_status_porcelain(&s(&["A  new.txt"]));
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].path, "new.txt");
    assert_eq!(result[0].status, "added");
    assert!(result[0].staged);
  }

  #[test]
  fn test_parse_deleted() {
    let result = parse_git_status_porcelain(&s(&["D  old.txt"]));
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].path, "old.txt");
    assert_eq!(result[0].status, "deleted");
    assert!(result[0].staged);
  }

  #[test]
  fn test_parse_renamed() {
    let result = parse_git_status_porcelain(&s(&["R  old.txt", "new.txt"]));
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].path, "old.txt");
    assert_eq!(result[0].status, "renamed");
    assert_eq!(result[0].old_path, Some("new.txt".into()));
    assert!(result[0].staged);
  }

  #[test]
  fn test_parse_untracked() {
    let result = parse_git_status_porcelain(&s(&["?? new_file.txt"]));
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].path, "new_file.txt");
    assert_eq!(result[0].status, "untracked");
    assert!(!result[0].staged);
  }

  #[test]
  fn test_parse_ignored() {
    let result = parse_git_status_porcelain(&s(&["!! ignored.log"]));
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].path, "ignored.log");
    assert_eq!(result[0].status, "ignored");
    assert!(!result[0].staged);
  }

  #[test]
  fn test_parse_empty() {
    let result = parse_git_status_porcelain("");
    assert!(result.is_empty());
  }

  #[test]
  fn test_parse_both_staged_and_worktree() {
    let result = parse_git_status_porcelain(&s(&["MM src/main.rs"]));
    assert_eq!(result.len(), 2);
    assert_eq!(result[0].path, "src/main.rs");
    assert!(result[0].staged);
    assert_eq!(result[0].index_status, "M");
    assert_eq!(result[1].path, "src/main.rs");
    assert!(!result[1].staged);
    assert_eq!(result[1].worktree_status, "M");
  }

  #[test]
  fn test_parse_mixed_scenario() {
    let input = s(&[
      "M  src/staged.rs",
      " M src/unstaged.rs",
      "A  src/added.rs",
      "D  src/deleted.rs",
      "?? src/untracked.rs",
      "!! target/debug.log",
    ]);
    let result = parse_git_status_porcelain(&input);
    assert_eq!(result.len(), 6);
    assert_eq!(result[0].path, "src/staged.rs");
    assert_eq!(result[0].status, "modified");
    assert!(result[0].staged);
    assert_eq!(result[1].path, "src/unstaged.rs");
    assert_eq!(result[1].status, "modified");
    assert!(!result[1].staged);
    assert_eq!(result[2].path, "src/added.rs");
    assert_eq!(result[2].status, "added");
    assert_eq!(result[3].path, "src/deleted.rs");
    assert_eq!(result[3].status, "deleted");
    assert_eq!(result[4].path, "src/untracked.rs");
    assert_eq!(result[4].status, "untracked");
    assert_eq!(result[5].path, "target/debug.log");
    assert_eq!(result[5].status, "ignored");
  }
}
