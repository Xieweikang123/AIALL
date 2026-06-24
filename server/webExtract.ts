import type { IncomingMessage, ServerResponse } from "node:http";
import dns from "node:dns";
import { ProxyAgent } from "undici";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { readJsonBody, sendJson, sendSseEvent, sendSseHeaders } from "./httpUtils";

try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  // Node 版本不支持时忽略即可。
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal } as RequestInit);
  } finally {
    clearTimeout(timer);
  }
}

interface WebExtractRequestBody {
  url: string;
  mode?: "auto" | "discourse_latest" | "html" | "browser";
  limit?: number;
  proxyUrl?: string;
  stream?: boolean;
}

function stripHtmlToText(html: string): string {
  const noScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  const text = noScript
    .replace(/<\/(p|div|br|li|h1|h2|h3|h4|h5|h6)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return text;
}

function safeUrl(input: string): URL | null {
  try {
    const url = new URL(String(input || "").trim());
    if (!/^https?:$/.test(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

function safeProxyUrl(input: string | undefined): string {
  const raw = String(input || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

const proxyAgentCache = new Map<string, ProxyAgent>();

const SHARED_HEADLESS_IDLE_MS = 5 * 60_000;
let sharedHeadlessBrowser: Browser | null = null;
let sharedHeadlessLaunch: Promise<Browser> | null = null;
let sharedHeadlessIdleTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSharedHeadlessIdleClose() {
  if (sharedHeadlessIdleTimer) clearTimeout(sharedHeadlessIdleTimer);
  sharedHeadlessIdleTimer = setTimeout(() => {
    sharedHeadlessIdleTimer = null;
    void closeSharedHeadlessBrowser();
  }, SHARED_HEADLESS_IDLE_MS);
}

async function closeSharedHeadlessBrowser() {
  const browser = sharedHeadlessBrowser;
  sharedHeadlessBrowser = null;
  sharedHeadlessLaunch = null;
  if (!browser) return;
  try {
    await browser.close();
  } catch {
    // ignore
  }
}

async function acquireSharedHeadlessBrowser(): Promise<Browser> {
  if (sharedHeadlessIdleTimer) {
    clearTimeout(sharedHeadlessIdleTimer);
    sharedHeadlessIdleTimer = null;
  }
  if (sharedHeadlessBrowser?.isConnected()) return sharedHeadlessBrowser;

  sharedHeadlessBrowser = null;
  if (!sharedHeadlessLaunch) {
    sharedHeadlessLaunch = chromium.launch({ headless: true });
  }
  const browser = await sharedHeadlessLaunch;
  sharedHeadlessLaunch = null;
  if (!browser.isConnected()) {
    return acquireSharedHeadlessBrowser();
  }
  sharedHeadlessBrowser = browser;
  browser.on("disconnected", () => {
    if (sharedHeadlessBrowser === browser) sharedHeadlessBrowser = null;
  });
  return browser;
}

function releaseSharedHeadlessBrowser() {
  if (sharedHeadlessBrowser?.isConnected()) {
    scheduleSharedHeadlessIdleClose();
  }
}

async function closePlaywrightContext(context: BrowserContext | undefined) {
  if (!context) return;
  try {
    await context.close();
  } catch {
    // ignore
  }
}

function looksLikeCloudflareChallenge(html: string): boolean {
  const sample = html.slice(0, 120_000).toLowerCase();
  if (sample.includes("just a moment")) return true;
  if (sample.includes("cf-browser-verification")) return true;
  if (sample.includes("/cdn-cgi/challenge")) return true;
  if (sample.includes("challenge-platform")) return true;
  if (sample.includes("checking your browser")) return true;
  return false;
}

function buildPlaywrightProxy(
  proxyUrl: string,
): { server: string; username?: string; password?: string } | undefined {
  if (!proxyUrl) return undefined;
  try {
    const u = new URL(proxyUrl);
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    const server = `${u.protocol}//${u.hostname}:${port}`;
    const username = u.username ? decodeURIComponent(u.username) : undefined;
    const password = u.password ? decodeURIComponent(u.password) : undefined;
    const out: { server: string; username?: string; password?: string } = { server };
    if (username) out.username = username;
    if (password) out.password = password;
    return out;
  } catch {
    return undefined;
  }
}

async function extractWithPlaywright(
  targetUrl: string,
  proxyUrl: string,
  timeoutMs: number,
  onProgress?: (message: string) => void,
): Promise<
  | { ok: true; title: string; text: string }
  | { ok: false; status: number; error: string; rawText?: string }
> {
  const p = (message: string) => {
    try {
      onProgress?.(message);
    } catch {
      // ignore
    }
  };

  let context: BrowserContext | undefined;
  try {
    p("Playwright：正在连接 Chromium…");
    const browser = await acquireSharedHeadlessBrowser();
    const proxy = buildPlaywrightProxy(proxyUrl);
    p(proxy ? "Playwright：已启用代理，正在创建浏览器上下文…" : "Playwright：正在创建浏览器上下文…");
    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      locale: "zh-CN",
      ...(proxy ? { proxy } : {}),
    });
    const page = await context.newPage();
    const navTimeout = Math.max(15_000, Math.min(timeoutMs, 90_000));
    p(`Playwright：正在打开页面（最长等待约 ${Math.round(navTimeout / 1000)} 秒）…`);
    const response = await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: navTimeout,
    });
    const status = response?.status() ?? 0;
    p(`Playwright：首包已返回（HTTP ${status}），等待网络空闲…`);
    await page.waitForLoadState("networkidle", { timeout: Math.min(20_000, navTimeout) }).catch(() => {
      p("Playwright：网络空闲等待超时，继续提取正文…");
    });

    const title = (await page.title()) || "";
    const rawHtml = await page.content();

    if (status >= 400) {
      return { ok: false, status, error: `Playwright 抓取失败，HTTP ${status}`, rawText: rawHtml.slice(0, 8_000) };
    }

    p("Playwright：正在从 DOM 提取正文…");
    const textFromDom = await page.evaluate(() => {
      const el =
        document.querySelector("article") ||
        document.querySelector('[role="main"]') ||
        document.querySelector("main") ||
        document.body;
      return (el?.textContent || "").replace(/\s+\n/g, "\n").trim();
    });
    let finalText = (textFromDom || stripHtmlToText(rawHtml)).trim();

    if (looksLikeCloudflareChallenge(rawHtml) && finalText.length < 300) {
      return {
        ok: false,
        status: 403,
        error:
          "页面疑似 Cloudflare 等验证页，未能取得有效正文（可配置网页抓取代理或改用 RSS/官方 API）",
        rawText: rawHtml.slice(0, 8_000),
      };
    }

    finalText = finalText.slice(0, 120_000);
    return { ok: true, title, text: finalText };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Executable doesn't exist|browserType\.launch|Could not find browser/i.test(msg)) {
      return {
        ok: false,
        status: 500,
        error: "未检测到 Chromium，请在项目根目录执行：npx playwright install chromium",
      };
    }
    return { ok: false, status: 500, error: `Playwright 异常：${msg}` };
  } finally {
    await closePlaywrightContext(context);
    releaseSharedHeadlessBrowser();
  }
}

async function screenshotPageWithPlaywright(
  targetUrl: string,
  proxyUrl: string,
  options: {
    headed: boolean;
    waitAfterGotoMs: number;
    navigationTimeoutMs: number;
  },
): Promise<
  | { ok: true; mime: string; base64: string; byteLength: number }
  | { ok: false; error: string }
> {
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let ownsBrowser = false;
  try {
    if (options.headed) {
      browser = await chromium.launch({
        headless: false,
        slowMo: 40,
      });
      ownsBrowser = true;
    } else {
      browser = await acquireSharedHeadlessBrowser();
    }
    const proxy = buildPlaywrightProxy(proxyUrl);
    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      locale: "zh-CN",
      viewport: { width: 1280, height: 800 },
      ...(proxy ? { proxy } : {}),
    });
    const page = await context.newPage();
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: options.navigationTimeoutMs,
    });

    if (options.waitAfterGotoMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, options.waitAfterGotoMs));
    } else {
      await page.waitForLoadState("networkidle", { timeout: Math.min(20_000, options.navigationTimeoutMs) }).catch(() => {});
    }

    const buf = await page.screenshot({ fullPage: true, type: "jpeg", quality: 78 });
    const b64 = buf.toString("base64");
    const maxB64Chars = 14 * 1024 * 1024;
    if (b64.length > maxB64Chars) {
      return {
        ok: false,
        error:
          "整页 JPEG 体积过大（Base64 超限）。请减小等待时间、换较短页面，或后续改用视口截图/压缩策略。",
      };
    }
    return { ok: true, mime: "image/jpeg", base64: b64, byteLength: buf.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Executable doesn't exist|browserType\.launch|Could not find browser/i.test(msg)) {
      return {
        ok: false,
        error: "未检测到 Chromium，请在项目根目录执行：npx playwright install chromium",
      };
    }
    return { ok: false, error: `截图异常：${msg}` };
  } finally {
    await closePlaywrightContext(context);
    if (ownsBrowser) {
      try {
        await browser?.close();
      } catch {
        // ignore
      }
    } else {
      releaseSharedHeadlessBrowser();
    }
  }
}

