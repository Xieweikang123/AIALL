/** Short user confirmations after the agent already proposed changes. */
const EXECUTION_CONTINUATION_RE =
  /^(改吧|执行方案|好的?|行|可以|接着(做|改|来)?|执行(吧|一下)?|开始(改|做)?|动手(吧)?|按方案(改|执行)?|继续|(?:优化|改进|调整)(?:吧|一下|下)?|go|do it|yes|ok|okay|sure)\.?$/i;

/** Longer 「继续…」 phrasing with explicit edit intent. */
const EXECUTION_CONTINUE_RE =
  /^继续(?:执行|改|做|写|来|完成)(?:吧|一下)?\.?$/i;

const NUMBERED_STEP_RE = /(?:^|\n)\s*\d+[\.\)、]\s+\S/g;

const BACKTICK_FILE_REF_RE =
  /`(?:[\w@.-]+\/)*[\w.-]+\.(?:vue|ts|tsx|js|jsx|scss|css|json|md|html|py|rs|go|toml)`/;

const CONCRETE_EDIT_VERB_RE =
  /(?:移除|删除|去掉|新增|添加|改为|改成|替换|精简|清理|patch_file|write_file)/;

/** Explicit plan document markers emitted in Plan mode. */
const PLAN_EXPLICIT_MARKER_RE =
  /(?:^|\n)\s*(?:##\s*修改方案|\[PLAN\]|<!--\s*agent-plan\s*-->)/i;

/** Explicit “go implement” phrasing (may appear after a quoted reply block). */
const IMPLEMENTATION_INTENT_RE =
  /(?:请|帮我)?(?:实现|开发|接入|加上|做一下|做吧|做掉|开工|开干|那就(?:做|改|来)|按(?:上面|此|这个|方案)?(?:改|做|实现)?)/i;

const PLAN_FILE_PATH_RE =
  /(?:^|[\s`"'(（\[])((?:[\w@.-]+\/)+[\w.-]+\.(?:vue|ts|tsx|js|jsx|json|md|css|scss|html|py|rs|go|toml)|[\w.-]+\.(?:vue|ts|tsx|js|jsx|json|md|css|scss|html|py|rs|go|toml))\b/gi;

const PLAN_SIGNAL_RE =
  /修改方案|改动方案|涉及文件|制定计划|详细改动|确认后.*实施|第一步|第二步|按方案|完整文件/i;

const AUDIT_OR_REVIEW_REPORT_RE =
  /(?:审计报告|评估报告|排查报告|准确性评估|工具调用准确性|上下文理解|回复结构|综合评分|改进建议)/i;

export function isAuditOrReviewReport(content: string): boolean {
  return AUDIT_OR_REVIEW_REPORT_RE.test(content.trim());
}

export type AssistantReplyKind =
  | "actionable_plan"
  | "audit_report"
  | "explanation"
  | "completion_summary"
  | "other";

const SCOPED_EDIT_INTENT_RE =
  /(?:改|修|加|支持|接入|添加|实现|做|优化|调整|更新|完善|支持一下)/;

const INTERACTION_REQUIREMENT_RE =
  /我要的效果|期望(?:的)?是|任何位置|任意位置|都能输入|都能聚焦|点击.{0,8}输入/i;

const ASK_ONLY_RE = /^(什么是|是什么|怎么|如何|为什么|有没有|是否|能不能|可以吗)[\s\S]{0,120}$/i;

/** Detect user dissatisfaction / negation after prior modifications. */
const USER_NEGATION_RE =
  /不好看|不满意|不对|不是这样|不是这个|重来|重新(改|做|来|设计|调整)|换一种|换(个|一个)(风格|方向|方式)|还是(不|没)|继续(优化|改|调整)|再来(一次|个)|不行|不喜欢|太(丑|丑了|难看)|效果不(好|行|对)|不是我想要|跟之前(一样|差不多)|没变化|没区别|不喜欢/i;

/** User reports implementation did not work in practice — structural, not topic-specific. */
const USER_FAILURE_REPORT_RE =
  /试了.{0,20}(?:没有|没|不|无效)|并没有|没效果|没有效果|没生效|不生效|未生效|没变化|不起作用|仍然(?:没有|没|不)|还是(?:没有|没|不|不(?:显示|可见|出来))|明明(?:没有|没|不)|看不到|看不见|电脑没|系统没|实际没|并未/i;

/** Detect repeated negation — user said negation ≥2 times in recent turns. */
export function detectUserNegation(text: string): boolean {
  return USER_NEGATION_RE.test(text.trim());
}

export function detectUserFailureReport(text: string): boolean {
  return USER_FAILURE_REPORT_RE.test(text.trim());
}

export type FailureReportHistoryMessage = { role: string; content: string };

/** True when recent user turns report the prior fix did not work. */
export function historyRecentUserFailureReport(
  history?: FailureReportHistoryMessage[],
  maxUserTurns = 4,
): boolean {
  const users = (history ?? []).filter((m) => m.role === "user").slice(-maxUserTurns);
  return users.some((m) => detectUserFailureReport(m.content));
}

const HISTORY_PLAN_KEEP_CHARS = 2_400;
const PLAN_CODE_BLOCK_MAX_CHARS = 6_000;
const PLAN_CODE_BLOCKS_MAX_TOTAL = 18_000;

export type AgentHistoryEntry = { role: "user" | "assistant"; content: string };

/** User quoted an excerpt from the plan panel (`> 方案: …`). */
const PLAN_QUOTE_PREFIX_RE = /^\s*>[^\n]*方案\s*[:：]/m;

const PLAN_QUOTE_INFO_QUESTION_RE =
  /(?:什么|啥|哪里|哪儿|为何|为什么|怎么|如何|是否|有没有|能不能|可以吗|到哪|写入|输出|配置|在哪|干啥|干什么|什么意思|含义|作用|行为|会.{0,4}(?:吗|么|嘛))/;

const PLAN_QUOTE_EDIT_INTENT_RE =
  /(?:这个|这段|上面|此处).{0,12}(?:不要|删掉|去掉|移除)|不要.{0,8}(?:这段|这个|上面)|(?:改成|改为|换成|更新(?:为|成)?)/;

export function isPlanQuotePrompt(text: string): boolean {
  return PLAN_QUOTE_PREFIX_RE.test(text.trim());
}

/** Quoted plan excerpt + user only asks to understand behavior, not to revise. */
export function looksLikePlanQuoteInformationalQuestion(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) return false;

  const hasEditIntent =
    CONCRETE_EDIT_VERB_RE.test(trimmed)
    || IMPLEMENTATION_INTENT_RE.test(trimmed)
    || PLAN_QUOTE_EDIT_INTENT_RE.test(trimmed);
  if (hasEditIntent) return false;

  if (ASK_ONLY_RE.test(trimmed)) return true;

  const hasQuestion = /[?？]/.test(trimmed);
  if (!hasQuestion) return false;

  if (PLAN_QUOTE_INFO_QUESTION_RE.test(trimmed)) return true;

  const lines = trimmed.split("\n").filter((line) => line.trim());
  return lines.length <= 2 && !/(?:改|删|加|去掉|不要|替换)/.test(trimmed);
}

export function isPlanQuoteInformationalPrompt(text: string): boolean {
  if (!isPlanQuotePrompt(text)) return false;
  return looksLikePlanQuoteInformationalQuestion(stripQuotedReplyPrefix(text.trim()));
}

/** Quoted plan excerpt + user wants to revise the plan document. */
export function isPlanQuoteRevisionPrompt(text: string): boolean {
  if (!isPlanQuotePrompt(text)) return false;
  return !looksLikePlanQuoteInformationalQuestion(stripQuotedReplyPrefix(text.trim()));
}

/** Remove markdown-style quote lines (`> …`) from a reply that references prior assistant text. */
export function stripQuotedReplyPrefix(text: string): string {
  const body = text
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .trim();
  return body || text.trim();
}

function matchesExecutionContinuationPhrase(text: string): boolean {
  if (EXECUTION_CONTINUATION_RE.test(text)) return true;
  if (EXECUTION_CONTINUE_RE.test(text)) return true;
  return false;
}

export function isExecutionContinuation(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (trimmed.length <= 24 && matchesExecutionContinuationPhrase(trimmed)) return true;

  const body = stripQuotedReplyPrefix(trimmed);
  if (!body) return false;

  if (body.length <= 32 && matchesExecutionContinuationPhrase(body)) return true;
  if (body.length <= 200 && IMPLEMENTATION_INTENT_RE.test(body)) return true;

  return false;
}

export function hasDirectImplementationIntent(text: string): boolean {
  const body = stripQuotedReplyPrefix(text.trim());
  if (!body || ASK_ONLY_RE.test(body)) return false;
  if (/[吗?？]\s*$/.test(body) && !/(?:实现|加上|做吧|接入|改吧|支持一下|开工)/.test(body)) {
    return false;
  }
  if (body.length <= 200 && IMPLEMENTATION_INTENT_RE.test(body)) return true;
  if (body.length <= 400 && SCOPED_EDIT_INTENT_RE.test(body)) return true;
  if (body.length <= 400 && INTERACTION_REQUIREMENT_RE.test(body)) return true;
  return false;
}

/** Assistant laid out concrete edits (steps / snippet) awaiting user go-ahead. */
export function looksLikeActionableProposal(content: string): boolean {
  const text = content.trim();
  if (!text) return false;
  if (AUDIT_OR_REVIEW_REPORT_RE.test(text)) return false;

  const paths = extractPlanFilePaths(text);
  const stepCount = (text.match(NUMBERED_STEP_RE) ?? []).length;
  const hasCodeBlock = text.includes("```");
  const hasFileRef = paths.length >= 1 || BACKTICK_FILE_REF_RE.test(text);
  const hasEditVerbs = CONCRETE_EDIT_VERB_RE.test(text);
  const hasProposalTable = /\|[^|\n]*`[^`]+\.(?:vue|ts|tsx|scss|css|json)`/i.test(text);

  if (!hasEditVerbs && !hasCodeBlock) return false;
  if (stepCount >= 2 && (hasFileRef || hasCodeBlock)) return true;
  if (stepCount >= 1 && hasCodeBlock) return true;
  if (hasCodeBlock && hasFileRef && hasEditVerbs) return true;
  if (hasProposalTable && (stepCount >= 1 || hasEditVerbs)) return true;

  return false;
}

export function isAssistantExecutionBrief(content: string): boolean {
  return looksLikeModificationPlan(content) || looksLikeActionableProposal(content);
}

export function classifyAssistantReply(content: string): AssistantReplyKind {
  const text = content.trim();
  if (!text) return "other";
  if (isAuditOrReviewReport(text)) return "audit_report";
  if (looksLikeModificationPlan(text) || looksLikeActionableProposal(text)) {
    return "actionable_plan";
  }
  if (/(?:原因|方式|机制|流程|步骤|因为|由于|如何|为什么)/.test(text)) {
    return "explanation";
  }
  if (/(?:已完成|已修复|已更新|已添加|已删除|主要改动|验证)/.test(text)) {
    return "completion_summary";
  }
  return "other";
}

export function looksLikeModificationPlan(content: string): boolean {
  const text = content.trim();
  if (!text) return false;
  if (AUDIT_OR_REVIEW_REPORT_RE.test(text)) return false;

  const paths = extractPlanFilePaths(text);
  const hasCodeBlock = text.includes("```");
  const hasPlanStructure = PLAN_SIGNAL_RE.test(text);
  const hasExplicitMarker = PLAN_EXPLICIT_MARKER_RE.test(text);

  const hasSubstantiveContent = hasCodeBlock || paths.length > 0;
  const hasConfirmationPhrase = /是否需要我|需要我帮你|你想让我|是否要|是否开始/.test(text);

  if (hasConfirmationPhrase && !hasSubstantiveContent) return false;
  if (hasConfirmationPhrase && hasSubstantiveContent && !hasExplicitMarker && !hasPlanStructure) {
    return false;
  }

  if (hasExplicitMarker && paths.length >= 1) return true;
  if (hasExplicitMarker && hasCodeBlock) return true;
  if (hasCodeBlock && paths.length >= 1 && (hasPlanStructure || hasExplicitMarker)) return true;
  if (hasPlanStructure && paths.length >= 1 && hasCodeBlock) return true;
  if (hasPlanStructure && paths.length >= 2) return true;

  return false;
}

/** Prefer the latest plan-like assistant message; fall back to the latest assistant text. */
export function findLastAssistantContentInMessages<T extends { role: string; content: string }>(
  messages: ReadonlyArray<T>,
  resolveContent: (msg: T) => string = (msg) => msg.content,
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const text = resolveContent(msg).trim();
    if (text && isAssistantExecutionBrief(text)) return text;
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const text = resolveContent(msg).trim();
    if (text) return text;
  }
  return undefined;
}

