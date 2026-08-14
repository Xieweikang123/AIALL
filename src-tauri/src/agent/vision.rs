//! Vision/screenshot processing for agent.
//! Ported from server/visionMessage.ts + visionAnchorPrefgrep.ts

use regex::Regex;

// ── Constants ──
pub const VISION_FIRST_TURN_MIN_DESCRIPTION_CHARS: usize = 24;
pub const VISION_ANCHOR_PREFGREP_MAX_PATTERNS: usize = 3;
pub const VISION_ANCHOR_PREFGREP_MAX_MATCHES: usize = 40;

// ── Lazily compiled regex patterns ──
static UI_IMAGE_QUESTION_RE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
    Regex::new(r"(?i)截图|图片|界面|面板|哪块|哪里|看到的|发图|粘贴|screen|screenshot|ui").unwrap()
});

pub static UI_CLICK_FOCUS_INTERACTION_RE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(
    || {
        Regex::new(r"(?i)任何位置|任意位置|点到哪|点哪里|点击.{0,8}(输入|聚焦|focus)|都能输入|都能聚焦|点.{0,6}空白|点不到|没反应|聚焦输入").unwrap()
    },
);

pub static UI_REQUIREMENT_SPEC_RE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
    Regex::new(r"(?i)我要的效果|我期望|期望效果|应该是|需要能|要能|得能|想要的效果").unwrap()
});

pub static UI_POSITIONING_BUG_RE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
    Regex::new(r"(?i)跑(?:到|去|别的)|错位|位置不对|飘到|歪了|不在.{0,8}旁边|离.{0,8}远|跑到.{0,12}(底|顶|角)").unwrap()
});

static VISIBLE_ANCHOR_QUOTE_RE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
    Regex::new(r#"[「『"']([^」』"']{3,})[」』"']|占位符[^，。；\n]{0,16}[「『"']([^」』"']{3,})[」』"']?|(?:标签|按钮|标题|Tab)[:：]?\s*[「『"']([^」』"']{3,})[」』"']?"#).unwrap()
});

pub static VISION_INTERNAL_MARKER_RE: std::sync::LazyLock<Regex> =
    std::sync::LazyLock::new(|| Regex::new(r"\s*\[图已理解\]\s*").unwrap());

static ANCHOR_TO_REGION_RE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
    Regex::new(r"(判断|可判断|可推断|据此|由此|说明|对应|属于|定位为|应是|这是|应该是|像是|表明|可定位)[^。\n]{0,48}(助手|聊天|输入框|面板|模块|区域|底栏|侧栏|编辑器|对话|占位|工具栏|列表)").unwrap()
});

static UI_REGION_STATEMENT_RE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
    Regex::new(r"(这是|这个是|这里|这个区域|这块|这部分|这边|此区域|该区域|对应的是|呈现的是|该面板|该对话框|该弹出层|该窗口|该弹窗|该界面|此处)").unwrap()
});

static UI_MODULE_STATEMENT_RE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
    Regex::new(r"这是[^。\n]{0,48}(助手|聊天|输入|面板|模块|区域|编辑器|底栏|侧栏|工具栏)").unwrap()
});

static PREMATURE_VISION_COMPLETION_RE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
    Regex::new(r"已(?:经)?(?:修复|修改|添加|完成|写入|调整|做)|已做的修改|现在点击输入框任何位置").unwrap()
});

// ── Helper functions ──

pub fn sanitize_image_data_urls(urls: &[String]) -> Vec<String> {
    urls.iter()
        .filter(|u| u.starts_with("data:image/"))
        .cloned()
        .collect()
}

pub fn has_ui_image_keywords(text: &str) -> bool {
    UI_IMAGE_QUESTION_RE.is_match(text)
}

pub fn is_ui_positioning_bug_prompt(text: &str) -> bool {
    UI_POSITIONING_BUG_RE.is_match(text)
}

/// Extract quoted visible strings from a vision-first-turn description
pub fn extract_visible_anchor_quotes(text: &str) -> Vec<String> {
    let mut quotes: Vec<String> = Vec::new();
    for cap in VISIBLE_ANCHOR_QUOTE_RE.captures_iter(text) {
        for i in 1..=3 {
            if let Some(q) = cap.get(i) {
                let trimmed = q.as_str().trim().to_string();
                if trimmed.len() >= 3 && !quotes.contains(&trimmed) {
                    quotes.push(trimmed);
                }
            }
        }
    }
    quotes
}

