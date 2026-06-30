import {
  buildAskSystemPromptLines,
  buildFileAccessPathHint,
} from "./agentAskPrompt";
import {
  buildExploreSystemPromptLines,
} from "./agentExplorePrompt";
import {
  classifyExploreKnowledgeIntent,
  exploreIntentUsesKnowledgeManifest,
} from "../src/services/knowledgeExplore";
import {
  buildKnowledgeExploreManifest,
  buildKnowledgeRebuildHint,
} from "../src/services/projectReportDisplay";
import { gitChangedFilesSince, gitDiffContent, gitStatus } from "./vibeGit";
import { formatGitStatusForAgent, parseGitVirtualPath } from "./agentGitTools";
import { isGitWorkingTreeTopicPrompt } from "../src/services/agentStructuralPatterns";
import {
  buildReplyAccuracyHint,
} from "../src/services/agentReplyAccuracy";
import {
  buildConsultativeTopicHints,
} from "../src/services/agentConsultativeTopics";
import { historySuggestsQuotePositionFix } from "../src/orchestration/generic/userIntentClassifiers";
import {
  buildBuildWriteBlockedHint,
  buildImplementFollowUpHint,
  buildQuotedAmendHint,
  buildLocateStatusFollowUpHint,
  buildUiDefectBuildHint,
} from "../src/orchestration/product/userIntentHints";
import {
  buildCodeReviewHonestyNudge,
  buildUserErrorQuoteHint,
  buildUserFailureReportNudge,
  buildSameIssueFollowUpHint,
  buildUltraShortOpenTaskHint,
  buildAutomatedBugFixHint,
} from "./agentExplorationBudget";
import { detectProjectRuntimeProfile, buildRuntimeAwarenessHint, buildShellAwarenessHint } from "./agentRuntimeHint";
import { stripQuotedReplyPrefix } from "../src/services/agentContinuation";
import {
  buildExecutePlanSystemHint,
  buildTargetFileManifest,
  type ExecutePlanContextInput,
} from "./agentExecutePlanContext";
import {
  buildProjectContext,
  buildInjectedKeyFilePathSet,
  formatProjectContextForBuild,
  formatProjectContextForPrompt,
} from "./vibeProjectContext";
import {
  formatProjectMemoryForPrompt,
  readProjectMemory,
} from "./vibeProjectMemory";
import {
  formatProjectKnowledgeForPrompt,
  readProjectKnowledge,
} from "./vibeProjectKnowledge";
import { formatAgentsGuideForPrompt, readProjectAgentsGuide } from "./vibeProjectAgentsGuide";
import {
  buildExplorationArchivePromptBlock,
  buildProjectSkillsPromptBlock,
} from "./vibeProjectSkills";
import {
  readFileContent,
  resolveProjectPath,
  sliceFileLines,
} from "./vibeFs";
import {
  buildModelIdentityHint,
} from "./visionMessage";
import { buildPlanSystemPrompt } from "./agentPlanPrompt";
import type { AgentRunPolicy } from "./agentRunPolicy";
import type { VibeChatMode } from "../shared/agentTypes";

export type ResolvedOpenFile = {
  path: string;
  relative: string;
  gitIndexView?: boolean;
  gitHistoryView?: boolean;
};

export function resolveOpenFileInProject(
  projectRoot: string,
  openFilePath?: string,
): ResolvedOpenFile | null {
  if (!openFilePath?.trim()) return null;
  const virtual = parseGitVirtualPath(openFilePath);
  if (virtual) {
    const resolved = resolveProjectPath(projectRoot, virtual.relative);
    if (!resolved.ok || !resolved.relative) return null;
    return {
      path: resolved.path,
      relative: resolved.relative,
      gitIndexView: virtual.kind === "index",
      gitHistoryView: virtual.kind === "history",
    };
  }
  const resolved = resolveProjectPath(projectRoot, openFilePath.trim());
  if (!resolved.ok || !resolved.relative) return null;
  return { path: resolved.path, relative: resolved.relative };
}

function formatOpenFileContextLine(openFile: ResolvedOpenFile): string {
  if (openFile.gitIndexView) return `用户当前在 Git 暂存区查看：${openFile.relative}`;
  if (openFile.gitHistoryView) return `用户当前在 Git 历史视图查看：${openFile.relative}`;
  return `用户当前打开的文件：${openFile.relative}`;
}