export function extractPlanFilePaths(content: string): string[] {
  const candidates: string[] = [];
  for (const match of content.matchAll(PLAN_FILE_PATH_RE)) {
    const raw = match[1]?.replace(/\\/g, "/");
    if (raw) candidates.push(raw);
  }
  return normalizePlanPaths(candidates);
}

/** Paths from composer `## 📎 参考文件` attachment section. */
export function extractReferencedFilePaths(prompt: string): string[] {
  const candidates: string[] = [];
  for (const match of prompt.matchAll(/###\s*📄\s*([^\n`]+)/g)) {
    const raw = match[1]?.trim().replace(/\\/g, "/");
    if (raw) candidates.push(raw);
  }
  return normalizePlanPaths(candidates);
}

function normalizePlanPaths(paths: string[]): string[] {
  const unique = [...new Set(paths)];
  return unique.filter((path) => {
    if (path.startsWith("./")) return false;
    if (path.includes("/")) return true;
    return !unique.some((other) => other !== path && other.endsWith(`/${path}`));
  });
}

export function extractPlanCodeBlocks(content: string): string[] {
  const blocks: string[] = [];
  for (const match of content.matchAll(/```[\w-]*\n([\s\S]*?)```/g)) {
    const block = match[1]?.trim();
    if (block) blocks.push(block);
  }
  return blocks;
}

function formatPlanCodeBlocks(content: string): string {
  const blocks = extractPlanCodeBlocks(content);
  if (!blocks.length) return "";

  const lines = ["", "方案代码块（直接用于 patch_file / write_file）："];
  let used = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    if (used >= PLAN_CODE_BLOCKS_MAX_TOTAL) {
      lines.push(`\n…（另有 ${blocks.length - i} 个代码块已省略）`);
      break;
    }
    const budget = Math.min(PLAN_CODE_BLOCK_MAX_CHARS, PLAN_CODE_BLOCKS_MAX_TOTAL - used);
    const snippet = blocks[i].length > budget ? `${blocks[i].slice(0, budget)}\n…（已截断）` : blocks[i];
    used += snippet.length;
    lines.push("", `### 代码块 ${i + 1}`, "```", snippet, "```");
  }
  return lines.join("\n");
}