/// Build model identity hint
pub fn build_model_identity_hint(model: &str) -> String {
    let name = if model.trim().is_empty() {
        "（未指定）"
    } else {
        model.trim()
    };
    format!(
        "当前接入的 API 模型 ID：{name}。\
    若用户问「你是什么模型/哪个模型」：如实回答上述模型 ID，不要自称 Claude、GPT、Gemini 等。\
    不要编造 Anthropic、OpenAI 等厂商或训练信息。"
    )
}

/// Build click-to-focus interaction hint
pub fn build_click_focus_interaction_hint() -> &'static str {
    "附了截图询问点哪里能输入/聚焦：诊断（勿预设修法）——先识别图中可编辑区域，\
  核对父容器与内层可编辑节点的命中区是否一致；若用户说「任何位置」，通常指该可编辑区域内部，而非全屏任意坐标。"
}

/// Build floating control positioning hint
pub fn build_floating_control_positioning_hint() -> &'static str {
    "附了截图报告控件跑偏/错位：诊断（勿预设修法）——先区分「浮层/绝对定位错位」与「同容器流式布局拥挤」。\
  用结构线索检索（定位属性、portal/Teleport、浮层相关 class），并核对父级定位上下文与 overflow 裁剪；\
  证据不足时并列假设，勿只认单一修法。"
}

/// Build vision grep anchor hint — first turn
pub fn build_vision_grep_anchor_hint() -> &'static str {
    "附了截图但尚未进行任何 grep 或 read_file。\
  先用 grep 确认截图定位：从用户描述中提取引用的可见文本（按钮/占位符/标签），\
  在源码中 grep 这些字符串以确定对应哪个组件/区域。"
}

/// Build vision UI locate hint
pub fn build_vision_ui_locate_hint() -> &'static str {
    "附了截图询问界面元素/控件位置。先用 grep 定位截图引用文本对应的 Vue 文件，\
  然后 read_file 理解布局结构。定位到后给出确切坐标。"
}

/// Build vision build continue hint
pub fn build_vision_build_continue_hint() -> &'static str {
    "附了截图要求实现/修改某界面：先用 read_file 理解相关组件，\
  确认涉及的文件和布局结构后再修改。"
}

/// Build vision first turn rule — must view image before tools (parity with TS).
pub fn build_vision_first_turn_rule() -> &'static str {
    "【附图·首轮必读图】你必须先仔细查看附带图片，用中文描述所见：\n\
- 先说明截图对应应用中的哪一块（模块/面板/区域）；画面若只裁到局部，也要根据占位符、按钮、标签等可见文案推断归属；\n\
- 须引用图中可辨识的占位符或标签原文（用「」括起），并写明「据此可判断这是 …」；\n\
- 再补充控件类型、布局关系；若用户反馈拥挤/重叠/不好看，须点名哪两个（或哪组）元素及其关系；\n\
- 若控件含图标、文字或徽章等内嵌内容，须描述外框与内层的相对大小；内外明显不匹配时须点明「内外比例失衡」及哪一层偏大/偏小，勿只罗列元素类型而不作比例判断。\n\
本轮禁止调用任何工具；仅输出读图描述，下一轮可用 grep 图中摘录的文案定位源码。\n\
读图首轮禁止写「已修改/已修复/已添加/已做」等完成时态，禁止描述尚未执行的 patch。\n\
禁止在未 read template 前断言控件语义（如状态圆点、计数含义、占位/未实现）；须 grep/read 后再解释元素作用。\n\
布局问题后续修改时：若同容器拥挤，查 flex/overflow/gap/min-width 等；若控件与选区/焦点在空间上分离，须同时验证「浮层/绝对定位」与「流式布局」两种假设，勿只认其一。\n\
点击/聚焦问题另查 DOM 层级与 focus 转发，勿默认只改一层样式。\n\
当你真正理解了截图内容后，在描述末尾加上暗号 [图已理解]。只有加上此暗号，才表示你已完成读图。"
}

