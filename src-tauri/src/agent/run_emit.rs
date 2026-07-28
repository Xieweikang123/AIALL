use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::ipc::Channel;

pub(crate) const AGENT_SAFETY_MAX_TURNS: u32 = 200;

pub(crate) fn build_segment_continue_nudge(completed_turn: u32, segment_index: u32, mode: &str) -> String {
  let action_hint = match mode {
    "explore" => "请补充报告遗漏模块并更新项目理解报告，不要再无差别广搜。禁止空回复。",
    "plan" => "请立即输出结构化修改方案，不要再继续读文件。",
    _ => "不要重复已完成的 read/grep；直接 patch_file / write_file 完成剩余修改，然后给出最终总结（已改文件、如何验证、未修项）。禁止空回复。",
  };
  format!(
    "【系统自动续跑·第 {segment_index} 段】仍在同一次任务中（累计 {completed_turn} 轮）。{action_hint}"
  )
}

pub(crate) fn build_agent_turns_low_nudge(
  turn: u32,
  max_turns: u32,
  mode: &str,
  executing_plan: bool,
) -> String {
  let remaining = max_turns.saturating_sub(turn).saturating_add(1);
  let action_hint = match mode {
    "explore" => {
      "请基于已读内容立即输出或更新项目理解报告（含 project-knowledge 标记）；避免再开新的广泛探索。禁止空回复。"
    }
    "plan" if !executing_plan => {
      "请立即输出结构化修改方案，然后给出简要总结；避免再开新的广泛探索。"
    }
    _ => {
      "请优先完成必要的 patch_file / write_file，然后给出简要总结（已改文件、验证方式、剩余问题）；避免再开新的广泛探索。禁止空回复结束。"
    }
  };
  format!(
    "【系统提示】剩余约 {remaining} 轮（当前第 {turn}/{max_turns} 轮）。\n{action_hint}"
  )
}

pub(crate) fn build_turn_cap_exhausted_message(completed_turn: u32) -> String {
  format!("已达轮数上限（{completed_turn} 轮），请输出最终总结后结束。")
}

pub(crate) fn extend_segment_max_turns(completed_turn: u32, segment_budget: u32) -> u32 {
  (completed_turn + segment_budget).min(AGENT_SAFETY_MAX_TURNS)
}

pub(crate) fn filter_read_only_tools(all_tools: &Value, read_set: &std::collections::HashSet<&str>) -> Value {
  let filtered = all_tools.as_array().map(|a| {
    a.iter()
      .filter(|t| {
        t["function"]["name"]
          .as_str()
          .map_or(false, |n| read_set.contains(n))
      })
      .cloned()
      .collect::<Vec<_>>()
  }).unwrap_or_default();
  json!(filtered)
}

pub(crate) fn filter_write_only_tools(all_tools: &Value) -> Value {
  let allowed: std::collections::HashSet<&str> = [
    "write_file", "patch_file", "delete_file", "run_command",
  ]
  .into_iter()
  .collect();
  filter_tools_by_names(all_tools, &allowed)
}

pub(crate) fn filter_force_patch_tools(all_tools: &Value) -> Value {
  let allowed: std::collections::HashSet<&str> = [
    "patch_file",
    "write_file",
    "read_file",
    "list_dir",
    "search_files",
    "grep",
    "run_command",
    "web_search",
    "web_extract",
  ]
  .into_iter()
  .collect();
  filter_tools_by_names(all_tools, &allowed)
}

pub(crate) fn filter_strip_wide_search_tools(all_tools: &Value) -> Value {
  let blocked: std::collections::HashSet<&str> = [
    "grep",
    "search_files",
    "run_command",
    "web_search",
    "web_extract",
  ]
  .into_iter()
  .collect();
  let filtered = all_tools.as_array().map(|a| {
    a.iter()
      .filter(|t| {
        t["function"]["name"]
          .as_str()
          .map_or(false, |n| !blocked.contains(n))
      })
      .cloned()
      .collect::<Vec<_>>()
  }).unwrap_or_default();
  json!(filtered)
}

fn filter_tools_by_names(all_tools: &Value, allowed: &std::collections::HashSet<&str>) -> Value {
  let filtered = all_tools.as_array().map(|a| {
    a.iter()
      .filter(|t| {
        t["function"]["name"]
          .as_str()
          .map_or(false, |n| allowed.contains(n))
      })
      .cloned()
      .collect::<Vec<_>>()
  }).unwrap_or_default();
  json!(filtered)
}

pub(crate) fn emit(channel: &Channel<Value>, event: Value) {
  let _ = channel.send(event);
}

pub(crate) fn is_cancelled(cancel: &AtomicBool) -> bool {
  cancel.load(Ordering::Relaxed)
}

