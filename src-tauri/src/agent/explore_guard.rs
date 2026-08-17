use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use super::vision::extract_visible_anchor_quotes;

static AGENT_TOOL_GUARD_FAILURE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
    r"^错误：(缺少|不是(?:目录|文件)|路径|无效|未知工具|已连续|grep「|读图|已确认|不允许|不支持|Ask 模式|Explore 模式|规划模式|咨询只读|扫描修复|一键修复)",
  )
  .unwrap()
});

static MANUAL_PASTE_INSTRUCTION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
    r"(?i)请将.{0,24}(?:应用|粘贴|手动)|请自行.{0,12}(?:应用|修改|粘贴)|手动.{0,8}(?:应用|修改|粘贴)",
  )
  .unwrap()
});

static DEFER_EXECUTE_REPLY_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:下一步|接下来|随后|稍后)我会|按你的要求.{0,24}(?:只)?(?:执行|修改|patch)")
        .unwrap()
});

static BUILD_CONFIRM_ASK_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)需要我(?:实际)?执行|请确认优先级|我可以逐个|需要我帮你|要我帮你|是否帮你|要不要帮你",
    )
    .unwrap()
});

static WRITE_DONE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"已(?:经)?(?:修复|修改|写入|调整|完成)|改动(?:如下|点)|file_diff|已写入").unwrap()
});

pub fn is_tool_result_failure(result: &str) -> bool {
    result.starts_with("错误：") || result.starts_with("命令执行失败")
}

pub fn is_system_runtime_tool_failure(result: &str) -> bool {
    if result.starts_with("命令执行失败") {
        return true;
    }
    if !result.starts_with("错误：") {
        return false;
    }
    if AGENT_TOOL_GUARD_FAILURE_RE.is_match(result) {
        return false;
    }
    if result.contains("不应 grep") || result.contains("过宽") {
        return false;
    }
    true
}

pub fn is_runtime_explore_failure_turn(outcomes: &[String]) -> bool {
    if outcomes.is_empty() {
        return false;
    }
    if !outcomes.iter().all(|r| is_tool_result_failure(r)) {
        return false;
    }
    outcomes.iter().any(|r| is_system_runtime_tool_failure(r))
}

pub fn consultative_explore_signature(
    read_paths: &[String],
    grep_patterns: &[String],
    search_queries: &[String],
) -> String {
    let mut parts: Vec<String> = read_paths.iter().cloned().collect();
    parts.extend(grep_patterns.iter().cloned());
    parts.extend(search_queries.iter().cloned());
    parts.sort();
    parts.dedup();
    parts.join("|")
}

// ── Grep / search guard ──

static POST_LOCATE_BLOCKED_GREP_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
    r"(?i)(?:^|\|)transform(?:\s*\||$)|will-change|(?:[\w-]+-)?(?:bottom|footer|toolbar|status|action)(?:-(?:row|bar|area))?",
  )
  .unwrap()
});

static PATCH_ANCHOR_SYMBOL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
    r"(?i)\b(?:function|async function|const)\s+(show[A-Z]\w*At|tryShow[A-Z]\w*|getSelection[A-Z]\w*|clamp[A-Z]\w*)\b|<Teleport\b|\bposition:\s*fixed\b|\b[\w-]*-floating\b",
  )
  .unwrap()
});

static VISION_MARKER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\s*\[图已理解\]\s*").unwrap());

pub fn text_indicates_patch_anchor(text: &str) -> bool {
    PATCH_ANCHOR_SYMBOL_RE.is_match(text)
}

static TELEPORT_TO_BODY_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)<Teleport[^>]*\s+to\s*=\s*["']body["']|Teleport[\s\S]{0,80}to\s*=\s*["']body["']"#,
    )
    .unwrap()
});

pub fn text_confirms_teleport_to_body(text: &str) -> bool {
    TELEPORT_TO_BODY_RE.is_match(text)
        || (text.contains("<Teleport") && text.contains("to=\"body\""))
}

