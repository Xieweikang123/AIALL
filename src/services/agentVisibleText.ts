/** Internal vision-first-turn marker — must not appear in user-visible assistant text. */
export const VISION_INTERNAL_MARKER_RE = /\s*\[图已理解\]\s*/g;

export function stripVisionInternalMarkers(text: string): string {
  return text.replace(VISION_INTERNAL_MARKER_RE, "").trim();
}

/** Trailing consultative-only implement offer — strip before showing/saving answer. */
const CONSULTATIVE_IMPLEMENT_OFFER_TAIL_RE =
  /\n*(?:需要我|要不要我|是否要我).{0,32}(?:吗|么)[？?]?\s*$/;

export function stripConsultativeImplementOfferTail(text: string): string {
  return text.replace(CONSULTATIVE_IMPLEMENT_OFFER_TAIL_RE, "").trim();
}

export function sanitizeUserVisibleAssistantText(text: string): string {
  return stripConsultativeImplementOfferTail(stripVisionInternalMarkers(text));
}
