/**
 * Tier 1 — action (root-verb) classifier.
 * Separates inquiry-shaped prompts from implement-shaped prompts by predicate structure,
 * independent of consultative topic (e.g. project_overview).
 */
import { IMPLEMENT_INTENT_RE } from "./userIntentClassifiers";

/** Closing root verb / predicate — inquiry without explicit change request. */
export const CONSULTATIVE_ROOT_VERB_RE =
  /(?:是啥|是什么|有哪些|有啥|有什么|做什么|干什么|干啥|干嘛|干吗|多少|几个|怎么样|如何|怎样|怎么|为什么|为啥|是否|是不是|对不对|什么意思|啥意思|啥作用|什么作用|有没有|能否|可不可以|能不能)(?:[吗呢吧])?[？?]?\s*$/;

/** Sentence-initial inquiry verbs (explain / describe / list). */
export const CONSULTATIVE_LEADING_VERB_RE =
  /^(?:请?)(?:解释|介绍|说明|描述|概述|列出|列举|告诉我|说说|讲讲|看看|查查|梳理)/;

const CONSULTATIVE_QUESTION_TAIL_RE =
  /(?:什么|怎么|如何|为什么|为啥|啥|是否|是不是|有没有|哪些|哪个|哪儿|哪里|多少|几个)/;

export type UserActionKind = "consultative" | "implement" | "neutral";

/** True when the prompt's root action is inquiry-only (no implement verb). */
export function isConsultativeRootAction(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  if (IMPLEMENT_INTENT_RE.test(text)) return false;
  if (CONSULTATIVE_ROOT_VERB_RE.test(text)) return true;
  if (CONSULTATIVE_LEADING_VERB_RE.test(text)) return true;
  if (/[？?]\s*$/.test(text) && CONSULTATIVE_QUESTION_TAIL_RE.test(text)) return true;
  return false;
}

/** Classify user message by root action verb — consultative vs implement vs neutral. */
export function classifyUserAction(prompt: string): UserActionKind {
  const text = prompt.trim();
  if (!text) return "neutral";
  if (IMPLEMENT_INTENT_RE.test(text)) return "implement";
  if (isConsultativeRootAction(text)) return "consultative";
  return "neutral";
}
