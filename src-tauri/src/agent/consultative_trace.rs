use once_cell::sync::Lazy;
use regex::Regex;

fn strip_vision_marker(text: &str) -> String {
    let re = Regex::new(r"\s*\[图已理解\]\s*").unwrap();
    re.replace_all(text, "").trim().to_string()
}

fn normalize_path(path: &str) -> String {
    path.replace('\\', "/").trim().to_lowercase()
}

pub fn is_consultative_entry_layer_path(file_path: &str) -> bool {
    let p = normalize_path(file_path);
    Regex::new(r"(?:^|/)src/(?:composables|components|views)/").unwrap().is_match(&p)
}

pub fn is_consultative_client_layer_path(file_path: &str) -> bool {
    let p = normalize_path(file_path);
    Regex::new(r"(?:^|/)src/services/").unwrap().is_match(&p)
}

pub fn is_consultative_backend_layer_path(file_path: &str) -> bool {
    let p = normalize_path(file_path);
    Regex::new(r"(?:^|/)server/").unwrap().is_match(&p) || p.contains("middleware")
}

pub fn has_consultative_accuracy_trace_depth(read_paths: &[String]) -> bool {
    if read_paths.len() < 2 { return false; }
    let has_entry = read_paths.iter().any(|p| is_consultative_entry_layer_path(p));
    let has_backend = read_paths.iter().any(|p| is_consultative_backend_layer_path(p));
    has_entry && has_backend
}

static DEFERRED_ANSWER_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"想让我.{0,32}(?:看|深入|确认|排查|读)|(?:要不要|是否需要|是否).{0,16}(?:看|深入|确认).{0,16}(?:prompt|构造|实现)|基于已有信息直接回答").unwrap()
});

pub fn is_deferred_behavior_answer_reply(text: &str) -> bool {
    let body = strip_vision_marker(text);
    !body.is_empty() && DEFERRED_ANSWER_RE.is_match(&body)
}

static SPECULATIVE_IMPL_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?:如果|若).{0,40}(?:prompt|注入|上下文).{0,48}(?:较|会|可能|偏高|偏低|够|不够)").unwrap()
});

static SPECULATIVE_IMPL_SHORT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"如果只是.{0,24}(?:文件名|列表|名字)").unwrap()
});

pub fn is_speculative_implementation_reply(text: &str) -> bool {
    let body = strip_vision_marker(text);
    !body.is_empty() && (SPECULATIVE_IMPL_RE.is_match(&body) || SPECULATIVE_IMPL_SHORT_RE.is_match(&body))
}

pub fn build_consultative_accuracy_trace_hint() -> String {
    vec![
        "【准确度·须 trace 到 prompt 构造】用户问输出/行为是否准确，不是 UI 定位题。",
        "grep 命中入口后须 read 并沿调用链向下：composable/组件 -> API 客户端（若有）-> backend 路由/middleware 中 prompt 或数据处理处。",
        "回答须基于已读代码说明实际注入的上下文与条件；禁止用「如果 prompt 包含...」猜测；禁止写「想让我深入看一下」或「基于已有信息直接回答」。",
    ].join("")
}

pub fn build_consultative_accuracy_trace_retry_hint(read_paths: &[String]) -> String {
    let listed = if read_paths.is_empty() {
        "尚未 read 任何文件。".to_string()
    } else {
        format!("已 read：{}。", read_paths.iter().rev().take(4).map(|s| s.as_str()).collect::<Vec<_>>().join("、"))
    };
    vec![
        "【准确度·trace 未完成】尚未读到 backend/middleware 的 prompt 或数据处理实现，不能结案。",
        &listed,
        "请继续：grep 客户端调用的 API 路径或 handler 符号 -> read_file backend/middleware 中 prompt 构造处 -> 再给出最终答案。",
        "禁止用条件句猜测；禁止反问用户要不要继续查。",
    ].join("")
}

pub fn should_block_consultative_accuracy_finalize(
    accuracy_consultative: bool, vision_locate_tools_used: bool,
    consultative_read_paths: &[String], reply_text: &str,
) -> bool {
    if !accuracy_consultative { return false; }
    if is_deferred_behavior_answer_reply(reply_text) { return true; }
    if is_speculative_implementation_reply(reply_text) { return true; }
    vision_locate_tools_used && !has_consultative_accuracy_trace_depth(consultative_read_paths)
}

