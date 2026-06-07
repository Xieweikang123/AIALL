export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export function sanitizeImageDataUrls(urls?: string[]): string[] {
  if (!urls?.length) return [];
  return urls.filter((url) => typeof url === "string" && url.startsWith("data:image/"));
}

export function buildVisionUserContent(text: string, imageDataUrls?: string[]): string | ChatContentPart[] {
  const urls = sanitizeImageDataUrls(imageDataUrls);
  if (!urls.length) return text;

  const parts: ChatContentPart[] = [];
  const trimmed = text.trim();
  parts.push({ type: "text", text: trimmed || "请描述并分析附带的图片。" });
  for (const url of urls) {
    parts.push({ type: "image_url", image_url: { url } });
  }
  return parts;
}

export function contentDisplayText(content: string | ChatContentPart[] | null | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;

  const textParts = content.filter((part) => part.type === "text").map((part) => part.text);
  const imageCount = content.filter((part) => part.type === "image_url").length;
  const text = textParts.join("\n");
  if (imageCount > 0) {
    return text ? `${text}\n[附带 ${imageCount} 张图片]` : `[附带 ${imageCount} 张图片]`;
  }
  return text;
}

export function contentCharSize(content: string | ChatContentPart[] | null | undefined): number {
  if (!content) return 0;
  if (typeof content === "string") return content.length;
  return content.reduce((sum, part) => {
    if (part.type === "text") return sum + part.text.length;
    if (part.type === "image_url") return sum + part.image_url.url.length;
    return sum;
  }, 0);
}

export function isVisionUnsupportedError(error?: string): boolean {
  if (!error) return false;
  const haystack = error.toLowerCase();
  return /vision|image|multimodal|unsupported.*content|does not support.*image|invalid.*image_url/.test(haystack);
}