async function buildOpenFileSnippet(
  projectRoot: string,
  openFile: ResolvedOpenFile,
): Promise<string> {
  if (openFile.gitIndexView) {
    const diff = await gitDiffContent(projectRoot, openFile.relative, true);
    if (diff.ok) {
      if (diff.before.trim() && diff.after.trim() && diff.before !== diff.after) {
        return [
          `暂存区 diff（${openFile.relative}）`,
          "--- 变更前",
          sliceFileLines(diff.before, 1, 120),
          "--- 变更后",
          sliceFileLines(diff.after, 1, 120),
        ].join("\n");
      }
      if (diff.after.trim()) {
        return [
          `暂存区内容（${openFile.relative}）`,
          sliceFileLines(diff.after, 1, 200),
        ].join("\n");
      }
    }
  }
  const result = await readFileContent(openFile.path).catch(() => null);
  if (result?.ok) return sliceFileLines(result.content, 1, 400);
  return "";
}

function buildSystemPrompt(projectRoot: string, openFilePath?: string, model?: string): string {
  const lines = [
    "你是一个专业的编程 Agent（Build 模式），可以调用工具探索并修改本地项目。",
    "回答请使用中文。",
    "用户可能在消息中附带截图或图片；若已附带，请结合图片内容理解需求并回答，不要声称无法查看图片。",
    "仅当当前用户消息附带图片时才引用截图；续跑确认（如「改吧」「优化」「继续」）且本条无附图时，禁止写「看到截图/如图所示」等读图表述。",
    "用户附截图询问界面/功能时：先描述截图所见，再判断是否属于本项目（优先查 views/components 或项目惯用 UI 目录），勿默认是外部 IDE/桌面应用。",
    "截图中有可见文字/图标/按钮时：先 grep 图中可见原文的最短可识别片段（通常 ≥3 字），而非猜 CSS class 名或 SVG 路径；从 grep 命中定位 template/组件。",
    "用户针对截图局部提问（配色、按钮、某块区域）时：讨论阶段只谈其所指可见范围，勿擅自扩大到整页/全项目样式盘点；若用户明确要求修改，可在该范围内 grep/read 对应组件后 patch_file；用户明确说「整个/整页/全面板」时可按扩大后的范围实施。",
    "截图中内联 chip/标签/元信息样式（含聚合 badge）：grep 该 chip 的 class 名或 read 承载它的组件 `<style>` 段，勿用全局 theme 变量臆断局部配色。",
    "若系统标注【咨询任务·只读】：用户本条仅为提问/解释，只读探索后自然语言回答，禁止 patch_file / write_file / delete_file。",
    "其余 Build 任务：一旦你判断须改代码才能满足用户（含 bug、实测与描述不符、功能/体验需求），探索完成后同一轮立即 patch_file / write_file，禁止只输出方案并问「需要我执行吗」。",
    "工作流程：先 grep / search_files 快速定位（通常 1 轮），read_file 读关键片段，然后 patch_file / write_file 修改。",
    "Bug / 实测不符：用户报告行为不对、没效果、试了不行等，默认理解为须修复；定位后直接 patch，勿停下来征求确认。",
    "区分问题类型：「按钮跑别处/位置不对」若控件与选区在空间上分离，优先查 position:fixed/absolute 或 Teleport 浮层定位，勿默认只改 flex；「点击没反应」「不工作」查事件处理/JS 逻辑。同一组件在连续消息中被提及时，每条消息是独立问题，不要因为上一条修了布局就假设这一条也是布局问题。",
    "短追问（如「需要吗」「要不要」「对吗」且未指明新对象）必须承接上一条助手回复的话题作答，勿因会话更早主题偏离；若意图仍不清晰，用一句话澄清，禁止回顾已完成工作清单或擅自改代码。",
    "在已确认须改代码后，探索够了同一轮即 patch/write，勿连续多轮只 read；同一轮可并行 grep/read。",
    "CSS/SCSS 样式定位：禁止 grep 推测出的全局 layout 选择器；应 read_file 已定位组件文件的 `<style>` 或 scoped 样式段。",
    "CSS class 重命名时：修改前先 grep 旧 class 名在该文件中的所有出现次数，然后一次性补全所有匹配（如同时改 `.old-class`、`.old-class:hover`、`.old-class:active`、`.old-class-icon` 等）。改完后 grep 验证零残留，确认全部替换完毕再宣布完成。",
    "用户选择执行：当你提供了多个方案/选项让用户选择时，用户选定后必须立即执行该方案（如 patch_file / write_file 落盘），不得自行改变方向或跳过执行去做其他调查。执行完毕并报告结果后，若需进一步排查再提出下一步建议。",
    "Build 模式简短实施指令（如「执行」「继续」「改吧」「优化」）或用户明确提出要改时：若上一条助手回复已列出具体改动步骤、代码片段或目标文件，必须立即 patch_file / write_file，禁止再次征求确认；除非改动涉及大范围重构或明显高风险操作。",
    "当前已在 Build 模式时，禁止再问用户是否切换到 Build；若上一条已列出多项改动，patch 须逐项落实，不得在回复中声称已完成尚未 patch 的项。",
    buildBuildWriteBlockedHint(),
    "Build 模式下用户追问「还能优化吗」「还能继续吗」「继续吧」「接着改」等，均视为执行指令，必须立即 patch_file / write_file，禁止再分析或询问。",
    "修改前必须先 read_file 核对目标文件；patch_file 的 old_string 须从 read 返回原文复制（含缩进），可换更短且唯一的片段。",
    "用户问「看出啥问题没」「检查一下」「这样对吗」等评价性问题时：必须先 read_file 读取你上次修改的文件，确认代码实际状态后再回答。禁止仅凭截图视觉判断或记忆作答。",
    "用户报告「试了不行/没有效果」后，禁止再用同样方案做未经证实的「检查完成✅」；须承认未验证项并给出可执行排查步骤。",
    "给用户的测试步骤须与项目实际运行环境一致（从 package.json scripts 判断 Web dev vs 桌面壳）；禁止混用。",
    "解释项目时：从 package.json、README、入口文件等关键文件入手，不要臆测。",
    buildReplyAccuracyHint(),
    "Build 阶段勿 read_file / write_file / patch_file `.aiall/plans/` 下方案文件或旧版 `.aiall/PLAN.md`；方案文档由 Plan 模式或客户端维护，你只改业务代码，勿在改码后「同步更新方案文件」。",
    "修改代码时：小范围改动优先 patch_file（old_string 须唯一匹配）；全文件重写或新文件才用 write_file；大文件禁止 write_file 整文件覆盖。",
    "需要确认现状时 read_file 用 offset/limit 读相关片段即可，不要读整个大文件。",
    "write_file / patch_file / delete_file 会立即写入磁盘，无需用户确认。",
    "探索结论或踩坑可调用 append_memory 提议写入项目记忆（## 术语|导航|偏好）；可调用 propose_skill 提议写入项目 skill 目录；均须用户确认后才会落盘。",
    "可 list_skills / read_skill 按需读取项目 skill；冷启动时已注入 fact/heuristic 类 skill 摘要。",
    "删除文件时：使用 delete_file 工具，不要用 write_file 清空内容来替代删除。",
    "重要：必须通过 API 工具接口调用 list_dir、read_file 等，禁止在正文里输出 <function>、<parameter> 等标记。",
    buildFileAccessPathHint(),
    "write_file / patch_file / delete_file 的 path 必须相对项目根，禁止绝对路径。",
    "run_command 可在项目目录执行 shell 命令（优先 package.json 中的 npm scripts；Windows 为 PowerShell，用 `;` 链式、勿用 head/&&），超时默认 30 秒，长时间命令请设置 timeout_ms；不要执行危险命令。",
    "联网搜索：当需要最新信息、外部文档、API 用法时，使用 web_search 搜索；使用 web_extract 抓取指定链接内容。搜索结果可能较多，优先关注前 3 条结果，避免大量内容占用上下文。",
    "如果系统提示你上一次回复被截断，请从截断处继续输出，不要重复已输出的内容。",
    "附截图时：首轮输出截图描述后，后续轮次禁止再次描述同一张截图。若需追问用户意见，应在代码探索后给出具体方案对比，而非仅提问。",
    `项目根目录：${projectRoot}`,
  ];
  if (model?.trim()) {
    lines.push("", buildModelIdentityHint(model));
  }
  const openFile = resolveOpenFileInProject(projectRoot, openFilePath);
  if (openFile) {
    lines.push(formatOpenFileContextLine(openFile));
  }
  return lines.join("\n");
}

