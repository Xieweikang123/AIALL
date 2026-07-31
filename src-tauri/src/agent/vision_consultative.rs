//! Vision consultative finalize gates and hints.
//! Ported from server/visionMessage.ts (consultative locate/style subset).

use regex::Regex;
use std::sync::LazyLock;

use super::policy::prompt_has_implement_intent_without_question;
use super::vision::{is_unreconciled_empty_shell_answer, VISION_INTERNAL_MARKER_RE};

static UI_LOCATE_QUESTION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
    r"(?:哪(?:儿|里|块|个)|什么|啥)(?:的)?(?:按钮|控件|面板|区域|组件|元素|部分|内容)|(?:知道|看得出|认得|识别).{0,12}(?:哪儿|哪里|哪块|哪个)|显示的(?:什么|啥)|(?:这里|这边|旁边|此处).{0,12}(?:啥|什么)|(?:这是|那是)(?:什么|啥)",
  )
  .unwrap()
});

static UI_APPEARANCE_QUESTION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
    r"(?i)背景.{0,12}(?:透明|半透明|模糊|毛玻璃|虚化)|(?:透明|半透明|毛玻璃|blur|backdrop).{0,12}(?:吗|么|[？?]\s*$)|(?:opacity|rgba).{0,12}(?:吗|么|[？?]\s*$)",
  )
  .unwrap()
});

static UI_STATE_PERSISTENCE_QUESTION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
    r"(?:切|换|切换).{0,20}(?:再|回|之后|然后).{0,20}(?:切|换|回)|(?:还会|会不会|是不是会|是否会|会不会再).{0,24}(?:再次|重新|仍然|保留|恢复|打开|关闭|展开|折叠|显示|隐藏|保持)|再次.{0,12}(?:打开|展开|显示|出现|恢复)",
  )
  .unwrap()
});

static ACCURACY_CONSULTATIVE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)是否.{0,20}(?:准确|正确|总是|一直|可靠)|(?:准确|正确|可靠).{0,12}(?:吗|么)[？?]?$",
    )
    .unwrap()
});

static DEFERRED_LOCATE_REPLY_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
    r"(?:下一(?:轮|步)|再.{0,8}(?:搜索|确认|核对|定位|查))|(?:需要|须|应).{0,16}(?:搜索|确认|核对|定位)|通过搜索.{0,16}确认|精确确认",
  )
  .unwrap()
});

static SPECULATIVE_LOCATE_REPLY_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:极有可能|很可能|可能属于|或许在|猜测|推断.{0,24}(?:属于|位于)).{0,48}(?:或|/)")
        .unwrap()
});

static SPECULATIVE_PATH_GUESS_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?:极有可能|很可能|可能属于|或许|猜测).{0,48}['"`][\w./-]+\.(?:vue|tsx?|jsx?)['"`]"#,
    )
    .unwrap()
});

static SPECULATIVE_PLACEHOLDER_CLAIM_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
    r"(?:占位|placeholder|尚未实现|无(?:内容|图标|点击)|待办功能|早期规划).{0,32}(?:占位|placeholder|未实现|无内容|无图标|无点击)",
  )
  .unwrap()
});

static SPECULATIVE_STYLE_ANSWER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:rgba\s*\(|backdrop-filter|毛玻璃|半透明|透明背景|blur\s*\()").unwrap()
});

static BINARY_STYLE_CONCLUSION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:是的|不是|并非|确实|属于).{0,24}(?:透明|半透明|毛玻璃|实色|不透明)").unwrap()
});

fn strip_vision_marker(text: &str) -> String {
    VISION_INTERNAL_MARKER_RE
        .replace_all(text, "")
        .trim()
        .to_string()
}

pub fn is_ui_locate_question_prompt(prompt: &str) -> bool {
    let text = prompt.trim();
    !text.is_empty() && UI_LOCATE_QUESTION_RE.is_match(text)
}

pub fn is_ui_appearance_question_prompt(prompt: &str) -> bool {
    let text = prompt.trim();
    !text.is_empty() && UI_APPEARANCE_QUESTION_RE.is_match(text)
}

pub fn is_ui_state_persistence_question_prompt(prompt: &str) -> bool {
    let text = prompt.trim();
    if text.is_empty() {
        return false;
    }
    if prompt_has_implement_intent_without_question(text) {
        return false;
    }
    UI_STATE_PERSISTENCE_QUESTION_RE.is_match(text)
}

