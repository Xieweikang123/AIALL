//! Agent routing regression vectors for desktop policy parity.

use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;

use super::context::HistoryMessage;
use super::policy::{AgentMode, ResolvePolicyInput, resolve_run_policy};
use super::run_types::ResolvedUserIntentPayload;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RustRegressionPolicyInput {
  id: String,
  prompt: String,
  mode: String,
  history: Option<Vec<HistoryMessage>>,
  has_image: bool,
  user_intent: ResolvedUserIntentPayload,
  is_execute_plan: bool,
  is_plan_explore: bool,
  trigger_source: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RustRegressionVector {
  input: RustRegressionPolicyInput,
  expect: HashMap<String, Value>,
}

#[derive(Debug, Deserialize)]
struct RustRegressionFile {
  vectors: Vec<RustRegressionVector>,
}

#[derive(Debug)]
pub struct RustRegressionMismatch {
  pub id: String,
  pub field: String,
  pub expected: Value,
  pub actual: Value,
}

fn is_read_only_agent(mode: &str) -> bool {
  mode == "ask" || mode == "explore"
}

fn evaluate_rust_policy_actual(input: &RustRegressionPolicyInput) -> HashMap<String, Value> {
  let user_intent = input.user_intent.to_user_intent();
  let policy = resolve_run_policy(ResolvePolicyInput {
    prompt: input.prompt.clone(),
    mode: AgentMode::from_str(&input.mode),
    user_intent,
    has_image: input.has_image,
    is_execute_plan: input.is_execute_plan,
    is_plan_explore: input.is_plan_explore,
    trigger_source: input.trigger_source.clone(),
    history: input.history.clone(),
  });
  let read_only_tools = policy.uses_read_only_tools(is_read_only_agent(&input.mode), input.is_plan_explore);

  let mut actual = HashMap::new();
  actual.insert("readOnlyBuildRun".into(), json!(policy.read_only_build_run));
  actual.insert("readOnlyTools".into(), json!(read_only_tools));
  actual.insert("implementFollowUpRun".into(), json!(policy.implement_follow_up_run));
  actual.insert("uiDefectBuildRun".into(), json!(policy.ui_defect_build_run));
  actual.insert(
    "consultativeUiAppearanceRun".into(),
    json!(policy.consultative_ui_appearance_run),
  );
  actual.insert("ultraShortOpenTaskRun".into(), json!(policy.ultra_short_open_task_run));
  actual.insert("codeReviewRun".into(), json!(policy.code_review_run));
  actual.insert("sameIssueFollowUpRun".into(), json!(policy.same_issue_follow_up_run));
  actual.insert(
    "behaviorContradictionRun".into(),
    json!(policy.behavior_contradiction_run),
  );
  actual.insert(
    "scheduledTaskConsultativeRun".into(),
    json!(policy.scheduled_task_consultative_run),
  );
  actual.insert("quotedAmendRun".into(), json!(policy.quoted_amend_run));
  actual.insert("exploreHardCap".into(), json!(policy.explore_hard_cap));
  actual.insert("maxContextChars".into(), json!(policy.max_context_chars));
  actual.insert("automatedBugFixRun".into(), json!(policy.automated_bug_fix_run));
  actual.insert(
    "disableSegmentAutoExtend".into(),
    json!(policy.disable_segment_auto_extend),
  );
  actual
}

fn values_equal(expected: &Value, actual: &Value) -> bool {
  match (expected, actual) {
    (Value::Number(a), Value::Number(b)) => {
      a.as_f64().zip(b.as_f64()).map_or(false, |(x, y)| (x - y).abs() < f64::EPSILON)
    }
    _ => expected == actual,
  }
}

#[allow(dead_code)]
pub fn run_rust_regression_vectors(vectors: &[RustRegressionVector]) -> Vec<RustRegressionMismatch> {
  let mut mismatches = Vec::new();
  for vector in vectors {
    let actual = evaluate_rust_policy_actual(&vector.input);
    for (field, expected) in &vector.expect {
      let actual_value = actual.get(field).cloned().unwrap_or(Value::Null);
      if !values_equal(expected, &actual_value) {
        mismatches.push(RustRegressionMismatch {
          id: vector.input.id.clone(),
          field: field.clone(),
          expected: expected.clone(),
          actual: actual_value,
        });
      }
    }
  }
  mismatches
}

#[allow(dead_code)]
pub fn load_and_run_rust_regression_vectors(path: &Path) -> Result<Vec<RustRegressionMismatch>, String> {
  let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
  let file: RustRegressionFile = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
  Ok(run_rust_regression_vectors(&file.vectors))
}

#[allow(dead_code)]
pub fn format_rust_regression_mismatches(mismatches: &[RustRegressionMismatch]) -> String {
  if mismatches.is_empty() {
    return "Rust agent regression: all policy vectors passed".to_string();
  }
  let mut lines = vec![format!("Rust agent regression: {} mismatch(es)", mismatches.len())];
  let mut current_id = String::new();
  for item in mismatches {
    if item.id != current_id {
      current_id = item.id.clone();
      lines.push(format!("  ✗ {current_id}"));
    }
    lines.push(format!(
      "      {}: expected {}, got {}",
      item.field,
      item.expected,
      item.actual
    ));
  }
  lines.join("\n")
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn agent_regression_vectors_from_file() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("agent-regression-vectors.json");
    if !path.exists() {
      return;
    }
    let mismatches = load_and_run_rust_regression_vectors(&path).expect("parse vectors");
    if !mismatches.is_empty() {
      panic!("{}", format_rust_regression_mismatches(&mismatches));
    }
  }
}