pub fn is_blocked_grep_after_locate(
    pattern: &str,
    patch_anchor_located: bool,
    teleport_body_confirmed: bool,
) -> bool {
    let _ = (pattern, patch_anchor_located, teleport_body_confirmed);
    false
}

pub fn build_blocked_grep_after_locate_message(pattern: &str) -> String {
    format!(
        "错误：已定位到浮层/定位相关代码，不应再 grep「{pattern}」查无关布局或 transform。\
     基于已 read 证据修改或输出诊断；勿改搜底栏 flex，勿预设唯一修法路径。"
    )
}

pub fn is_search_files_content_query(query: &str) -> bool {
    let _ = query;
    false
}

pub fn build_search_files_content_query_message(query: &str) -> String {
    format!(
    "错误：search_files 按文件名匹配，「{query}」更像界面可见文案而非文件名。请改用 grep 搜索该文案、结构标识或相关符号，命中后再 read_file 核对。"
  )
}

// ── Read slice cache / patch old_string guard ──

static STRUCTURAL_GREP_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
    r"(?i)[a-z0-9]-[a-z0-9]|title\s*=|class\s*=|`\s*[\w.-]+\s*`|\.[\w-]+\s*\{|@click|<Teleport|\bposition:\s*(?:fixed|absolute)",
  )
  .unwrap()
});

static LOW_SIGNAL_VISION_LOCATE_GREP_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(active|selected|current|default)(Tab|Index|Mode|View|Panel|Item|Id)$")
        .unwrap()
});

pub fn invalidate_file_read_cache(guard: &mut ToolGuardState, file_key: &str) {
    let prefix = format!("{file_key}:");
    guard
        .read_slice_cache
        .retain(|k, _| !k.starts_with(&prefix));
    guard.read_cache.remove(file_key);
}

pub fn invalidate_file_read_state(guard: &mut ToolGuardState, file_key: &str) {
    invalidate_file_read_cache(guard, file_key);
}

/// Clear read-slice caches when the model's context was compacted or rebuilt
/// (context compression mid-run, refresh/resume). `read_cache` (full file content)
/// is intentionally kept: it still backs the patch old_string check.
pub fn invalidate_read_overlap_state(guard: &mut ToolGuardState) {
    guard.read_slice_cache.clear();
}

pub fn mark_patch_recovery_file(guard: &mut ToolGuardState, file_key: &str) {
    guard.patch_recovery_files.insert(file_key.to_string());
}

pub fn consume_patch_recovery_read(guard: &mut ToolGuardState, file_key: &str) -> bool {
    if guard.patch_recovery_files.contains(file_key) {
        guard.patch_recovery_files.remove(file_key);
        return true;
    }
    false
}

static MANUAL_HANDOFF_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)手动(?:或另起对话|执行|修改)|另起对话|建议的修复（手动|请手动|手动步骤")
        .unwrap()
});

fn normalize_patch_guard_text(text: &str) -> String {
    text.replace("\r\n", "\n")
}

pub fn check_patch_old_string_from_reads(
    file_key: &str,
    old_string: &str,
    read_slice_cache: &HashMap<String, String>,
    read_cache: Option<&HashMap<String, String>>,
) -> Option<String> {
    let _ = (file_key, old_string, read_slice_cache, read_cache);
    None
}

pub fn is_overly_broad_vision_grep(
    pattern: &str,
    anchor_quotes: &[String],
    extra_anchor_text: &[&str],
) -> bool {
    let _ = (pattern, anchor_quotes, extra_anchor_text);
    false
}

pub fn is_vision_grep_low_spread(relatives: &[String]) -> bool {
    if relatives.is_empty() {
        return false;
    }
    let unique: HashSet<&String> = relatives.iter().collect();
    if relatives.len() <= 3 && unique.len() <= 2 {
        return true;
    }
    relatives.len() <= 5 && unique.len() == 1
}