function buildAskSystemPrompt(
  projectRoot: string,
  openFilePath?: string,
  openFileSnippet?: string,
  model?: string,
): string {
  const lines = [...buildAskSystemPromptLines(projectRoot)];
  if (model?.trim()) {
    lines.push("", buildModelIdentityHint(model));
  }
  const openFile = resolveOpenFileInProject(projectRoot, openFilePath);
  if (openFile) {
    lines.push(formatOpenFileContextLine(openFile));
    if (openFileSnippet?.trim()) {
      lines.push("", "当前打开文件内容（节选）：", "```", openFileSnippet.trim(), "```");
    }
  }
  return lines.join("\n");
}

function buildExploreSystemPrompt(
  projectRoot: string,
  openFilePath?: string,
  openFileSnippet?: string,
  model?: string,
  incremental = false,
): string {
  const lines = [...buildExploreSystemPromptLines(projectRoot, incremental)];
  if (model?.trim()) {
    lines.push("", buildModelIdentityHint(model));
  }
  const openFile = resolveOpenFileInProject(projectRoot, openFilePath);
  if (openFile) {
    lines.push(formatOpenFileContextLine(openFile));
    if (openFileSnippet?.trim()) {
      lines.push("", "当前打开文件内容（节选）：", "```", openFileSnippet.trim(), "```");
    }
  }
  return lines.join("\n");
}

