import { type ArchitectReviewVerdict, parseArchitectReviewVerdictFromBody } from "./projectArchitectReviewFormat";

export const ARCHITECT_REVIEW_MARKER = "<!-- project-architect-review -->";
export const ARCHITECT_REVIEW_TITLE = "项目架构审视报告";

export const ARCHITECT_REVIEW_MAX_TURNS = 20;

/** Fixed user message when starting an architect review run. */
export const ARCHITECT_REVIEW_PRESET_PROMPT =
  "请从架构师视角审视当前项目：对照近期变更评估方向是否跑偏、模块边界是否清晰、是否存在重复或过度抽象、有哪些方向性风险。禁止修改任何文件；探索完成后输出完整《项目架构审视报告》。";

export type ArchitectReviewCommitSummary = {
  hash: string;
  shortHash: string;
  date: string;
  message: string;
  fileCount: number;
};

export type ArchitectReviewContextBundle = {
  projectPath: string;
  currentGitHead?: string;
  sinceGitRef?: string;
  recentCommits: ArchitectReviewCommitSummary[];
  changedFiles: string[];
  knowledgeExcerpt?: string;
  lastReviewedAt?: string;
};

export function isArchitectReviewReport(content: string): boolean {
  return content.includes(ARCHITECT_REVIEW_MARKER);
}

export function extractArchitectReviewBody(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";
  if (isArchitectReviewReport(trimmed)) return trimmed;
  return trimmed;
}

export { parseArchitectReviewVerdictFromBody };

export function architectReviewNeedsAttention(
  verdict: ArchitectReviewVerdict | null | undefined,
): boolean {
  return verdict === "caution" || verdict === "off_track";
}

export function architectReviewBadgeCount(
  verdict: ArchitectReviewVerdict | null | undefined,
): number {
  return architectReviewNeedsAttention(verdict) ? 1 : 0;
}

export function formatArchitectReviewVerdictLabel(
  verdict: ArchitectReviewVerdict | null | undefined,
): string {
  if (verdict === "off_track") return "明显跑偏";
  if (verdict === "caution") return "需关注";
  if (verdict === "on_track") return "方向正确";
  return "未评估";
}

function formatCommitBlock(commits: ArchitectReviewCommitSummary[]): string {
  if (!commits.length) return "（无 Git 提交记录或非 Git 仓库）";
  const lines = commits.map((c) => {
    const msg = c.message.split("\n")[0]?.trim() || "(无说明)";
    return `- ${c.shortHash} · ${c.date} · ${msg}（${c.fileCount} 个文件）`;
  });
  return lines.join("\n");
}

function formatChangedFilesBlock(files: string[], max = 40): string {
  if (!files.length) return "（自基准提交以来无文件变更，或无法获取）";
  const shown = files.slice(0, max);
  const lines = shown.map((f) => `- ${f}`);
  if (files.length > max) {
    lines.push(`- …另有 ${files.length - max} 个文件未列出`);
  }
  return lines.join("\n");
}

export function buildArchitectReviewReportFormatHint(): string {
  return [
    "报告格式（必须严格遵守）：",
    `1. 正文开头必须是标记行：${ARCHITECT_REVIEW_MARKER}`,
    `2. 随后输出 # ${ARCHITECT_REVIEW_TITLE} 及下列章节：`,
    "   - ## 总体判断（正文须明确写出 **方向正确**、**需关注** 或 **明显跑偏** 三者之一，并附一句话理由）",
    "   - ## 目标对齐（当前实现与会话/产品目标是否一致）",
    "   - ## 模块与边界（职责划分、耦合、分层是否合理）",
    "   - ## 重复与抽象（重复逻辑、过度/不足抽象）",
    "   - ## 方向性风险（架构漂移、技术债、扩展性隐患）",
    "   - ## 近期变更解读（结合下方 Git 清单，变更是否加剧或缓解风险）",
    "   - ## 建议下一步（可执行的 3–5 条优先级建议）",
    "3. 关键结论须附带 `相对路径` 或模块名作为证据；不确定处标明「待验证」。",
    "4. 禁止输出 fenced 代码块外的工具调用标记；禁止修改任何文件。",
  ].join("\n");
}

export function buildArchitectReviewPrompt(context: ArchitectReviewContextBundle): string {
  const lines = [
    ARCHITECT_REVIEW_PRESET_PROMPT,
    "",
    "审视策略：",
    "1. 系统已注入项目目录与关键文件摘要；在其基础上用 read_file / grep 抽样验证，勿重复 read 已注入内容。",
    "2. 优先 read/grep 下方「近期变更文件」与核心入口/编排层，再评估全局边界与方向。",
    "3. 若存在项目知识库，可先 read_file .aiall/project-knowledge.md 了解既有理解，再独立判断。",
    "4. 聚焦架构与方向，不要检查语法/lint/typecheck，不要罗列 grep 式坏味道清单。",
    "5. 信息足够后立即输出完整审视报告，禁止无意义续读。",
    "",
    buildArchitectReviewReportFormatHint(),
    "",
    `项目路径：${context.projectPath}`,
  ];

  if (context.currentGitHead) {
    lines.push(`当前 HEAD：${context.currentGitHead}`);
  }
  if (context.sinceGitRef) {
    lines.push(`变更基准：${context.sinceGitRef}（上次审视或近 ${context.recentCommits.length || 0} 次提交）`);
  }
  if (context.lastReviewedAt) {
    lines.push(`上次审视：${context.lastReviewedAt}`);
  }

  lines.push("", "近期提交（从新到旧）：", formatCommitBlock(context.recentCommits));
  lines.push("", "近期变更文件（相对项目根）：", formatChangedFilesBlock(context.changedFiles));

  if (context.knowledgeExcerpt?.trim()) {
    lines.push("", "项目知识库摘要（只读参考，可能与代码不同步）：", "```markdown", context.knowledgeExcerpt.trim(), "```");
  }

  return lines.join("\n");
}
