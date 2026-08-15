import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authFetch,
  fetchServerAiConfig,
  getAuthHeaders,
  getServerSessionToken,
  installServerAuthFetch,
  isServerLoggedIn,
  serverLogin,
  serverLogout,
  type ServerSession,
} from "./serverAuth";

const SESSION_KEY = "aiall-server-session";

function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((k: string) => store.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void store.set(k, v)),
    removeItem: vi.fn((k: string) => void store.delete(k)),
    clear: vi.fn(() => store.clear()),
  };
}

let storage: ReturnType<typeof makeLocalStorage>;

function seedSession(session: ServerSession) {
  storage.setItem(SESSION_KEY, JSON.stringify(session));
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  storage = makeLocalStorage();
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("session 存储", () => {
  it("未登录时返回 null / 空头", () => {
    expect(isServerLoggedIn()).toBe(false);
    expect(getServerSessionToken()).toBeNull();
    expect(getAuthHeaders()).toEqual({});
  });

  it("读取已登录 session", () => {
    seedSession({ token: "tok-123", expiresAt: Date.now() + 60_000 });
    expect(isServerLoggedIn()).toBe(true);
    expect(getServerSessionToken()).toBe("tok-123");
    expect(getAuthHeaders()).toEqual({ Authorization: "Bearer tok-123" });
  });

  it("过期 session 被清除并视为未登录", () => {
    seedSession({ token: "tok-expired", expiresAt: Date.now() - 1000 });
    expect(isServerLoggedIn()).toBe(false);
    expect(getServerSessionToken()).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(SESSION_KEY);
  });

  it("损坏的 session JSON 视为未登录", () => {
    storage.setItem(SESSION_KEY, "{not json");
    expect(isServerLoggedIn()).toBe(false);
  });

  it("缺少 token 的 session 视为未登录", () => {
    seedSession({ token: "", expiresAt: Date.now() + 60_000 });
    expect(isServerLoggedIn()).toBe(false);
  });
});

describe("serverLogin", () => {
  it("成功登录写入 session", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: true, token: "sess-abc", expiresAt: Date.now() + 60_000 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await serverLogin("secret");
    expect(result).toEqual({ ok: true });
    expect(getServerSessionToken()).toBe("sess-abc");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/api/server/login");
    expect(JSON.parse(String(init.body))).toEqual({ password: "secret" });
  });

  it("无 expiresAt 时使用默认 12h", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true, token: "sess" })));
    const before = Date.now();
    await serverLogin("secret");
    const raw = storage.getItem(SESSION_KEY);
    const parsed = raw ? (JSON.parse(raw) as ServerSession) : null;
    expect(parsed?.expiresAt).toBeGreaterThan(before + 11.9 * 3600 * 1000);
  });

  it("密码错误返回错误且不写 session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: false, error: "invalid credentials" }, 401)));
    const result = await serverLogin("wrong");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid credentials");
    expect(isServerLoggedIn()).toBe(false);
  });

  it("非 JSON 响应时返回错误", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad gateway", { status: 502 })));
    const result = await serverLogin("secret");
    expect(result.ok).toBe(false);
  });

  it("网络异常返回错误", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const result = await serverLogin("secret");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Failed to fetch");
  });
});

describe("serverLogout", () => {
  it("登出时调用服务端并清除本地 session", async () => {
    seedSession({ token: "sess-abc", expiresAt: Date.now() + 60_000 });
    const fetchMock = vi.fn().mockResolvedValue(new Response("logged out"));
    vi.stubGlobal("fetch", fetchMock);

    await serverLogout();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/api/server/logout");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sess-abc");
    expect(getServerSessionToken()).toBeNull();
  });

  it("未登录时静默跳过服务端调用", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await serverLogout();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("服务端异常不阻塞本地登出", async () => {
    seedSession({ token: "sess", expiresAt: Date.now() + 60_000 });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    await expect(serverLogout()).resolves.toBeUndefined();
    expect(getServerSessionToken()).toBeNull();
  });
});

describe("authFetch", () => {
  it("自动附加 Authorization 头且不覆盖用户已设的头", async () => {
    seedSession({ token: "tok", expiresAt: Date.now() + 60_000 });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const customHeaders = new Headers({ "X-Custom": "1" });
    await authFetch("/backend/vibe/list", { headers: customHeaders });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer tok");
    expect(headers.get("X-Custom")).toBe("1");
  });

  it("401 且已登录时标记 unauthorized", async () => {
    seedSession({ token: "tok", expiresAt: Date.now() + 60_000 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "expired" }, 401)));
    const { response, unauthorized } = await authFetch("/backend/vibe/list");
    expect(response.status).toBe(401);
    expect(unauthorized).toBe(true);
  });

  it("401 但未登录时不标记 unauthorized", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "no" }, 401)));
    const { unauthorized } = await authFetch("/backend/vibe/list");
    expect(unauthorized).toBe(false);
  });
});

