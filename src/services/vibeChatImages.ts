import fs from "node:fs";
import path from "node:path";

export type PersistedImageRef = {
  /** Relative to `.aiall/vibe-chat-sessions/` */
  path: string;
};

export type ChatMessageLike = {
  id?: string;
  role?: string;
  content?: string;
  imageDataUrls?: string[];
  imageRefs?: PersistedImageRef[];
  imageCount?: number;
};

const DATA_URL_RE = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s;

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function chatImagesDir(chatDir: string, sessionId: string): string {
  return path.join(chatDir, "images", safeFilePart(sessionId));
}

export function imageRefRelativePath(sessionId: string, messageId: string, index: number, ext: string): string {
  return path.posix.join("images", safeFilePart(sessionId), `${safeFilePart(messageId)}-${index}.${ext}`);
}

function extensionForMime(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "png";
}

function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const match = DATA_URL_RE.exec(dataUrl.trim());
  if (!match) return null;
  try {
    return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
  } catch {
    return null;
  }
}

function mimeFromExt(ext: string): string {
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/png";
}

export async function writeImageRef(
  chatDir: string,
  sessionId: string,
  messageId: string,
  index: number,
  dataUrl: string,
): Promise<PersistedImageRef | null> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  const ext = extensionForMime(parsed.mime);
  const rel = imageRefRelativePath(sessionId, messageId, index, ext);
  const abs = path.join(chatDir, rel.split("/").join(path.sep));
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, parsed.buffer);
  return { path: rel };
}

export async function readImageRefAsDataUrl(chatDir: string, refPath: string): Promise<string | null> {
  const loaded = await readImageRefAsBuffer(chatDir, refPath);
  if (!loaded) return null;
  return `data:${loaded.mime};base64,${loaded.buffer.toString("base64")}`;
}

export async function readImageRefAsBuffer(
  chatDir: string,
  refPath: string,
): Promise<{ buffer: Buffer; mime: string } | null> {
  const normalized = refPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized.startsWith("images/") || normalized.includes("..")) return null;
  const abs = path.join(chatDir, normalized.split("/").join(path.sep));
  const buf = await fs.promises.readFile(abs).catch(() => null);
  if (!buf?.length) return null;
  const ext = path.extname(abs).slice(1).toLowerCase();
  return { buffer: buf, mime: mimeFromExt(ext) };
}

async function imageRefFileExists(chatDir: string, refPath: string): Promise<boolean> {
  const loaded = await readImageRefAsBuffer(chatDir, refPath);
  return Boolean(loaded);
}

async function filterExistingImageRefs(
  chatDir: string,
  refs: PersistedImageRef[],
): Promise<PersistedImageRef[]> {
  const out: PersistedImageRef[] = [];
  for (const ref of refs) {
    if (ref.path && (await imageRefFileExists(chatDir, ref.path))) {
      out.push(ref);
    }
  }
  return out;
}

/** Persist user-message images to disk; strip base64 from serialized payload. */
export async function externalizeMessageImages(
  chatDir: string,
  sessionId: string,
  messages: ChatMessageLike[],
): Promise<ChatMessageLike[]> {
  const out: ChatMessageLike[] = [];
  for (const message of messages) {
    if (message.role !== "user") {
      out.push({ ...message, imageDataUrls: undefined });
      continue;
    }
    const messageId = (message.id || "").trim() || `msg-${out.length}`;
    const urls = message.imageDataUrls?.filter((u) => typeof u === "string" && u.startsWith("data:image/")) || [];
    const refs: PersistedImageRef[] = [...(message.imageRefs || [])];

    for (let i = 0; i < urls.length; i += 1) {
      const existing = refs[i];
      if (existing?.path) {
        const abs = path.join(chatDir, existing.path.split("/").join(path.sep));
        if (await fs.promises.stat(abs).catch(() => null)) continue;
      }
      const ref = await writeImageRef(chatDir, sessionId, messageId, i, urls[i]);
      if (ref) {
        if (refs[i]) refs[i] = ref;
        else refs.push(ref);
      }
    }

    const verifiedRefs = await filterExistingImageRefs(chatDir, refs);
    out.push({
      ...message,
      imageDataUrls: undefined,
      imageRefs: verifiedRefs.length ? verifiedRefs : undefined,
      imageCount: verifiedRefs.length > 0 ? verifiedRefs.length : undefined,
    });
  }
  return out;
}

export async function externalizeSessionPayload(
  chatDir: string,
  sessionId: string,
  payload: { messages?: ChatMessageLike[]; [key: string]: unknown },
): Promise<{ messages?: ChatMessageLike[]; [key: string]: unknown }> {
  if (!Array.isArray(payload.messages)) return payload;
  return {
    ...payload,
    messages: await externalizeMessageImages(chatDir, sessionId, payload.messages),
  };
}

export function findRecentUserImageRefs(messages: ChatMessageLike[]): PersistedImageRef[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (m.imageRefs?.length) return [...m.imageRefs];
    break;
  }
  return [];
}
