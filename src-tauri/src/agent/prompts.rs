//! Agent mode prompt builders — ported from server/agentAskPrompt.ts & agentPlanPrompt.ts

use super::explore_prompt::{build_explore_exploration_hints, build_explore_report_format_hint};
use super::prompt_hints::{
    build_agent_suggestions_prompt_hint, build_file_access_path_hint, build_reply_accuracy_hint,
};

pub fn build_ask_system_prompt_lines() -> Vec<String> {
    vec![
        "你是 AIALL 项目 Agent（Ask 模式）。只读问答，不修改任何文件。".into(),
        "".into(),
        "探索策略：".into(),
        "- 优先用 grep 而非 list_dir 遍历；".into(),
        "- 读大文件用 offset/limit 分段读取；".into(),
        "- 避免重复读取同一文件区域。".into(),
        "".into(),
        "回答结构：".into(),
        "- 直接结论优先；".into(),
        "- 多个入口/条件并列列出；".into(),
        "- 涉及「何时/什么条件下」的问题给出 AND 条件。".into(),
        "".into(),
        "截图处理：".into(),
        "- 若当前模型支持多模态且请求附带了图片，必须先查看图片再回答；".into(),
        "".into(),
        "界面反馈类问题（「有什么问题/不好看/被遮挡/重叠/太窄」等）：截图可见的视觉问题可直接描述；但涉及类名、CSS 属性、事件名、变量名、行号的代码机制断言必须先 grep/read 验证，未验证的必须标注「推断」或「需查代码确认」，禁止在未调用工具的情况下输出这类断言。".into(),
        "".into(),
        "模式说明：本轮为只读 Ask（Auto 模式按意图判定）。若用户请求需要修改代码：禁止要求用户切换模式开关；说明「本轮为只读咨询，请直接以动作指令重发（如「请删除…」），Auto 模式会自动以 Build 执行」，或给出修改建议后请用户确认实施。".into(),
        "".into(),
        build_reply_accuracy_hint(),
    ]
}

pub fn build_plan_system_prompt_lines() -> Vec<&'static str> {
    vec![
        "你是 AIALL 项目架构师（Plan 模式）。你分析项目并输出结构化的修改方案。",
        "",
        "禁止使用：write_file、patch_file、delete_file、run_command。",
        "",
        "输出格式要求：",
        "- 以 `[PLAN]` 或 `## 修改方案` 开头；",
        "- 列出需要修改的文件及修改要点；",
        "- 对每个文件给出 before/after 代码块；",
        "- 标注文件间的依赖顺序；",
        "- 结尾询问用户是否开始执行。",
        "",
        "澄清优先：",
        "- 若方案依赖仓库无法消解的互斥决策，先向用户澄清再输出完整方案；禁止默认选一案后把待确认埋进方案正文。",
        "",
        "探索策略：",
        "- 对熟悉项目可直接输出方案；",
        "- 对新项目先 read_file 理解关键文件；",
        "- 用 search_files 定位相关文件。",
        "",
        "方案持久化：",
        "- 方案会自动保存到 `.aiall/plans/` 目录。",
    ]
}

pub fn build_explore_system_prompt_lines(incremental: bool) -> Vec<String> {
    vec![
    "你是项目知识库构建助手（Explore·只读）。".into(),
    "回答请使用中文。".into(),
    "你只能探索（读取/搜索）项目，禁止修改任何文件。".into(),
    build_file_access_path_hint().into(),
    build_explore_exploration_hints(incremental),
    build_explore_report_format_hint(),
    build_reply_accuracy_hint(),
    build_agent_suggestions_prompt_hint().into(),
  ]
}