describe("installServerAuthFetch", () => {
  it("web 模式为 /backend/* 与 /api/* 自动附加 Bearer 头", async () => {
    const originalFetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const windowLike = { fetch: originalFetch };
    vi.stubGlobal("window", windowLike);
    seedSession({ token: "tok", expiresAt: Date.now() + 60_000 });

    const uninstall = installServerAuthFetch();
    try {
      await (windowLike as unknown as { fetch: typeof fetch }).fetch("/backend/vibe/list");
      await (windowLike as unknown as { fetch: typeof fetch }).fetch("/api/server/ai-config");
    } finally {
      uninstall();
    }

    for (const call of originalFetch.mock.calls) {
      const [, init] = call as [string, RequestInit];
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
    }
  });

  it("非后端路径不附加认证头", async () => {
    const originalFetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const windowLike = { fetch: originalFetch };
    vi.stubGlobal("window", windowLike);
    seedSession({ token: "tok", expiresAt: Date.now() + 60_000 });

    const uninstall = installServerAuthFetch();
    try {
      await (windowLike as unknown as { fetch: typeof fetch }).fetch("https://api.example.com/data");
    } finally {
      uninstall();
    }

    const [, init] = originalFetch.mock.calls[0] as [string, RequestInit | undefined];
    expect(init?.headers).toBeUndefined();
  });

  it("卸载后透传原始 fetch（不再附加认证头）", async () => {
    const originalFetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const windowLike = { fetch: originalFetch };
    vi.stubGlobal("window", windowLike);
    seedSession({ token: "tok", expiresAt: Date.now() + 60_000 });

    const uninstall = installServerAuthFetch();
    const installed = (windowLike as unknown as { fetch: typeof fetch }).fetch;
    expect(installed).not.toBe(originalFetch);

    uninstall();
    const restored = (windowLike as unknown as { fetch: typeof fetch }).fetch;
    expect(restored).not.toBe(installed);

    await restored("/backend/vibe/list");
    const [, init] = originalFetch.mock.calls[0] as [string, RequestInit | undefined];
    expect(init?.headers).toBeUndefined();
  });

  it("重复安装幂等（第二次安装直接返回空卸载函数）", () => {
    const originalFetch = vi.fn();
    const windowLike = { fetch: originalFetch };
    vi.stubGlobal("window", windowLike);

    const uninstall1 = installServerAuthFetch();
    const wrapped = (windowLike as unknown as { fetch: typeof fetch }).fetch;
    expect(wrapped).not.toBe(originalFetch);

    const uninstall2 = installServerAuthFetch();
    expect((windowLike as unknown as { fetch: typeof fetch }).fetch).toBe(wrapped);

    uninstall1();
    uninstall2();
    const restored = (windowLike as unknown as { fetch: typeof fetch }).fetch;
    expect(restored).not.toBe(wrapped);
  });
});

describe("fetchServerAiConfig", () => {
  it("成功返回服务端配置", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          ok: true,
          endpoint: "https://ai.example/v1",
          model: "gpt-4o",
          webProxyUrl: "http://proxy:8080",
          hasServerKey: true,
        }),
      ),
    );
    const config = await fetchServerAiConfig();
    expect(config.ok).toBe(true);
    expect(config.endpoint).toBe("https://ai.example/v1");
    expect(config.model).toBe("gpt-4o");
    expect(config.hasServerKey).toBe(true);
    expect(config.webProxyUrl).toBe("http://proxy:8080");
  });

  it("ok:false 返回错误", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: false, error: "boom" }, 502)));
    const config = await fetchServerAiConfig();
    expect(config.ok).toBe(false);
    expect(config.error).toBe("boom");
  });

  it("401 且已登录时提示会话过期", async () => {
    seedSession({ token: "tok", expiresAt: Date.now() + 60_000 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "expired" }, 401)));
    const config = await fetchServerAiConfig();
    expect(config.ok).toBe(false);
    expect(config.error).toContain("未登录");
  });

  it("网络异常返回错误", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const config = await fetchServerAiConfig();
    expect(config.ok).toBe(false);
    expect(config.error).toBeTruthy();
  });
});
