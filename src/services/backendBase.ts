const BACKEND_BASE = (import.meta.env.VITE_BACKEND_URL || "").replace(/\/$/, "");

/** 桌面版走绝对 URL；Web 开发走 Vite 代理的相对路径。 */
export function backendUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return BACKEND_BASE ? `${BACKEND_BASE}${normalized}` : normalized;
}

export function getBackendBase(): string {
  return BACKEND_BASE;
}
