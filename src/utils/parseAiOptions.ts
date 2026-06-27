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
 *   - Items appear near the end of the text (after a question)
 */
const TRAILING_QUESTION_RE = /\?|？|请选择|告诉我|告诉我是|你想|你是否|你(?:是指|想要|希望|需要|想让我)/i;
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

export function parseAiOptions(text: string): AiOptionsParseResult | null {
  if (!text) return { before: text, options: [], after: "" };
  const implementConfirm = parseImplementationConfirmOption(text);
  if (implementConfirm) return implementConfirm;

  const lines = text.split("\n");

  // Find the last question/prompt line to anchor the option block (not numbered option lines).
  let questionLineIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (parseOptionLine(trimmed)) continue;
    if (TRAILING_QUESTION_RE.test(trimmed)) {
      questionLineIdx = i;
      break;
    }
  }

  const hasPrecedingQuestion = questionLineIdx >= 0;

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
        (endsWithQuestion || hasPrecedingQuestion) &&
        !/^#{1,6}\s/.test(content)
      ) {
        optionLines.push({
          label: content,
          fullText: content,
          index: i
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

  const options: AiOption[] = optionLines.map((ol, i) => ({
    index: i,
    label: ol.label,
    fullText: ol.fullText,
  }));

  const before = lines.slice(0, firstIdx).join("\n").trimEnd();
  const after = lines.slice(lastIdx + 1).join("\n").trimStart();

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
