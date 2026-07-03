//! Plan document path helpers — ported from shared/planFilePath.ts

pub const LEGACY_PLAN_DOCUMENT_REL_PATH: &str = ".aiall/PLAN.md";
pub const PLAN_DOCUMENTS_DIR: &str = ".aiall/plans";

pub fn is_plan_document_path(file_path: &str) -> bool {
  let normalized = file_path.replace('\\', "/").trim().to_string();
  if normalized == LEGACY_PLAN_DOCUMENT_REL_PATH {
    return true;
  }
  if !normalized.starts_with(&format!("{PLAN_DOCUMENTS_DIR}/")) {
    return false;
  }
  if normalized.contains("..") {
    return false;
  }
  normalized.ends_with(".md")
}

pub fn build_plan_document_build_mode_blocked_message(tool_name: &str) -> String {
  format!(
    "错误：Build/执行阶段勿对 {PLAN_DOCUMENTS_DIR}/ 下方案文件或 {LEGACY_PLAN_DOCUMENT_REL_PATH} 调用 {tool_name}；方案文档由 Plan 模式或客户端维护，请只修改业务代码。"
  )
}

pub fn plan_document_build_mode_block(mode: &str, relative_path: &str, tool_name: &str) -> Option<String> {
  if mode != "build" {
    return None;
  }
  if !is_plan_document_path(relative_path) {
    return None;
  }
  Some(build_plan_document_build_mode_blocked_message(tool_name))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn detects_plan_document_paths() {
    assert!(is_plan_document_path(LEGACY_PLAN_DOCUMENT_REL_PATH));
    assert!(is_plan_document_path(".aiall/plans/msg-1.md"));
    assert!(!is_plan_document_path(".aiall/plan.md"));
    assert!(!is_plan_document_path("src/PLAN.md"));
  }

  #[test]
  fn build_mode_block_message() {
    let msg = build_plan_document_build_mode_blocked_message("read_file");
    assert!(msg.contains("read_file"));
    assert!(msg.contains(PLAN_DOCUMENTS_DIR));
  }
}