interface ScreenshotPageRequestBody {
  url: string;
  proxyUrl?: string;
  headed?: boolean;
  waitAfterGotoMs?: number;
  navigationTimeoutMs?: number;
}

type WebExtractRunPayload = Record<string, unknown>;

interface RunExtractOutcome {
  httpStatus: number;
  payload: WebExtractRunPayload;
}

export async function runWebExtract(body: WebExtractRequestBody, emit: (message: string) => void): Promise<RunExtractOutcome> {
  const safeEmit = (message: string) => {
    try {
      emit(message);
    } catch {
      // ignore
    }
  };

  const url = safeUrl(body.url);
  if (!url) {
    return { httpStatus: 400, payload: { error: "url 不合法，请提供完整 http/https URL" } };
  }

  const limit = Math.min(50, Math.max(1, Number(body.limit || 15)));
  const mode = body.mode || "auto";
  const proxyUrl = safeProxyUrl(body.proxyUrl);

  const origin = url.origin;
  const headers: HeadersInit = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
  };
  const timeoutMs = 25_000;
  const playwrightTimeoutMs = Math.max(timeoutMs, 45_000);
  const dispatcher = proxyUrl
    ? (proxyAgentCache.get(proxyUrl) ??
      (() => {
        const agent = new ProxyAgent(proxyUrl);
        proxyAgentCache.set(proxyUrl, agent);
        return agent;
      })())
    : undefined;

  const tryDiscourseLatest = async () => {
    const latestUrl = new URL("/latest.json", origin);
    latestUrl.searchParams.set("no_definitions", "true");
    const upstream = await fetchWithTimeout(
      latestUrl.toString(),
      { method: "GET", headers, ...(dispatcher ? ({ dispatcher } as RequestInit) : {}) },
      timeoutMs,
    );
    const rawText = await upstream.text();
    if (!upstream.ok) {
      return {
        ok: false as const,
        status: upstream.status,
        error: `拉取 latest.json 失败，HTTP ${upstream.status}`,
        rawText,
      };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      return { ok: false as const, status: 200, error: "latest.json 解析失败（非 JSON）", rawText };
    }

    const topicList = parsed?.topic_list as { topics?: Array<Record<string, unknown>> } | undefined;
    const topics = topicList?.topics || [];
    if (!Array.isArray(topics) || !topics.length) {
      return { ok: false as const, status: 200, error: "latest.json 未找到 topics 列表", rawText };
    }

    const lines: string[] = [];
    lines.push(`站点：${origin}`);
    lines.push(`来源：Discourse latest.json`);
    lines.push(`抓取时间：${new Date().toISOString()}`);
    lines.push("");
    lines.push("最近主题：");
    for (const item of topics.slice(0, limit)) {
      const id = item?.id ? String(item.id) : "";
      const slug = item?.slug ? String(item.slug) : "";
      const title = item?.title ? String(item.title) : "（无标题）";
      const createdAt = item?.created_at ? String(item.created_at) : "";
      const lastPostedAt = item?.last_posted_at ? String(item.last_posted_at) : "";
      const topicUrl = id && slug ? `${origin}/t/${slug}/${id}` : "";
      lines.push(`- ${title}`);
      if (topicUrl) lines.push(`  链接：${topicUrl}`);
      if (createdAt) lines.push(`  创建：${createdAt}`);
      if (lastPostedAt) lines.push(`  最新回复：${lastPostedAt}`);
    }

    return {
      ok: true as const,
      status: 200,
      kind: "discourse_latest" as const,
      title: parsed?.title ? String(parsed.title) : "",
      text: lines.join("\n"),
      rawText,
    };
  };

  try {
    if (mode === "browser") {
      safeEmit("模式「仅浏览器」：将使用 Playwright 打开页面（通常需 30～90 秒）…");
      const pw = await extractWithPlaywright(url.toString(), proxyUrl, playwrightTimeoutMs, safeEmit);
      if (pw.ok) {
        safeEmit("浏览器抓取成功，正在返回正文。");
        return {
          httpStatus: 200,
          payload: {
            ok: true,
            status: 200,
            kind: "browser",
            title: pw.title,
            text: pw.text,
          },
        };
      }
      safeEmit(`浏览器抓取结束（失败）：${pw.error}`);
      const st = pw.status >= 400 && pw.status < 600 ? pw.status : 500;
      return {
        httpStatus: st,
        payload: { ok: false, status: pw.status, error: pw.error, rawText: pw.rawText },
      };
    }

    if (mode === "discourse_latest" || mode === "auto") {
      safeEmit("正在请求 Discourse 接口 GET /latest.json …");
      const discourse = await tryDiscourseLatest();
      if (discourse.ok) {
        safeEmit("已从 Discourse 获取最新主题列表。");
        return { httpStatus: 200, payload: discourse as unknown as WebExtractRunPayload };
      }
      safeEmit(`Discourse 不可用（${discourse.error || "未知原因"}）。`);
      if (mode === "discourse_latest") {
        safeEmit("当前为「仅 Discourse」模式，不再尝试其它方式。");
        return { httpStatus: 200, payload: discourse as unknown as WebExtractRunPayload };
      }
      safeEmit("将继续尝试直连页面 HTML。");
    }

    const tryPlaywrightFallback = mode === "auto" || mode === "html";

    safeEmit("正在直连下载页面（HTTP GET）…");
    const upstream = await fetchWithTimeout(
      url.toString(),
      { method: "GET", headers, ...(dispatcher ? ({ dispatcher } as RequestInit) : {}) },
      timeoutMs,
    );
    const rawText = await upstream.text();
    safeEmit(`直连完成：HTTP ${upstream.status}，响应约 ${rawText.length} 字符。`);

    if (!upstream.ok) {
      if (tryPlaywrightFallback && upstream.status === 403) {
        safeEmit("直连返回 403，改用 Playwright 模拟浏览器访问…");
        const pw = await extractWithPlaywright(url.toString(), proxyUrl, playwrightTimeoutMs, safeEmit);
        if (pw.ok) {
          safeEmit("Playwright 抓取成功。");
          return {
            httpStatus: 200,
            payload: {
              ok: true,
              status: 200,
              kind: "browser",
              title: pw.title,
              text: pw.text,
            },
          };
        }
        safeEmit(`Playwright 仍未成功：${pw.error}`);
        return {
          httpStatus: 403,
          payload: {
            ok: false,
            status: 403,
            error: `直连抓取 HTTP 403；Playwright：${pw.error}`,
            rawText: pw.rawText || rawText,
          },
        };
      }
      safeEmit(`直连失败（HTTP ${upstream.status}），结束。`);
      return {
        httpStatus: upstream.status,
        payload: {
          ok: false,
          status: upstream.status,
          error: `抓取失败，HTTP ${upstream.status}`,
          rawText,
        },
      };
    }

    if (tryPlaywrightFallback && looksLikeCloudflareChallenge(rawText)) {
      safeEmit("检测到可能是 Cloudflare / 验证页，改用 Playwright 重试…");
      const pw = await extractWithPlaywright(url.toString(), proxyUrl, playwrightTimeoutMs, safeEmit);
      if (pw.ok) {
        safeEmit("Playwright 抓取成功。");
        return {
          httpStatus: 200,
          payload: {
            ok: true,
            status: 200,
            kind: "browser",
            title: pw.title,
            text: pw.text,
          },
        };
      }
      safeEmit(`Playwright 未通过验证页：${pw.error}`);
      return {
        httpStatus: 200,
        payload: {
          ok: false,
          status: 403,
          error: `页面疑似验证/反爬；Playwright 未成功：${pw.error}`,
          rawText: pw.rawText || rawText.slice(0, 12_000),
        },
      };
    }

    safeEmit("正在将 HTML 转为纯文本…");
    const text = stripHtmlToText(rawText);
    safeEmit("抓取完成。");
    return {
      httpStatus: 200,
      payload: {
        ok: true,
        status: 200,
        kind: "html",
        title: "",
        text: text.slice(0, 120_000),
        rawHtml: rawText.slice(0, 500_000),
      },
    };
  } catch (error) {
    const baseMessage = error instanceof Error ? error.message : "抓取失败";
    const cause = (error as { cause?: unknown })?.cause;
    const causeMessage =
      cause instanceof Error ? cause.message : typeof cause === "string" ? cause : cause ? JSON.stringify(cause) : "";
    return {
      httpStatus: 500,
      payload: {
        ok: false,
        status: 500,
        error: causeMessage ? `${baseMessage}\n原因：${causeMessage}` : baseMessage,
      },
    };
  }
}