pub(crate) fn emit_aborted_done(channel: &Channel<Value>, written_files: &[String], turns: u32) {
  emit(channel, json!({ "type": "status", "data": { "phase": "aborted" } }));
  emit(
    channel,
    json!({
      "type": "done",
      "data": { "writtenFiles": written_files, "pendingFiles": [], "turns": turns }
    }),
  );
}

#[cfg(test)]
mod tests {
  use super::*;

  // ── build_segment_continue_nudge ──

  #[test]
  fn segment_continue_nudge_explore_mode() {
    let nudge = build_segment_continue_nudge(5, 2, "explore");
    assert!(nudge.contains("第 2 段"));
    assert!(nudge.contains("累计 5 轮"));
    assert!(nudge.contains("补充报告遗漏模块"));
  }

  #[test]
  fn segment_continue_nudge_plan_mode() {
    let nudge = build_segment_continue_nudge(3, 1, "plan");
    assert!(nudge.contains("第 1 段"));
    assert!(nudge.contains("输出结构化修改方案"));
    assert!(!nudge.contains("patch_file"));
  }

  #[test]
  fn segment_continue_nudge_build_mode() {
    let nudge = build_segment_continue_nudge(10, 3, "build");
    assert!(nudge.contains("第 3 段"));
    assert!(nudge.contains("直接 patch_file / write_file 完成剩余修改"));
  }

  #[test]
  fn segment_continue_nudge_unknown_mode() {
    let nudge = build_segment_continue_nudge(1, 1, "ask");
    assert!(nudge.contains("patch_file / write_file"));
    assert!(nudge.contains("禁止空回复"));
  }

  // ── build_agent_turns_low_nudge ──

  #[test]
  fn turns_low_nudge_explore_mode() {
    let nudge = build_agent_turns_low_nudge(8, 10, "explore", false);
    assert!(nudge.contains("剩余约 3 轮"));
    assert!(nudge.contains("项目理解报告"));
  }

  #[test]
  fn turns_low_nudge_plan_not_executing() {
    let nudge = build_agent_turns_low_nudge(9, 10, "plan", false);
    assert!(nudge.contains("输出结构化修改方案"));
  }

  #[test]
  fn turns_low_nudge_plan_executing() {
    let nudge = build_agent_turns_low_nudge(9, 10, "plan", true);
    assert!(nudge.contains("patch_file / write_file"));
  }

  #[test]
  fn turns_low_nudge_build_mode() {
    let nudge = build_agent_turns_low_nudge(7, 10, "build", false);
    assert!(nudge.contains("patch_file / write_file"));
    assert!(nudge.contains("剩余约 4 轮"));
  }

  #[test]
  fn turns_low_nudge_exact_last_turn() {
    let nudge = build_agent_turns_low_nudge(10, 10, "build", false);
    assert!(nudge.contains("剩余约 1 轮"));
    assert!(nudge.contains("第 10/10 轮"));
  }

  #[test]
  fn turns_low_nudge_overflow_saturates() {
    let nudge = build_agent_turns_low_nudge(20, 10, "build", false);
    // saturating_sub means remaining = 0 + 1 = 1
    assert!(nudge.contains("剩余约 1 轮"));
  }

  // ── build_turn_cap_exhausted_message ──

  #[test]
  fn turn_cap_exhausted_message_format() {
    let msg = build_turn_cap_exhausted_message(42);
    assert_eq!(msg, "已达轮数上限（42 轮），请输出最终总结后结束。");
  }

  #[test]
  fn turn_cap_exhausted_message_zero() {
    let msg = build_turn_cap_exhausted_message(0);
    assert_eq!(msg, "已达轮数上限（0 轮），请输出最终总结后结束。");
  }

  // ── extend_segment_max_turns ──

  #[test]
  fn extend_segment_max_turns_normal() {
    assert_eq!(extend_segment_max_turns(10, 15), 25);
  }

  #[test]
  fn extend_segment_max_turns_capped() {
    assert_eq!(extend_segment_max_turns(180, 30), AGENT_SAFETY_MAX_TURNS);
  }

  #[test]
  fn extend_segment_max_turns_at_limit() {
    assert_eq!(extend_segment_max_turns(200, 0), 200);
  }

  #[test]
  fn extend_segment_max_turns_exact_cap() {
    assert_eq!(extend_segment_max_turns(150, 50), 200);
  }

  // ── filter_read_only_tools ──