static DEFINITION_VALUE_TOKEN_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?:=\s*\d+|`[^`]+`\s*=\s*\d+|\b=\s*0\b|\b=\s*1\b|\b=\s*2\b)").unwrap());

static SPECULATIVE_PURPOSE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"可能.{0,32}(?:作为|用于|在).{0,32}(?:标识|状态|流程|标记)").unwrap());

static SPECULATIVE_PURPOSE_NEED_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"具体使用位置需要查看|需要查看引用|须查看引用|具体用法需要").unwrap());

static SPECULATIVE_PURPOSE_MAYBE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"可能在.{0,20}(?:流程|场景|处理)中").unwrap());

pub fn is_speculative_behavior_purpose_reply(text: &str) -> bool {
    let body = strip_vision_marker(text);
    if body.is_empty() { return false; }
    SPECULATIVE_PURPOSE_RE.is_match(&body) || SPECULATIVE_PURPOSE_NEED_RE.is_match(&body) || SPECULATIVE_PURPOSE_MAYBE_RE.is_match(&body)
}

pub fn is_enum_listing_without_usage_reply(text: &str) -> bool {
    let body = strip_vision_marker(text);
    if body.is_empty() { return false; }
    let hits = DEFINITION_VALUE_TOKEN_RE.find_iter(&body).count();
    hits >= 2 && !has_behavior_usage_evidence_in_reply(&body)
}

static USAGE_EVIDENCE_CODE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?:if\s*\(|switch\s*\(|==|!=|===|!==)").unwrap());

static USAGE_EVIDENCE_ZH_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?:当|若|只有|满足|否则|则|时会|才会|分支|调用|更新|修改|校验|回滚|写入|改为|设置为)").unwrap()
});

static USAGE_EVIDENCE_SYMBOL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"`[A-Za-z_][\w]*`\s*(?:方法|函数|逻辑|分支)").unwrap());

static USAGE_EVIDENCE_PASCAL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?:Process|Update|Revert|Handle)[A-Za-z]+\w*").unwrap());

pub fn has_behavior_usage_evidence_in_reply(text: &str) -> bool {
    let body = strip_vision_marker(text);
    if body.is_empty() { return false; }
    USAGE_EVIDENCE_CODE_RE.is_match(&body) || USAGE_EVIDENCE_ZH_RE.is_match(&body)
        || USAGE_EVIDENCE_SYMBOL_RE.is_match(&body) || USAGE_EVIDENCE_PASCAL_RE.is_match(&body)
}

static EXPLORE_PREAMBLE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"让我在.{0,40}(?:搜索|查看|排查|定位|read|grep)").unwrap());

pub fn has_unfulfilled_explore_preamble(text: &str) -> bool {
    let body = strip_vision_marker(text);
    if body.is_empty() { return false; }
    if !EXPLORE_PREAMBLE_RE.is_match(&body) { return false; }
    is_speculative_behavior_purpose_reply(&body) || is_enum_listing_without_usage_reply(&body)
}

pub fn build_behavior_purpose_trace_hint() -> String {
    vec![
        "【行为·用途/作用】用户问字段/枚举/类型的实际用途，不是再要定义列表。",
        "grep 符号命中后须 read 引用处（if/switch/分支逻辑、调用方 handler），说明「满足何条件 -> 触发何副作用」。",
        "禁止只复述枚举值；禁止「可能...作为状态标识」「具体使用位置需要查看」等推给用户查。",
        "若已 read 到分支逻辑，须在答复中引用条件与结果（可写方法名与分支差异）。",
    ].join("")
}

pub fn build_behavior_purpose_trace_retry_hint(read_paths: &[String]) -> String {
    let listed = if read_paths.is_empty() {
        "尚未 read 任何文件。".to_string()
    } else {
        format!("已 read：{}。", read_paths.iter().rev().take(4).map(|s| s.as_str()).collect::<Vec<_>>().join("、"))
    };
    vec![
        "【行为·用途 trace 未完成】答复仍在猜测或重复枚举定义，未说明代码中的实际分支与副作用。",
        &listed,
        "请继续：grep 枚举/字段符号 -> read_file 引用处完整 if/else 或调用方 -> 再输出最终答案。",
        "禁止写「可能需要查看引用」；禁止用「可能...流程中作为标识」代替已读逻辑。",
    ].join("")
}

pub fn should_block_behavior_purpose_finalize(
    behavior_purpose: bool, consultative_read_paths: &[String], reply_text: &str,
) -> bool {
    if !behavior_purpose { return false; }
    if is_deferred_behavior_answer_reply(reply_text) { return true; }
    if has_unfulfilled_explore_preamble(reply_text) { return true; }
    if is_speculative_behavior_purpose_reply(reply_text) { return true; }
    if is_enum_listing_without_usage_reply(reply_text) { return true; }
    consultative_read_paths.len() >= 2 && !has_behavior_usage_evidence_in_reply(reply_text)
}

static SPECULATIVE_CODE_ANALYSIS_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?:根据代码|查阅了|通过\s*grep|在该文件中|代码分析)").unwrap());

static SHALLOW_STATE_INDEPENDENCE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?:两个独立|互不干扰|不会触动|只改\s*\w+|存储在不同)").unwrap());

static CITED_FILE_PATH_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?i)[`("']?((?:[\w.\/-]+)+[\w.\/-]+\.(?:vue|tsx?|jsx?|ts|cs|scss|css))[`)"']?"#).unwrap()
});