/// Vision-first turn must not claim code changes before any tool runs.
pub fn is_premature_vision_completion_claim(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    PREMATURE_VISION_COMPLETION_RE.is_match(trimmed)
}

fn has_visible_anchor_quote(text: &str) -> bool {
    VISIBLE_ANCHOR_QUOTE_RE.is_match(text)
}

fn describes_screenshot_ui_region(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    if UI_REGION_STATEMENT_RE.is_match(trimmed) || UI_MODULE_STATEMENT_RE.is_match(trimmed) {
        return true;
    }
    if has_visible_anchor_quote(trimmed) {
        return ANCHOR_TO_REGION_RE.is_match(trimmed);
    }
    false
}

/// Check if text is an adequate vision first-turn description.
/// Requires the `[图已理解]` marker, a region statement, and no premature
/// completion claim — a bare "let me grep" planning text is NOT adequate.
pub fn is_adequate_vision_first_turn_description(text: &str) -> bool {
    if is_premature_vision_completion_claim(text) {
        return false;
    }
    let trimmed = text.trim();
    if !VISION_INTERNAL_MARKER_RE.is_match(trimmed) {
        return false;
    }
    let stripped = VISION_INTERNAL_MARKER_RE.replace_all(trimmed, "");
    if stripped.trim().len() < VISION_FIRST_TURN_MIN_DESCRIPTION_CHARS {
        return false;
    }
    describes_screenshot_ui_region(trimmed)
}

/// Build vision task text combining prompt and image count
pub fn build_vision_task_text(prompt: &str, image_count: usize) -> String {
    if image_count == 0 {
        return prompt.to_string();
    }
    format!("[用户附了 {image_count} 张截图]\n{}", prompt)
}

/// Build OpenAI-compatible multimodal user content (string or parts array).
pub fn build_vision_user_content(prompt: &str, image_data_urls: &[String]) -> serde_json::Value {
    let urls = sanitize_image_data_urls(image_data_urls);
    if urls.is_empty() {
        return serde_json::Value::String(prompt.to_string());
    }
    let mut parts = vec![serde_json::json!({
      "type": "text",
      "text": build_vision_task_text(prompt, urls.len())
    })];
    for url in urls {
        parts.push(serde_json::json!({
          "type": "image_url",
          "image_url": { "url": url }
        }));
    }
    serde_json::Value::Array(parts)
}

/// Select vision anchor grep patterns from quotes (delegates to vision_pregrep).
pub fn select_vision_anchor_grep_patterns(anchor_quotes: &[String]) -> Vec<String> {
    super::vision_pregrep::select_vision_anchor_grep_patterns(anchor_quotes)
}

/// Filter runtime-visible text patterns (labels with dynamic suffixes) — aligned with Node visionAnchorPrefgrep.ts
pub fn is_runtime_visible_text_grep_pattern(pattern: &str) -> bool {
    let p = pattern.trim();
    if p.is_empty() {
        return false;
    }
    if Regex::new(r"^\d+$")
        .map(|re| re.is_match(p))
        .unwrap_or(false)
    {
        return true;
    }
    if Regex::new(r"^[A-Za-z][\w.-]*\s+\d+$")
        .map(|re| re.is_match(p))
        .unwrap_or(false)
    {
        return true;
    }
    Regex::new(r"^[\u{4e00}-\u{9fff}]+\s+\d+$")
        .map(|re| re.is_match(p))
        .unwrap_or(false)
}

