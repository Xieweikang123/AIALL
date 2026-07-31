//! Project knowledge manifest for Explore mode — ported from projectReportDisplay.ts
//! and shared/projectKnowledgeFormat.ts.

use regex::Regex;
use std::sync::LazyLock;

pub const PROJECT_KNOWLEDGE_REL: &str = ".aiall/project-knowledge.md";

static FRONTMATTER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$").expect("FRONTMATTER_RE")
});
static SECTION_H2_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^##\s+(.+?)(?:\r?\n|$)").expect("SECTION_H2_RE"));
static TITLE_UNEXPLORED_SUFFIX_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[（(]未探索[）)]\s*$").expect("TITLE_UNEXPLORED_SUFFIX_RE"));
static TITLE_PENDING_SUFFIX_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[（(]待验证[）)]\s*$").expect("TITLE_PENDING_SUFFIX_RE"));
static BODY_UNEXPLORED_PLACEHOLDER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:内容)?未探索[。.；;]?\s*$").expect("BODY_UNEXPLORED_PLACEHOLDER_RE")
});
static BODY_PENDING_PLACEHOLDER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^待验证[。.；;]?\s*$").expect("BODY_PENDING_PLACEHOLDER_RE"));
static SECTION_NUMBER_PREFIX_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^([零〇一二三四五六七八九十百千]+)[、．.\s]+").expect("SECTION_NUMBER_PREFIX_RE")
});

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProjectKnowledgeMeta {
    pub updated_at: Option<String>,
    pub last_explored_at: Option<String>,
    pub explore_rounds: Option<u32>,
    pub git_head: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SectionGapStatus {
    Ok,
    Unexplored,
    Pending,
}

#[derive(Debug, Clone)]
pub struct KnowledgeSectionBlock {
    pub title: String,
    pub content: String,
    pub status: SectionGapStatus,
}

pub fn parse_project_knowledge_frontmatter(raw: &str) -> (ProjectKnowledgeMeta, String) {
    let normalized = raw.replace("\r\n", "\n");
    let Some(caps) = FRONTMATTER_RE.captures(&normalized) else {
        return (
            ProjectKnowledgeMeta::default(),
            normalized.trim().to_string(),
        );
    };
    let meta_block = caps.get(1).map(|m| m.as_str()).unwrap_or("");
    let body = caps
        .get(2)
        .map(|m| m.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let mut meta = ProjectKnowledgeMeta::default();
    for line in meta_block.lines() {
        let line = line.trim();
        if let Some(v) = line.strip_prefix("updatedAt:") {
            meta.updated_at = Some(v.trim().to_string());
        } else if let Some(v) = line.strip_prefix("lastExploredAt:") {
            meta.last_explored_at = Some(v.trim().to_string());
        } else if let Some(v) = line.strip_prefix("exploreRounds:") {
            meta.explore_rounds = v.trim().parse().ok();
        } else if let Some(v) = line.strip_prefix("gitHead:") {
            meta.git_head = Some(v.trim().to_string());
        }
    }
    (meta, body)
}

pub fn strip_knowledge_frontmatter(raw: &str) -> String {
    let normalized = raw.replace("\r\n", "\n");
    if let Some(caps) = FRONTMATTER_RE.captures(&normalized) {
        caps.get(2)
            .map(|m| m.as_str().trim().to_string())
            .unwrap_or_default()
    } else {
        normalized.trim().to_string()
    }
}

fn is_gap_body_placeholder(body: &str) -> bool {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return true;
    }
    BODY_UNEXPLORED_PLACEHOLDER_RE.is_match(trimmed)
        || BODY_PENDING_PLACEHOLDER_RE.is_match(trimmed)
}

pub fn resolve_section_gap_status(title: &str, content: &str) -> SectionGapStatus {
    let body = content.trim();
    if !body.is_empty() && !is_gap_body_placeholder(body) {
        return SectionGapStatus::Ok;
    }
    let trimmed_title = title.trim();
    if TITLE_UNEXPLORED_SUFFIX_RE.is_match(trimmed_title) {
        return SectionGapStatus::Unexplored;
    }
    if TITLE_PENDING_SUFFIX_RE.is_match(trimmed_title) {
        return SectionGapStatus::Pending;
    }
    if body.is_empty() {
        return SectionGapStatus::Unexplored;
    }
    if BODY_UNEXPLORED_PLACEHOLDER_RE.is_match(body) {
        return SectionGapStatus::Unexplored;
    }
    if BODY_PENDING_PLACEHOLDER_RE.is_match(body) {
        return SectionGapStatus::Pending;
    }
    SectionGapStatus::Ok
}

pub fn split_knowledge_section_blocks(body: &str) -> (String, Vec<KnowledgeSectionBlock>) {
    let normalized = body.replace("\r\n", "\n").trim().to_string();
    if normalized.is_empty() {
        return (String::new(), Vec::new());
    }
    let parts: Vec<String> = normalized
        .split("\n## ")
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();
    let first_is_section = normalized.starts_with("## ");
    let preamble = if first_is_section {
        String::new()
    } else {
        parts.first().cloned().unwrap_or_default()
    };
    let section_parts: &[String] = if first_is_section {
        &parts
    } else if parts.len() > 1 {
        &parts[1..]
    } else {
        &[]
    };
    let mut sections = Vec::new();
    for part in section_parts {
        let full = format!("## {part}");
        let title = SECTION_H2_RE
            .captures(&full)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().trim().to_string())
            .unwrap_or_default();
        if title.is_empty() || title.starts_with("补充") {
            continue;
        }
        let content = SECTION_H2_RE.replace(&full, "").trim().to_string();
        let status = resolve_section_gap_status(&title, &content);
        sections.push(KnowledgeSectionBlock {
            title,
            content,
            status,
        });
    }
    (preamble, sections)
}

