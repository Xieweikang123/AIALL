/**
 * Tier 1 — resolve short follow-ups that quote prior assistant/code blocks
 * (e.g. 「> Agent: …」+「也移除」). Structure-only; no product nouns.
 */

const QUOTED_LINE_RE = /^\s*>/;

const REMOVE_AMEND_BODY_RE =
  /^(?:也|同样|一样)?(?:移除|去掉|删除|删掉|不要(?:这段|这个|上面)?|取消|撤销)\s*[。！!]?$/i;

const REMOVE_AMEND_LOOSE_RE =
  /(?:也|同样|一样)(?:移除|去掉|删除|删掉)|不要(?:这段|这个|上面)/;

const EXPANDED_REMOVE_MARKER_RE = /^操作：remove\s*$/m;
const EXPANDED_SYMBOLS_RE = /^目标符号：(.+)$/m;

export type QuotedAmendKind = "remove" | "add" | "replace" | "ambiguous";

export type QuotedAmendIntent = {
  kind: QuotedAmendKind;
  quotedLines: string[];
  amendBody: string;
  scopeHint?: string;
  symbolHints: string[];
};

export type TaskAnchorPolarity = "must_include" | "must_exclude" | "neutral";

export function extractQuotedLines(prompt: string): string[] {
  return prompt
    .split("\n")
    .filter((line) => QUOTED_LINE_RE.test(line))
    .map((line) => line.replace(/^\s*>\s?/, "").trim())
    .filter(Boolean);
}

export function extractAmendBody(prompt: string): string {
  return prompt
    .split("\n")
    .filter((line) => !QUOTED_LINE_RE.test(line))
    .join("\n")
    .trim();
}

export function extractSymbolHints(text: string): string[] {
  const hints: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string) => {
    const value = raw.trim();
    if (!value || value.length < 2 || value.length > 80) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    hints.push(value);
  };

  for (const match of text.matchAll(/`([^`]{2,80})`/g)) {
    add(match[1]);
  }
  for (const match of text.matchAll(/\b[A-Z][a-zA-Z0-9]{2,}(?:[A-Z][a-zA-Z0-9]+)+\b/g)) {
    add(match[0]);
  }

  return hints.slice(0, 8);
}

function extractScopeHint(quotedLines: string[]): string | undefined {
  for (const line of quotedLines) {
    const cleaned = line.replace(/^(?:Agent|助手|Assistant)\s*[:：]\s*/i, "").trim();
    const match = cleaned.match(/^(.+?)[：:]\s*.+/);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return undefined;
}

function inferRemoveIntent(amendBody: string, fullPrompt: string): boolean {
  const body = amendBody.trim();
  if (!body) return REMOVE_AMEND_LOOSE_RE.test(fullPrompt);
  if (REMOVE_AMEND_BODY_RE.test(body)) return true;
  if (body.length <= 24 && REMOVE_AMEND_LOOSE_RE.test(body)) return true;
  return /不要/.test(body) && body.length <= 16;
}

function inferAddIntent(amendBody: string): boolean {
  const body = amendBody.trim();
  if (!body || body.length > 32) return false;
  return /(?:加上|添加|加入|补回|恢复)/.test(body) && !inferRemoveIntent(body, body);
}

export function resolveQuotedAmendIntent(prompt: string): QuotedAmendIntent | null {
  const trimmed = prompt.trim();
  if (!trimmed) return null;

  const quotedLines = extractQuotedLines(trimmed);
  if (!quotedLines.length) return null;

  const amendBody = extractAmendBody(trimmed);
  const wantsRemove = inferRemoveIntent(amendBody, trimmed);
  const wantsAdd = !wantsRemove && inferAddIntent(amendBody);

  if (!wantsRemove && !wantsAdd) return null;

  const symbolHints = extractSymbolHints(quotedLines.join("\n"));
  const scopeHint = extractScopeHint(quotedLines);
  const base = { quotedLines, amendBody, scopeHint, symbolHints };

  if (wantsRemove) {
    if (!symbolHints.length && amendBody.length <= 12) {
      return { kind: "ambiguous", ...base };
    }
    return { kind: "remove", ...base };
  }

  if (!symbolHints.length) {
    return { kind: "ambiguous", ...base };
  }
  return { kind: "add", ...base };
}

export function isQuotedAmendPrompt(prompt: string): boolean {
  const resolved = resolveQuotedAmendIntent(prompt);
  return resolved !== null && resolved.kind !== "ambiguous";
}

export function expandQuotedAmendPrompt(prompt: string, resolved: QuotedAmendIntent): string {
  const quoteSummary =
    resolved.quotedLines.length <= 2
      ? resolved.quotedLines.join(" / ")
      : `${resolved.quotedLines[0]} / …（共 ${resolved.quotedLines.length} 行引用）`;

  const scopeLine = resolved.scopeHint ? `scope：${resolved.scopeHint}` : "scope：（见引用行前缀）";
  const symbolsLine =
    resolved.symbolHints.length > 0
      ? `目标符号：${resolved.symbolHints.join("、")}`
      : "目标符号：（见引用块中的标识符）";

  if (resolved.kind === "remove") {
    return [
      "【用户意图·已解析】用户引用了上一轮助手总结或代码块，短句是对引用内容的修订（不是新任务）。",
      "操作：remove",
      scopeLine,
      symbolsLine,
      `用户补充：${resolved.amendBody || "不要引用内容"}`,
      "约束：仅删除目标符号对应配置/代码块；禁止删除 scope 整段注册或服务块；禁止在其它 scope 重新添加用户要求移除的符号。",
      `引用摘要：${quoteSummary}`,
    ].join("\n");
  }

  return [
    "【用户意图·已解析】用户引用了上一轮内容并要求补充添加。",
    "操作：add",
    scopeLine,
    symbolsLine,
    `用户补充：${resolved.amendBody}`,
    `引用摘要：${quoteSummary}`,
  ].join("\n");
}

function parseExpandedExcludeAnchors(taskPrompt: string): string[] {
  if (!EXPANDED_REMOVE_MARKER_RE.test(taskPrompt)) return [];
  const match = taskPrompt.match(EXPANDED_SYMBOLS_RE);
  if (!match?.[1]) return [];
  return match[1]
    .split(/[、,，]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Polarity for finish gate — removal follow-ups must not re-require deleted symbols. */
export function detectTaskAnchorPolarity(taskPrompt: string): {
  polarity: TaskAnchorPolarity;
  excludeAnchors: string[];
} {
  const text = taskPrompt.trim();
  if (!text) return { polarity: "neutral", excludeAnchors: [] };

  const expandedExcludes = parseExpandedExcludeAnchors(text);
  if (expandedExcludes.length > 0) {
    return { polarity: "must_exclude", excludeAnchors: expandedExcludes };
  }

  const resolved = resolveQuotedAmendIntent(text);
  if (resolved?.kind === "remove" && resolved.symbolHints.length > 0) {
    return { polarity: "must_exclude", excludeAnchors: resolved.symbolHints };
  }

  return { polarity: "neutral", excludeAnchors: [] };
}