type BuildHintContext = {
  runPolicy: AgentRunPolicy;
  history?: Array<{ role: string; content: string }>;
  userRecentlyReportedFailure: boolean;
};

/** Declarative registry for interactive Build-mode system hints. */
function buildInteractiveBuildHints(ctx: BuildHintContext): string {
  const { runPolicy: p } = ctx;
  const parts: string[] = [];
  const append = (enabled: boolean, text: string | undefined) => {
    if (enabled && text) parts.push(text);
  };
  append(p.codeReviewRun, buildCodeReviewHonestyNudge(ctx.userRecentlyReportedFailure));
  append(p.userErrorQuoteRun, buildUserErrorQuoteHint());
  append(p.userFailureReportRun, buildUserFailureReportNudge());
  append(p.uiDefectBuildRun, buildUiDefectBuildHint());
  append(
    p.implementFollowUpRun,
    buildImplementFollowUpHint(historySuggestsQuotePositionFix(ctx.history)),
  );
  append(p.quotedAmendRun && p.quotedAmendIntent !== null, p.quotedAmendIntent ? buildQuotedAmendHint(p.quotedAmendIntent) : undefined);
  append(p.sameIssueFollowUpRun, buildSameIssueFollowUpHint());
  append(p.locateStatusFollowUpRun, buildLocateStatusFollowUpHint());
  append(p.ultraShortOpenTaskRun, buildUltraShortOpenTaskHint());
  return parts.map((h) => (h.startsWith("\n") ? h : `\n${h}`)).join("");
}

export interface AgentContextBuildInput {
  projectRoot: string;
  openFilePath?: string;
  prompt: string;
  model: string;
  mode: VibeChatMode;
  history?: Array<{ role: string; content: string }>;
  isAsk: boolean;
  isExplore: boolean;
  isExecutePlan: boolean;
  isPlanExplore: boolean;
  runPolicy: AgentRunPolicy;
  effectiveTaskPrompt: string;
  userRecentlyReportedFailure: boolean;
  runProfile: ExecutePlanContextInput;
}

export interface AgentContextBuildResult {
  systemPrompt: string;
  projectContextBlock: string;
  projectContextSnapshot: import("./vibeProjectContext").ProjectContextResult | null;
  agentsGuideBlock: string;
  projectSkillsBlock: string;
  projectMemoryBlock: string;
  projectKnowledgeBlock: string;
  exploreKnowledgeContextBlock: string;
  explorationArchiveBlock: string;
  runtimeAwarenessBlock: string;
  openFile: { path: string; relative: string } | null;
  openFileSnippet: string;
  injectedKeyFilePaths: Set<string> | undefined;
  exploreKnowledgeIntent: "initial" | "rebuild" | "continue" | "section_fill" | "changes" | "followup" | null;
  exploreUsesManifest: boolean;
}

