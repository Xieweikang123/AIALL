use super::exec::git_exec;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogFile {
  pub path: String,
  pub status: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub old_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogRef {
  pub name: String,
  #[serde(rename = "type")]
  pub ref_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogEntry {
  pub hash: String,
  pub short_hash: String,
  pub author: String,
  pub date: String,
  pub message: String,
  pub files: Vec<GitLogFile>,
  #[serde(skip_serializing_if = "Vec::is_empty")]
  pub refs: Vec<GitLogRef>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogResult {
  pub ok: bool,
  pub entries: Vec<GitLogEntry>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error: Option<String>,
}

const GIT_LOG_FORMAT: &str = "%x1e%H%x1f%h%x1f%an%x1f%ai%x1f%d%x1f%B%x00";

pub async fn git_log(project_root: &str, count: u32, search: Option<&str>) -> GitLogResult {
  let count_str = count.to_string();
  let format_arg = format!("--format={GIT_LOG_FORMAT}");
  let max_count_arg = format!("--max-count={count_str}");
  let mut args: Vec<&str> = vec![
    "log",
    &max_count_arg,
    "--name-status",
    &format_arg,
  ];
  if let Some(s) = search {
    if !s.is_empty() {
      args.push("--grep");
      args.push(s);
      args.push("--regexp-ignore-case");
    }
  }
  match git_exec(project_root, &args).await
  {
    Ok(out) => GitLogResult {
      ok: true,
      entries: parse_git_log(&out.stdout),
      error: None,
    },
    Err(error) => GitLogResult {
      ok: false,
      entries: vec![],
      error: Some(error),
    },
  }
}

pub(crate) fn parse_git_log(stdout: &str) -> Vec<GitLogEntry> {
  let mut entries = Vec::new();
  for block in stdout.split('\x1e').filter(|b| !b.trim().is_empty()) {
    let null_idx = block.find('\0').unwrap_or(block.len());
    let header = &block[..null_idx];
    let file_str = block.get(null_idx + 1..).unwrap_or("");
    let parts: Vec<&str> = header.split('\x1f').collect();
    if parts.len() < 6 {
      continue;
    }
    let mut files = Vec::new();
    for line in file_str.lines().filter(|l| !l.trim().is_empty()) {
      let cols: Vec<&str> = line.split('\t').collect();
      if cols.is_empty() {
        continue;
      }
      let status = cols[0].trim();
      if status.starts_with('R') || status.starts_with('C') {
        if cols.len() >= 3 {
          files.push(GitLogFile {
            status: status.chars().next().unwrap_or('M').to_string(),
            old_path: Some(cols[1].trim().to_string()),
            path: cols[2].trim().to_string(),
          });
        }
      } else if cols.len() >= 2 {
        files.push(GitLogFile {
          status: status.chars().next().unwrap_or('M').to_string(),
          path: cols[1].trim().to_string(),
          old_path: None,
        });
      }
    }
    let refs = parse_refs(parts[4]);
    entries.push(GitLogEntry {
      hash: parts[0].trim().to_string(),
      short_hash: parts[1].trim().to_string(),
      author: parts[2].trim().to_string(),
      date: parts[3].trim().to_string(),
      message: parts[5..].join("\x1f").trim().to_string(),
      files,
      refs,
    });
  }
  entries
}

fn parse_refs(decorate_str: &str) -> Vec<GitLogRef> {
  let mut refs = Vec::new();
  let trimmed = decorate_str.trim();
  if trimmed.is_empty() || trimmed == "()" {
    return refs;
  }
  let inner = trimmed.trim_start_matches('(').trim_end_matches(')');
  for part in inner.split(", ") {
    let part = part.trim();
    if part.is_empty() {
      continue;
    }
    if let Some(tag) = part.strip_prefix("tag: ") {
      refs.push(GitLogRef {
        name: tag.to_string(),
        ref_type: "tag".to_string(),
      });
    } else if part.starts_with("HEAD -> ") {
      let name = part.trim_start_matches("HEAD -> ");
      refs.push(GitLogRef {
        name: name.to_string(),
        ref_type: "head".to_string(),
      });
    } else if part.contains('/') {
      refs.push(GitLogRef {
        name: part.to_string(),
        ref_type: "remote".to_string(),
      });
    } else {
      refs.push(GitLogRef {
        name: part.to_string(),
        ref_type: "local".to_string(),
      });
    }
  }
  refs
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitAheadCommitsResult {
  pub ok: bool,
  pub entries: Vec<GitLogEntry>,
  pub tracking_branch: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error: Option<String>,
}

pub async fn git_ahead_commits(project_root: &str, count: u32) -> GitAheadCommitsResult {
  let upstream = git_exec(project_root, &["rev-parse", "--abbrev-ref", "@{upstream}"])
    .await
    .map(|o| o.stdout.trim().to_string())
    .unwrap_or_default();
  if upstream.is_empty() {
    return GitAheadCommitsResult {
      ok: true,
      entries: vec![],
      tracking_branch: String::new(),
      error: None,
    };
  }
  let count_str = count.to_string();
  let range = format!("{upstream}..HEAD");
  let format_arg = format!("--format={GIT_LOG_FORMAT}");
  match git_exec(
    project_root,
    &["log", &format!("--max-count={count_str}"), "--name-status", &format_arg, &range],
  )
  .await
  {
    Ok(out) => GitAheadCommitsResult {
      ok: true,
      entries: parse_git_log(&out.stdout),
      tracking_branch: upstream,
      error: None,
    },
    Err(error) => GitAheadCommitsResult {
      ok: false,
      entries: vec![],
      tracking_branch: upstream,
      error: Some(error),
    },
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_parse_git_log_single_entry() {
    let input = "\x1eabc1234def\x1fabc1234\x1fAlice\x1f2024-01-01\x1f (tag: v1)\x1fInitial commit\x00M\tREADME.md";
    let entries = parse_git_log(input);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].hash, "abc1234def");
    assert_eq!(entries[0].short_hash, "abc1234");
    assert_eq!(entries[0].author, "Alice");
    assert_eq!(entries[0].date, "2024-01-01");
    assert_eq!(entries[0].message, "Initial commit");
    assert_eq!(entries[0].files.len(), 1);
    assert_eq!(entries[0].files[0].path, "README.md");
    assert_eq!(entries[0].files[0].status, "M");
    assert_eq!(entries[0].files[0].old_path, None);
  }

  #[test]
  fn test_parse_git_log_empty() {
    let entries = parse_git_log("");
    assert!(entries.is_empty());
  }

  #[test]
  fn test_parse_git_log_no_files() {
    let input = "\x1eabc1234def\x1fabc1234\x1fBob\x1f2024-02-02\x1f\x1fEmpty commit\x00";
    let entries = parse_git_log(input);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].hash, "abc1234def");
    assert!(entries[0].files.is_empty());
  }

  #[test]
  fn test_parse_git_log_renamed_file() {
    let input =
      "\x1eaabbccdd\x1faabbccd\x1fCarol\x1f2024-03-03\x1f\x1fRenamed file\x00R100\told.txt\tnew.txt";
    let entries = parse_git_log(input);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].files.len(), 1);
    assert_eq!(entries[0].files[0].status, "R");
    assert_eq!(entries[0].files[0].old_path, Some("old.txt".into()));
    assert_eq!(entries[0].files[0].path, "new.txt");
  }

  #[test]
  fn test_parse_git_log_copied_file() {
    let input =
      "\x1eddffgg\x1fddffgg\x1fDave\x1f2024-04-04\x1f\x1fCopied file\x00C065\tsrc/orig.rs\tsrc/copy.rs";
    let entries = parse_git_log(input);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].files[0].status, "C");
    assert_eq!(entries[0].files[0].old_path, Some("src/orig.rs".into()));
    assert_eq!(entries[0].files[0].path, "src/copy.rs");
  }

  #[test]
  fn test_parse_git_log_multiple_entries() {
    let input = "\x1eaaa\x1faaa\x1fAlice\x1f2024-01-01\x1f\x1fFirst\x00M\tf1.txt\x1ebbb\x1fbbb\x1fBob\x1f2024-02-02\x1f\x1fSecond\x00A\tf2.txt";
    let entries = parse_git_log(input);
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].hash, "aaa");
    assert_eq!(entries[0].message, "First");
    assert_eq!(entries[0].files[0].path, "f1.txt");
    assert_eq!(entries[1].hash, "bbb");
    assert_eq!(entries[1].message, "Second");
    assert_eq!(entries[1].files[0].path, "f2.txt");
  }

  #[test]
  fn test_parse_git_log_multiple_files() {
    let input = "\x1eccc\x1fccc\x1fCharlie\x1f2024-03-03\x1f\x1fMulti files\x00M\tf1.rs\nA\tf2.rs\nD\tf3.rs";
    let entries = parse_git_log(input);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].files.len(), 3);
    assert_eq!(entries[0].files[0].status, "M");
    assert_eq!(entries[0].files[0].path, "f1.rs");
    assert_eq!(entries[0].files[1].status, "A");
    assert_eq!(entries[0].files[1].path, "f2.rs");
    assert_eq!(entries[0].files[2].status, "D");
    assert_eq!(entries[0].files[2].path, "f3.rs");
  }

  #[test]
  fn test_parse_git_log_malformed_short_line_skipped() {
    let input = "\x1exxx\x1fyyy\x1fzzz\x00";
    let entries = parse_git_log(input);
    assert!(entries.is_empty());
  }

  #[test]
  fn test_parse_git_log_only_separators() {
    let entries = parse_git_log("\x1e");
    assert!(entries.is_empty());
  }

  #[test]
  fn test_parse_refs_tag() {
    let refs = parse_refs(" (tag: v1.0)");
    assert_eq!(refs.len(), 1);
    assert_eq!(refs[0].name, "v1.0");
    assert_eq!(refs[0].ref_type, "tag");
  }

  #[test]
  fn test_parse_refs_head() {
    let refs = parse_refs(" (HEAD -> main, origin/main)");
    assert_eq!(refs.len(), 2);
    assert_eq!(refs[0].name, "main");
    assert_eq!(refs[0].ref_type, "head");
    assert_eq!(refs[1].name, "origin/main");
    assert_eq!(refs[1].ref_type, "remote");
  }

  #[test]
  fn test_parse_refs_local() {
    let refs = parse_refs(" (feature-branch)");
    assert_eq!(refs.len(), 1);
    assert_eq!(refs[0].name, "feature-branch");
    assert_eq!(refs[0].ref_type, "local");
  }

  #[test]
  fn test_parse_refs_empty() {
    let refs = parse_refs("");
    assert!(refs.is_empty());
  }

  #[test]
  fn test_parse_git_log_with_refs() {
    let input = "\x1eabc1234def\x1fabc1234\x1fAlice\x1f2024-01-01\x1f (HEAD -> main, tag: v1)\x1fInitial commit\x00M\tREADME.md";
    let entries = parse_git_log(input);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].refs.len(), 2);
    assert_eq!(entries[0].refs[0].name, "main");
    assert_eq!(entries[0].refs[0].ref_type, "head");
    assert_eq!(entries[0].refs[1].name, "v1");
    assert_eq!(entries[0].refs[1].ref_type, "tag");
  }
}
