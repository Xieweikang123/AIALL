import type { AgentRoundGroup } from "./agentRoundGroups";
import type { CursorFeedItem } from "./agentCursorFeed";
import { isPrematureVisionCompletionClaim } from "../../server/visionMessage";
import { stripToolSummaryFromAssistantContent } from "./vibeChatStorage";
import { stripAgentSuggestions } from "./agentSuggestions";
import { stripTextToolCallMarkup } from "./textToolCallMarkup";

export type AssistantBubbleSource = {
  content?: string;
  roundGroups?: AgentRoundGroup[];
  turnTraces?: Array<{ turn?: number; assistantText?: string }>;
  tools?: Array<{ running?: boolean; turn?: number }>;
};

export type LiveAgentAnswerSource = AssistantBubbleSource & {
  agentTurn?: number;
  agentPhase?: string;
};

export type FinalizeAssistantBubbleSource = AssistantBubbleSource & {
  writtenFiles?: string[];
  wasAborted?: boolean;
  agentAbortReason?: string;
  agentFailed?: boolean;
};

export const PARTIAL_WRITE_ABORT_HEADING = "运行中断（部分修改已落盘）";

const SUBSTANTIVE_MIN_CHARS = 48;
const THIN_EPILOGUE_MAX_CHARS = 96;

const ENGLISH_TOOL_NARRATION_RE = /^(?:Now let me|Let me|I'll|I need to|First,?\s+I)\b/i;

const CHINESE_TOOL_NARRATION_RE =
  /^(?:现在|接下来|让我|我来|我们|下面|先|然后|再|我需要|我要)\s*(?:看看|查看|读取|搜索|检查|分析|确认|定位|找到|打开|找|查|读|写|看|试|仔细)/;

function normalizeBubbleText(text: string): string {
  return stripAgentSuggestions(
    stripTextToolCallMarkup(stripToolSummaryFromAssistantContent(text)),
  ).trim();
}

/** Short planning lines emitted before tool calls — not user-facing answers. */
export function isAgentToolTurnNarration(text: string): boolean {
  const trimmed = normalizeBubbleText(text);
  if (!trimmed) return false;
  if (isEnglishToolNarration(trimmed)) return true;
  return CHINESE_TOOL_NARRATION_RE.test(trimmed);
}

/** Short English planning lines emitted before tool calls — not user-facing answers. */
export function isEnglishToolNarration(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (ENGLISH_TOOL_NARRATION_RE.test(trimmed)) return true;
  const cjk = (trimmed.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (trimmed.match(/[a-zA-Z]/g) || []).length;
  return latin >= 24 && cjk < 8 && trimmed.length <= 220;
}

/** Merge streaming turn text without dropping a longer substantive answer. */
export function mergeAssistantTurnText(existing: string, incoming: string): string {
  const prev = normalizeBubbleText(existing);
  const next = normalizeBubbleText(incoming);
  if (isEnglishToolNarration(next)) return prev;
  if (isAgentToolTurnNarration(next)) return prev;
  if (!prev) return next;
  if (!next) return prev;
  if (prev === next) return prev;
  if (prev.includes(next)) return prev;
  if (next.includes(prev)) return next;
  if (next.length >= prev.length * 0.85) return next;
  if (prev.length >= SUBSTANTIVE_MIN_CHARS && next.length <= THIN_EPILOGUE_MAX_CHARS) {
    return `${prev}\n\n${next}`;
  }
  if (prev.length > next.length * 2 && next.length <= THIN_EPILOGUE_MAX_CHARS) return prev;
  return `${prev}\n\n${next}`;
}

/** Agent run with tool/turn metadata (distinct from plain assistant chat). */
export function hasAgentRunStructure(msg: AssistantBubbleSource): boolean {
  return Boolean(
    msg.roundGroups?.some((group) => group.turn > 0) ||
      msg.tools?.length ||
      msg.turnTraces?.length,
  );
}

function resolveFinalAssistantText(msg: AssistantBubbleSource): string {
  return (
    msg.roundGroups
      ?.filter((group) => group.response?.isFinal && group.response.assistantText.trim())
      .at(-1)?.response?.assistantText.trim() || ""
  );
}

/**
 * User-visible answer exists only after the server marks a turn `isFinal`,
 * or for non-agent assistant messages that only use `content`.
 */
export function hasAgentFinalAnswer(msg: AssistantBubbleSource): boolean {
  if (resolveFinalAssistantText(msg)) return true;
  if (!hasAgentRunStructure(msg)) {
    return Boolean(normalizeBubbleText(msg.content || ""));
  }
  return false;
}

function collectAssistantTextCandidates(msg: AssistantBubbleSource): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw?: string) => {
    const text = normalizeBubbleText(raw || "");
    if (!text || seen.has(text) || isAgentToolTurnNarration(text)) return;
    seen.add(text);
    out.push(text);
  };

  if (!hasAgentRunStructure(msg)) {
    push(msg.content);
    return out;
  }

  for (const group of msg.roundGroups ?? []) {
    if (group.response?.isFinal) {
      push(group.response.assistantText);
    }
  }
  if (hasAgentFinalAnswer(msg)) {
    push(msg.content);
  }
  return out;
}