fn strip_section_number_prefix(title: &str) -> String {
    SECTION_NUMBER_PREFIX_RE
        .replace(title, "")
        .trim()
        .to_string()
}

fn strip_section_title_gap_suffix(title: &str) -> String {
    title
        .replace("（未探索）", "")
        .replace("(未探索)", "")
        .replace("（待验证）", "")
        .replace("(待验证)", "")
        .trim()
        .to_string()
}

fn strip_title_number_prefix(title: &str) -> String {
    strip_section_title_gap_suffix(&strip_section_number_prefix(title))
}

fn section_status_label(status: SectionGapStatus) -> &'static str {
    match status {
        SectionGapStatus::Unexplored => "未探索",
        SectionGapStatus::Pending => "待验证",
        _ => "已覆盖",
    }
}

pub fn find_gap_section_titles(content: &str) -> Vec<String> {
    let normalized = content.replace("\r\n", "\n").trim().to_string();
    let parts: Vec<String> = normalized
        .split("\n## ")
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();
    let first_is_section = normalized.starts_with("## ");
    let section_parts: &[String] = if first_is_section {
        &parts
    } else if parts.len() > 1 {
        &parts[1..]
    } else {
        &[]
    };
    let mut titles = Vec::new();
    for part in section_parts {
        let full = format!("## {part}");
        let title = SECTION_H2_RE
            .captures(&full)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().trim().to_string())
            .unwrap_or_default();
        if title.is_empty() || title.starts_with("补充") {
            continue;
        }
        let body = SECTION_H2_RE.replace(&full, "").trim().to_string();
        if resolve_section_gap_status(&title, &body) == SectionGapStatus::Ok {
            continue;
        }
        titles.push(strip_title_number_prefix(&title));
    }
    titles
}