pub fn normalize_consultative_path(file_path: &str) -> String {
    file_path.replace('\\', "/").replace("./", "").trim().to_lowercase()
}

pub fn consultative_path_matches(read: &str, cited: &str) -> bool {
    let r = normalize_consultative_path(read);
    let c = normalize_consultative_path(cited);
    if r.is_empty() || c.is_empty() { return false; }
    r == c || r.ends_with(&format!("/{c}")) || c.ends_with(&format!("/{r}")) || r.ends_with(&c) || c.ends_with(&r)
}

pub fn extract_cited_file_paths(text: &str) -> Vec<String> {
    let mut paths = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for cap in CITED_FILE_PATH_RE.captures_iter(text) {
        let p = cap[1].replace('\\', "/").trim().to_string();
        if !p.is_empty() && seen.insert(p.clone()) { paths.push(p); }
    }
    paths
}

pub fn reply_cites_unread_paths(reply_text: &str, read_paths: &[String]) -> bool {
    let cited = extract_cited_file_paths(reply_text);
    if cited.is_empty() { return false; }
    if read_paths.is_empty() { return true; }
    cited.iter().any(|c| !read_paths.iter().any(|r| consultative_path_matches(r, c)))
}

fn assistant_provided_code_location_evidence(text: &str) -> bool {
    let ext_re = Regex::new(r"(?i)\.(?:vue|tsx?|jsx?|cs|scss|css)\b").unwrap();
    let css_re = Regex::new(r"(?:background|opacity|backdrop-filter|var\(--)|找到了|已定位|位于\s+`").unwrap();
    ext_re.is_match(text) || css_re.is_match(text)
}

pub fn reply_claims_code_without_tool_evidence(
    reply_text: &str, consultative_read_paths: &[String], vision_locate_tools_used: bool,
) -> bool {
    let body = strip_vision_marker(reply_text);
    if body.is_empty() { return false; }
    let cites_code = assistant_provided_code_location_evidence(&body) || SPECULATIVE_CODE_ANALYSIS_RE.is_match(&body);
    if !cites_code { return false; }
    let line_ref_re = Regex::new(r"(?:第\s*\d+\s*行|约第\s*\d+)").unwrap();
    if line_ref_re.is_match(&body) && consultative_read_paths.is_empty() { return true; }
    if SPECULATIVE_CODE_ANALYSIS_RE.is_match(&body) && !vision_locate_tools_used && consultative_read_paths.is_empty() { return true; }
    reply_cites_unread_paths(&body, consultative_read_paths)
}

