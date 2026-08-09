const TABLE_SEP_RE = /^\|[\s\-:|]+\|$/;

function isTableLikeLine(line: string): boolean {
  return line.trim().startsWith("|");
}

function isCompleteTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|");
}

function isTableSeparator(line: string): boolean {
  return TABLE_SEP_RE.test(line.trim());
}

/** SSE chunk glued rows before newline: `| --- | --- || cell |`. */
function hasGluedTableRows(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return false;
  return /\|\|/.test(trimmed);
}

function stabilizeIncompleteFencedCodeBlock(source: string): string {
  const fences = source.match(/^```/gm);
  if (!fences || fences.length % 2 === 0) return source;
  // Streaming may deliver the opening fence before any code content has arrived;
  // synthesizing a close at that moment renders an empty gray code box. Hold the
  // block back until real content follows the fence.
  const lastFence = source.lastIndexOf("```");
  const tail = source.slice(lastFence + 3).replace(/^[^\n]*\n?/, "");
  if (!tail.trim()) {
    return source.slice(0, lastFence).trimEnd();
  }
  return `${source}\n\`\`\``;
}

function countTokenOutsideFences(source: string, token: string): number {
  let count = 0;
  let index = 0;
  let inFence = false;
  while (index < source.length) {
    if (source.startsWith("```", index)) {
      inFence = !inFence;
      index += 3;
      continue;
    }
    if (!inFence && source.startsWith(token, index)) {
      count += 1;
      index += token.length;
      continue;
    }
    index += 1;
  }
  return count;
}

/** Close dangling inline markers so marked can render partial SSE chunks. */
export function closeStreamingInlineMarkdown(source: string): string {
  let result = source;
  const boldCount = countTokenOutsideFences(result, "**");
  // Only close a single opening ** — multiple pairs mean a partial second span, not a dangling opener.
  if (boldCount === 1) {
    result += "**";
  }
  if (countTokenOutsideFences(result, "`") % 2 === 1) {
    result += "`";
  }
  return result;
}

function trimIncompleteTableTail(source: string): string {
  const lines = source.split("\n");
  let end = lines.length - 1;
  while (end >= 0 && !lines[end].trim()) end -= 1;
  if (end < 0) return source;

  let start = end;
  while (start >= 0 && isTableLikeLine(lines[start])) start -= 1;
  start += 1;

  const tableLineCount = end - start + 1;
  if (tableLineCount <= 0) return source;

  const tableLines = lines.slice(start, end + 1).map((line) => line.trim());
  const prefix = lines.slice(0, start).join("\n").trimEnd();

  if (tableLines.some(hasGluedTableRows)) {
    return prefix;
  }

  if (tableLines.length < 2 || !isTableSeparator(tableLines[1])) {
    return prefix;
  }

  const completeRows = tableLines.filter(isCompleteTableRow);
  if (completeRows.length < 2 || !isTableSeparator(completeRows[1])) {
    return prefix;
  }

  if (completeRows.length < tableLines.length) {
    if (completeRows.length > 2) {
      return [...(prefix ? [prefix, ""] : []), ...completeRows].join("\n").trimEnd();
    }
    return prefix;
  }

  return source;
}

/**
 * Hold back block-level markdown that cannot parse correctly until streaming completes.
 * Open code fences are closed synthetically so partial blocks still render.
 */
export function trimIncompleteStreamingMarkdown(source: string): string {
  if (!source) return "";
  let result = closeStreamingInlineMarkdown(source);
  if (!result.includes("```") && !result.includes("|")) return result;
  result = stabilizeIncompleteFencedCodeBlock(result);
  if (!result.includes("|")) return result;
  result = trimIncompleteTableTail(result);
  return result;
}

/** Full streaming markdown prep: inline close + block stabilize. */
export function prepareStreamingMarkdownForRender(source: string): string {
  return trimIncompleteStreamingMarkdown(source);
}