export type { WebExtractRequestBody, RunExtractOutcome };

function buildSearchUrl(query: string, engine: string, limit: number): string {
  const encodedQuery = encodeURIComponent(query);
  switch (engine) {
    case "bing":
      return `https://cn.bing.com/search?q=${encodedQuery}&count=${limit}`;
    case "baidu":
      return `https://www.baidu.com/s?wd=${encodedQuery}&rn=${limit}`;
    case "duckduckgo":
      return `https://html.duckduckgo.com/html/?q=${encodedQuery}`;
    case "google":
    default:
      return `https://www.google.com/search?q=${encodedQuery}&num=${limit}`;
  }
}

const SEARCH_ENGINE_IDS = ["google", "bing", "baidu", "duckduckgo"] as const;
type SearchEngineId = (typeof SEARCH_ENGINE_IDS)[number];

function normalizeSearchEngine(engine: string): SearchEngineId {
  return SEARCH_ENGINE_IDS.includes(engine as SearchEngineId) ? (engine as SearchEngineId) : "baidu";
}

function searchEngineFallbacks(primary: SearchEngineId): SearchEngineId[] {
  const chain: SearchEngineId[] = ["duckduckgo", "bing", "baidu", "google"];
  return chain.filter((e) => e !== primary);
}

function resolveRedirectSearchUrl(rawUrl: string): string {
  let url = rawUrl.replace(/&amp;/g, "&").trim();
  if (url.startsWith("//")) url = `https:${url}`;
  try {
    const parsed = new URL(url);
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    const googleQ = parsed.searchParams.get("q");
    if (parsed.pathname === "/url" && googleQ) return decodeURIComponent(googleQ);
  } catch {
    // keep original url
  }
  return url;
}

