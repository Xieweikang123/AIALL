export type AiOption = {
  index: number;
  label: string;
  fullText: string;
};

export type AiOptionsParseResult = {
  before: string;
  options: AiOption[];
  after: string;
};

/**
 * Detect AI-generated numbered options pattern in text.
 *
 * Matches patterns like:
 *   1. 隐藏/折叠工具摘要（不显示给用户）？
 *   2. 美化样式（如加边框、背景色区分）？
 *   3. 精简内容（只显示关键信息）？
 *
 * Also matches patterns with parenthesized numbers:
 *   (1) Option A
 *   (2) Option B
 *
 * Requirements:
 *   - 2-6 consecutive numbered items
 *   - Items are short (< 80 chars each)
 *   - Items appear near the end of the text (after a question)
 */
const NUMBERED_ITEM_RE = /^(?:\d+[.)]\s*.+|[（(]\d+[)）]\s*.+)$/m;
const TRAILING_QUESTION_RE = /\?|？|请选择|告诉我|告诉我是|你(?:是指|想要|希望)/;

export function parseAiOptions(text: string): AiOptionsParseResult | null {
  if (!text) return { before: text, options: [], after: "" };

  const lines = text.split("\n");

  // Find the last question/prompt line to anchor the option block
  let questionLineIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (TRAILING_QUESTION_RE.test(lines[i])) {
      questionLineIdx = i;
      break;
    }
  }

  // Scan for numbered items starting from near the end
  const optionLines: { line: string; index: number }[] = [];
  const startScan = questionLineIdx >= 0 ? questionLineIdx + 1 : Math.max(0, lines.length - 8);

  for (let i = startScan; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      // Allow one blank line between question and options, but not within options
      if (optionLines.length > 0) break;
      continue;
    }

    const numMatch = line.match(/^(\d+)[.)]\s*(.+)/);
    if (numMatch) {
      const num = parseInt(numMatch[1], 10);
      const content = numMatch[2].trim();
      if (content.length > 0 && content.length < 80 && num === optionLines.length + 1) {
        optionLines.push({ line: lines[i], index: i });
        continue;
      }
    }

    // If we already have options and hit a non-option line, stop
    if (optionLines.length > 0) break;
  }

  if (optionLines.length < 2 || optionLines.length > 6) return null;

  const firstIdx = optionLines[0].index;
  const lastIdx = optionLines[optionLines.length - 1].index;

  const options: AiOption[] = optionLines.map((ol, i) => {
    const match = ol.line.trim().match(/^(\d+)[.)]\s*(.+)/);
    return {
      index: i,
      label: match?.[2]?.trim() ?? ol.line.trim(),
      fullText: match?.[2]?.trim() ?? ol.line.trim(),
    };
  });

  const before = lines.slice(0, firstIdx).join("\n").trimEnd();
  const after = lines.slice(lastIdx + 1).join("\n").trimStart();

  return { before, options, after };
}
