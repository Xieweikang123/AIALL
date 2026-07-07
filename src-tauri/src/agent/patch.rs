//! Unique old_string → new_string patch with EOL normalization and indent-flexible fallback.
//! Parity with `server/vibeFs.ts` `applyUniquePatch`.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FileEol {
  Crlf,
  Lf,
}

#[derive(Debug)]
pub enum UniquePatchResult {
  Ok { patched: String },
  Err { error: String, occurrences: usize },
}

pub fn detect_file_eol(content: &str) -> FileEol {
  if content.contains("\r\n") {
    FileEol::Crlf
  } else {
    FileEol::Lf
  }
}

pub fn adapt_patch_line_endings(text: &str, eol: FileEol) -> String {
  if text.is_empty() {
    return String::new();
  }
  let normalized = text.replace("\r\n", "\n");
  match eol {
    FileEol::Crlf => normalized.replace('\n', "\r\n"),
    FileEol::Lf => normalized,
  }
}

fn count_substring_occurrences(haystack: &str, needle: &str) -> usize {
  if needle.is_empty() {
    return 0;
  }
  let mut count = 0;
  let mut pos = 0;
  while let Some(found) = haystack[pos..].find(needle) {
    count += 1;
    pos += found + needle.len();
  }
  count
}

fn split_patch_lines(text: &str) -> Vec<String> {
  text.split("\r\n")
    .flat_map(|part| part.split('\n'))
    .map(|s| s.to_string())
    .collect()
}

fn line_body(line: &str) -> &str {
  line.trim_start()
}

struct FlexibleIndentMatch {
  start: usize,
  end: usize,
  matched_lines: Vec<String>,
  old_lines: Vec<String>,
}

fn find_unique_flexible_indent_block(content: &str, old_string: &str) -> Option<FlexibleIndentMatch> {
  let eol = detect_file_eol(content);
  let eol_str = match eol {
    FileEol::Crlf => "\r\n",
    FileEol::Lf => "\n",
  };
  let old_lines = split_patch_lines(old_string);
  if old_lines.is_empty() || old_lines.iter().all(|l| l.is_empty()) {
    return None;
  }
  let content_lines = split_patch_lines(content);
  let mut start_lines = Vec::new();
  if content_lines.len() < old_lines.len() {
    return None;
  }
  for i in 0..=content_lines.len() - old_lines.len() {
    let mut ok = true;
    for (j, old_line) in old_lines.iter().enumerate() {
      if line_body(&content_lines[i + j]) != line_body(old_line) {
        ok = false;
        break;
      }
    }
    if ok {
      start_lines.push(i);
    }
  }
  if start_lines.len() != 1 {
    return None;
  }
  let start_line = start_lines[0];
  let matched_lines = content_lines[start_line..start_line + old_lines.len()].to_vec();
  let mut start = 0usize;
  for line in &content_lines[..start_line] {
    start += line.len() + eol_str.len();
  }
  let matched = matched_lines.join(eol_str);
  let end = start + matched.len();
  Some(FlexibleIndentMatch {
    start,
    end,
    matched_lines,
    old_lines,
  })
}

fn build_indent_adapted_new_block(
  matched_lines: &[String],
  old_lines: &[String],
  new_string: &str,
  eol: FileEol,
) -> String {
  let eol_str = match eol {
    FileEol::Crlf => "\r\n",
    FileEol::Lf => "\n",
  };
  let new_lines = split_patch_lines(new_string);
  new_lines
    .iter()
    .enumerate()
    .map(|(index, new_line)| {
      let anchor_line = matched_lines
        .get(index.min(matched_lines.len().saturating_sub(1)))
        .map(String::as_str)
        .unwrap_or("");
      let old_line = old_lines
        .get(index.min(old_lines.len().saturating_sub(1)))
        .map(String::as_str)
        .unwrap_or("");
      let anchor_indent = anchor_line
        .chars()
        .take_while(|c| *c == ' ' || *c == '\t')
        .collect::<String>();
      let old_indent = old_line
        .chars()
        .take_while(|c| *c == ' ' || *c == '\t')
        .collect::<String>();
      let new_indent = new_line
        .chars()
        .take_while(|c| *c == ' ' || *c == '\t')
        .collect::<String>();
      let content = new_line.trim_start();
      let relative_indent = if new_indent.len() >= old_indent.len() {
        &new_indent[old_indent.len()..]
      } else {
        ""
      };
      format!("{anchor_indent}{relative_indent}{content}")
    })
    .collect::<Vec<_>>()
    .join(eol_str)
}

pub fn apply_unique_patch(content: &str, old_string: &str, new_string: &str) -> UniquePatchResult {
  let mut old_to_match = old_string.to_string();
  let mut new_to_insert = new_string.to_string();
  let mut occurrences = count_substring_occurrences(content, &old_to_match);

  if occurrences == 0 {
    let eol = detect_file_eol(content);
    old_to_match = adapt_patch_line_endings(old_string, eol);
    new_to_insert = adapt_patch_line_endings(new_string, eol);
    occurrences = count_substring_occurrences(content, &old_to_match);
  }

  if occurrences == 0 {
    if let Some(flex) = find_unique_flexible_indent_block(content, old_string) {
      let eol = detect_file_eol(content);
      let adapted_new =
        build_indent_adapted_new_block(&flex.matched_lines, &flex.old_lines, new_string, eol);
      let patched = format!(
        "{}{}{}",
        &content[..flex.start],
        adapted_new,
        &content[flex.end..]
      );
      return UniquePatchResult::Ok { patched };
    }
    return UniquePatchResult::Err {
      error: "错误：old_string 在文件中未找到。请从 read_file 返回原文复制（含缩进）；可换更短且唯一的片段，或 read 更大范围后重试".into(),
      occurrences: 0,
    };
  }

  if occurrences > 1 {
    return UniquePatchResult::Err {
      error: format!(
        "错误：old_string 在文件中出现 {occurrences} 次，请缩小为更短且唯一的片段"
      ),
      occurrences,
    };
  }

  let patched = content.replacen(&old_to_match, &new_to_insert, 1);
  UniquePatchResult::Ok { patched }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn detect_file_eol_prefers_crlf() {
    assert_eq!(detect_file_eol("a\r\nb"), FileEol::Crlf);
    assert_eq!(detect_file_eol("a\nb"), FileEol::Lf);
  }

  #[test]
  fn adapt_patch_line_endings_converts_lf_to_crlf() {
    assert_eq!(
      adapt_patch_line_endings("line1\nline2", FileEol::Crlf),
      "line1\r\nline2"
    );
  }

  #[test]
  fn apply_unique_patch_matches_lf_old_string_against_crlf_file() {
    let content = "before\r\n  foo();\r\n  bar();\r\nafter";
    let old_string = "  foo();\n  bar();";
    let new_string = "  foo();\n  bar();\n  stash();";
    match apply_unique_patch(content, old_string, new_string) {
      UniquePatchResult::Ok { patched } => {
        assert_eq!(
          patched,
          "before\r\n  foo();\r\n  bar();\r\n  stash();\r\nafter"
        );
      }
      UniquePatchResult::Err { .. } => panic!("expected ok"),
    }
  }

  #[test]
  fn apply_unique_patch_reports_duplicate_matches() {
    match apply_unique_patch("foo\nfoo", "foo", "bar") {
      UniquePatchResult::Err { occurrences, .. } => assert_eq!(occurrences, 2),
      UniquePatchResult::Ok { .. } => panic!("expected err"),
    }
  }
}