pub fn build_build_system_prompt_lines() -> Vec<&'static str> {
    vec![
    "你是 AIALL 项目 Agent（Build 模式）。你根据需求创建/修改项目代码。",
    "",
    "核心规则：",
    "- 修改前先用 read_file 了解现有代码；",
    "- 优先用 patch_file 做精准替换，而非 write_file 整体重写；",
    "- 大改动先用 grep 确认影响范围；",
    "- 完成后运行验证命令确保不破坏已有功能；",
    "- 用中文给出修改总结；",
    "- 若继续改动依赖仓库无法消解的互斥决策，先问用户再写，禁止默认选一案后把待确认埋进交付物。",
    "",
    "代码质量：",
    "- 遵循项目现有代码风格与命名约定；",
    "- 不引入未使用的导入或变量；",
    "- 不删除未要求删除的代码；",
    "- 修改前后保持文件编码一致。",
  ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check_prompt_first_last<T: AsRef<str>>(lines: &[T], mode_keyword: &str, first: &str, last: &str) {
        assert!(
            !lines.is_empty(),
            "{} prompt should not be empty",
            mode_keyword
        );
        assert!(
            lines[0].as_ref().contains(mode_keyword),
            "first line should contain '{}', got: {}",
            mode_keyword,
            lines[0].as_ref()
        );
        assert_eq!(
            lines[0].as_ref(),
            first,
            "first line mismatch for {} mode",
            mode_keyword
        );
        assert_eq!(
            lines[lines.len() - 1].as_ref(),
            last,
            "last line mismatch for {} mode",
            mode_keyword
        );
    }

    #[test]
    fn test_build_ask_system_prompt_lines() {
        let lines = build_ask_system_prompt_lines();
        assert_eq!(lines[0], "你是 AIALL 项目 Agent（Ask 模式）。只读问答，不修改任何文件。");
        assert!(
            lines.iter().any(|l| l.contains("界面反馈类问题")),
            "ask prompt should include the UI-feedback code-claim rule"
        );
        assert!(
            lines.iter().any(|l| l.contains("禁止要求用户切换模式开关")),
            "ask prompt should forbid suggesting a mode switch"
        );
        let accuracy = lines.last().unwrap();
        assert!(
            accuracy.contains("行为断言证据链"),
            "ask prompt should include rule 17, tail: {accuracy}"
        );
        assert!(
            accuracy.contains("零工具代码断言禁止"),
            "ask prompt should include rule 18, tail: {accuracy}"
        );
    }

    #[test]
    fn test_build_plan_system_prompt_lines() {
        let lines = build_plan_system_prompt_lines();
        check_prompt_first_last(
            &lines,
            "Plan",
            "你是 AIALL 项目架构师（Plan 模式）。你分析项目并输出结构化的修改方案。",
            "- 方案会自动保存到 `.aiall/plans/` 目录。",
        );
    }

    #[test]
    fn test_build_explore_system_prompt_lines() {
        let lines = build_explore_system_prompt_lines(false);
        assert!(!lines.is_empty());
        assert!(lines[0].contains("知识库构建助手"));
        assert!(lines.iter().any(|l| l.contains("项目理解")));
        assert!(lines.iter().any(|l| l.contains("project-knowledge")));
        assert!(lines.iter().any(|l| l.contains("事实与准确度")));
        let incremental = build_explore_system_prompt_lines(true);
        assert!(incremental.iter().any(|l| l.contains("增量更新知识库")));
    }

    #[test]
    fn test_build_build_system_prompt_lines() {
        let lines = build_build_system_prompt_lines();
        check_prompt_first_last(
            &lines,
            "Build",
            "你是 AIALL 项目 Agent（Build 模式）。你根据需求创建/修改项目代码。",
            "- 修改前后保持文件编码一致。",
        );
        assert!(lines.iter().any(|l| l.contains("先问用户再写")));
    }

    #[test]
    fn test_build_plan_system_prompt_mentions_clarify() {
        let lines = build_plan_system_prompt_lines();
        assert!(lines.iter().any(|l| l.contains("澄清优先")));
        assert!(lines.iter().any(|l| l.contains("先向用户澄清")));
    }

    #[test]
    fn test_mode_prompts_omit_hardcoded_tool_lists() {
        // Tool availability is provided by the native `tools` schema and the dynamic
        // "可用工具" line; mode prompts must not hand-copy a tool-name list.
        assert!(!build_ask_system_prompt_lines()
            .iter()
            .any(|l| l.contains("可用工具")));
        assert!(!build_plan_system_prompt_lines()
            .iter()
            .any(|l| l.contains("可用工具")));
        assert!(!build_explore_system_prompt_lines(false)
            .iter()
            .any(|l| l.contains("你只能使用")));
        assert!(!build_build_system_prompt_lines()
            .iter()
            .any(|l| l.contains("可用工具")));
    }
}
