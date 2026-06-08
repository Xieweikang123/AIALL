export type SessionMessagesPayload = {
  messages?: unknown[];
  [key: string]: unknown;
};

/** Keep on-disk messages when the client syncs an empty array (index-only memory). */
export function mergeSessionMessagesForDisk(
  incoming: unknown[] | undefined,
  existing: unknown[] | undefined,
): unknown[] {
  const next = Array.isArray(incoming) ? incoming : [];
  if (next.length > 0) return next;
  if (Array.isArray(existing) && existing.length > 0) return existing;
  return next;
}

export function mergeSessionPayloadForDisk<T extends SessionMessagesPayload>(
  incoming: T,
  existing: SessionMessagesPayload | null | undefined,
): T {
  const mergedMessages = mergeSessionMessagesForDisk(
    Array.isArray(incoming.messages) ? incoming.messages : [],
    Array.isArray(existing?.messages) ? existing.messages : undefined,
  );
  return { ...incoming, messages: mergedMessages };
}
