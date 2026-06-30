import type { AiOption } from "./parseAiOptions";

export type ClarificationQuestionGroup = {
  prompt: string;
  options: AiOption[];
};

export type ClarificationChoicesResult = {
  intro: string;
  /** Markdown with option lines removed — questions stay visible. */
  displayText: string;
  questions: ClarificationQuestionGroup[];
};

const OPTION_PREFIX_RE = /^(?:(\d+)[.)]|[（(](\d+)[)）]|\[(\d+)\]|([a-fA-F])[.)])\s*(.+)/;
const BULLET_RE = /^[-*•]\s+(.+)$/;
const MAX_OPTION_LEN = 120;
const MAX_LABEL_LEN = 52;

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

function truncateLabel(label: string): string {
  if (label.length <= MAX_LABEL_LEN) return label;
  return `${label.slice(0, MAX_LABEL_LEN - 1)}…`;
}

function parseNumberedOptionLine(line: string): string | null {
  const clean = cleanMarkdownWrap(line);
  const match = clean.match(OPTION_PREFIX_RE);
  if (!match) return null;
  const content = cleanMarkdownWrap(match[5]);
  if (!content || content.length > MAX_OPTION_LEN) return null;
  if (/^#{1,6}\s/.test(content)) return null;
  return content;
}

function parseBulletOptionLine(line: string): string | null {
  const match = line.trim().match(BULLET_RE);
  if (!match) return null;
  const content = cleanMarkdownWrap(match[1]);
  if (!content || content.length > MAX_OPTION_LEN) return null;
  if (/^#{1,6}\s/.test(content)) return null;
  return content;
}

function parseOptionContent(line: string): string | null {
  return parseNumberedOptionLine(line) ?? parseBulletOptionLine(line);
}

function parseQuestionPrompt(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || !/[?？]/.test(trimmed)) return null;

  const bold = trimmed.match(/^\*\*(.+?[?？].*)\*\*$/);
  if (bold) return cleanMarkdownWrap(bold[1]);

  const heading = trimmed.match(/^#{1,4}\s*(.+?[?？].*)$/);
  if (heading) return cleanMarkdownWrap(heading[1]);

  const numbered = trimmed.match(/^(?:\*\*)?(?:问题\s*)?(\d+)[.、]\s*(.+?[?？].*?)(?:\*\*)?$/);
  if (numbered) return cleanMarkdownWrap(numbered[2]);

  if (parseOptionContent(trimmed)) return null;
  if (/^[-*•]\s/.test(trimmed)) return null;

  const plain = cleanMarkdownWrap(trimmed);
  if (plain.length >= 8 && plain.length <= 160) return plain;
  return null;
}

/** Multi-question clarification with bullet/numbered choices → chat option buttons. */
export function parseClarificationChoices(text: string): ClarificationChoicesResult | null {
  const lines = text.split("\n");
  if (lines.length < 4) return null;

  type Section = { prompt: string; promptLine: number; optionLines: number[]; options: string[] };
  const sections: Section[] = [];
  let current: Section | null = null;
  let introEnd = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const prompt = parseQuestionPrompt(line);
    if (prompt) {
      if (current) sections.push(current);
      current = { prompt, promptLine: i, optionLines: [], options: [] };
      introEnd = i;
      continue;
    }

    if (!current) continue;
    const option = parseOptionContent(line);
    if (option) {
      current.optionLines.push(i);
      current.options.push(option);
      continue;
    }

    if (line.trim() && current.options.length > 0) {
      sections.push(current);
      current = null;
    }
  }
  if (current) sections.push(current);

  const questions: ClarificationQuestionGroup[] = sections
    .filter((section) => section.options.length >= 2 && section.options.length <= 6)
    .slice(0, 3)
    .map((section, sectionIndex) => ({
      prompt: section.prompt,
      options: section.options.map((label, index) => ({
        index: sectionIndex * 10 + index,
        label: truncateLabel(label),
        fullText: label,
      })),
    }));

  if (!questions.length) return null;

  const optionLineSet = new Set<number>();
  for (const section of sections) {
    for (const lineIdx of section.optionLines) optionLineSet.add(lineIdx);
  }

  const displayLines = lines.filter((_, index) => !optionLineSet.has(index));
  const intro = lines.slice(0, introEnd).join("\n").trimEnd();
  const displayText = displayLines.join("\n").trimEnd();

  return { intro, displayText, questions };
}
