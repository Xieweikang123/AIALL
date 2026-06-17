/** Explicit change / implementation intent — Build may write. */
const IMPLEMENT_INTENT_RE =
  /(?:帮我|请|麻烦)?(?:改|修|修复|实现|添加|新增|删除|创建|优化|调整|更新|写入|落地|开发|执行|替换|重构|改成|改为|改一下|改下|写一[个份]?|做一[个份]?|fix|implement|add\b|create\b|update\b|refactor\b)/i;

/** Question / explanation intent without asking to change code. */
const CONSULTATIVE_MARKERS_RE =
  /(?:什么|为什么|为啥|如何|怎么|怎样|哪里|哪儿|是否|是不是|能不能|可不可以|能否|干嘛|干啥|啥是|是什么|有没有|对不对|什么意思|啥意思|吗[？?]?$|[？?]$)/;

/** Resume / plan execution prompts must keep write access. */
const AUTOMATION_PROMPT_RE = /^\s*(?:【|\[)(?:方案执行|精准修改|效率|系统自动续跑|读图完成)/;

/** Short evaluative follow-up — consultative even when it contains verbs like 「优化」. */
const SHORT_EVALUATIVE_FOLLOW_UP_RE =
  /^(?:需要|要不要|是否|还得|还要|值得|可以|那)?[^。！!]{0,24}(?:吗|呢)[？?]?\s*$/;

export function isConsultativeUserPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  if (AUTOMATION_PROMPT_RE.test(text)) return false;
  if (SHORT_EVALUATIVE_FOLLOW_UP_RE.test(text)) return true;
  if (IMPLEMENT_INTENT_RE.test(text)) return false;
  return CONSULTATIVE_MARKERS_RE.test(text);
}

export function buildConsultativeBuildHint(): string {
  return [
    "",
    "【咨询任务·只读】用户本条仅为提问/解释，未要求改代码。",
    "只允许 list_dir / read_file / grep / search_files；禁止 patch_file / write_file / delete_file。",
    "优先 1 次 grep 定位，必要时 read_file 1 个相关文件后即回答；勿连环读取多个无关文件。",
    "用自然语言直接回答；若用户之后要明确修改，请其切换到 Build 并说明改什么，或改用 Ask 继续讨论。",
  ].join("\n");
}
