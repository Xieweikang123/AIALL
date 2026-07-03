use super::exec::git_exec;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchInfo {
  pub name: String,
  pub is_current: bool,
  pub is_remote: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchesResult {
  pub ok: bool,
  pub branches: Vec<GitBranchInfo>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error: Option<String>,
}

pub async fn git_list_branches(project_root: &str) -> GitBranchesResult {
  match git_exec(
    project_root,
    &["branch", "-a", "--format=%(refname)|%(HEAD)"],
  )
  .await
  {
    Ok(out) => {
      let mut branches = Vec::new();
      for line in out.stdout.lines().filter(|l| !l.trim().is_empty()) {
        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() < 2 {
          continue;
        }
        let refname = parts[0];
        let is_current = parts[1].trim() == "*";
        if let Some(name) = refname.strip_prefix("refs/heads/") {
          branches.push(GitBranchInfo {
            name: name.to_string(),
            is_current,
            is_remote: false,
          });
        } else if let Some(name) = refname.strip_prefix("refs/remotes/") {
          if name.contains("/HEAD") || name.contains("->") {
            continue;
          }
          branches.push(GitBranchInfo {
            name: name.to_string(),
            is_current,
            is_remote: true,
          });
        }
      }
      GitBranchesResult {
        ok: true,
        branches,
        error: None,
      }
    }
    Err(error) => GitBranchesResult {
      ok: false,
      branches: vec![],
      error: Some(error),
    },
  }
}

pub async fn git_checkout_branch(
  project_root: &str,
  branch_name: &str,
  create_new: bool,
  start_point: Option<&str>,
) -> serde_json::Value {
  let mut args = vec!["checkout"];
  if create_new {
    args.push("-b");
    args.push(branch_name);
    if let Some(sp) = start_point.filter(|s| !s.is_empty()) {
      args.push(sp);
    }
  } else {
    args.push(branch_name);
  }
  match git_exec(project_root, &args).await {
    Ok(_) => serde_json::json!({ "ok": true }),
    Err(error) => serde_json::json!({ "ok": false, "error": error }),
  }
}

pub async fn git_delete_branch(
  project_root: &str,
  branch_name: &str,
  force: bool,
) -> serde_json::Value {
  let flag = if force { "-D" } else { "-d" };
  match git_exec(project_root, &["branch", flag, branch_name]).await {
    Ok(_) => serde_json::json!({ "ok": true }),
    Err(error) => serde_json::json!({ "ok": false, "error": error }),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_branch_info_current() {
    let info = GitBranchInfo {
      name: "main".into(),
      is_current: true,
      is_remote: false,
    };
    let json = serde_json::to_value(&info).unwrap();
    assert_eq!(json["name"], "main");
    assert_eq!(json["isCurrent"], true);
    assert_eq!(json["isRemote"], false);
  }

  #[test]
  fn test_branch_info_remote() {
    let info = GitBranchInfo {
      name: "origin/feature".into(),
      is_current: false,
      is_remote: true,
    };
    let json = serde_json::to_value(&info).unwrap();
    assert_eq!(json["name"], "origin/feature");
    assert_eq!(json["isCurrent"], false);
    assert_eq!(json["isRemote"], true);
  }

  #[test]
  fn test_branches_result_empty() {
    let result = GitBranchesResult {
      ok: true,
      branches: vec![],
      error: None,
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["ok"], true);
    assert!(json["branches"].as_array().unwrap().is_empty());
  }

  #[test]
  fn test_branches_result_with_error() {
    let result = GitBranchesResult {
      ok: false,
      branches: vec![],
      error: Some("permission denied".into()),
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["ok"], false);
    assert_eq!(json["error"], "permission denied");
  }
}