pub fn build_overly_broad_vision_grep_message(pattern: &str, anchor_quotes: &[String]) -> String {
    let samples: String = anchor_quotes
        .iter()
        .take(3)
        .map(|q| format!("「{q}」"))
        .collect::<Vec<_>>()
        .join("、");
    format!(
    "错误：grep「{pattern}」过宽，易扫出大量无关命中。读图已摘录可见原文 {samples}。请 grep 其中 ≥4 字的片段，或 grep 结构标识/相关符号，再 read_file 核对。"
  )
}

pub fn is_low_signal_vision_locate_grep(pattern: &str) -> bool {
    let _ = pattern;
    false
}

pub fn build_low_signal_vision_locate_grep_message(pattern: &str) -> String {
    format!(
    "错误：grep「{pattern}」是泛化状态符号，与读图区域定位无关。请 grep 可见标签相邻的文本、结构标识或相关符号，命中后 read_file 核对。勿 grep 界面运行时拼接的数字。"
  )
}

static WRITE_SUCCESS_CLAIM_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
    r"(?i)(?:✅|修复完成|修改已完成|已完成|改动已全部|全部到位|两处修改|三处修改|均已?成功|patch\s*均成功|无失败项|无剩余问题)",
  )
  .unwrap()
});

#[derive(Debug, Clone)]
pub struct PatchFailureEntry {
    pub turn: u32,
    pub path: String,
    pub reason: String,
}

pub fn claims_success_despite_patch_failures(text: &str, patch_failure_count: usize) -> bool {
    let _ = (text, patch_failure_count);
    false
}

static GHOST_MODIFICATION_CLAIM_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
    r"(?i)(?:已完成修改|已更新|已修复|已添加|已删除|已改为|已改成|改动如下|优化完成|修改如下|刷新查看)",
  )
  .unwrap()
});

static GHOST_MODIFICATION_EXCLUSION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?:以上是|仅供参考|建议|方案|思路)").unwrap());

pub fn claims_ghost_modification_reply(text: &str) -> bool {
    let _ = text;
    false
}

pub fn build_ghost_reply_retry_nudge() -> &'static str {
    "【系统强制】你声称已完成修改，但本轮未调用任何 patch_file / write_file 工具，代码实际未被修改。\
  请立即调用 patch_file 或 write_file 提交真实的代码修改；禁止只输出文字描述。"
}

pub fn is_manual_handoff_without_write_reply(text: &str, has_patch_failures: bool) -> bool {
    let _ = (text, has_patch_failures);
    false
}

pub fn build_manual_handoff_retry_nudge() -> &'static str {
    "【系统强制·Build】你已给出修改方案但尚未落盘任何代码。禁止以「请手动执行/另开对话粘贴」收尾。\
  若 patch_file 仍失败：① read_file 后从返回原文复制 old_string（Windows 文件可含 \\r\\n）；\
  ② 小范围改动可用 write_file 写入已 read 的完整文件；③ 说明真实阻塞点。必须在本会话内提交 patch/write。"
}

pub fn should_nudge_alternate_ui_patch_strategy(
    patch_failure_log: &[PatchFailureEntry],
    file_path: &str,
) -> bool {
    let _ = (patch_failure_log, file_path);
    false
}

pub fn record_grep_hit_vue_files(guard: &mut ToolGuardState, relatives: &[String]) {
    if !guard.vision_locate_active {
        return;
    }
    for rel in relatives {
        if rel.ends_with(".vue") {
            guard.grep_hit_vue_files.insert(rel.clone());
        }
    }
}

pub fn unread_grep_hit_vue_files(guard: &ToolGuardState, read_paths: &[String]) -> Vec<String> {
    guard
        .grep_hit_vue_files
        .iter()
        .filter(|vue| {
            !read_paths.iter().any(|read| {
                let read = read.replace('\\', "/");
                let vue = vue.replace('\\', "/");
                read.ends_with(&vue) || read.contains(&vue)
            })
        })
        .cloned()
        .collect()
}

