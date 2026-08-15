/**
 * 服务器模式认证客户端（web / agent-server）。
 *
 * 任务 C：浏览器不持有 / 不下发 AI key；对 agent-server 的请求需带登录 session token。
 * 桌面（Tauri）环境不经过这里（走 native Channel invoke，无需 HTTP 认证）。
 */

import { backendUrl } from "./backendBase";

const SESSION_KEY = "aiall-server-session";

export interface ServerSession {
  token: string;
  expiresAt: number;
}

export interface ServerAiConfigInfo {
  ok: boolean;
  endpoint: string;
  model: string;
  webProxyUrl: string;
  hasServerKey: boolean;
  /** 401 等认证失败时的错误说明 */
  error?: string;
}

function readSession(): ServerSession | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ServerSession;
    if (!parsed || typeof parsed.token !== "string" || !parsed.token) return null;
    if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSession(session: ServerSession | null) {
  if (typeof localStorage === "undefined") return;
  if (session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}

/** 是否已登录（有未过期的 session token）。 */
export function isServerLoggedIn(): boolean {
  return readSession() !== null;
}

/** 当前 session token（未登录返回 null）。 */
export function getServerSessionToken(): string | null {
  return readSession()?.token ?? null;
}

/** 认证请求头；未登录返回空对象。 */
export function getAuthHeaders(): Record<string, string> {
  const token = getServerSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 用服务器 token（密码）登录，换取 session token。 */
export async function serverLogin(password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const resp = await fetch(backendUrl("/api/server/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const text = await resp.text();
    let parsed: { ok?: boolean; token?: string; expiresAt?: number; error?: string };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      return { ok: false, error: text || `登录失败，HTTP ${resp.status}` };
    }
    if (!resp.ok || !parsed.ok || !parsed.token) {
      return { ok: false, error: parsed.error || `登录失败，HTTP ${resp.status}` };
    }
    writeSession({
      token: parsed.token,
      expiresAt: parsed.expiresAt ?? Date.now() + 12 * 3600 * 1000,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "网络错误" };
  }
}

/** 登出：吊销服务端 session 并清除本地 token。 */
export async function serverLogout(): Promise<void> {
  const token = getServerSessionToken();
  try {
    if (token) {
      await fetch(backendUrl("/api/server/logout"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  } catch {
    // 静默：本地清除为主
  }
  writeSession(null);
}

/**
 * 带认证的 fetch 封装：自动附加 `Authorization` 头。
 * 若响应 401 且本地有 session，返回 `{ unauthorized: true }` 供调用方触发登录提示。
 */
export async function authFetch(
  url: string,
  init: RequestInit = {},
): Promise<{ response: Response; unauthorized: boolean }> {
  const headers = new Headers(init.headers || {});
  const auth = getAuthHeaders();
  for (const [k, v] of Object.entries(auth)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  const response = await fetch(url, { ...init, headers });
  return {
    response,
    unauthorized: response.status === 401 && isServerLoggedIn(),
  };
}

/**
 * 全局 fetch 包装：web 模式下对所有指向本服务后端（/backend/*、/api/*）的请求
 * 自动附加 `Authorization: Bearer <session>` 头。桌面版不启用。
 *
 * 幂等安装，可重复调用。返回卸载函数（测试用）。
 */
export function installServerAuthFetch(): () => void {
  if (typeof window === "undefined" || !window.fetch) return () => {};
  const original = window.fetch.bind(window);
  // 防止重复安装
  if ((window as unknown as { __aiallAuthFetchInstalled?: boolean }).__aiallAuthFetchInstalled) {
    return () => {};
  }
  (window as unknown as { __aiallAuthFetchInstalled?: boolean }).__aiallAuthFetchInstalled = true;

  const wrapped: typeof fetch = (input, init) => {
    try {
      let url = "";
      if (typeof input === "string") url = input;
      else if (input instanceof URL) url = input.toString();
      else if (input instanceof Request) url = input.url;
      if (!url) return original(input, init);

      let path = "";
      try {
        path = new URL(url).pathname;
      } catch {
        path = url.split("?")[0];
      }
      const isBackend = path.startsWith("/backend/") || path.startsWith("/api/");
      if (isBackend) {
        const token = getServerSessionToken();
        if (token) {
          const headers = new Headers(init?.headers || {});
          if (!headers.has("Authorization")) {
            headers.set("Authorization", `Bearer ${token}`);
            return original(input, { ...(init || {}), headers });
          }
        }
      }
    } catch {
      // 包装失败不影响原始请求
    }
    return original(input, init);
  };

  window.fetch = wrapped;
  return () => {
    window.fetch = original;
    (window as unknown as { __aiallAuthFetchInstalled?: boolean }).__aiallAuthFetchInstalled = false;
  };
}

/** 获取服务端 AI 配置（不含 key），供 AI 配置页在 web 模式展示。 */
export async function fetchServerAiConfig(): Promise<ServerAiConfigInfo> {
  try {
    const { response, unauthorized } = await authFetch(backendUrl("/api/server/ai-config"));
    const text = await response.text();
    let parsed: Partial<ServerAiConfigInfo>;
    try {
      parsed = JSON.parse(text) as ServerAiConfigInfo;
    } catch {
      parsed = {};
    }
    if (!response.ok || parsed.ok === false) {
      return {
        ok: false,
        endpoint: "",
        model: "",
        webProxyUrl: "",
        hasServerKey: false,
        error: unauthorized
          ? "未登录或会话已过期"
          : parsed.error || `获取服务端 AI 配置失败，HTTP ${response.status}`,
      };
    }
    return {
      ok: true,
      endpoint: parsed.endpoint || "",
      model: parsed.model || "",
      webProxyUrl: parsed.webProxyUrl || "",
      hasServerKey: !!parsed.hasServerKey,
    };
  } catch (error) {
    return {
      ok: false,
      endpoint: "",
      model: "",
      webProxyUrl: "",
      hasServerKey: false,
      error: error instanceof Error ? error.message : "网络错误",
    };
  }
}
