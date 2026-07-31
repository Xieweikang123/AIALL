use std::collections::HashSet;

use crate::fs::{grep_in_project, GrepMatch};

use super::explore_guard::is_overly_broad_vision_grep;
use super::vision::{
    is_runtime_visible_text_grep_pattern, VISION_ANCHOR_PREFGREP_MAX_MATCHES,
    VISION_ANCHOR_PREFGREP_MAX_PATTERNS,
};

#[derive(Debug, Clone)]
pub struct VisionAnchorPrefgrepResult {
    pub patterns: Vec<String>,
    pub had_matches: bool,
    pub system_block: String,
    pub match_count: usize,
    pub unique_files: Vec<String>,
}

pub fn select_vision_anchor_grep_patterns(anchor_quotes: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut patterns = Vec::new();

    let mut add = |raw: &str| {
        let t = raw.trim();
        if t.len() < 2 || t.len() > 60 || seen.contains(t) {
            return;
        }
        if is_runtime_visible_text_grep_pattern(t) {
            return;
        }
        let is_anchor_derived = anchor_quotes.iter().any(|quote| {
            let q = quote.trim();
            q.contains(t) || t.contains(q)
        });
        if !is_anchor_derived && is_overly_broad_vision_grep(t, anchor_quotes, &[]) {
            return;
        }
        seen.insert(t.to_string());
        patterns.push(t.to_string());
    };

    let cjk_run_re = regex::Regex::new(r"[\u{4e00}-\u{9fff}]{2,}").unwrap();
    let cjk_plus_re = regex::Regex::new(r"[\u{4e00}-\u{9fff}+][\u{4e00}-\u{9fff}+\s]{1,}").unwrap();
    let latin_kebab_re = regex::Regex::new(r"(?i)[a-z][a-z0-9-]{2,}").unwrap();

    for quote in anchor_quotes {
        let q = quote.trim();
        if q.is_empty() {
            continue;
        }
        add(q);
        for m in cjk_run_re.find_iter(q) {
            add(m.as_str());
        }
        for m in cjk_plus_re.find_iter(q) {
            add(&m.as_str().replace(char::is_whitespace, ""));
        }
        for m in latin_kebab_re.find_iter(q) {
            add(m.as_str());
        }
    }

    patterns.truncate(VISION_ANCHOR_PREFGREP_MAX_PATTERNS);
    patterns
}

