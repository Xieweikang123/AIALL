import type { AgentRoundGroup } from "./agentRoundGroups";
import { recordAgentRoundResponse } from "./agentRoundGroups";
import type { CursorFeedItem } from "./agentCursorFeed";
import { isPrematureVisionCompletionClaim } from "../../shared/visionCompletionClaim";
import { sanitizeMarkdownForDisplay } from "./markdownDisplaySanitize";
import {
  AGENT_PROGRESS_MARKER,
  AGENT_PROGRESS_MARKER_RE,
  hasAgentProgressMarker,
  stripAgentProgressMarker,
} from "./agentProgressMarker";

export { AGENT_PROGRESS_MARKER, AGENT_PROGRESS_MARKER_RE, hasAgentProgressMarker, stripAgentProgressMarker };

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

function countSentenceUnits(text: string): number {
  return text
    .split(/[。！？；\n]/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

/** Multi-sentence substantive text during exploration — not a one-line tool preamble. */
export function isSubstantiveProgressSummary(text: string): boolean {
  const trimmed = stripAgentProgressMarker(normalizeBubbleText(text));
  if (!trimmed) return false;
  if (hasAgentProgressMarker(text)) return trimmed.length >= 24;
  return trimmed.length >= SUBSTANTIVE_MIN_CHARS && countSentenceUnits(trimmed) >= 2;
}

function normalizeBubbleText(text: string): string {
  return sanitizeMarkdownForDisplay(text);
}

/** Short planning lines emitted before tool calls — not user-facing answers. */
export function isAgentToolTurnNarration(text: string): boolean {
  if (hasAgentProgressMarker(text) || isSubstantiveProgressSummary(text)) return false;
  const trimmed = normalizeBubbleText(text);
  if (!trimmed) return false;
  if (isEnglishToolNarration(trimmed)) return true;
  if (/^直接\s+[\w.\u4e00-\u9fff]{1,16}[：:]\s*$/u.test(trimmed)) return true;
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

/** Structured or long narrative that belongs in the answer block, not timeline thought rows. */
export function isAnswerLikeTimelineNarrative(text: string): boolean {
  const trimmed = normalizeBubbleText(text);
  if (!trimmed) return false;
  if (hasAgentProgressMarker(text)) return false;
  if (/^#{1,3}\s/m.test(trimmed)) return true;
  if (/^>\s/m.test(trimmed)) return true;
  return trimmed.length >= 180;
}

/** Append incremental SSE delta — must not insert paragraph breaks between chunks. */
export function appendAssistantStreamDelta(existing: string, delta: string): string {
  if (!delta) return existing || "";
  const trimmedForCheck = delta.trim();
  if (trimmedForCheck && isEnglishToolNarration(trimmedForCheck)) return existing || "";
  if (trimmedForCheck && isAgentToolTurnNarration(trimmedForCheck)) return existing || "";
  const base = existing || "";
  if (base && delta && shouldBreakLatinCjkStreamBoundary(base, delta)) {
    return `${base}\n\n${delta}`;
  }
  return `${base}${delta}`;
}

function shouldBreakLatinCjkStreamBoundary(existing: string, delta: string): boolean {
  const first = delta[0] ?? "";
  if (!/[\u4e00-\u9fff]/.test(first)) return false;
  const tail = existing.trimEnd();
  const last = tail.slice(-1);
  if (/[:：]/.test(last)) return true;
  return /[A-Za-z0-9)]/.test(last);
}

/** When streamed tool preamble wraps a substantive answer, keep the embedded answer only. */
export function stripEmbeddedAnswerFromPreamble(container: string, embedded: string): string {
  const trimmedEmbedded = embedded.trim();
  if (!trimmedEmbedded) return container;
  const index = container.indexOf(trimmedEmbedded);
  if (index <= 0) return container;
  const prefix = container.slice(0, index).trim();
  if (!prefix) return trimmedEmbedded;
  if (isEnglishToolNarration(prefix) || isAgentToolTurnNarration(prefix)) {
    return trimmedEmbedded;
  }
  if (trimmedEmbedded.length >= SUBSTANTIVE_MIN_CHARS && /^[\x00-\x7F\s:：,.;!?'"()\-]+$/.test(prefix)) {
    return trimmedEmbedded;
  }
  return container;
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
  if (prev.includes(next)) return stripEmbeddedAnswerFromPreamble(prev, next);
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

function resolveLatestFinalTurn(msg: AssistantBubbleSource): number | undefined {
  return msg.roundGroups?.filter((group) => group.response?.isFinal).at(-1)?.turn;
}

/** Active turn advanced past the last finalized answer — resume/continue should not replay stale final text. */
function isActiveTurnAfterFinalAnswer(msg: LiveAgentAnswerSource): boolean {
  const finalTurn = resolveLatestFinalTurn(msg);
  const activeTurn = msg.agentTurn;
  return Boolean(finalTurn && activeTurn && activeTurn > finalTurn);
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

/**
 * When the server already streamed a substantive answer into `content` but `isFinal`
 * never reached `roundGroups` (e.g. run UI minimization skipped turn_response), commit
 * it locally so done handling treats the run as complete.
 */
export function commitAgentFinalAnswerIfMissing(
  msg: AssistantBubbleSource & { content?: string; roundGroups?: AgentRoundGroup[] },
  turn: number,
  maxTurns?: number,
): boolean {
  if (hasAgentFinalAnswer(msg) || turn <= 0) return false;
  const finalText = normalizeBubbleText(msg.content || "");
  if (!finalText || finalText.length < 16 || isAgentToolTurnNarration(finalText)) return false;

  msg.roundGroups = recordAgentRoundResponse(
    msg.roundGroups,
    turn,
    {
      assistantText: finalText,
      toolCalls: [],
      hasToolCalls: false,
      isFinal: true,
    },
    maxTurns,
  );
  return true;
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

function pickLongestText(candidates: string[]): string {
  if (!candidates.length) return "";
  return [...candidates].sort((a, b) => b.length - a.length)[0]!;
}

function pickBestAssistantBubbleText(candidates: string[], direct: string): string {
  if (!candidates.length) return "";
  if (!direct) {
    return pickLongestText(candidates);
  }

  const longest = pickLongestText(candidates);
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

function resolveAssistantBubbleFromCandidates(msg: AssistantBubbleSource): string {
  const direct = normalizeBubbleText(msg.content || "");
  const candidates = collectAssistantTextCandidates(msg);
  if (!direct && !candidates.length) return "";
  const filteredDirect = isEnglishToolNarration(direct) ? pickLongestText(candidates) : direct;
  return pickBestAssistantBubbleText(candidates, filteredDirect);
}

const AGENT_LIVE_PREVIEW_PREP_PHASES = new Set([
  "preparing",
  "starting",
  "building_context",
  "connecting_local",
  "stream_connected",
  "connected",
  "reconnecting",
]);

/** Between tool/model turns — hide stale partial answer fragments until tokens stream again. */
const AGENT_LIVE_PREVIEW_PRE_STREAM_PHASES = new Set([
  "waiting_model",
  "sending_request",
  "retrying_model",
  "executing_tool",
  "summarizing_tools",
  "planning_tools",
  "compacting_context",
  "consultative_segment_cap",
]);

function resolveActiveRoundGroup(msg: LiveAgentAnswerSource): AgentRoundGroup | undefined {
  const groups = msg.roundGroups ?? [];
  const activeTurn = msg.agentTurn;
  return (
    (activeTurn && activeTurn > 0 ? groups.find((item) => item.turn === activeTurn) : undefined) ??
    groups.filter((item) => item.turn > 0).at(-1)
  );
}

function shouldHideToolTurnPreview(text: string, group: AgentRoundGroup): boolean {
  if (!group.response?.hasToolCalls || group.response?.isFinal) return false;
  if (hasAgentProgressMarker(text) || isSubstantiveProgressSummary(text)) return false;
  if (isAgentToolTurnNarration(text)) return true;
  return text.length < SUBSTANTIVE_MIN_CHARS;
}

/** Latest marked or multi-sentence progress summary from round narratives. */
export function resolveLatestAgentProgressNarrative(
  msg: Pick<LiveAgentAnswerSource, "roundGroups" | "agentTurn">,
): string {
  const groups = msg.roundGroups ?? [];
  const activeTurn = msg.agentTurn;
  const ordered =
    activeTurn && activeTurn > 0
      ? [
          ...groups.filter((item) => item.turn === activeTurn),
          ...groups.filter((item) => item.turn > 0 && item.turn !== activeTurn),
        ]
      : [...groups].filter((item) => item.turn > 0).reverse();

  for (const group of ordered) {
    const raw = group.narrative || group.response?.assistantText || "";
    if (!raw) continue;
    if (!hasAgentProgressMarker(raw) && !isSubstantiveProgressSummary(raw)) continue;
    const text = normalizeBubbleText(stripAgentProgressMarker(raw));
    if (text && !isAgentToolTurnNarration(raw)) return text;
  }
  return "";
}

/** Mid-stream tail left over from a prior tool turn — not a user-facing answer. */
function isStaleStreamTailFragment(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.length >= SUBSTANTIVE_MIN_CHARS) return false;
  if (/^[`\-)\];:]/.test(trimmed)) return true;
  if (/^的/.test(trimmed)) return true;
  return false;
}

/** Short msg.content left from a prior turn while the active turn has not started streaming. */
function isOrphanedPriorTurnPreview(
  group: AgentRoundGroup | undefined,
  picked: string,
): boolean {
  if (!picked || picked.length >= SUBSTANTIVE_MIN_CHARS) return false;
  if (!group) return true;
  const turnText = pickLongestSubstantiveAnswer(
    normalizeBubbleText(group.narrative || ""),
    normalizeBubbleText(group.response?.assistantText || ""),
  );
  if (!turnText) return true;
  if (turnText === picked || turnText.includes(picked) || picked.includes(turnText)) return false;
  return true;
}

/** Direct model answer on the active turn — excludes progress-narrative fallback. */
export function resolveLiveAgentAnswerText(msg: LiveAgentAnswerSource): string {
  if (msg.agentPhase && AGENT_LIVE_PREVIEW_PREP_PHASES.has(msg.agentPhase)) return "";

  const contentFallback = normalizeBubbleText(msg.content || "");
  const preStream = Boolean(
    msg.agentPhase && AGENT_LIVE_PREVIEW_PRE_STREAM_PHASES.has(msg.agentPhase),
  );

  if (msg.agentPhase === "streaming_model") {
    if (contentFallback) return contentFallback;
  }

  if (preStream && hasAgentFinalAnswer(msg) && !isActiveTurnAfterFinalAnswer(msg)) {
    const finalText = normalizeBubbleText(resolveFinalAssistantText(msg));
    if (finalText && !isAgentToolTurnNarration(finalText)) return finalText;
  }

  const group = resolveActiveRoundGroup(msg);
  let picked = "";

  if (group) {
    const candidates = [
      normalizeBubbleText(group.narrative || ""),
      normalizeBubbleText(group.response?.assistantText || ""),
    ].filter(Boolean);

    const groupAnswers: string[] = [];
    for (const text of candidates) {
      if (!text || isAgentToolTurnNarration(text)) continue;
      if (shouldHideToolTurnPreview(text, group)) continue;
      groupAnswers.push(text);
    }
    picked = pickLongestSubstantiveAnswer(...groupAnswers, contentFallback) || "";
  } else {
    picked = contentFallback;
  }

  if (preStream && picked) {
    if (isStaleStreamTailFragment(picked)) return "";
    if (!hasAgentFinalAnswer(msg) && isOrphanedPriorTurnPreview(group, picked)) return "";
  }

  return picked;
}

/** Live final-answer stream while the model is still generating (not tool-turn preamble). */
export function resolveLiveAgentAnswerPreview(msg: LiveAgentAnswerSource): string {
  const answer = resolveLiveAgentAnswerText(msg);
  if (answer) return answer;
  return resolveLatestAgentProgressNarrative(msg);
}

function pickLongestSubstantiveAnswer(...candidates: string[]): string {
  const normalized = candidates
    .map(normalizeBubbleText)
    .filter((text) => text && !isAgentToolTurnNarration(text));
  if (!normalized.length) return "";
  return normalized.sort((a, b) => b.length - a.length)[0]!;
}

/** Prefer live stream preview while running; otherwise use the completed bubble text. */
export function resolveAgentTimelineAnswer(
  msg: LiveAgentAnswerSource,
  completedContent: string,
  isRunning: boolean,
  hasRunningTool = false,
): string {
  if (!isRunning) return completedContent;
  if (hasAgentFinalAnswer(msg) && !isActiveTurnAfterFinalAnswer(msg)) {
    const finalized = resolveCompletedAgentBubbleContent(msg);
    const live = resolveLiveAgentAnswerText(msg);
    const merged = pickLongestSubstantiveAnswer(finalized, live, msg.content || "");
    if (merged) return merged;
  }
  if (msg.agentPhase === "streaming_model") {
    const live = resolveLiveAgentAnswerText(msg);
    return live || normalizeBubbleText(msg.content || "") || "";
  }
  const preStream = Boolean(
    msg.agentPhase && AGENT_LIVE_PREVIEW_PRE_STREAM_PHASES.has(msg.agentPhase),
  );
  if (preStream) {
    if (
      hasRunningTool &&
      (msg.agentPhase === "planning_tools" ||
        msg.agentPhase === "executing_tool" ||
        msg.agentPhase === "executing_tools")
    ) {
      return normalizeBubbleText(msg.content || "") || "";
    }
    const progress = resolveLatestAgentProgressNarrative(msg);
    if (progress) return progress;
    return "";
  }
  return normalizeBubbleText(msg.content || "") || "";
}

export function isAgentTimelineAnswerStreaming(
  msg: LiveAgentAnswerSource,
  isRunning: boolean,
  hasRunningTool = false,
): boolean {
  if (!isRunning) return false;
  if (msg.agentPhase === "streaming_model") return true;
  // Live narrative preview during tool/wait phases is not model streaming — avoid
  // ChatMarkdown minHeight lock that leaves a large blank gap above tool steps.
  return hasRunningTool && Boolean(normalizeBubbleText(msg.content || ""));
}

/** Resolve the text shown in the assistant chat bubble (with fallbacks for agent runs). */
export function resolveAssistantBubbleContent(msg: AssistantBubbleSource): string {
  if (hasAgentRunStructure(msg) && !hasAgentFinalAnswer(msg)) return "";
  return resolveAssistantBubbleFromCandidates(msg);
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
  const prefixLen = Math.min(left.length, 64);
  if (prefixLen >= 24 && right.length > left.length && right.startsWith(left.slice(0, prefixLen))) {
    return right;
  }
  return left;
}

/** Prefer the final agent turn; prepend vision region when the final answer omits it. */
export function resolveCompletedAgentBubbleContent(msg: AssistantBubbleSource): string {
  const finalGroup = msg.roundGroups?.filter((group) => group.response?.isFinal).at(-1);
  const finalFromRound = normalizeBubbleText(resolveFinalAssistantText(msg));
  const narrativeFromFinal = normalizeBubbleText(finalGroup?.narrative || "");
  const direct = normalizeBubbleText(msg.content || "");
  const preferredFromRound = finalFromRound
    ? preferFullContentOverCompactedRoundGroup(finalFromRound, direct)
    : "";
  const streamedOrSnapshot = pickLongestSubstantiveAnswer(preferredFromRound, narrativeFromFinal);
  const finalText = streamedOrSnapshot
    ? preferFullContentOverCompactedRoundGroup(streamedOrSnapshot, direct)
    : pickLongestSubstantiveAnswer(direct);
  const visionPreamble = resolveVisionRegionPreamble(msg);

  if (finalText) {
    if (visionPreamble && !regionAnchorPresentInText(visionPreamble, finalText)) {
      return `${visionPreamble}\n\n${finalText}`;
    }
    return finalText;
  }

  return resolveAssistantBubbleFromCandidates(msg);
}

const COMPLETION_SUMMARY_RE = /(?:修改完成|已完成|已写入|总结|变更如下|完成了)/;

/** Whether the model already gave a substantive completion summary. */
export function hasSubstantiveAgentSummary(msg: AssistantBubbleSource): boolean {
  if (hasAgentRunStructure(msg) && !hasAgentFinalAnswer(msg)) return false;
  const finalFromRound = resolveFinalAssistantText(msg);
  const direct = normalizeBubbleText(msg.content || "");
  const finalText = finalFromRound
    ? preferFullContentOverCompactedRoundGroup(normalizeBubbleText(finalFromRound), direct)
    : direct;
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

const THOUGHT_DUPLICATE_MIN_FRAGMENT = 12;

/** Whether a feed thought duplicates text already shown in the answer bubble. */
export function thoughtDuplicatesBubble(thought: string, bubbleContent: string): boolean {
  const thoughtNorm = normalizeComparableText(thought);
  const bubbleNorm = normalizeComparableText(bubbleContent);
  if (!thoughtNorm || !bubbleNorm) return false;
  if (thoughtNorm === bubbleNorm) return true;
  if (
    thoughtNorm.length >= THOUGHT_DUPLICATE_MIN_FRAGMENT &&
    (bubbleNorm.includes(thoughtNorm) || thoughtNorm.includes(bubbleNorm))
  ) {
    return true;
  }
  const minLen = Math.min(thoughtNorm.length, bubbleNorm.length);
  if (minLen < SUBSTANTIVE_MIN_CHARS) return false;
  const prefixLen = Math.min(thoughtNorm.length, bubbleNorm.length, 160);
  return thoughtNorm.slice(0, prefixLen) === bubbleNorm.slice(0, prefixLen);
}

export type FilterFeedThoughtsOptions = {
  /** @deprecated Prefer duplicate-only filtering; kept for regression tests. */
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
