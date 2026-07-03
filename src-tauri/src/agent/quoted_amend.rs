//! Tier 1 — quoted amend intent (ported from quotedAmendIntent.ts).

use once_cell::sync::Lazy;
use regex::Regex;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QuotedAmendKind {
  Remove,
  Add,
  Replace,
  Ambiguous,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuotedAmendIntent {
  pub kind: QuotedAmendKind,
  pub quoted_lines: Vec<String>,
  pub amend_body: String,
  pub scope_hint: Option<String>,
  pub symbol_hints: Vec<String>,
}

static QUOTED_LINE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*>").unwrap());

static REMOVE_AMEND_BODY_RE: Lazy<Regex> = Lazy::new(|| {
  Regex::new(
    r"^(?:也|同样|一样)?(?:移除|去掉|删除|删掉|不要(?:这段|这个|上面)?|取消|撤销)\s*[。！!]?$",
  )
  .unwrap()
});

static REMOVE_AMEND_LOOSE_RE: Lazy<Regex> = Lazy::new(|| {
  Regex::new(r"(?:也|同样|一样)(?:移除|去掉|删除|删掉)|不要(?:这段|这个|上面)").unwrap()
});

pub fn extract_quoted_lines(prompt: &str) -> Vec<String> {
  prompt
    .lines()
    .filter(|line| QUOTED_LINE_RE.is_match(line))
    .map(|line| {
      line.trim_start_matches(|c: char| c.is_whitespace() || c == '>')
        .trim_start()
        .to_string()
    })
    .filter(|line| !line.is_empty())
    .collect()
}

pub fn extract_amend_body(prompt: &str) -> String {
  prompt
    .lines()
    .filter(|line| !QUOTED_LINE_RE.is_match(line))
    .collect::<Vec<_>>()
    .join("\n")
    .trim()
    .to_string()
}

pub fn extract_symbol_hints(text: &str) -> Vec<String> {
  let mut hints: Vec<String> = Vec::new();
  let mut seen = std::collections::HashSet::new();

  let mut add = |raw: &str| {
    let value = raw.trim();
    if value.len() < 2 || value.len() > 80 {
      return;
    }
    let key = value.to_lowercase();
    if seen.insert(key) {
      hints.push(value.to_string());
    }
  };

  static BACKTICK_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"`([^`]{2,80})`").unwrap());
  for cap in BACKTICK_RE.captures_iter(text) {
    if let Some(m) = cap.get(1) {
      add(m.as_str());
    }
  }
  static PASCAL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\b[A-Z][a-zA-Z0-9]{2,}(?:[A-Z][a-zA-Z0-9]+)+\b").unwrap());
  for cap in PASCAL_RE.captures_iter(text) {
    if let Some(m) = cap.get(0) {
      add(m.as_str());
    }
  }

  hints.truncate(8);
  hints
}

fn extract_scope_hint(quoted_lines: &[String]) -> Option<String> {
  static AGENT_PREFIX_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^(?:Agent|助手|Assistant)\s*[:：]\s*").unwrap());
  static SCOPE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^(.+?)[：:]\s*.+").unwrap());

  for line in quoted_lines {
    let cleaned = AGENT_PREFIX_RE.replace(line, "").trim().to_string();
    if let Some(cap) = SCOPE_RE.captures(&cleaned) {
      if let Some(scope) = cap.get(1) {
        let s = scope.as_str().trim();
        if !s.is_empty() {
          return Some(s.to_string());
        }
      }
    }
  }
  None
}

fn infer_remove_intent(amend_body: &str, full_prompt: &str) -> bool {
  let body = amend_body.trim();
  if body.is_empty() {
    return REMOVE_AMEND_LOOSE_RE.is_match(full_prompt);
  }
  if REMOVE_AMEND_BODY_RE.is_match(body) {
    return true;
  }
  if body.chars().count() <= 24 && REMOVE_AMEND_LOOSE_RE.is_match(body) {
    return true;
  }
  body.contains("不要") && body.chars().count() <= 16
}

fn infer_add_intent(amend_body: &str) -> bool {
  let body = amend_body.trim();
  if body.is_empty() || body.chars().count() > 32 {
    return false;
  }
  Regex::new(r"(?:加上|添加|加入|补回|恢复)")
    .unwrap()
    .is_match(body)
    && !infer_remove_intent(body, body)
}

