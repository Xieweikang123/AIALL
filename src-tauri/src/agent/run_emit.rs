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
