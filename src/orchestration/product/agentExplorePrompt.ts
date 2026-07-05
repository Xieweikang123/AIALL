import { buildFileAccessPathHint } from "./agentAskPrompt";
import { buildReplyAccuracyHint } from "../../services/agentReplyAccuracy";
import { buildAgentSuggestionsPromptHint } from "../../services/agentSuggestions";
import {
  PROJECT_KNOWLEDGE_MARKER,
  PROJECT_KNOWLEDGE_TITLE,
  PROJECT_REPORT_MARKER,
} from "../../../shared/projectKnowledgeFormat";

export { PROJECT_KNOWLEDGE_MARKER, PROJECT_KNOWLEDGE_TITLE, PROJECT_REPORT_MARKER };

export function buildExploreExplorationHints(incremental = false): string {
  if (incremental) {
    return [
      "探索策略（增量更新知识库）：",
      "1. 系统已注入知识库索引（章节状态）与项目目录摘要；正文须 read_file .aiall/project-knowledge.md 获取。",
      "2. 优先补标题带（未探索）（待验证）后缀的章节；定位代码用 grep，search_files 仅按文件名。",
      "3. read_file 单次约 200–400 行；避免重复 read 已在索引中确认无缺的章节对应代码。",
      "4. 信息足够后输出：继续探索→完整知识库正文；补全章节→仅输出目标 ## 章节（标题勿带后缀）；追问→## 补充 或单章节。",
    ].join("\n");
  }
  return [
    "探索策略（项目理解）：",
    "1. 系统已注入目录树与关键文件摘要，勿重复 read 已注入内容；在其基础上深化。",
    "2. 定位时优先 grep；search_files 仅按文件名匹配。",
    "3. read_file 单次约 200–400 行；每层目录抽样 1–2 个代表文件，禁止只深挖单一子系统。",
    "4. 按顺序覆盖：入口链路 → 路由/模块划分 → 核心服务层 → 数据/配置。",
    "5. 信息足够后立即输出知识库正文；禁止无意义续读。",
  ].join("\n");
}

export function buildExploreReportFormatHint(): string {
  return [
    "知识库格式（必须严格遵守）：",
    `1. 正文开头必须是标记行：${PROJECT_KNOWLEDGE_MARKER}`,
    `2. 随后输出 # ${PROJECT_KNOWLEDGE_TITLE} 及下列章节：`,
    "   - ## 一句话摘要",
    "   - ## 技术栈",
    "   - ## 目录结构",
    "   - ## 入口与启动流程",
    "   - ## 核心模块（表格：模块 | 路径 | 职责）",
    "   - ## 数据流 / 关键依赖",
    "   - ## 常用开发命令",
    "   - ## 建议阅读顺序",
    "   尚无可靠证据的章节：仅在 `## 标题` 末尾加（未探索）或（待验证），正文留空；勿在正文单独写「未探索」「待验证」。",
    "3. 已有证据的结论须附带 `相对路径` 或函数名；单条结论证据不足时用「证据不足」「需核实」，勿在正文写「待验证」（该词仅用于章节标题后缀）。",
    "4. 用户追问时：优先只输出需更新的已有 `## 章节`（并入该节正文）；仅当无法归入任何章节时才用 `## 补充：{主题}`。",
  ].join("\n");
}

export function buildExploreContinueNudge(): string {
  return [
    "【继续探索】用户希望扩大覆盖面、补充知识库遗漏部分。",
    "须先 read_file .aiall/project-knowledge.md 阅读现有正文，再针对性 read/grep 代码。",
    "禁止重头探索已覆盖内容；优先补缺口，再输出更新后的完整知识库正文（保留 project-knowledge 标记）。",
  ].join("\n");
}

export function buildExploreSectionFillNudge(): string {
  return [
    "【补全章节】用户指定了待补全的知识库章节。",
    "须先 read_file .aiall/project-knowledge.md；再 read/grep 相关代码。",
    "仅输出指定章节的 `## 标题` 及更新内容（标题勿带（未探索）（待验证）后缀，正文须有实质内容）。",
    "勿输出完整知识库或 project-knowledge 标记。",
  ].join("\n");
}

export function buildExploreChangesNudge(): string {
  return [
    "【变更探索】用户希望根据自上次探索以来的代码变更更新知识库。",
    "须先 read_file .aiall/project-knowledge.md；系统已注入变更文件列表，优先 read/grep 这些路径。",
    "只更新受影响的已有 `## 章节`；仅输出需修订的章节内容，勿输出完整知识库或 project-knowledge 标记。",
  ].join("\n");
}

export function buildExploreFollowUpHint(): string {
  return [
    "【追问】用户针对知识库某方面追问。",
    "须先 read_file .aiall/project-knowledge.md 了解现有内容；再定向 read 1–3 个相关代码文件。",
    "优先只输出需更新的已有 `## 章节`（例如目录/路径类→目录结构，模块职责→核心模块）；勿把可并入现有章节的内容堆到文末。",
    "仅当确实无法归入任何章节时，才输出 `## 补充：{主题}`。",
    "禁止无关广搜；禁止修改任何文件。",
  ].join("\n");
}

export function buildExploreQuotedFollowUpHint(): string {
  return [
    "【引用追问】用户选中了知识库中的一段正文并提问。",
    "须先 read_file .aiall/project-knowledge.md，定位引用段落所属章节；再 read/grep 相关代码核实。",
    "回答须落实到知识库：优先更新引用所在 `## 章节` 的正文；若不适合并入原节，输出 `## 补充：{主题}`。",
    "仅输出需新增/修订的章节内容，勿重复输出整库；禁止修改任何文件。",
  ].join("\n");
}

export function buildExploreAbortPartialReportNudge(readCount: number): string {
  if (readCount <= 0) {
    return [
      "【提前结束】用户在探索开始前就停止了，尚未读取任何项目文件。",
      "不要输出知识库正文，也不要生成 `## 章节` 占位；如此时无任何探索证据，请直接以一句中文简述中止原因（例如「探索未开始即被中止」）。",
      "禁止编造未读代码的章节内容。",
    ].join("\n");
  }
  return [
    `【提前结束】用户已停止探索（已读约 ${readCount} 个文件）。`,
    "请基于已有证据输出不完整版项目知识库（保留 project-knowledge 标记）。",
    "未覆盖的章节在 `## 标题` 末尾加（未探索）；禁止空回复。",
  ].join("\n");
}

export function buildExploreSystemPromptLines(projectRoot: string, incremental = false): string[] {
  return [
    "你是项目知识库构建助手（Explore·只读）。",
    "回答请使用中文。",
    "你只能使用 list_dir、read_file、grep、search_files、web_search、web_extract 探索项目，禁止修改任何文件。",
    buildFileAccessPathHint(),
    buildExploreExplorationHints(incremental),
    buildExploreReportFormatHint(),
    buildReplyAccuracyHint(),
    buildAgentSuggestionsPromptHint(),
    `项目根目录：${projectRoot}`,
  ];
}

export function buildExploreSystemPrompt(projectRoot: string, incremental = false): string {
  return buildExploreSystemPromptLines(projectRoot, incremental).join("\n");
}
