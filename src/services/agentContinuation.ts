/** Short user confirmations after the agent already proposed a change plan. */
const EXECUTION_CONTINUATION_RE =
  /^(改吧|好的?|行|可以|继续|接着(做|改|来)?|执行(吧|一下)?|开始(改|做)?|动手(吧)?|按方案(改|执行)?|go|do it|yes|ok|okay|sure)\.?$/i;

/** Explicit “go implement” phrasing (may appear after a quoted reply block). */
const IMPLEMENTATION_INTENT_RE =
  /(?:请|帮我)?(?:实现|开发|接入|加上|做一下|做吧|做掉|开工|开干|那就(?:做|改|来)|按(?:上面|此|这个|方案)?(?:改|做|实现)?)/i;

const PLAN_FILE_PATH_RE =
  /(?:^|[\s`"'(（\[])((?:[\w@.-]+\/)+[\w.-]+\.(?:vue|ts|tsx|js|jsx|json|md|css|scss|html|py|rs|go|toml)|[\w.-]+\.(?:vue|ts|tsx|js|jsx|json|md|css|scss|html|py|rs|go|toml))\b/gi;

const PLAN_SIGNAL_RE =
  /修改方案|改动方案|涉及文件|制定计划|详细改动|确认后.*实施|第一步|第二步|按方案|完整文件/i;

const SCOPED_EDIT_INTENT_RE =
  /(?:改|修|加|支持|接入|添加|实现|做|优化|调整|更新|完善|支持一下)/;

const ASK_ONLY_RE = /^(什么是|是什么|怎么|如何|为什么|有没有|是否|能不能|可以吗)[\s\S]{0,120}$/i;

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

export function isExecutionContinuation(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (trimmed.length <= 24 && EXECUTION_CONTINUATION_RE.test(trimmed)) return true;

  const body = stripQuotedReplyPrefix(trimmed);
  if (!body) return false;

  if (body.length <= 32 && EXECUTION_CONTINUATION_RE.test(body)) return true;
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
  return false;
}

export function looksLikeModificationPlan(content: string): boolean {
  const text = content.trim();
  if (!text) return false;
  if (/是否需要我|需要我帮你|你想让我|是否要|是否开始/.test(text) && !text.includes("```")) {
    return false;
  }

  const paths = extractPlanFilePaths(text);
  const hasCodeBlock = text.includes("```");
  const hasPlanStructure = PLAN_SIGNAL_RE.test(text);

  if (hasCodeBlock && paths.length >= 1) return true;
  if (hasPlanStructure && paths.length >= 1 && hasCodeBlock) return true;
  if (hasPlanStructure && paths.length >= 2) return true;

  return false;
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

  const lastAssistantIdx = history.map((m, i) => (m.role === "assistant" ? i : -1)).filter((i) => i >= 0).pop();
  if (lastAssistantIdx === undefined) return history;

  const assistant = history[lastAssistantIdx];
  if (!looksLikeModificationPlan(assistant.content)) return history;

  const precedingUser =
    lastAssistantIdx > 0 && history[lastAssistantIdx - 1]?.role === "user"
      ? history[lastAssistantIdx - 1]
      : null;

  const userContent = precedingUser
    ? summarizeUserIntent(precedingUser.content)
    : "用户请求按已确认的方案修改代码。";

  return [
    { role: "user", content: userContent },
    { role: "assistant", content: compressPlanForHistory(assistant.content) },
  ];
}

function summarizeUserIntent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= 160) return trimmed;
  return `${trimmed.slice(0, 160)}…`;
}
