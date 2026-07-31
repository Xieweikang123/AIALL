use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use super::vision::{extract_visible_anchor_quotes, suggests_embedded_layout_misread};

static AGENT_TOOL_GUARD_FAILURE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
    r"^错误：(缺少|不是(?:目录|文件)|路径|无效|未知工具|请先 read_file|已连续|grep「|读图|已确认|不允许|不支持|Ask 模式|Explore 模式|规划模式|咨询只读|扫描修复|一键修复)",
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
    if result.contains("不应 grep") || result.contains("过宽") || result.contains("高度重叠")
    {
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

pub fn consultative_explore_signature(read_paths: &[String], grep_patterns: &[String]) -> String {
    let mut parts: Vec<String> = read_paths.iter().cloned().collect();
    parts.extend(grep_patterns.iter().cloned());
    parts.sort();
    parts.dedup();
    parts.join("|")
}

// ── Read overlap guard (ported from server/agentExploreGuard.ts) ──

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReadLineRange {
    pub start: u32,
    pub end: u32,
}

pub const MAX_OVERLAPPING_READ_ATTEMPTS: u32 = 2;
pub const OVERLAP_READ_LINE_MARGIN: u32 = 30;

pub fn read_line_range_from_args(offset: u32, limit: u32) -> ReadLineRange {
    let start = offset.max(1);
    let end = start + limit.max(1) - 1;
    ReadLineRange { start, end }
}

pub fn read_ranges_overlap(a: ReadLineRange, b: ReadLineRange) -> bool {
    let a_start = a.start.saturating_sub(OVERLAP_READ_LINE_MARGIN);
    let a_end = a.end.saturating_add(OVERLAP_READ_LINE_MARGIN);
    let b_start = b.start.saturating_sub(OVERLAP_READ_LINE_MARGIN);
    let b_end = b.end.saturating_add(OVERLAP_READ_LINE_MARGIN);
    a_start <= b_end && b_start <= a_end
}

pub fn check_overlapping_read(
    file_path: &str,
    range: ReadLineRange,
    prior_ranges: &HashMap<String, Vec<ReadLineRange>>,
) -> Option<String> {
    let existing = prior_ranges.get(file_path)?;
    let mut overlap_hits = 0u32;
    for prior in existing {
        if read_ranges_overlap(range, *prior) {
            overlap_hits += 1;
        }
    }
    if overlap_hits >= MAX_OVERLAPPING_READ_ATTEMPTS {
        Some(format!(
      "错误：{file_path} 行 {}–{} 与已读片段高度重叠（第 {} 次），请基于已有内容 patch_file，或一次读取更大范围（300-500 行）再查找，勿用小窗口反复 read_file。",
      range.start,
      range.end,
      overlap_hits + 1
    ))
    } else {
        None
    }
}

pub fn record_read_range(
    file_key: &str,
    range: ReadLineRange,
    prior_ranges: &mut HashMap<String, Vec<ReadLineRange>>,
) {
    prior_ranges
        .entry(file_key.to_string())
        .or_default()
        .push(range);
}

// ── Grep / search guard ──

static VISION_MISREAD_BLOCKED_GREP_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
    r"(?i)(?:[\w-]+-)?(?:bottom|footer|toolbar|status|action)(?:-(?:row|bar|area))?|(?:layout|container)-(?:bottom|footer)|transform\s*\|\s*will-change",
  )
  .unwrap()
});

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

pub fn is_blocked_grep_after_vision_misread(pattern: &str, vision_misread_active: bool) -> bool {
    vision_misread_active && VISION_MISREAD_BLOCKED_GREP_RE.is_match(pattern.trim())
}

pub fn is_blocked_grep_after_locate(
    pattern: &str,
    patch_anchor_located: bool,
    teleport_body_confirmed: bool,
) -> bool {
    if !patch_anchor_located && !teleport_body_confirmed {
        return false;
    }
    let p = pattern.trim();
    if POST_LOCATE_BLOCKED_GREP_RE.is_match(p) {
        return true;
    }
    teleport_body_confirmed
        && Regex::new(r"(?i)\btransform\b")
            .map(|re| re.is_match(p))
            .unwrap_or(false)
}

pub fn build_blocked_grep_message(pattern: &str) -> String {
    format!(
    "错误：读图已判定控件更可能是浮层/绝对定位错位，不应 grep「{pattern}」去查底栏/流式布局。\
     请改用与浮层/定位相关的结构符号检索（如 position、portal/Teleport、浮层 class），再 read 核对后再改；勿预设具体修法。"
  )
}

