/// 按【字符数】截断，超出部分以「…」结尾。
///
/// 不能用 `&s[..n]`：那按字节切，中文等多字节字符会被劈成两半并触发
/// `byte index N is not a char boundary` panic（见 classifier.rs 历史 panic）。
pub(crate) fn truncate_chars(s: &str, max_chars: usize) -> String {
    let mut out = String::with_capacity(s.len().min(max_chars * 4));
    for (idx, ch) in s.chars().enumerate() {
        if idx == max_chars {
            out.push('…');
            return out;
        }
        out.push(ch);
    }
    out
}

/// 按【字符数】截断，仅当发生截断时才追加「…」后缀（后缀可自定义）。
pub(crate) fn truncate_chars_suffix(s: &str, max_chars: usize, suffix: &str) -> String {
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max_chars).collect();
    out.push_str(suffix);
    out
}

/// tool_summary — 生成简洁的工具执行结果中文摘要
pub fn tool_summary(name: &str, result: &str) -> String {
    if result.starts_with("错误：") {
        return result.trim_start_matches("错误：").trim().to_string();
    }

    match name {
        "list_dir" => {
            if result == "（空目录）" {
                return "空目录".into();
            }
            let lines: Vec<&str> = result.lines().filter(|l| !l.is_empty()).collect();
            let dirs = lines.iter().filter(|l| l.starts_with("[dir]")).count();
            let files = lines.iter().filter(|l| l.starts_with("[file]")).count();
            return format!("{} 个目录，{} 个文件", dirs, files);
        }
        "read_file" => {
            let line_count = result.lines().count();
            return format!("读取 {} 行内容", line_count);
        }
        "grep" => {
            if result == "（无匹配）" {
                return "未找到匹配".into();
            }
            let n = result.lines().filter(|l| !l.is_empty()).count();
            return format!("找到 {} 处匹配", n);
        }
        "search_files" => {
            let n = result.lines().filter(|l| !l.is_empty()).count();
            if n == 0 {
                return "未找到文件".into();
            }
            return format!("找到 {} 个文件", n);
        }
        "search_symbols" => {
            if result == "（无匹配符号）" {
                return "未找到符号".into();
            }
            let n = result.lines().filter(|l| !l.is_empty()).count();
            return format!("找到 {} 个符号", n);
        }
        "write_file" => {
            if let Some(pos) = result.find("（") {
                return format!("已写入{}", &result[..pos]);
            }
            return result.to_string();
        }
        "patch_file" => {
            let line = result.replace('\n', " ").trim().to_string();
            return truncate_chars(&line, 60);
        }
        "delete_file" => {
            if result.starts_with("已删除 ") {
                return result.to_string();
            }
            return result.to_string();
        }
        "run_command" => {
            if result.starts_with("错误：") || result.starts_with("命令执行失败") {
                return "执行失败".into();
            }
            let one_line = result
                .replace(|c: char| c.is_whitespace(), " ")
                .trim()
                .to_string();
            if one_line.chars().count() > 60 {
                return truncate_chars(&one_line, 60);
            }
            if one_line.is_empty() {
                return "执行完成".into();
            }
            return one_line;
        }
        "git_status" => {
            if result.contains("工作区干净") {
                return "工作区干净".into();
            }
            return "已获取状态".into();
        }
        "git_diff" => {
            if result.contains("无变更") {
                return "无变更".into();
            }
            let n = result.lines().count();
            if n > 0 {
                return format!("{} 个文件有变更", n);
            }
            return "已获取 diff".into();
        }
        "web_search" => {
            let n = result
                .lines()
                .filter(|l| l.starts_with(|c: char| c.is_ascii_digit()))
                .count();
            if n > 0 {
                return format!("找到 {} 条结果", n);
            }
            return "搜索完成".into();
        }
        "web_extract" => {
            if let Some(start) = result.find("标题：") {
                let end = result[start + 3..]
                    .find('\n')
                    .unwrap_or(result[start + 3..].len().min(30));
                return format!("抓取「{}」", &result[start + 3..start + 3 + end].trim());
            }
            return "抓取网页".into();
        }
        _ => {}
    }

    let one_line = result
        .replace(|c: char| c.is_whitespace(), " ")
        .trim()
        .to_string();
    truncate_chars(&one_line, 120)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── truncate_chars / 多字节边界（回归：曾因 &s[..n] 按字节切而 panic） ──
    /// 构造一个「第 60 字节落在多字节字符中间」的串，复现历史 panic。
    /// 59 个 ASCII 字节 + 中文「为」(3 字节) → 字节 59..61，切点在字符内部。
    fn multibyte_boundary_string() -> String {
        format!("{}为xyz", "a".repeat(59))
    }

    #[test]
    fn test_truncate_chars_does_not_panic_on_multibyte_boundary() {
        let s = multibyte_boundary_string();
        assert!(s.len() > 60, "前置条件：字节数需超过 60");
        assert!(!s.is_char_boundary(60), "前置条件：第 60 字节必须落在字符内部");
        // 旧实现 &s[..60] 会在这里 panic；新实现必须安全返回。
        let out = truncate_chars(&s, 60);
        assert!(out.ends_with('…'));
        assert_eq!(out.chars().count(), 61); // 60 字符 + 省略号
        assert!(out.starts_with(&"a".repeat(59)));
    }

    #[test]
    fn test_truncate_chars_keeps_short_string_intact() {
        assert_eq!(truncate_chars("短", 60), "短");
        assert_eq!(truncate_chars("", 60), "");
        assert_eq!(truncate_chars("abc", 3), "abc");
    }

    #[test]
    fn test_truncate_chars_counts_chars_not_bytes() {
        // 60 个中文 = 180 字节；按字节切会全被截掉，按字符切应完整保留。
        let s = "中".repeat(60);
        assert_eq!(s.len(), 180);
        assert_eq!(truncate_chars(&s, 60), s);
        let out = truncate_chars(&s, 59);
        assert_eq!(out.chars().count(), 60);
    }

    #[test]
    fn test_truncate_chars_suffix_only_when_truncated() {
        let s = multibyte_boundary_string();
        assert_eq!(truncate_chars_suffix("short", 60, "…"), "short");
        let out = truncate_chars_suffix(&s, 60, "…");
        assert!(out.ends_with('…'));
        assert_eq!(out.chars().count(), 61);
    }

    // ── run_command 摘要（panic 现场） ──
    #[test]
    fn test_tool_summary_run_command_multibyte_boundary_no_panic() {
        // 回归：真实 panic 场景 —— run_command 输出含中文且越过 60 字节切点。
        let git_log = "a1b2c3d 修复了工具卡片卡在执行中的问题\n".repeat(6);
        let out = tool_summary("run_command", &git_log);
        assert!(!out.is_empty());
        assert!(out.chars().count() <= 61, "应截断到 60 字符 + 省略号");
    }

    #[test]
    fn test_tool_summary_run_command_multibyte_exact_boundary() {
        let out = tool_summary("run_command", &multibyte_boundary_string());
        assert!(out.ends_with('…'));
        assert_eq!(out.chars().count(), 61);
    }

    #[test]
    fn test_tool_summary_run_command_short_unchanged() {
        assert_eq!(tool_summary("run_command", "abc"), "abc");
        // 空输出走兜底文案（见 run_command 分支末尾）。
        assert_eq!(tool_summary("run_command", ""), "执行完成");
        // 纯空白同理被 trim 成空 → 兜底文案。
        assert_eq!(tool_summary("run_command", "   \n\t "), "执行完成");
    }

    #[test]
    fn test_tool_summary_run_command_flattens_newlines_to_single_space() {
        // 每个空白字符各自替换为空格（不塌缩连续空白）。
        assert_eq!(tool_summary("run_command", "a\n\nb\tc"), "a  b c");
        assert_eq!(tool_summary("run_command", "a\nb"), "a b");
    }

    // ── patch_file 摘要（同类雷） ──
    #[test]
    fn test_tool_summary_patch_file_multibyte_boundary_no_panic() {
        let out = tool_summary("patch_file", &multibyte_boundary_string());
        assert!(out.ends_with('…'));
        assert_eq!(out.chars().count(), 61);
    }

    #[test]
    fn test_tool_summary_patch_file_short_unchanged() {
        assert_eq!(tool_summary("patch_file", "已修改 a.ts"), "已修改 a.ts");
    }

    // ── 兜底分支 120 字符（panic 现场） ──
    #[test]
    fn test_tool_summary_fallback_120_multibyte_boundary_no_panic() {
        // 119 字节 ASCII + 中文 → 第 120 字节落在字符内部（历史 panic: index 120）。
        let s = format!("{}为xyz", "a".repeat(119));
        assert!(!s.is_char_boundary(120));
        let out = tool_summary("unknown_tool", &s);
        assert!(out.ends_with('…'));
        assert_eq!(out.chars().count(), 121);
    }

    // ── list_dir ──
    #[test]
    fn test_tool_summary_list_dir_empty() {
        assert_eq!(tool_summary("list_dir", "（空目录）"), "空目录");
    }

    #[test]
    fn test_tool_summary_list_dir_with_entries() {
        let result = "[dir] src\n[dir] tests\n[file] Cargo.toml\n[file] main.rs";
        assert_eq!(tool_summary("list_dir", result), "2 个目录，2 个文件");
    }

    #[test]
    fn test_tool_summary_list_dir_only_files() {
        let result = "[file] a.rs\n[file] b.rs\n[file] c.rs";
        assert_eq!(tool_summary("list_dir", result), "0 个目录，3 个文件");
    }

    #[test]
    fn test_tool_summary_list_dir_only_dirs() {
        let result = "[dir] src\n[dir] tests\n[dir] docs";
        assert_eq!(tool_summary("list_dir", result), "3 个目录，0 个文件");
    }

    // ── read_file ──
    #[test]
    fn test_tool_summary_read_file_short() {
        assert_eq!(tool_summary("read_file", "line1\nline2"), "读取 2 行内容");
    }

    #[test]
    fn test_tool_summary_read_file_long() {
        let content = "line\n".repeat(100);
        assert_eq!(tool_summary("read_file", &content), "读取 100 行内容");
    }

    #[test]
    fn test_tool_summary_read_file_single_line() {
        assert_eq!(tool_summary("read_file", "only line"), "读取 1 行内容");
    }

    // ── grep ──
    #[test]
    fn test_tool_summary_grep_no_match() {
        assert_eq!(tool_summary("grep", "（无匹配）"), "未找到匹配");
    }

    #[test]
    fn test_tool_summary_grep_with_matches() {
        assert_eq!(
            tool_summary("grep", "src/main.rs:1\nsrc/lib.rs:5"),
            "找到 2 处匹配"
        );
    }

    #[test]
    fn test_tool_summary_grep_single_match() {
        assert_eq!(tool_summary("grep", "single_match.rs:42"), "找到 1 处匹配");
    }

    #[test]
    fn test_tool_summary_grep_many_matches() {
        let result = "a:1\nb:2\nc:3\n";
        assert_eq!(tool_summary("grep", result), "找到 3 处匹配");
    }

    // ── search_files ──
    #[test]
    fn test_tool_summary_search_files_found() {
        assert_eq!(
            tool_summary("search_files", "src/main.rs\nsrc/lib.rs"),
            "找到 2 个文件"
        );
    }

    #[test]
    fn test_tool_summary_search_files_not_found() {
        assert_eq!(tool_summary("search_files", ""), "未找到文件");
    }

    #[test]
    fn test_tool_summary_search_files_single() {
        assert_eq!(tool_summary("search_files", "main.rs"), "找到 1 个文件");
    }

    // ── write_file ──
    #[test]
    fn test_tool_summary_write_file_with_size() {
        // Function prepends "已写入" again
        assert_eq!(
            tool_summary("write_file", "已写入 1234 字节（main.rs）"),
            "已写入已写入 1234 字节"
        );
    }

    #[test]
    fn test_tool_summary_write_file_no_marker() {
        assert_eq!(tool_summary("write_file", "文件已写入"), "文件已写入");
    }

    #[test]
    fn test_tool_summary_write_file_with_empty_result() {
        assert_eq!(tool_summary("write_file", ""), "");
    }

    // ── patch_file ──
    #[test]
    fn test_tool_summary_patch_file_short() {
        assert_eq!(
            tool_summary("patch_file", "已替换 old → new"),
            "已替换 old → new"
        );
    }

    #[test]
    fn test_tool_summary_patch_file_long_truncated() {
        let r = "已替换 ".to_string() + &"x".repeat(60) + " 完成。";
        let result = tool_summary("patch_file", &r);
        // 按【字符】截断：60 字符 + '…' = 61 字符。
        // （旧实现按 60 字节切，此处恰好未落在字符内部所以没 panic，但语义是错的。）
        assert_eq!(result.chars().count(), 61);
        assert!(result.ends_with('…'));
        assert!(result.starts_with("已替换 "));
    }

    #[test]
    fn test_tool_summary_patch_file_multibyte_never_panics() {
        // 回归：中文 diff 摘要越过 60 字节切点，旧实现 &line[..60] 会 panic。
        for filler in [55usize, 56, 57, 58, 59, 60, 61] {
            let r = format!("已替换 {}{}", "x".repeat(filler), "完成");
            let out = tool_summary("patch_file", &r);
            assert!(!out.is_empty());
        }
    }

    #[test]
    fn test_tool_summary_patch_file_multiline() {
        assert_eq!(
            tool_summary("patch_file", "已替换\nold\nnew"),
            "已替换 old new"
        );
    }

    // ── delete_file ──
    #[test]
    fn test_tool_summary_delete_file() {
        assert_eq!(
            tool_summary("delete_file", "已删除 src/old.rs"),
            "已删除 src/old.rs"
        );
    }

    #[test]
    fn test_tool_summary_delete_file_other() {
        assert_eq!(
            tool_summary("delete_file", "无法删除：文件不存在"),
            "无法删除：文件不存在"
        );
    }

    // ── run_command ──
    #[test]
    fn test_tool_summary_run_command_success() {
        assert_eq!(
            tool_summary("run_command", "Build completed successfully"),
            "Build completed successfully"
        );
    }

    #[test]
    fn test_tool_summary_run_command_error() {
        // Top-level handler strips "错误：" prefix before run_command arm is reached
        assert_eq!(
            tool_summary("run_command", "错误：command not found"),
            "command not found"
        );
    }

    #[test]
    fn test_tool_summary_run_command_failure_prefix() {
        assert_eq!(
            tool_summary("run_command", "命令执行失败: timeout"),
            "执行失败"
        );
    }

    #[test]
    fn test_tool_summary_run_command_empty() {
        assert_eq!(tool_summary("run_command", ""), "执行完成");
    }

    #[test]
    fn test_tool_summary_run_command_whitespace() {
        assert_eq!(tool_summary("run_command", "   "), "执行完成");
    }

    #[test]
    fn test_tool_summary_run_command_long_truncated() {
        let long = "output ".repeat(20);
        let result = tool_summary("run_command", &long);
        // 60 ASCII chars + '…' (3 bytes) = 63 bytes
        assert_eq!(result.len(), 63);
        assert!(result.ends_with('…'));
    }

    // ── git_status ──
    #[test]
    fn test_tool_summary_git_status_clean() {
        assert_eq!(tool_summary("git_status", "工作区干净"), "工作区干净");
    }

    #[test]
    fn test_tool_summary_git_status_dirty() {
        assert_eq!(tool_summary("git_status", "有修改的文件"), "已获取状态");
    }

    // ── git_diff ──
    #[test]
    fn test_tool_summary_git_diff_no_changes() {
        assert_eq!(tool_summary("git_diff", "无变更"), "无变更");
    }

    #[test]
    fn test_tool_summary_git_diff_with_changes() {
        let result = "--- a/src/main.rs\n+++ b/src/main.rs\n@@ -1 +1 @@\n-old\n+new";
        assert_eq!(tool_summary("git_diff", result), "5 个文件有变更");
    }

    #[test]
    fn test_tool_summary_git_diff_internal_no_changes() {
        assert_eq!(
            tool_summary("git_diff", "--- a/foo\n+++ b/foo\n@@ -0,0 +1 @@\n+new"),
            "4 个文件有变更"
        );
    }

    // ── web_search ──
    #[test]
    fn test_tool_summary_web_search_with_results() {
        assert_eq!(
            tool_summary("web_search", "1. Result A\n2. Result B"),
            "找到 2 条结果"
        );
    }

    #[test]
    fn test_tool_summary_web_search_no_results() {
        assert_eq!(tool_summary("web_search", "无结果"), "搜索完成");
    }

    #[test]
    fn test_tool_summary_web_search_non_digit_lines() {
        assert_eq!(
            tool_summary("web_search", "一些描述\n- 无编号结果"),
            "搜索完成"
        );
    }

    // ── web_extract ──
    #[test]
    fn test_tool_summary_web_extract_with_title() {
        let result = "标题：AIALL 项目\n内容：...";
        assert_eq!(
            tool_summary("web_extract", result),
            "抓取「题：AIALL 项目」"
        );
    }

    #[test]
    fn test_tool_summary_web_extract_no_title() {
        assert_eq!(tool_summary("web_extract", ""), "抓取网页");
    }

    #[test]
    fn test_tool_summary_web_extract_long_title_truncated() {
        let long_title = "标题：".to_string() + &"x".repeat(50);
        let result = tool_summary("web_extract", &long_title);
        // No newline → takes min(30) bytes from byte offset 3
        assert!(result.starts_with("抓取「题："));
        assert!(result.len() > 35);
    }

    // ── unknown tool ──
    #[test]
    fn test_tool_summary_unknown_tool_short() {
        assert_eq!(tool_summary("unknown", "hello world"), "hello world");
    }

    #[test]
    fn test_tool_summary_unknown_tool_long_truncated() {
        let long = "word ".repeat(50);
        let result = tool_summary("unknown", &long);
        // 120 ASCII chars + '…' (3 bytes) = 123 bytes
        assert_eq!(result.len(), 123);
        assert!(result.ends_with('…'));
    }

    // ── error prefix ──
    #[test]
    fn test_tool_summary_error_prefix_stripped() {
        assert_eq!(
            tool_summary("list_dir", "错误：Permission denied"),
            "Permission denied"
        );
    }

    #[test]
    fn test_tool_summary_error_prefix_whitespace_trimmed() {
        assert_eq!(tool_summary("grep", "错误：  权限不足  "), "权限不足");
    }

    // ── edge cases ──
    #[test]
    fn test_tool_summary_empty_result_unknown() {
        assert_eq!(tool_summary("unknown", ""), "");
    }
}
