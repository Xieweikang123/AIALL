use crate::agent::agent_git_tools;
use crate::fs;
use crate::git;
use crate::project;
use super::knowledge_explore::{
  classify_explore_knowledge_intent, explore_intent_uses_knowledge_manifest, ExploreKnowledgeIntent,
};
use super::knowledge_manifest::{
  build_knowledge_explore_manifest, build_knowledge_rebuild_hint, parse_project_knowledge_frontmatter,
  PROJECT_KNOWLEDGE_REL,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;

use super::context_limits::{MAX_HISTORY_CHARS, MAX_HISTORY_MESSAGES};

const MAX_MEMORY_CHARS: usize = 8_000;
const MAX_KNOWLEDGE_CHARS: usize = 8_000;
const MAX_SKILLS_PROMPT_CHARS: usize = 4_000;
const MAX_OPEN_FILE_CHARS: usize = 12_000;
const MAX_AGENTS_GUIDE_CHARS: usize = 6_000;
const MAX_TREE_CHARS: usize = 8_000;
const EXPLORATION_ARCHIVE_PROMPT_MAX_CHARS: usize = 1_500;
const MAX_RELEVANT_ARCHIVES: usize = 3;

static GIT_WORKING_TREE_TOPIC_RE: once_cell::sync::Lazy<regex::Regex> =
  once_cell::sync::Lazy::new(|| {
    regex::Regex::new(
      r"(?i)(?:\bgit\b|暂存|未提交|工作区|待提交|staged|unstaged|working\s*tree).{0,24}(?:改|变|diff|状态|提交|啥|什么)|(?:改了啥|改了什么|有哪些改动)|\bgit\s+status\b",
    )
    .unwrap()
  });

fn is_git_working_tree_topic_prompt(prompt: &str) -> bool {
  let text = prompt.trim();
  !text.is_empty() && GIT_WORKING_TREE_TOPIC_RE.is_match(text)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExplorationIndexEntry {
  id: String,
  path: String,
  created_at: String,
  read_count: u32,
  written_count: u32,
}

#[derive(Debug, Deserialize)]
struct ProjectSkillsIndex {
  version: u32,
  exploration: Vec<ExplorationIndexEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryMessage {
  pub role: String,
  pub content: String,
}

pub fn build_history_messages(history: &[HistoryMessage]) -> Vec<Value> {
  let trimmed: Vec<&HistoryMessage> = history
    .iter()
    .filter(|m| {
      (m.role == "user" || m.role == "assistant") && !m.content.trim().is_empty()
    })
    .collect();
  let start = trimmed.len().saturating_sub(MAX_HISTORY_MESSAGES);
  let slice = &trimmed[start..];

  let mut total_chars = 0usize;
  let mut picked: Vec<&HistoryMessage> = Vec::new();
  for item in slice.iter().rev() {
    let len = item.content.len();
    if total_chars + len > MAX_HISTORY_CHARS && !picked.is_empty() {
      break;
    }
    total_chars += len;
    picked.push(item);
  }
  picked.reverse();

  picked
    .into_iter()
    .map(|m| json!({ "role": m.role, "content": m.content }))
    .collect()
}

pub fn history_for_display(history: &[HistoryMessage]) -> Vec<Value> {
  build_history_messages(history)
    .into_iter()
    .map(|m| {
      let content = m
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .chars()
        .take(4000)
        .collect::<String>();
      json!({ "role": m.get("role"), "content": content })
    })
    .collect()
}

pub struct ContextBuildInput<'a> {
  pub project_path: &'a str,
  pub task_context: Option<&'a str>,
  pub open_file_path: Option<&'a str>,
  pub mode: &'a str,
  pub is_plan_explore: bool,
  pub is_execute_plan: bool,
  pub target_files: Option<&'a [String]>,
}

const PROJECT_SKILLS_DIR: &str = ".aiall/skills";
const PROJECT_SKILLS_INDEX_REL: &str = ".aiall/skills/index.json";

pub struct ContextBlocks {
  pub system_suffix: String,
  pub open_file_rel: Option<String>,
  pub explore_uses_manifest: bool,
}

pub async fn resolve_explore_uses_manifest(project_path: &str, prompt: &str) -> bool {
  let knowledge = project::read_text_file(project_path, PROJECT_KNOWLEDGE_REL).await;
  if knowledge.get("ok").and_then(|v| v.as_bool()) != Some(true) {
    return false;
  }
  let Some(raw) = knowledge.get("content").and_then(|v| v.as_str()) else {
    return false;
  };
  let (_, body) = parse_project_knowledge_frontmatter(raw);
  if body.trim().is_empty() {
    return false;
  }
  let intent = classify_explore_knowledge_intent(prompt, true);
  explore_intent_uses_knowledge_manifest(intent)
}

fn truncate_chars(text: &str, max: usize) -> String {
  if text.chars().count() <= max {
    return text.to_string();
  }
  format!(
    "{}\n…（已截断，共 {} 字符）",
    text.chars().take(max).collect::<String>(),
    text.chars().count()
  )
}

async fn read_open_file_snippet(project_path: &str, open_file_path: &str) -> Option<(String, String)> {
  let Ok((resolved, relative)) = crate::paths::resolve_project_path(project_path, open_file_path) else {
    return None;
  };
  let result = fs::read_file_content(&resolved.to_string_lossy()).await;
  if !result.ok {
    return Some((relative, String::new()));
  }
  let snippet = truncate_chars(&result.content, MAX_OPEN_FILE_CHARS);
  Some((relative, snippet))
}

fn strip_markdown_frontmatter(raw: &str) -> String {
  let trimmed = raw.trim_start();
  if !trimmed.starts_with("---") {
    return raw.to_string();
  }
  let rest = trimmed.strip_prefix("---").unwrap_or(trimmed);
  if let Some(end) = rest.find("\n---") {
    rest[end + 4..].trim_start().to_string()
  } else {
    raw.to_string()
  }
}

fn extract_task_keywords(text: &str) -> Vec<String> {
  text
    .split(|c: char| !c.is_alphanumeric() && c != '_' && c != '-')
    .filter(|w| w.len() >= 3)
    .map(|w| w.to_lowercase())
    .take(24)
    .collect()
}

struct SkillEntry {
  slug: String,
  kind: String,
  title: String,
  body: String,
}

fn parse_skill_markdown(slug: &str, raw: &str) -> Option<SkillEntry> {
  let body = strip_markdown_frontmatter(raw);
  let mut kind = "fact".to_string();
  let mut title = slug.to_string();
  if raw.trim_start().starts_with("---") {
    let fm = raw.trim_start().strip_prefix("---")?.split("\n---").next()?;
    for line in fm.lines() {
      let line = line.trim();
      if let Some(v) = line.strip_prefix("kind:") {
        kind = v.trim().to_string();
      } else if let Some(v) = line.strip_prefix("title:") {
        title = v.trim().trim_matches('"').to_string();
      }
    }
  }
  Some(SkillEntry {
    slug: slug.to_string(),
    kind,
    title,
    body,
  })
}

fn summarize_skill(title: &str, kind: &str, body: &str) -> String {
  let first = body
    .lines()
    .map(str::trim)
    .find(|l| !l.is_empty())
    .unwrap_or("");
  let summary = if first.chars().count() > 120 {
    format!("{}…", first.chars().take(120).collect::<String>())
  } else {
    first.to_string()
  };
  format!("- {title} [{kind}] {summary}")
}

async fn build_skills_prompt_block(project_path: &str, task_context: Option<&str>) -> String {
  let dir = Path::new(project_path).join(PROJECT_SKILLS_DIR);
  let mut entries = match tokio::fs::read_dir(&dir).await {
    Ok(rd) => rd,
    Err(_) => return String::new(),
  };

  let mut skills: Vec<SkillEntry> = Vec::new();
  while let Ok(Some(entry)) = entries.next_entry().await {
    let path = entry.path();
    if path.extension().and_then(|e| e.to_str()) != Some("md") {
      continue;
    }
    let slug = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
    if slug.is_empty() {
      continue;
    }
    let Ok(raw) = tokio::fs::read_to_string(&path).await else { continue };
    if let Some(parsed) = parse_skill_markdown(&slug, &raw) {
      if parsed.kind == "fact" || parsed.kind == "heuristic" {
        skills.push(parsed);
      }
    }
  }

  if skills.is_empty() {
    return String::new();
  }

  let keywords = task_context.map(extract_task_keywords).unwrap_or_default();
  let mut best_slug = String::new();
  let mut best_score = 0usize;
  for skill in &skills {
    let text = format!("{} {}", skill.title, skill.body).to_lowercase();
    let score = keywords.iter().filter(|kw| text.contains(kw.as_str())).count();
    if score > best_score {
      best_score = score;
      best_slug = skill.slug.clone();
    }
  }

  let mut lines: Vec<String> = Vec::new();
  let mut used = 0usize;
  for skill in &skills {
    let block = if skill.slug == best_slug && best_score > 0 {
      format!(
        "### {} [{}]（完整）\n{}",
        skill.title, skill.kind, skill.body
      )
    } else {
      summarize_skill(&skill.title, &skill.kind, &skill.body)
    };
    if used + block.len() + 1 > MAX_SKILLS_PROMPT_CHARS {
      break;
    }
    used += block.len() + 1;
    lines.push(block);
  }

  if lines.is_empty() {
    return String::new();
  }

  format!(
    "\n\n项目 Skills（skill 目录中的可复用约定；冲突时以用户最新消息为准）：\n```markdown\n{}\n```\n按需 read_file 读取 .aiall/skills/<slug>.md 获取完整内容。",
    lines.join("\n")
  )
}

fn score_exploration_entry(entry: &ExplorationIndexEntry, keywords: &[String]) -> f64 {
  if keywords.is_empty() {
    return 0.0;
  }
  let id = entry.id.to_lowercase();
  let mut score = 0.0;
  for kw in keywords {
    if id.contains(kw) {
      score += 2.0;
    }
  }
  let recency_ms = chrono::Utc::now()
    .signed_duration_since(
      chrono::DateTime::parse_from_rfc3339(&entry.created_at)
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .unwrap_or_else(|_| chrono::Utc::now()),
    )
    .num_milliseconds()
    .max(0) as f64;
  let week_ms = 7.0 * 24.0 * 60.0 * 60.0 * 1000.0;
  let recency_boost = (1.0 - recency_ms / week_ms).max(0.0);
  score += recency_boost;
  score += (entry.read_count.min(5) as f64) * 0.1;
  score
}

async fn build_exploration_archive_prompt_block(
  project_path: &str,
  task_context: Option<&str>,
) -> String {
  let Some(task) = task_context.map(str::trim).filter(|t| !t.is_empty()) else {
    return String::new();
  };
  let keywords = extract_task_keywords(task);
  if keywords.is_empty() {
    return String::new();
  }

  let index_path = Path::new(project_path).join(PROJECT_SKILLS_INDEX_REL);
  let Ok(raw) = tokio::fs::read_to_string(&index_path).await else {
    return String::new();
  };
  let Ok(index) = serde_json::from_str::<ProjectSkillsIndex>(&raw) else {
    return String::new();
  };
  if index.version != 1 || index.exploration.is_empty() {
    return String::new();
  }

  let mut scored: Vec<(ExplorationIndexEntry, f64)> = index
    .exploration
    .into_iter()
    .map(|entry| {
      let score = score_exploration_entry(&entry, &keywords);
      (entry, score)
    })
    .filter(|(_, score)| *score > 0.0)
    .collect();
  scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
  scored.truncate(MAX_RELEVANT_ARCHIVES);

  if scored.is_empty() {
    return String::new();
  }

  let mut blocks: Vec<String> = Vec::new();
  let mut used = 0usize;
  for (entry, _) in scored {
    let Ok((resolved, _)) = crate::paths::resolve_project_path(project_path, &entry.path) else {
      continue;
    };
    let Ok(content) = tokio::fs::read_to_string(&resolved).await else {
      continue;
    };
    let snippet: String = strip_markdown_frontmatter(&content)
      .chars()
      .take(400)
      .collect();
    let block = format!(
      "### {}（读{}·写{}）\n{snippet}",
      entry.id, entry.read_count, entry.written_count
    );
    if used + block.len() + 2 > EXPLORATION_ARCHIVE_PROMPT_MAX_CHARS {
      break;
    }
    used += block.len() + 2;
    blocks.push(block);
  }

  if blocks.is_empty() {
    return String::new();
  }

  format!(
    "\n\n历史探索经验（与当前任务相关的过往快照，供参考）：\n```markdown\n{}\n```",
    blocks.join("\n\n")
  )
}

async fn build_git_snapshot_block(project_path: &str, task_context: Option<&str>) -> String {
  let prompt = task_context.map(str::trim).unwrap_or("");
  if prompt.is_empty() || !is_git_working_tree_topic_prompt(prompt) {
    return String::new();
  }
  let status = git::git_status(project_path).await;
  if !status.ok {
    return String::new();
  }
  format!(
    "\n\n【Git 工作区快照】\n{}",
    agent_git_tools::format_git_status_for_agent(&status)
  )
}

pub async fn build_context_blocks(input: ContextBuildInput<'_>) -> ContextBlocks {
  let mut parts: Vec<String> = Vec::new();
  let mut open_file_rel: Option<String> = None;
  let mut explore_uses_manifest = false;

  if input.is_execute_plan {
    parts.push(format!(
      "\n\n项目根：{}（方案执行阶段，已跳过全项目扫描）",
      input.project_path
    ));
    if let Some(files) = input.target_files.filter(|f| !f.is_empty()) {
      parts.push("\n\n【方案目标文件】".into());
      for file in files {
        parts.push(format!("- {file}"));
      }
    }
  } else {
    let ctx = project::project_context(input.project_path).await;
    if ctx.get("ok").and_then(|v| v.as_bool()) == Some(true) {
      if let Some(tree) = ctx.get("tree").and_then(|v| v.as_str()) {
        if !tree.trim().is_empty() {
          parts.push(format!(
            "\n\n【项目结构（节选）】\n```\n{}\n```",
            truncate_chars(tree, MAX_TREE_CHARS)
          ));
        }
      }
    }
  }

  let memory = project::read_text_file(input.project_path, ".aiall/project-memory.md").await;
  if memory.get("ok").and_then(|v| v.as_bool()) == Some(true) {
    if let Some(content) = memory.get("content").and_then(|v| v.as_str()) {
      if !content.trim().is_empty() {
        parts.push(format!(
          "\n\n【项目记忆】\n{}",
          truncate_chars(content, MAX_MEMORY_CHARS)
        ));
      }
    }
  }

  let knowledge = project::read_text_file(input.project_path, PROJECT_KNOWLEDGE_REL).await;
  if knowledge.get("ok").and_then(|v| v.as_bool()) == Some(true) {
    if let Some(raw) = knowledge.get("content").and_then(|v| v.as_str()) {
      let (meta, body) = parse_project_knowledge_frontmatter(raw);
      let has_body = !body.trim().is_empty();
      if input.mode == "explore" {
        if has_body {
          let prompt = input.task_context.unwrap_or("").trim();
          let intent = classify_explore_knowledge_intent(prompt, true);
          explore_uses_manifest = explore_intent_uses_knowledge_manifest(intent);
          if intent == ExploreKnowledgeIntent::Rebuild {
            parts.push(format!("\n\n{}", build_knowledge_rebuild_hint()));
          } else if explore_uses_manifest {
            let mut changed_paths: Option<Vec<String>> = None;
            if let Some(head) = meta.git_head.as_deref().filter(|s| !s.trim().is_empty()) {
              let diff = git::git_changed_files_since(input.project_path, head).await;
              if diff.get("ok").and_then(|v| v.as_bool()) == Some(true) {
                if let Some(files) = diff.get("files").and_then(|v| v.as_array()) {
                  let paths: Vec<String> = files
                    .iter()
                    .filter_map(|f| f.as_str().map(str::to_string))
                    .collect();
                  if !paths.is_empty() {
                    changed_paths = Some(paths);
                  }
                }
              }
            }
            parts.push(format!(
              "\n\n{}",
              build_knowledge_explore_manifest(&body, &meta, changed_paths.as_deref())
            ));
          }
        }
      } else if has_body {
        parts.push(format!(
          "\n\n【项目知识库】\n{}",
          truncate_chars(&body, MAX_KNOWLEDGE_CHARS)
        ));
      }
    }
  }

  let skills_block = build_skills_prompt_block(input.project_path, input.task_context).await;
  if !skills_block.is_empty() {
    parts.push(skills_block);
  }

  let exploration_block =
    build_exploration_archive_prompt_block(input.project_path, input.task_context).await;
  if !exploration_block.is_empty() {
    parts.push(exploration_block);
  }

  let is_ask = input.mode == "ask";
  if (is_ask || input.is_plan_explore)
    && is_git_working_tree_topic_prompt(input.task_context.unwrap_or(""))
  {
    let git_block = build_git_snapshot_block(input.project_path, input.task_context).await;
    if !git_block.is_empty() {
      parts.push(git_block);
    }
  }

  let agents_path = Path::new(input.project_path).join("AGENTS.md");
  if let Ok(content) = tokio::fs::read_to_string(&agents_path).await {
    if !content.trim().is_empty() {
      parts.push(format!(
        "\n\n【AGENTS.md】\n{}",
        truncate_chars(&content, MAX_AGENTS_GUIDE_CHARS)
      ));
    }
  }

  if let Some(open_path) = input.open_file_path.filter(|p| !p.trim().is_empty()) {
    if let Some((relative, snippet)) = read_open_file_snippet(input.project_path, open_path).await {
      open_file_rel = Some(relative.clone());
      parts.push(format!("\n\n用户当前打开的文件：{relative}"));
      if !snippet.trim().is_empty() {
        parts.push(format!(
          "\n\n当前打开文件内容（节选）：\n```\n{snippet}\n```"
        ));
      }
    }
  }

  ContextBlocks {
    system_suffix: parts.join(""),
    open_file_rel,
    explore_uses_manifest,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn build_history_messages_filters_and_limits() {
    let history = vec![
      HistoryMessage {
        role: "user".into(),
        content: "hello".into(),
      },
      HistoryMessage {
        role: "assistant".into(),
        content: "world".into(),
      },
      HistoryMessage {
        role: "system".into(),
        content: "ignored".into(),
      },
    ];
    let msgs = build_history_messages(&history);
    assert_eq!(msgs.len(), 2);
    assert_eq!(msgs[0]["role"], "user");
  }
}
