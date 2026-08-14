//! Exploration budget constants & nudge builders.
//! Ported from server/agentExplorationBudget.ts + agentExploreGuard.ts

// ── Turn budgets (consecutive read-only turns before nudge) ──
pub const INTERACTIVE_EXPLORE_TURN_BUDGET: u32 = 2;
pub const EXECUTE_PLAN_EXPLORE_TURN_BUDGET: u32 = 1;
pub const PLAN_EXPLORE_TURN_BUDGET: u32 = 3;
pub const ASK_EXPLORE_TURN_BUDGET: u32 = 5;
pub const CONSULTATIVE_BUILD_EXPLORE_TURN_BUDGET: u32 = 4;
pub const EXPLORE_EXPLORE_TURN_BUDGET: u32 = 6;

// ── Soft/hard caps per mode ──
pub const PLAN_MAX_TOTAL_EXPLORE_SOFT: u32 = 8;
pub const PLAN_MAX_TOTAL_EXPLORE_HARD: u32 = 12;
pub const ASK_MAX_TOTAL_EXPLORE_SOFT: u32 = 12;
pub const ASK_MAX_TOTAL_EXPLORE_HARD: u32 = 20;
pub const EXPLORE_MAX_TOTAL_EXPLORE_SOFT: u32 = 10;
pub const EXPLORE_MAX_TOTAL_EXPLORE_HARD: u32 = 14;

// ── File read guards ──
pub const BUILD_MAX_READ_FILE_REPEATS: u32 = 3;
pub const MAX_UNIQUE_READ_FILES_BEFORE_NUDGE: u32 = 4;

// ── Misc ──
pub const MAX_CONSECUTIVE_RUNTIME_TOOL_FAILURE_TURNS: u32 = 3;
pub const EXPLORE_INTERIM_DIAGNOSIS_TURN: u32 = 4;
pub const MAX_AUTO_BUG_FIX_WRITES: u32 = 5;
pub const AUTO_BUG_FIX_WALL_CLOCK_MS: u128 = 10 * 60 * 1000;
pub const AUTO_BUG_FIX_LOGIC_REVIEW_MARKER: &str = "[AUTO_BUG_FIX_LOGIC_REVIEW]";

pub fn get_explore_budget(mode: &str) -> u32 {
    match mode {
        "ask" => ASK_EXPLORE_TURN_BUDGET,
        "plan" => PLAN_EXPLORE_TURN_BUDGET,
        "explore" => EXPLORE_EXPLORE_TURN_BUDGET,
        _ => INTERACTIVE_EXPLORE_TURN_BUDGET, // build
    }
}

/// Consecutive read-only turns before budget nudge (matches Node `exploreTurnBudget`).
pub fn resolve_explore_turn_budget(
    is_explore: bool,
    is_execute_plan: bool,
    is_plan_explore: bool,
) -> u32 {
    if is_explore {
        EXPLORE_EXPLORE_TURN_BUDGET
    } else if is_execute_plan {
        EXECUTE_PLAN_EXPLORE_TURN_BUDGET
    } else if is_plan_explore {
        PLAN_EXPLORE_TURN_BUDGET
    } else {
        INTERACTIVE_EXPLORE_TURN_BUDGET
    }
}

pub fn get_soft_cap(mode: &str) -> u32 {
    match mode {
        "ask" => ASK_MAX_TOTAL_EXPLORE_SOFT,
        "plan" => PLAN_MAX_TOTAL_EXPLORE_SOFT,
        "explore" => EXPLORE_MAX_TOTAL_EXPLORE_SOFT,
        _ => crate::agent::policy::MAX_TOTAL_EXPLORE_TURNS_SOFT,
    }
}

pub fn get_hard_cap(mode: &str) -> u32 {
    match mode {
        "ask" => ASK_MAX_TOTAL_EXPLORE_HARD,
        "plan" => PLAN_MAX_TOTAL_EXPLORE_HARD,
        "explore" => EXPLORE_MAX_TOTAL_EXPLORE_HARD,
        _ => crate::agent::policy::MAX_TOTAL_EXPLORE_TURNS,
    }
}

pub fn is_exploration_archive_path(file_path: &str) -> bool {
    file_path.replace('\\', "/").contains(".aiall/exploration/")
}

pub fn is_productive_write_path(file_path: &str) -> bool {
    !is_exploration_archive_path(file_path)
}

/// Build nudge when consecutive explore-only turns exceed budget (Node `buildExploreBudgetNudge`).
pub fn build_explore_budget_nudge(consecutive_turns: u32, mode: &str) -> String {
    let action_hint = if mode == "plan" {
        "请立即输出结构化修改方案（文件清单 + 代码块 + 改动说明），不要再继续读文件。"
    } else if mode == "build" {
        "下一轮必须调用 patch_file 或 write_file；若目标文件已 read 过，直接改，不要再 grep/read。\n\
     若仍缺路径：最多 1 次 grep/search，然后立即修改。\n\
     禁止重复 read 同一文件相同片段；禁止用英文写长分析。\n\
     先用 1–2 句中文写根因假设，然后直接改代码。\n\n\
     ⚠️ Build 模式下分析不是产出，patch 才是产出。"
    } else {
        "下一轮必须调用 patch_file 或 write_file；若目标文件已 read 过，直接改，不要再 grep/read。\n\
     若仍缺路径：最多 1 次 grep/search，然后立即修改。\n\
     禁止重复 read 同一文件相同片段；禁止用英文写长分析。\n\
     先用 2–4 句中文写可见进度（根因假设 + 下一步），再调用工具。\n\n\
     💡 提示：如果问题表现为「点击没反应」「按钮不工作」等前端交互异常，\
     优先请用户打开浏览器 DevTools Console 查看报错信息——这比读代码更快定位根因。"
    };
    format!("【系统提示】已连续 {consecutive_turns} 轮仅探索、尚未修改。\n{action_hint}")
}

