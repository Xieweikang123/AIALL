//! Probe / introspect guardrails (Tier 2 mechanism).
//! Ported from shared/agentProbeGuard.ts

use std::collections::HashSet;

pub const LARGE_FILE_LINE_THRESHOLD: usize = 500;

pub fn normalize_probe_path(path: &str) -> String {
  path.replace('\\', "/").trim().to_string()
}

pub fn is_ephemeral_probe_path(path: &str) -> bool {
  let p = normalize_probe_path(path);
  if regex::Regex::new(r"(?i)^\.aiall/probe/")
    .map(|re| re.is_match(&p))
    .unwrap_or(false)
  {
    return true;
  }
  if regex::Regex::new(
    r"(?i)^(schema|dump|temp|test_connection|probe)[^/]*\.(json|sql|txt|py|js|ts|cs|sh)$",
  )
  .map(|re| re.is_match(&p))
  .unwrap_or(false)
  {
    return true;
  }
  regex::Regex::new(r"(?i)_(result|dump|schema)\.json$")
    .map(|re| re.is_match(&p))
    .unwrap_or(false)
}

#[derive(Debug, Default)]
pub struct ProbeArtifactTracker {
  written: HashSet<String>,
  deleted: HashSet<String>,
}

impl ProbeArtifactTracker {
  pub fn track_write(&mut self, relative_path: &str) {
    let key = normalize_probe_path(relative_path);
    if key.is_empty() {
      return;
    }
    self.deleted.remove(&key);
    self.written.insert(key);
  }

  pub fn track_delete(&mut self, relative_path: &str) {
    let key = normalize_probe_path(relative_path);
    if key.is_empty() {
      return;
    }
    self.deleted.insert(key);
  }

  pub fn list_uncleaned(&self) -> Vec<String> {
    self
      .written
      .iter()
      .filter(|p| !self.deleted.contains(*p))
      .cloned()
      .collect()
  }
}

pub fn build_workspace_cleanup_nudge(uncleaned_paths: &[String]) -> String {
  let list = uncleaned_paths.iter().take(6).cloned().collect::<Vec<_>>().join("、");
  let extra = if uncleaned_paths.len() > 6 {
    format!(" 等 {} 个", uncleaned_paths.len())
  } else {
    String::new()
  };
  [
    "【系统提示】本轮仍留有探测临时文件或未清理的辅助产物：",
    &format!("{list}{extra}"),
    "在最终向用户宣告完成前，必须 delete_file 删除临时文件。",
    "清理完成后再输出总结。",
  ]
  .join("")
}

pub fn is_introspect_business_route_patch(
  file_path: &str,
  old_string: &str,
  new_string: &str,
) -> bool {
  let p = normalize_probe_path(file_path);
  let is_business_entry = regex::Regex::new(r"(?i)(^|/)controllers?/")
    .map(|re| re.is_match(&p))
    .unwrap_or(false)
    || regex::Regex::new(r"(?i)(^|/)routes?/")
      .map(|re| re.is_match(&p))
      .unwrap_or(false)
    || regex::Regex::new(r"(?i)Controller\.(cs|ts|js|py|go|rb)$")
      .map(|re| re.is_match(&p))
      .unwrap_or(false)
    || regex::Regex::new(r"(?i)(^|/)handlers?/")
      .map(|re| re.is_match(&p))
      .unwrap_or(false);
  if !is_business_entry {
    return false;
  }

  let adds_route = regex::Regex::new(r"(?i)\[(HttpGet|HttpPost|HttpPut|HttpDelete|Route)\s*\(")
    .map(|re| re.is_match(new_string))
    .unwrap_or(false)
    || regex::Regex::new(r"(?i)\.(MapGet|MapPost|MapPut|MapDelete)\s*\(")
      .map(|re| re.is_match(new_string))
      .unwrap_or(false);
  if !adds_route {
    return false;
  }

  let combined = format!("{old_string}\n{new_string}");
  regex::Regex::new(
    r"(?i)information_schema|INFORMATION_SCHEMA|GetTableInfo|DbMaintenance|schema-db|table-columns|introspect|TABLE_SCHEMA",
  )
  .map(|re| re.is_match(&combined))
  .unwrap_or(false)
}

pub fn build_introspect_probe_blocked_message() -> String {
  [
    "错误：禁止为临时自省/拉取外部元数据而修改业务 Controller 或路由。",
    "请改用 run_command 执行一次性 CLI，或在 `.aiall/probe/` 下创建跑完即自动退出的独立脚本。",
    "禁止通过启动常驻服务并用 HTTP 自调用的方式探测环境。",
  ]
  .join("")
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn blocks_introspect_route_patch_on_controller() {
    assert!(is_introspect_business_route_patch(
      "src/controllers/DbController.cs",
      "public class DbController {}",
      "[HttpGet(\"schema-db\")] public IActionResult Get() => Ok();",
    ));
  }

  #[test]
  fn allows_unrelated_controller_patch() {
    assert!(!is_introspect_business_route_patch(
      "src/controllers/UserController.cs",
      "return Ok();",
      "return NotFound();",
    ));
  }

  #[test]
  fn blocked_message_mentions_probe_dir() {
    assert!(build_introspect_probe_blocked_message().contains(".aiall/probe/"));
  }

  #[test]
  fn tracks_ephemeral_probe_lifecycle() {
    let mut tracker = ProbeArtifactTracker::default();
    tracker.track_write(".aiall/probe/schema.json");
    assert_eq!(tracker.list_uncleaned(), vec![".aiall/probe/schema.json"]);
    tracker.track_delete(".aiall/probe/schema.json");
    assert!(tracker.list_uncleaned().is_empty());
  }

  #[test]
  fn is_ephemeral_probe_path_matches_probe_dir() {
    assert!(is_ephemeral_probe_path(".aiall/probe/run.py"));
    assert!(!is_ephemeral_probe_path("src/main.ts"));
  }
}
