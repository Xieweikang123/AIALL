import { stripQuotedReplyPrefix } from "../src/services/agentContinuation";

/** Terse yes/no follow-up without restating the subject (e.g. 「需要优化吗」). */
const SHORT_TOPIC_FOLLOW_UP_RE =
  /^(?:需要|要不要|是否|还得|还要|值得|可以|那)?[^。！!\n]{0,24}(?:吗|呢|对不对)[？?]?\s*$/;

/** Prior assistant turn explained cause/mechanism rather than delivering a new task plan. */
const EXPLANATORY_ASSISTANT_RE =
  /(?:\*\*[^*]{1,24}\*\*|#{1,3}\s).{0,48}(?:原因|方式|机制|流程|步骤)|(?:错误|报错|提示|异常).{0,32}(?:出现在|由于|因为)|`[^`]{1,40}`[^。]{0,24}(?:工具|调用)|(?:逐字符|完全一致|匹配不上)/;

const TOPIC_ANCHOR_HINT = [
  "【延续上一轮话题】上一条助手消息是在解释/答疑（非新任务安排）。",
  "用户本条是短追问，必须围绕该解释继续讨论，判断「是否需要优化/改进」指上条所涉机制、体验或流程。",
  "禁止切换到本会话中更早的其他任务，禁止罗列已完成工作的回顾清单。",
  "若仍不清晰（如代码改动 vs 产品/流程优化），先针对上条话题作答，必要时用一句话澄清，勿猜测或擅自改代码。",
].join(" ");

/**
 * Anchor terse follow-ups to the immediately preceding assistant turn.
 * Complements screenshot-scoped UI hints in visionMessage.ts.
 */
export function buildImmediateTopicFollowUpHint(
  prompt: string,
  lastAssistantContent?: string,
  originalPrompt?: string,
): string {
  const detectSource = (originalPrompt ?? prompt).trim();
  const body = stripQuotedReplyPrefix(detectSource);
  if (!body || !lastAssistantContent?.trim()) return prompt;
  if (!SHORT_TOPIC_FOLLOW_UP_RE.test(body)) return prompt;
  if (!EXPLANATORY_ASSISTANT_RE.test(lastAssistantContent)) return prompt;
  if (prompt.includes("【延续上一轮话题】")) return prompt;

  return [TOPIC_ANCHOR_HINT, "", prompt].join("\n");
}