pub fn build_ask_explore_budget_nudge(consecutive_turns: u32) -> String {
    format!(
        "【系统提示】Ask 模式已连续 {consecutive_turns} 轮仅探索、尚未给出回答。\n\
     请基于已读内容立即输出完整自然语言答案。\n\
     若仍缺关键片段：最多再 read 一次目标文件的连续逻辑块（勿重叠小 window 反复 read）。\n\
     禁止无意义续搜；回答时区分各 API 入口的写/回滚/不写行为，条件用 AND 列全。"
    )
}

pub fn build_consultative_explore_budget_nudge(consecutive_turns: u32) -> String {
    format!(
        "【系统提示】咨询只读已连续 {consecutive_turns} 轮探索、尚未给出回答。\n\
     请基于已有 grep/read 证据立即输出自然语言结论；禁止继续广搜或同一文件重叠 read。\n\
     行为/是否类：若已 grep 到底层符号，须 read 其直接调用方后再答；仍不足则说明「无法确认」。"
    )
}

pub fn build_explore_explore_budget_nudge(consecutive_turns: u32) -> String {
    format!(
        "【系统提示】Explore 模式已连续 {consecutive_turns} 轮仅探索、尚未输出报告。\n\
     请基于已读内容立即输出或更新项目理解报告（含 <!-- project-report --> 标记）。\n\
     若仍缺关键片段：最多再 read 1–2 个代表文件，禁止重叠小 window 反复 read。"
    )
}

pub fn build_ask_explore_soft_cap_nudge(total_explore: u32) -> String {
    format!(
    "【系统提示】Ask 模式已累计 {total_explore} 轮探索（超过 {ASK_MAX_TOTAL_EXPLORE_SOFT}）。\n\
     已移除 grep / search_files，只能 read_file 做最后确认。\n\
     下一轮必须输出完整文字回答，不要再调用工具。"
  )
}

pub fn build_explore_explore_soft_cap_nudge(total_explore: u32) -> String {
    format!(
    "【系统提示】Explore 模式已累计 {total_explore} 轮探索（超过 {EXPLORE_MAX_TOTAL_EXPLORE_SOFT}）。\n\
     已移除 grep / search_files，只能 read_file 做最后确认。\n\
     下一轮必须输出完整项目理解报告，不要再调用工具。"
  )
}

pub fn build_explore_soft_cap_nudge(total_explore: u32, mode: &str) -> String {
    let action_hint = if mode == "plan" {
        "请基于已有信息输出结构化方案；本次已移除 grep/search_files，你只能 read_file 确认具体行号。"
    } else {
        "你已探索较多轮次（超过搜索预算）。本次移除了 grep / search_files，只能 read_file 确认具体位置。\n\
     若目标文件内容已明确：必须在本轮调用 patch_file / write_file 进行修改。"
    };
    format!(
        "【系统提示】已累计 {total_explore} 轮仅探索（超过搜索预算 {}）。\n\
     已移除 grep / search_files，只能 read_file 做最后确认。\n{action_hint}",
        crate::agent::policy::MAX_TOTAL_EXPLORE_TURNS_SOFT
    )
}

pub fn build_force_output_nudge(total_explore: u32, mode: &str) -> String {
    let action_hint = if mode == "plan" {
        "请基于已有信息，立即输出结构化修改方案（文件清单 + 代码块 + 改动说明）。不要再调用任何工具。"
    } else {
        "请基于已有信息，立即用中文输出完整结论。不要再调用任何工具。"
    };
    format!(
        "【系统强制】已累计 {total_explore} 轮仅探索（超过上限 {}）。\n\
     下一轮已移除所有工具，你只能输出文字。\n{action_hint}",
        crate::agent::policy::MAX_TOTAL_EXPLORE_TURNS
    )
}

pub fn build_file_breadth_nudge(unique_read_files: &[String], mode: &str) -> String {
    let file_list = unique_read_files
        .iter()
        .rev()
        .take(4)
        .rev()
        .cloned()
        .collect::<Vec<_>>()
        .join("、");
    let action_hint = if mode == "plan" {
        "请基于以上已读文件立即输出结构化方案，不要再读新文件。"
    } else {
        "请基于以上已读文件确定下一步操作。如果需要修改，请直接 patch；\
     如果还需要信息，请在已读文件中搜索而非打开新文件。\n\n\
     💡 如果任务是一类前端交互问题（点击没反应 / 样式异常），\
     优先怀疑 JS 运行时错误（Console 报错）或最近一次改动引入的副作用，而非大范围探索代码。"
    };
    format!(
        "【系统提示】已探索 {} 个不同文件（{file_list} 等）。\n\
     请缩小范围，聚焦在已读文件中定位问题。\n{action_hint}",
        unique_read_files.len()
    )
}

pub fn build_explore_interim_diagnosis_nudge(total_explore: u32) -> String {
    format!(
    "【系统提示】已累计 {total_explore} 轮探索且尚未修改或给出结论。\n\
     下一轮开始须以 `<!-- agent-progress -->` 开头，随后用中文输出一段用户可见的进度摘要（2–4 句）：\n\
     ① 当前根因假设（须基于已读/grep 证据，禁止臆测未出现的符号或错误）；\
     ② 已读过哪些关键文件/行号；③ 下一步是 patch 还是仍需一次 read。\n\
     摘要写完后才能继续调用工具；禁止仅用英文 \"Now let me...\" 句式。\n\
     若 grep 零命中，或 read 片段与当前假设（错误类型/文件区域）不符，须在摘要中更正假设，勿重复已证伪方向。\n\
     若已足够定位问题，本轮必须 patch_file / write_file。"
  )
}

pub fn build_user_negation_nudge(negation_count: u32) -> String {
    format!(
    "【系统提示】用户已连续 {negation_count} 次表达不满（\"不好看\"/\"换一种\"等）。\n\
     当前设计方向不被认可，请立即停止在当前方向上微调。\n\
     下一轮必须：\n\
     1. 提出 2-3 个完全不同设计风格的方案（如：从圆形→胶囊形、从实心→线框、从纯色→渐变等形态级变化）\n\
     2. 用简短文字描述每个方案的视觉特点，让用户选择\n\
     3. 不要直接执行修改，先让用户确认方向\n\
     禁止继续调整当前方案的参数（颜色/大小/圆角等），必须切换设计方向。"
  )
}