pub fn is_accuracy_consultative_prompt(prompt: &str) -> bool {
    ACCURACY_CONSULTATIVE_RE.is_match(prompt.trim())
}

pub fn should_run_vision_anchor_pgrep(
    consultative_vision_run: bool,
    prompt: &str,
    anchor_quotes: &[String],
) -> bool {
    if !consultative_vision_run || anchor_quotes.is_empty() {
        return false;
    }
    is_ui_locate_question_prompt(prompt)
        || is_accuracy_consultative_prompt(prompt)
        || is_ui_appearance_question_prompt(prompt)
}

pub fn should_bypass_vision_first_turn(
    image_count: usize,
    consultative_vision_run: bool,
    prompt: &str,
) -> bool {
    if image_count == 0 || !consultative_vision_run {
        return false;
    }
    is_ui_locate_question_prompt(prompt)
        || is_accuracy_consultative_prompt(prompt)
        || is_ui_appearance_question_prompt(prompt)
        || is_ui_state_persistence_question_prompt(prompt)
}

pub fn is_deferred_locate_reply(text: &str) -> bool {
    let body = strip_vision_marker(text);
    !body.is_empty() && DEFERRED_LOCATE_REPLY_RE.is_match(&body)
}

pub fn is_speculative_locate_reply(text: &str) -> bool {
    let body = strip_vision_marker(text);
    if body.is_empty() {
        return false;
    }
    SPECULATIVE_LOCATE_REPLY_RE.is_match(&body)
        || SPECULATIVE_PATH_GUESS_RE.is_match(&body)
        || SPECULATIVE_PLACEHOLDER_CLAIM_RE.is_match(&body)
}

pub fn is_repeating_vision_first_turn_description(reply_text: &str, vision_text: &str) -> bool {
    let a = strip_vision_marker(reply_text);
    let b = strip_vision_marker(vision_text);
    if a.is_empty() || b.is_empty() || a.chars().count() < 48 || b.chars().count() < 48 {
        return false;
    }
    let head_a: String = a.chars().take(72).collect();
    let head_b: String = b.chars().take(72).collect();
    if head_a == head_b {
        return true;
    }
    let snippet: String = head_b.chars().take(44).collect();
    snippet.chars().count() >= 24 && a.contains(&snippet)
}

pub fn is_speculative_style_answer(text: &str) -> bool {
    let body = strip_vision_marker(text);
    if body.is_empty() {
        return false;
    }
    if Regex::new(r"(?i)var\s*\(--|background\s*:|\.[\w-]+\s*\{")
        .map(|re| re.is_match(&body))
        .unwrap_or(false)
    {
        return false;
    }
    SPECULATIVE_STYLE_ANSWER_RE.is_match(&body) || BINARY_STYLE_CONCLUSION_RE.is_match(&body)
}

pub fn reply_has_css_read_evidence(text: &str) -> bool {
    let body = strip_vision_marker(text);
    if body.is_empty() {
        return false;
    }
    Regex::new(r"(?i)var\s*\(--|background\s*:|backdrop-filter|opacity\s*:")
        .map(|re| re.is_match(&body))
        .unwrap_or(false)
        || Regex::new(r"\.[\w-]+\s*\{")
            .map(|re| re.is_match(&body))
            .unwrap_or(false)
}

fn normalize_consultative_rel_path(p: &str) -> String {
    p.replace('\\', "/")
        .trim_start_matches("./")
        .trim()
        .to_lowercase()
}

fn consultative_paths_match(read: &str, vue: &str) -> bool {
    let r = normalize_consultative_rel_path(read);
    let v = normalize_consultative_rel_path(vue);
    if r.is_empty() || v.is_empty() {
        return false;
    }
    r.ends_with(&v) || v.ends_with(&r) || r.contains(&v)
}

pub fn consultative_needs_grep_hit_vue_read(
    grep_hit_vue_files: &[String],
    consultative_read_paths: &[String],
) -> bool {
    if grep_hit_vue_files.is_empty() {
        return false;
    }
    if consultative_read_paths.is_empty() {
        return true;
    }
    !grep_hit_vue_files.iter().any(|vue| {
        consultative_read_paths
            .iter()
            .any(|read| consultative_paths_match(read, vue))
    })
}

