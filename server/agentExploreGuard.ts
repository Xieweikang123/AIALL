/** Line range tracked per file to detect overlapping read_file windows. */
export type ReadLineRange = { start: number; end: number };

/** Block when a new read overlaps any prior range on the same file (2nd overlapping window). */
export const MAX_OVERLAPPING_READ_ATTEMPTS = 1;
export const OVERLAP_READ_MIN_SHARE = 0.5;

export function readLineRangeFromArgs(offset: number, limit: number): ReadLineRange {
  const start = Math.max(1, offset);
  const end = start + Math.max(1, limit) - 1;
  return { start, end };
}

export function readRangesOverlap(a: ReadLineRange, b: ReadLineRange): boolean {
  const overlapStart = Math.max(a.start, b.start);
  const overlapEnd = Math.min(a.end, b.end);
  if (overlapEnd < overlapStart) return false;
  const overlapLen = overlapEnd - overlapStart + 1;
  const spanA = a.end - a.start + 1;
  const spanB = b.end - b.start + 1;
  const smaller = Math.min(spanA, spanB);
  return overlapLen >= smaller * OVERLAP_READ_MIN_SHARE;
}

export function checkOverlappingRead(
  filePath: string,
  range: ReadLineRange,
  priorRanges: Map<string, ReadLineRange[]>,
): string | null {
  const existing = priorRanges.get(filePath) ?? [];
  let overlapHits = 0;
  for (const prior of existing) {
    if (readRangesOverlap(range, prior)) overlapHits += 1;
  }
  if (overlapHits >= MAX_OVERLAPPING_READ_ATTEMPTS) {
    return `错误：${filePath} 行 ${range.start}–${range.end} 与已读片段高度重叠（第 ${overlapHits + 1} 次），请基于已有内容 patch_file，勿再用重叠窗口 read_file。`;
  }
  return null;
}

export function recordReadRange(
  filePath: string,
  range: ReadLineRange,
  priorRanges: Map<string, ReadLineRange[]>,
): void {
  const list = priorRanges.get(filePath) ?? [];
  list.push(range);
  priorRanges.set(filePath, list);
}

/** Overlay positioning handlers / fixed layers — structural, not topic-specific. */
export const PATCH_ANCHOR_SYMBOL_RE =
  /\b(?:function|async function|const)\s+(show[A-Z]\w*At|tryShow[A-Z]\w*|getSelection[A-Z]\w*|clamp[A-Z]\w*)\b|<Teleport\b|\bposition:\s*fixed\b|\b[\w-]*-floating\b/i;

export function textIndicatesPatchAnchor(text: string): boolean {
  return PATCH_ANCHOR_SYMBOL_RE.test(text);
}

export function buildPatchAnchorLocatedNudge(): string {
  return [
    "【系统提示】已定位到浮层/选区定位相关符号。",
    "Build 模式下一轮必须 patch_file/write_file；禁止再 read 重叠片段或 grep 底栏 layout class。",
    "先用 1–2 句中文说明根因假设，然后直接改代码。",
  ].join("");
}

/** Grep patterns that mislead after vision treats a fixed overlay as in-flow layout. */
export const VISION_MISREAD_BLOCKED_GREP_RE =
  /chat-action-row|chat-status-row|chat-bottom|transform\s*\|\s*will-change/i;

/** After anchor located or Teleport→body confirmed — low-signal detours. */
export const POST_LOCATE_BLOCKED_GREP_RE =
  /(?:^|\|)transform(?:\s*\||$)|will-change|chat-action-row|chat-status-row|chat-bottom/i;