pub fn is_shallow_state_independence_claim(
    reply_text: &str, consultative_read_paths: &[String], grep_patterns: &[String],
) -> bool {
    let body = strip_vision_marker(reply_text);
    if !SHALLOW_STATE_INDEPENDENCE_RE.is_match(&body) { return false; }
    let deeper_re = Regex::new(r"(?i)watch\s*\(|\.value\s*=|collapse|expand|emit\s*\(").unwrap();
    if deeper_re.is_match(&body) { return false; }
    let grep_blob = grep_patterns.join("\n");
    let grep_deeper_re = Regex::new(r"(?i)watch\s*\(|collapse|expand").unwrap();
    if grep_deeper_re.is_match(&grep_blob) { return false; }
    if consultative_read_paths.len() >= 2 {
        let has_composable = consultative_read_paths.iter().any(|p| p.contains("composables/"));
        let has_view = consultative_read_paths.iter().any(|p| p.contains("views/"));
        if has_composable && has_view { return false; }
    }
    if consultative_read_paths.len() == 1 && consultative_read_paths[0].contains("views/") { return true; }
    consultative_read_paths.is_empty()
}

static IMPLEMENT_INTENT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:帮我|请|麻烦)?(?:改|修|修复|实现|添加|新增|删除|创建|优化|调整|更新|写入|落地|开发|执行|替换|重构|改成|改为|改一下|改下|写一[个份]?|做一[个份]?|fix|implement|add\b|create\b|update\b|refactor\b)").unwrap()
});

static UI_STATE_PERSISTENCE_QUESTION_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?:切|换|切换).{0,20}(?:再|回|之后|然后).{0,20}(?:切|换|回)|(?:还会|会不会|是不是会|是否会|会不会再).{0,24}(?:再次|重新|仍然|保留|恢复|打开|关闭|展开|折叠|显示|隐藏|保持)|再次.{0,12}(?:打开|展开|显示|出现|恢复)").unwrap()
});

fn is_ui_state_persistence_question_prompt(prompt: &str) -> bool {
    let text = prompt.trim();
    if text.is_empty() { return false; }
    if IMPLEMENT_INTENT_RE.is_match(text) && !text.contains('？') && !text.contains('?') { return false; }
    UI_STATE_PERSISTENCE_QUESTION_RE.is_match(text)
}

pub fn is_ui_state_behavior_question(prompt: &str) -> bool {
    let text = prompt.trim();
    if text.is_empty() { return false; }
    if is_ui_state_persistence_question_prompt(text) { return true; }
    let ui_re = Regex::new(r"(?:切换|切到|切回).{0,24}(?:会|会不会|还会).{0,24}(?:打开|关闭|展开|折叠|显示|隐藏|恢复|保留|再次)").unwrap();
    ui_re.is_match(text)
}

pub fn should_block_consultative_ui_behavior_finalize(
    read_only_build_run: bool, prompt: &str, reply_text: &str,
    consultative_read_paths: &[String], consultative_read_failed_paths: &[String],
    vision_locate_tools_used: bool, grep_patterns: &[String],
) -> bool {
    if !read_only_build_run { return false; }
    if reply_claims_code_without_tool_evidence(reply_text, consultative_read_paths, vision_locate_tools_used) { return true; }
    if is_ui_state_behavior_question(prompt) && !vision_locate_tools_used && consultative_read_paths.is_empty() { return true; }
    if is_shallow_state_independence_claim(reply_text, consultative_read_paths, grep_patterns) { return true; }
    if !consultative_read_failed_paths.is_empty() {
        let cited = extract_cited_file_paths(reply_text);
        if cited.iter().any(|c| consultative_read_failed_paths.iter().any(|f| consultative_path_matches(f, c))) { return true; }
    }
    false
}

pub fn build_consultative_ui_behavior_trace_hint() -> String {
    vec![
        "",
        "【UI 状态·行为题】用户问切换/返回后某面板或区域是否仍展开/可见/保持原状。",
        "须 grep 可见 tab 文案或 mode/composable 符号 -> read 切换 handler -> 再 grep/read watch、collapse/expand 或 emit 副作用。",
        "禁止只断言「两个 ref 独立、互不干扰」；mode 变更时可能有 watch 主动改另一状态。",
        "行号须来自 read_file；read 失败的路径禁止引用；勿沿用会话历史中已证伪的文件路径。",
    ].join("\n")
}

