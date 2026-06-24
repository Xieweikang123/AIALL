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

function trimIncompleteFencedCodeBlock(source: string): string {
  const fences = source.match(/^```/gm);
  if (!fences || fences.length % 2 === 0) return source;
  const idx = source.lastIndexOf("```");
  return source.slice(0, idx).trimEnd();
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
 * Prevents raw `| ... |` pipe walls and half-open code fences during SSE.
 */
export function trimIncompleteStreamingMarkdown(source: string): string {
  if (!source) return "";
  if (!source.includes("```") && !source.includes("|")) return source;
  let result = trimIncompleteFencedCodeBlock(source);
  if (!result.includes("|")) return result;
  result = trimIncompleteTableTail(result);
  return result;
}