export function textConfirmsTeleportToBody(text: string): boolean {
  return /Teleport[\s\S]{0,80}to\s*=\s*["']body["']/i.test(text) || /<Teleport[^>]*\s+to=["']body["']/i.test(text);
}

export function isBlockedGrepAfterVisionMisread(pattern: string, visionMisreadActive: boolean): boolean {
  if (!visionMisreadActive) return false;
  return VISION_MISREAD_BLOCKED_GREP_RE.test(pattern.trim());
}

export function isBlockedGrepAfterLocate(
  pattern: string,
  patchAnchorLocated: boolean,
  teleportBodyConfirmed: boolean,
): boolean {
  if (!patchAnchorLocated && !teleportBodyConfirmed) return false;
  const p = pattern.trim();
  if (POST_LOCATE_BLOCKED_GREP_RE.test(p)) return true;
  if (teleportBodyConfirmed && /\btransform\b/i.test(p)) return true;
  return false;
}

export function buildBlockedGrepAfterLocateMessage(pattern: string): string {
  return `错误：已确认 Teleport/fixed 浮层或已定位 show*At/getSelection*，不应 grep「${pattern}」。请 patch 坐标计算逻辑，勿查 transform 或底栏 flex。`;
}

export function buildBlockedGrepMessage(pattern: string): string {
  return `错误：读图已判定控件为 Teleport/fixed 浮层错位，不应 grep「${pattern}」查底栏 flex。请改 grep kebab-case 浮层 class（*-floating）或 show*At / getSelection* 符号。`;
}

export function buildEnglishPlanningNudge(): string {
  return "【系统提示】探索阶段须用中文写进度（根因 + 下一步）；禁止仅用 \"Now let me\" / \"Let me\" 英文 planning。";
}

export function shouldNudgeEnglishPlanning(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^(?:Now let me|Let me)\b/i.test(trimmed)) {
    return (trimmed.match(/[\u4e00-\u9fff]/g) || []).length < 6;
  }
  return false;
}

export type ToolGuardContext = {
  readFileRanges: Map<string, ReadLineRange[]>;
  visionMisreadActive: boolean;
  patchAnchorLocated: boolean;
  teleportBodyConfirmed: boolean;
};

const VISION_MARKER_RE = /\s*\[图已理解\]\s*/g;

/** Remove internal vision-first-turn marker from user-visible assistant text. */
export function sanitizeAgentUserVisibleText(text: string): string {
  return dedupeRepeatedClauses(text.replace(VISION_MARKER_RE, "")).trim();
}

function dedupeRepeatedClauses(text: string): string {
  return text.replace(/(.{4,48}?)[。．.]{2,}\s*\1[。．.]?/g, "$1。");
}

const WRITE_DONE_RE = /已(?:经)?(?:修复|修改|写入|调整|完成)|改动(?:如下|点)|file_diff|已写入/i;

const MANUAL_PASTE_INSTRUCTION_RE =
  /请将.{0,24}(?:应用|粘贴|手动)|请自行.{0,12}(?:应用|修改|粘贴)|手动.{0,8}(?:应用|修改|粘贴)/i;

/** True when the model re-output screenshot analysis instead of patching under force-patch. */
export function isAnalysisOnlyReplyUnderForcePatch(text: string): boolean {
  const body = sanitizeAgentUserVisibleText(text);
  if (!body) return true;
  if (MANUAL_PASTE_INSTRUCTION_RE.test(body)) return true;
  if (/修复方案|以下是具体修改|###\s*修改/i.test(body) && /```[\s\S]+```/.test(body) && !WRITE_DONE_RE.test(body)) {
    return true;
  }
  if (WRITE_DONE_RE.test(body)) return false;
  return (
    /截图|读图|图已理解|核心问题|根因|getSelection|getClientRects|position:\s*fixed/i.test(body) &&
    !/patch_file|write_file|已修改|已修复|改动如下|diff/i.test(body)
  );
}

export function shouldForcePatchAfterAnchorLocated(
  patchAnchorLocated: boolean,
  patchAnchorForcePending: boolean,
  buildExploreHardCapReached: boolean,
  implementFollowUpRun = false,
): boolean {
  if (implementFollowUpRun && writePendingForImplement(patchAnchorLocated, patchAnchorForcePending, buildExploreHardCapReached)) {
    return true;
  }
  if (!patchAnchorLocated) return false;
  return patchAnchorForcePending || buildExploreHardCapReached;
}

function writePendingForImplement(
  patchAnchorLocated: boolean,
  patchAnchorForcePending: boolean,
  buildExploreHardCapReached: boolean,
): boolean {
  return patchAnchorForcePending || patchAnchorLocated || buildExploreHardCapReached;
}