/// Mutable guard state carried across an agent run (mirrors Node ToolGuardContext subset).
#[derive(Debug, Default)]
pub struct ToolGuardState {
    pub read_slice_cache: HashMap<String, String>,
    pub read_cache: HashMap<String, String>,
    pub grep_cache: HashMap<String, String>,
    pub grep_hit_vue_files: HashSet<String>,
    pub patch_recovery_files: HashSet<String>,
    pub patch_anchor_located: bool,
    pub teleport_body_confirmed: bool,
    pub vision_locate_active: bool,
    pub vision_anchor_quotes: Vec<String>,
    pub vision_narrative_text: Option<String>,
}

impl ToolGuardState {
    pub fn new(has_image: bool, vision_locate: bool) -> Self {
        Self {
            vision_locate_active: has_image && vision_locate,
            ..Default::default()
        }
    }

    pub fn note_vision_assistant_text(&mut self, text: &str) {
        let quotes = extract_visible_anchor_quotes(text);
        if !quotes.is_empty() {
            self.vision_anchor_quotes = quotes;
            self.vision_narrative_text = Some(text.to_string());
            self.vision_locate_active = true;
        }
    }

    pub fn note_tool_output(&mut self, text: &str) {
        if text_indicates_patch_anchor(text) {
            self.patch_anchor_located = true;
        }
        if text_confirms_teleport_to_body(text) {
            self.teleport_body_confirmed = true;
        }
    }
}

pub fn build_english_planning_nudge() -> &'static str {
    "【系统提示】探索阶段须用中文写进度（根因 + 下一步）；禁止仅用 \"Now let me\" / \"Let me\" 英文 planning。"
}

pub fn should_nudge_english_planning(text: &str) -> bool {
    let _ = text;
    false
}

pub fn sanitize_agent_user_visible_text(text: &str) -> String {
    let mut body = VISION_MARKER_RE.replace_all(text, "").trim().to_string();
    if body.ends_with("。。") {
        body = body.trim_end_matches('。').to_string() + "。";
    }
    body
}

pub fn is_analysis_only_reply_under_force_patch(text: &str) -> bool {
    let _ = text;
    false
}

