function readBackendBaseEnv(): string {
  const fromVite =
    typeof import.meta !== "undefined" &&
    import.meta.env &&
    typeof import.meta.env.VITE_BACKEND_URL === "string"
      ? import.meta.env.VITE_BACKEND_URL
      : "";
  const fromNode =
    typeof process !== "undefined" && typeof process.env.VITE_BACKEND_URL === "string"
      ? process.env.VITE_BACKEND_URL
      : "";
  return (fromVite || fromNode).replace(/\/$/, "");
}

const BACKEND_BASE = readBackendBaseEnv();

/** 浏览器 UI 预览；后端能力需 Tauri 桌面版（npm run dev）。 */
export function backendUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return BACKEND_BASE ? `${BACKEND_BASE}${normalized}` : normalized;
}

export function getBackendBase(): string {
  return BACKEND_BASE;
}