pub fn resolve_quoted_amend_intent(prompt: &str) -> Option<QuotedAmendIntent> {
  let trimmed = prompt.trim();
  if trimmed.is_empty() {
    return None;
  }

  let quoted_lines = extract_quoted_lines(trimmed);
  if quoted_lines.is_empty() {
    return None;
  }

  let amend_body = extract_amend_body(trimmed);
  let wants_remove = infer_remove_intent(&amend_body, trimmed);
  let wants_add = !wants_remove && infer_add_intent(&amend_body);

  if !wants_remove && !wants_add {
    return None;
  }

  let symbol_hints = extract_symbol_hints(&quoted_lines.join("\n"));
  let scope_hint = extract_scope_hint(&quoted_lines);

  if wants_remove {
    if symbol_hints.is_empty() && amend_body.chars().count() <= 12 {
      return Some(QuotedAmendIntent {
        kind: QuotedAmendKind::Ambiguous,
        quoted_lines,
        amend_body,
        scope_hint,
        symbol_hints,
      });
    }
    return Some(QuotedAmendIntent {
      kind: QuotedAmendKind::Remove,
      quoted_lines,
      amend_body,
      scope_hint,
      symbol_hints,
    });
  }

  if symbol_hints.is_empty() {
    return Some(QuotedAmendIntent {
      kind: QuotedAmendKind::Ambiguous,
      quoted_lines,
      amend_body,
      scope_hint,
      symbol_hints,
    });
  }
  Some(QuotedAmendIntent {
    kind: QuotedAmendKind::Add,
    quoted_lines,
    amend_body,
    scope_hint,
    symbol_hints,
  })
}

pub fn is_quoted_amend_prompt(prompt: &str) -> bool {
  resolve_quoted_amend_intent(prompt)
    .map(|r| r.kind != QuotedAmendKind::Ambiguous)
    .unwrap_or(false)
}

pub fn expand_quoted_amend_prompt(_prompt: &str, resolved: &QuotedAmendIntent) -> String {
  let quote_summary = if resolved.quoted_lines.len() <= 2 {
    resolved.quoted_lines.join(" / ")
  } else {
    format!(
      "{} / …（共 {} 行引用）",
      resolved.quoted_lines[0],
      resolved.quoted_lines.len()
    )
  };

  let scope_line = resolved
    .scope_hint
    .as_ref()
    .map(|s| format!("scope：{s}"))
    .unwrap_or_else(|| "scope：（见引用行前缀）".to_string());
  let symbols_line = if resolved.symbol_hints.is_empty() {
    "目标符号：（见引用块中的标识符）".to_string()
  } else {
    format!("目标符号：{}", resolved.symbol_hints.join("、"))
  };

  if resolved.kind == QuotedAmendKind::Remove {
    return [
      "【用户意图·已解析】用户引用了上一轮助手总结或代码块，短句是对引用内容的修订（不是新任务）。",
      "操作：remove",
      &scope_line,
      &symbols_line,
      &format!(
        "用户补充：{}",
        if resolved.amend_body.is_empty() {
          "不要引用内容"
        } else {
          resolved.amend_body.as_str()
        }
      ),
      "约束：仅删除目标符号对应配置/代码块；禁止删除 scope 整段注册或服务块；禁止在其它 scope 重新添加用户要求移除的符号。",
      &format!("引用摘要：{quote_summary}"),
    ]
    .join("\n");
  }

  [
    "【用户意图·已解析】用户引用了上一轮内容并要求补充添加。",
    "操作：add",
    &scope_line,
    &symbols_line,
    &format!("用户补充：{}", resolved.amend_body),
    &format!("引用摘要：{quote_summary}"),
  ]
  .join("\n")
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parses_agent_quote_remove() {
    let prompt = "> Agent: scopeA：保留 `TargetSymbol`（说明）\n\n也移除";
    let resolved = resolve_quoted_amend_intent(prompt).unwrap();
    assert_eq!(resolved.kind, QuotedAmendKind::Remove);
    assert_eq!(resolved.scope_hint.as_deref(), Some("scopeA"));
    assert!(resolved.symbol_hints.contains(&"TargetSymbol".to_string()));
  }

  #[test]
  fn ambiguous_remove_without_symbols() {
    let prompt = "> Agent: 已完成修改\n\n也移除";
    let resolved = resolve_quoted_amend_intent(prompt).unwrap();
    assert_eq!(resolved.kind, QuotedAmendKind::Ambiguous);
    assert!(!is_quoted_amend_prompt(prompt));
  }

  #[test]
  fn expand_embeds_remove_markers() {
    let prompt = "> Agent: scopeA：保留 `TargetSymbol`\n\n也移除";
    let resolved = resolve_quoted_amend_intent(prompt).unwrap();
    let expanded = expand_quoted_amend_prompt(prompt, &resolved);
    assert!(expanded.contains("操作：remove"));
    assert!(expanded.contains("目标符号：TargetSymbol"));
    assert!(expanded.contains("scope：scopeA"));
  }

  #[test]
  fn null_without_quoted_lines() {
    assert!(resolve_quoted_amend_intent("也移除").is_none());
  }
}