function stripInlineHtml(text: string): string {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function parseGoogleResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const divPattern = /<div class="[^"]*"[^>]*>[\s\S]*?<a href="\/url\?q=([^&"]+)[^"]*"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/gi;
  let match;
  while ((match = divPattern.exec(html)) !== null && results.length < 10) {
    const url = decodeURIComponent(match[1]);
    const title = match[2].replace(/<[^>]+>/g, "").trim();
    const snippet = match[3].replace(/<[^>]+>/g, "").trim();
    if (url && title && !url.includes("google.com")) {
      results.push({ title, url, snippet });
    }
  }
  return results;
}

function parseBingResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  const addResult = (rawUrl: string, rawTitle: string, rawSnippet = "") => {
    const url = resolveRedirectSearchUrl(rawUrl);
    const title = stripInlineHtml(rawTitle);
    const snippet = stripInlineHtml(rawSnippet);
    if (!url || !title || seen.has(url)) return;
    if (/^(javascript:|#|mailto:)/i.test(url)) return;
    seen.add(url);
    results.push({ title, url, snippet });
  };

  let match: RegExpExecArray | null;

  const modernPattern =
    /<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<div class="b_caption"[^>]*>\s*<p[^>]*>([\s\S]*?)<\/p>)?/gi;
  while ((match = modernPattern.exec(html)) !== null && results.length < 10) {
    addResult(match[1], match[2], match[3] || "");
  }

  if (results.length === 0) {
    const legacyPattern =
      /<li class="b_algo"[\s\S]*?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/gi;
    while ((match = legacyPattern.exec(html)) !== null && results.length < 10) {
      addResult(match[1], match[2], match[3]);
    }
  }

  return results;
}

function parseDuckDuckGoResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const blockPattern =
    /class="result[^"]*"[\s\S]*?<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/gi;
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(html)) !== null && results.length < 10) {
    const url = resolveRedirectSearchUrl(match[1]);
    const title = stripInlineHtml(match[2]);
    const snippet = stripInlineHtml(match[3] || "");
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    results.push({ title, url, snippet });
  }
  return results;
}

function looksLikeBaiduCsrShell(html: string): boolean {
  if (!html || html.length < 50_000) return false;
  const hasContentLeft = /<div[^>]+id="content_left"/i.test(html);
  const hasResultLinks = /\/link\?url=|data-landurl=|"mu"\s*:/i.test(html);
  return !hasContentLeft && !hasResultLinks;
}

function parseBaiduResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  const addResult = (rawUrl: string, rawTitle: string, snippet = "") => {
    let url = resolveRedirectSearchUrl(rawUrl);
    const title = stripInlineHtml(rawTitle);
    if (!url || !title || title.length < 2) return;
    if (seen.has(url)) return;
    if (/^(javascript:|#|mailto:)/i.test(url)) return;
    if (/baidu\.com/i.test(url) && !url.includes("/link?") && !url.includes("baike.baidu.com")) return;
    seen.add(url);
    results.push({
      url,
      title,
      snippet: stripInlineHtml(snippet),
    });
  };

  let match: RegExpExecArray | null;

  const linkPattern =
    /<a[^>]+href="(https?:\/\/(?:www\.)?baidu\.com\/link\?url=[^"]+)"[^>]*(?:title="([^"]*)")?[^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = linkPattern.exec(html)) !== null && results.length < 10) {
    addResult(match[1], match[2] || match[3]);
  }

  const moleculePattern =
    /class="[^"]*result-molecule[^"]*"[\s\S]{0,4000}?<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = moleculePattern.exec(html)) !== null && results.length < 10) {
    addResult(match[1], match[2]);
  }

  const landUrlPattern = /data-landurl="(https?:\/\/[^"]+)"/gi;
  while ((match = landUrlPattern.exec(html)) !== null && results.length < 10) {
    addResult(match[1], "链接");
  }

  const muPattern = /"mu"\s*:\s*"(https?:\\\/\\\/[^"]+)"/gi;
  while ((match = muPattern.exec(html)) !== null && results.length < 10) {
    try {
      const decoded = JSON.parse(`"${match[1]}"`) as string;
      addResult(decoded, "搜索结果");
    } catch {
      addResult(match[1].replace(/\\\//g, "/"), "搜索结果");
    }
  }

  if (results.length === 0) {
    const divPattern =
      /<div class="result[^"]*"[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<span class="content-right_[^"]*">([\s\S]*?)<\/span>/gi;
    while ((match = divPattern.exec(html)) !== null && results.length < 10) {
      addResult(match[1], match[2], match[3]);
    }
  }

  if (results.length === 0) {
    const simplePattern = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/gi;
    while ((match = simplePattern.exec(html)) !== null && results.length < 10) {
      addResult(match[1], match[2]);
    }
  }

  return results;
}

function parseSearchResults(html: string, engine: string): SearchResult[] {
  switch (engine) {
    case "bing":
      return parseBingResults(html);
    case "baidu":
      return parseBaiduResults(html);
    case "duckduckgo":
      return parseDuckDuckGoResults(html);
    case "google":
    default:
      return parseGoogleResults(html);
  }
}

function searchParseFailureMessage(engine: string, rawLen: number, strippedLen: number): string {
  if (rawLen === 0) return "搜索页面为空，请检查网络或代理配置";
  if (strippedLen > 0 && rawLen > strippedLen * 2) {
    return `未能从 ${engine} 搜索结果页解析出条目（页面约 ${rawLen} 字符，可能页面结构已变更）`;
  }
  return `未能从 ${engine} 搜索结果页解析出条目，请稍后重试或换用 web_extract 指定 URL`;
}

export async function runWebSearch(
  query: string,
  engine: string = "baidu",
  maxResults: number = 5,
  proxyUrl?: string,
): Promise<{ ok: boolean; text?: string; error?: string }> {
  const primaryEngine = normalizeSearchEngine(engine);
  const limit = Math.min(10, Math.max(1, maxResults));
  const safeProxy = safeProxyUrl(proxyUrl);
  const enginesToTry = [primaryEngine, ...searchEngineFallbacks(primaryEngine)];

  let lastError = "";

  for (const currentEngine of enginesToTry) {
    const searchUrl = buildSearchUrl(query, currentEngine, limit);

    try {
      const outcome = await runWebExtract(
        { url: searchUrl, mode: "auto", proxyUrl: safeProxy || undefined },
        () => {},
      );
      if (!outcome.payload.ok) {
        lastError = String(outcome.payload.error || "搜索失败");
        continue;
      }

      const rawHtml = String((outcome.payload as { rawHtml?: string }).rawHtml ?? "");
      const stripped = String(outcome.payload.text || "");
      const parseSource = rawHtml || stripped;
      const resultsFromRaw = rawHtml ? parseSearchResults(rawHtml, currentEngine) : [];
      const resultsFromStripped = stripped ? parseSearchResults(stripped, currentEngine) : [];
      const results =
        resultsFromRaw.length > 0 ? resultsFromRaw : parseSearchResults(parseSource, currentEngine);
      const baiduCsrShell = currentEngine === "baidu" && looksLikeBaiduCsrShell(rawHtml);

      if (results.length === 0) {
        lastError = searchParseFailureMessage(
          currentEngine,
          rawHtml.length || stripped.length,
          stripped.length,
        );
        if (baiduCsrShell) {
          lastError = "百度搜索结果页为前端渲染，静态抓取无条目，正在尝试其它搜索引擎…";
        }
        continue;
      }

      const engineNote =
        currentEngine !== primaryEngine ? `（${primaryEngine} 无结果，已通过 ${currentEngine} 获取）` : "";
      const lines = [`搜索结果：关键词 "${query}"${engineNote}`, ""];
      results.slice(0, limit).forEach((r, i) => {
        lines.push(`${i + 1}. ${r.title}`);
        lines.push(`   链接：${r.url}`);
        if (r.snippet) {
          lines.push(`   摘要：${r.snippet}`);
        }
        lines.push("");
      });

      return { ok: true, text: lines.join("\n") };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      lastError = `搜索异常：${msg}`;
    }
  }

  return { ok: false, error: lastError || "所有搜索引擎均未返回可用结果" };
}

type ConnectApp = {
  use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void;
};

export function registerWebRoutes(middlewares: ConnectApp) {
  middlewares.use("/backend/web/extract", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    let body: WebExtractRequestBody;
    try {
      body = (await readJsonBody(req)) as WebExtractRequestBody;
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "解析请求体失败" });
      return;
    }

    if (body.stream) {
      sendSseHeaders(res);
      const emit = (message: string) => {
        try {
          sendSseEvent(res, "progress", { message, at: Date.now() });
        } catch {
          // 客户端已断开
        }
      };
      try {
        const outcome = await runWebExtract(body, emit);
        sendSseEvent(res, "result", { httpStatus: outcome.httpStatus, body: outcome.payload });
      } catch (error) {
        const baseMessage = error instanceof Error ? error.message : "抓取失败";
        sendSseEvent(res, "result", {
          httpStatus: 500,
          body: { ok: false, status: 500, error: baseMessage },
        });
      }
      res.end();
      return;
    }

    try {
      const outcome = await runWebExtract(body, () => {});
      sendJson(res, outcome.httpStatus, outcome.payload);
    } catch (error) {
      const baseMessage = error instanceof Error ? error.message : "抓取失败";
      const cause = (error as { cause?: unknown })?.cause;
      const causeMessage =
        cause instanceof Error ? cause.message : typeof cause === "string" ? cause : cause ? JSON.stringify(cause) : "";
      sendJson(res, 500, {
        ok: false,
        status: 500,
        error: causeMessage ? `${baseMessage}\n原因：${causeMessage}` : baseMessage,
      });
    }
  });

  middlewares.use("/backend/web/screenshot-page", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    let body: ScreenshotPageRequestBody;
    try {
      body = (await readJsonBody(req)) as ScreenshotPageRequestBody;
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "解析请求体失败" });
      return;
    }

    const url = safeUrl(body.url);
    if (!url) {
      sendJson(res, 400, { ok: false, error: "url 不合法，请提供完整 http/https URL" });
      return;
    }

    const proxyUrl = safeProxyUrl(body.proxyUrl);
    const headed = body.headed !== false;
    const waitAfterGotoMs = Math.min(300_000, Math.max(0, Number(body.waitAfterGotoMs || 0)));
    const navigationTimeoutMs = Math.min(180_000, Math.max(10_000, Number(body.navigationTimeoutMs || 90_000)));

    const shot = await screenshotPageWithPlaywright(url.toString(), proxyUrl, {
      headed,
      waitAfterGotoMs,
      navigationTimeoutMs,
    });

    if (!shot.ok) {
      sendJson(res, 500, { ok: false, error: shot.error });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      mime: shot.mime,
      base64: shot.base64,
      byteLength: shot.byteLength,
    });
  });
}