pub fn build_same_issue_follow_up_force_summary_nudge(total_explore: u32) -> String {
    format!(
        "【系统强制·同问题追问】已累计 {total_explore} 轮探索且尚未提交有效代码修改。\n\
     下一轮已移除 read/grep/search；你必须用中文输出结构化结论：\n\
     ① 前轮修复覆盖了什么、遗漏了什么；② 各可见症状在调用链上的状态（已确认/未验证/仍异常）；\
     ③ 若需继续改代码，列出目标文件与改动要点（下轮再 patch）。\n\
     禁止继续探索或写探索笔记；禁止再次无依据宣称「修复完成」。"
    )
}

pub fn build_plan_revision_follow_up_hint() -> &'static str {
    "【方案修订】用户引用了当前方案中的一段并提出了修改意见。\n\
   须先 read_file 该条方案对应的 `.aiall/plans/` 文件（路径见 planFilePath），或承接会话中上一版完整方案，在全文基础上按用户意见增删改。\n\
   下一轮必须输出完整结构化修改方案（`[PLAN]` 或 `## 修改方案` + 文件清单 + 代码块），禁止只回复「好的/已去掉」等短句。\n\
   除非用户明确要求大范围重构，否则勿重新广泛探索；优先在既有方案上修订。"
}

pub fn build_plan_quote_informational_hint() -> &'static str {
    "【方案答疑】用户引用了当前方案中的一段并提问，未要求修改方案。\n\
   须 read_file/grep 相关代码或配置核实引用内容的行为（如日志落盘位置、配置项、调用链），在会话中用中文直接回答。\n\
   禁止输出 `[PLAN]` / `## 修改方案` / 文件清单 / 完整修订方案；勿改动 `.aiall/plans/` 下方案文件。\n\
   回答 2–8 句即可，可引用路径或配置键；探索够了立即作答，不要凑方案格式。"
}

pub fn build_plan_no_target_path_hint() -> &'static str {
    "【规划提示】用户未指明具体文件/模块路径。\n\
   请根据需求判断：若与当前仓库无关或是新建独立工程/服务，可直接输出脚手架方案，勿深入扫描无关目录；\n\
   若存在无法从仓库佐证的歧义术语/专有名词，须先走澄清流向用户提问，禁止猜测其含义后直接写方案；\n\
   若需对齐现有约定，最多 list_dir 一次后 read 关键入口文件，然后输出方案。"
}

pub fn build_ambiguous_term_clarification_hint(terms: &[String]) -> String {
    let listed = terms
        .iter()
        .map(|term| format!("「{term}」"))
        .collect::<Vec<_>>()
        .join("、");
    format!(
    "【歧义词澄清·强制】用户消息含当前仓库无法佐证含义的术语：{listed}。\n\
     当前项目无可见业务代码可消歧，禁止猜测其指代（如臆测为某类技术栈、某个外部系统名、某个产品代号等）。\n\
     本轮须用中文向用户提出 1–3 个澄清问题（须覆盖上述术语的可能含义与边界），禁止输出 `[PLAN]` / `## 修改方案` 或完整脚手架/示例 API。\n\
     每个问题单独一段，标题行用「**1. …？**」格式；下一行起列出 2–4 个编号选项（1. 2. 3. 单独成行，每项不超过 60 字，供聊天区按钮点击），最后一项可为「其他（请说明）」；禁止用 - 子弹列表代替选项。\n\
     探索预算至少保留 1 轮用于澄清问答；收到用户明确答复后再探索或输出方案。"
  )
}

pub fn build_ambiguous_term_clarification_retry_nudge(terms: &[String]) -> String {
    let listed = terms
        .iter()
        .map(|term| format!("「{term}」"))
        .collect::<Vec<_>>()
        .join("、");
    format!(
    "【系统强制·歧义词澄清】上一轮在未澄清 {listed} 的情况下输出了方案或脚手架代码。\n\
     禁止猜测；请立即改为仅向用户提问（1–3 个中文问句，覆盖术语可能含义），\
     每个问题附 2–4 个编号选项（1. 2. 3. 单独成行）供聊天区点击；不要 bullet 列表、不要代码块、不要文件清单。"
  )
}

pub fn build_explore_abort_partial_report_nudge(read_count: usize) -> String {
    if read_count == 0 {
        "【提前结束】用户在探索开始前就停止了，尚未读取任何项目文件。\n\
     不要输出知识库正文，也不要生成 `## 章节` 占位；如此时无任何探索证据，\
     请直接以一句中文简述中止原因（例如「探索未开始即被中止」）。\n\
     禁止编造未读代码的章节内容。"
            .to_string()
    } else {
        format!(
            "【提前结束】用户已停止探索（已读约 {read_count} 个文件）。\n\
       请基于已有证据输出不完整版项目知识库（保留 project-knowledge 标记）。\n\
       未覆盖的章节在 `## 标题` 末尾加（未探索）；禁止空回复。"
        )
    }
}

/// Build nudge when total explore turns reach soft cap (legacy helper).
pub fn build_soft_cap_nudge(total_explore: u32, mode: &str) -> Option<String> {
    let soft = get_soft_cap(mode);
    if total_explore >= soft && total_explore < get_hard_cap(mode) {
        Some(build_explore_soft_cap_nudge(total_explore, mode))
    } else {
        None
    }
}

pub fn build_consultative_segment_cap_nudge(turn: u32, total_explore_turns: u32) -> String {
    format!(
    "【系统提示】咨询只读已达第 {turn} 轮段内上限（累计探索 {total_explore_turns} 轮）。\
     下一轮必须输出最终中文结论；若 CSS/逻辑证据不足，说明已确认部分与仍不确定部分，禁止写「下一轮再确认」。"
  )
}

