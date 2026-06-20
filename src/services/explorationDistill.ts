import {
  buildExplorationMemoryCandidates,
  shouldOfferExplorationMemory,
  uniqueReadPathsFromTools,
  type ExplorationMemoryCandidate,
  type MemorySectionId,
} from "./explorationMemorySuggest";

export type ExplorationArchiveDraft = {
  id: string;
  filename: string;
  content: string;
  readPaths: string[];
  writtenPaths: string[];
  turnCount: number;
  /** Agent progress text extracted from assistant messages during exploration. */
  assistantText?: string;
  /** Concise summary of key findings extracted from assistantText. */
  summary?: string;
};

export type SkillDistillProposal = {
  id: string;
  slug: string;
  kind: "heuristic";
  title: string;
  content: string;
  checked: boolean;
};

export type ExplorationDistillResult = {
  offer: boolean;
  memoryCandidates: ExplorationMemoryCandidate[];
  archive?: ExplorationArchiveDraft;
  skillProposals: SkillDistillProposal[];
};

type ToolLike = {
  name?: string;
  ok?: boolean;
  args?: Record<string, unknown>;
};

type DistillInput = {
  tools?: ToolLike[];
  writtenFiles?: string[];
  agentAborted?: boolean;
  agentFailed?: boolean;
  chatMode?: string;
  totalTurns?: number;
  hadAttachedImage?: boolean;
  /** Agent progress/finding text from assistant messages during exploration. */
  assistantText?: string;
};

function explorationArchiveId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return stamp.slice(0, 19);
}

/** Max characters for the summary section in archive markdown. */
const SUMMARY_MAX_CHARS = 600;

/**
 * Extract a concise summary from agent assistantText.
 * Heuristics:
 * 1. Prefer lines containing Chinese conclusions / key findings markers.
 * 2. Strip tool-call artifacts (grep/read/patch logs).
 * 3. Truncate to SUMMARY_MAX_CHARS.
 */
export function extractExplorationSummary(assistantText: string | undefined): string {
  if (!assistantText?.trim()) return "";
  const text = assistantText.trim();

  // Lines that signal mere progress — not findings
  const PROGRESS_RE =
    /^(?:现在|接下来|让我|我来|我们|下面|先|然后|再)\s*(?:看看|查看|读取|搜索|检查|分析|确认|定位|找到|打开|找|查|读|写|看|试)/;

  const lines = text.split("\n").filter((line) => {
    const t = line.trim();
    if (!t) return false;
    // Skip tool call artifacts
    if (/^<function_|^<tool_|^<\/function|^<\/tool/i.test(t)) return false;
    // Skip bare XML / HTML tags without CJK
    if (/^<[a-z]+>$/i.test(t) && !/[\u4e00-\u9fff]/.test(t)) return false;
    // Skip tool parameter lines
    if (/^(?:path|pattern|command|query|content|old_string|new_string)\s*=/i.test(t)) return false;
    // Skip pure progress lines
    if (PROGRESS_RE.test(t)) return false;
    return true;
  });

  if (!lines.length) return "";

  // Prefer lines with CJK (actual Chinese findings)
  const meaningfulLines = lines.filter((l) => /[\u4e00-\u9fff]/.test(l));
  const source = meaningfulLines.length >= 2 ? meaningfulLines : lines;

  const joined = source
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (joined.length <= SUMMARY_MAX_CHARS) return joined;
  return joined.slice(0, SUMMARY_MAX_CHARS) + "…";
}

export function buildExplorationArchiveMarkdown(params: {
  readPaths: string[];
  writtenPaths: string[];
  turnCount: number;
  createdAt?: string;
  summary?: string;
  /** When provided, summary is auto-extracted if not given. */
  assistantText?: string;
}): string {
  const createdAt = params.createdAt ?? new Date().toISOString();
  const summary = params.summary ?? extractExplorationSummary(params.assistantText);
  const lines = [
    "---",
    `createdAt: ${createdAt}`,
    `turns: ${params.turnCount}`,
    `readCount: ${params.readPaths.length}`,
    `writtenCount: ${params.writtenPaths.length}`,
    "---",
    "",
  ];
  if (summary) {
    lines.push("# 探索快照", "", summary, "");
  } else {
    // Fallback: brief description when no summary extracted
    const allPaths = [...new Set([...params.readPaths, ...params.writtenPaths])];
    const fileCount = allPaths.length;
    lines.push(
      "# 探索快照",
      "",
      `本轮探索读取 ${params.readPaths.length} 个文件、写入 ${params.writtenPaths.length} 个文件` +
        (fileCount > 0 ? `，涉及 ${fileCount} 个不同路径。` : "。"),
      "",
    );
  }
  return lines.join("\n").trim() + "\n";
}

function buildSkillProposals(params: {
  readPaths: string[];
  writtenPaths: string[];
  hadAttachedImage: boolean;
  turnCount: number;
}): SkillDistillProposal[] {
  const proposals: SkillDistillProposal[] = [];
  if (params.hadAttachedImage && params.readPaths.length >= 2) {
    proposals.push({
      id: "skill:ui-locate-run",
      slug: "ui-screenshot-locate",
      kind: "heuristic",
      title: "附图 UI 定位顺序",
      content: [
        "本次 run 含附图且多次 read_file；定位须：锚点 grep → read 核对 DOM → 再 patch。",
        `本次读取：${params.readPaths.slice(0, 4).map((p) => `\`${p}\``).join("、")}${params.readPaths.length > 4 ? " 等" : ""}`,
      ].join("\n"),
      checked: false,
    });
  }
  if (params.turnCount >= 8 && params.readPaths.length >= 4) {
    proposals.push({
      id: "skill:broad-explore",
      slug: "broad-explore-cap",
      kind: "heuristic",
      title: "广搜后应收敛",
      content: `本次探索 ${params.turnCount} 轮、读取 ${params.readPaths.length} 个路径；广搜后应 grep 锚点或 read 命中文件并 patch，避免重复 list_dir。`,
      checked: false,
    });
  }
  return proposals.slice(0, 2);
}

export function distillExplorationRun(input: DistillInput): ExplorationDistillResult {
  const offer = shouldOfferExplorationMemory({
    tools: input.tools,
    writtenFiles: input.writtenFiles,
    agentAborted: input.agentAborted,
    chatMode: input.chatMode,
  });
  const memoryCandidates = buildExplorationMemoryCandidates({
    tools: input.tools,
    writtenFiles: input.writtenFiles,
  });

  const readPaths = uniqueReadPathsFromTools(input.tools);
  const writtenPaths = [...new Set((input.writtenFiles ?? []).map((p) => p.replace(/\\/g, "/")))];
  const turnCount = Math.max(0, input.totalTurns ?? 0);

  if (!offer) {
    return { offer: false, memoryCandidates: [], skillProposals: [] };
  }

  const id = explorationArchiveId();
  const summary = extractExplorationSummary(input.assistantText);
  const archive: ExplorationArchiveDraft = {
    id,
    filename: `${id}.md`,
    content: buildExplorationArchiveMarkdown({ readPaths, writtenPaths, turnCount, summary }),
    readPaths,
    writtenPaths,
    turnCount,
    summary,
  };

  const skillProposals = buildSkillProposals({
    readPaths,
    writtenPaths,
    hadAttachedImage: Boolean(input.hadAttachedImage),
    turnCount,
  });

  return {
    offer: true,
    memoryCandidates,
    archive,
    skillProposals,
  };
}

export type MemorySectionIdExport = MemorySectionId;
