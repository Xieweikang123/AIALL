use crate::fs;
use futures_util::future::join_all;
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Value};
use std::time::Instant;

use super::HealthIssue;

static SKIP_PATH_RE: Lazy<Regex> =
  Lazy::new(|| Regex::new(r"node_modules|dist/|\.git/|build/|coverage/").unwrap());
static EXCLUDE_TEST_SPEC_RE: Lazy<Regex> =
  Lazy::new(|| Regex::new(r"\.(test|spec)\.[cm]?[jt]sx?$").unwrap());
static EXCLUDE_SECRET_PATH_RE: Lazy<Regex> = Lazy::new(|| {
  Regex::new(r"\.(example|sample|template)|\.env\.|mock|fixture|test|spec").unwrap()
});
static SECRET_PLACEHOLDER_RE: Lazy<Regex> = Lazy::new(|| {
  Regex::new(r"(?i)placeholder|example|changeme|your[-_]|xxx|dummy|fake|test").unwrap()
});
static SECRET_EMPTY_QUOTES_RE: Lazy<Regex> =
  Lazy::new(|| Regex::new(r#"['"]\s*['"]"#).unwrap());
static SECRET_VALUE_RE: Lazy<Regex> =
  Lazy::new(|| Regex::new(r#"['"]([^'"]+)['"]"#).unwrap());
static SECRET_KEYWORD_VAL_RE: Lazy<Regex> = Lazy::new(|| {
  Regex::new(r"(?i)^(function|decorator|string|number|boolean|object|array|keyword|operator|variable|class|type|interface|module|namespace|property|method|param|return|this|super|true|false|null|undefined|readonly|private|public|protected|static|async|await|yield|const|let|var|import|export|default|from|enum|struct|impl|trait|crate|self|pub|fn|use|mod|match|loop|while|for|if|else|Some|None|Ok|Err|println|print|format|vec|assert|todo|unimplemented|unreachable)$").unwrap()
});

struct ScanRule {
  id: &'static str,
  severity: &'static str,
  category: &'static str,
  title: &'static str,
  pattern: &'static str,
  max_matches: usize,
  exclude_path_re: Option<&'static Lazy<Regex>>,
}

const SCAN_RULES: &[ScanRule] = &[
  ScanRule {
    id: "debt-marker",
    severity: "info",
    category: "debt",
    title: "未完成标记",
    pattern: r"\b(TODO|FIXME|HACK|XXX|BUG)\b",
    max_matches: 24,
    exclude_path_re: None,
  },
  ScanRule {
    id: "debug-console",
    severity: "warning",
    category: "debug",
    title: "调试输出未清理",
    pattern: r"\bconsole\.(log|debug|info)\s*\(",
    max_matches: 12,
    exclude_path_re: Some(&EXCLUDE_TEST_SPEC_RE),
  },
  ScanRule {
    id: "smell-empty-catch",
    severity: "warning",
    category: "smell",
    title: "空 catch 吞掉异常",
    pattern: r"catch\s*\([^)]*\)\s*\{\s*\}",
    max_matches: 16,
    exclude_path_re: None,
  },
  ScanRule {
    id: "smell-ts-ignore",
    severity: "info",
    category: "smell",
    title: "规则绕过注释",
    pattern: r"@(ts-ignore|ts-expect-error)|eslint-disable",
    max_matches: 16,
    exclude_path_re: None,
  },
  ScanRule {
    id: "smell-any-type",
    severity: "info",
    category: "smell",
    title: "any 类型使用",
    pattern: r"(: any\b|as any\b)",
    max_matches: 16,
    exclude_path_re: None,
  },
  ScanRule {
    id: "security-eval",
    severity: "error",
    category: "security",
    title: "动态代码执行",
    pattern: r"\beval\s*\(|new Function\s*\(",
    max_matches: 8,
    exclude_path_re: Some(&EXCLUDE_TEST_SPEC_RE),
  },
  ScanRule {
    id: "security-innerhtml",
    severity: "warning",
    category: "security",
    title: "直接赋值 innerHTML",
    pattern: r"\.innerHTML\s*=",
    max_matches: 12,
    exclude_path_re: None,
  },
  ScanRule {
    id: "security-hardcoded-secret",
    severity: "error",
    category: "security",
    title: "疑似硬编码密钥",
    pattern: r#"(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}['"]"#,
    max_matches: 8,
    exclude_path_re: Some(&EXCLUDE_SECRET_PATH_RE),
  },
];

fn should_skip_match(relative: &str, text: &str, rule: &ScanRule) -> bool {
  if SKIP_PATH_RE.is_match(relative) {
    return true;
  }
  if let Some(re) = rule.exclude_path_re {
    if re.is_match(relative) {
      return true;
    }
  }
  if rule.id != "security-hardcoded-secret" {
    return false;
  }
  if SECRET_PLACEHOLDER_RE.is_match(text) {
    return true;
  }
  if SECRET_EMPTY_QUOTES_RE.is_match(text) {
    return true;
  }
  let val = SECRET_VALUE_RE
    .captures(text)
    .and_then(|c| c.get(1))
    .map(|m| m.as_str())
    .unwrap_or("");
  if val.len() < 12 {
    return true;
  }
  SECRET_KEYWORD_VAL_RE.is_match(val)
}

fn issue_id(rule_id: &str, relative: &str, line: u32) -> String {
  let safe = relative.replace(|c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '-', "_");
  format!("{rule_id}-{safe}-{line}")
}

pub async fn project_health_scan(project_path: &str) -> Value {
  let started = Instant::now();
  let root = std::path::Path::new(project_path);
  if !root.is_dir() {
    return json!({
      "ok": true,
      "projectPath": project_path,
      "scannedAt": chrono::Utc::now().to_rfc3339(),
      "durationMs": started.elapsed().as_millis(),
      "issues": [{
        "id": "invalid-path",
        "severity": "error",
        "title": "无效的项目路径",
        "detail": "路径不存在或不是目录。",
        "category": "smell",
        "file": "",
        "line": 0,
        "pattern": ""
      }],
      "summary": { "errorCount": 1, "warningCount": 0, "infoCount": 0 },
      "checksRun": []
    });
  }

  let mut issues: Vec<HealthIssue> = Vec::new();
  let mut checks_run: Vec<String> = Vec::new();

  let grep_results = join_all(SCAN_RULES.iter().map(|rule| {
    let path = project_path.to_string();
    let pattern = rule.pattern.to_string();
    let max_matches = rule.max_matches;
    async move {
      fs::grep_in_project(&path, &pattern, max_matches).await
    }
  }))
  .await;

  for (rule, grep_result) in SCAN_RULES.iter().zip(grep_results) {
    checks_run.push(format!("grep:{}", rule.id));
    let Ok(matches) = grep_result else {
      continue;
    };
    for m in matches {
      if should_skip_match(&m.relative, &m.text, rule) {
        continue;
      }
      let snippet: String = m.text.trim().chars().take(80).collect();
      let detail = if snippet.is_empty() {
        format!("{}:{}", m.relative, m.line)
      } else {
        format!("{}:{} — {}", m.relative, m.line, snippet)
      };
      issues.push(HealthIssue {
        id: issue_id(rule.id, &m.relative, m.line),
        severity: rule.severity.into(),
        title: rule.title.into(),
        detail,
        category: rule.category.into(),
        file: m.relative.clone(),
        line: m.line,
        pattern: rule.id.into(),
      });
    }
  }

  let error_count = issues.iter().filter(|i| i.severity == "error").count();
  let warning_count = issues.iter().filter(|i| i.severity == "warning").count();
  let info_count = issues.iter().filter(|i| i.severity == "info").count();

  json!({
    "ok": true,
    "projectPath": project_path,
    "scannedAt": chrono::Utc::now().to_rfc3339(),
    "durationMs": started.elapsed().as_millis(),
    "issues": issues,
    "summary": {
      "errorCount": error_count,
      "warningCount": warning_count,
      "infoCount": info_count
    },
    "checksRun": checks_run
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn skips_test_files_for_debug_console() {
    let rule = &SCAN_RULES[1];
    assert!(should_skip_match("src/foo.test.ts", "console.log(x)", rule));
    assert!(!should_skip_match("src/foo.ts", "console.log(x)", rule));
  }

  #[test]
  fn skips_build_artifacts() {
    let rule = &SCAN_RULES[0];
    assert!(should_skip_match("dist/bundle.js", "TODO fix", rule));
    assert!(should_skip_match("node_modules/pkg/index.js", "TODO fix", rule));
  }

  #[test]
  fn secret_rule_filters_placeholders() {
    let rule = &SCAN_RULES[7];
    assert!(should_skip_match(
      "src/config.ts",
      r#"apiKey: "your-api-key-here""#,
      rule,
    ));
    assert!(should_skip_match(
      "src/config.ts",
      r#"password: "short""#,
      rule,
    ));
  }

  #[test]
  fn issue_id_sanitizes_path() {
    assert_eq!(issue_id("debt-marker", "src/a b.ts", 3), "debt-marker-src_a_b.ts-3");
  }
}
