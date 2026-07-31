//! Tier 3 product hints injected into Agent system prompt (ported from userIntentHints.ts).

use super::exploration::{
    build_code_review_honesty_nudge, build_implement_follow_up_hint,
    build_same_issue_follow_up_hint, build_ultra_short_open_task_hint, build_user_error_quote_hint,
    build_user_failure_report_nudge,
};
use super::policy::AgentRunPolicy;
use super::quoted_amend::{QuotedAmendIntent, QuotedAmendKind};

pub fn build_quoted_amend_hint(resolved: &QuotedAmendIntent) -> String {
    let scope = resolved
        .scope_hint
        .as_deref()
        .map(|s| format!("scope「{s}」"))
        .unwrap_or_else(|| "引用行所指 scope".to_string());
    let symbols = if resolved.symbol_hints.is_empty() {
        "引用块中的目标符号".to_string()
    } else {
        resolved
            .symbol_hints
            .iter()
            .map(|s| format!("`{s}`"))
            .collect::<Vec<_>>()
            .join("、")
    };

    if resolved.kind == QuotedAmendKind::Remove {
        return [
      "",
      "【引用修订·删除】用户引用上一轮助手总结/代码块，短句是对引用内容的删除指令（不是新任务）。",
      &format!("须从 {scope} 删除 {symbols} 对应配置/代码块；禁止删除 {scope} 整段注册或服务块。"),
      "禁止在其它 scope 重新添加用户要求移除的符号；禁止把「也移除/不要这个」理解成删除整个 scope。",
      "patch 前 read 一次确认符号位置；完成后一句话说明已从哪段删除了哪些符号。",
    ]
    .join("\n");
    }

    [
        "",
        "【引用修订·添加】用户引用上一轮内容并要求补充添加。",
        &format!("在 {scope} 添加 {symbols}；勿扩大至未引用的 scope。"),
    ]
    .join("\n")
}

pub fn build_behavior_contradiction_hint() -> &'static str {
    "\n【现象与上轮矛盾】用户反馈的实际现象与上一条助手结论不符，或在质疑上一条结论/设计是否合理。\n\
   禁止维持上轮「不会/不更新/仅…/独立状态/不会有问题」等结论；须显式承认先前结论不完整或有误。\n\
   从实际相关符号重新 trace 调用关系，grep 命中后必须 read 完整函数体、直接调用方/被调用方与决定结果的分支；不假设固定目录、层数或中间层。\n\
   结论须附带代码中的 if/guard 前提；咨询只读时先给出更正后的根因，用户明确实施指令后再 patch。"
}

pub fn build_locate_status_follow_up_hint() -> &'static str {
    "【定位进度追问】用户仅问上一轮是否已在代码中定位到目标。\n\
   须直接引用上一条已给出的文件路径与样式/CSS 结论作答；禁止重复 grep/read 整文件。\n\
   若上一条已给出路径与样式证据，回答「是的，已在 … 中找到」并复述关键一行即可。"
}

pub fn build_ui_defect_build_hint() -> &'static str {
    "\n【UI 缺陷·须修复】用户用截图反馈控件/布局/交互异常。\n\
   须定位后 patch_file/write_file；禁止只分析并反问「要不要修」。\n\
   诊断清单（按序核对，勿预设修法）：\n\
   1. 读图：描述所见；判断是否本项目 UI（查 AGENTS.md / 已注入项目结构中的 UI 源码目录），勿默认外部 IDE。\n\
   2. 定位：grep 图中可见原文最短片段（≥3 字）定位 template/组件，勿先猜 CSS class 或 SVG 路径。\n\
   3. 范围：局部提问只改所指区域；用户明确「整页/全面板」时再扩大。\n\
   4. 布局：控件与选区/焦点空间分离 → 查 fixed/absolute/portal 浮层；同容器拥挤 → 查 flex/overflow/gap/min-width。\n\
   5. 交互：「点击没反应/不工作」→ 查事件 handler/绑定；注意 mouseup 与 getSelection 时序与异步回调。\n\
   6. 样式：read 已定位组件 scoped `<style>`；chip/badge 查承载组件局部样式，勿臆断全局 theme。\n\
   7. 可见性：外框有内层空 → 查 v-if/shimmer/显示条件与全局 element 选择器是否与组件尺寸互相裁切。\n\
   8. class 重命名：grep 旧名全部出现再一次性 patch，改完 grep 验证零残留。\n\
   同一组件在连续消息中每条独立排查，勿因上一条修了布局假设本条同因。\n\
   附截图时首轮描述后，后续轮禁止重复描述同一张截图。"
}

pub fn build_agent_step_clarification_hint() -> &'static str {
    "\n【用户追问排查步骤】用户在问「你这步是在确认什么」或某属性/API 含义。\n\
   本轮禁止调用工具；先用 2–4 句中文面向用户解释（勿写 planning 句如「让我读取…」）。\n\
   解释后若任务仍是修 UI 缺陷：下一轮直接定位并 patch，勿再重复解释。"
}

pub fn build_agent_step_clarify_continue_hint() -> &'static str {
    "【解释已完成】若上文已回答用户「啥意思」，且仍在修浮层/定位类 UI 缺陷：\
   下一轮禁止重复解释或再读已定位的浮层/锚点代码；直接 patch 已 read 的定位逻辑，或至多 1 次 read 后立即 patch。"
}