pub fn build_plan_segment_cap_nudge(turn: u32, total_explore_turns: u32) -> String {
    format!(
    "【系统提示·Plan】规划阶段已达第 {turn} 轮段内上限（累计探索 {total_explore_turns} 轮）。\
     下一轮必须输出结构化修改方案（`[PLAN]` 或 `## 修改方案` + 文件清单 + 代码块）；禁止再调用工具。"
  )
}

pub fn build_plan_force_answer_nudge(total_explore_turns: u32) -> String {
    format!(
        "【系统强制·Plan】已累计 {total_explore_turns} 轮只读探索，规划阶段必须结案。\
     下一轮已移除所有工具，你只能输出文字。\
     请立即输出结构化修改方案（`[PLAN]` 或 `## 修改方案` + 文件清单 + 代码块 + 改动说明）。\
     若需求是新建独立项目/模块，直接给出脚手架与目录结构方案，勿再 list_dir/read。"
    )
}

pub fn build_ask_force_answer_nudge(total_explore_turns: u32) -> String {
    format!(
    "【系统强制】Ask 模式已累计 {total_explore_turns} 轮探索（超过 {ASK_MAX_TOTAL_EXPLORE_HARD}）。\
     下一轮已移除所有工具，你只能输出文字。\
     请基于已有信息给出完整结论；若信息不足，说明已确认部分与仍不确定部分。"
  )
}

pub fn build_explore_force_report_nudge(total_explore_turns: u32) -> String {
    format!(
    "【系统强制】Explore 模式已累计 {total_explore_turns} 轮探索（超过 {EXPLORE_MAX_TOTAL_EXPLORE_HARD}）。\
     下一轮已移除所有工具，你只能输出文字。\
     请基于已有信息输出完整项目理解报告；未覆盖章节在 `## 标题` 末尾加（未探索）。"
  )
}

pub fn build_segment_emergency_finish_nudge(remaining_turns: u32) -> String {
    format!(
        "【紧急提示】剩余 {remaining_turns} 轮。请优先 patch_file 完成必要修改，然后输出中文总结；\
     若任务已完成，直接写总结（已改文件、验证方式、剩余问题）。"
    )
}

pub fn build_turn_cap_final_summary_nudge(
    completed_turn: u32,
    written_files: &[String],
    attempt: u32,
) -> String {
    let files = if written_files.is_empty() {
        "若尚未改代码，说明阻塞点。".to_string()
    } else {
        format!("已改文件：{}。", written_files.join("、"))
    };
    let urgency = if attempt >= 2 {
        "【最后机会·禁止再调工具】这是收尾轮：必须输出 isFinal 级完整中文总结，否则任务将标记为未完成。"
    } else {
        "【系统强制·收尾】段内轮次已用尽，下一轮禁止调用工具。"
    };
    format!(
    "{urgency}（累计 {completed_turn} 轮）\
     必须用中文输出结构化总结：① 做了什么/改了哪些文件；② 如何验证（命令或手动步骤）；③ 仍存问题或未修项。\
     {files}\
     禁止空回复；禁止仅重复 progress 块而不给用户可见结论。\
     若本轮未改任何代码：禁止以「请手动执行/另开对话粘贴」收尾；须说明真实阻塞点。"
  )
}

pub fn build_grep_empty_recovery_nudge(patterns: &[String]) -> String {
    let listed = patterns
        .iter()
        .take(3)
        .map(|p| format!("`{p}`"))
        .collect::<Vec<_>>()
        .join("、");
    format!(
    "【系统提示】本轮 grep 未找到匹配：{listed}。\
     禁止重复相同 pattern；请改用精确函数/导出名、调用方符号，或更短的英文标识符。\
     行为类问题：底层未命中时应根据已知符号继续 grep 相关调用方或上层处理逻辑，再 read；禁止广搜凑轮次。"
  )
}

pub fn build_read_file_failed_recovery_nudge(failed_paths: &[String]) -> String {
    let listed = failed_paths
        .iter()
        .take(3)
        .map(|p| format!("`{p}`"))
        .collect::<Vec<_>>()
        .join("、");
    format!(
        "【系统提示】本轮 read_file 失败：{listed}。\
     禁止重复 read 同一路径；禁止在答复中引用该路径下的行号或符号。\
     请根据已知的可见文本、结构标识或调用关系重新定位，read 成功后再引用代码。\
     若会话 history 中 assistant 曾引用不存在路径，须显式更正，勿沿用。"
    )
}

pub fn build_runtime_tool_failure_recovery_nudge(
    consecutive_skipped: u32,
    forced_count: bool,
) -> String {
    if forced_count {
        format!(
      "【系统提示】工具已连续 {consecutive_skipped} 轮运行时异常失败，本轮计入探索预算以防卡死。\
       请改换工具或 pattern 重试；若仍失败，基于已有证据作答并标明未能读码确认的部分。"
    )
    } else {
        format!(
      "【系统提示】本轮工具因环境/运行时异常失败（第 {consecutive_skipped}/{MAX_CONSECUTIVE_RUNTIME_TOOL_FAILURE_TURNS} 次豁免），不计入探索轮次。\
       请改换 grep 符号或 read 已知路径重试；勿重复相同调用。"
    )
    }
}

pub fn build_consultative_duplicate_explore_nudge() -> &'static str {
    "【系统提示】你已重复执行相同的 grep/read 组合，且工具结果未变。\
   禁止再调用工具；请基于已有 read/grep 输出立即给出最终中文答案。\
   若 CSS 已在工具结果中，直接引用 background / var(--*) 作答，勿重复读同一文件。"
}

pub fn build_exploration_archive_write_blocked_message() -> &'static str {
    "错误：探索归档路径（.aiall/exploration/）禁止写入；请写入项目源码或输出文字总结。"
}

pub fn build_build_explore_force_patch_nudge(total_explore_turns: u32) -> String {
    format!(
    "【系统强制·Build】已累计 {total_explore_turns} 轮探索且尚未改代码（超过上限 {hard_cap}）。\
     你已判断需要修改时，下一轮只能调用 patch_file / write_file / delete_file；禁止 grep / read_file / search。\
     必须直接提交代码修改并简要说明；禁止只输出 patch 思路或反问「需要我执行吗」。\
     禁止再读文件——你已有足够信息，立即改。",
    hard_cap = crate::agent::policy::MAX_TOTAL_EXPLORE_TURNS
  )
}