pub fn format_vision_anchor_pgrep_block(patterns: &[String], matches: &[GrepMatch]) -> String {
    if patterns.is_empty() {
        return String::new();
    }
    let header = format!(
        "【读图锚点·服务端 grep】已按读图摘录的可见文案搜索（{}）：",
        patterns
            .iter()
            .map(|p| format!("「{p}」"))
            .collect::<Vec<_>>()
            .join("、")
    );
    if matches.is_empty() {
        return [
            header,
            "（无匹配）".to_string(),
            "下一轮请改用更短的可见片段、结构标识或相关符号；勿猜组件路径。".to_string(),
        ]
        .join("\n");
    }
    let lines: Vec<String> = matches
        .iter()
        .take(VISION_ANCHOR_PREFGREP_MAX_MATCHES)
        .map(|m| format!("{}:{}: {}", m.relative, m.line, m.text.trim()))
        .collect();
    let unique_files: Vec<String> = matches
        .iter()
        .map(|m| m.relative.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let file_list = if unique_files.len() > 8 {
        format!(
            "{}…",
            unique_files
                .iter()
                .take(8)
                .cloned()
                .collect::<Vec<_>>()
                .join("、")
        )
    } else {
        unique_files.join("、")
    };
    [
    header,
    lines.join("\n"),
    format!(
      "共 {} 处命中，涉及 {} 个文件：{}。",
      matches.len(),
      unique_files.len(),
      file_list
    ),
    "请 read_file 1 个最相关文件核对 template/DOM 是否与截图一致，然后给出最终答案；勿重复首轮外观描述。".to_string(),
    "只答用户所指的控件/区域；行号须来自 read_file 返回。".to_string(),
  ]
  .join("\n")
}

pub fn build_vision_consultative_read_after_prefgrep_hint(unique_files: &[String]) -> String {
    let files = if unique_files.is_empty() {
        String::new()
    } else {
        let shown: Vec<_> = unique_files.iter().take(6).cloned().collect();
        let suffix = if unique_files.len() > 6 { "…" } else { "" };
        format!("命中文件含：{}。{suffix}", shown.join("、"))
    };
    [
    "【定位未完成·须 read 核对】服务端 grep 已有命中，但你尚未 read_file 核对源码。",
    &files,
    "请 read_file 1 个最相关文件，对照截图确认 DOM/文案后给出最终答案；勿重复外观描述或写「下一轮再确认」。",
    "只答用户所指的控件；行号须来自 read_file 返回。",
  ]
  .join("")
}

pub fn build_vision_consultative_auto_grep_continue_hint(had_matches: bool) -> String {
    if had_matches {
        [
      "【读图完成·咨询·已预 grep】服务端已按读图锚点搜索并附上命中列表。",
      "请 read_file 1 个最相关文件核对 DOM 是否与截图一致，然后给出最终中文回答：先一句点明截图对应哪块界面，再答用户问题。",
      "只答用户所指的控件/区域；行号须来自 read_file 返回。",
      "禁止在未 read 的情况下猜测路径；禁止写「下一轮再确认」；禁止重复首轮完整外观描述。",
    ]
    .join("")
    } else {
        [
      "【读图完成·咨询·预 grep 无命中】服务端已尝试按读图锚点搜索但未命中。",
    "请改用更短可见片段、结构标识或相关符号（1 次），必要时 read_file 1 个文件，然后给出最终答案。",
      "只答用户所指的控件；勿 grep 标签+计数的运行时文案。",
      "禁止猜测组件路径或写「下一轮再确认」；禁止重复首轮完整外观描述。",
    ]
    .join("")
    }
}

pub async fn run_vision_anchor_pgrep(
    project_path: &str,
    anchor_quotes: &[String],
) -> VisionAnchorPrefgrepResult {
    let patterns = select_vision_anchor_grep_patterns(anchor_quotes);
    if patterns.is_empty() {
        return VisionAnchorPrefgrepResult {
            patterns: vec![],
            had_matches: false,
            system_block: String::new(),
            match_count: 0,
            unique_files: vec![],
        };
    }

    let mut merged: Vec<GrepMatch> = Vec::new();
    let mut seen_keys = HashSet::new();

    for pattern in &patterns {
        if let Ok(result) =
            grep_in_project(project_path, pattern, VISION_ANCHOR_PREFGREP_MAX_MATCHES).await
        {
            for m in result {
                let key = format!("{}:{}", m.relative, m.line);
                if seen_keys.contains(&key) {
                    continue;
                }
                seen_keys.insert(key);
                merged.push(m);
                if merged.len() >= VISION_ANCHOR_PREFGREP_MAX_MATCHES {
                    break;
                }
            }
        }
        if merged.len() >= VISION_ANCHOR_PREFGREP_MAX_MATCHES {
            break;
        }
    }

    let unique_files: Vec<String> = merged
        .iter()
        .map(|m| m.relative.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let system_block = format_vision_anchor_pgrep_block(&patterns, &merged);

    VisionAnchorPrefgrepResult {
        patterns,
        had_matches: !merged.is_empty(),
        match_count: merged.len(),
        system_block,
        unique_files,
    }
}

pub fn build_vision_first_turn_retry_hint(retry: u32) -> String {
    format!(
    "【读图首轮·第 {retry} 次重试】请用中文描述截图中的可见控件、文案与布局，用引号标注可见文字（≥24 字），然后再 grep/read。禁止空回复或仅写「图已理解」。"
  )
}

pub struct VisionAnchorPgrepTurnState {
    pub vision_pregrep_done: bool,
    pub vision_locate_tools_used: bool,
    pub vision_auto_grep_had_matches: bool,
    pub unique_files: Vec<String>,
}

pub async fn apply_vision_anchor_pgrep_messages(
    messages: &mut Vec<serde_json::Value>,
    project_path: &str,
    anchor_quotes: &[String],
) -> VisionAnchorPgrepTurnState {
    let pregrep = run_vision_anchor_pgrep(project_path, anchor_quotes).await;
    if !pregrep.system_block.is_empty() {
        messages.push(serde_json::json!({
          "role": "system",
          "content": pregrep.system_block
        }));
    }
    messages.push(serde_json::json!({
      "role": "system",
      "content": build_vision_consultative_auto_grep_continue_hint(pregrep.had_matches)
    }));
    VisionAnchorPgrepTurnState {
        vision_pregrep_done: true,
        vision_locate_tools_used: pregrep.had_matches,
        vision_auto_grep_had_matches: pregrep.had_matches,
        unique_files: pregrep.unique_files,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn select_patterns_filters_overly_broad() {
        let anchors = vec!["多会话同时进行，好实现吗？".to_string()];
        let patterns = select_vision_anchor_grep_patterns(&anchors);
        assert!(!patterns.iter().any(|p| p == "会话"));
        assert!(patterns
            .iter()
            .any(|p| p.contains("多会话") || p.contains("会话同时")));
    }

    #[test]
    fn format_block_includes_header_when_no_matches() {
        let block = format_vision_anchor_pgrep_block(&["foo".to_string()], &[]);
        assert!(block.contains("读图锚点"));
        assert!(block.contains("无匹配"));
    }

    #[test]
    fn auto_grep_hint_differs_by_match_status() {
        assert!(build_vision_consultative_auto_grep_continue_hint(true).contains("已预 grep"));
        assert!(build_vision_consultative_auto_grep_continue_hint(false).contains("无命中"));
    }
}
