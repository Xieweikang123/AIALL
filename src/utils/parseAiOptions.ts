export type AiOption = {
  index: number;
  label: string;
  fullText: string;
  showIndex?: boolean;
  action?: "implement";
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
 *   - Preceded by an explicit choice prompt, or each item ends with ?/？
 */
const IMPLEMENT_CONFIRM_RE =
  /(?:如果你?需要(?:添加|实现|改)?(?:这个|该)?功能，?我可以帮你实现|需要我(?:帮你)?(?:实现|修改|改)(?:一下|代码)?(?:吗|这个功能吗|一下吗|代码吗)?[？?]?|你想让我(?:实现|修改|改)吗[？?]?)\s*$/;

const OPTION_PREFIX_RE = /^(?:(\d+)[.)]|[（(](\d+)[)）]|\[(\d+)\]|([a-fA-F])[.)])\s*(.+)/;

function cleanMarkdownWrap(str: string): string {
  let clean = str.trim();
  if (clean.startsWith("**") && clean.endsWith("**")) {
    clean = clean.slice(2, -2).trim();
  } else if (clean.startsWith("*") && clean.endsWith("*")) {
    clean = clean.slice(1, -1).trim();
  } else if (clean.startsWith("`") && clean.endsWith("`")) {
    clean = clean.slice(1, -1).trim();
  }
  return clean;
}

function parseOptionLine(line: string): { num: number; content: string } | null {
  const clean = cleanMarkdownWrap(line);
  const match = clean.match(OPTION_PREFIX_RE);
  if (!match) return null;
  const numStr = match[1] || match[2] || match[3];
  let num = 0;
  if (numStr) {
    num = parseInt(numStr, 10);
  } else if (match[4]) {
    num = match[4].toLowerCase().charCodeAt(0) - 96; // a->1, b->2
  }
  const content = cleanMarkdownWrap(match[5]);
  return { num, content };
}

/** Line that introduces an explicit choice block — not prose that merely mentions 你想/你需要. */
function isChoicePromptLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || parseOptionLine(trimmed)) return false;
  if (/[?？][）)]*\s*$/.test(trimmed)) return true;
  if (/请选择[：:]\s*$/.test(trimmed)) return true;
  return false;
}

/** Numbered list intro that should stay plain markdown (summaries, conclusions, doc sections). */
function isSummaryListIntro(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^#{1,6}\s*总结\b/i.test(trimmed)) return true;
  if (/^(?:\*\*)?总结(?:\*\*)?[：:]/i.test(trimmed)) return true;
  if (/集中在[：:]\s*$/.test(trimmed)) return true;
  if (/[：:]\s*$/.test(trimmed) && /核心建议|建议如下|结论如下|注意事项|变更如下|最终答案|如下/.test(trimmed)) {
    return true;
  }
  return false;
}

export function parseAiOptions(text: string): AiOptionsParseResult | null {
  if (!text) return { before: text, options: [], after: "" };
  const implementConfirm = parseImplementationConfirmOption(text);
  if (implementConfirm) return implementConfirm;

  const lines = text.split("\n");

  // Find the last explicit choice prompt to anchor the option block.
  let questionLineIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (parseOptionLine(trimmed)) continue;
    if (isChoicePromptLine(trimmed)) {
      questionLineIdx = i;
      break;
    }
  }

  const promptLine = questionLineIdx >= 0 ? lines[questionLineIdx].trim() : "";
  const hasStrictPrompt = isChoicePromptLine(promptLine);

  // Scan for numbered items starting from near the end
  const optionLines: { label: string; fullText: string; index: number }[] = [];
  const startScan = questionLineIdx >= 0 ? questionLineIdx + 1 : Math.max(0, lines.length - 8);

  for (let i = startScan; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      // Allow one blank line between question and options, but not within options
      if (optionLines.length > 0) break;
      continue;
    }

    const parsed = parseOptionLine(line);
    if (parsed) {
      const { num, content } = parsed;
      const endsWithQuestion = /[?？]$/.test(content);

      if (
        content.length > 0 &&
        content.length < 80 &&
        num === optionLines.length + 1 &&
        (endsWithQuestion || hasStrictPrompt) &&
        !/^#{1,6}\s/.test(content)
      ) {
        optionLines.push({
          label: content,
          fullText: content,
          index: i,
        });
        continue;
      }
    }

    // If we already have options and hit a non-option line, stop
    if (optionLines.length > 0) break;
  }

  if (optionLines.length < 2 || optionLines.length > 6) return null;

  const firstIdx = optionLines[0].index;
  const lastIdx = optionLines[optionLines.length - 1].index;

  const introLine = firstIdx > 0 ? lines[firstIdx - 1].trim() : promptLine;
  if (isSummaryListIntro(introLine)) return null;

  const options: AiOption[] = optionLines.map((ol, i) => ({
    index: i,
    label: ol.label,
    fullText: ol.fullText,
  }));

  const before = lines.slice(0, firstIdx).join("\n").trimEnd();
  const after = lines.slice(lastIdx + 1).join("\n").trimStart();

  if (/^#{1,6}\s*总结\b/im.test(before)) return null;

  // Residual prose after options means this was a normal list, not a choice block.
  if (after.length > 20) return null;

  return { before, options, after };
}

function parseImplementationConfirmOption(text: string): AiOptionsParseResult | null {
  const trimmed = text.trimEnd();
  if (!IMPLEMENT_CONFIRM_RE.test(trimmed)) return null;

  return {
    before: trimmed,
    options: [
      {
        index: 0,
        label: "需要",
        fullText: "请实现上面提到的功能/修改",
        showIndex: false,
        action: "implement",
      },
      {
        index: 1,
        label: "不需要",
        fullText: "不需要，谢谢",
        showIndex: false,
      },
    ],
    after: "",
  };
}