pub fn build_patch_required_retry_nudge() -> &'static str {
    "【系统强制】上一轮在必须改代码时你只输出了分析/读图复述，任务未完成。\
   请立即调用 patch_file 或 write_file 修复；回复中说明改动要点，勿再复述截图或根因猜测。"
}

pub fn build_grep_hit_vue_read_nudge(vue_files: &[String]) -> String {
    let primary = vue_files
        .iter()
        .take(2)
        .cloned()
        .collect::<Vec<_>>()
        .join("、");
    format!(
    "【系统提示】grep 已定位组件文件：{primary}。下一轮须 read_file 该文件（含 template 与 `<style>` 段），再答样式/观感问题；禁止只 read 引用它的父视图。"
  )
}

pub fn build_alternate_ui_patch_strategy_nudge(file_path: &str) -> String {
    format!(
    "【系统提示】{file_path} 已连续多次 patch_file 失败（old_string 不匹配）。\
     禁止凭记忆再构造 old_string；read_file 后从返回原文复制更短且唯一的片段；或一次读更大范围（300–500 行）。\
     若 patch 仍失败：对小型已读文件可用 write_file 写回完整内容；Windows 注意 \\r\\n。\
     若属 UI 浮层/滚动区问题，考虑换 overlay sibling 方案，勿再微调同一组 position/bottom。"
  )
}

pub fn build_turn_patch_failure_nudge(failure_count: usize, failed_files: &str) -> String {
    format!(
    "【系统纠正】本轮 {failure_count} 个 patch_file 调用失败（文件：{failed_files}）。\
     请 read_file 重新读取；从返回原文复制更短且唯一的 old_string 再 patch（Windows 磁盘文件常为 \\r\\n，工具会自动尝试 EOL 归一化）。\
     若仍失败且改动范围小：可对已 read 的完整文件用 write_file 局部替换后写回。禁止凭记忆构造 old_string。"
  )
}

pub fn build_modification_audit_message(
    success_count: usize,
    success_paths: &[String],
    fail_count: usize,
    fail_files: &str,
) -> String {
    let success_list = if success_paths.is_empty() {
        "无".to_string()
    } else {
        success_paths.join("、")
    };
    format!(
    "【修改审计】本轮会话中：{success_count} 个文件修改成功（{success_list}），\
    {fail_count} 个 patch_file 调用失败（{fail_files}）。\
    在最终回复的总结中，只可声称上述成功修改的文件已完成；失败的修改必须如实标注'未生效'或'失败'，禁止虚假声称已完成。"
  )
}

pub fn build_patch_failure_completion_retry_nudge(
    failed_paths: &[String],
    success_paths: &[String],
) -> String {
    let failed = failed_paths
        .iter()
        .filter(|p| !p.is_empty())
        .cloned()
        .collect::<Vec<_>>()
        .join("、");
    let failed = if failed.is_empty() {
        "未知".to_string()
    } else {
        failed
    };
    let success = success_paths
        .iter()
        .filter(|p| !p.is_empty())
        .cloned()
        .collect::<Vec<_>>()
        .join("、");
    let success = if success.is_empty() {
        "无".to_string()
    } else {
        success
    };
    format!(
    "【系统强制·修改审计】你宣称已完成，但本轮会话存在 patch_file 失败，禁止把部分成功说成「全部完成」。失败文件：{failed}；已成功：{success}。须列出失败项与原因（old_string 不匹配等），read 后重试 patch 或换方案；若用户仍报告无效，用分症状排查，禁止「无需修改/没有 bug」。"
  )
}

pub fn build_auto_bug_fix_empty_reply_nudge() -> &'static str {
    "【系统强制·扫描修复】禁止空回复结束。\
   须用中文输出修复总结，至少包含：① 已修复项（文件+问题）② 跳过/待验证项 ③ 是否已 run_command 复验及结果。\
   若无须修改：说明审查范围与结论；若仍须工具，先写 1–2 句进度再调用。"
}

pub fn build_premature_completion_retry_nudge(user_reported_failure: bool) -> String {
    let mut lines = vec![
    "【系统强制】上一轮回复过早宣称「全部正确/无需再改/检查完成✅」，但缺乏工具证据或用户实测仍失败。".to_string(),
    "禁止 rubber-stamp 式自检；须基于 read/grep 结果与用户反馈逐项核对。".to_string(),
    "未验证项写「无法确认」；失败项如实标注；区分主路径效果与降级/兜底 UI。".to_string(),
  ];
    if user_reported_failure {
        lines.push(
            "用户已报告「试了不行/没有效果」——禁止重复宣称成功，须换排查方向或给出可执行验证步骤。"
                .to_string(),
        );
    }
    lines.join("")
}

/// Build nudge when agent claims completion without writing anything
pub fn build_empty_reply_retry_nudge() -> &'static str {
    "【系统强制】你的回复为空或仅包含确认语句。请根据用户需求输出有效内容，禁止空回复结束。"
}

/// Build nudge for premature completion (rubber-stamping)
pub fn build_premature_completion_retry_nudge_simple() -> &'static str {
    "你似乎过早地确认了完成。请检查是否所有需求都已满足，必要时继续修改。"
}

pub fn build_ui_defect_force_patch_nudge(total_explore_turns: u32) -> String {
    format!(
        "【系统强制】UI 缺陷任务已累计 {total_explore_turns} 轮探索且已定位相关代码。\
     下一轮只能调用 patch_file / write_file / delete_file；禁止 grep / read_file / search。\
     必须直接修复并简要说明改动；禁止只输出分析或反问「要不要修」。"
    )
}

pub fn build_patch_anchor_force_patch_nudge() -> &'static str {
    "【系统强制·已定位】浮层/选区定位函数已在工具结果中出现。\
   下一轮只能调用 patch_file / write_file / delete_file，禁止任何 read/grep/search。\
   禁止重复输出截图分析；须直接提交代码修改。"
}