pub fn build_session_audit_hint() -> &'static str {
    "\n【会话审计·只读】用户要求评估另一聊天会话中 Agent 的回复质量；勿回答被审计会话内的业务/编程问题。\n\
   优先读取用户消息中给出的会话 JSON（逻辑路径或绝对路径，按 AGENTS.md / 用户说明解析）；勿在项目根臆搜数据目录。\n\
   大 JSON 用 offset/limit 分段读取，禁止 run_command 分页读文件。\n\
   审计工具记录时必须区分证据强度：只根据 tools/roundGroups/statusLog 中明确出现的内容下结论；若工具摘要缺少具体输出，只能写“摘要不足，无法确认”，禁止断言 Agent 未验证或编造。\n\
   输出应聚焦准确性、工具调用、上下文理解、表达结构；把确定问题、推测风险、无法判断项分开写，避免把被审计会话中的业务问题展开解答。\n\
   禁止 write_file 将审计报告写入仓库；结论直接写入聊天回复。"
}

pub fn build_pending_plan_amend_hint(plan_file_path: Option<&str>) -> String {
    let plan_path_hint = plan_file_path
    .map(str::trim)
    .filter(|s| !s.is_empty())
    .map(|p| format!("优先 read_file `{p}`；若用户已编辑该文件，以其为准。"))
    .unwrap_or_else(|| {
      "优先 read_file 会话中第一份未执行的 `[PLAN]` / `.aiall/plans/` 方案文件，或承接会话内上一版完整方案正文。".into()
    });
    format!(
    "【Pending Plan·方案增量修订】当前会话存在尚未执行的修改方案（用户未点「执行方案」、代码未落盘）。\n\
     用户已采纳你上一轮答疑中的建议，或在引用回复后给出短指令（如「持久化」「加上」「合并」）。\n\
     {plan_path_hint}\n\
     禁止输出独立的新方案栈（Plan 2）；必须在既有 Pending Plan 全文基础上合并增量，输出一份完整修订版方案（`[PLAN]` 或 `## 修改方案` + 文件清单 + 代码块）。\n\
     勿重新 list_dir 广泛扫描；最多 read 方案文件与本次增量涉及的 1–2 个关键文件。"
  )
}

pub fn build_pending_plan_clarification_hint() -> &'static str {
    "【Pending Plan·澄清】当前会话有尚未执行的方案，用户本条短指令含义不够明确。\n\
   禁止输出 `[PLAN]` / `## 修改方案` / 新文件清单；用 2–4 句中文直接提问。\n\
   须问清：用户希望把刚讨论的内容并入现有 Pending Plan，还是单独作为独立模块/子方案；可提示用户回复「合并」或「单独」。\n\
   不要猜测后直接写方案。"
}

/// Declarative registry for interactive Build-mode system hints.
pub fn build_interactive_build_hints(
    policy: &AgentRunPolicy,
    user_recently_reported_failure: bool,
    history: Option<&[super::context::HistoryMessage]>,
) -> String {
    let quote_position_fix = super::policy::history_suggests_quote_position_fix(history);
    let mut parts: Vec<String> = Vec::new();
    if policy.code_review_run {
        parts.push(build_code_review_honesty_nudge(
            user_recently_reported_failure,
        ));
    }
    if policy.user_error_quote_run {
        parts.push(build_user_error_quote_hint().to_string());
    }
    if policy.user_failure_report_run {
        parts.push(build_user_failure_report_nudge().to_string());
    }
    if policy.ui_defect_build_run {
        parts.push(build_ui_defect_build_hint().to_string());
    }
    if policy.implement_follow_up_run {
        parts.push(build_implement_follow_up_hint(quote_position_fix));
    }
    if policy.same_issue_follow_up_run {
        parts.push(build_same_issue_follow_up_hint().to_string());
    }
    if policy.locate_status_follow_up_run {
        parts.push(build_locate_status_follow_up_hint().to_string());
    }
    if policy.quoted_amend_run {
        if let Some(ref intent) = policy.quoted_amend_intent {
            parts.push(build_quoted_amend_hint(intent));
        }
    }
    if policy.ultra_short_open_task_run {
        parts.push(build_ultra_short_open_task_hint().to_string());
    }
    parts.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::policy::{AgentMode, AgentRunPolicy, ResolvePolicyInput, UserIntent};

    #[test]
    fn pending_plan_amend_hint_includes_path() {
        let hint = build_pending_plan_amend_hint(Some(".aiall/plans/x.md"));
        assert!(hint.contains(".aiall/plans/x.md"));
        assert!(hint.contains("Pending Plan"));
    }

    #[test]
    fn interactive_build_hints_includes_ui_defect() {
        let policy = AgentRunPolicy {
            ui_defect_build_run: true,
            ..Default::default()
        };
        let hints = build_interactive_build_hints(&policy, false, None);
        assert!(hints.contains("UI 缺陷"));
    }

    #[test]
    fn resolve_policy_user_error_quote_wires_hint() {
        let policy = super::super::policy::resolve_run_policy(ResolvePolicyInput {
            prompt: String::new(),
            mode: AgentMode::Build,
            is_plan_explore: false,
            is_execute_plan: false,
            has_image: false,
            trigger_source: None,
            history: None,
            user_intent: UserIntent {
                user_error_quote: true,
                ..Default::default()
            },
        });
        assert!(policy.user_error_quote_run);
        let hints = build_interactive_build_hints(&policy, false, None);
        assert!(hints.contains("用户可能在复述报错"));
    }
}
