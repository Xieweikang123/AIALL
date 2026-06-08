const MAX_AGENT_IMAGE_DIMENSION = 1600;
const MAX_AGENT_IMAGE_BYTES = 900_000;
const JPEG_QUALITY = 0.82;

function estimateDataUrlBytes(dataUrl: string): number {
  return dataUrl.length;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = dataUrl;
  });
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

/** Downscale screenshots before agent upload to avoid long POST stalls. */
export async function compressImageDataUrlForAgent(dataUrl: string): Promise<string> {
  if (typeof document === "undefined" || !dataUrl.startsWith("data:image/")) return dataUrl;
  if (estimateDataUrlBytes(dataUrl) <= MAX_AGENT_IMAGE_BYTES) return dataUrl;

  try {
    const img = await loadImage(dataUrl);
    const scale = Math.min(
      1,
      MAX_AGENT_IMAGE_DIMENSION / Math.max(img.naturalWidth || img.width, 1),
      MAX_AGENT_IMAGE_DIMENSION / Math.max(img.naturalHeight || img.height, 1),
    );
    const width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, width, height);

    let quality = JPEG_QUALITY;
    let compressed = await canvasToJpegBlob(canvas, quality);
    if (!compressed) return dataUrl;

    while (compressed.size > MAX_AGENT_IMAGE_BYTES && quality > 0.45) {
      quality -= 0.08;
      compressed = (await canvasToJpegBlob(canvas, quality)) || compressed;
    }

    const out = await blobToDataUrl(compressed);
    return out.startsWith("data:image/") ? out : dataUrl;
  } catch {
    return dataUrl;
  }
}

export async function compressImageDataUrlsForAgent(urls: string[]): Promise<string[]> {
  if (!urls.length) return [];
  const out: string[] = [];
  for (const url of urls) {
    out.push(await compressImageDataUrlForAgent(url));
  }
  return out;
}