  #[test]
  fn filter_read_only_tools_selects_read_tools() {
    let all = json!([
      {"function": {"name": "read_file"}},
      {"function": {"name": "write_file"}},
      {"function": {"name": "grep"}},
      {"function": {"name": "run_command"}},
    ]);
    let read_set: std::collections::HashSet<&str> =
      ["read_file", "grep"].into_iter().collect();
    let filtered = filter_read_only_tools(&all, &read_set);
    let names: Vec<&str> = filtered.as_array().unwrap()
      .iter().map(|t| t["function"]["name"].as_str().unwrap()).collect();
    assert_eq!(names, vec!["read_file", "grep"]);
  }

  #[test]
  fn filter_read_only_tools_empty_all() {
    let all = json!([]);
    let read_set: std::collections::HashSet<&str> = ["read_file"].into_iter().collect();
    let filtered = filter_read_only_tools(&all, &read_set);
    assert_eq!(filtered.as_array().unwrap().len(), 0);
  }

  #[test]
  fn filter_read_only_tools_non_array_fallback() {
    let all = json!("not an array");
    let read_set: std::collections::HashSet<&str> = ["read_file"].into_iter().collect();
    let filtered = filter_read_only_tools(&all, &read_set);
    assert_eq!(filtered.as_array().unwrap().len(), 0);
  }

  // ── filter_write_only_tools ──

  #[test]
  fn filter_write_only_tools_selects_write_tools() {
    let all = json!([
      {"function": {"name": "read_file"}},
      {"function": {"name": "write_file"}},
      {"function": {"name": "patch_file"}},
      {"function": {"name": "delete_file"}},
      {"function": {"name": "run_command"}},
      {"function": {"name": "grep"}},
    ]);
    let filtered = filter_write_only_tools(&all);
    let names: Vec<&str> = filtered.as_array().unwrap()
      .iter().map(|t| t["function"]["name"].as_str().unwrap()).collect();
    assert_eq!(names, vec!["write_file", "patch_file", "delete_file", "run_command"]);
  }

  #[test]
  fn filter_write_only_tools_empty() {
    let all = json!([{"function": {"name": "read_file"}}]);
    let filtered = filter_write_only_tools(&all);
    assert_eq!(filtered.as_array().unwrap().len(), 0);
  }

  // ── filter_force_patch_tools ──

  #[test]
  fn filter_force_patch_tools_allows_limited_set() {
    let all = json!([
      {"function": {"name": "patch_file"}},
      {"function": {"name": "write_file"}},
      {"function": {"name": "read_file"}},
      {"function": {"name": "list_dir"}},
      {"function": {"name": "grep"}},
      {"function": {"name": "search_files"}},
      {"function": {"name": "delete_file"}},
      {"function": {"name": "run_command"}},
    ]);
    let filtered = filter_force_patch_tools(&all);
    let names: Vec<&str> = filtered.as_array().unwrap()
      .iter().map(|t| t["function"]["name"].as_str().unwrap()).collect();
    assert_eq!(names, vec!["patch_file", "write_file", "read_file", "list_dir", "grep", "search_files", "run_command"]);
  }

  #[test]
  fn filter_force_patch_tools_excludes_delete() {
    let all = json!([
      {"function": {"name": "delete_file"}},
      {"function": {"name": "patch_file"}},
    ]);
    let filtered = filter_force_patch_tools(&all);
    let names: Vec<&str> = filtered.as_array().unwrap()
      .iter().map(|t| t["function"]["name"].as_str().unwrap()).collect();
    assert_eq!(names, vec!["patch_file"]);
  }

  // ── filter_strip_wide_search_tools ──

  #[test]
  fn filter_strip_wide_search_blocks_grep_and_search() {
    let all = json!([
      {"function": {"name": "read_file"}},
      {"function": {"name": "grep"}},
      {"function": {"name": "search_files"}},
      {"function": {"name": "write_file"}},
      {"function": {"name": "patch_file"}},
      {"function": {"name": "run_command"}},
    ]);
    let filtered = filter_strip_wide_search_tools(&all);
    let names: Vec<&str> = filtered.as_array().unwrap()
      .iter().map(|t| t["function"]["name"].as_str().unwrap()).collect();
    assert_eq!(names, vec!["read_file", "write_file", "patch_file"]);
  }

  #[test]
  fn filter_strip_wide_search_non_array_fallback() {
    let all = json!("invalid");
    let filtered = filter_strip_wide_search_tools(&all);
    assert_eq!(filtered.as_array().unwrap().len(), 0);
  }

  // ── is_cancelled ──

  #[test]
  fn is_cancelled_false_by_default() {
    let flag = AtomicBool::new(false);
    assert!(!is_cancelled(&flag));
  }

  #[test]
  fn is_cancelled_true_when_set() {
    let flag = AtomicBool::new(true);
    assert!(is_cancelled(&flag));
  }
}
