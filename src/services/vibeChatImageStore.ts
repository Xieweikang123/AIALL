import type { PersistedChatMessage, PersistedImageRef } from "./vibeChatStorage";
import { fetchChatImageDataUrl } from "./vibeCodingClient";

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function extensionForDataUrl(dataUrl: string): string {
  const mime = dataUrl.match(/^data:(image\/[^;]+)/)?.[1] || "image/png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "png";
}

export function buildImageRefsForMessage(
  sessionId: string,
  messageId: string,
  imageDataUrls: string[],
): PersistedImageRef[] {
  return imageDataUrls.map((url, index) => ({
    path: `images/${safeFilePart(sessionId)}/${safeFilePart(messageId)}-${index}.${extensionForDataUrl(url)}`,
  }));
}

export async function loadImageRefsAsDataUrls(
  projectPath: string,
  refs: PersistedImageRef[],
): Promise<string[]> {
  if (!projectPath.trim() || !refs.length) return [];
  const out: string[] = [];
  for (const ref of refs) {
    const result = await fetchChatImageDataUrl(projectPath, ref.path);
    if (result.ok && result.dataUrl) out.push(result.dataUrl);
  }
  return out;
}

export async function hydrateChatMessageImages(
  projectPath: string,
  message: Pick<PersistedChatMessage, "imageDataUrls" | "imageRefs">,
): Promise<string[]> {
  if (message.imageDataUrls?.length) return [...message.imageDataUrls];
  if (!message.imageRefs?.length) return [];
  return loadImageRefsAsDataUrls(projectPath, message.imageRefs);
}

export async function hydrateChatMessagesImages(
  projectPath: string,
  messages: PersistedChatMessage[],
): Promise<PersistedChatMessage[]> {
  const out: PersistedChatMessage[] = [];
  for (const message of messages) {
    if (message.role !== "user" || message.imageDataUrls?.length || !message.imageRefs?.length) {
      out.push(message);
      continue;
    }
    const imageDataUrls = await loadImageRefsAsDataUrls(projectPath, message.imageRefs);
    out.push(imageDataUrls.length ? { ...message, imageDataUrls } : message);
  }
  return out;
}

export async function resolveImagesForAgentTurn(
  projectPath: string,
  messages: PersistedChatMessage[],
  explicit?: string[],
): Promise<string[]> {
  if (explicit?.length) return explicit;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const urls = await hydrateChatMessageImages(projectPath, m);
    if (urls.length) return urls;
  }
  return [];
}

export function stampImageRefsAfterSync(
  sessionId: string,
  messages: PersistedChatMessage[],
): PersistedChatMessage[] {
  return messages.map((m) => {
    if (m.role !== "user" || !m.imageDataUrls?.length) return m;
    return {
      ...m,
      imageRefs: buildImageRefsForMessage(sessionId, m.id, m.imageDataUrls),
      imageCount: m.imageDataUrls.length,
    };
  });
}
