//! Ambiguous proper-noun clarification — ported from ambiguousTermTriggers.ts (Tier 1).

use regex::Regex;
use std::collections::HashSet;
use std::path::Path;
use std::sync::OnceLock;

use super::context::HistoryMessage;
use super::continuation::{
  extract_plan_file_paths, is_plan_quote_prompt, strip_quoted_reply_prefix,
};

static RECIPIENT_PHRASE_RE: OnceLock<Regex> = OnceLock::new();
static QUOTED_TERM_RE: OnceLock<Regex> = OnceLock::new();
static USER_DISAMBIGUATION_RE: OnceLock<Regex> = OnceLock::new();
static CLARIFICATION_OFFER_RE: OnceLock<Regex> = OnceLock::new();

fn recipient_phrase_re() -> &'static Regex {
  RECIPIENT_PHRASE_RE.get_or_init(|| {
    Regex::new(
      r#"(?:给|供|为|对接|服务于)\s*([^，。；！？\n「」『』""''（）()【】\[\]：:]{2,10}?)\s*(?:调用|使用|对接|提供|服务|开发|写|做|起|搭建)"#,
    )
    .expect("RECIPIENT_PHRASE_RE")
  })
}

fn quoted_term_re() -> &'static Regex {
  QUOTED_TERM_RE.get_or_init(|| {
    Regex::new(r#"[「『"']([^」』"']{2,16})[」』"']"#).expect("QUOTED_TERM_RE")
  })
}

fn user_disambiguation_re() -> &'static Regex {
  USER_DISAMBIGUATION_RE.get_or_init(|| {
    Regex::new(r"(?:指的是|是指|也就是|即指|亦即|具体是|其实是|实为|我(?:这里)?说的)")
      .expect("USER_DISAMBIGUATION_RE")
  })
}

fn clarification_offer_re() -> &'static Regex {
  CLARIFICATION_OFFER_RE.get_or_init(|| {
    Regex::new(r"(?:澄清|请确认|能否说明|可否说明|帮忙确认|是指|指的是|哪种|哪类|是否指)")
      .expect("CLARIFICATION_OFFER_RE")
  })
}

fn is_sparse_project(project_path: &str) -> bool {
  for sub in ["src", "server", "src-tauri/src"] {
    let dir = Path::new(project_path).join(sub);
    if dir.is_dir() {
      if std::fs::read_dir(&dir)
        .map(|mut entries| entries.next().is_some())
        .unwrap_or(false)
      {
        return false;
      }
    }
  }
  true
}

fn is_generic_stopword(term: &str) -> bool {
  const STOP: &[&str] = &[
    "用户", "前端", "后端", "系统", "项目", "应用", "服务", "数据", "接口", "页面", "模块", "功能",
    "平台", "客户端", "服务器", "浏览器", "代码", "文件", "目录", "配置", "环境", "版本", "测试",
    "部署", "开发", "设计", "需求", "方案", "示例", "默认", "独立", "新建", "现有", "当前", "相关",
    "业务", "逻辑", "流程", "工具", "框架", "组件",
  ];
  let trimmed = term.trim();
  if trimmed.is_empty() {
    return true;
  }
  STOP.contains(&trimmed)
}

fn is_known_tech_term(term: &str) -> bool {
  const KNOWN: &[&str] = &[
    "vue", "react", "typescript", "javascript", "rust", "node", "npm", "api", "http", "json",
  ];
  let normalized = term.trim().to_lowercase().replace(' ', "");
  KNOWN.contains(&normalized.as_str())
}

fn extract_candidate_terms(prompt: &str) -> Vec<String> {
  let text = strip_quoted_reply_prefix(prompt);
  let mut found = HashSet::new();
  for re in [recipient_phrase_re(), quoted_term_re()] {
    for cap in re.captures_iter(&text) {
      if let Some(m) = cap.get(1) {
        let raw = m.as_str().trim();
        if !raw.is_empty() {
          found.insert(raw.to_string());
        }
      }
    }
  }
  found.into_iter().collect()
}

pub fn user_prompt_self_disambiguates(prompt: &str) -> bool {
  user_disambiguation_re().is_match(strip_quoted_reply_prefix(prompt).trim())
}

pub fn has_recent_ambiguity_clarification_offer(history: Option<&[HistoryMessage]>, terms: &[String]) -> bool {
  if terms.is_empty() {
    return false;
  }
  let recent: Vec<_> = history
    .unwrap_or(&[])
    .iter()
    .filter(|m| m.role == "assistant")
    .rev()
    .take(3)
    .collect();
  recent.iter().any(|m| {
    clarification_offer_re().is_match(&m.content)
      && terms.iter().any(|term| m.content.contains(term.as_str()))
  })
}