pub fn consultative_appearance_needs_vue_read(
    grep_hit_vue_files: &[String],
    consultative_read_paths: &[String],
    vision_locate_read_used: bool,
) -> bool {
    if vision_locate_read_used {
        return false;
    }
    consultative_needs_grep_hit_vue_read(grep_hit_vue_files, consultative_read_paths)
}

#[derive(Debug, Clone, Default)]
pub struct ConsultativeVisionFinalizeInput<'a> {
    pub consultative_vision_run: bool,
    pub vision_locate_active: bool,
    pub vision_locate_tools_used: bool,
    pub vision_auto_grep_had_matches: bool,
    pub vision_locate_read_used: bool,
    pub prompt: &'a str,
    pub reply_text: &'a str,
    pub vision_first_turn_text: Option<&'a str>,
    pub grep_hit_vue_files: &'a [String],
    pub consultative_read_paths: &'a [String],
}

pub fn should_block_consultative_vision_locate_finalize(
    params: &ConsultativeVisionFinalizeInput<'_>,
) -> bool {
    if !params.consultative_vision_run || !params.vision_locate_active {
        return false;
    }

    let appearance_prompt = is_ui_appearance_question_prompt(params.prompt);

    if params.vision_locate_read_used
        && appearance_prompt
        && reply_has_css_read_evidence(params.reply_text)
        && !is_speculative_style_answer(params.reply_text)
    {
        return false;
    }

    if is_deferred_locate_reply(params.reply_text) {
        return true;
    }

    if let Some(vision_text) = params.vision_first_turn_text {
        if is_repeating_vision_first_turn_description(params.reply_text, vision_text)
            && !reply_has_css_read_evidence(params.reply_text)
        {
            return true;
        }
        if is_unreconciled_empty_shell_answer(vision_text, params.reply_text) {
            return true;
        }
    }

    if appearance_prompt
        && is_speculative_style_answer(params.reply_text)
        && consultative_needs_grep_hit_vue_read(
            params.grep_hit_vue_files,
            params.consultative_read_paths,
        )
    {
        return true;
    }

    if params.vision_auto_grep_had_matches
        && !params.vision_locate_read_used
        && (is_ui_locate_question_prompt(params.prompt) || appearance_prompt)
    {
        return true;
    }

    if appearance_prompt
        && !params.vision_locate_read_used
        && consultative_needs_grep_hit_vue_read(
            params.grep_hit_vue_files,
            params.consultative_read_paths,
        )
    {
        return true;
    }

    if params.vision_locate_tools_used {
        return false;
    }

    if is_ui_locate_question_prompt(params.prompt) {
        return true;
    }
    if is_ui_state_persistence_question_prompt(params.prompt) && !params.vision_locate_tools_used {
        return true;
    }
    if is_speculative_locate_reply(params.reply_text) {
        return true;
    }

    false
}

pub fn build_consultative_ui_appearance_retry_hint(vue_files: &[String]) -> String {
    let file_hint = if vue_files.is_empty() {
        "请 read_file 定位到的组件样式段。".to_string()
    } else {
        format!(
            "请 read_file：{}（含 `<style>` 段）。",
            vue_files
                .iter()
                .take(2)
                .cloned()
                .collect::<Vec<_>>()
                .join("、")
        )
    };
    [
        "【样式未闭环】你在未 read CSS 的情况下断言了透明/模糊/rgba 等视觉效果。",
        &file_hint,
        "从 read 返回引用 background 等属性后再给二元结论；不确定则明确说「无法确认」。",
        "若本轮工具结果中已有该文件片段，禁止再 grep/read 同一文件，直接基于已有内容作答。",
    ]
    .join("")
}

