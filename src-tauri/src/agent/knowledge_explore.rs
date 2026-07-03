//! Explore knowledge prompt classification — ported from knowledgeExplore.ts

use regex::Regex;
use std::sync::OnceLock;

pub const EXPLORE_PROJECT_PRESET_PROMPT: &str =
  "请系统性地了解当前项目，输出完整的项目知识库（技术栈、目录、入口、核心模块、依赖、开发命令、阅读顺序）。不要修改任何文件。";

static EXPLORE_CONTINUE_PROMPT_RE: OnceLock<Regex> = OnceLock::new();
static EXPLORE_SECTION_FILL_PROMPT_RE: OnceLock<Regex> = OnceLock::new();
static EXPLORE_CHANGES_PROMPT_RE: OnceLock<Regex> = OnceLock::new();
static KNOWLEDGE_QUOTE_FOLLOWUP_RE: OnceLock<Regex> = OnceLock::new();

fn explore_continue_prompt_re() -> &'static Regex {
  EXPLORE_CONTINUE_PROMPT_RE
    .get_or_init(|| Regex::new(r"(?i)^请继续探索项目中尚未覆盖的部分").expect("EXPLORE_CONTINUE"))
}

fn explore_section_fill_prompt_re() -> &'static Regex {
  EXPLORE_SECTION_FILL_PROMPT_RE.get_or_init(|| {
    Regex::new(r"(?i)^请针对性探索并补全以下(?:知识库缺口章节|标注为「未探索」)")
      .expect("EXPLORE_SECTION_FILL")
  })
}

fn explore_changes_prompt_re() -> &'static Regex {
  EXPLORE_CHANGES_PROMPT_RE
    .get_or_init(|| Regex::new(r"(?i)^请针对自上次探索以来变更的代码文件").expect("EXPLORE_CHANGES"))
}

fn knowledge_quote_followup_re() -> &'static Regex {
  KNOWLEDGE_QUOTE_FOLLOWUP_RE.get_or_init(|| {
    Regex::new(r"(?m)^用户引用了知识库中的以下段落：").expect("KNOWLEDGE_QUOTE_FOLLOWUP")
  })
}

pub fn is_explore_continue_prompt(text: &str) -> bool {
  explore_continue_prompt_re().is_match(text.trim())
}

pub fn is_explore_section_fill_prompt(text: &str) -> bool {
  explore_section_fill_prompt_re().is_match(text.trim())
}

pub fn is_explore_changes_prompt(text: &str) -> bool {
  explore_changes_prompt_re().is_match(text.trim())
}

pub fn is_knowledge_quote_follow_up_prompt(text: &str) -> bool {
  knowledge_quote_followup_re().is_match(text.trim())
}

#[allow(dead_code)]
pub fn is_explore_follow_up_prompt(text: &str) -> bool {
  let trimmed = text.trim();
  if trimmed.is_empty() {
    return false;
  }
  if trimmed == EXPLORE_PROJECT_PRESET_PROMPT {
    return false;
  }
  if is_explore_continue_prompt(trimmed)
    || is_explore_section_fill_prompt(trimmed)
    || is_explore_changes_prompt(trimmed)
  {
    return false;
  }
  true
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExploreKnowledgeIntent {
  Initial,
  Rebuild,
  Continue,
  SectionFill,
  Changes,
  Followup,
}

pub fn classify_explore_knowledge_intent(prompt: &str, has_existing_body: bool) -> ExploreKnowledgeIntent {
  let trimmed = prompt.trim();
  if trimmed == EXPLORE_PROJECT_PRESET_PROMPT {
    return if has_existing_body {
      ExploreKnowledgeIntent::Rebuild
    } else {
      ExploreKnowledgeIntent::Initial
    };
  }
  if is_explore_continue_prompt(trimmed) {
    return ExploreKnowledgeIntent::Continue;
  }
  if is_explore_section_fill_prompt(trimmed) {
    return ExploreKnowledgeIntent::SectionFill;
  }
  if is_explore_changes_prompt(trimmed) {
    return ExploreKnowledgeIntent::Changes;
  }
  if has_existing_body {
    ExploreKnowledgeIntent::Followup
  } else {
    ExploreKnowledgeIntent::Initial
  }
}

pub fn explore_intent_uses_knowledge_manifest(intent: ExploreKnowledgeIntent) -> bool {
  matches!(
    intent,
    ExploreKnowledgeIntent::Continue
      | ExploreKnowledgeIntent::SectionFill
      | ExploreKnowledgeIntent::Changes
      | ExploreKnowledgeIntent::Followup
  )
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn detects_continue_preset() {
    assert!(is_explore_continue_prompt("请继续探索项目中尚未覆盖的部分，补充知识库"));
  }

  #[test]
  fn follow_up_excludes_presets() {
    assert!(!is_explore_follow_up_prompt(EXPLORE_PROJECT_PRESET_PROMPT));
    assert!(is_explore_follow_up_prompt("路由是怎么组织的？"));
  }

  #[test]
  fn manifest_intents_include_followup_not_rebuild() {
    assert!(explore_intent_uses_knowledge_manifest(ExploreKnowledgeIntent::Followup));
    assert!(explore_intent_uses_knowledge_manifest(ExploreKnowledgeIntent::Continue));
    assert!(!explore_intent_uses_knowledge_manifest(ExploreKnowledgeIntent::Rebuild));
    assert!(!explore_intent_uses_knowledge_manifest(ExploreKnowledgeIntent::Initial));
  }
}
