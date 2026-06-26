import {
  isExploreChangesPrompt,
  isExploreContinuePrompt,
  isExploreFollowUpPrompt,
  isExploreSectionFillPrompt,
} from "./knowledgeExplore";

export {
  classifyExploreKnowledgeIntent,
  exploreIntentUsesKnowledgeManifest,
  isExploreChangesPrompt,
  isExploreContinuePrompt,
  isExploreFollowUpPrompt,
  isExploreSectionFillPrompt,
  isKnowledgeQuoteFollowUpPrompt,
  type ExploreKnowledgeIntent,
} from "./knowledgeExplore";

/** Default user message when starting project knowledge exploration. */
export const EXPLORE_PROJECT_PRESET_PROMPT =
  "请系统性地了解当前项目，输出完整的项目知识库（技术栈、目录、入口、核心模块、依赖、开发命令、阅读顺序）。不要修改任何文件。";

/** Sent when user clicks「继续探索」on the knowledge base. */
export const EXPLORE_CONTINUE_PRESET_PROMPT =
  "请继续探索项目中尚未覆盖的部分，补充并更新项目知识库。不要修改任何文件。";

export type ExploreDepth = "quick" | "standard" | "deep";

export const EXPLORE_DEPTH_MAX_TURNS: Record<ExploreDepth, number> = {
  quick: 8,
  standard: 16,
  deep: 24,
};

export const EXPLORE_FOLLOWUP_MAX_TURNS = 12;
export const EXPLORE_RESUME_BONUS_TURNS = 8;

export const EXPLORE_QUICK_FOLLOWUP_CHIPS = [
  "请深挖 server 端目录结构与职责",
  "项目的测试如何运行？",
  "请补充数据流与关键依赖说明",
] as const;

/** Targeted explore for sections marked 未探索 / 待验证 in the knowledge base. */
export function buildExploreUnexploredPrompt(sectionTitles: string[]): string {
  if (!sectionTitles.length) return EXPLORE_CONTINUE_PRESET_PROMPT;
  const shown = sectionTitles.slice(0, 8);
  const list = shown.join("、");
  const suffix =
    sectionTitles.length > shown.length ? `等 ${sectionTitles.length} 个章节` : "";
  return [
    `请针对性探索并补全以下标注为「未探索」或「待验证」的知识库章节：${list}${suffix}。`,
    "先用 read_file 阅读 .aiall/project-knowledge.md 了解现有正文；再 read/grep 相关代码。",
    "仅输出上述章节的更新内容：每个章节以 `## 章节标题` 开头，勿输出完整知识库或 project-knowledge 标记。",
    "不要修改任何文件。",
  ].join("");
}

const EXPLORE_CHANGED_FILES_LIST_MAX = 16;

/** Targeted explore for files changed since the knowledge base gitHead. */
export function buildExploreChangedFilesPrompt(
  changedFileCount: number,
  changedFiles?: readonly string[],
): string {
  const count = Math.max(1, changedFileCount);
  const lines = [
    `请针对自上次探索以来变更的代码文件（共 ${count} 个），更新知识库中受影响的章节。`,
    "先用 read_file 阅读 .aiall/project-knowledge.md 了解现有正文；再 read/grep 变更相关代码。",
    "仅输出需修订的 `## 章节` 内容，勿输出完整知识库或 project-knowledge 标记。",
    "不要修改任何文件。",
  ];
  const files = changedFiles?.filter((f) => f && f.trim()).map((f) => f.trim());
  if (files && files.length > 0) {
    const shown = files.slice(0, EXPLORE_CHANGED_FILES_LIST_MAX);
    const list = shown.map((f) => `- ${f}`).join("\n");
    const tail = files.length > shown.length ? `\n（另有 ${files.length - shown.length} 个，请用 grep/find 自行定位）` : "";
    lines.push("", "变更文件列表：", list + tail);
  }
  return lines.join("\n");
}

const KNOWLEDGE_QUOTE_EXCERPT_MAX = 2000;

/** Build explore prompt for a user-selected knowledge excerpt + optional question. */
export function buildKnowledgeQuoteFollowUpPrompt(excerpt: string, question = ""): string {
  const quote = excerpt.trim().slice(0, KNOWLEDGE_QUOTE_EXCERPT_MAX);
  const q = question.trim();
  const quoteBlock = quote.split("\n").map((line) => `> ${line}`).join("\n");
  const questionLine = q
    ? `用户问题：${q}`
    : "用户希望核实并补充上述段落的内容。";
  return [
    "用户引用了知识库中的以下段落：",
    "",
    quoteBlock,
    "",
    questionLine,
    "",
    "请结合项目代码核实/补充，并将有价值的信息写入知识库（优先更新引用所在 `## 章节` 正文；勿堆到文末）。",
    "仅当无法归入任何已有章节时，才输出 `## 补充：{主题}`。不要修改任何文件。",
  ].join("\n");
}

export function resolveExploreRequestMaxTurns(
  prompt: string,
  _history: Array<{ role: string; content: string }> | undefined,
  explicit?: number,
  completedTurns = 0,
  depth: ExploreDepth = "standard",
): number {
  if (explicit != null && explicit > 0) return explicit;
  if (isExploreContinuePrompt(prompt)) {
    return completedTurns > 0
      ? Math.min(48, completedTurns + EXPLORE_RESUME_BONUS_TURNS)
      : EXPLORE_DEPTH_MAX_TURNS[depth] + EXPLORE_RESUME_BONUS_TURNS;
  }
  if (isExploreSectionFillPrompt(prompt) || isExploreChangesPrompt(prompt) || isExploreFollowUpPrompt(prompt)) {
    return EXPLORE_FOLLOWUP_MAX_TURNS;
  }
  return EXPLORE_DEPTH_MAX_TURNS[depth];
}
