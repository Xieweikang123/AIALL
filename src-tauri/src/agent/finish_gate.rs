use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize)]
pub struct FinishGateViolation {
    pub code: String,
    pub detail: String,
}

#[derive(Debug, Clone)]
pub struct WriteStage {
    pub files: HashMap<String, String>,
    pub written_list: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct FinishGateInput {
    pub raw_content: String,
    pub write_stage: Option<WriteStage>,
    pub is_read_only_agent: bool,
    pub is_plan_explore: bool,
    pub read_only_build_run: bool,
    pub is_execute_plan: bool,
    pub implement_follow_up_run: bool,
    pub target_files: Option<Vec<String>>,
    pub task_prompt: Option<String>,
    pub automated_bug_fix_run: Option<bool>,
    pub verify_script_available: Option<bool>,
    pub last_verify_run_succeeded: Option<Option<bool>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FinishGateResult {
    pub blocked: bool,
    pub violations: Vec<FinishGateViolation>,
}

static SOURCE_FILE_EXT: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\.(?:ts|tsx|js|jsx|vue|cs|json|md|yaml|yml|css|scss|html|xml|sql|go|rs|py|toml)$")
        .unwrap()
});

static MODIFY_CONTEXT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?:已(?:经)?(?:修改|更新|修复|调整|写入|改为|改成|添加|删除)|改动|变更|patch|write|更新于)",
    )
    .unwrap()
});

static GENERIC_ANCHOR_BLOCKLIST: Lazy<HashSet<&'static str>> = Lazy::new(|| {
    [
        "true", "false", "null", "undefined", "string", "number", "object", "function", "import",
        "export", "return", "async", "await", "class", "interface", "type", "const", "let", "var",
        "build", "plan", "ask",
    ]
    .into_iter()
    .collect()
});

static WRITE_DONE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"已(?:经)?(?:修复|修改|写入|调整|完成)|改动(?:如下|点)|file_diff|已写入").unwrap()
});

static PREMATURE_COMPLETION_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?:全部|所有).{0,10}(?:正确|无误|完成|落盘)|无需再改|无需修改|链路完整|无逻辑漏洞|可以启动测试|代码质量检查|均(?:已)?(?:正确|完成)|都(?:已)?(?:正确|完成)",
    )
    .unwrap()
});

static FALSE_VERIFICATION_PASS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"检查完成|核对完成|验证通过|自检.{0,6}(?:通过|完成)|.{0,6}✅.{0,6}正确").unwrap()
});

static UNVERIFIED_ALL_CLEAR_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?:没有|无)\s*bug|应(?:该)?(?:能)?正常(?:工作)?|代码(?:逻辑|结构).{0,20}(?:正确|没问题)|结论：.{0,24}(?:没有|无)\s*bug|审查结果.{0,16}无需修改",
    )
    .unwrap()
});

static WRITE_SUCCESS_CLAIM_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?:✅|修复完成|修改已完成|已完成|改动已全部|全部到位|两处修改|三处修改|均已?成功|patch\s*均成功|无失败项|无剩余问题)",
    )
    .unwrap()
});

static VISION_INTERNAL_MARKER_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\s*\[图已理解\]\s*").unwrap()
});

static CONSULTATIVE_OFFER_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\n*(?:需要我|要不要我|是否要我).{0,32}(?:吗|么)[？?]?\s*$").unwrap()
});

static EXPANDED_REMOVE_MARKER_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?m)^操作：remove\s*$").unwrap()
});

static EXPANDED_SYMBOLS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?m)^目标符号：(.+)$").unwrap()
});

static QUOTED_LINE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\s*>").unwrap()
});

static REMOVE_AMEND_BODY_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^(?:也|同样|一样)?(?:移除|去掉|删除|删掉|不要(?:这段|这个|上面)?|取消|撤销)\s*[。！!]?$").unwrap()
});