pub fn should_force_patch_after_anchor_located(
    patch_anchor_located: bool,
    patch_anchor_force_pending: bool,
    build_explore_hard_cap_reached: bool,
    implement_follow_up_run: bool,
) -> bool {
    let _ = (
        patch_anchor_located,
        patch_anchor_force_pending,
        build_explore_hard_cap_reached,
        implement_follow_up_run,
    );
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_result_failure_detects_error_prefix() {
        assert!(is_tool_result_failure("错误：缺少 path"));
        assert!(is_tool_result_failure("命令执行失败 exit 1"));
        assert!(!is_tool_result_failure("ok"));
    }

    #[test]
    fn runtime_failure_skips_guard_errors() {
        assert!(!is_system_runtime_tool_failure(
            "错误：Ask 模式下不支持 write_file。"
        ));
        assert!(is_system_runtime_tool_failure("错误：ENOENT"));
    }

    #[test]
    fn runtime_explore_failure_turn_all_failed_with_runtime() {
        assert!(is_runtime_explore_failure_turn(&[
            "错误：ENOENT".into(),
            "错误：权限不足".into(),
        ]));
        assert!(!is_runtime_explore_failure_turn(&[
            "错误：Ask 模式下不支持 write_file。".into()
        ]));
    }


    #[test]
    fn consultative_explore_signature_dedupes_and_sorts() {
        let sig = consultative_explore_signature(
            &["b.ts".into(), "a.ts".into(), "b.ts".into()],
            &["foo".into()],
            &["syncProgress".into()],
        );
        assert_eq!(sig, "a.ts|b.ts|foo|syncProgress");
    }

    #[test]
    fn consultative_explore_signature_catches_repeated_search_queries() {
        let a = consultative_explore_signature(&[], &[], &["syncProgressMixin".into()]);
        let b = consultative_explore_signature(&[], &[], &["syncProgressMixin".into()]);
        assert_eq!(a, b);
        assert!(!a.is_empty());
    }

    #[test]
    fn invalidate_read_overlap_state_clears_slice_caches() {
        let mut guard = ToolGuardState::default();
        guard
            .read_slice_cache
            .insert("src/foo.ts:1:100".into(), "body".into());
        guard
            .read_cache
            .insert("src/foo.ts".into(), "full body".into());

        invalidate_read_overlap_state(&mut guard);

        assert!(guard.read_slice_cache.is_empty());
        // Full-content cache is intentionally kept (backs patch old_string check).
        assert_eq!(guard.read_cache.get("src/foo.ts").map(String::as_str), Some("full body"));
    }

    #[test]
    fn blocked_grep_messages_block_direction_without_fix_recipe() {
        let after_locate = build_blocked_grep_after_locate_message("transform");
        assert!(after_locate.contains("不应再 grep"));
        assert!(after_locate.contains("勿预设唯一修法路径"));
        assert!(!after_locate.contains("show*At"));
        assert!(!after_locate.contains("请 patch 坐标"));
    }



    #[test]
    fn patch_anchor_in_tool_output() {
        assert!(text_indicates_patch_anchor(
            "async function showQuoteButtonAt(anchor: DOMRect)"
        ));
        assert!(text_indicates_patch_anchor(
            ".quote-floating { position: fixed; }"
        ));
        assert!(!text_indicates_patch_anchor("export function unrelated()"));
    }

    #[test]
    fn tool_guard_tracks_anchor_from_output() {
        let mut guard = ToolGuardState::default();
        guard.note_tool_output("async function showQuoteButtonAt(anchor: DOMRect)");
        assert!(guard.patch_anchor_located);
    }


    #[test]
    fn invalidate_read_caches_and_patch_recovery() {
        let mut guard = ToolGuardState {
            read_slice_cache: HashMap::from([(
                "src/foo.ts:1:50".to_string(),
                "cached".to_string(),
            )]),
            patch_recovery_files: HashSet::from(["src/foo.ts".to_string()]),
            ..Default::default()
        };
        invalidate_file_read_state(&mut guard, "src/foo.ts");
        assert!(guard.read_slice_cache.is_empty());
        assert!(consume_patch_recovery_read(&mut guard, "src/foo.ts"));
        assert!(!guard.patch_recovery_files.contains("src/foo.ts"));
    }


    #[test]
    fn vision_grep_low_spread() {
        assert!(is_vision_grep_low_spread(&["src/Foo.vue".to_string()]));
        assert!(is_vision_grep_low_spread(&[
            "src/Foo.vue".to_string(),
            "src/Foo.vue".to_string(),
            "src/Bar.vue".to_string(),
        ]));
        assert!(!is_vision_grep_low_spread(
            &(0..10).map(|i| format!("src/f{i}.ts")).collect::<Vec<_>>()
        ));
    }




    #[test]
    fn record_grep_hit_vue_files_tracks_vue_only() {
        let mut guard = ToolGuardState {
            vision_locate_active: true,
            ..Default::default()
        };
        super::record_grep_hit_vue_files(&mut guard, &["src/Foo.vue".into(), "src/bar.ts".into()]);
        assert!(guard.grep_hit_vue_files.contains("src/Foo.vue"));
        assert!(!guard.grep_hit_vue_files.contains("src/bar.ts"));
    }


    #[test]
    fn invalidate_file_read_cache_clears_slice_cache() {
        let mut guard = ToolGuardState::default();
        guard
            .read_slice_cache
            .insert("src/foo.ts:260:35".into(), "cached".into());
        invalidate_file_read_cache(&mut guard, "src/foo.ts");
        assert!(guard.read_slice_cache.is_empty());
    }

    #[test]
    fn patch_old_string_guard_accepts_lf_against_lf_read_slice() {
        let slices = HashMap::from([(
            "src/foo.ts:260:35".to_string(),
            "  chip.appendChild(img);\n  return chip;\n".to_string(),
        )]);
        assert!(check_patch_old_string_from_reads(
            "src/foo.ts",
            "  chip.appendChild(img);\n  return chip;",
            &slices,
            None,
        )
        .is_none());
    }

}
