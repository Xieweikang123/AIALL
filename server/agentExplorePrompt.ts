import { buildFileAccessPathHint } from "./agentAskPrompt";
import { buildReplyAccuracyHint } from "../src/services/agentReplyAccuracy";
import { buildAgentSuggestionsPromptHint } from "../src/services/agentSuggestions";

export const PROJECT_REPORT_MARKER = "<!-- project-report -->";

export function buildExploreExplorationHints(): string {
  return [
    "探索策略（项目理解）：",
    "1. 系统已注入目录树与关键文件摘要，勿重复 read 已注入内容；在其基础上深化。",
    "2. 定位时优先 grep；search_files 仅按文件名匹配。",
    "3. read_file 单次约 200–400 行；每层目录抽样 1–2 个代表文件，禁止只深挖单一子系统。",
    "4. 按顺序覆盖：入口链路 → 路由/模块划分 → 核心服务层 → 数据/配置。",
    "5. 信息足够后立即输出报告；禁止无意义续读。",
  ].join("\n");
}

export function buildExploreReportFormatHint(): string {
  return [
    "报告格式（必须严格遵守）：",
    `1. 正文开头必须是标记行：${PROJECT_REPORT_MARKER}`,
    "2. 随后输出 # 项目理解报告 及下列章节（无证据的章节标注「未探索」或「待验证」）：",
    "   - ## 一句话摘要",
    "   - ## 技术栈",
    "   - ## 目录结构",
    "   - ## 入口与启动流程",
    "   - ## 核心模块（表格：模块 | 路径 | 职责）",
    "   - ## 数据流 / 关键依赖",
    "   - ## 常用开发命令",
    "   - ## 建议阅读顺序",
    "3. 关键结论须附带 `相对路径` 或函数名作为证据；不确定处标明「待验证」。",
    "4. 用户追问时：可输出 `## 补充：{主题}` 附在报告后，或更新对应章节。",
  ].join("\n");
}

export function buildExploreContinueNudge(): string {
  return [
    "【继续探索】用户希望扩大覆盖面、补充报告遗漏部分。",
    "请自检报告中标注「未探索」或缺失的模块/目录，针对性 read/grep 后更新报告。",
    "禁止重头探索已覆盖内容；优先补缺口，再输出更新后的完整报告（保留 project-report 标记）。",
  ].join("\n");
}

export function buildExploreFollowUpHint(): string {
  return [
    "【追问】用户针对报告某方面追问。",
    "定向 read 1–3 个相关文件后作答；若需结构化补充，输出 `## 补充：{主题}`。",
    "禁止无关广搜；禁止修改任何文件。",
  ].join("\n");
}

export function buildExploreAbortPartialReportNudge(readCount: number): string {
  return [
    `【提前结束】用户已停止探索（已读约 ${readCount} 个文件）。`,
    "请基于已有证据输出不完整版项目理解报告（保留 project-report 标记）。",
    "未覆盖的章节标注「未探索」；禁止空回复。",
  ].join("\n");
}

export function buildExploreSystemPromptLines(projectRoot: string): string[] {
  return [
    "你是项目理解助手（Explore·只读）。",
    "回答请使用中文。",
    "你只能使用 list_dir、read_file、grep、search_files、web_search、web_extract 探索项目，禁止修改任何文件。",
    buildFileAccessPathHint(),
    buildExploreExplorationHints(),
    buildExploreReportFormatHint(),
    buildReplyAccuracyHint(),
    buildAgentSuggestionsPromptHint(),
    `项目根目录：${projectRoot}`,
  ];
}

export function buildExploreSystemPrompt(projectRoot: string): string {
  return buildExploreSystemPromptLines(projectRoot).join("\n");
}
