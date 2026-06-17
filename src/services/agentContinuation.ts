/** Short user confirmations after the agent already proposed changes. */
const EXECUTION_CONTINUATION_RE =
  /^(改吧|执行方案|好的?|行|可以|接着(做|改|来)?|执行(吧|一下)?|开始(改|做)?|动手(吧)?|按方案(改|执行)?|继续|优化|go|do it|yes|ok|okay|sure)\.?$/i;

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

const SCOPED_EDIT_INTENT_RE =
  /(?:改|修|加|支持|接入|添加|实现|做|优化|调整|更新|完善|支持一下)/;

const INTERACTION_REQUIREMENT_RE =
  /我要的效果|期望(?:的)?是|任何位置|任意位置|都能输入|都能聚焦|点击.{0,8}输入/i;

const ASK_ONLY_RE = /^(什么是|是什么|怎么|如何|为什么|有没有|是否|能不能|可以吗)[\s\S]{0,120}$/i;

/** User reports a bug or broken behavior — treat as "please fix this". */
const BUG_FEEDBACK_RE =
  /(?:没反应|不工作|失效|没效果|没用|不好使|点击.{0,6}(?:没|不|无)|点了.{0,6}(?:没|不|无)|依然.{0,6}没|还是.{0,6}没|不能.{0,6}(?:点击|输入|使用)|打不开|无法.{0,6}(?:使用|点击|打开)|bug|报错|报了|报错信息|出错|有问题)/;

const HISTORY_PLAN_KEEP_CHARS = 2_400;
const PLAN_CODE_BLOCK_MAX_CHARS = 6_000;
const PLAN_CODE_BLOCKS_MAX_TOTAL = 18_000;

export type AgentHistoryEntry = { role: "user" | "assistant"; content: string };

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
  if (body.length <= 200 && BUG_FEEDBACK_RE.test(body)) return true;
  return false;
}

/** Assistant laid out concrete edits (steps / snippet) awaiting user go-ahead. */
export function looksLikeActionableProposal(content: string): boolean {
  const text = content.trim();
  if (!text) return false;

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

export function looksLikeModificationPlan(content: string): boolean {
  const text = content.trim();
  if (!text) return false;

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
export function findLastAssistantContentInMessages(
  messages: ReadonlyArray<{ role: string; content: string }>,
  resolveContent: (msg: { role: string; content: string }) => string = (msg) => msg.content,
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
  if (!isExecutionContinuation(currentPrompt)) return history;

  let planAssistantIdx = -1;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].role === "assistant" && isAssistantExecutionBrief(history[i].content)) {
      planAssistantIdx = i;
      break;
    }
  }
  if (planAssistantIdx < 0) {
    planAssistantIdx =
      history.map((m, i) => (m.role === "assistant" ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
  }
  if (planAssistantIdx < 0) return history;

  const assistant = history[planAssistantIdx];
  if (!isAssistantExecutionBrief(assistant.content)) return history;

  const precedingUser =
    planAssistantIdx > 0 && history[planAssistantIdx - 1]?.role === "user"
      ? history[planAssistantIdx - 1]
      : null;

  const userContent = precedingUser
    ? summarizeUserIntent(precedingUser.content)
    : "用户请求按已确认的方案修改代码。";

  return [
    { role: "user", content: userContent },
    { role: "assistant", content: compressProposalForHistory(assistant.content) },
  ];
}

function summarizeUserIntent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= 160) return trimmed;
  return `${trimmed.slice(0, 160)}…`;
}