static PATH_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)([\w./-]+\.(?:ts|tsx|js|jsx|vue|cs|json|md|yaml|yml|css|scss))").unwrap()
});

static CAMEL_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b[A-Z][a-zA-Z0-9]{2,}(?:[A-Z][a-zA-Z0-9]+)+\b").unwrap()
});

static BACKTICK_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"`([^`]{2,80})`").unwrap()
});

static DURATION_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(\d+)\s*(?:分钟|min(?:ute)?s?|m|秒|sec(?:ond)?s?|s|毫秒|ms|小时|h)").unwrap()
});

static PATH_PATTERN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\.?/?[\w./-]+$").unwrap()
});

pub fn normalize_target_path(path: &str) -> String {
    path.replace('\\', "/").trim().to_string()
}

pub fn written_stage_paths(stage: &WriteStage) -> Vec<String> {
    stage
        .written_list
        .iter()
        .map(|p| normalize_target_path(p))
        .filter(|p| !p.is_empty())
        .collect()
}

pub fn productive_written_paths(stage: &WriteStage) -> Vec<String> {
    written_stage_paths(stage)
        .into_iter()
        .filter(|p| is_productive_write_path(p))
        .collect()
}

fn is_productive_write_path(path: &str) -> bool {
    !path.trim().is_empty()
        && !path
            .replace('\\', "/")
            .trim()
            .to_lowercase()
            .starts_with(".aiall/exploration/")
}

fn sanitize_agent_user_visible_text(text: &str) -> String {
    let s = VISION_INTERNAL_MARKER_RE.replace_all(text, "");
    let s = CONSULTATIVE_OFFER_RE.replace(&s, "");
    let s = s.trim().to_string();
    dedupe_repeated_clauses(&s)
}

fn dedupe_repeated_clauses(text: &str) -> String {
    let separators = ['。', '．', '.'];
    let mut result = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if i + 1 < chars.len()
            && separators.contains(&chars[i])
            && (i + 1 < chars.len() && separators.contains(&chars[i + 1]))
        {
            let sep_count = if i + 2 < chars.len() && separators.contains(&chars[i + 2]) {
                3
            } else {
                2
            };
            let clause_start = if i >= 50 { i - 50 } else { 0 };
            let clause: String = chars[clause_start..i]
                .iter()
                .collect::<String>()
                .trim()
                .to_string();
            if clause.len() >= 4 {
                let after_start = (i + sep_count).min(chars.len());
                let after: String = chars[after_start..].iter().collect();
                let after_trimmed = after.trim_start();
                if after_trimmed.starts_with(&clause) {
                    let skip = after.len() - after_trimmed.len() + clause.len();
                    for _ in 0..sep_count {
                        result.push(chars[i]);
                        i += 1;
                    }
                    i += skip;
                    continue;
                }
            }
        }
        result.push(chars[i]);
        i += 1;
    }
    result
}

fn extract_quoted_lines(prompt: &str) -> Vec<String> {
    prompt
        .lines()
        .filter(|line| QUOTED_LINE_RE.is_match(line))
        .map(|line| {
            let trimmed = line.trim_start();
            if trimmed.starts_with('>') {
                trimmed[1..].trim().to_string()
            } else {
                trimmed.to_string()
            }
        })
        .filter(|s| !s.is_empty())
        .collect()
}