pub fn build_code_review_honesty_nudge(user_reported_failure: bool) -> String {
    let mut lines = vec![
        String::new(),
        "【代码核对·只读】用户要求检查/核对实现，不是索要肯定答复。".to_string(),
        "须 read/grep 对照仓库现状；结论分「已确认」「未验证」「与用户反馈矛盾」三类。".to_string(),
        "禁止在未对照工具结果前写「全部正确✅/无逻辑漏洞/可以测试了」。".to_string(),
    ];
    if user_reported_failure {
        lines
            .push("用户近期报告实测失败：优先排查为何无效，勿重复「链路完整」类总结。".to_string());
    }
    lines.join("\n")
}

pub fn build_user_error_quote_hint() -> &'static str {
    "\n【用户可能在复述报错/横幅】本条短消息可能是用户粘贴他们看到的提示文案，而非要求原样实现该文案。\
   先判断：是在报告问题、询问含义，还是要求新增该提示？\
   若是报告问题：定位根因并修复底层能力；若是询问：解释含义；勿把报错文本当作产品需求直接复刻。"
}

fn build_ui_symptom_diagnosis_hint() -> &'static str {
    "【UI 分症状排查】禁止在同一文件反复微调同一组定位属性；按序核对（勿预设修法）：\
   ① v-if/显示条件与 scroll/resize 事件是否更新；② 控件是否在 overflow 滚动子树内（浮层是否应作 sibling overlay）；\
   ③ 外框可见但符号/文字空白：grep/read 全局 element 选择器与组件 scoped 样式，核对尺寸/padding/box-sizing 是否互相裁切，并查内层 text/SVG；勿只改单一装饰属性；\
   ④ 给出用户可复现验证步骤（含当前 tab/模式前提）。"
}

pub fn build_user_failure_report_nudge() -> String {
    format!(
    "\n【实测失败反馈】用户报告先前改动未达预期（试了不行/没有效果等）。\
     禁止再次输出「已完成/无需再改」式总结；须：①承认未验证或仍失败；②列出与预期不符的具体点；③给出下一步排查或不同方案。\
     若涉及原生/系统能力，先确认运行环境（Web dev vs 桌面壳）是否匹配测试方式。\n{}",
    build_ui_symptom_diagnosis_hint()
  )
}

pub fn build_same_issue_follow_up_hint() -> String {
    format!(
    "\n【同问题追问·前轮已宣称修复】用户在同一会话继续报告异常或质疑修复是否完整。\
     ① 先回顾前轮改了什么、针对哪个可见症状；列出仍存疑的现象，勿假设已解决。\
     ② 围绕用户现象核对相关状态、数据、调用关系与最终结果；禁止只改表层而忽略决定行为的默认值、数据投影、切换或路由等关联逻辑。\
     ③ patch 前 grep import 确认运行时入口；未引用的同名/近似路径文件勿改。\
     ④ 若前轮修复不完整须显式承认并扩大范围；禁止再次无验证「修复完成」。\
     ⑤ 探索预算收紧：基于会话已有上下文优先 patch 或分症状结论，禁止从零广搜全链路。\
     禁止 write_file 写探索笔记或归档 markdown；结论直接用于 patch 或用户可见回复。\n{}",
    build_ui_symptom_diagnosis_hint()
  )
}

pub fn build_ultra_short_open_task_hint() -> &'static str {
    "\n【超短任务·范围澄清】用户指令极短且未指明具体现象/文件/模块。\
   第一步：用 1 句中文说明你的假设（验证脚本 / 运行时 / 当前打开文件 / 用户描述的现象等），再选一条路径执行；\
   禁止无假设地广搜目录；优先读 package.json scripts，选用项目已有的 verify 命令（test/lint/typecheck/check），再 grep 精确符号。\
   每轮 progress 须区分「已证实」与「待验证」；命令失败时勿宣称已看到完整错误列表。"
}

pub fn build_implement_follow_up_hint(quote_position_fix: bool) -> String {
    let mut lines = vec![
        String::new(),
        "【确认执行·须改代码】用户在上文分析或部分实施后要求继续修复/改吧，不是再要一篇分析。"
            .to_string(),
        "最多 1–2 次 read_file 核对目标后即 patch_file/write_file；禁止只分析并反问「要不要修」。"
            .to_string(),
        "禁止输出「请将以下修改应用到…」或只贴代码块让用户手动改；你必须亲自提交 patch。"
            .to_string(),
    ];
    if quote_position_fix {
        lines.push(
            "最多 1 次 read_file 核对上文已定位的目标函数；禁止重复 grep 已讨论过的定位问题。"
                .to_string(),
        );
        lines.push("优先改上文已识别的目标文件和函数。".to_string());
    }
    lines.join("\n")
}

pub fn build_automated_bug_fix_hint(
    verify_script: Option<&str>,
    include_logic_review: bool,
) -> String {
    let verify_line = verify_script
        .filter(|s| !s.is_empty())
        .map(|script| format!("修复后须 run_command `{script}` 复验；"))
        .unwrap_or_else(|| "修复后须 run_command 复验或 read_file 核对；".to_string());
    let write_line = if include_logic_review {
        format!(
      "单轮最多修改 {MAX_AUTO_BUG_FIX_WRITES} 个文件；逻辑审查项须 read 确认，无清单路径时可从入口探索。"
    )
    } else {
        format!("单轮最多修改 {MAX_AUTO_BUG_FIX_WRITES} 个文件；仅可 patch 目标清单内路径。")
    };
    [
        "",
        "【扫描与测试修复】",
        "仅修复任务清单内项；禁止重构、重命名、格式化或改无关文件。",
        &format!("流程：read_file 核实 → patch_file（局部优先）→ {verify_line}"),
        "grep 圈定项须 read 确认；误报跳过并说明。",
        &write_line,
    ]
    .join("\n")
}

/// Check if text indicates premature completion
pub fn claims_premature_completion(text: &str) -> bool {
    let t = text.trim().to_lowercase();
    t.len() < 30 && (t.contains("已完成") || t.contains("done") || t.contains("完成"))
}