pub fn build_consultative_ui_behavior_trace_retry_hint(read_paths: &[String], failed_paths: &[String]) -> String {
    let listed = if read_paths.is_empty() {
        "本轮尚未成功 read 任何文件。".to_string()
    } else {
        format!("已 read：{}。", read_paths.iter().rev().take(4).map(|s| s.as_str()).collect::<Vec<_>>().join("、"))
    };
    let failed = if failed_paths.is_empty() { String::new() }
    else { format!("read 失败路径：{}——禁止继续引用。", failed_paths.iter().rev().take(3).map(|s| s.as_str()).collect::<Vec<_>>().join("、")) };
    vec![
        "【UI 状态·trace 未完成】你在未核对副作用的情况下给出了代码结论或「独立状态」断言。",
        &listed, &failed,
        "请继续：grep tab/mode 符号 -> read 切换入口 -> grep/read watch 或 collapse/expand 调用方，再输出最终答案。",
        "若与上轮结论矛盾，须显式更正；禁止凭记忆写行号或虚构路径。",
    ].join("")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_entry_layer_path() {
        assert!(is_consultative_entry_layer_path("src/composables/useFoo.ts"));
        assert!(is_consultative_entry_layer_path("src/components/Foo.vue"));
        assert!(is_consultative_entry_layer_path("src/views/FooView.vue"));
        assert!(!is_consultative_entry_layer_path("src/services/foo.ts"));
    }

    #[test]
    fn test_backend_layer_path() {
        assert!(is_consultative_backend_layer_path("server/routes/foo.ts"));
        assert!(!is_consultative_backend_layer_path("src/composables/foo.ts"));
    }

    #[test]
    fn test_accuracy_trace_depth() {
        let paths = vec!["src/composables/useFoo.ts".into(), "server/routes/foo.ts".into()];
        assert!(has_consultative_accuracy_trace_depth(&paths));
    }

    #[test]
    fn test_deferred_answer() {
        assert!(is_deferred_behavior_answer_reply("想让我深入看一下？"));
        assert!(!is_deferred_behavior_answer_reply("这是正常的"));
    }

    #[test]
    fn test_speculative_impl() {
        assert!(is_speculative_implementation_reply("如果 prompt 构造不够准确"));
        assert!(!is_speculative_implementation_reply("已确认 prompt 包含"));
    }

    #[test]
    fn test_speculative_purpose() {
        assert!(is_speculative_behavior_purpose_reply("可能作为状态标识"));
        assert!(!is_speculative_behavior_purpose_reply("已确认用于"));
    }

    #[test]
    fn test_usage_evidence() {
        assert!(has_behavior_usage_evidence_in_reply("当条件满足时执行"));
        assert!(!has_behavior_usage_evidence_in_reply("`Value1` = 1"));
    }

    #[test]
    fn test_enum_listing() {
        assert!(is_enum_listing_without_usage_reply("枚举值：`A` = 1, `B` = 2"));
    }

    #[test]
    fn test_extract_cited_paths() {
        let r = extract_cited_file_paths("在 `src/views/Foo.vue` 中");
        assert_eq!(r, vec!["src/views/Foo.vue"]);
    }

    #[test]
    fn test_path_matches() {
        assert!(consultative_path_matches("src/views/Foo.vue", "src/views/Foo.vue"));
        assert!(consultative_path_matches("src/views/Foo.vue", "Foo.vue"));
    }

    #[test]
    fn test_cites_unread() {
        assert!(reply_cites_unread_paths("在 `src/views/Foo.vue`", &[]));
        assert!(!reply_cites_unread_paths("在 `src/views/Foo.vue`", &["src/views/Foo.vue".into()]));
    }

    #[test]
    fn test_claims_code_no_evidence() {
        assert!(reply_claims_code_without_tool_evidence("第 10 行位于 `src/Foo.vue`", &[], false));
        assert!(!reply_claims_code_without_tool_evidence("第 10 行位于 `src/Foo.vue`", &["src/Foo.vue".into()], false));
    }

    #[test]
    fn test_shallow_state() {
        assert!(is_shallow_state_independence_claim("两个独立互不干扰", &[], &[]));
        assert!(!is_shallow_state_independence_claim("两个独立互不干扰", &["src/composables/a.ts".into(), "src/views/b.vue".into()], &[]));
    }

    #[test]
    fn test_ui_behavior_question() {
        assert!(is_ui_state_behavior_question("切换 tab 会不会关闭面板"));
        assert!(!is_ui_state_behavior_question("修复这个 bug"));
    }

    #[test]
    fn test_deferred_answer_unicode() {
        assert!(is_deferred_behavior_answer_reply("要不要我深入确认一下 prompt 构造"));
    }
}
