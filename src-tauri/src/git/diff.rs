use super::exec::git_exec;
use regex::Regex;
use serde::Serialize;
use std::path::Path;

const MAX_DIFF: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffFile {
  pub path: String,
  pub additions: u32,
  pub deletions: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffResult {
  pub ok: bool,
  pub files: Vec<GitDiffFile>,
  pub patch: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffContentResult {
  pub ok: bool,
  pub before: String,
  pub after: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error: Option<String>,
}

pub async fn git_diff(project_root: &str, file_path: Option<&str>, staged: bool) -> GitDiffResult {
  let mut stat_args = vec!["diff", "--stat=200", "--stat-graph-width=0"];
  if staged {
    stat_args.push("--cached");
  }
  if let Some(f) = file_path {
    stat_args.push("--");
    stat_args.push(f);
  }
  let mut patch_args = vec!["diff"];
  if staged {
    patch_args.push("--cached");
  }
  if let Some(f) = file_path {
    patch_args.push("--");
    patch_args.push(f);
  }
  let (stat_res, patch_res) = tokio::join!(
    git_exec(project_root, &stat_args),
    git_exec(project_root, &patch_args)
  );
  match (stat_res, patch_res) {
    (Ok(stat_out), Ok(patch_out)) => {
      let re = Regex::new(r"^\s*(.+?)\s*\|\s*(\d+)").unwrap();
      let mut files = Vec::new();
      for line in stat_out.stdout.lines() {
        if let Some(caps) = re.captures(line) {
          files.push(GitDiffFile {
            path: caps.get(1).map(|m| m.as_str().trim().to_string()).unwrap_or_default(),
            additions: caps.get(2).and_then(|m| m.as_str().parse().ok()).unwrap_or(0),
            deletions: 0,
          });
        }
      }
      GitDiffResult {
        ok: true,
        files,
        patch: patch_out.stdout,
        error: None,
      }
    }
    (_, Err(error)) | (Err(error), _) => GitDiffResult {
      ok: false,
      files: vec![],
      patch: String::new(),
      error: Some(error),
    },
  }
}

#[derive(Debug, Clone)]
pub struct GitNumstatEntry {
  pub path: String,
  pub additions: u32,
  pub deletions: u32,
}

impl GitNumstatEntry {
  pub fn churn(&self) -> u32 {
    self.additions.saturating_add(self.deletions)
  }
}

/// Parse `git diff --numstat` lines. Binary files use `-` for add/del → treated as 0.
pub(crate) fn parse_numstat_stdout(stdout: &str) -> Vec<GitNumstatEntry> {
  let mut out = Vec::new();
  for line in stdout.lines() {
    let line = line.trim();
    if line.is_empty() {
      continue;
    }
    let mut parts = line.splitn(3, '\t');
    let (Some(add_s), Some(del_s), Some(path)) = (parts.next(), parts.next(), parts.next()) else {
      continue;
    };
    let path = path.trim();
    if path.is_empty() {
      continue;
    }
    // Rename format: `{old => new}` — keep the new side when present.
    let path = if let Some(idx) = path.rfind(" => ") {
      path[idx + 4..].trim().trim_matches('{').trim_matches('}').to_string()
    } else {
      path.to_string()
    };
    let additions = if add_s == "-" {
      0
    } else {
      add_s.parse().unwrap_or(0)
    };
    let deletions = if del_s == "-" {
      0
    } else {
      del_s.parse().unwrap_or(0)
    };
    out.push(GitNumstatEntry {
      path,
      additions,
      deletions,
    });
  }
  out
}

pub async fn git_diff_numstat(project_root: &str, staged: bool) -> Result<Vec<GitNumstatEntry>, String> {
  let mut args = vec![
    "-c",
    "core.quotepath=false",
    "diff",
    "--numstat",
    "--no-ext-diff",
    "--no-textconv",
    "--ignore-submodules=dirty",
  ];
  if staged {
    args.insert(3, "--cached");
  }
  let out = super::exec::git_exec_short(project_root, &args).await?;
  Ok(parse_numstat_stdout(&out.stdout))
}

pub async fn git_diff_file_patch_quick(
  project_root: &str,
  file_path: &str,
  staged: bool,
) -> Result<String, String> {
  let mut args = vec![
    "-c",
    "core.quotepath=false",
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--ignore-submodules=dirty",
    "-U1",
    "--",
    file_path,
  ];
  if staged {
    args.insert(3, "--cached");
  }
  let out = super::exec::git_exec_short(project_root, &args).await?;
  Ok(out.stdout)
}

pub fn is_low_value_ai_diff_path(path: &str) -> bool {
  let lower = path.replace('\\', "/").to_ascii_lowercase();
  lower.ends_with("package-lock.json")
    || lower.ends_with("pnpm-lock.yaml")
    || lower.ends_with("yarn.lock")
    || lower.ends_with("cargo.lock")
    || lower.ends_with(".min.js")
    || lower.ends_with(".min.css")
    || lower.ends_with(".map")
    || lower.contains("/dist/")
    || lower.starts_with("dist/")
    || lower.contains("/build/")
    || lower.starts_with("build/")
    || lower.contains("/out/")
    || lower.starts_with("out/")
    || lower.contains("/node_modules/")
}

pub(crate) fn parse_unified_diff(diff_output: &str) -> (String, String) {
  let mut before = Vec::new();
  let mut after = Vec::new();
  for line in diff_output.lines() {
    if line.starts_with("diff --git")
      || line.starts_with("index ")
      || line.starts_with("--- ")
      || line.starts_with("+++")
      || line.starts_with("@@ ")
    {
      continue;
    }
    if line.starts_with('-') && !line.starts_with("---") {
      before.push(&line[1..]);
    } else if line.starts_with('+') && !line.starts_with("+++") {
      after.push(&line[1..]);
    } else if line.starts_with(' ') {
      before.push(&line[1..]);
      after.push(&line[1..]);
    }
  }
  (before.join("\n"), after.join("\n"))
}

async fn read_worktree_file(project_root: &str, file_path: &str) -> Result<String, String> {
  let full = Path::new(project_root).join(file_path);
  if !full.exists() {
    return Ok(String::new());
  }
  let meta = tokio::fs::metadata(&full).await.map_err(|e| e.to_string())?;
  if meta.is_dir() {
    return Ok(String::new());
  }
  if meta.len() as usize > MAX_DIFF {
    return Err(format!("{file_path} 过大，无法预览"));
  }
  let bytes = tokio::fs::read(&full).await.map_err(|e| e.to_string())?;
  if bytes.contains(&0) {
    return Err(format!("{file_path} 是二进制文件，无法预览"));
  }
  Ok(String::from_utf8_lossy(&bytes).into_owned())
}

pub async fn git_diff_content(
  project_root: &str,
  file_path: &str,
  staged: bool,
) -> GitDiffContentResult {
  if file_path.ends_with('/') {
    return GitDiffContentResult {
      ok: true,
      before: String::new(),
      after: String::new(),
      error: None,
    };
  }
  let diff_args = if staged {
    vec!["diff", "--cached", "--no-color", "-U100000", "--", file_path]
  } else {
    vec!["diff", "--no-color", "-U100000", "--", file_path]
  };
  match git_exec(project_root, &diff_args).await {
    Ok(out) if !out.stdout.trim().is_empty() => {
      let (before, after) = parse_unified_diff(&out.stdout);
      GitDiffContentResult {
        ok: true,
        before,
        after,
        error: None,
      }
    }
    _ => {
      let after = read_worktree_file(project_root, file_path).await.unwrap_or_default();
      GitDiffContentResult {
        ok: true,
        before: String::new(),
        after,
        error: None,
      }
    }
  }
}

pub async fn git_commit_file_diff(
  project_root: &str,
  hash: &str,
  file_path: &str,
  old_path: Option<&str>,
) -> GitDiffContentResult {
  let parent = git_exec(project_root, &["rev-list", "--parents", "-n", "1", hash])
    .await
    .ok()
    .and_then(|o| o.stdout.split_whitespace().nth(1).map(|s| s.to_string()));
  let before_ref = parent
    .as_ref()
    .map(|p| format!("{p}:{}", old_path.unwrap_or(file_path)));
  let after_ref = format!("{hash}:{file_path}");
  let before = if let Some(ref b) = before_ref {
    git_exec(project_root, &["show", b])
      .await
      .map(|o| o.stdout)
      .unwrap_or_default()
  } else {
    String::new()
  };
  let after = git_exec(project_root, &["show", &after_ref])
    .await
    .map(|o| o.stdout)
    .unwrap_or_default();
  GitDiffContentResult {
    ok: true,
    before,
    after,
    error: None,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_parse_unified_diff_standard() {
    let diff = "\
diff --git a/file.txt b/file.txt
index abc..def 100644
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,4 @@
 context
-old line
+new line
 more context";
    let (before, after) = parse_unified_diff(diff);
    assert_eq!(before, "context\nold line\nmore context");
    assert_eq!(after, "context\nnew line\nmore context");
  }

  #[test]
  fn test_parse_unified_diff_empty() {
    let (before, after) = parse_unified_diff("");
    assert!(before.is_empty());
    assert!(after.is_empty());
  }

  #[test]
  fn test_parse_unified_diff_binary() {
    let diff = "\
diff --git a/image.png b/image.png
index abc..def 100644
Binary files a/image.png and b/image.png differ";
    let (before, after) = parse_unified_diff(diff);
    assert!(before.is_empty());
    assert!(after.is_empty());
  }

  #[test]
  fn test_parse_unified_diff_only_headers() {
    let diff = "\
diff --git a/f.txt b/f.txt
index a..b 100644
--- a/f.txt
+++ b/f.txt
@@ -1 +1 @@
";
    let (before, after) = parse_unified_diff(diff);
    assert!(before.is_empty());
    assert!(after.is_empty());
  }

  #[test]
  fn test_parse_unified_diff_context_only() {
    let diff = "\
--- a/f.txt
+++ b/f.txt
@@ -1 +1 @@
 same line
";
    let (before, after) = parse_unified_diff(diff);
    assert_eq!(before, "same line");
    assert_eq!(after, "same line");
  }

  #[test]
  fn test_parse_unified_diff_additions_only() {
    let diff = "\
--- a/f.txt
+++ b/f.txt
@@ -0,0 +1 @@
+entirely new
";
    let (before, after) = parse_unified_diff(diff);
    assert!(before.is_empty());
    assert_eq!(after, "entirely new");
  }

  #[test]
  fn test_parse_unified_diff_deletions_only() {
    let diff = "\
--- a/f.txt
+++ b/f.txt
@@ -1 +0,0 @@
-entirely removed
";
    let (before, after) = parse_unified_diff(diff);
    assert_eq!(before, "entirely removed");
    assert!(after.is_empty());
  }

  #[test]
  fn test_parse_numstat_stdout() {
    let raw = "\
12\t3\tsrc/a.ts
-\t-\tassets/logo.png
0\t5\told/x.ts => new/x.ts
";
    let entries = parse_numstat_stdout(raw);
    assert_eq!(entries.len(), 3);
    assert_eq!(entries[0].path, "src/a.ts");
    assert_eq!(entries[0].churn(), 15);
    assert_eq!(entries[1].path, "assets/logo.png");
    assert_eq!(entries[1].churn(), 0);
    assert_eq!(entries[2].path, "new/x.ts");
    assert_eq!(entries[2].deletions, 5);
  }

  #[test]
  fn test_is_low_value_ai_diff_path() {
    assert!(is_low_value_ai_diff_path("package-lock.json"));
    assert!(is_low_value_ai_diff_path("src/dist/bundle.js"));
    assert!(!is_low_value_ai_diff_path("src/composables/useGitPanel.ts"));
  }
}