/// Check if text indicates write completion
pub fn claims_write_completion(text: &str) -> bool {
    let t = text.trim().to_lowercase();
    t.contains("已写入")
        || t.contains("已修改")
        || t.contains("已创建")
        || t.contains("written")
        || t.contains("modified")
        || t.contains("created")
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── get_explore_budget ──
    #[test]
    fn test_get_explore_budget_ask() {
        assert_eq!(get_explore_budget("ask"), ASK_EXPLORE_TURN_BUDGET);
    }

    #[test]
    fn test_get_explore_budget_plan() {
        assert_eq!(get_explore_budget("plan"), PLAN_EXPLORE_TURN_BUDGET);
    }

    #[test]
    fn test_get_explore_budget_explore() {
        assert_eq!(get_explore_budget("explore"), EXPLORE_EXPLORE_TURN_BUDGET);
    }

    #[test]
    fn test_get_explore_budget_build_default() {
        assert_eq!(get_explore_budget("build"), INTERACTIVE_EXPLORE_TURN_BUDGET);
    }

    #[test]
    fn test_get_explore_budget_unknown_defaults_to_build() {
        assert_eq!(
            get_explore_budget("unknown"),
            INTERACTIVE_EXPLORE_TURN_BUDGET
        );
    }

    // ── get_soft_cap ──
    #[test]
    fn test_get_soft_cap_ask() {
        assert_eq!(get_soft_cap("ask"), ASK_MAX_TOTAL_EXPLORE_SOFT);
    }

    #[test]
    fn test_get_soft_cap_plan() {
        assert_eq!(get_soft_cap("plan"), PLAN_MAX_TOTAL_EXPLORE_SOFT);
    }

    #[test]
    fn test_get_soft_cap_explore() {
        assert_eq!(get_soft_cap("explore"), EXPLORE_MAX_TOTAL_EXPLORE_SOFT);
    }

    #[test]
    fn test_get_soft_cap_build() {
        assert_eq!(
            get_soft_cap("build"),
            crate::agent::policy::MAX_TOTAL_EXPLORE_TURNS_SOFT
        );
    }

    #[test]
    fn test_get_soft_cap_unknown_mode() {
        assert_eq!(
            get_soft_cap("gibberish"),
            crate::agent::policy::MAX_TOTAL_EXPLORE_TURNS_SOFT
        );
    }

    // ── get_hard_cap ──
    #[test]
    fn test_get_hard_cap_ask() {
        assert_eq!(get_hard_cap("ask"), ASK_MAX_TOTAL_EXPLORE_HARD);
    }

    #[test]
    fn test_get_hard_cap_plan() {
        assert_eq!(get_hard_cap("plan"), PLAN_MAX_TOTAL_EXPLORE_HARD);
    }

    #[test]
    fn test_get_hard_cap_explore() {
        assert_eq!(get_hard_cap("explore"), EXPLORE_MAX_TOTAL_EXPLORE_HARD);
    }

    #[test]
    fn test_get_hard_cap_build() {
        assert_eq!(
            get_hard_cap("build"),
            crate::agent::policy::MAX_TOTAL_EXPLORE_TURNS
        );
    }

    #[test]
    fn test_get_hard_cap_unknown_mode() {
        assert_eq!(
            get_hard_cap("unknown"),
            crate::agent::policy::MAX_TOTAL_EXPLORE_TURNS
        );
    }

    // ── is_exploration_archive_path ──
    #[test]
    fn test_is_exploration_archive_path_positive() {
        assert!(is_exploration_archive_path("foo/.aiall/exploration/bar.md"));
    }

    #[test]
    fn test_is_exploration_archive_path_positive_backslash() {
        assert!(is_exploration_archive_path(
            "foo\\.aiall\\exploration\\bar.md"
        ));
    }

    #[test]
    fn test_is_exploration_archive_path_negative() {
        assert!(!is_exploration_archive_path("src/main.rs"));
    }

    #[test]
    fn test_is_exploration_archive_path_negative_similar() {
        assert!(!is_exploration_archive_path(".aiall/plans/plan.md"));
    }

    // ── is_productive_write_path ──
    #[test]
    fn test_is_productive_write_path_archive_is_not_productive() {
        assert!(!is_productive_write_path("foo/.aiall/exploration/bar.md"));
    }

    #[test]
    fn test_is_productive_write_path_productive() {
        assert!(is_productive_write_path("src/main.rs"));
    }

    #[test]
    fn test_is_productive_write_path_root_file() {
        assert!(is_productive_write_path("Cargo.toml"));
    }

    // ── build_explore_budget_nudge ──
    #[test]
    fn test_build_explore_budget_nudge_contains_turn_count() {
        let msg = build_explore_budget_nudge(2, "build");
        assert!(msg.contains("已连续 2 轮"));
        assert!(msg.contains("patch_file"));
    }

    #[test]
    fn test_build_explore_budget_nudge_plan_mode() {
        let msg = build_explore_budget_nudge(3, "plan");
        assert!(msg.contains("结构化修改方案"));
        assert!(!msg.contains("项目理解报告"));
    }

    #[test]
    fn test_build_ask_explore_budget_nudge() {
        let msg = build_ask_explore_budget_nudge(5);
        assert!(msg.contains("Ask 模式"));
    }

    #[test]
    fn test_build_consultative_explore_budget_nudge() {
        let msg = build_consultative_explore_budget_nudge(4);
        assert!(msg.contains("咨询只读"));
    }

    #[test]
    fn test_resolve_explore_turn_budget_execute_plan() {
        assert_eq!(
            resolve_explore_turn_budget(false, true, false),
            EXECUTE_PLAN_EXPLORE_TURN_BUDGET
        );
    }

    // ── build_soft_cap_nudge ──
    #[test]
    fn test_build_soft_cap_nudge_under() {
        assert_eq!(build_soft_cap_nudge(5, "ask"), None);
    }

    #[test]
    fn test_build_soft_cap_nudge_at_soft() {
        let nudge = build_soft_cap_nudge(ASK_MAX_TOTAL_EXPLORE_SOFT, "ask");
        assert!(nudge.is_some());
    }

    #[test]
    fn test_build_soft_cap_nudge_at_hard_no_nudge() {
        assert_eq!(
            build_soft_cap_nudge(ASK_MAX_TOTAL_EXPLORE_HARD, "ask"),
            None
        );
    }

    #[test]
    fn test_build_soft_cap_nudge_between() {
        let nudge = build_soft_cap_nudge(ASK_MAX_TOTAL_EXPLORE_SOFT + 2, "ask");
        assert!(nudge.is_some());
    }

    #[test]
    fn test_build_soft_cap_nudge_plan_mode() {
        let nudge = build_soft_cap_nudge(PLAN_MAX_TOTAL_EXPLORE_SOFT, "plan");
        assert!(nudge.is_some());
        assert_eq!(
            build_soft_cap_nudge(PLAN_MAX_TOTAL_EXPLORE_SOFT - 1, "plan"),
            None
        );
    }

    // ── build_empty_reply_retry_nudge ──
    #[test]
    fn test_build_empty_reply_retry_nudge() {
        let msg = build_empty_reply_retry_nudge();
        assert!(!msg.is_empty());
        assert!(msg.contains("空"));
    }

    #[test]
    fn test_build_empty_reply_retry_nudge_consistent() {
        let msg = build_empty_reply_retry_nudge();
        assert_eq!(msg, build_empty_reply_retry_nudge());
    }

    // ── build_premature_completion_retry_nudge ──
    #[test]
    fn test_build_premature_completion_retry_nudge() {
        let msg = build_premature_completion_retry_nudge_simple();
        assert!(!msg.is_empty());
        assert!(msg.contains("过早"));
    }

    #[test]
    fn test_build_premature_completion_retry_nudge_consistent() {
        assert_eq!(
            build_premature_completion_retry_nudge_simple(),
            build_premature_completion_retry_nudge_simple()
        );
    }

    // ── claims_premature_completion ──
    #[test]
    fn test_claims_premature_completion_positive_chinese_complete() {
        assert!(claims_premature_completion("已完成"));
    }

    #[test]
    fn test_claims_premature_completion_positive_done() {
        assert!(claims_premature_completion("done"));
    }

    #[test]
    fn test_claims_premature_completion_positive_chinese_finish() {
        assert!(claims_premature_completion("完成"));
    }

    #[test]
    fn test_claims_premature_completion_negative_long_text() {
        assert!(!claims_premature_completion(
            "已完成所有修改，包括重构和测试。"
        ));
    }

    #[test]
    fn test_claims_premature_completion_negative_irrelevant() {
        assert!(!claims_premature_completion("继续探索项目结构"));
    }

    #[test]
    fn test_claims_premature_completion_empty() {
        assert!(!claims_premature_completion(""));
    }

    #[test]
    fn test_claims_premature_completion_whitespace() {
        assert!(!claims_premature_completion("  "));
    }

    #[test]
    fn test_claims_premature_completion_case_insensitive() {
        assert!(claims_premature_completion("Done"));
        assert!(claims_premature_completion("DONE"));
    }

    // ── claims_write_completion ──
    #[test]
    fn test_claims_write_completion_positive_written() {
        assert!(claims_write_completion("已写入"));
    }

    #[test]
    fn test_claims_write_completion_positive_modified() {
        assert!(claims_write_completion("已修改"));
    }

    #[test]
    fn test_claims_write_completion_positive_created() {
        assert!(claims_write_completion("已创建"));
    }

    #[test]
    fn test_claims_write_completion_positive_english_written() {
        assert!(claims_write_completion("written"));
    }

    #[test]
    fn test_claims_write_completion_positive_english_modified() {
        assert!(claims_write_completion("modified"));
    }

    #[test]
    fn test_claims_write_completion_positive_english_created() {
        assert!(claims_write_completion("created"));
    }

    #[test]
    fn test_claims_write_completion_negative() {
        assert!(!claims_write_completion("正在读取文件"));
    }

    #[test]
    fn test_claims_write_completion_empty() {
        assert!(!claims_write_completion(""));
    }

    #[test]
    fn test_claims_write_completion_whitespace() {
        assert!(!claims_write_completion("   "));
    }

    #[test]
    fn test_claims_write_completion_case_insensitive() {
        assert!(claims_write_completion("Written"));
        assert!(claims_write_completion("MODIFIED"));
    }

    #[test]
    fn test_claims_write_completion_in_sentence() {
        assert!(claims_write_completion("已写入文件 src/main.rs"));
    }

    #[test]
    fn test_build_grep_empty_recovery_nudge() {
        let nudge = build_grep_empty_recovery_nudge(&["switchFooContext".into(), "fooBar".into()]);
        assert!(nudge.contains("switchFooContext"));
        assert!(nudge.contains("禁止重复相同 pattern"));
        assert!(nudge.contains("相关调用方"));
    }

    #[test]
    fn test_build_read_file_failed_recovery_nudge() {
        let nudge = build_read_file_failed_recovery_nudge(&["src/missing.vue".into()]);
        assert!(nudge.contains("read_file 失败"));
        assert!(nudge.contains("禁止重复 read"));
    }

    #[test]
    fn test_build_runtime_tool_failure_recovery_nudge() {
        assert!(build_runtime_tool_failure_recovery_nudge(1, false).contains("不计入探索轮次"));
        assert!(build_runtime_tool_failure_recovery_nudge(3, true).contains("计入探索预算"));
    }

    #[test]
    fn test_build_consultative_segment_and_duplicate_nudges() {
        let cap = build_consultative_segment_cap_nudge(5, 8);
        assert!(cap.contains("咨询只读"));
        assert!(cap.contains("下一轮再确认"));
        assert!(build_consultative_duplicate_explore_nudge().contains("重复执行"));
        assert!(build_consultative_duplicate_explore_nudge().contains("禁止再调用工具"));
    }
}
