import { stripReferenceAttachments } from "../services/vibeChatStorage";

export type SessionOutlineItem = {
  id: string;
  index: number;
  preview: string;
};

export type SessionOutlineSourceMessage = {
  id: string;
  role: string;
  content?: string;
};

const PREVIEW_MAX = 56;

/** Build a jumpable outline of user turns for the current session. */
export function buildSessionOutline(
  messages: ReadonlyArray<SessionOutlineSourceMessage>,
): SessionOutlineItem[] {
  const items: SessionOutlineItem[] = [];
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    const preview = formatOutlinePreview(msg.content ?? "");
    if (!preview) continue;
    items.push({
      id: msg.id,
      index: items.length + 1,
      preview,
    });
  }
  return items;
}

export function formatOutlinePreview(raw: string): string {
  let text = stripReferenceAttachments(raw);
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX)}…` : text;
}