/// Build vision locate single-turn rule
pub fn build_vision_locate_single_turn_rule() -> &'static str {
    "【定位报告格式】
  得出确切结论后，按以下格式输出：
  ```
  ## 定位结果
  - 文件：path/to/file.vue
  - 行号：42-58
  - 坐标：点击目标在截图中的坐标 (x, y)
  - 判断依据：…"
}

/// Build vision accuracy single-turn rule
pub fn build_vision_accuracy_single_turn_rule() -> &'static str {
    "【准确度审查】附了截图要求判断准确度：
  1. 先确认截图区域对应哪个组件/模块
  2. 再比对用户断言与代码实际逻辑
  3. 给出正反证据"
}

/// Build consultative UI appearance hint
pub fn build_consultative_ui_appearance_hint() -> &'static str {
    "附了截图咨询 UI 外观/效果：
  1. 先 grep 截图引文定位组件
  2. 再 read_file 读 vue/css/scss 确认实际样式
  3. 不要仅凭截图视觉印象回答，必须引用源码证据"
}

/// Should bypass vision first turn
pub fn should_bypass_vision_first_turn(text: &str) -> bool {
    UI_POSITIONING_BUG_RE.is_match(text)
        || UI_CLICK_FOCUS_INTERACTION_RE.is_match(text)
        || UI_REQUIREMENT_SPEC_RE.is_match(text)
}

/// Mentions control proportion imbalance
pub fn mentions_control_proportion_imbalance(text: &str) -> bool {
    let inner = Regex::new(r"(?i)内边距|padding|内部|里面|内容区|内容区域|太小|太挤|太窄").unwrap();
    let outer = Regex::new(r"(?i)外边距|margin|外部|外面|四周|边距|太大|太宽|太空").unwrap();
    let container =
        Regex::new(r"(?i)整体|容器|外层|wrap|外面一圈|外圈|边框|border|背景色|底色").unwrap();
    (inner.is_match(text) || outer.is_match(text)) && container.is_match(text)
}

/// Suggests visible shell empty inner (wrong element selected)
pub fn suggests_visible_shell_empty_inner(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    if Regex::new(
    r"(?i)(?:外框|圆|容器|按钮|徽标|徽章|圆角).{0,24}(?:可见|在渲染|出现).{0,24}(?:箭头|图标|文字|符号|内容|数字).{0,16}(?:不可见|看不到|空白|被裁|没有|无明显)|(?:箭头|图标|文字|符号|数字|内容).{0,16}(?:不可见|看不到|空白|没有|无明显).{0,24}(?:外框|圆|容器|按钮|徽标|徽章|圆角)",
  )
  .map(|re| re.is_match(trimmed))
  .unwrap_or(false)
  {
    return true;
  }
    Regex::new(
    r"(?i)无明显(?:内容|文字)|无文字|像.{0,16}(?:空|占位|toggle|开关)|(?:空洞|空白).{0,12}(?:控件|圆角|矩形)",
  )
  .map(|re| re.is_match(trimmed))
  .unwrap_or(false)
}

/// Final answer claims display without reconciling vision-noted empty shell.
pub fn is_unreconciled_empty_shell_answer(vision_text: &str, reply_text: &str) -> bool {
    if !suggests_visible_shell_empty_inner(vision_text) {
        return false;
    }
    let reply = VISION_INTERNAL_MARKER_RE
        .replace_all(reply_text, "")
        .trim()
        .to_string();
    if reply.is_empty() {
        return false;
    }
    if Regex::new(
    r"(?i)v-if|v-show|shimmer|透明|渐变|background-clip|text-fill|条件.{0,8}(?:不|未)|为\s*0|不渲染|看不见|观感",
  )
  .map(|re| re.is_match(&reply))
  .unwrap_or(false)
  {
    return false;
  }
    Regex::new(r"(?i)显示.{0,12}(?:数字|数量|条数|N|\d)|徽标|badge|用于显示")
        .map(|re| re.is_match(&reply))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── sanitize_image_data_urls ──
    #[test]
    fn test_sanitize_image_data_urls_empty() {
        assert!(sanitize_image_data_urls(&[]).is_empty());
    }

    #[test]
    fn test_sanitize_image_data_urls_filters_non_image() {
        let urls = vec![
            "data:image/png;base64,abc".to_string(),
            "data:application/pdf;base64,xyz".to_string(),
            "http://example.com/img.jpg".to_string(),
        ];
        let result = sanitize_image_data_urls(&urls);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], "data:image/png;base64,abc");
    }

    #[test]
    fn test_sanitize_image_data_urls_all_valid() {
        let urls = vec![
            "data:image/png;base64,a".to_string(),
            "data:image/jpeg;base64,b".to_string(),
            "data:image/webp;base64,c".to_string(),
        ];
        assert_eq!(sanitize_image_data_urls(&urls).len(), 3);
    }

    #[test]
    fn test_sanitize_image_data_urls_none_valid() {
        let urls = vec![
            "http://example.com/img.png".to_string(),
            "data:text/plain,hello".to_string(),
        ];
        assert!(sanitize_image_data_urls(&urls).is_empty());
    }

    // ── has_ui_image_keywords ──
    #[test]
    fn test_has_ui_image_keywords_positive_screenshot() {
        assert!(has_ui_image_keywords("看这张截图"));
    }

    #[test]
    fn test_has_ui_image_keywords_positive_ui() {
        assert!(has_ui_image_keywords("界面显示有问题"));
    }

    #[test]
    fn test_has_ui_image_keywords_positive_paste() {
        assert!(has_ui_image_keywords("我粘贴了图片"));
    }

    #[test]
    fn test_has_ui_image_keywords_positive_english() {
        assert!(has_ui_image_keywords("screenshot attached"));
    }

    #[test]
    fn test_has_ui_image_keywords_negative() {
        assert!(!has_ui_image_keywords("帮我改代码"));
        assert!(!has_ui_image_keywords("这个函数有什么问题"));
    }

    #[test]
    fn test_has_ui_image_keywords_positive_panel() {
        assert!(has_ui_image_keywords("面板显示不对"));
    }

    // ── is_ui_positioning_bug_prompt ──
    #[test]
    fn test_is_ui_positioning_bug_prompt_positive_pao() {
        assert!(is_ui_positioning_bug_prompt("按钮跑到了右边"));
    }

    #[test]
    fn test_is_ui_positioning_bug_prompt_positive_wrong_position() {
        assert!(is_ui_positioning_bug_prompt("位置不对"));
    }

    #[test]
    fn test_is_ui_positioning_bug_prompt_positive_cuowei() {
        assert!(is_ui_positioning_bug_prompt("元素错位了"));
    }

    #[test]
    fn test_is_ui_positioning_bug_prompt_negative() {
        assert!(!is_ui_positioning_bug_prompt("颜色不对"));
    }

    #[test]
    fn test_is_ui_positioning_bug_prompt_positive_piao() {
        assert!(is_ui_positioning_bug_prompt("飘到了角落"));
    }

    #[test]
    fn test_is_ui_positioning_bug_prompt_positive_not_nearby() {
        assert!(is_ui_positioning_bug_prompt("按钮不在输入框旁边"));
    }

    // ── extract_visible_anchor_quotes ──
    #[test]
    fn test_extract_visible_anchor_quotes_empty() {
        assert!(extract_visible_anchor_quotes("没有引用文本").is_empty());
    }

    #[test]
    fn test_extract_visible_anchor_quotes_single_chinese_quote() {
        // Must be ≥3 chars inside quotes per regex {3,}
        let result = extract_visible_anchor_quotes("点击「提交表单」按钮");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], "提交表单");
    }

    #[test]
    fn test_extract_visible_anchor_quotes_multiple() {
        let result = extract_visible_anchor_quotes("「登录按钮」和「注册页面」");
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_extract_visible_anchor_quotes_too_short() {
        assert!(extract_visible_anchor_quotes("「ab」太短了").is_empty());
    }

    #[test]
    fn test_extract_visible_anchor_quotes_double_quotes() {
        let result = extract_visible_anchor_quotes("点击\"提交表单\"按钮");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], "提交表单");
    }

    #[test]
    fn test_extract_visible_anchor_quotes_placeholder_with_label() {
        // "占位符…「xxx」" triggers the second alternative
        let result = extract_visible_anchor_quotes("这个占位符「搜索文件」");
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_extract_visible_anchor_quotes_no_duplicates() {
        let result = extract_visible_anchor_quotes("「提交表单」「提交表单」按钮");
        assert_eq!(result.len(), 1);
    }

    // ── build_model_identity_hint ──
    #[test]
    fn test_build_model_identity_hint_empty() {
        let hint = build_model_identity_hint("");
        assert!(hint.contains("未指定"));
    }

    #[test]
    fn test_build_model_identity_hint_whitespace() {
        let hint = build_model_identity_hint("  ");
        assert!(hint.contains("未指定"));
    }

    #[test]
    fn test_build_model_identity_hint_with_model() {
        let hint = build_model_identity_hint("gpt-4");
        assert!(hint.contains("gpt-4"));
    }

    #[test]
    fn test_build_model_identity_hint_contains_deny_self_claim() {
        let hint = build_model_identity_hint("claude-3");
        assert!(hint.contains("claude-3"));
        // The instruction text itself mentions "Claude" as a prohibited name
        assert!(hint.contains("Claude"));
    }

    // ── build_click_focus_interaction_hint ──
    #[test]
    fn test_build_click_focus_interaction_hint() {
        let hint = build_click_focus_interaction_hint();
        assert!(hint.contains("输入"));
        assert!(hint.contains("勿预设修法"));
        assert!(hint.contains("可编辑"));
    }

    // ── build_floating_control_positioning_hint ──
    #[test]
    fn test_build_floating_control_positioning_hint() {
        let hint = build_floating_control_positioning_hint();
        assert!(hint.contains("勿预设修法"));
        assert!(!hint.contains("请 patch"));
        assert!(!hint.contains("show*At"));
    }

    // ── build_vision_grep_anchor_hint ──
    #[test]
    fn test_build_vision_grep_anchor_hint() {
        let hint = build_vision_grep_anchor_hint();
        assert!(hint.contains("grep"));
    }

    // ── build_vision_ui_locate_hint ──
    #[test]
    fn test_build_vision_ui_locate_hint() {
        let hint = build_vision_ui_locate_hint();
        assert!(hint.contains("grep"));
    }

    // ── build_vision_build_continue_hint ──
    #[test]
    fn test_build_vision_build_continue_hint() {
        let hint = build_vision_build_continue_hint();
        assert!(hint.contains("read_file"));
    }

    // ── build_vision_first_turn_rule ──
    #[test]
    fn test_build_vision_first_turn_rule() {
        let hint = build_vision_first_turn_rule();
        assert!(hint.contains("首轮必读图"));
        assert!(hint.contains("禁止调用任何工具"));
        assert!(hint.contains("[图已理解]"));
    }

    // ── is_adequate_vision_first_turn_description ──
    #[test]
    fn test_is_adequate_vision_first_turn_description_short() {
        assert!(!is_adequate_vision_first_turn_description("短"));
    }

    #[test]
    fn test_is_adequate_vision_first_turn_description_adequate() {
        let desc = "这是应用主界面，截图里包含左侧工具栏和右侧编辑区域。[图已理解]";
        assert!(is_adequate_vision_first_turn_description(desc));
    }

    #[test]
    fn test_is_adequate_vision_first_turn_description_strips_marker() {
        let desc = "[图已理解] 短";
        assert!(!is_adequate_vision_first_turn_description(desc));
    }

    #[test]
    fn test_is_adequate_vision_first_turn_description_exactly_at_threshold() {
        let desc = format!("{} [图已理解]", "a".repeat(VISION_FIRST_TURN_MIN_DESCRIPTION_CHARS));
        assert!(!is_adequate_vision_first_turn_description(&desc));
    }

    #[test]
    fn test_is_adequate_vision_first_turn_description_one_short() {
        let desc = format!("{} [图已理解]", "a".repeat(VISION_FIRST_TURN_MIN_DESCRIPTION_CHARS - 1));
        assert!(!is_adequate_vision_first_turn_description(&desc));
    }

    #[test]
    fn test_vision_first_turn_requires_marker() {
        // Planning text without the marker is NOT an adequate description.
        let planning = "我先读图：截图是 Git 面板顶部状态栏，包含多个按钮，它们确实挤在一行。接下来用 grep 定位。";
        assert!(!is_adequate_vision_first_turn_description(planning));
    }

    #[test]
    fn test_vision_first_turn_requires_region_statement() {
        // Marker + length but no screenshot-region statement.
        let desc = "a".repeat(60) + " [图已理解]";
        assert!(!is_adequate_vision_first_turn_description(&desc));
    }

    #[test]
    fn test_vision_first_turn_requires_no_premature_claim() {
        let desc = "这是 Git 面板顶部状态栏，按钮挤在一起。[图已理解] 我已修复";
        assert!(!is_adequate_vision_first_turn_description(desc));
    }

    #[test]
    fn test_vision_first_turn_accepts_region_with_marker() {
        let desc = "截图对应 Git 面板顶部，这是工具栏区域，Fetch/Pull/Push 按钮挤在一行。[图已理解]";
        assert!(is_adequate_vision_first_turn_description(desc));
    }

    // ── build_vision_task_text ──
    #[test]
    fn test_build_vision_task_text_no_image() {
        assert_eq!(build_vision_task_text("hello", 0), "hello");
    }

    #[test]
    fn test_build_vision_task_text_one_image() {
        let result = build_vision_task_text("分析这个", 1);
        assert!(result.contains("1 张截图"));
        assert!(result.contains("分析这个"));
    }

    #[test]
    fn test_build_vision_task_text_multiple_images() {
        let result = build_vision_task_text("修改这个", 3);
        assert!(result.contains("3 张截图"));
    }

    // ── build_vision_user_content ──
    #[test]
    fn test_build_vision_user_content_text_only() {
        let result = build_vision_user_content("hello", &[]);
        assert_eq!(result, serde_json::Value::String("hello".to_string()));
    }

    #[test]
    fn test_build_vision_user_content_with_images() {
        let urls = vec!["data:image/png;base64,abc".to_string()];
        let result = build_vision_user_content("hello", &urls);
        assert!(result.is_array());
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["type"], "text");
        assert_eq!(arr[0]["text"], "[用户附了 1 张截图]\nhello");
        assert_eq!(arr[1]["type"], "image_url");
        assert_eq!(arr[1]["image_url"]["url"], "data:image/png;base64,abc");
    }

    #[test]
    fn test_build_vision_user_content_filters_non_image() {
        let urls = vec![
            "data:image/png;base64,abc".to_string(),
            "http://example.com/img.jpg".to_string(),
        ];
        let result = build_vision_user_content("hello", &urls);
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 2); // text + 1 image
    }

    #[test]
    fn test_build_vision_user_content_multiple_images() {
        let urls = vec![
            "data:image/png;base64,a".to_string(),
            "data:image/jpeg;base64,b".to_string(),
        ];
        let result = build_vision_user_content("test", &urls);
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 3); // text + 2 images
        assert_eq!(arr[0]["text"], "[用户附了 2 张截图]\ntest");
    }

    // ── select_vision_anchor_grep_patterns ──
    #[test]
    fn test_select_vision_anchor_grep_patterns_empty() {
        assert!(select_vision_anchor_grep_patterns(&[]).is_empty());
    }

    #[test]
    fn test_select_vision_anchor_grep_patterns_filters_short() {
        assert!(select_vision_anchor_grep_patterns(&["a".to_string()]).is_empty());
    }

    #[test]
    fn test_select_vision_anchor_grep_patterns_filters_long() {
        let long = "a".repeat(100);
        assert!(select_vision_anchor_grep_patterns(&[long]).is_empty());
    }

    #[test]
    fn test_select_vision_anchor_grep_patterns_respects_limit() {
        let quotes: Vec<String> = (0..5).map(|i| format!("pattern_{}", i)).collect();
        let result = select_vision_anchor_grep_patterns(&quotes);
        assert_eq!(result.len(), VISION_ANCHOR_PREFGREP_MAX_PATTERNS);
    }

    #[test]
    fn test_select_vision_anchor_grep_patterns_filters_runtime_label_count() {
        assert!(select_vision_anchor_grep_patterns(&["30".to_string()]).is_empty());
        let git = select_vision_anchor_grep_patterns(&["Git 30".to_string()]);
        assert!(!git.iter().any(|p| p.contains("30")));
    }

    #[test]
    fn test_select_vision_anchor_grep_patterns_keeps_structural() {
        let result = select_vision_anchor_grep_patterns(&["file-panel-tab".to_string()]);
        assert!(result.iter().any(|p| p.contains("file-panel-tab")));
    }

    #[test]
    fn test_select_vision_anchor_grep_patterns_no_duplicates() {
        let quotes = vec!["提交".to_string(), "提交".to_string()];
        let result = select_vision_anchor_grep_patterns(&quotes);
        assert_eq!(result.len(), 1);
    }

    // ── is_runtime_visible_text_grep_pattern ──
    #[test]
    fn test_is_runtime_visible_text_grep_pattern_digits() {
        assert!(is_runtime_visible_text_grep_pattern("30"));
        assert!(is_runtime_visible_text_grep_pattern("Git 30"));
        assert!(is_runtime_visible_text_grep_pattern("会话 14"));
    }

    #[test]
    fn test_is_runtime_visible_text_grep_pattern_valid_label() {
        assert!(!is_runtime_visible_text_grep_pattern("提交按钮"));
        assert!(!is_runtime_visible_text_grep_pattern("file-panel-tab"));
    }

    #[test]
    fn test_is_runtime_visible_text_grep_pattern_empty() {
        assert!(!is_runtime_visible_text_grep_pattern(""));
    }

    // ── should_bypass_vision_first_turn ──
    #[test]
    fn test_should_bypass_vision_first_turn_positioning() {
        assert!(should_bypass_vision_first_turn("按钮跑到了右边"));
    }

    #[test]
    fn test_should_bypass_vision_first_turn_click_focus() {
        assert!(should_bypass_vision_first_turn("点不到输入框"));
    }

    #[test]
    fn test_should_bypass_vision_first_turn_requirement_spec() {
        assert!(should_bypass_vision_first_turn("我要的效果是"));
    }

    #[test]
    fn test_should_bypass_vision_first_turn_negative() {
        assert!(!should_bypass_vision_first_turn("普通问题"));
    }

    #[test]
    fn test_should_bypass_vision_first_turn_any_position_click() {
        assert!(should_bypass_vision_first_turn("任何位置都能输入吗"));
    }

    // ── mentions_control_proportion_imbalance ──
    #[test]
    fn test_mentions_control_proportion_imbalance_inner_outer() {
        assert!(mentions_control_proportion_imbalance(
            "内边距太小，整体太小"
        ));
    }

    #[test]
    fn test_mentions_control_proportion_imbalance_margin() {
        assert!(mentions_control_proportion_imbalance(
            "外边距太大，容器太宽"
        ));
    }

    #[test]
    fn test_mentions_control_proportion_imbalance_negative() {
        assert!(!mentions_control_proportion_imbalance("颜色不好看"));
    }

    #[test]
    fn test_mentions_control_proportion_imbalance_only_inner() {
        assert!(!mentions_control_proportion_imbalance("内边距太小"));
    }

    #[test]
    fn test_mentions_control_proportion_imbalance_padding_and_container() {
        assert!(mentions_control_proportion_imbalance(
            "padding 太大，整体太宽"
        ));
    }

    // ── suggests_visible_shell_empty_inner ──
    #[test]
    fn test_suggests_visible_shell_empty_inner_positive() {
        assert!(suggests_visible_shell_empty_inner(
            "外框可见但内层箭头不可见"
        ));
    }

    #[test]
    fn test_suggests_visible_shell_empty_inner_negative() {
        assert!(!suggests_visible_shell_empty_inner("普通描述"));
    }

    #[test]
    fn test_suggests_visible_shell_empty_inner_only_shell() {
        assert!(!suggests_visible_shell_empty_inner("外面容器"));
    }

    #[test]
    fn test_suggests_visible_shell_empty_inner_only_inner() {
        assert!(!suggests_visible_shell_empty_inner("里面内容区"));
    }

    #[test]
    fn test_suggests_visible_shell_empty_inner_wrap_inner() {
        assert!(suggests_visible_shell_empty_inner("像空白占位控件"));
    }

    // ── build_vision_locate_single_turn_rule ──
    #[test]
    fn test_build_vision_locate_single_turn_rule() {
        let hint = build_vision_locate_single_turn_rule();
        assert!(hint.contains("定位结果"));
        assert!(hint.contains("文件"));
        assert!(hint.contains("行号"));
    }

    // ── build_vision_accuracy_single_turn_rule ──
    #[test]
    fn test_build_vision_accuracy_single_turn_rule() {
        let hint = build_vision_accuracy_single_turn_rule();
        assert!(hint.contains("准确度"));
    }

    // ── build_consultative_ui_appearance_hint ──
    #[test]
    fn test_build_consultative_ui_appearance_hint() {
        let hint = build_consultative_ui_appearance_hint();
        assert!(hint.contains("grep"));
        assert!(hint.contains("read_file"));
        assert!(hint.contains("源码"));
    }
}
