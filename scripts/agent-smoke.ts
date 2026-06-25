/**
 * Headless Agent smoke / replay — bypasses the Vue UI.
 *
 * Usage:
 *   npm run agent:smoke -- --prompt "弹窗背景透明的？"
 *   npm run agent:smoke -- --session 1782207555782-50f5d22bae53a8
 *   npm run agent:smoke -- --session 1782207555782-50f5d22bae53a8 --no-image
 *
 * Config (env):
 *   AIALL_ENDPOINT, AIALL_API_KEY, AIALL_MODEL
 *   AIALL_PROJECT (default: cwd)
 *   AIALL_TIMEOUT_MS (default: 180000)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runVibeAgent, type VibeAgentEvent } from "../server/vibeAgent";

type CliOptions = {
  prompt: string;
  projectRoot: string;
  endpoint: string;
  apiKey: string;
  model: string;
  mode: "ask" | "build" | "plan" | "explore";
  maxTurns: number;
  timeoutMs: number;
  imageDataUrls?: string[];
  sessionId?: string;
};

function parseArgs(argv: string[]): Partial<CliOptions> & { noImage?: boolean; help?: boolean } {
  const out: Partial<CliOptions> & { noImage?: boolean; help?: boolean } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--no-image") {
      out.noImage = true;
      continue;
    }
    const next = argv[i + 1];
    if (arg === "--prompt" && next) {
      out.prompt = next;
      i += 1;
    } else if (arg === "--session" && next) {
      out.sessionId = next;
      i += 1;
    } else if (arg === "--project" && next) {
      out.projectRoot = path.resolve(next);
      i += 1;
    } else if (arg === "--mode" && next) {
      out.mode = next as CliOptions["mode"];
      i += 1;
    } else if (arg === "--max-turns" && next) {
      out.maxTurns = Number(next);
      i += 1;
    } else if (arg === "--timeout" && next) {
      out.timeoutMs = Number(next);
      i += 1;
    }
  }
  return out;
}

function printHelp() {
  console.log(`agent-smoke — run Agent without the UI

Options:
  --prompt <text>       User message (required unless --session)
  --session <id>        Replay last user turn from AppData session JSON
  --no-image            Skip attached images when replaying a session
  --project <path>      Project root (default: cwd or AIALL_PROJECT)
  --mode ask|build|plan|explore Default: build
  --max-turns <n>       Default: 6
  --timeout <ms>        Abort after N ms (default: 180000)

Env: AIALL_ENDPOINT, AIALL_API_KEY, AIALL_MODEL, AIALL_PROJECT, AIALL_TIMEOUT_MS

Examples:
  npm run agent:smoke -- --prompt "弹窗背景透明的？"
  npm run agent:smoke -- --session 1782207555782-50f5d22bae53a8 --no-image
  npm run agent:test-guards
`);
}

function resolveSessionsDir(): string {
  const base = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(base, "aiall", "vibe-chat-sessions");
}

function loadSessionUserTurn(sessionId: string, noImage: boolean): {
  prompt: string;
  imageDataUrls?: string[];
  chatMode?: "ask" | "build" | "plan";
} {
  const file = path.join(resolveSessionsDir(), `chat-${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Session file not found: ${file}`);
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as {
    messages?: Array<{
      role: string;
      content?: string;
      chatMode?: "ask" | "build" | "plan";
      imageRefs?: Array<{ path: string }>;
      imageDataUrls?: string[];
    }>;
  };
  const messages = parsed.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    const prompt = (m.content || "").trim();
    let imageDataUrls: string[] | undefined;
    if (!noImage) {
      if (m.imageDataUrls?.length) {
        imageDataUrls = m.imageDataUrls.filter((u) => u.startsWith("data:image/"));
      } else if (m.imageRefs?.length) {
        const loaded: string[] = [];
        for (const ref of m.imageRefs) {
          const imgPath = path.join(resolveSessionsDir(), ref.path.replace(/\//g, path.sep));
          if (!fs.existsSync(imgPath)) continue;
          const buf = fs.readFileSync(imgPath);
          const ext = path.extname(imgPath).slice(1).toLowerCase() || "png";
          loaded.push(`data:image/${ext};base64,${buf.toString("base64")}`);
        }
        if (loaded.length) imageDataUrls = loaded;
      }
    }
    return { prompt, imageDataUrls, chatMode: m.chatMode };
  }
  throw new Error(`No user message in session ${sessionId}`);
}

function resolveOptions(raw: ReturnType<typeof parseArgs>): CliOptions {
  const endpoint = (process.env.AIALL_ENDPOINT || "").trim();
  const apiKey = (process.env.AIALL_API_KEY || "").trim();
  const model = (process.env.AIALL_MODEL || "").trim();
  if (!endpoint || !model) {
    throw new Error(
      "Missing AIALL_ENDPOINT / AIALL_MODEL. Set env vars or copy from AI 配置页 localStorage (ai-config).",
    );
  }

  let prompt = raw.prompt?.trim() || "";
  let imageDataUrls = raw.imageDataUrls;
  let mode = raw.mode ?? "build";

  if (raw.sessionId) {
    const replay = loadSessionUserTurn(raw.sessionId, Boolean(raw.noImage));
    if (!prompt) prompt = replay.prompt;
    if (!raw.noImage && replay.imageDataUrls?.length) imageDataUrls = replay.imageDataUrls;
    if (replay.chatMode) mode = replay.chatMode;
  }

  if (!prompt && !imageDataUrls?.length) {
    throw new Error("Provide --prompt or --session with a user message.");
  }

  return {
    prompt,
    projectRoot: raw.projectRoot || process.env.AIALL_PROJECT || process.cwd(),
    endpoint,
    apiKey,
    model,
    mode,
    maxTurns: raw.maxTurns && raw.maxTurns > 0 ? raw.maxTurns : 6,
    timeoutMs: raw.timeoutMs && raw.timeoutMs > 0
      ? raw.timeoutMs
      : Number(process.env.AIALL_TIMEOUT_MS || 180_000),
    imageDataUrls,
    sessionId: raw.sessionId,
  };
}

function toolSignature(name: string, args: Record<string, unknown>): string {
  const pathArg = typeof args.path === "string" ? args.path : "";
  const pattern = typeof args.pattern === "string" ? args.pattern : "";
  return `${name}:${pathArg}:${pattern}`;
}

async function main() {
  const raw = parseArgs(process.argv.slice(2));
  if (raw.help) {
    printHelp();
    return;
  }

  const opts = resolveOptions(raw);
  console.log("[agent-smoke] project:", opts.projectRoot);
  console.log("[agent-smoke] model:", opts.model);
  console.log("[agent-smoke] prompt:", opts.prompt || "(image only)");
  if (opts.sessionId) console.log("[agent-smoke] session:", opts.sessionId);
  if (opts.imageDataUrls?.length) console.log("[agent-smoke] images:", opts.imageDataUrls.length);
  console.log("[agent-smoke] maxTurns:", opts.maxTurns, "timeout:", opts.timeoutMs, "ms");
  console.log("---");

  const controller = new AbortController();
  const timer = setTimeout(() => {
    console.error("\n[agent-smoke] TIMEOUT — aborting");
    controller.abort();
  }, opts.timeoutMs);

  const toolSigs: string[] = [];
  let duplicateTools = 0;
  let lastAssistant = "";
  let turns = 0;
  let failed = false;
  let errorMessage = "";

  const onEvent = (event: VibeAgentEvent) => {
    if (event.type === "status") {
      const d = event.data;
      const turn = d.turn ? ` turn ${d.turn}/${d.maxTurns ?? "?"}` : "";
      console.log(`[status] ${d.phase}${turn}${d.detail ? ` · ${d.detail}` : ""}`);
      return;
    }
    if (event.type === "tool_start") {
      const sig = toolSignature(event.data.name, event.data.args);
      if (toolSigs.includes(sig)) duplicateTools += 1;
      toolSigs.push(sig);
      console.log(`[tool] ${event.data.name} ${JSON.stringify(event.data.args).slice(0, 120)}`);
      return;
    }
    if (event.type === "tool_end") {
      const ok = event.data.ok ? "ok" : "FAIL";
      console.log(`[tool-end] ${event.data.name} ${ok}: ${event.data.summary.slice(0, 100)}`);
      return;
    }
    if (event.type === "message" || event.type === "message_delta") {
      if (event.type === "message") {
        lastAssistant = event.data.text;
      }
      return;
    }
    if (event.type === "error") {
      failed = true;
      errorMessage = event.data.message;
      console.error(`[error] ${event.data.message}`);
      return;
    }
    if (event.type === "done") {
      turns = event.data.turns;
    }
  };

  try {
    await runVibeAgent({
      projectRoot: opts.projectRoot,
      prompt: opts.prompt,
      endpoint: opts.endpoint,
      apiKey: opts.apiKey,
      model: opts.model,
      mode: opts.mode,
      maxTurns: opts.maxTurns,
      imageDataUrls: opts.imageDataUrls,
      onEvent,
      signal: controller.signal,
    });
  } catch (e) {
    failed = true;
    errorMessage = e instanceof Error ? e.message : String(e);
    console.error("[agent-smoke] exception:", errorMessage);
  } finally {
    clearTimeout(timer);
  }

  console.log("---");
  console.log("[agent-smoke] turns:", turns);
  console.log("[agent-smoke] tools:", toolSigs.length, "duplicate:", duplicateTools);
  const preview = lastAssistant.trim().slice(0, 400);
  console.log("[agent-smoke] answer preview:", preview || "(empty)");

  if (controller.signal.aborted && !lastAssistant.trim()) {
    console.error("[agent-smoke] FAIL: timeout with empty answer");
    process.exit(2);
  }
  if (duplicateTools >= 2) {
    console.error("[agent-smoke] FAIL: repeated identical tool calls (explore loop)");
    process.exit(3);
  }
  if (failed && !lastAssistant.trim()) {
    console.error("[agent-smoke] FAIL:", errorMessage);
    process.exit(1);
  }
  if (!lastAssistant.trim()) {
    console.error("[agent-smoke] FAIL: no assistant text");
    process.exit(1);
  }
  console.log("[agent-smoke] OK");
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
