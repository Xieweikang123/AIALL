use regex::Regex;
use std::sync::OnceLock;

use super::context::HistoryMessage;

static USER_NEGATION_RE: OnceLock<Regex> = OnceLock::new();
static PLAN_QUOTE_PREFIX_RE: OnceLock<Regex> = OnceLock::new();
static PLAN_QUOTE_INFO_QUESTION_RE: OnceLock<Regex> = OnceLock::new();
static PLAN_QUOTE_EDIT_INTENT_RE: OnceLock<Regex> = OnceLock::new();
static CONCRETE_EDIT_VERB_RE: OnceLock<Regex> = OnceLock::new();
static IMPLEMENTATION_INTENT_RE: OnceLock<Regex> = OnceLock::new();
static ASK_ONLY_RE: OnceLock<Regex> = OnceLock::new();
static PLAN_EXPLICIT_MARKER_RE: OnceLock<Regex> = OnceLock::new();
static PLAN_FILE_PATH_RE: OnceLock<Regex> = OnceLock::new();
static EXECUTION_CONTINUATION_RE: OnceLock<Regex> = OnceLock::new();
static EXECUTION_CONTINUE_RE: OnceLock<Regex> = OnceLock::new();
static PLAN_QUOTE_SHORT_EDIT_RE: OnceLock<Regex> = OnceLock::new();

fn user_negation_re() -> &'static Regex {
    USER_NEGATION_RE.get_or_init(|| {
    Regex::new(
      r"不好看|不满意|不对|不是这样|不是这个|重来|重新(改|做|来|设计|调整)|换一种|换(个|一个)(风格|方向|方式)|还是(不|没)|继续(优化|改|调整)|再来(一次|个)|不行|不喜欢|太(丑|丑了|难看)|效果不(好|行|对)|不是我想要|跟之前(一样|差不多)|没变化|没区别|不喜欢",
    )
    .expect("USER_NEGATION_RE")
  })
}

fn plan_quote_prefix_re() -> &'static Regex {
    PLAN_QUOTE_PREFIX_RE
        .get_or_init(|| Regex::new(r"(?m)^\s*>[^\n]*方案\s*[:：]").expect("PLAN_QUOTE_PREFIX_RE"))
}

fn plan_quote_info_question_re() -> &'static Regex {
    PLAN_QUOTE_INFO_QUESTION_RE.get_or_init(|| {
    Regex::new(
      r"(?:什么|啥|哪里|哪儿|为何|为什么|怎么|如何|是否|有没有|能不能|可以吗|到哪|写入|输出|配置|在哪|干啥|干什么|什么意思|含义|作用|行为|会.{0,4}(?:吗|么|嘛))",
    )
    .expect("PLAN_QUOTE_INFO_QUESTION_RE")
  })
}

fn plan_quote_edit_intent_re() -> &'static Regex {
    PLAN_QUOTE_EDIT_INTENT_RE.get_or_init(|| {
    Regex::new(
      r"(?:这个|这段|上面|此处).{0,12}(?:不要|删掉|去掉|移除)|不要.{0,8}(?:这段|这个|上面)|(?:改成|改为|换成|更新(?:为|成)?)",
    )
    .expect("PLAN_QUOTE_EDIT_INTENT_RE")
  })
}

fn concrete_edit_verb_re() -> &'static Regex {
    CONCRETE_EDIT_VERB_RE.get_or_init(|| {
        Regex::new(r"(?:移除|删除|去掉|新增|添加|改为|改成|替换|精简|清理|patch_file|write_file)")
            .expect("CONCRETE_EDIT_VERB_RE")
    })
}

fn implementation_intent_re() -> &'static Regex {
    IMPLEMENTATION_INTENT_RE.get_or_init(|| {
    Regex::new(
      r"(?:请|帮我)?(?:实现|开发|接入|加上|做一下|做吧|做掉|开工|开干|那就(?:做|改|来)|按(?:上面|此|这个|方案)?(?:改|做|实现)?)",
    )
    .expect("IMPLEMENTATION_INTENT_RE")
  })
}

fn ask_only_re() -> &'static Regex {
    ASK_ONLY_RE.get_or_init(|| {
        Regex::new(r"^(什么是|是什么|怎么|如何|为什么|有没有|是否|能不能|可以吗)[\s\S]{0,120}$")
            .expect("ASK_ONLY_RE")
    })
}

fn plan_explicit_marker_re() -> &'static Regex {
    PLAN_EXPLICIT_MARKER_RE.get_or_init(|| {
        Regex::new(r"(?m)(?:^|\n)\s*(?:##\s*修改方案|\[PLAN\]|<!--\s*agent-plan\s*-->)")
            .expect("PLAN_EXPLICIT_MARKER_RE")
    })
}

fn plan_file_path_re() -> &'static Regex {
    PLAN_FILE_PATH_RE.get_or_init(|| {
    Regex::new(
      r#"(?i)(?:^|[\s`"'(（\[])((?:[\w@.-]+/)+[\w.-]+\.(?:vue|ts|tsx|js|jsx|json|md|css|scss|html|py|rs|go|toml)|[\w.-]+\.(?:vue|ts|tsx|js|jsx|json|md|css|scss|html|py|rs|go|toml))\b"#,
    )
    .expect("PLAN_FILE_PATH_RE")
  })
}

fn execution_continuation_re() -> &'static Regex {
    EXECUTION_CONTINUATION_RE.get_or_init(|| {
    Regex::new(
      r"(?i)^(改吧|执行方案|好的?|行|可以|接着(做|改|来)?|执行(吧|一下)?|开始(改|做)?|动手(吧)?|按方案(改|执行)?|继续|(?:优化|改进|调整)(?:吧|一下|下)?|go|do it|yes|ok|okay|sure)\.?$",
    )
    .expect("EXECUTION_CONTINUATION_RE")
  })
}