pub fn build_knowledge_explore_manifest(
    body: &str,
    meta: &ProjectKnowledgeMeta,
    changed_paths: Option<&[String]>,
) -> String {
    let (_, sections) = split_knowledge_section_blocks(body);
    let mut lines = vec![
        "【已有项目知识库·索引】（正文不在上下文中，需要时用 read_file 读取）".to_string(),
        format!("路径：{PROJECT_KNOWLEDGE_REL}"),
    ];
    if let Some(rounds) = meta.explore_rounds {
        lines.push(format!("探索轮次：{rounds}"));
    }
    if let Some(at) = meta.last_explored_at.as_deref().filter(|s| !s.is_empty()) {
        lines.push(format!("上次探索：{at}"));
    }
    if let Some(head) = meta.git_head.as_deref().filter(|s| !s.is_empty()) {
        let short = head.chars().take(12).collect::<String>();
        lines.push(format!("基于提交：{short}"));
    }
    if !sections.is_empty() {
        lines.push(String::new());
        lines.push("章节状态：".to_string());
        for section in &sections {
            lines.push(format!(
                "- {}（{}）",
                section.title,
                section_status_label(section.status)
            ));
        }
    }
    let unexplored = find_gap_section_titles(body);
    if !unexplored.is_empty() {
        lines.push(String::new());
        lines.push(format!("待补全：{}", unexplored.join("、")));
    }
    if let Some(paths) = changed_paths.filter(|p| !p.is_empty()) {
        let shown: Vec<&str> = paths.iter().take(24).map(|s| s.as_str()).collect();
        let suffix = if paths.len() > shown.len() { "…" } else { "" };
        lines.push(String::new());
        lines.push(format!(
            "自上次探索以来变更文件（优先核对）：{}{suffix}",
            shown.join("、")
        ));
    }
    lines.push(String::new());
    lines.push(format!(
    "更新知识库前请先 read_file {PROJECT_KNOWLEDGE_REL}（大文件用 offset/limit 分段）；勿重复 read 已在上下文中完整出现的项目扫描摘要。"
  ));
    lines.join("\n")
}

pub fn build_knowledge_rebuild_hint() -> String {
    [
    "【重新构建】磁盘上已有旧版知识库。",
    &format!(
      "可选 read_file {PROJECT_KNOWLEDGE_REL} 作参考；本次须输出全新完整知识库正文（含 project-knowledge 标记），覆盖旧内容。"
    ),
  ]
  .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    const MARKER: &str = "<!-- project-knowledge -->";
    const TITLE: &str = "项目知识库";

    #[test]
    fn manifest_includes_section_status_without_full_body() {
        let body = [
            MARKER,
            &format!("# {TITLE}"),
            "## 技术栈",
            "Vue",
            "## 核心模块",
            "未探索",
        ]
        .join("\n");
        let manifest = build_knowledge_explore_manifest(
            &body,
            &ProjectKnowledgeMeta {
                explore_rounds: Some(2),
                git_head: Some("abc123def456".into()),
                ..Default::default()
            },
            None,
        );
        assert!(manifest.contains(PROJECT_KNOWLEDGE_REL));
        assert!(manifest.contains("技术栈（已覆盖）"));
        assert!(manifest.contains("核心模块（未探索）"));
        assert!(!manifest.contains("Vue"));
        assert!(manifest.contains("read_file"));
    }

    #[test]
    fn parses_frontmatter_meta() {
        let raw = "---\nexploreRounds: 3\ngitHead: abc\n---\n\n# body";
        let (meta, body) = parse_project_knowledge_frontmatter(raw);
        assert_eq!(meta.explore_rounds, Some(3));
        assert_eq!(meta.git_head.as_deref(), Some("abc"));
        assert!(body.contains("# body"));
    }

    #[test]
    fn find_gap_titles_skips_covered_sections() {
        let body = [
            MARKER,
            &format!("# {TITLE}"),
            "## 技术栈",
            "Vue 3",
            "## 核心模块",
            "未探索",
        ]
        .join("\n");
        let gaps = find_gap_section_titles(&body);
        assert_eq!(gaps, vec!["核心模块"]);
    }

    #[test]
    fn strip_frontmatter_returns_body() {
        let raw = "---\nexploreRounds: 1\n---\n\n## 技术栈\nVue";
        assert_eq!(strip_knowledge_frontmatter(raw), "## 技术栈\nVue");
    }
}