export function compressProposalForHistory(content: string): string {
  if (looksLikeModificationPlan(content)) return compressPlanForHistory(content);

  const files = extractPlanFilePaths(content);
  const base =
    content.length > HISTORY_PLAN_KEEP_CHARS
      ? `${content.slice(0, HISTORY_PLAN_KEEP_CHARS)}\n\n…（改动说明已截断，按上文步骤执行）`
      : content;
  return [
    "[已确认改动] 用户已同意执行。先 read_file 核对真实内容，再 patch_file / write_file。",
    files.length ? `涉及文件：${files.join("、")}` : "",
    base,
  ]
    .filter(Boolean)
    .join("\n");
}

export function compressPlanForHistory(content: string): string {
  const files = extractPlanFilePaths(content);
  const codeBlocks = formatPlanCodeBlocks(content);
  if (!files.length) {
    const base =
      content.length > HISTORY_PLAN_KEEP_CHARS
        ? `${content.slice(0, HISTORY_PLAN_KEEP_CHARS)}\n\n…（方案已截断，按你已给出的代码块执行）`
        : content;
    return `${base}${codeBlocks}`;
  }
  return [
    "[已确认方案] 用户已同意执行。先 read_file 核对真实内容，再 patch_file / write_file；方案代码块仅供参考。",
    `涉及文件：${files.join("、")}`,
    codeBlocks,
  ]
    .filter(Boolean)
    .join("\n");
}

