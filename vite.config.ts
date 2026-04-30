import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import type { IncomingMessage, ServerResponse } from "node:http";
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import dns from "node:dns";
import { ProxyAgent } from "undici";
import { chromium } from "playwright";

interface ForwardRequestBody {
  endpoint: string;
  apiKey?: string;
  model?: string;
  messages?: Array<{ role: string; content: string }>;
  stream?: boolean;
  input?: string;
  voice?: string;
  format?: "mp3" | "wav" | "opus";
}

interface ClaudeRunRequestBody {
  prompt: string;
  cwd?: string;
  bare?: boolean;
  model?: string;
  maxTurns?: number;
  allowedTools?: string;
  permissionMode?: string;
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data) as unknown);
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function sendSseHeaders(res: ServerResponse) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // 避免某些代理/反向代理缓冲导致“看起来不实时”。
  res.setHeader("X-Accel-Buffering", "no");
}

function sendSseEvent(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function buildHeaders(apiKey?: string): HeadersInit {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

// 某些网络环境下 IPv6 优先会导致连接失败/等待过久，这里优先 IPv4。
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  // Node 版本不支持时忽略即可。
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal } as any);
  } finally {
    clearTimeout(timer);
  }
}

interface WebExtractRequestBody {
  url: string;
  mode?: "auto" | "discourse_latest" | "html" | "browser";
  limit?: number;
  proxyUrl?: string;
  /** 为 true 时使用 SSE 流式返回进度 + 最终结果（Content-Type: text/event-stream） */
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
    // 仅支持 http/https 代理（更通用；socks5 需要额外实现）
    if (!/^https?:$/.test(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

const proxyAgentCache = new Map<string, ProxyAgent>();

/** 粗略识别 Cloudflare / 挑战页 HTML（避免把验证页当正文） */
function looksLikeCloudflareChallenge(html: string): boolean {
  const sample = html.slice(0, 120_000).toLowerCase();
  if (sample.includes("just a moment")) return true;
  if (sample.includes("cf-browser-verification")) return true;
  if (sample.includes("/cdn-cgi/challenge")) return true;
  if (sample.includes("challenge-platform")) return true;
  if (sample.includes("checking your browser")) return true;
  return false;
}

/** 将 http(s) 代理 URL 转为 Playwright context.proxy */
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

  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    p("Playwright：正在启动 Chromium…");
    browser = await chromium.launch({ headless: true });
    const proxy = buildPlaywrightProxy(proxyUrl);
    p(proxy ? "Playwright：已启用代理，正在创建浏览器上下文…" : "Playwright：正在创建浏览器上下文…");
    const context = await browser.newContext({
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
    try {
      await browser?.close();
    } catch {
      // ignore
    }
  }
}

type WebExtractRunPayload = Record<string, unknown>;

interface RunExtractOutcome {
  httpStatus: number;
  payload: WebExtractRunPayload;
}

async function runWebExtract(body: WebExtractRequestBody, emit: (message: string) => void): Promise<RunExtractOutcome> {
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
      { method: "GET", headers, ...(dispatcher ? ({ dispatcher } as any) : {}) },
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

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return { ok: false as const, status: 200, error: "latest.json 解析失败（非 JSON）", rawText };
    }

    const topics = (parsed?.topic_list?.topics || []) as Array<any>;
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
      { method: "GET", headers, ...(dispatcher ? ({ dispatcher } as any) : {}) },
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
      },
    };
  } catch (error) {
    const baseMessage = error instanceof Error ? error.message : "抓取失败";
    const cause = (error as any)?.cause;
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

export default defineConfig({
  plugins: [
    vue(),
    {
      name: "ai-forward-middleware",
      configureServer(server) {
        server.middlewares.use("/backend/claude/check", async (req, res) => {
          if (req.method !== "GET") {
            sendJson(res, 405, { ok: false, error: "仅支持 GET 请求" });
            return;
          }

          execFile("claude", ["--version"], { windowsHide: true }, (error, stdout, stderr) => {
            if (error) {
              sendJson(res, 200, {
                ok: false,
                error: "未检测到 claude 命令或无法执行，请先安装/配置 Claude Code CLI。",
                detail: stderr || error.message,
              });
              return;
            }

            sendJson(res, 200, { ok: true, version: (stdout || "").trim() });
          });
        });

        server.middlewares.use("/backend/claude/run", async (req, res) => {
          if (req.method !== "POST") {
            sendJson(res, 405, { error: "仅支持 POST 请求" });
            return;
          }

          let body: ClaudeRunRequestBody;
          try {
            body = (await readJsonBody(req)) as ClaudeRunRequestBody;
          } catch (error) {
            sendJson(res, 400, { error: error instanceof Error ? error.message : "解析请求体失败" });
            return;
          }

          const prompt = (body.prompt || "").trim();
          if (!prompt) {
            sendJson(res, 400, { error: "prompt 不能为空" });
            return;
          }

          const workingDir = body.cwd?.trim() ? path.resolve(body.cwd.trim()) : process.cwd();

          sendSseHeaders(res);
          sendSseEvent(res, "status", { phase: "starting", cwd: workingDir, at: Date.now() });

          const claudeArgs: string[] = ["-p", prompt, "--output-format", "stream-json", "--include-partial-messages"];
          if (body.bare) claudeArgs.unshift("--bare");
          if (body.model) claudeArgs.push("--model", body.model);
          if (typeof body.maxTurns === "number" && Number.isFinite(body.maxTurns) && body.maxTurns > 0) {
            claudeArgs.push("--max-turns", String(Math.floor(body.maxTurns)));
          }
          if (body.allowedTools?.trim()) claudeArgs.push("--allowedTools", body.allowedTools.trim());
          if (body.permissionMode?.trim()) claudeArgs.push("--permission-mode", body.permissionMode.trim());

          const child = spawn("claude", claudeArgs, {
            cwd: workingDir,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
          });

          let closed = false;
          const closeAll = () => {
            if (closed) return;
            closed = true;
            try {
              child.kill();
            } catch {
              // ignore
            }
          };

          req.on("close", closeAll);
          res.on("close", closeAll);

          // 定时推送 git 变更，作为“进度/影响范围”展示。
          const gitTimer = setInterval(() => {
            execFile("git", ["status", "--porcelain=v1", "-uall"], { cwd: workingDir, windowsHide: true }, (err, out) => {
              if (err || closed) return;
              const lines = (out || "")
                .split(/\r?\n/)
                .map((line) => line.trimEnd())
                .filter(Boolean);
              const files = lines.map((line) => {
                // 格式类似：` M src/main.ts` / `?? new-file`
                const status = line.slice(0, 2).trim() || "?";
                const file = line.slice(3).trim();
                return { status, file };
              });
              sendSseEvent(res, "git_status", { files, at: Date.now() });
            });
          }, 1200);

          child.stdout.setEncoding("utf-8");
          child.stderr.setEncoding("utf-8");

          child.stdout.on("data", (chunk: string) => {
            if (closed) return;
            // stream-json 是逐行 JSON；为了稳妥，这里按行切分，无法解析就原样转发。
            const lines = chunk.split(/\r?\n/).filter(Boolean);
            for (const line of lines) {
              try {
                const parsed = JSON.parse(line) as unknown;
                sendSseEvent(res, "claude", { stream: "stdout", raw: line, parsed, at: Date.now() });
              } catch {
                sendSseEvent(res, "claude", { stream: "stdout", raw: line, at: Date.now() });
              }
            }
          });

          child.stderr.on("data", (chunk: string) => {
            if (closed) return;
            sendSseEvent(res, "stderr", { text: chunk, at: Date.now() });
          });

          child.on("error", (error) => {
            if (closed) return;
            clearInterval(gitTimer);
            sendSseEvent(res, "status", { phase: "error", message: error.message, at: Date.now() });
            res.end();
            closeAll();
          });

          child.on("close", (code, signal) => {
            clearInterval(gitTimer);
            if (closed) return;
            sendSseEvent(res, "status", {
              phase: "finished",
              exitCode: code,
              signal,
              at: Date.now(),
            });
            res.end();
            closeAll();
          });
        });

        server.middlewares.use("/backend/web/extract", async (req, res) => {
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
            const cause = (error as any)?.cause;
            const causeMessage =
              cause instanceof Error ? cause.message : typeof cause === "string" ? cause : cause ? JSON.stringify(cause) : "";
            sendJson(res, 500, {
              ok: false,
              status: 500,
              error: causeMessage ? `${baseMessage}\n原因：${causeMessage}` : baseMessage,
            });
          }
        });

        server.middlewares.use("/backend/ai/test", async (req, res) => {
          if (req.method !== "POST") {
            sendJson(res, 405, { error: "仅支持 POST 请求" });
            return;
          }

          try {
            const body = (await readJsonBody(req)) as ForwardRequestBody;
            if (!body.endpoint || !body.model || !Array.isArray(body.messages)) {
              sendJson(res, 400, { error: "请求参数不完整" });
              return;
            }

            const upstream = await fetch(body.endpoint, {
              method: "POST",
              headers: buildHeaders(body.apiKey),
              body: JSON.stringify({
                model: body.model,
                messages: body.messages,
                stream: body.stream,
              }),
            });

            res.statusCode = upstream.status;
            const contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
            res.setHeader("Content-Type", contentType);

            if (!upstream.body) {
              res.end();
              return;
            }

            const reader = upstream.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) res.write(Buffer.from(value));
            }
            res.end();
          } catch (error) {
            sendJson(res, 500, {
              error: error instanceof Error ? error.message : "转发请求失败",
            });
          }
        });

        server.middlewares.use("/backend/ai/models", async (req, res) => {
          if (req.method !== "POST") {
            sendJson(res, 405, { error: "仅支持 POST 请求" });
            return;
          }

          try {
            const body = (await readJsonBody(req)) as ForwardRequestBody;
            if (!body.endpoint) {
              sendJson(res, 400, { error: "请求参数不完整" });
              return;
            }

            const upstream = await fetch(body.endpoint, {
              method: "GET",
              headers: buildHeaders(body.apiKey),
            });

            const rawText = await upstream.text();
            res.statusCode = upstream.status;
            res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
            res.end(rawText);
          } catch (error) {
            sendJson(res, 500, {
              error: error instanceof Error ? error.message : "获取模型失败",
            });
          }
        });

        server.middlewares.use("/backend/ai/tts", async (req, res) => {
          if (req.method !== "POST") {
            sendJson(res, 405, { error: "仅支持 POST 请求" });
            return;
          }

          try {
            const body = (await readJsonBody(req)) as ForwardRequestBody;
            if (!body.endpoint || !body.model || !body.input || !body.voice) {
              sendJson(res, 400, { error: "请求参数不完整" });
              return;
            }

            const upstream = await fetch(body.endpoint, {
              method: "POST",
              headers: buildHeaders(body.apiKey),
              body: JSON.stringify({
                model: body.model,
                input: body.input,
                voice: body.voice,
                format: body.format || "mp3",
              }),
            });

            res.statusCode = upstream.status;
            res.setHeader("Content-Type", upstream.headers.get("content-type") || "audio/mpeg");

            const arrayBuffer = await upstream.arrayBuffer();
            res.end(Buffer.from(arrayBuffer));
          } catch (error) {
            sendJson(res, 500, {
              error: error instanceof Error ? error.message : "TTS 请求失败",
            });
          }
        });
      },
    },
  ],
});