function isThinEpilogue(short: string, anchor: string): boolean {
  if (short.length >= SUBSTANTIVE_MIN_CHARS) return false;
  if (anchor.length < SUBSTANTIVE_MIN_CHARS) return false;
  return short.length <= THIN_EPILOGUE_MAX_CHARS && anchor.length > short.length * 2;
}

function pickBestAssistantBubbleText(candidates: string[], direct: string): string {
  if (!candidates.length) return "";
  if (!direct) {
    return [...candidates].sort((a, b) => b.length - a.length)[0]!;
  }

  const longest = [...candidates].sort((a, b) => b.length - a.length)[0]!;
  if (isTruncatedAssistantAnswer(direct) && longest.length > direct.length) {
    return longest;
  }
  if (direct.length >= SUBSTANTIVE_MIN_CHARS && direct.length >= longest.length * 0.85) {
    return direct;
  }
  if (isThinEpilogue(direct, longest)) {
    return mergeAssistantTurnText(longest, direct);
  }
  if (longest.length > direct.length * 1.5) {
    return mergeAssistantTurnText(longest, direct);
  }
  return direct;
}

/** Live final-answer stream while the model is still generating (not tool-turn preamble). */
export function resolveLiveAgentAnswerPreview(msg: LiveAgentAnswerSource): string {
  // 工具运行阶段：显示 narrative（Agent 的思考过程）
  if (msg.tools?.some((tool) => tool.running)) {
    const groups = msg.roundGroups ?? [];
    const activeTurn = msg.agentTurn;
    const group =
      (activeTurn && activeTurn > 0 ? groups.find((item) => item.turn === activeTurn) : undefined) ??
      groups.filter((item) => item.turn > 0).at(-1);
    if (group?.narrative) {
      const text = normalizeBubbleText(group.narrative);
      if (text && !isAgentToolTurnNarration(text)) return text;
    }
    return "";
  }

  if (msg.agentPhase && msg.agentPhase !== "streaming_model") return "";

  const groups = msg.roundGroups ?? [];
  const activeTurn = msg.agentTurn;
  const group =
    (activeTurn && activeTurn > 0 ? groups.find((item) => item.turn === activeTurn) : undefined) ??
    groups.filter((item) => item.turn > 0).at(-1);
  if (!group) return "";
  if (group.response?.hasToolCalls) return "";

  const text = normalizeBubbleText(group.narrative || group.response?.assistantText || "");
  if (!text || isAgentToolTurnNarration(text)) return "";
  return text;
}

/** Prefer live stream preview while running; otherwise use the completed bubble text. */
export function resolveAgentTimelineAnswer(
  msg: LiveAgentAnswerSource,
  completedContent: string,
  isRunning: boolean,
  _hasRunningTool = false,
): string {
  if (!isRunning) return completedContent;
  return resolveLiveAgentAnswerPreview(msg) || "";
}

export function isAgentTimelineAnswerStreaming(
  msg: LiveAgentAnswerSource,
  isRunning: boolean,
  hasRunningTool = false,
): boolean {
  return isRunning && !hasRunningTool && Boolean(resolveLiveAgentAnswerPreview(msg).trim());
}

/** Resolve the text shown in the assistant chat bubble (with fallbacks for agent runs). */
export function resolveAssistantBubbleContent(msg: AssistantBubbleSource): string {
  if (hasAgentRunStructure(msg) && !hasAgentFinalAnswer(msg)) return "";
  const direct = normalizeBubbleText(msg.content || "");
  const candidates = collectAssistantTextCandidates(msg);
  if (!direct && !candidates.length) return "";
  return pickBestAssistantBubbleText(candidates, direct);
}

function resolveVisionRegionPreamble(msg: AssistantBubbleSource): string {
  const group = msg.roundGroups?.find((item) => item.turn === 1);
  const raw = group?.narrative?.trim() || group?.response?.assistantText?.trim() || "";
  if (!raw) return "";
  if (!/据此|判断|表明|属于|截图|图中|占位符|「/i.test(raw)) return "";
  return normalizeBubbleText(raw);
}