export function compressHistoryForExecution(
  history: AgentHistoryEntry[],
  currentPrompt: string,
): AgentHistoryEntry[] {
  const isResume = /^【自动续跑】/.test(currentPrompt.trim());
  if (!isExecutionContinuation(currentPrompt) && !isResume) return history;

  let planAssistantIdx = -1;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].role === "assistant" && history[i].content.trim()) {
      if (isAssistantExecutionBrief(history[i].content) || isResume) {
        planAssistantIdx = i;
        break;
      }
    }
  }
  if (planAssistantIdx < 0) {
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i].role === "assistant" && history[i].content.trim()) {
        planAssistantIdx = i;
        break;
      }
    }
  }
  if (planAssistantIdx < 0) return history;

  const assistant = history[planAssistantIdx];
  const precedingUser =
    planAssistantIdx > 0 && history[planAssistantIdx - 1]?.role === "user"
      ? history[planAssistantIdx - 1]
      : null;

  const userContent = precedingUser
    ? summarizeUserIntent(precedingUser.content)
    : "用户请求按已确认的方案修改代码。";

  return [
    { role: "user", content: userContent + (isResume ? "\n（自动续跑：从断点继续完成原始任务）" : "") },
    { role: "assistant", content: compressProposalForHistory(assistant.content) },
  ];
}