pub fn build_blocked_grep_after_locate_message(pattern: &str) -> String {
    format!(
        "错误：已定位到浮层/定位相关代码，不应再 grep「{pattern}」查无关布局或 transform。\
     基于已 read 证据修改或输出诊断；勿改搜底栏 flex，勿预设唯一修法路径。"
    )
}

pub fn is_search_files_content_query(query: &str) -> bool {
    let q = query.trim();
    if q.is_empty() {
        return false;
    }
    let has_cjk = q.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c));
    let has_latin_token = Regex::new(r"[a-zA-Z][\w.-]{1,}")
        .map(|re| re.is_match(q))
        .unwrap_or(false);
    has_cjk && !has_latin_token
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
    guard
        .read_slice_repeat_counts
        .retain(|k, _| !k.starts_with(&prefix));
    guard.read_cache.remove(file_key);
}

pub fn invalidate_file_read_state(guard: &mut ToolGuardState, file_key: &str) {
    invalidate_file_read_cache(guard, file_key);
    guard.read_file_ranges.remove(file_key);
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
    let prefix = format!("{file_key}:");
    let mut chunks: Vec<&str> = read_slice_cache
        .iter()
        .filter(|(k, _)| k.starts_with(&prefix))
        .map(|(_, v)| v.as_str())
        .collect();
    if let Some(full) = read_cache.and_then(|c| c.get(file_key)) {
        chunks.push(full.as_str());
    }
    if chunks.is_empty() {
        return None;
    }
    let combined = chunks.join("\n");
    let normalized_old = normalize_patch_guard_text(old_string);
    if combined.contains(old_string)
        || normalize_patch_guard_text(&combined).contains(&normalized_old)
    {
        return None;
    }
    Some(format!(
    "错误：old_string 未出现在你对 {file_key} 的已读片段中，禁止凭记忆构造。请从已读输出中复制更短且唯一的片段作为 old_string；若仍缺上下文，read_file 更大范围（300–500 行）后从返回原文复制再 patch。"
  ))
}

pub fn is_overly_broad_vision_grep(
    pattern: &str,
    anchor_quotes: &[String],
    extra_anchor_text: &[&str],
) -> bool {
    let mut all_sources: Vec<String> = anchor_quotes.to_vec();
    for t in extra_anchor_text {
        let trimmed = t.trim();
        if !trimmed.is_empty() {
            all_sources.push(trimmed.to_string());
        }
    }
    if all_sources.is_empty() {
        return false;
    }
    let p = pattern.trim();
    if p.is_empty() {
        return false;
    }
    if STRUCTURAL_GREP_RE.is_match(p) {
        return false;
    }
    let compact: String = p.chars().filter(|c| !c.is_whitespace()).collect();
    let compact_len = compact.chars().count();
    if compact_len >= 4 {
        for quote in &all_sources {
            if quote.contains(p) || p.contains(quote.as_str()) {
                return false;
            }
            let probe_len = compact_len.min(8);
            let probe: String = compact.chars().take(probe_len).collect();
            if compact_len >= 4 && quote.contains(&probe) {
                return false;
            }
        }
    }
    if compact_len < 4 {
        return true;
    }
    Regex::new(r"^[\u4e00}-\u9fff|｜\s]+$")
        .map(|re| re.is_match(p) && p.chars().count() <= 8)
        .unwrap_or(false)
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
    let p = pattern.trim();
    if p.is_empty() || STRUCTURAL_GREP_RE.is_match(p) {
        return false;
    }
    LOW_SIGNAL_VISION_LOCATE_GREP_RE.is_match(p)
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
    if patch_failure_count == 0 {
        return false;
    }
    let body = sanitize_agent_user_visible_text(text);
    if body.is_empty() {
        return false;
    }
    WRITE_SUCCESS_CLAIM_RE.is_match(&body) || super::finish_gate::claims_premature_completion(&body)
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
    let body = sanitize_agent_user_visible_text(text);
    if body.is_empty() {
        return false;
    }
    GHOST_MODIFICATION_CLAIM_RE.is_match(&body) && !GHOST_MODIFICATION_EXCLUSION_RE.is_match(&body)
}

pub fn build_ghost_reply_retry_nudge() -> &'static str {
    "【系统强制】你声称已完成修改，但本轮未调用任何 patch_file / write_file 工具，代码实际未被修改。\
  请立即调用 patch_file 或 write_file 提交真实的代码修改；禁止只输出文字描述。"
}