export async function buildAgentContext(
  input: AgentContextBuildInput,
  onEvent: (event: { type: string; data: Record<string, unknown> }) => void,
): Promise<AgentContextBuildResult> {
  const {
    projectRoot, openFilePath, prompt, model, mode,
    isAsk, isExplore, isExecutePlan, isPlanExplore,
    runPolicy,
    effectiveTaskPrompt, userRecentlyReportedFailure, runProfile,
  } = input;
  const {
    readOnlyBuildRun,
    consultativeUiAppearanceRun,
  } = runPolicy;

  const isReadOnlyAgent = isAsk || isExplore;

  const openFile = resolveOpenFileInProject(projectRoot, openFilePath);
  const openFileRel = openFile?.relative;

  let openFileSnippet = "";
  if (!isExecutePlan && openFile) {
    const openFileDetail = openFile.gitIndexView
      ? `读取 Git 暂存视图 ${openFileRel}`
      : openFile.gitHistoryView
        ? `读取 Git 历史视图 ${openFileRel}`
        : `读取当前文件 ${openFileRel}`;
    onEvent({
      type: "status",
      data: {
        phase: "building_context",
        model,
        detail: openFileRel ? openFileDetail : undefined,
        ...(openFileRel ? { openFile: openFileRel } : {}),
      },
    });
    openFileSnippet = await buildOpenFileSnippet(projectRoot, openFile);
  } else if (!isExecutePlan) {
    onEvent({
      type: "status",
      data: {
        phase: "building_context",
        model,
        detail: "扫描项目结构",
      },
    });
  }

  const memoryTaskContext = [prompt, openFileRel].filter(Boolean).join(" ");

  onEvent({
    type: "status",
    data: { phase: "building_context", model, detail: "加载项目上下文…" },
  });

  const [
    projectContextOrNull,
    projectMemoryResult,
    projectKnowledgeResult,
    agentsGuideResult,
    projectSkillsBlock,
    explorationArchiveBlock,
  ] = await Promise.all([
    isExecutePlan || consultativeUiAppearanceRun ? Promise.resolve(null) : buildProjectContext(projectRoot),
    consultativeUiAppearanceRun
      ? Promise.resolve({ ok: false as const, content: "", truncated: false })
      : readProjectMemory(projectRoot),
    consultativeUiAppearanceRun
      ? Promise.resolve({ ok: false as const, body: "", truncated: false, content: "", meta: {}, path: "", maxChars: 0, promptMaxChars: 0 })
      : readProjectKnowledge(projectRoot),
    consultativeUiAppearanceRun
      ? Promise.resolve({ ok: false as const, content: "", truncated: false })
      : readProjectAgentsGuide(projectRoot),
    consultativeUiAppearanceRun ? Promise.resolve("") : buildProjectSkillsPromptBlock(projectRoot, prompt),
    consultativeUiAppearanceRun
      ? Promise.resolve("")
      : buildExplorationArchivePromptBlock(projectRoot, prompt),
  ]);

  const targetManifest = isExecutePlan
    ? await buildTargetFileManifest(projectRoot, runProfile.targetFiles || [])
    : [];

  let projectContextBlock = "";
  if (isExecutePlan) {
    projectContextBlock = `\n\n项目根：${projectRoot}（方案执行阶段，已跳过全项目扫描）`;
    projectContextBlock += buildExecutePlanSystemHint(targetManifest, runProfile.userIntent);
  } else if (projectContextOrNull?.ok) {
    projectContextBlock = isReadOnlyAgent
      ? formatProjectContextForPrompt(projectContextOrNull)
      : formatProjectContextForBuild(projectContextOrNull);
  } else if (consultativeUiAppearanceRun) {
    projectContextBlock = `\n\n项目根：${projectRoot}（咨询只读·UI 观感题，已省略全项目扫描以加快首包）`;
  }

  let gitSnapshotBlock = "";
  if ((isAsk || isPlanExplore) && isGitWorkingTreeTopicPrompt(effectiveTaskPrompt.trim())) {
    const status = await gitStatus(projectRoot);
    if (status.ok) {
      gitSnapshotBlock = `\n\n【Git 工作区快照】\n${formatGitStatusForAgent(status)}`;
    }
  }

  const hasExistingProjectKnowledge =
    projectKnowledgeResult.ok && Boolean(projectKnowledgeResult.body.trim());
  const exploreKnowledgeIntent = isExplore
    ? classifyExploreKnowledgeIntent(prompt, hasExistingProjectKnowledge)
    : null;
  const exploreUsesManifest = exploreKnowledgeIntent != null
    && exploreIntentUsesKnowledgeManifest(exploreKnowledgeIntent);

  let exploreKnowledgeContextBlock = "";
  if (isExplore && hasExistingProjectKnowledge) {
    let changedPaths: string[] | undefined;
    const savedHead = projectKnowledgeResult.meta.gitHead?.trim();
    if (exploreUsesManifest && savedHead) {
      const diff = await gitChangedFilesSince(projectRoot, savedHead);
      if (diff.ok && diff.files.length) changedPaths = diff.files;
    }
    if (exploreKnowledgeIntent === "rebuild") {
      exploreKnowledgeContextBlock = `\n\n${buildKnowledgeRebuildHint()}`;
    } else if (exploreUsesManifest) {
      exploreKnowledgeContextBlock = `\n\n${buildKnowledgeExploreManifest(
        projectKnowledgeResult.body,
        projectKnowledgeResult.meta,
        { changedPaths },
      )}`;
    }
  }

  const projectMemoryBlock =
    projectMemoryResult.ok && projectMemoryResult.content.trim()
      ? await formatProjectMemoryForPrompt(
          projectMemoryResult.content,
          projectMemoryResult.truncated,
          memoryTaskContext,
          projectRoot,
        )
      : "";

  const projectKnowledgeBlock =
    !isExplore && hasExistingProjectKnowledge
      ? await formatProjectKnowledgeForPrompt(
          projectKnowledgeResult.body,
          projectKnowledgeResult.truncated,
        )
      : "";

  const agentsGuideBlock =
    agentsGuideResult.ok && (agentsGuideResult.files?.length || agentsGuideResult.content.trim())
      ? formatAgentsGuideForPrompt(agentsGuideResult.files || agentsGuideResult.content, agentsGuideResult.truncated)
      : "";

  const runtimeProfile = detectProjectRuntimeProfile(projectRoot);
  const runtimeAwarenessBlock =
    buildRuntimeAwarenessHint(runtimeProfile) + buildShellAwarenessHint(process.platform);

  const systemPromptCore = consultativeUiAppearanceRun
    ? [
        "你是编程助手（Build·咨询只读）。用户附截图询问 UI 观感/CSS；须 grep/read 定位组件 `<style>` 或 scss 规则后作答，禁止 patch_file / write_file。",
        "回答用中文；须引用 read 到的 background / opacity / var(--*) 等，勿猜测。",
        projectContextBlock,
      ].join("\n")
    : isExplore
      ? buildExploreSystemPrompt(
          projectRoot,
          openFilePath,
          openFileSnippet,
          model,
          exploreUsesManifest,
        )
    : isAsk
      ? buildAskSystemPrompt(projectRoot, openFilePath, openFileSnippet, model) +
        buildConsultativeTopicHints(
          stripQuotedReplyPrefix(effectiveTaskPrompt.trim()),
          input.history,
          undefined,
        )
      : isExecutePlan
        ? buildSystemPrompt(projectRoot, openFilePath, model)
        : isPlanExplore
          ? buildPlanSystemPrompt(projectRoot, {
              model,
              openFileContextLine: openFile ? formatOpenFileContextLine(openFile) : undefined,
              openFileSnippet: openFileSnippet || undefined,
            })
          : buildSystemPrompt(projectRoot, openFilePath, model) +
            buildConsultativeTopicHints(
              stripQuotedReplyPrefix(effectiveTaskPrompt.trim()),
              input.history,
              undefined,
            ) +
            buildInteractiveBuildHints({
              runPolicy,
              history: input.history,
              userRecentlyReportedFailure,
            });

  const systemPrompt = consultativeUiAppearanceRun
    ? `${systemPromptCore}\n${runtimeAwarenessBlock}`
    : `${systemPromptCore}${projectContextBlock}${gitSnapshotBlock}${agentsGuideBlock}${projectSkillsBlock}${projectMemoryBlock}${projectKnowledgeBlock}${exploreKnowledgeContextBlock}${explorationArchiveBlock}${runtimeAwarenessBlock}${
        runPolicy.automatedBugFixRun ? buildAutomatedBugFixHint(runtimeProfile.verifyScript) : ""
      }`;

  const injectedKeyFilePaths = projectContextOrNull?.ok
    ? buildInjectedKeyFilePathSet(projectContextOrNull)
    : undefined;

  return {
    systemPrompt,
    projectContextBlock,
    projectContextSnapshot: projectContextOrNull,
    agentsGuideBlock,
    projectSkillsBlock,
    projectMemoryBlock,
    projectKnowledgeBlock,
    exploreKnowledgeContextBlock,
    explorationArchiveBlock,
    runtimeAwarenessBlock,
    openFile,
    openFileSnippet,
    injectedKeyFilePaths,
    exploreKnowledgeIntent,
    exploreUsesManifest,
  };
}