function summarizeUserIntent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= 160) return trimmed;
  return `${trimmed.slice(0, 160)}…`;
}

/** History entry with optional execution metadata from the client. */
export type AgentHistoryMessageMeta = {
  role: string;
  content: string;
  writtenFiles?: string[];
  planFilePath?: string;
};

export interface PendingPlanState {
  hasPendingPlan: boolean;
  planContent?: string;
  planIndex?: number;
  planFilePath?: string;
  executedSincePlan?: boolean;
}

/** User explicitly abandons the current pending plan thread. */
const PENDING_PLAN_BREAK_RE =
  /(?:另起|重新(?:做|来|规划|出)?(?:一)?(?:个)?方案|换个话题|新方案|不要(?:之前|上面|先前)的方案|重来|从零)/;

/** Short acceptance after consultative follow-up — amend pending plan, not spawn a new one. */
const SHORT_PLAN_CONTINUATION_RE =
  /^(?:持久化|落盘|写(?:入)?文件|合并|并入|加上(?:去)?|加进去|采纳|照(?:做|办)|就这样|按(?:你|上面|此|这个)?(?:说的|建议|来)?|可以|行|好|嗯|对|要|需要)(?:吧|了|下)?[。！!]?$/i;

const EXPLICIT_PLAN_MERGE_RE = /^(?:合并|并入)/;
const EXPLICIT_SEPARATE_PLAN_RE = /^(?:单独|独立|分开)/;

/** User quoted prior assistant reply (`> Agent: …`), not the plan panel. */
const AGENT_QUOTE_PREFIX_RE = /^\s*>[^\n]*(?:Agent|助手|Assistant)\s*[:：]/im;

export function isPendingPlanBreakPrompt(text: string): boolean {
  const body = stripQuotedReplyPrefix(text.trim());
  return PENDING_PLAN_BREAK_RE.test(body);
}

export function isShortPlanContinuationBody(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > 40) return false;
  if (/[?？]\s*$/.test(trimmed) && !EXPLICIT_PLAN_MERGE_RE.test(trimmed)) return false;
  if (SHORT_PLAN_CONTINUATION_RE.test(trimmed)) return true;
  if (trimmed.length <= 24 && IMPLEMENTATION_INTENT_RE.test(trimmed)) return true;
  return false;
}

export function isQuotedAgentFollowUpPrompt(text: string): boolean {
  return AGENT_QUOTE_PREFIX_RE.test(text.trim());
}