fn extract_amend_body(prompt: &str) -> String {
    prompt
        .lines()
        .filter(|line| !QUOTED_LINE_RE.is_match(line))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn extract_symbol_hints(text: &str) -> Vec<String> {
    let mut hints: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    let mut add = |value: &str| {
        let value = value.trim();
        if value.len() < 2 || value.len() > 80 {
            return;
        }
        let key = value.to_lowercase();
        if seen.contains(&key) || GENERIC_ANCHOR_BLOCKLIST.contains(key.as_str()) {
            return;
        }
        if SOURCE_FILE_EXT.is_match(value)
            || (PATH_PATTERN_RE.is_match(value) && value.contains('/'))
        {
            return;
        }
        seen.insert(key);
        hints.push(value.to_string());
    };

    for cap in BACKTICK_RE.captures_iter(text) {
        add(&cap[1]);
    }
    for cap in CAMEL_RE.captures_iter(text) {
        add(&cap[0]);
    }

    hints
}

fn parse_expanded_exclude_anchors(task_prompt: &str) -> Vec<String> {
    if !EXPANDED_REMOVE_MARKER_RE.is_match(task_prompt) {
        return vec![];
    }
    if let Some(cap) = EXPANDED_SYMBOLS_RE.captures(task_prompt) {
        return cap[1]
            .split(|c| c == '、' || c == ',' || c == '，')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect();
    }
    vec![]
}

fn detect_task_anchor_polarity(task_prompt: &str) -> (Vec<String>, bool) {
    let text = task_prompt.trim();
    if text.is_empty() {
        return (vec![], false);
    }

    let expanded = parse_expanded_exclude_anchors(text);
    if !expanded.is_empty() {
        return (expanded, true);
    }

    let quoted = extract_quoted_lines(text);
    if quoted.is_empty() {
        return (vec![], false);
    }

    let amend_body = extract_amend_body(text);
    let mut must_exclude = false;
    let mut exclude_anchors: Vec<String> = vec![];

    if REMOVE_AMEND_BODY_RE.is_match(&amend_body) {
        must_exclude = true;
        let combined = quoted.join(" ") + " " + &amend_body;
        exclude_anchors = extract_symbol_hints(&combined);
    }

    (exclude_anchors, must_exclude)
}

pub fn extract_task_contract_anchors(task_prompt: &str) -> Vec<String> {
    let text = task_prompt.trim();
    if text.is_empty() {
        return vec![];
    }

    let mut anchors: Vec<String> = vec![];
    let mut seen: HashSet<String> = HashSet::new();

    let mut add = |value: &str| {
        let value = value.trim();
        if value.len() < 2 || value.len() > 80 {
            return;
        }
        let key = value.to_lowercase();
        if seen.contains(&key) || GENERIC_ANCHOR_BLOCKLIST.contains(key.as_str()) {
            return;
        }
        if SOURCE_FILE_EXT.is_match(value)
            || (PATH_PATTERN_RE.is_match(value) && value.contains('/'))
        {
            return;
        }
        seen.insert(key);
        anchors.push(value.to_string());
    };

    for cap in BACKTICK_RE.captures_iter(text) {
        add(&cap[1]);
    }
    for cap in DURATION_RE.captures_iter(text) {
        add(&cap[0].replace(' ', ""));
    }
    for cap in CAMEL_RE.captures_iter(text) {
        add(&cap[0]);
    }

    anchors.truncate(8);
    anchors
}

pub fn extract_claimed_modified_paths(text: &str) -> Vec<String> {
    let body = sanitize_agent_user_visible_text(text);
    if body.is_empty() {
        return vec![];
    }

    let mut paths: Vec<String> = vec![];
    let mut seen = HashSet::new();
    let document_has_modify_context = MODIFY_CONTEXT_RE.is_match(&body);

    for cap in PATH_RE.captures_iter(&body) {
        let candidate = normalize_target_path(&cap[1]);
        if candidate.is_empty() || candidate.starts_with("http") {
            continue;
        }
        if seen.contains(&candidate) {
            continue;
        }
        if !document_has_modify_context {
            let start = cap.get(1).map_or(0, |m| m.start());
            let window_start = if start < 40 { 0 } else { start - 40 };
            let window_end = (start + candidate.len() + 20).min(body.len());
            let window = &body[window_start..window_end];
            if !MODIFY_CONTEXT_RE.is_match(window) {
                continue;
            }
        }
        seen.insert(candidate.clone());
        paths.push(candidate);
    }

    paths
}

fn paths_overlap(written: &[String], targets: &[String]) -> bool {
    if written.is_empty() || targets.is_empty() {
        return false;
    }
    let written_set: HashSet<String> = written.iter().map(|p| normalize_target_path(p)).collect();
    targets.iter().any(|target| {
        let normalized = normalize_target_path(target);
        if written_set.contains(&normalized) {
            return true;
        }
        let base = normalized.split('/').last().unwrap_or("");
        written_set.iter().any(|path| {
            path == &normalized
                || path.ends_with(&format!("/{normalized}"))
                || (!base.is_empty() && path.ends_with(&format!("/{base}")))
        })
    })
}

fn staged_content_includes_anchor(stage: &WriteStage, anchor: &str) -> bool {
    let needle: String = anchor
        .to_lowercase()
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    if needle.is_empty() {
        return true;
    }

    if let Some(duration_match) = DURATION_RE.captures(anchor) {
        let numeric = duration_match.get(1).map_or("", |m| m.as_str());
        for rel_path in written_stage_paths(stage) {
            if let Some(content) = stage.files.get(&rel_path) {
                let pattern = format!(r"\b{}\b", regex::escape(numeric));
                if let Ok(re) = Regex::new(&pattern) {
                    if re.is_match(content) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    for rel_path in written_stage_paths(stage) {
        if let Some(content) = stage.files.get(&rel_path) {
            let haystack: String = content
                .to_lowercase()
                .chars()
                .filter(|c| !c.is_whitespace())
                .collect();
            if haystack.contains(&needle) {
                return true;
            }
        }
    }
    false
}

fn claims_write_completion(text: &str) -> bool {
    let body = sanitize_agent_user_visible_text(text);
    if body.is_empty() {
        return false;
    }
    if WRITE_DONE_RE.is_match(&body) || WRITE_SUCCESS_CLAIM_RE.is_match(&body) {
        return true;
    }
    claims_premature_completion(&body)
}

pub fn claims_premature_completion(text: &str) -> bool {
    let body = sanitize_agent_user_visible_text(text);
    if body.is_empty() {
        return false;
    }
    if PREMATURE_COMPLETION_RE.is_match(&body) || UNVERIFIED_ALL_CLEAR_RE.is_match(&body) {
        return true;
    }
    if FALSE_VERIFICATION_PASS_RE.is_match(&body) {
        let has_emoji_check = Regex::new(r"✅|无误|正确").unwrap();
        if has_emoji_check.is_match(&body) {
            return true;
        }
    }
    false
}

pub fn is_empty_or_insufficient_final_reply(text: &str) -> bool {
    let body = sanitize_agent_user_visible_text(text);
    if body.is_empty() {
        return true;
    }
    if body.len() <= 12 && !body.chars().any(|c| c >= '\u{4e00}' && c <= '\u{9fff}') {
        return true;
    }
    false
}

pub fn should_run_finish_gate(
    is_read_only_agent: bool,
    is_plan_explore: bool,
    read_only_build_run: bool,
    write_stage: &Option<WriteStage>,
) -> bool {
    if is_read_only_agent || is_plan_explore || read_only_build_run {
        return false;
    }
    write_stage.is_some()
}

pub fn evaluate_finish_gate(input: &FinishGateInput) -> FinishGateResult {
    if !should_run_finish_gate(
        input.is_read_only_agent,
        input.is_plan_explore,
        input.read_only_build_run,
        &input.write_stage,
    ) {
        return FinishGateResult {
            blocked: false,
            violations: vec![],
        };
    }

    let stage = input.write_stage.as_ref().unwrap();
    let productive_writes = productive_written_paths(stage);
    let claims_done = claims_write_completion(&input.raw_content);
    let mut violations: Vec<FinishGateViolation> = vec![];
    let target_files: Vec<String> = input
        .target_files
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .map(|p| normalize_target_path(p))
        .filter(|p| !p.is_empty())
        .collect();

    if input.is_execute_plan && !target_files.is_empty() && claims_done {
        if productive_writes.is_empty() {
            violations.push(FinishGateViolation {
                code: "execute_plan_no_writes".into(),
                detail: format!(
                    "方案目标文件 {} 尚未落盘任何 productive 修改",
                    target_files.join("、")
                ),
            });
        } else if !paths_overlap(&productive_writes, &target_files) {
            violations.push(FinishGateViolation {
                code: "execute_plan_target_miss".into(),
                detail: format!(
                    "已修改 {}，但未触及方案目标 {}",
                    productive_writes.join("、"),
                    target_files.join("、")
                ),
            });
        }
    }

    if !productive_writes.is_empty() {
        let summary_claims_modifications = claims_done
            || MODIFY_CONTEXT_RE
                .is_match(&sanitize_agent_user_visible_text(&input.raw_content));
        if summary_claims_modifications {
            let written_set: HashSet<String> =
                productive_writes.iter().map(|p| normalize_target_path(p)).collect();
            for claimed in extract_claimed_modified_paths(&input.raw_content) {
                if written_set.contains(&claimed) {
                    continue;
                }
                let base = claimed.split('/').last().unwrap_or("");
                let matched = written_set.iter().any(|path| {
                    path == &claimed
                        || path.ends_with(&format!("/{claimed}"))
                        || (!base.is_empty() && path.ends_with(&format!("/{base}")))
                });
                if !matched {
                    violations.push(FinishGateViolation {
                        code: "phantom_file_claim".into(),
                        detail: format!(
                            "总结声称已修改 {claimed}，但本轮未写入该文件（实际写入：{}）",
                            if productive_writes.is_empty() {
                                "无".to_string()
                            } else {
                                productive_writes.join("、")
                            }
                        ),
                    });
                }
            }
        }
    }

    let task_prompt_text = input.task_prompt.as_deref().unwrap_or("").trim().to_string();
    let (exclude_anchors, polarity_must_exclude) =
        detect_task_anchor_polarity(&task_prompt_text);
    let anchors = extract_task_contract_anchors(&task_prompt_text);

    if claims_done && !productive_writes.is_empty() && !exclude_anchors.is_empty() && polarity_must_exclude
    {
        let still_present: Vec<String> = exclude_anchors
            .iter()
            .filter(|anchor| staged_content_includes_anchor(stage, anchor))
            .cloned()
            .collect();
        if !still_present.is_empty() {
            violations.push(FinishGateViolation {
                code: "task_anchor_still_present".into(),
                detail: format!(
                    "用户要求移除，但已写入内容仍包含：{}",
                    still_present.join("、")
                ),
            });
        }
    }

    if claims_done && !productive_writes.is_empty() && !anchors.is_empty() {
        let exclude_keys: HashSet<String> = exclude_anchors
            .iter()
            .map(|a| a.to_lowercase())
            .collect();
        let include_anchors: Vec<&String> = if polarity_must_exclude {
            anchors
                .iter()
                .filter(|a| !exclude_keys.contains(&a.to_lowercase()))
                .collect()
        } else {
            anchors.iter().collect()
        };
        let missing: Vec<String> = include_anchors
            .iter()
            .filter(|anchor| !staged_content_includes_anchor(stage, anchor))
            .map(|a| a.to_string())
            .collect();
        if !missing.is_empty() {
            violations.push(FinishGateViolation {
                code: "task_anchor_miss".into(),
                detail: format!(
                    "任务契约锚点未出现在已写入内容中：{}",
                    missing.join("、")
                ),
            });
        }
    }

    if input.automated_bug_fix_run.unwrap_or(false)
        && claims_done
        && input.verify_script_available.unwrap_or(false)
        && input.last_verify_run_succeeded != Some(Some(true))
    {
        violations.push(FinishGateViolation {
            code: "verify_not_run".into(),
            detail: "扫描修复须在宣称完成前成功 run_command 执行 verify 脚本".into(),
        });
    }

    if input.automated_bug_fix_run.unwrap_or(false)
        && input.last_verify_run_succeeded == Some(Some(false))
        && claims_done
    {
        violations.push(FinishGateViolation {
            code: "verify_regression".into(),
            detail: "最近一次 verify 命令仍失败，不可宣称修复完成".into(),
        });
    }

    if input.automated_bug_fix_run.unwrap_or(false)
        && is_empty_or_insufficient_final_reply(
            &sanitize_agent_user_visible_text(&input.raw_content),
        )
    {
        violations.push(FinishGateViolation {
            code: "empty_summary".into(),
            detail: "扫描修复结束前须输出中文总结（已修复项 / 跳过项 / 复验结果）；禁止空回复结束".into(),
        });
    }

    FinishGateResult {
        blocked: !violations.is_empty(),
        violations,
    }
}

pub fn build_finish_gate_retry_nudge(result: &FinishGateResult) -> String {
    let mut lines = vec![
        "【收尾门禁·红军驳回】你的总结与真实落盘不一致，禁止交付虚假收尾。".into(),
        "请对照下列问题修正代码或改写总结（失败项须如实标注「未生效」）：".into(),
    ];
    for v in &result.violations {
        lines.push(format!("- {}", v.detail));
    }
    lines.push(
        "核对后再回复：① 仅声称 writeStage 中已成功修改的文件；② 方案/任务中的关键锚点须出现在 diff；③ 未完成的文件或 patch 失败须明确写出。".into(),
    );
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_stage(files: Vec<(&str, &str)>, written: Vec<&str>) -> WriteStage {
        let mut map = HashMap::new();
        for (k, v) in files {
            map.insert(k.to_string(), v.to_string());
        }
        WriteStage {
            files: map,
            written_list: written.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn test_extract_task_contract_anchors_backtick_and_duration() {
        let anchors = extract_task_contract_anchors("使用 `Serilog`，同步间隔 30 分钟");
        assert!(anchors.contains(&"Serilog".to_string()));
        assert!(anchors.iter().any(|a| a.contains("30")));
    }

    #[test]
    fn test_extract_task_contract_anchors_skips_source_paths() {
        let anchors = extract_task_contract_anchors("改 `src/foo.ts`");
        assert!(anchors.is_empty());
    }

    #[test]
    fn test_extract_claimed_modified_paths_finds_with_modify_verb() {
        let paths = extract_claimed_modified_paths("已修改 src/services/sync.ts 的定时逻辑");
        assert_eq!(paths, vec!["src/services/sync.ts"]);
    }

    #[test]
    fn test_extract_claimed_modified_paths_ignores_without_modify_context() {
        let paths = extract_claimed_modified_paths("请查看 src/services/sync.ts");
        assert!(paths.is_empty());
    }

    #[test]
    fn test_evaluate_finish_gate_blocks_execute_plan_target_miss() {
        let stage = make_stage(
            vec![("src/other.ts", "export const x = 1;\n")],
            vec!["src/other.ts"],
        );
        let result = evaluate_finish_gate(&FinishGateInput {
            raw_content: "已完成修改，刷新查看。".into(),
            write_stage: Some(stage),
            is_read_only_agent: false,
            is_plan_explore: false,
            read_only_build_run: false,
            is_execute_plan: true,
            implement_follow_up_run: false,
            target_files: Some(vec!["src/foo.ts".into()]),
            task_prompt: Some("执行方案".into()),
            automated_bug_fix_run: None,
            verify_script_available: None,
            last_verify_run_succeeded: None,
        });
        assert!(result.blocked);
        assert!(result.violations.iter().any(|v| v.code == "execute_plan_target_miss"));
    }

    #[test]
    fn test_evaluate_finish_gate_blocks_phantom_file_claim() {
        let stage = make_stage(
            vec![("src/a.ts", "export const a = 1;\n")],
            vec!["src/a.ts"],
        );
        let result = evaluate_finish_gate(&FinishGateInput {
            raw_content: "已更新 src/a.ts 与 src/b.ts。".into(),
            write_stage: Some(stage),
            is_read_only_agent: false,
            is_plan_explore: false,
            read_only_build_run: false,
            is_execute_plan: false,
            implement_follow_up_run: false,
            target_files: None,
            task_prompt: None,
            automated_bug_fix_run: None,
            verify_script_available: None,
            last_verify_run_succeeded: None,
        });
        assert!(result.blocked);
        assert!(result.violations.iter().any(|v| v.code == "phantom_file_claim"));
    }

    #[test]
    fn test_evaluate_finish_gate_blocks_missing_anchor() {
        let stage = make_stage(
            vec![("src/logger.ts", "console.log('hello');\n")],
            vec!["src/logger.ts"],
        );
        let result = evaluate_finish_gate(&FinishGateInput {
            raw_content: "修改已完成。".into(),
            write_stage: Some(stage),
            is_read_only_agent: false,
            is_plan_explore: false,
            read_only_build_run: false,
            is_execute_plan: true,
            implement_follow_up_run: false,
            target_files: Some(vec!["src/logger.ts".into()]),
            task_prompt: Some("接入 `Serilog`，间隔 30分钟".into()),
            automated_bug_fix_run: None,
            verify_script_available: None,
            last_verify_run_succeeded: None,
        });
        assert!(result.blocked);
        assert!(result.violations.iter().any(|v| v.code == "task_anchor_miss"));
    }

    #[test]
    fn test_evaluate_finish_gate_passes_when_targets_and_anchors_satisfied() {
        let stage = make_stage(
            vec![(
                "src/logger.ts",
                "using Serilog;\nvar interval = TimeSpan.FromMinutes(30);\n",
            )],
            vec!["src/logger.ts"],
        );
        let result = evaluate_finish_gate(&FinishGateInput {
            raw_content: "已修改 src/logger.ts，Serilog 已接入。".into(),
            write_stage: Some(stage),
            is_read_only_agent: false,
            is_plan_explore: false,
            read_only_build_run: false,
            is_execute_plan: true,
            implement_follow_up_run: false,
            target_files: Some(vec!["src/logger.ts".into()]),
            task_prompt: Some("接入 `Serilog`，间隔 30分钟".into()),
            automated_bug_fix_run: None,
            verify_script_available: None,
            last_verify_run_succeeded: None,
        });
        assert!(!result.blocked);
    }

    #[test]
    fn test_evaluate_finish_gate_blocks_removal_anchor_still_present() {
        let stage = make_stage(
            vec![(
                "src/config.ts",
                "export const TargetSymbol = true;\nexport const Other = 1;\n",
            )],
            vec!["src/config.ts"],
        );
        let task_prompt = "【用户意图·已解析】用户引用了上一轮助手总结或代码块，短句是对引用内容的修订（不是新任务）。\n操作：remove\nscope：scopeA\n目标符号：TargetSymbol\n用户补充：也移除";
        let result = evaluate_finish_gate(&FinishGateInput {
            raw_content: "已完成修改。".into(),
            write_stage: Some(stage),
            is_read_only_agent: false,
            is_plan_explore: false,
            read_only_build_run: false,
            is_execute_plan: false,
            implement_follow_up_run: false,
            target_files: None,
            task_prompt: Some(task_prompt.into()),
            automated_bug_fix_run: None,
            verify_script_available: None,
            last_verify_run_succeeded: None,
        });
        assert!(result.blocked);
        assert!(result.violations.iter().any(|v| v.code == "task_anchor_still_present"));
    }

    #[test]
    fn test_evaluate_finish_gate_passes_when_removal_anchor_absent() {
        let stage = make_stage(
            vec![("src/config.ts", "export const Other = 1;\n")],
            vec!["src/config.ts"],
        );
        let task_prompt = "【用户意图·已解析】用户引用了上一轮助手总结或代码块，短句是对引用内容的修订（不是新任务）。\n操作：remove\nscope：scopeA\n目标符号：TargetSymbol\n用户补充：也移除";
        let result = evaluate_finish_gate(&FinishGateInput {
            raw_content: "已从 scopeA 移除 TargetSymbol。".into(),
            write_stage: Some(stage),
            is_read_only_agent: false,
            is_plan_explore: false,
            read_only_build_run: false,
            is_execute_plan: false,
            implement_follow_up_run: false,
            target_files: None,
            task_prompt: Some(task_prompt.into()),
            automated_bug_fix_run: None,
            verify_script_available: None,
            last_verify_run_succeeded: None,
        });
        assert!(!result.blocked);
    }

    #[test]
    fn test_evaluate_finish_gate_blocks_automated_bug_fix_empty_summary() {
        let stage = make_stage(vec![], vec![]);
        let result = evaluate_finish_gate(&FinishGateInput {
            raw_content: "   ".into(),
            write_stage: Some(stage),
            is_read_only_agent: false,
            is_plan_explore: false,
            read_only_build_run: false,
            is_execute_plan: true,
            implement_follow_up_run: false,
            target_files: None,
            task_prompt: None,
            automated_bug_fix_run: Some(true),
            verify_script_available: None,
            last_verify_run_succeeded: None,
        });
        assert!(result.blocked);
        assert!(result.violations.iter().any(|v| v.code == "empty_summary"));
    }

    #[test]
    fn test_evaluate_finish_gate_does_not_require_removed_symbols_in_diff() {
        let stage = make_stage(
            vec![("src/config.ts", "export const Other = 1;\n")],
            vec!["src/config.ts"],
        );
        let task_prompt = "> Agent: scopeA：保留 TargetSymbol\n\n也移除";
        let result = evaluate_finish_gate(&FinishGateInput {
            raw_content: "修改已完成。".into(),
            write_stage: Some(stage),
            is_read_only_agent: false,
            is_plan_explore: false,
            read_only_build_run: false,
            is_execute_plan: true,
            implement_follow_up_run: false,
            target_files: Some(vec!["src/config.ts".into()]),
            task_prompt: Some(task_prompt.into()),
            automated_bug_fix_run: None,
            verify_script_available: None,
            last_verify_run_succeeded: None,
        });
        assert!(!result.violations.iter().any(|v| v.code == "task_anchor_miss"));
    }

    #[test]
    fn test_productive_written_paths_hydrated() {
        let stage = make_stage(
            vec![(
                "src/components/vibe/AutoBugFixPanel.vue",
                "export default {};\n",
            )],
            vec![
                "src/views/VibeCodingView.vue".into(),
                "src/components/vibe/AutoBugFixPanel.vue".into(),
            ],
        );
        let paths = productive_written_paths(&stage);
        assert_eq!(paths.len(), 2);
    }

    #[test]
    fn test_build_finish_gate_retry_nudge_includes_violation() {
        let result = FinishGateResult {
            blocked: true,
            violations: vec![FinishGateViolation {
                code: "phantom_file_claim".into(),
                detail: "总结声称已修改 src/b.ts".into(),
            }],
        };
        let nudge = build_finish_gate_retry_nudge(&result);
        assert!(nudge.contains("收尾门禁"));
        assert!(nudge.contains("src/b.ts"));
    }

    #[test]
    fn test_claims_premature_completion_positive() {
        assert!(claims_premature_completion("检查完成，所有修改都正确无误 ✅"));
        assert!(claims_premature_completion("无需再改，链路完整"));
        assert!(claims_premature_completion("结论：当前代码没有 bug，无需修改"));
        assert!(claims_premature_completion("代码逻辑和 DOM 结构审查结果如下，应正常工作"));
    }

    #[test]
    fn test_claims_premature_completion_negative() {
        assert!(!claims_premature_completion("已修复 foo.ts，改动如下"));
    }
}