pub struct ResolveAmbiguousInput<'a> {
  pub prompt: &'a str,
  pub history: Option<&'a [HistoryMessage]>,
  pub project_path: &'a str,
  pub mode: &'a str,
  pub is_execute_plan: bool,
  pub is_plan_explore: bool,
  pub read_only_build_run: bool,
}

pub fn resolve_ambiguous_clarification_terms(input: ResolveAmbiguousInput<'_>) -> Vec<String> {
  let body = strip_quoted_reply_prefix(input.prompt);
  if body.trim().is_empty() {
    return Vec::new();
  }
  if input.is_execute_plan || input.mode == "ask" || input.mode == "explore" {
    return Vec::new();
  }
  if input.read_only_build_run || is_plan_quote_prompt(&body) {
    return Vec::new();
  }
  if !extract_plan_file_paths(&body).is_empty() {
    return Vec::new();
  }
  if user_prompt_self_disambiguates(&body) {
    return Vec::new();
  }
  if !is_sparse_project(input.project_path) {
    return Vec::new();
  }

  let mut terms = Vec::new();
  for raw in extract_candidate_terms(&body) {
    if raw.len() < 2 || raw.len() > 12 {
      continue;
    }
    if Regex::new(r"^[\d\s._/-]+$").unwrap().is_match(&raw) {
      continue;
    }
    if Regex::new(r"\.(?:vue|ts|tsx|js|jsx|json|md|cs|rs)$").unwrap().is_match(&raw) {
      continue;
    }
    if is_generic_stopword(&raw) || is_known_tech_term(&raw) {
      continue;
    }
    terms.push(raw);
  }
  terms.sort();
  terms.dedup();
  if terms.is_empty() || has_recent_ambiguity_clarification_offer(input.history, &terms) {
    return Vec::new();
  }
  terms
}

pub fn looks_like_premature_plan_or_scaffold(text: &str) -> bool {
  let trimmed = text.trim();
  if trimmed.is_empty() {
    return false;
  }
  if Regex::new(r"(?m)(?:^|\n)\s*(?:##\s*修改方案|\[PLAN\]|<!--\s*agent-plan\s*-->)")
    .unwrap()
    .is_match(trimmed)
  {
    return true;
  }
  if Regex::new(r"涉及文件清单|具体改动说明|改动顺序和依赖|确认无误后回复「执行方案」")
    .unwrap()
    .is_match(trimmed)
  {
    return true;
  }
  let fenced_blocks: Vec<_> = Regex::new(r"```[\s\S]*?```")
    .unwrap()
    .find_iter(trimmed)
    .collect();
  if fenced_blocks.len() >= 2 {
    return true;
  }
  if fenced_blocks.len() >= 1
    && Regex::new(r"(?i)(?:csproj|Program\.cs|Controller|appsettings)")
      .unwrap()
      .is_match(trimmed)
  {
    return true;
  }
  false
}

pub fn looks_like_clarification_question(text: &str) -> bool {
  let trimmed = text.trim();
  if trimmed.is_empty() || looks_like_premature_plan_or_scaffold(trimmed) {
    return false;
  }
  let question_marks = trimmed.matches(['?', '？']).count();
  let clarification_re = Regex::new(r"(?:澄清|请确认|能否说明|可否说明|帮忙确认|是指|指的是|哪种|哪类|是否指)")
    .unwrap();
  if question_marks >= 1 && clarification_re.is_match(trimmed) {
    return true;
  }
  question_marks >= 2
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn premature_plan_blocked() {
    assert!(looks_like_premature_plan_or_scaffold("## 修改方案\n\nfoo"));
    assert!(!looks_like_clarification_question("## 修改方案\n\nfoo"));
  }

  #[test]
  fn sparse_empty_project_triggers_terms() {
    let dir = std::env::temp_dir().join(format!("aiall_sparse_{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let terms = resolve_ambiguous_clarification_terms(ResolveAmbiguousInput {
      prompt: "给 Acme 调用写一个 API",
      history: None,
      project_path: dir.to_str().unwrap_or("."),
      mode: "plan",
      is_execute_plan: false,
      is_plan_explore: true,
      read_only_build_run: false,
    });
    let _ = std::fs::remove_dir_all(&dir);
    assert!(!terms.is_empty());
  }
}
