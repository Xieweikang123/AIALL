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
};

function explorationArchiveId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return stamp.slice(0, 19);
}

export function buildExplorationArchiveMarkdown(params: {
  readPaths: string[];
  writtenPaths: string[];
  turnCount: number;
  createdAt?: string;
}): string {
  const createdAt = params.createdAt ?? new Date().toISOString();
  const lines = [
    "---",
    `createdAt: ${createdAt}`,
    `turns: ${params.turnCount}`,
    `readCount: ${params.readPaths.length}`,
    `writtenCount: ${params.writtenPaths.length}`,
    "---",
    "",
    "# 探索快照",
    "",
    `- 轮次：${params.turnCount}`,
    `- 读取 ${params.readPaths.length} 个文件，写入 ${params.writtenPaths.length} 个文件`,
    "",
  ];
  if (params.writtenPaths.length) {
    lines.push("## 写入路径", "", ...params.writtenPaths.map((p) => `- \`${p}\``), "");
  }
  if (params.readPaths.length) {
    lines.push("## 读取路径", "", ...params.readPaths.map((p) => `- \`${p}\``), "");
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
  const archive: ExplorationArchiveDraft = {
    id,
    filename: `${id}.md`,
    content: buildExplorationArchiveMarkdown({ readPaths, writtenPaths, turnCount }),
    readPaths,
    writtenPaths,
    turnCount,
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