pub fn is_manual_handoff_without_write_reply(text: &str, has_patch_failures: bool) -> bool {
    let body = sanitize_agent_user_visible_text(text);
    if body.is_empty() {
        return false;
    }
    if MANUAL_PASTE_INSTRUCTION_RE.is_match(&body) || MANUAL_HANDOFF_RE.is_match(&body) {
        return true;
    }
    if has_patch_failures
        && body.contains("```")
        && (body.contains("未成功")
            || body.contains("阻塞")
            || body.contains("建议的修复")
            || body.contains("手动或另"))
        && !WRITE_DONE_RE.is_match(&body)
    {
        return true;
    }
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
    let failures: Vec<_> = patch_failure_log
        .iter()
        .filter(|entry| entry.path == file_path)
        .collect();
    if failures.len() < 2 {
        return false;
    }
    failures.iter().all(|entry| {
        Regex::new(r"(?i)old_string|未出现|未匹配|禁止凭记忆")
            .map(|re| re.is_match(&entry.reason))
            .unwrap_or(false)
    })
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

pub fn require_prior_read(
    read_paths: &HashSet<String>,
    relative: &str,
    exists_on_disk: bool,
) -> Option<String> {
    if !exists_on_disk {
        return None;
    }
    if read_paths.contains(relative) {
        return None;
    }
    Some(format!(
        "错误：请先 read_file 核对 {relative} 的真实内容，再修改该文件"
    ))
}

/// Mutable guard state carried across an agent run (mirrors Node ToolGuardContext subset).
#[derive(Debug, Default)]
pub struct ToolGuardState {
    pub read_file_ranges: HashMap<String, Vec<ReadLineRange>>,
    pub read_slice_cache: HashMap<String, String>,
    pub read_slice_repeat_counts: HashMap<String, u32>,
    pub read_cache: HashMap<String, String>,
    pub grep_cache: HashMap<String, String>,
    pub read_paths: HashSet<String>,
    pub grep_hit_vue_files: HashSet<String>,
    pub patch_recovery_files: HashSet<String>,
    pub vision_misread_active: bool,
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
        if suggests_embedded_layout_misread(text) {
            self.vision_misread_active = true;
        }
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
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    let lower = trimmed.to_lowercase();
    if lower.starts_with("now let me") || lower.starts_with("let me") {
        let chinese_count = trimmed
            .chars()
            .filter(|c| ('\u{4e00}'..='\u{9fff}').contains(c))
            .count();
        return chinese_count < 6;
    }
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
    let body = sanitize_agent_user_visible_text(text);
    if body.is_empty() {
        return true;
    }
    if MANUAL_PASTE_INSTRUCTION_RE.is_match(&body) {
        return true;
    }
    if DEFER_EXECUTE_REPLY_RE.is_match(&body) && !WRITE_DONE_RE.is_match(&body) {
        return true;
    }
    if BUILD_CONFIRM_ASK_RE.is_match(&body) && !WRITE_DONE_RE.is_match(&body) {
        return true;
    }
    if Regex::new(r"(?i)修复方案|以下是具体修改|###\s*修改|建议改造方案")
        .unwrap()
        .is_match(&body)
        && body.contains("```")
        && !WRITE_DONE_RE.is_match(&body)
    {
        return true;
    }
    if WRITE_DONE_RE.is_match(&body) {
        return false;
    }
    Regex::new(
        r"(?i)截图|读图|图已理解|核心问题|根因|getSelection|getClientRects|position:\s*fixed",
    )
    .unwrap()
    .is_match(&body)
        && !Regex::new(r"(?i)patch_file|write_file|已修改|已修复|改动如下|diff")
            .unwrap()
            .is_match(&body)
}

pub fn should_force_patch_after_anchor_located(
    patch_anchor_located: bool,
    patch_anchor_force_pending: bool,
    build_explore_hard_cap_reached: bool,
    implement_follow_up_run: bool,
) -> bool {
    if implement_follow_up_run
        && (patch_anchor_force_pending || patch_anchor_located || build_explore_hard_cap_reached)
    {
        return true;
    }
    if !patch_anchor_located {
        return false;
    }
    patch_anchor_force_pending || build_explore_hard_cap_reached
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
    fn analysis_only_reply_under_force_patch() {
        let analysis =
            "核心问题：getSelectionAnchorRect 坐标异常，getClientRects 可能不对 [图已理解]";
        assert!(is_analysis_only_reply_under_force_patch(analysis));
        assert!(!is_analysis_only_reply_under_force_patch(
            "已修复 getSelectionAnchorRect，改动如下：…"
        ));
        assert!(is_analysis_only_reply_under_force_patch(
            "请将这两处修改应用到 src/views/VibeCodingView.vue"
        ));
        assert!(is_analysis_only_reply_under_force_patch(
            "需要我实际执行这些修改吗？请确认优先级。"
        ));
    }

    #[test]
    fn force_patch_after_anchor_located() {
        assert!(should_force_patch_after_anchor_located(
            true, true, false, false
        ));
        assert!(should_force_patch_after_anchor_located(
            true, false, true, false
        ));
        assert!(!should_force_patch_after_anchor_located(
            true, false, false, false
        ));
        assert!(!should_force_patch_after_anchor_located(
            false, true, true, false
        ));
        assert!(should_force_patch_after_anchor_located(
            false, true, false, true
        ));
    }

    #[test]
    fn consultative_explore_signature_dedupes_and_sorts() {
        let sig = consultative_explore_signature(
            &["b.ts".into(), "a.ts".into(), "b.ts".into()],
            &["foo".into()],
        );
        assert_eq!(sig, "a.ts|b.ts|foo");
    }

    #[test]
    fn read_ranges_overlap_detects_high_share() {
        let a = read_line_range_from_args(1270, 30);
        let b = read_line_range_from_args(1270, 80);
        assert!(read_ranges_overlap(a, b));
    }

    #[test]
    fn overlapping_read_blocks_third_overlap() {
        let mut ranges = HashMap::new();
        let a = read_line_range_from_args(1270, 30);
        let b = read_line_range_from_args(1270, 80);
        record_read_range("src/foo.ts", a, &mut ranges);
        record_read_range("src/foo.ts", b, &mut ranges);
        let err =
            check_overlapping_read("src/foo.ts", read_line_range_from_args(1280, 40), &ranges);
        assert!(err.is_some());
        assert!(err.unwrap().contains("高度重叠"));
    }

    #[test]
    fn blocked_grep_after_vision_misread() {
        assert!(is_blocked_grep_after_vision_misread(
            "chat-action-row|chat-status-row",
            true
        ));
        assert!(!is_blocked_grep_after_vision_misread(
            "quote-floating",
            true
        ));
        assert!(!is_blocked_grep_after_vision_misread(
            "chat-action-row",
            false
        ));
    }

    #[test]
    fn blocked_grep_messages_block_direction_without_fix_recipe() {
        let misread = build_blocked_grep_message("chat-action-row");
        assert!(misread.contains("不应 grep"));
        assert!(misread.contains("勿预设具体修法"));
        assert!(!misread.contains("show*At"));
        assert!(!misread.contains("请 patch"));

        let after_locate = build_blocked_grep_after_locate_message("transform");
        assert!(after_locate.contains("不应再 grep"));
        assert!(after_locate.contains("勿预设唯一修法路径"));
        assert!(!after_locate.contains("show*At"));
        assert!(!after_locate.contains("请 patch 坐标"));
    }

    #[test]
    fn blocked_grep_after_locate() {
        assert!(is_blocked_grep_after_locate("transform", false, true));
        assert!(is_blocked_grep_after_locate("chat-action-row", true, false));
        assert!(!is_blocked_grep_after_locate("quote-floating", true, false));
    }

    #[test]
    fn search_files_content_query() {
        assert!(is_search_files_content_query("会话列表"));
        assert!(!is_search_files_content_query("SessionList.vue"));
        assert!(!is_search_files_content_query("file-panel"));
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
    fn patch_old_string_must_appear_in_read_slices() {
        let mut slices = HashMap::new();
        slices.insert(
            "src/foo.ts:1:200".to_string(),
            ".real { color: red; }\n".to_string(),
        );
        assert!(check_patch_old_string_from_reads(
            "src/foo.ts",
            ".real { color: red; }",
            &slices,
            None
        )
        .is_none());
        let err =
            check_patch_old_string_from_reads("src/foo.ts", ".fake { gap: 1px; }", &slices, None);
        assert!(err.is_some());
        assert!(err
            .unwrap()
            .contains("未出现在你对 src/foo.ts 的已读片段中"));
    }

    #[test]
    fn invalidate_read_caches_and_patch_recovery() {
        let mut guard = ToolGuardState {
            read_slice_cache: HashMap::from([(
                "src/foo.ts:1:50".to_string(),
                "cached".to_string(),
            )]),
            read_slice_repeat_counts: HashMap::from([("src/foo.ts:1:50".to_string(), 2)]),
            read_file_ranges: HashMap::from([(
                "src/foo.ts".to_string(),
                vec![read_line_range_from_args(1, 50)],
            )]),
            patch_recovery_files: HashSet::from(["src/foo.ts".to_string()]),
            ..Default::default()
        };
        invalidate_file_read_state(&mut guard, "src/foo.ts");
        assert!(guard.read_slice_cache.is_empty());
        assert!(guard.read_slice_repeat_counts.is_empty());
        assert!(!guard.read_file_ranges.contains_key("src/foo.ts"));
        assert!(consume_patch_recovery_read(&mut guard, "src/foo.ts"));
        assert!(!guard.patch_recovery_files.contains("src/foo.ts"));
    }

    #[test]
    fn overly_broad_vision_grep() {
        let anchors = vec![
            "多会话同时进行，好实现吗？".to_string(),
            "今天·14条".to_string(),
        ];
        assert!(is_overly_broad_vision_grep("会话", &anchors, &[]));
        assert!(!is_overly_broad_vision_grep(
            "多会话同时进行",
            &anchors,
            &[]
        ));
        assert!(!is_overly_broad_vision_grep("session-item", &anchors, &[]));
        let narrative = ["底部有虚线边框的「打开新项目」按钮"];
        assert!(!is_overly_broad_vision_grep(
            "打开新项目",
            &["项目切换栏".to_string()],
            &narrative
        ));
        assert!(is_overly_broad_vision_grep(
            "打开新项目",
            &["项目切换栏".to_string()],
            &[]
        ));
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
    fn low_signal_vision_locate_grep() {
        assert!(is_low_signal_vision_locate_grep("activeTab"));
        assert!(is_low_signal_vision_locate_grep("selectedIndex"));
        assert!(!is_low_signal_vision_locate_grep("file-panel-tab"));
        assert!(!is_low_signal_vision_locate_grep("git-badge"));
    }

    #[test]
    fn require_prior_read_guard() {
        let mut paths = HashSet::new();
        paths.insert("src/a.ts".to_string());
        assert!(require_prior_read(&paths, "src/b.ts", true).is_some());
        assert!(require_prior_read(&paths, "src/a.ts", true).is_none());
        assert!(require_prior_read(&paths, "src/b.ts", false).is_none());
    }

    #[test]
    fn alternate_ui_patch_strategy_after_repeated_failures() {
        let log = vec![
            PatchFailureEntry {
                turn: 1,
                path: "src/foo.vue".into(),
                reason: "old_string 未出现在已读片段中".into(),
            },
            PatchFailureEntry {
                turn: 2,
                path: "src/foo.vue".into(),
                reason: "old_string 未匹配".into(),
            },
        ];
        assert!(should_nudge_alternate_ui_patch_strategy(
            &log,
            "src/foo.vue"
        ));
        assert!(!should_nudge_alternate_ui_patch_strategy(
            &log[..1],
            "src/foo.vue"
        ));
    }

    #[test]
    fn claims_success_despite_patch_failures_detects_false_success() {
        assert!(super::claims_success_despite_patch_failures(
            "✅ 两处修改已完成",
            1
        ));
        assert!(!super::claims_success_despite_patch_failures(
            "仍需 read 后再 patch",
            1
        ));
        assert!(!super::claims_success_despite_patch_failures(
            "✅ 修复完成",
            0
        ));
    }

    #[test]
    fn claims_ghost_modification_reply_detects_false_completion() {
        assert!(super::claims_ghost_modification_reply(
            "已完成修改，刷新查看。"
        ));
        assert!(!super::claims_ghost_modification_reply(
            "以上是建议方案，仅供参考。"
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
    fn english_planning_nudge() {
        assert!(should_nudge_english_planning(
            "Now let me check the template"
        ));
        assert!(!should_nudge_english_planning("让我查看定位逻辑"));
    }

    #[test]
    fn invalidate_file_read_cache_preserves_overlap_ranges() {
        let mut guard = ToolGuardState::default();
        record_read_range(
            "src/foo.ts",
            read_line_range_from_args(260, 35),
            &mut guard.read_file_ranges,
        );
        guard
            .read_slice_cache
            .insert("src/foo.ts:260:35".into(), "cached".into());
        invalidate_file_read_cache(&mut guard, "src/foo.ts");
        assert!(guard.read_slice_cache.is_empty());
        assert_eq!(
            guard.read_file_ranges.get("src/foo.ts").map(|v| v.len()),
            Some(1)
        );
    }

    #[test]
    fn read_ranges_overlap_within_line_margin() {
        let a = read_line_range_from_args(260, 35);
        let b = read_line_range_from_args(262, 30);
        assert!(read_ranges_overlap(a, b));
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

    #[test]
    fn manual_handoff_without_write_reply_detected() {
        let summary = "## 总结\n**未成功修改代码**。建议的修复（手动或另起对话执行）\n```js\nchip.remove();\n```";
        assert!(is_manual_handoff_without_write_reply(summary, true));
        assert!(!is_manual_handoff_without_write_reply(
            "已修改 foo.ts，改动如下",
            false
        ));
    }
}
