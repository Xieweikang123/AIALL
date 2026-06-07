const DEFAULT_MAX_LINES = 200;
const DEFAULT_MAX_CHARS = 8_000;

export type TruncatePromptAttachmentOptions = {
  maxLines?: number;
  maxChars?: number;
};

/** Trim user-attached file content before it is injected into an agent prompt. */
export function truncatePromptAttachment(
  content: string,
  options?: TruncatePromptAttachmentOptions,
): string {
  const maxLines = options?.maxLines ?? DEFAULT_MAX_LINES;
  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;
  let text = content;

  const lines = text.split(/\r?\n/);
  if (lines.length > maxLines) {
    text = `${lines.slice(0, maxLines).join("\n")}\n…（已截断，原文件共 ${lines.length} 行，可用 read_file 读取完整内容）`;
  }

  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n…（已截断，共 ${content.length} 字符，可用 read_file 读取完整内容）`;
  }

  return text;
}
