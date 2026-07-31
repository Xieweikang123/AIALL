/**
 * Structural patterns for agent orchestration — shape / syntax only, no business nouns.
 * Shared by intent classifiers, trace guards, and topic modules.
 */

/** Prior assistant listed enum/constant definitions (not runtime branches). */
export const PRIOR_DEFINITION_LISTING_RE =
  /(?:=\s*\d+|枚举|\benum\b|共有\s*(?:三|几|\d+)\s*(?:种|个)|`[A-Za-z_]\w*`\s*=\s*\d+)/i;

/** Tokens that look like definition lines when repeated without usage evidence. */
export const DEFINITION_VALUE_TOKEN_RE =
  /(?:=\s*\d+|`[^`]+`\s*=\s*\d+|\b=\s*0\b|\b=\s*1\b|\b=\s*2\b)/gi;

/** Whole-repo / app purpose overview (not a single symbol). */
export const PROJECT_OVERVIEW_TOPIC_RE =
  /(?:项目|仓库|代码库|应用).{0,12}(?:做什么|是啥|是什么|介绍|概览|用途)|(?:解释|介绍|说明).{0,8}(?:项目|仓库|应用)/;

/** User pasted session-quality audit task (marker shape, not a feature name). */
export const SESSION_AUDIT_TASK_RE =
  /【任务】请自行排查以下\s*.+\s*会话|Agent\s*回复的准确度|会话文件.*chat-\d{10,}/i;

/** Git working tree / staged changes overview (not implement intent). */
export const GIT_WORKING_TREE_TOPIC_RE =
  /(?:\bgit\b|暂存|未提交|工作区|待提交|staged|unstaged|working\s*tree).{0,24}(?:改|变|diff|状态|提交|啥|什么)|(?:改了啥|改了什么|有哪些改动)|\bgit\s+status\b/i;

export function isGitWorkingTreeTopicPrompt(prompt: string): boolean {
  const text = prompt.trim();
  return Boolean(text && GIT_WORKING_TREE_TOPIC_RE.test(text));
}

/** Assistant reply cited a code location or style evidence (generic). */
export function assistantProvidedCodeLocationEvidence(text: string): boolean {
  return (
    /\.(?:vue|tsx?|jsx?|cs|scss|css)\b/i.test(text) ||
    /(?:background|opacity|backdrop-filter|var\(--)/i.test(text) ||
    /找到了|已定位|位于\s+`/.test(text)
  );
}