pub fn build_vision_consultative_locate_retry_hint(anchor_quotes: &[String]) -> String {
    let anchor_hint = if anchor_quotes.is_empty() {
        "请 grep 读图描述中的可见文案（≥4 字）、结构标识或相关符号。".to_string()
    } else {
        format!(
            "读图已摘录：{}。请 grep 其中 ≥4 字片段。",
            anchor_quotes
                .iter()
                .take(3)
                .map(|q| format!("「{q}」"))
                .collect::<Vec<_>>()
                .join("、")
        )
    };
    [
    "【定位未完成】读图已完成，但尚未 grep/read 核对源码。",
    &anchor_hint,
    "禁止猜测组件路径或写「下一轮再确认」。",
    "请立即调用 grep（必要时 read_file 1 个文件），然后给出最终答案：先一句点明截图对应哪块界面，再答用户问题。",
    "勿重复首轮完整外观描述。",
  ]
  .join("")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_bypass_vision_first_turn_for_locate_questions() {
        assert!(should_bypass_vision_first_turn(
            1,
            true,
            "知道是哪儿的按钮吗？",
        ));
        assert!(!should_bypass_vision_first_turn(
            0,
            true,
            "知道是哪儿的按钮吗？"
        ));
        assert!(!should_bypass_vision_first_turn(
            1,
            false,
            "知道是哪儿的按钮吗？"
        ));
    }

    #[test]
    fn is_ui_locate_question_prompt_detects_where_is_button() {
        assert!(is_ui_locate_question_prompt("知道是哪儿的按钮吗？"));
        assert!(!is_ui_locate_question_prompt("帮我把这个按钮改小一点"));
    }

    #[test]
    fn is_deferred_locate_reply_detects_postponed_answers() {
        assert!(is_deferred_locate_reply(
            "需要在下一轮通过搜索按钮文案来精确确认。"
        ));
        assert!(!is_deferred_locate_reply(
            "位于 FilePanel.vue 的 session-action-btn。"
        ));
    }

    #[test]
    fn is_speculative_locate_reply_detects_guessing() {
        let guess = "极有可能属于 FilePanel 或 AppToolbar，需要在下一轮搜索确认。";
        assert!(is_speculative_locate_reply(guess));
        assert!(!is_speculative_locate_reply(
            "grep 命中 FilePanel.vue，按钮 class 为 session-action-btn。"
        ));
    }

    #[test]
    fn blocks_guess_only_consultative_vision_replies() {
        let vision =
      "这是一个深色背景上的按钮，按钮文字为「+ 新建」。据此可判断这是侧栏会话区域。[图已理解]";
        let reply =
      "这是一个深色背景上的按钮，按钮文字为「+ 新建」。极有可能属于 FilePanel 或 AppToolbar，需要在下一轮搜索确认。";
        let input = ConsultativeVisionFinalizeInput {
            consultative_vision_run: true,
            vision_locate_active: true,
            vision_locate_tools_used: false,
            prompt: "知道是哪儿的按钮吗？",
            reply_text: reply,
            vision_first_turn_text: Some(vision),
            ..Default::default()
        };
        assert!(should_block_consultative_vision_locate_finalize(&input));
    }

    #[test]
    fn blocks_speculative_style_without_css_read() {
        let input = ConsultativeVisionFinalizeInput {
            consultative_vision_run: true,
            vision_locate_active: true,
            vision_locate_tools_used: true,
            vision_locate_read_used: false,
            prompt: "弹窗背景透明的？",
            reply_text: "是的，背景是半透明毛玻璃，用了 backdrop-filter。",
            grep_hit_vue_files: &["src/components/vibe/AppToolbar.vue".to_string()],
            consultative_read_paths: &[],
            ..Default::default()
        };
        assert!(should_block_consultative_vision_locate_finalize(&input));

        let read_paths = vec!["src/components/vibe/AppToolbar.vue".to_string()];
        let ok_input = ConsultativeVisionFinalizeInput {
            vision_locate_read_used: true,
            reply_text:
                "`.project-history-dropdown { background: var(--bg-primary); }` 为实色，不透明。",
            consultative_read_paths: &read_paths,
            ..input
        };
        assert!(!should_block_consultative_vision_locate_finalize(&ok_input));
        assert!(is_speculative_style_answer(
            "是的，背景是半透明毛玻璃，用了 backdrop-filter。"
        ));
        assert!(reply_has_css_read_evidence(
            "`.project-history-dropdown { background: var(--bg-primary); }` 为实色，不透明。"
        ));
    }

    #[test]
    fn requires_read_after_auto_grep_hits() {
        let blocked = ConsultativeVisionFinalizeInput {
            consultative_vision_run: true,
            vision_locate_active: true,
            vision_locate_tools_used: true,
            vision_auto_grep_had_matches: true,
            vision_locate_read_used: false,
            prompt: "知道是哪儿的按钮吗？",
            reply_text: "可能在 FilePanel.vue。",
            ..Default::default()
        };
        assert!(should_block_consultative_vision_locate_finalize(&blocked));

        let allowed = ConsultativeVisionFinalizeInput {
            vision_locate_read_used: true,
            reply_text: "位于 src/Foo.vue 的 session-action-btn。",
            ..blocked
        };
        assert!(!should_block_consultative_vision_locate_finalize(&allowed));
    }
}
