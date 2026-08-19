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

/** 用服务器账号密码登录，换取 session token。username 固定 admin，兼容旧版只传 password。 */
export async function serverLogin(
  password: string,
  username: string = "admin",
): Promise<{ ok: boolean; error?: string }> {
  try {
    const resp = await fetch(backendUrl("/api/server/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
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
    // 后端返回秒级时间戳（as_secs），前端用毫秒比较，需归一化
    let expiresAt = parsed.expiresAt ?? Date.now() + 12 * 3600 * 1000;
    if (expiresAt < 1e12) expiresAt *= 1000;
    writeSession({
      token: parsed.token,
      expiresAt,
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

/** 修改服务端登录密码（需已登录，username 固定 admin）。 */
export async function serverChangePassword(
  oldPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { response, unauthorized } = await authFetch(backendUrl("/api/server/change-password"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPassword, newPassword }),
    });
    const text = await response.text();
    let parsed: { ok?: boolean; error?: string };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      parsed = {};
    }
    if (!response.ok || parsed.ok === false) {
      return {
        ok: false,
        error: unauthorized
          ? "未登录或会话已过期"
          : parsed.error || `修改失败，HTTP ${response.status}`,
      };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "网络错误" };
  }
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
    let path = "";
    let isBackend = false;
    let isLogin = false;
    try {
      let url = "";
      if (typeof input === "string") url = input;
      else if (input instanceof URL) url = input.toString();
      else if (input instanceof Request) url = input.url;
      if (url) {
        try {
          path = new URL(url).pathname;
        } catch {
          path = url.split("?")[0];
        }
        isBackend = path.startsWith("/backend/") || path.startsWith("/api/");
        isLogin = path === "/api/server/login" || path === "/api/server/logout";
      }
    } catch {
      // 解析失败不影响请求
    }
    let doFetch: Promise<Response>;
    if (isBackend && !isLogin) {
      const token = getServerSessionToken();
      if (token) {
        const headers = new Headers(init?.headers || {});
        if (!headers.has("Authorization")) {
          headers.set("Authorization", `Bearer ${token}`);
          doFetch = original(input, { ...(init || {}), headers });
        } else {
          doFetch = original(input, init);
        }
      } else {
        doFetch = original(input, init);
      }
      // 后端 401 自动跳登录（页内接口 unauthorized 也能跳，不靠路由守卫）
      return doFetch.then((resp) => {
        if (resp.status === 401 && isBackend && !isLogin) {
          try {
            // token 过期或未登录，清理后跳登录
            if (resp.status === 401) localStorage.removeItem(SESSION_KEY);
            if (!window.location.hash.includes("#/login")) {
              const cur = window.location.hash.replace(/^#/, "") || "/";
              window.location.hash = `#/login?redirect=${encodeURIComponent(cur)}`;
            }
          } catch {}
        }
        return resp;
      });
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

/** 保存服务端 AI 配置（写服务端 `server-config.json`）。apiKey 留空表示保留现有 key。 */
export async function saveServerAiConfig(input: {
  endpoint: string;
  apiKey: string;
  model?: string;
  webProxyUrl?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const { response, unauthorized } = await authFetch(backendUrl("/api/server/ai-config"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: input.endpoint,
        apiKey: input.apiKey,
        model: input.model || "",
        webProxyUrl: input.webProxyUrl || "",
      }),
    });
    const text = await response.text();
    let parsed: { ok?: boolean; error?: string };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      parsed = {};
    }
    if (!response.ok || parsed.ok === false) {
      return {
        ok: false,
        error: unauthorized
          ? "未登录或会话已过期"
          : parsed.error || `保存服务端 AI 配置失败，HTTP ${response.status}`,
      };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "网络错误" };
  }
}

let serverBackendAvailable = false;

/** 浏览器 Web 模式下 agent-server 后端当前是否可达（探测结果的缓存）。 */
export function isServerBackendAvailable(): boolean {
  return serverBackendAvailable;
}

/** 后端探测结果：ok=可用且未强制认证；auth=可用但要求登录；unreachable=不可达。 */
export type ServerBackendProbe = "ok" | "auth" | "unreachable";

/**
 * 探测 agent-server 状态。
 *
 * 判定依据：请求 `/api/server/ai-config`（无认证），仅当响应是 JSON 时认为后端存在——
 * - 200 JSON → 可用且未配置 token（或默认放行）
 * - 401/403 JSON → 可用但配置了 token，需要登录
 * - 其它（HTML / 404 / 502 / 网络异常）→ 不可达
 */
export async function probeServerBackend(): Promise<ServerBackendProbe> {
  try {
    const resp = await fetch(backendUrl("/api/server/ai-config"), { method: "GET" });
    const ct = resp.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("application/json")) return "unreachable";
    if (resp.status === 401 || resp.status === 403) return "auth";
    return resp.ok ? "ok" : "unreachable";
  } catch {
    return "unreachable";
  }
}

let backendProbeCache: Promise<ServerBackendProbe> | null = null;

/** 全局共享的后端探测：同一 SPA 生命周期只探测一次，并同步更新后端可用标志。 */
export function getServerBackendProbe(): Promise<ServerBackendProbe> {
  if (!backendProbeCache) {
    backendProbeCache = probeServerBackend().then((r) => {
      serverBackendAvailable = r !== "unreachable";
      return r;
    });
  }
  return backendProbeCache;
}

/** 重置探活缓存并重新探测。 */
export async function resetServerBackendProbe(): Promise<ServerBackendProbe> {
  backendProbeCache = null;
  return getServerBackendProbe();
}