function isPlanExecutedAfterIndex(
  history: ReadonlyArray<AgentHistoryMessageMeta>,
  planIdx: number,
): boolean {
  for (let j = planIdx + 1; j < history.length; j += 1) {
    const msg = history[j];
    if (msg.role === "user" && isExecutionContinuation(msg.content)) return true;
    if (msg.role === "assistant") {
      if ((msg.writtenFiles?.length ?? 0) > 0) return true;
      const kind = classifyAssistantReply(msg.content);
      if (kind === "completion_summary" && /已写入|write_file|patch_file/.test(msg.content)) {
        return true;
      }
    }
  }
  return false;
}

/** First unexecuted structured plan in session history. */
export function resolvePendingPlanState(
  history?: ReadonlyArray<AgentHistoryMessageMeta>,
): PendingPlanState {
  if (!history?.length) return { hasPendingPlan: false };

  for (let i = 0; i < history.length; i += 1) {
    const msg = history[i];
    if (msg.role !== "assistant") continue;
    const text = msg.content.trim();
    if (!looksLikeModificationPlan(text)) continue;
    if (isPlanExecutedAfterIndex(history, i)) continue;
    return {
      hasPendingPlan: true,
      planContent: text,
      planIndex: i,
      planFilePath: msg.planFilePath,
    };
  }
  return { hasPendingPlan: false };
}

export function lastAssistantWasConsultativeExplanation(
  history?: ReadonlyArray<AgentHistoryMessageMeta>,
): boolean {
  for (let i = (history?.length ?? 0) - 1; i >= 0; i -= 1) {
    const msg = history![i];
    if (msg.role !== "assistant") continue;
    const text = msg.content.trim();
    if (!text) continue;
    if (looksLikeModificationPlan(text)) return false;
    return classifyAssistantReply(text) === "explanation" || classifyAssistantReply(text) === "other";
  }
  return false;
}

/** Pending plan exists + user wants to amend (not ask, not break thread). Works without `> 方案:` prefix. */
export function isPendingPlanAmendPrompt(
  prompt: string,
  history?: ReadonlyArray<AgentHistoryMessageMeta>,
): boolean {
  const text = prompt.trim();
  if (!text) return false;
  if (isPendingPlanBreakPrompt(text)) return false;
  if (isPlanQuoteInformationalPrompt(text)) return false;

  const pending = resolvePendingPlanState(history);
  if (!pending.hasPendingPlan) return false;

  if (isPlanQuoteRevisionPrompt(text)) return true;

  const body = stripQuotedReplyPrefix(text);
  if (!body) return false;

  if (EXPLICIT_SEPARATE_PLAN_RE.test(body)) return false;

  const shortContinuation =
    isShortPlanContinuationBody(body)
    || (body.length <= 40 && EXPLICIT_PLAN_MERGE_RE.test(body));

  if (!shortContinuation) {
    if (body.length <= 48 && hasDirectImplementationIntent(text) && !ASK_ONLY_RE.test(body)) {
      return lastAssistantWasConsultativeExplanation(history) || isQuotedAgentFollowUpPrompt(text);
    }
    return false;
  }

  return (
    lastAssistantWasConsultativeExplanation(history)
    || isQuotedAgentFollowUpPrompt(text)
    || isPlanQuotePrompt(text)
  );
}

/** Ambiguous short follow-up while a plan is pending — ask merge vs separate before rewriting. */
export function isPendingPlanClarifyPrompt(
  prompt: string,
  history?: ReadonlyArray<AgentHistoryMessageMeta>,
): boolean {
  const text = prompt.trim();
  if (!text || isPendingPlanBreakPrompt(text)) return false;
  if (isPlanQuoteInformationalPrompt(text)) return false;
  if (isPendingPlanAmendPrompt(text, history)) return false;

  const pending = resolvePendingPlanState(history);
  if (!pending.hasPendingPlan) return false;

  const body = stripQuotedReplyPrefix(text);
  if (!body || body.length > 16) return false;
  if (/[?？]/.test(body)) return false;
  if (EXPLICIT_PLAN_MERGE_RE.test(body) || EXPLICIT_SEPARATE_PLAN_RE.test(body)) return false;
  if (SHORT_PLAN_CONTINUATION_RE.test(body)) return false;

  return lastAssistantWasConsultativeExplanation(history) || isQuotedAgentFollowUpPrompt(text);
}
