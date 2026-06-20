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
  /** Quoted visible strings from vision-first-turn description. */
  visionAnchorQuotes?: string[];
  /** Post-vision UI locate phase — enforce anchor-first grep and read-validated patch. */
  visionLocateActive?: boolean;
};

/** Grep patterns that carry structural/code signals (class names, attributes, symbols). */
const STRUCTURAL_GREP_RE =
  /[a-z0-9]-[a-z0-9]|title\s*=|class\s*=|`\s*[\w.-]+\s*`|\.[\w-]+\s*\{|@click|<Teleport|\bposition:\s*(?:fixed|absolute)/i;

/** search_files matches filenames only — CJK-heavy queries usually mean content search. */
export function isSearchFilesContentQuery(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  const hasCjk = /[\u4e00-\u9fff]/.test(q);
  const hasLatinToken = /[a-zA-Z][\w.-]{1,}/.test(q);
  return hasCjk && !hasLatinToken;
}

export function buildSearchFilesContentQueryMessage(query: string): string {
  return [
    `错误：search_files 按文件名匹配，「${query}」更像界面可见文案而非文件名。`,
    "请改用 grep 搜索该文案或 kebab-case class（如 item-meta、panel-list），命中后再 read_file 核对。",
  ].join("");
}

/** Block overly short / generic grep after vision when anchor quotes are available. */
export function isOverlyBroadVisionGrep(pattern: string, anchorQuotes: string[]): boolean {
  if (!anchorQuotes.length) return false;
  const p = pattern.trim();
  if (!p) return false;
  if (STRUCTURAL_GREP_RE.test(p)) return false;
  const compact = p.replace(/\s+/g, "");
  if (compact.length >= 4) {
    for (const quote of anchorQuotes) {
      if (quote.includes(p) || p.includes(quote)) return false;
      if (compact.length >= 4 && quote.includes(compact.slice(0, Math.min(compact.length, 8)))) return false;
    }
  }
  if (compact.length < 4) return true;
  if (/^[\u4e00-\u9fff|｜\s]+$/.test(p) && p.length <= 8) return true;
  return false;
}

export function buildOverlyBroadVisionGrepMessage(pattern: string, anchorQuotes: string[]): string {
  const samples = anchorQuotes.slice(0, 3).map((q) => `「${q}」`).join("、");
  return [
    `错误：grep「${pattern}」过宽，易扫出大量无关命中。`,
    `读图已摘录可见原文 ${samples}。请 grep 其中 ≥4 字的片段，或 grep kebab-case class / title= 等结构标识，再 read_file 核对。`,
  ].join("");
}

/** patch old_string must appear in content the agent already read for that file. */
export function checkPatchOldStringFromReads(
  fileKey: string,
  oldString: string,
  readSliceCache: Map<string, string>,
  readCache?: Map<string, string>,
): string | null {
  const chunks: string[] = [];
  for (const [key, slice] of readSliceCache) {
    if (key.startsWith(`${fileKey}:`)) chunks.push(slice);
  }
  const full = readCache?.get(fileKey);
  if (full) chunks.push(full);
  if (!chunks.length) return null;
  const combined = chunks.join("\n");
  if (combined.includes(oldString)) return null;
  return [
    `错误：old_string 未出现在你对 ${fileKey} 的已读片段中，禁止凭记忆构造。`,
    "请 read_file 包含该段落的窗口，从返回原文复制 old_string 后再 patch_file；若 read 后 DOM 与截图不符，换 grep 下一个命中。",
  ].join("");
}

const VISION_MARKER_RE = /\s*\[图已理解\]\s*/g;

/** Remove internal vision-first-turn marker from user-visible assistant text. */
export function sanitizeAgentUserVisibleText(text: string): string {
  return dedupeRepeatedClauses(text.replace(VISION_MARKER_RE, "")).trim();
}

function dedupeRepeatedClauses(text: string): string {
  return text.replace(/(.{4,48}?)[。．.]{2,}\s*\1[。．.]?/g, "$1。");
}

const WRITE_DONE_RE = /已(?:经)?(?:修复|修改|写入|调整|完成)|改动(?:如下|点)|file_diff|已写入/i;

/** Rubber-stamp self-check without evidence — structural patterns, not feature-specific. */
const PREMATURE_COMPLETION_RE =
  /(?:全部|所有).{0,10}(?:正确|无误|完成|落盘)|无需再改|链路完整|无逻辑漏洞|可以启动测试|代码质量检查|均(?:已)?(?:正确|完成)|都(?:已)?(?:正确|完成)/i;

const FALSE_VERIFICATION_PASS_RE =
  /检查完成|核对完成|验证通过|自检.{0,6}(?:通过|完成)|.{0,6}✅.{0,6}正确/i;

export function claimsPrematureCompletion(text: string): boolean {
  const body = sanitizeAgentUserVisibleText(text);
  if (!body) return false;
  return PREMATURE_COMPLETION_RE.test(body) || (FALSE_VERIFICATION_PASS_RE.test(body) && /✅|无误|正确/.test(body));
}

export function isEmptyOrInsufficientFinalReply(text: string): boolean {
  const body = sanitizeAgentUserVisibleText(text);
  if (!body) return true;
  if (body.length <= 6 && !/[\u4e00-\u9fff]{2}/.test(body)) return true;
  return false;
}

/** True when reply treats a fallback/degraded UI path as primary success. */
export function claimsFallbackAsPrimarySuccess(text: string): boolean {
  const body = sanitizeAgentUserVisibleText(text);
  if (!body) return false;
  return (
    /(?:已发送|通知已|成功).{0,12}(?:✅|成功)/i.test(body) &&
    /(?:横幅|站内|降级|代替|fallback|alert)/i.test(body) === false &&
    /(?:系统|原生|操作系统|桌面|OS)/i.test(body)
  );
}

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
