import { grepInProject, type GrepMatch } from "./vibeFs";
import { isOverlyBroadVisionGrep } from "./agentExploreGuard";

export const VISION_ANCHOR_PREFGREP_MAX_PATTERNS = 3;
export const VISION_ANCHOR_PREFGREP_MAX_MATCHES = 40;

export type VisionAnchorPrefgrepResult = {
  patterns: string[];
  hadMatches: boolean;
  systemBlock: string;
  matchCount: number;
  uniqueFiles: string[];
};

/** Pick grep patterns from vision anchor quotes; filter overly broad queries. */
export function selectVisionAnchorGrepPatterns(anchorQuotes: string[]): string[] {
  const seen = new Set<string>();
  const patterns: string[] = [];

  const add = (raw: string) => {
    const t = raw.trim();
    if (t.length < 2 || seen.has(t)) return;
    const isAnchorDerived = anchorQuotes.some((quote) => {
      const q = quote.trim();
      return q.includes(t) || t.includes(q);
    });
    if (!isAnchorDerived && isOverlyBroadVisionGrep(t, anchorQuotes)) return;
    seen.add(t);
    patterns.push(t);
  };

  for (const quote of anchorQuotes) {
    const q = quote.trim();
    if (!q) continue;
    add(q);
    for (const run of q.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
      add(run);
    }
    for (const run of q.match(/[\u4e00-\u9fff+][\u4e00-\u9fff+\s]{1,}/g) ?? []) {
      add(run.replace(/\s+/g, ""));
    }
    for (const run of q.match(/[a-z][a-z0-9-]{2,}/gi) ?? []) {
      add(run);
    }
  }

  return patterns.slice(0, VISION_ANCHOR_PREFGREP_MAX_PATTERNS);
}

export function formatVisionAnchorPrefgrepBlock(patterns: string[], matches: GrepMatch[]): string {
  if (!patterns.length) return "";
  const header = `【读图锚点·服务端 grep】已按读图摘录的可见文案搜索（${patterns.map((p) => `「${p}」`).join("、")}）：`;
  if (!matches.length) {
    return [
      header,
      "（无匹配）",
      "下一轮请改 grep kebab-case class、title= 或更短的可见片段；勿猜组件路径。",
    ].join("\n");
  }
  const lines = matches
    .slice(0, VISION_ANCHOR_PREFGREP_MAX_MATCHES)
    .map((m) => `${m.relative}:${m.line}: ${m.text.trim()}`);
  const uniqueFiles = [...new Set(matches.map((m) => m.relative))];
  return [
    header,
    lines.join("\n"),
    `共 ${matches.length} 处命中，涉及 ${uniqueFiles.length} 个文件：${uniqueFiles.slice(0, 8).join("、")}${uniqueFiles.length > 8 ? "…" : ""}。`,
    "请 read_file 1 个最相关文件核对 template/DOM 是否与截图一致，然后给出最终答案；勿重复首轮外观描述。",
  ].join("\n");
}

export function buildVisionConsultativeAutoGrepContinueHint(hadMatches: boolean): string {
  if (hadMatches) {
    return [
      "【读图完成·咨询·已预 grep】服务端已按读图锚点搜索并附上命中列表。",
      "请 read_file 1 个最相关文件核对 DOM 是否与截图一致，然后给出最终中文回答：先一句点明截图对应哪块界面，再答用户问题。",
      "禁止在未 read 的情况下猜测路径；禁止写「下一轮再确认」；禁止重复首轮完整外观描述。",
    ].join("");
  }
  return [
    "【读图完成·咨询·预 grep 无命中】服务端已尝试按读图锚点搜索但未命中。",
    "请改用 grep kebab-case class、title= 或更短可见片段（1 次），必要时 read_file 1 个文件，然后给出最终答案。",
    "禁止猜测组件路径或写「下一轮再确认」；禁止重复首轮完整外观描述。",
  ].join("");
}

export function buildVisionConsultativeReadAfterPrefgrepHint(uniqueFiles: string[]): string {
  const files =
    uniqueFiles.length > 0
      ? `命中文件含：${uniqueFiles.slice(0, 6).join("、")}${uniqueFiles.length > 6 ? "…" : ""}。`
      : "";
  return [
    "【定位未完成·须 read 核对】服务端 grep 已有命中，但你尚未 read_file 核对源码。",
    files,
    "请 read_file 1 个最相关文件，对照截图确认 DOM/文案后给出最终答案；勿重复外观描述或写「下一轮再确认」。",
  ].join("");
}

export async function appendVisionAnchorPrefgrepMessages(
  projectRoot: string,
  anchorQuotes: string[],
  messages: Array<{ role: string; content: string }>,
): Promise<VisionAnchorPrefgrepResult> {
  const pregrep = await runVisionAnchorPrefgrep(projectRoot, anchorQuotes);
  if (pregrep.systemBlock) {
    messages.push({ role: "system", content: pregrep.systemBlock });
  }
  messages.push({
    role: "system",
    content: buildVisionConsultativeAutoGrepContinueHint(pregrep.hadMatches),
  });
  return pregrep;
}

export async function runVisionAnchorPrefgrep(
  projectRoot: string,
  anchorQuotes: string[],
): Promise<VisionAnchorPrefgrepResult> {
  const patterns = selectVisionAnchorGrepPatterns(anchorQuotes);
  if (!patterns.length) {
    return {
      patterns: [],
      hadMatches: false,
      systemBlock: "",
      matchCount: 0,
      uniqueFiles: [],
    };
  }

  const merged: GrepMatch[] = [];
  const seenKeys = new Set<string>();

  for (const pattern of patterns) {
    const result = await grepInProject(projectRoot, pattern, VISION_ANCHOR_PREFGREP_MAX_MATCHES);
    if (!result.ok) continue;
    for (const match of result.matches) {
      const key = `${match.relative}:${match.line}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      merged.push(match);
      if (merged.length >= VISION_ANCHOR_PREFGREP_MAX_MATCHES) break;
    }
    if (merged.length >= VISION_ANCHOR_PREFGREP_MAX_MATCHES) break;
  }

  const uniqueFiles = [...new Set(merged.map((m) => m.relative))];
  return {
    patterns,
    hadMatches: merged.length > 0,
    systemBlock: formatVisionAnchorPrefgrepBlock(patterns, merged),
    matchCount: merged.length,
    uniqueFiles,
  };
}
