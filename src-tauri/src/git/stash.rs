use super::exec::git_exec;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct GitStashEntry {
  pub index: String,
  pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStashListResult {
  pub ok: bool,
  pub stashes: Vec<GitStashEntry>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStashResult {
  pub ok: bool,
  pub output: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error: Option<String>,
}

pub async fn git_stash_list(project_root: &str) -> GitStashListResult {
  match git_exec(project_root, &["stash", "list"]).await {
    Ok(out) => {
      let re = regex::Regex::new(r"^stash@\{(\d+)\}:\s*(.*)$").unwrap();
      let stashes = out
        .stdout
        .lines()
        .filter_map(|line| {
          re.captures(line).map(|caps| GitStashEntry {
            index: caps.get(1).map(|m| m.as_str()).unwrap_or("0").to_string(),
            message: caps.get(2).map(|m| m.as_str().trim()).unwrap_or("").to_string(),
          })
        })
        .collect();
      GitStashListResult {
        ok: true,
        stashes,
        error: None,
      }
    }
    Err(error) => GitStashListResult {
      ok: false,
      stashes: vec![],
      error: Some(error),
    },
  }
}

pub async fn git_stash_save(project_root: &str, message: Option<&str>) -> GitStashResult {
  let mut args = vec!["stash", "push"];
  if let Some(m) = message.filter(|s| !s.trim().is_empty()) {
    args.push("-m");
    args.push(m);
  }
  stash_action(project_root, &args).await
}

pub async fn git_stash_pop(project_root: &str, stash_index: Option<u32>) -> GitStashResult {
  let mut args = vec!["stash", "pop"];
  let stash_ref;
  if let Some(i) = stash_index {
    stash_ref = format!("stash@{{{i}}}");
    args.push(&stash_ref);
  }
  stash_action(project_root, &args).await
}

pub async fn git_stash_apply(project_root: &str, stash_index: u32) -> GitStashResult {
  let stash_ref = format!("stash@{{{stash_index}}}");
  stash_action(project_root, &["stash", "apply", &stash_ref]).await
}

pub async fn git_stash_drop(project_root: &str, stash_index: u32) -> GitStashResult {
  let stash_ref = format!("stash@{{{stash_index}}}");
  stash_action(project_root, &["stash", "drop", &stash_ref]).await
}

async fn stash_action(project_root: &str, args: &[&str]) -> GitStashResult {
  match git_exec(project_root, args).await {
    Ok(out) => GitStashResult {
      ok: true,
      output: format!("{}{}", out.stdout, out.stderr).trim().to_string(),
      error: None,
    },
    Err(error) => GitStashResult {
      ok: false,
      output: String::new(),
      error: Some(error),
    },
  }
}

#[cfg(test)]
mod tests {
  #[test]
  fn test_stash_regex_normal() {
    let re = regex::Regex::new(r"^stash@\{(\d+)\}:\s*(.*)$").unwrap();
    let caps = re.captures("stash@{0}: On master: work in progress").unwrap();
    assert_eq!(&caps[1], "0");
    assert_eq!(&caps[2], "On master: work in progress");
  }

  #[test]
  fn test_stash_regex_large_index() {
    let re = regex::Regex::new(r"^stash@\{(\d+)\}:\s*(.*)$").unwrap();
    let caps = re.captures("stash@{12}: WIP on feature/x").unwrap();
    assert_eq!(&caps[1], "12");
    assert_eq!(&caps[2], "WIP on feature/x");
  }

  #[test]
  fn test_stash_regex_message_with_colons() {
    let re = regex::Regex::new(r"^stash@\{(\d+)\}:\s*(.*)$").unwrap();
    let caps = re.captures("stash@{3}: On develop: fix: resolve issue").unwrap();
    assert_eq!(&caps[1], "3");
    assert_eq!(&caps[2], "On develop: fix: resolve issue");
  }

  #[test]
  fn test_stash_regex_empty_message() {
    let re = regex::Regex::new(r"^stash@\{(\d+)\}:\s*(.*)$").unwrap();
    let caps = re.captures("stash@{1}: ").unwrap();
    assert_eq!(&caps[1], "1");
    assert_eq!(&caps[2], "");
  }

  #[test]
  fn test_stash_regex_no_match() {
    let re = regex::Regex::new(r"^stash@\{(\d+)\}:\s*(.*)$").unwrap();
    assert!(re.captures("").is_none());
    assert!(re.captures("garbage").is_none());
    assert!(re.captures("stash@{}: message").is_none());
    assert!(re.captures("stash@{abc}: message").is_none());
  }

  #[test]
  fn test_stash_regex_multiple_lines() {
    let re = regex::Regex::new(r"^stash@\{(\d+)\}:\s*(.*)$").unwrap();
    let output = "stash@{0}: On master: first\nstash@{1}: On feature: second";
    let stashes: Vec<(&str, &str)> = output
      .lines()
      .filter_map(|line| {
        re.captures(line)
          .map(|caps| (caps.get(1).unwrap().as_str(), caps.get(2).unwrap().as_str()))
      })
      .collect();
    assert_eq!(stashes.len(), 2);
    assert_eq!(stashes[0], ("0", "On master: first"));
    assert_eq!(stashes[1], ("1", "On feature: second"));
  }
}