function regionAnchorPresentInText(anchor: string, text: string): boolean {
  if (!anchor || !text) return false;
  const quoted = anchor.match(/[「『"']([^」』"']{4,})[」』"']/)?.[1];
  if (quoted && text.includes(quoted.slice(0, Math.min(quoted.length, 16)))) return true;
  return /截图|图中|占位符|助手|Vibe|输入框|Composer/i.test(text);
}

/** Persisted roundGroups cap assistantText; msg.content keeps the full answer. */
export function isStorageCompactedAssistantText(text: string): boolean {
  return text.trimEnd().endsWith("…");
}

/** Prefer msg.content when round-group final text was compacted for storage. */
export function preferFullContentOverCompactedRoundGroup(compacted: string, full: string): string {
  const left = compacted.trim();
  const right = full.trim();
  if (!left || !right) return left || right;
  if (right.length <= left.length) return left;
  if (isStorageCompactedAssistantText(left)) {
    const prefix = left.slice(0, -1);
    if (right.startsWith(prefix)) return right;
  }
  const probe = left.replace(/…$/, "").slice(0, 240);
  if (probe.length >= 120 && right.startsWith(probe)) return right;
  return left;
}

/** Prefer the final agent turn; prepend vision region when the final answer omits it. */
export function resolveCompletedAgentBubbleContent(msg: AssistantBubbleSource): string {
  const finalFromRound = normalizeBubbleText(resolveFinalAssistantText(msg));
  const direct = normalizeBubbleText(msg.content || "");
  const finalText = finalFromRound
    ? preferFullContentOverCompactedRoundGroup(finalFromRound, direct)
    : "";
  const visionPreamble = resolveVisionRegionPreamble(msg);

  if (finalText) {
    if (isTruncatedAssistantAnswer(finalText)) {
      const fallback = pickFallbackWhenFinalTruncated(msg, finalText);
      if (fallback) return fallback;
    }
    if (visionPreamble && !regionAnchorPresentInText(visionPreamble, finalText)) {
      return `${visionPreamble}\n\n${finalText}`;
    }
    return finalText;
  }

  const candidates = collectAssistantTextCandidates(msg);
  const filteredDirect = isEnglishToolNarration(direct)
    ? candidates.sort((a, b) => b.length - a.length)[0] || ""
    : direct;
  return pickBestAssistantBubbleText(candidates, filteredDirect);
}

const COMPLETION_SUMMARY_RE = /(?:修改完成|已完成|已写入|总结|变更如下|完成了)/;

