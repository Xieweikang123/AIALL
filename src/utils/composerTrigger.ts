/**
 * 输入框触发词解析（composer contenteditable 与下拉共用）。
 *
 * 两条触发链路共用同一套判定：只认「行首或空白之后」的触发符，
 * 避免 URL / 路径里的 `@`、`/` 误触发。
 */

/** 从光标前文本解析 `@文件` 触发词，返回关键词；未命中返回 null。 */
export function matchMentionTrigger(textBeforeCursor: string): string | null {
  const match = /(^|\s)@([^\s@]*)$/.exec(textBeforeCursor);
  return match ? match[2] : null;
}

/** 从光标前文本解析 `/预设` 触发词，返回关键词；未命中返回 null。 */
export function matchPresetTrigger(textBeforeCursor: string): string | null {
  const match = /(^|\s)\/([^\s/]*)$/.exec(textBeforeCursor);
  return match ? match[2] : null;
}

/** 触发词连同前面那个触发符号一共占用的字符数（用于回删）。 */
export function triggerDeleteCount(query: string): number {
  return query.length + 1;
}