fn plan_quote_short_edit_re() -> &'static Regex {
    PLAN_QUOTE_SHORT_EDIT_RE.get_or_init(|| {
        Regex::new(r"(?:改|删|加|去掉|不要|替换)").expect("PLAN_QUOTE_SHORT_EDIT_RE")
    })
}

fn execution_continue_re() -> &'static Regex {
    EXECUTION_CONTINUE_RE.get_or_init(|| {
        Regex::new(r"(?i)^继续(?:执行|改|做|写|来|完成)(?:吧|一下)?\.?$")
            .expect("EXECUTION_CONTINUE_RE")
    })
}

/// Detect repeated negation — user said negation in the current prompt.
pub fn detect_user_negation(text: &str) -> bool {
    user_negation_re().is_match(text.trim())
}

pub fn is_plan_quote_prompt(text: &str) -> bool {
    plan_quote_prefix_re().is_match(text.trim())
}

pub fn strip_quoted_reply_prefix(text: &str) -> String {
    let body: String = text
        .lines()
        .filter(|line| !line.trim_start().starts_with('>'))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();
    if body.is_empty() {
        text.trim().to_string()
    } else {
        body
    }
}

pub fn looks_like_plan_quote_informational_question(body: &str) -> bool {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return false;
    }
    if concrete_edit_verb_re().is_match(trimmed)
        || implementation_intent_re().is_match(trimmed)
        || plan_quote_edit_intent_re().is_match(trimmed)
    {
        return false;
    }
    if ask_only_re().is_match(trimmed) {
        return true;
    }
    let has_question = trimmed.contains('?') || trimmed.contains('？');
    if !has_question {
        return false;
    }
    if plan_quote_info_question_re().is_match(trimmed) {
        return true;
    }
    let lines: Vec<&str> = trimmed.lines().filter(|l| !l.trim().is_empty()).collect();
    lines.len() <= 2 && !plan_quote_short_edit_re().is_match(trimmed)
}

pub fn is_plan_quote_informational_prompt(text: &str) -> bool {
    if !is_plan_quote_prompt(text) {
        return false;
    }
    looks_like_plan_quote_informational_question(&strip_quoted_reply_prefix(text))
}

pub fn is_plan_quote_revision_prompt(text: &str) -> bool {
    if !is_plan_quote_prompt(text) {
        return false;
    }
    !looks_like_plan_quote_informational_question(&strip_quoted_reply_prefix(text))
}

pub fn is_execution_continuation(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    execution_continuation_re().is_match(trimmed) || execution_continue_re().is_match(trimmed)
}

pub fn extract_plan_file_paths(content: &str) -> Vec<String> {
    let mut candidates = Vec::new();
    for cap in plan_file_path_re().captures_iter(content) {
        if let Some(raw) = cap.get(1) {
            candidates.push(raw.as_str().replace('\\', "/"));
        }
    }
    normalize_plan_paths(candidates)
}

fn normalize_plan_paths(paths: Vec<String>) -> Vec<String> {
    let unique: Vec<String> = paths
        .into_iter()
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    unique
        .iter()
        .filter(|path| {
            if path.starts_with("./") {
                return false;
            }
            if path.contains('/') {
                return true;
            }
            !unique
                .iter()
                .any(|other| other != *path && other.ends_with(&format!("/{path}")))
        })
        .cloned()
        .collect()
}

pub fn looks_like_modification_plan(content: &str) -> bool {
    plan_explicit_marker_re().is_match(content.trim())
}

#[derive(Debug, Clone, Default)]
pub struct PendingPlanState {
    pub has_pending_plan: bool,
}

fn is_plan_executed_after_index(history: &[HistoryMessage], plan_idx: usize) -> bool {
    for msg in history.iter().skip(plan_idx + 1) {
        if msg.role == "user" && is_execution_continuation(&msg.content) {
            return true;
        }
        if msg.role == "assistant"
            && (msg.content.contains("已写入")
                || msg.content.contains("write_file")
                || msg.content.contains("patch_file"))
        {
            return true;
        }
    }
    false
}

pub fn resolve_pending_plan_state(history: Option<&[HistoryMessage]>) -> PendingPlanState {
    let Some(history) = history else {
        return PendingPlanState::default();
    };
    for (i, msg) in history.iter().enumerate() {
        if msg.role != "assistant" {
            continue;
        }
        if !looks_like_modification_plan(&msg.content) {
            continue;
        }
        if is_plan_executed_after_index(history, i) {
            continue;
        }
        return PendingPlanState {
            has_pending_plan: true,
        };
    }
    PendingPlanState::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_user_negation_positive() {
        assert!(detect_user_negation("不好看，换一种风格"));
    }

    #[test]
    fn detect_user_negation_negative() {
        assert!(!detect_user_negation("请分析一下性能问题"));
    }

    #[test]
    fn plan_quote_informational_prompt() {
        let text = "> 方案: foo\n日志写到哪里了？";
        assert!(is_plan_quote_prompt(text));
        assert!(is_plan_quote_informational_prompt(text));
        assert!(!is_plan_quote_revision_prompt(text));
    }

    #[test]
    fn extract_plan_file_paths_finds_relative() {
        let paths = extract_plan_file_paths("改 `src/foo.ts` 和 bar.vue");
        assert!(paths.iter().any(|p| p == "src/foo.ts"));
    }
}