/** Final model answer cut off mid-sentence (e.g. ends with a colon). */
export function isTruncatedAssistantAnswer(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // 以冒号结尾
  if (/[：:]\s*$/.test(trimmed)) return true;
  // 短文本包含"已修复"等但没有句号
  if (
    trimmed.length < SUBSTANTIVE_MIN_CHARS &&
    /已添加|已修复|已修改|已写入|已完成/.test(trimmed) &&
    !/[。.!！?？]$/.test(trimmed)
  ) {
    return true;
  }
  // 以未闭合的 markdown 标记结尾
  if (/[*_`~]\s*$/.test(trimmed)) return true;
  // 以左括号/左引号结尾
  if (/[（(「『"'"'\[{]\s*$/.test(trimmed)) return true;
  // 以省略号结尾
  if (/…\s*$/.test(trimmed)) return true;
  // 以未闭合的代码块标记结尾
  if (/```\w*\s*$/.test(trimmed)) return true;
  // 服务端截断标记（…已截断…字符…）
  if (/…（已截断[）]/.test(trimmed)) return true;
  return false;
}

function pickFallbackWhenFinalTruncated(msg: AssistantBubbleSource, finalText: string): string {
  const direct = normalizeBubbleText(msg.content || "");
  if (direct.length > finalText.length && !isTruncatedAssistantAnswer(direct)) {
    return direct;
  }
  const candidates = collectAssistantTextCandidates(msg).filter(
    (text) => text !== finalText && !isPrematureVisionCompletionClaim(text) && !isTruncatedAssistantAnswer(text),
  );
  return candidates.sort((a, b) => b.length - a.length)[0] || "";
}

/** Whether the model already gave a substantive completion summary. */
export function hasSubstantiveAgentSummary(msg: AssistantBubbleSource): boolean {
  if (hasAgentRunStructure(msg) && !hasAgentFinalAnswer(msg)) return false;
  const finalFromRound = resolveFinalAssistantText(msg);
  const direct = normalizeBubbleText(msg.content || "");
  const finalText = finalFromRound
    ? preferFullContentOverCompactedRoundGroup(normalizeBubbleText(finalFromRound), direct)
    : direct;
  if (finalText && isTruncatedAssistantAnswer(finalText)) return false;
  if (finalText.length >= SUBSTANTIVE_MIN_CHARS) return true;
  if (COMPLETION_SUMMARY_RE.test(finalText)) return true;
  const bubble = resolveAssistantBubbleContent(msg);
  if (bubble.length >= SUBSTANTIVE_MIN_CHARS) return true;
  return COMPLETION_SUMMARY_RE.test(bubble);
}

/** Build a short summary when tools wrote files but the model skipped a final answer turn. */
export function buildWrittenFilesSummary(writtenFiles: string[], wasAborted = false): string {
  if (!writtenFiles.length) return "";
  const list = writtenFiles.map((file) => `- \`${file}\``).join("\n");
  const heading = wasAborted ? `## ${PARTIAL_WRITE_ABORT_HEADING}` : "## 修改完成";
  const lead = wasAborted
    ? `连接在总结前结束，但以下 ${writtenFiles.length} 个文件已写入：`
    : `已写入 ${writtenFiles.length} 个文件：`;
  const footer = wasAborted ? "\n\n可点击下方按钮继续完成剩余任务。" : "";
  return `${heading}\n\n${lead}\n\n${list}${footer}`;
}

/** Append file-write summary when the run ended without a model completion message. */
export function finalizeAssistantBubbleContent(msg: FinalizeAssistantBubbleSource): string {
  const writtenFiles = msg.writtenFiles?.filter(Boolean) ?? [];

  if (hasAgentRunStructure(msg) && !hasAgentFinalAnswer(msg)) {
    if (writtenFiles.length) {
      return buildWrittenFilesSummary(writtenFiles, Boolean(msg.wasAborted));
    }
    return "";
  }

  const base = msg.roundGroups?.some((g) => g.response?.isFinal)
    ? resolveCompletedAgentBubbleContent(msg)
    : resolveAssistantBubbleContent(msg);
  if (msg.wasAborted && !base.trim() && !writtenFiles.length) {
    const reason = msg.agentAbortReason?.trim() || "运行已中断";
    return `运行已中断：${reason}`;
  }
  if (!writtenFiles.length) return base;
  if (msg.agentFailed) return base;
  if (!msg.wasAborted && hasSubstantiveAgentSummary(msg)) return base;

  const summary = buildWrittenFilesSummary(writtenFiles, Boolean(msg.wasAborted));
  if (!base.trim()) return summary;
  if (base.includes(summary)) return base;
  return `${base.trim()}\n\n${summary}`;
}

export function normalizeComparableText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** Whether a feed thought duplicates text already shown in the answer bubble. */
export function thoughtDuplicatesBubble(thought: string, bubbleContent: string): boolean {
  const thoughtNorm = normalizeComparableText(thought);
  const bubbleNorm = normalizeComparableText(bubbleContent);
  if (!thoughtNorm || !bubbleNorm) return false;
  if (thoughtNorm === bubbleNorm) return true;
  const minLen = Math.min(thoughtNorm.length, bubbleNorm.length);
  if (minLen < SUBSTANTIVE_MIN_CHARS) return false;
  if (bubbleNorm.includes(thoughtNorm) || thoughtNorm.includes(bubbleNorm)) return true;
  const prefixLen = Math.min(thoughtNorm.length, bubbleNorm.length, 160);
  return thoughtNorm.slice(0, prefixLen) === bubbleNorm.slice(0, prefixLen);
}

export type FilterFeedThoughtsOptions = {
  /** While agent is running, bubble is the live preview — hide all feed thoughts. */
  suppressAllWhenBubble?: boolean;
};

/** Remove thought items that repeat the assistant answer bubble (or all thoughts during live preview). */
export function filterDuplicateFeedThoughts(
  items: CursorFeedItem[],
  bubbleContent: string,
  options?: FilterFeedThoughtsOptions,
): CursorFeedItem[] {
  const bubble = bubbleContent.trim();
  if (options?.suppressAllWhenBubble && bubble) {
    return items.filter((item) => item.kind !== "thought");
  }
  if (!bubble) return items;
  return items.filter((item) => {
    if (item.kind !== "thought") return true;
    return !thoughtDuplicatesBubble(item.text, bubble);
  });
}
