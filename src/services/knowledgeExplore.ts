import { EXPLORE_PROJECT_PRESET_PROMPT } from "./agentExplore";

/** User clicked「继续探索」. */
export const EXPLORE_CONTINUE_PROMPT_RE =
  /^请继续探索项目中尚未覆盖的部分/i;

/** User clicked「补全未探索」. */
export const EXPLORE_SECTION_FILL_PROMPT_RE =
  /^请针对性探索并补全以下标注为「未探索」/;

/** User clicked「针对变更探索」. */
export const EXPLORE_CHANGES_PROMPT_RE =
  /^请针对自上次探索以来变更的代码文件/i;

/** Follow-up anchored to a user-selected knowledge excerpt. */
export const KNOWLEDGE_QUOTE_FOLLOWUP_RE =
  /^用户引用了知识库中的以下段落：/ms;

export type ExploreKnowledgeIntent =
  | "initial"
  | "rebuild"
  | "continue"
  | "section_fill"
  | "changes"
  | "followup";

export function isExploreContinuePrompt(text: string): boolean {
  return EXPLORE_CONTINUE_PROMPT_RE.test(text.trim());
}

export function isExploreSectionFillPrompt(text: string): boolean {
  return EXPLORE_SECTION_FILL_PROMPT_RE.test(text.trim());
}

export function isExploreChangesPrompt(text: string): boolean {
  return EXPLORE_CHANGES_PROMPT_RE.test(text.trim());
}

export function isKnowledgeQuoteFollowUpPrompt(text: string): boolean {
  return KNOWLEDGE_QUOTE_FOLLOWUP_RE.test(text.trim());
}

export function isExploreFollowUpPrompt(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed === EXPLORE_PROJECT_PRESET_PROMPT) return false;
  if (isExploreContinuePrompt(trimmed)) return false;
  if (isExploreSectionFillPrompt(trimmed)) return false;
  if (isExploreChangesPrompt(trimmed)) return false;
  return true;
}

export function classifyExploreKnowledgeIntent(
  prompt: string,
  hasExistingBody: boolean,
): ExploreKnowledgeIntent {
  const trimmed = prompt.trim();
  if (trimmed === EXPLORE_PROJECT_PRESET_PROMPT) {
    return hasExistingBody ? "rebuild" : "initial";
  }
  if (isExploreContinuePrompt(trimmed)) return "continue";
  if (isExploreSectionFillPrompt(trimmed)) return "section_fill";
  if (isExploreChangesPrompt(trimmed)) return "changes";
  if (hasExistingBody) return "followup";
  return "initial";
}

export function exploreIntentUsesKnowledgeManifest(intent: ExploreKnowledgeIntent): boolean {
  return intent === "continue"
    || intent === "section_fill"
    || intent === "changes"
    || intent === "followup";
}
