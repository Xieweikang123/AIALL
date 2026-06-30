import type { Connect } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { readJsonBody, sendJson, sendSseEvent, sendSseComment, sendSseHeaders } from "./server/httpUtils";
import { chatCompletionWithTools, resolveChatEndpoint } from "./server/aiForward";
import { runVibeAgent } from "./server/vibeAgent";
import type { VibeChatMode } from "./shared/agentTypes";
import { buildProjectContext } from "./server/vibeProjectContext";
import {
  appendProjectMemory,
  isProjectMemorySection,
  readProjectMemory,
  writeProjectMemory,
} from "./server/vibeProjectMemory";
import {
  readProjectKnowledge,
  writeProjectKnowledge,
} from "./server/vibeProjectKnowledge";
import {
  buildArchitectReviewContext,
  invalidateArchitectReviewCache,
  readArchitectReview,
  writeArchitectReview,
  listReviewHistory,
  getReviewHistoryDetail,
  saveReviewToHistory,
  deleteReviewFromHistory,
} from "./server/projectArchitectReview";
import {
  archiveExplorationNote,
  listProjectSkills,
  readProjectSkill,
  upsertProjectSkill,
} from "./server/vibeProjectSkills";
import {
  grepInProject,
  listDirectory,
  readFileContent,
  searchFiles,
  writeFileContent,
} from "./server/vibeFs";
import { gitStatus, gitDiff, gitDiffFile, gitDiffContent, gitCommitFileDiff, gitCommit, gitLog, gitAheadCommits, gitIsRepo, gitAdd, gitReset, gitDiscard, gitDiscardAll, gitRemotes, gitFetch, gitPull, gitPush, gitStashList, gitStashSave, gitStashPop, gitStashApply, gitStashDrop, gitChangedFilesSince } from "./server/vibeGit";
import { deleteChatStoreSession, mergeDeletedSessionIds, upsertChatStoreIndexEntry } from "./server/chatStoreIndex";
import { mergeSessionPayloadForDisk } from "./server/chatStoreMerge";
import { externalizeSessionPayload, readImageRefAsBuffer, readImageRefAsDataUrl } from "./server/vibeChatImages";
import { withFileLock } from "./server/fileLock";
import { sessionDiagServer } from "./server/sessionDiagLog";
import { scanProjectHealth } from "./server/projectHealthScan";
import { registerFileOpsRoutes } from "./vibeRoutesFileOps";
import { registerGitRoutes } from "./vibeRoutesGit";
import { registerFileWatcherRoutes } from "./vibeRoutesFileWatcher";

const execFileAsync = promisify(execFile);

const AIALL_DATA_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), ".config"),
  "aiall",
  "vibe-chat-sessions",
);

/**
 * Atomic file write: write to a temp file first, then rename.
 * Prevents JSON corruption if the process crashes mid-write.
 */
async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  const tmpFile = path.join(dir, `.tmp-${path.basename(filePath)}.${Date.now()}`);
  await fs.promises.writeFile(tmpFile, content, "utf-8");
  await fs.promises.rename(tmpFile, filePath);
}

const DEBUG_LOG = path.join(os.tmpdir(), "aiall-debug.log");
const TAB_PERF_LOG = path.join(os.tmpdir(), "aiall-tab-perf.log");
function debugLog(msg: string) {
  fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`);
}
function tabPerfLog(line: string) {
  fs.appendFileSync(TAB_PERF_LOG, line + "\n");
}
debugLog("=== middleware loaded v2 ===");

// 内存缓存 chat-store.json 避免反复读盘触发 Defender
const chatStoreCache = new Map<string, { raw: string; ts: number }>();
const CHAT_STORE_CACHE_TTL_MS = 60_000;

// 内存缓存目录列表
const dirListCache = new Map<string, { items: unknown[]; ts: number }>();
const DIR_LIST_CACHE_TTL_MS = 30_000;

function normalizeProjectPathKey(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
}

function getCachedChatStore(projectPath: string): string | null {
  const entry = chatStoreCache.get(projectPath);
  if (entry && Date.now() - entry.ts < CHAT_STORE_CACHE_TTL_MS) {
    return entry.raw;
  }
  chatStoreCache.delete(projectPath);
  return null;
}
function setCachedChatStore(projectPath: string, raw: string) {
  chatStoreCache.set(projectPath, { raw, ts: Date.now() });
}
function invalidateChatStoreCache(projectPath: string) {
  chatStoreCache.delete(projectPath);
}

function getCachedDirList(dirPath: string): unknown[] | null {
  const entry = dirListCache.get(dirPath);
  if (entry && Date.now() - entry.ts < DIR_LIST_CACHE_TTL_MS) {
    return entry.items;
  }
  dirListCache.delete(dirPath);
  return null;
}
function setCachedDirList(dirPath: string, items: unknown[]) {
  dirListCache.set(dirPath, { items, ts: Date.now() });
}

/** SSE comment interval while agent run is open (prevents idle connection drops). */
const AGENT_SSE_KEEPALIVE_MS = 15_000;

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function powershellExe(): string {
  const root = process.env.SystemRoot || "C:\\Windows";
  return path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/** ASCII-only script; custom WinForms dialog with path input + browse button. */
const FOLDER_PICKER_PS1 = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$title = if ($env:AIALL_DIALOG_DESC) { $env:AIALL_DIALOG_DESC } else { 'Select project folder' }
$initial = $env:AIALL_INITIAL_DIR

[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms')
[void][System.Reflection.Assembly]::LoadWithPartialName('System.Drawing')

$form = New-Object System.Windows.Forms.Form
$form.Text = $title
$form.Size = New-Object System.Drawing.Size(520, 120)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true

$label = New-Object System.Windows.Forms.Label
$label.Text = 'Folder path:'
$label.Location = New-Object System.Drawing.Point(12, 16)
$label.Size = New-Object System.Drawing.Size(80, 20)
$form.Controls.Add($label)

$textBox = New-Object System.Windows.Forms.TextBox
$textBox.Location = New-Object System.Drawing.Point(95, 13)
$textBox.Size = New-Object System.Drawing.Size(300, 20)
if ($initial -and (Test-Path -LiteralPath $initial -PathType Container)) {
  $textBox.Text = $initial
}
$form.Controls.Add($textBox)

$browseBtn = New-Object System.Windows.Forms.Button
$browseBtn.Text = 'Browse...'
$browseBtn.Location = New-Object System.Drawing.Point(402, 12)
$browseBtn.Size = New-Object System.Drawing.Size(90, 24)
$browseBtn.Add_Click({
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = $title
  $dialog.ShowNewFolderButton = $true
  if ($textBox.Text -and (Test-Path -LiteralPath $textBox.Text -PathType Container)) {
    $dialog.SelectedPath = $textBox.Text
  }
  if ($dialog.ShowDialog() -eq 'OK') {
    $textBox.Text = $dialog.SelectedPath
  }
})
$form.Controls.Add($browseBtn)

$okBtn = New-Object System.Windows.Forms.Button
$okBtn.Text = 'OK'
$okBtn.DialogResult = 'OK'
$okBtn.Location = New-Object System.Drawing.Point(320, 55)
$okBtn.Size = New-Object System.Drawing.Size(85, 28)
$form.Controls.Add($okBtn)

$cancelBtn = New-Object System.Windows.Forms.Button
$cancelBtn.Text = 'Cancel'
$cancelBtn.DialogResult = 'Cancel'
$cancelBtn.Location = New-Object System.Drawing.Point(410, 55)
$cancelBtn.Size = New-Object System.Drawing.Size(85, 28)
$form.Controls.Add($cancelBtn)

$form.AcceptButton = $okBtn
$form.CancelButton = $cancelBtn

if ($form.ShowDialog() -ne 'OK') { exit 0 }

$selected = $textBox.Text.Trim()
if ($selected -and (Test-Path -LiteralPath $selected -PathType Container)) {
  [Console]::Out.Write($selected)
}
`.trim();

function formatExecError(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const err = error as NodeJS.ErrnoException & { stderr?: Buffer | string; stdout?: Buffer | string };
  const stderr = err.stderr ? String(err.stderr).trim() : "";
  const stdout = err.stdout ? String(err.stdout).trim() : "";
  return [err.message || "", stderr && `stderr:\n${stderr}`, stdout && `stdout:\n${stdout}`].filter(Boolean).join("\n");
}

async function pickFolderWindows(initialPath?: string): Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }> {
  const scriptPath = path.join(os.tmpdir(), `aiall-folder-picker-${process.pid}-${Date.now()}.ps1`);
  await fs.promises.writeFile(scriptPath, `\uFEFF${FOLDER_PICKER_PS1}`, "utf8");
  debugLog(`script written to ${scriptPath}`);
  debugLog(`script content:\n${FOLDER_PICKER_PS1}`);
  console.log(`[aiall-debug] pickFolderWindows start, initialPath=${initialPath}, script=${scriptPath}`);
  debugLog(`pickFolderWindows start, initialPath=${initialPath}, script=${scriptPath}`);

  try {
    const env = { ...process.env, AIALL_DIALOG_DESC: "选择项目文件夹" };
    if (initialPath?.trim()) env.AIALL_INITIAL_DIR = path.resolve(initialPath.trim());
    console.log(`[aiall-debug] spawning powershell...`);
    debugLog(`spawning powershell...`);

    const { stdout, stderr } = await execFileAsync(
      powershellExe(),
      ["-NoProfile", "-Sta", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      { windowsHide: false, maxBuffer: 4 * 1024 * 1024, env },
    );

    const errText = stderr ? String(stderr).trim() : "";
    console.log(`[aiall-debug] powershell done, stdout=${JSON.stringify(stdout)}, stderr=${JSON.stringify(errText)}`);
    debugLog(`powershell done, stdout=${JSON.stringify(stdout)}, stderr=${JSON.stringify(errText)}`);
    if (errText && !stdout) {
      return { ok: false, error: errText };
    }

    const selected = (stdout ? String(stdout) : "").trim();
    console.log(`[aiall-debug] selected=${JSON.stringify(selected)}`);
    debugLog(`selected=${JSON.stringify(selected)}`);
    if (!selected) return { ok: false, cancelled: true };
    return { ok: true, path: selected };
  } catch (error) {
    console.log(`[aiall-debug] pickFolderWindows error:`, error);
    debugLog(`pickFolderWindows error: ${error}`);
    return { ok: false, error: formatExecError(error) };
  } finally {
    await fs.promises.unlink(scriptPath).catch(() => {});
  }
}

async function pickFolderMac(initialPath?: string): Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }> {
  const escaped = (initialPath?.trim() || os.homedir()).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  try {
    const { stdout } = await execFileAsync(
      "osascript",
      ["-e", `POSIX path of (choose folder with prompt "选择项目文件夹" default location POSIX file "${escaped}")`],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    const selected = stdout.trim();
    if (!selected) return { ok: false, cancelled: true };
    return { ok: true, path: selected };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/User canceled|用户取消|-128/.test(message)) return { ok: false, cancelled: true };
    return { ok: false, error: message };
  }
}

async function openFolderInExplorer(folderPath: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  const resolved = path.resolve(folderPath.trim());
  const stat = await fs.promises.stat(resolved).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    return { ok: false, error: "路径不是有效文件夹" };
  }
  try {
    if (process.platform === "win32") {
      // explorer.exe 打开文件夹后常以非零码退出，不能 await execFile
      await new Promise<void>((resolve, reject) => {
        const child = spawn("explorer.exe", [resolved], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
        child.once("error", reject);
        child.unref();
        resolve();
      });
    } else if (process.platform === "darwin") {
      await execFileAsync("open", [resolved]);
    } else {
      await execFileAsync("xdg-open", [resolved]);
    }
    return { ok: true, path: resolved };
  } catch (error) {
    return { ok: false, error: formatExecError(error) };
  }
}

async function pickFolderLinux(initialPath?: string): Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }> {
  const args = ["--file-selection", "--directory", "--title=选择项目文件夹"];
  if (initialPath?.trim()) args.push(`--filename=${initialPath.trim()}/`);

  for (const cmd of ["zenity", "kdialog"]) {
    try {
      const execArgs = cmd === "kdialog"
        ? ["--getexistingdirectory", initialPath?.trim() || os.homedir(), "--title", "选择项目文件夹"]
        : args;
      const { stdout } = await execFileAsync(cmd, execArgs, { maxBuffer: 4 * 1024 * 1024 });
      const selected = stdout.trim();
      if (!selected) return { ok: false, cancelled: true };
      return { ok: true, path: selected };
    } catch {
      // try next tool
    }
  }

  return { ok: false, error: "未找到 zenity 或 kdialog，请手动输入路径" };
}

async function pickProjectFolder(initialPath?: string) {
  if (process.platform === "win32") return pickFolderWindows(initialPath);
  if (process.platform === "darwin") return pickFolderMac(initialPath);
  return pickFolderLinux(initialPath);
}

function resolvePathInsideOptionalRoot(inputPath: string, projectRoot?: string): { ok: true; path: string } | { ok: false; error: string } {
  const resolved = path.resolve(inputPath);
  const rootInput = projectRoot?.trim();
  if (!rootInput) return { ok: true, path: resolved };

  const root = path.resolve(rootInput);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { ok: false, error: "路径超出项目根目录" };
  }
  return { ok: true, path: resolved };
}

export function registerVibeCodingMiddleware(middlewares: Connect.Server) {
  // POST /backend/vibe/log — 简单日志端点
  middlewares.use("/backend/vibe/log", async (req, res) => {
    if (req.method !== "POST") { sendJson(res, 405, { ok: false }); return; }
    try {
      const body = await readJsonBody(req) as { path?: string; line?: string };
      if (body.path === "tab-perf.log" && body.line) {
        tabPerfLog(body.line);
      } else if (body.path === "fetch-perf.log" && body.line) {
        const fetchLogPath = path.join(os.tmpdir(), "aiall-fetch-perf.log");
        fs.appendFileSync(fetchLogPath, body.line);
      } else if (body.path === ".debug.log" && body.line) {
        const debugLogPath = path.join(process.cwd(), ".debug.log");
        fs.appendFileSync(debugLogPath, body.line + "\n");
      }
      sendJson(res, 200, { ok: true });
    } catch { sendJson(res, 500, { ok: false }); }
  });

  // POST /backend/vibe/debug-log — 临时调试日志端点，写入 NDJSON 到 debug-b0d733.log
  middlewares.use("/backend/vibe/debug-log", async (req, res) => {
    if (req.method !== "POST") { sendJson(res, 405, { ok: false }); return; }
    try {
      const body = await readJsonBody(req);
      const lines = Array.isArray(body) ? body : [body];
      const logFile = path.join(process.cwd(), "debug-b0d733.log");
      const ndjson = lines.map((l: unknown) => JSON.stringify(l)).join("\n") + "\n";
      await fs.promises.appendFile(logFile, ndjson, "utf-8");
      sendJson(res, 200, { ok: true });
    } catch { sendJson(res, 500, { ok: false }); }
  });

  // GET /backend/vibe/chat-store-load
  middlewares.use("/backend/vibe/chat-store-load", async (req, res) => {
    const _reqTime = Date.now();
    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const projectPath = (url.searchParams.get("projectPath") || "").trim();
      const loadMessages = url.searchParams.get("loadMessages") === "1";
      const bustCache = url.searchParams.has("_t");
      if (!projectPath) {
        sendJson(res, 400, { ok: false, error: "缺少 projectPath" });
        return;
      }
      debugLog(`chat-store-load: request-arrived projectPath="${projectPath}" delayFromEntry=${Date.now() - _reqTime}ms`);

      const resolved = path.resolve(projectPath);
      const chatDir = AIALL_DATA_DIR;
      const storeFile = path.join(chatDir, "chat-store.json");
      let cacheHit = false;
      let raw = bustCache ? null : getCachedChatStore(resolved);
      if (raw) {
        cacheHit = true;
        debugLog(`chat-store-load: cache-hit projectPath="${projectPath}" age=${Date.now() - chatStoreCache.get(resolved)?.ts}ms`);
      } else {
        raw = await fs.promises.readFile(storeFile, "utf-8").catch(() => null);
        if (raw) setCachedChatStore(resolved, raw);
      }
      if (!raw) {
        sendJson(res, 404, { ok: false, error: "未找到 chat-store.json" });
        return;
      }

      const index = JSON.parse(raw) as {
        version?: number;
        projectPath?: string;
        activeSessionId?: string;
        deletedSessionIds?: string[];
        sessions?: Array<{
          id?: string;
          title?: string;
          createdAt?: string;
          updatedAt?: string;
          messageCount?: number;
          file?: string;
          status?: string;
        }>;
      };
      const storedProjectPath = (index.projectPath || "").trim();
      if (
        storedProjectPath
        && normalizeProjectPathKey(storedProjectPath) !== normalizeProjectPathKey(projectPath)
      ) {
        sendJson(res, 404, { ok: false, error: "磁盘会话库属于其他项目" });
        return;
      }

      const deletedSet = new Set((index.deletedSessionIds || []).map((id) => id.trim()).filter(Boolean));
      const metas = (Array.isArray(index.sessions) ? index.sessions : []).filter(
        (meta) => {
          const id = (meta.id || "").trim();
          return id && !deletedSet.has(id);
        },
      );
      sessionDiagServer("backend:chat-store-load", {
        projectPath,
        loadMessages,
        cacheHit,
        indexSessionIds: metas.map((m) => m.id).filter(Boolean),
        activeSessionId: index.activeSessionId || "",
      });
      const sessions: Array<{
        id: string;
        title: string;
        createdAt: string;
        updatedAt: string;
        messageCount: number;
        messages?: unknown[];
        status?: string;
      }> = [];

      const _chatT0 = Date.now();
      debugLog(`chat-store-load start: projectPath="${projectPath}", loadMessages=${loadMessages}, sessions=${metas.length}`);

      if (loadMessages) {
        // 原逻辑：并行读取所有 session 文件（含 messages）
        const sessionResults = await Promise.all(
          metas.map(async (meta) => {
            const id = (meta.id || "").trim();
            const fileName = (meta.file || (id ? `chat-${safeFilePart(id)}.json` : "")).trim();
            if (!fileName) return null;
            const sessionFile = path.join(chatDir, fileName);
            const sessionRaw = await fs.promises.readFile(sessionFile, "utf-8").catch(() => null);
            if (!sessionRaw) return null;
            const sessionData = JSON.parse(sessionRaw) as { messages?: unknown[] };
            return {
              id,
              title: meta.title || "新会话",
              createdAt: meta.createdAt || "",
              updatedAt: meta.updatedAt || "",
              messageCount: Array.isArray(sessionData.messages) ? sessionData.messages.length : 0,
              messages: Array.isArray(sessionData.messages) ? sessionData.messages : [],
              status: meta.status || "active",
            };
          }),
        );
        for (const s of sessionResults) {
          if (s) sessions.push(s);
        }
      } else {
        // 快速模式：只返回元数据，不读取 session 文件
        for (const meta of metas) {
          const id = (meta.id || "").trim();
          if (!id) continue;
          sessions.push({
            id,
            title: meta.title || "新会话",
            createdAt: meta.createdAt || "",
            updatedAt: meta.updatedAt || "",
            messageCount: meta.messageCount || 0,
            status: meta.status || "active",
          });
        }
      }

      const _chatT1 = Date.now();
      debugLog(`chat-store-load done: loadMessages=${loadMessages}, sessions=${sessions.length}, loadMs=${_chatT1 - _chatT0}, totalFromEntry=${_chatT1 - _reqTime}ms`);

      if (!sessions.length) {
        sendJson(res, 404, { ok: false, error: "会话目录为空" });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        data: {
          version: index.version || 3,
          projectPath: storedProjectPath || projectPath,
          activeSessionId: index.activeSessionId || sessions[0].id,
          deletedSessionIds: index.deletedSessionIds,
          sessions,
        },
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : "读取会话库失败",
      });
    }
  });

  // GET /backend/vibe/chat-session-messages — 按需加载单个会话的 messages
  middlewares.use("/backend/vibe/chat-session-messages", async (req, res) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const projectPath = (url.searchParams.get("projectPath") || "").trim();
      const sessionId = (url.searchParams.get("sessionId") || "").trim();
      if (!projectPath || !sessionId) {
        sendJson(res, 400, { ok: false, error: "缺少 projectPath 或 sessionId" });
        return;
      }

      const resolved = path.resolve(projectPath);
      const chatDir = AIALL_DATA_DIR;
      const sessionFile = path.join(chatDir, `chat-${safeFilePart(sessionId)}.json`);
      const raw = await fs.promises.readFile(sessionFile, "utf-8").catch(() => null);
      if (!raw) {
        sendJson(res, 404, { ok: false, error: "会话文件不存在" });
        return;
      }

      const sessionData = JSON.parse(raw) as { messages?: unknown[] };
      sendJson(res, 200, {
        ok: true,
        data: {
          sessionId,
          messages: Array.isArray(sessionData.messages) ? sessionData.messages : [],
        },
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : "读取会话失败",
      });
    }
  });

  // GET /backend/vibe/chat-image
  middlewares.use("/backend/vibe/chat-image", async (req, res) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const projectPath = (url.searchParams.get("projectPath") || "").trim();
      const relPath = (url.searchParams.get("path") || "").trim();
      if (!projectPath || !relPath) {
        sendJson(res, 400, { ok: false, error: "缺少 projectPath 或 path" });
        return;
      }

      const chatDir = AIALL_DATA_DIR;
      const dataUrl = await readImageRefAsDataUrl(chatDir, relPath);
      if (!dataUrl) {
        sendJson(res, 404, { ok: false, error: "图片不存在" });
        return;
      }
      sendJson(res, 200, { ok: true, dataUrl });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : "读取图片失败",
      });
    }
  });

  // GET /backend/vibe/chat-image-file — raw bytes for <img src> (no base64 JSON hop)
  middlewares.use("/backend/vibe/chat-image-file", async (req, res) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const projectPath = (url.searchParams.get("projectPath") || "").trim();
      const relPath = (url.searchParams.get("path") || "").trim();
      if (!projectPath || !relPath) {
        sendJson(res, 400, { ok: false, error: "缺少 projectPath 或 path" });
        return;
      }

      const chatDir = AIALL_DATA_DIR;
      const loaded = await readImageRefAsBuffer(chatDir, relPath);
      if (!loaded) {
        sendJson(res, 404, { ok: false, error: "图片不存在" });
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", loaded.mime);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.end(loaded.buffer);
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : "读取图片失败",
      });
    }
  });

  // POST /backend/vibe/chat-store-sync
  middlewares.use("/backend/vibe/chat-store-sync", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as {
        projectPath?: string;
        data?: {
          version?: number;
          projectPath?: string;
          activeSessionId?: string;
          deletedSessionIds?: string[];
          sessions?: Array<{
            id?: string;
            title?: string;
            createdAt?: string;
            updatedAt?: string;
            messageCount?: number;
            messages?: unknown;
            status?: string;
          }>;
        };
      };
      const projectPath = (body.projectPath || "").trim();
      debugLog(`/backend/vibe/chat-store-sync hit, projectPath="${projectPath}"`);
      if (!projectPath) {
        sendJson(res, 400, { ok: false, error: "缺少 projectPath" });
        return;
      }

      const sessions = Array.isArray(body.data?.sessions) ? body.data.sessions : [];
      const incomingIdList = sessions
        .map((session) => (session.id || "").trim())
        .filter(Boolean);

      sessionDiagServer("backend:chat-store-sync:start", {
        projectPath,
        incomingSessionIds: incomingIdList,
        activeSessionId: body.data?.activeSessionId || "",
      });

      const resolved = path.resolve(projectPath);
      const chatDir = AIALL_DATA_DIR;
      await fs.promises.mkdir(chatDir, { recursive: true }).catch(() => {});
      const storeFile = path.join(chatDir, "chat-store.json");
      debugLog(`chat-store-sync async writing ${sessions.length} sessions`);

      if (!sessions.length) {
        const index = {
          syncedAt: new Date().toISOString(),
          version: body.data?.version || 3,
          projectPath,
          activeSessionId: "",
          sessions: [],
        };
        await atomicWriteFile(storeFile, JSON.stringify(index, null, 2));
        invalidateChatStoreCache(resolved);
        sessionDiagServer("backend:chat-store-sync:done-empty", { projectPath });
        sendJson(res, 200, { ok: true, path: AIALL_DATA_DIR, sessionCount: 0 });
        return;
      }

      // 只写有变更的 session（通过比较 messageCount）
      let existingIndex: {
        deletedSessionIds?: string[];
        sessions?: Array<{ id: string; title: string; createdAt: string; updatedAt: string; messageCount: number; file: string }>;
      } | null = null;
      try {
        const raw = await fs.promises.readFile(storeFile, "utf-8");
        existingIndex = JSON.parse(raw);
      } catch {
        existingIndex = null;
      }
      const mergedDeletedIds = mergeDeletedSessionIds(
        existingIndex?.deletedSessionIds,
        body.data?.deletedSessionIds,
      );
      const deletedSet = new Set(mergedDeletedIds || []);
      const existingSessions = (existingIndex?.sessions || []).filter((s) => !deletedSet.has(s.id));
      const existingMap = new Map(existingSessions.map(s => [s.id, s]));

      const indexSessionsMap = new Map<string, {
        id: string;
        title: string;
        createdAt: string;
        updatedAt: string;
        messageCount: number;
        file: string;
        status?: string;
      }>();
      const incomingIds = new Set(incomingIdList);

      // 勿因过期快照裁掉未出现在 payload 中的会话；显式删除走 chat-session-delete。
      const preservedFromDisk: string[] = [];

      // 并行写入所有 session 文件
      await Promise.all(sessions.map(async (session) => {
        const id = (session.id || "").trim();
        if (!id || deletedSet.has(id)) return;

        const existing = existingMap.get(id);
        const sessionFile = path.join(chatDir, `chat-${safeFilePart(id)}.json`);
        const sessionFileExists = await fs.promises.access(sessionFile).then(() => true).catch(() => false);

        // 跳过未变更的 session
        if (existing && sessionFileExists && existing.messageCount === (session.messageCount || 0) && existing.title === session.title) {
          indexSessionsMap.set(id, {
            ...existing,
            updatedAt: session.updatedAt || existing.updatedAt,
            status: session.status || existing.status,
          });
          return;
        }

        const existingRaw = await fs.promises.readFile(sessionFile, "utf-8").catch(() => null);
        let existingPayload: { messages?: unknown[] } | null = null;
        if (existingRaw) {
          try { existingPayload = JSON.parse(existingRaw); } catch { existingPayload = null; }
        }
        const incomingPayload = {
          id,
          title: session.title || "新会话",
          createdAt: session.createdAt || "",
          updatedAt: session.updatedAt || "",
          messages: Array.isArray(session.messages) ? session.messages : [],
          status: session.status || "active",
        };
        const mergedPayload = mergeSessionPayloadForDisk(incomingPayload, existingPayload);
        const sessionPayload = await externalizeSessionPayload(chatDir, id, mergedPayload);
        await atomicWriteFile(sessionFile, JSON.stringify(sessionPayload, null, 2));

        let messageCount = Array.isArray(sessionPayload.messages) ? sessionPayload.messages.length : 0;
        if (messageCount === 0 && existingPayload && Array.isArray(existingPayload.messages) && existingPayload.messages.length > 0) {
          messageCount = existingPayload.messages.length;
        }
        indexSessionsMap.set(id, {
          id,
          title: sessionPayload.title || "新会话",
          createdAt: sessionPayload.createdAt || "",
          updatedAt: sessionPayload.updatedAt || "",
          messageCount,
          file: `chat-${safeFilePart(id)}.json`,
          status: sessionPayload.status || "active",
        });
      }));

      for (const existing of existingSessions) {
        if (!existing.id || incomingIds.has(existing.id) || indexSessionsMap.has(existing.id)) continue;
        if (deletedSet.has(existing.id)) continue;
        indexSessionsMap.set(existing.id, existing);
        preservedFromDisk.push(existing.id);
      }
      if (preservedFromDisk.length) {
        sessionDiagServer("backend:chat-store-sync:preserved-existing", {
          projectPath,
          preservedSessionIds: preservedFromDisk,
        });
      }

      // 写入 index
      const index = {
        syncedAt: new Date().toISOString(),
        version: body.data?.version || 3,
        projectPath,
        activeSessionId: body.data?.activeSessionId || "",
        deletedSessionIds: mergedDeletedIds,
        sessions: Array.from(indexSessionsMap.values()).filter((s) => !deletedSet.has(s.id)),
      };
      await atomicWriteFile(storeFile, JSON.stringify(index, null, 2));
      invalidateChatStoreCache(resolved);
      sessionDiagServer("backend:chat-store-sync:done", {
        projectPath,
        writtenSessionIds: index.sessions.map((s) => s.id),
        activeSessionId: index.activeSessionId,
        preservedFromDisk,
      });
      debugLog(`chat-store-sync async done, cache invalidated for "${resolved}"`);
      sendJson(res, 200, {
        ok: true,
        path: AIALL_DATA_DIR,
        sessionCount: index.sessions.length,
        activeSessionId: index.activeSessionId,
        syncedAt: index.syncedAt,
        sessions: index.sessions.map((s) => ({
          id: s.id,
          title: s.title,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          messageCount: s.messageCount,
          status: s.status,
        })),
      });
    } catch (error) {
      debugLog(`chat-store-sync error: ${error instanceof Error ? error.message : String(error)}`);
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "同步会话到本地失败" });
    }
  });

  // POST /backend/vibe/chat-session-sync
  middlewares.use("/backend/vibe/chat-session-sync", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as {
        projectPath?: string;
        sessionId?: string;
        activeSessionId?: string;
        data?: unknown;
      };
      const projectPath = (body.projectPath || "").trim();
      const sessionId = (body.sessionId || "").trim();
      const activeSessionId = (body.activeSessionId || sessionId).trim();
      if (!projectPath || !sessionId) {
        sendJson(res, 400, { ok: false, error: "缺少 projectPath 或 sessionId" });
        return;
      }

      const resolved = path.resolve(projectPath);
      const chatDir = AIALL_DATA_DIR;
      await fs.promises.mkdir(chatDir, { recursive: true });
      const safeId = safeFilePart(sessionId);
      const sessionFile = path.join(chatDir, `chat-${safeId}.json`);

      // 合并磁盘已有消息，防止前端发送空数组覆盖已有数据
      const incomingData = body.data && typeof body.data === "object"
        ? body.data as { messages?: unknown[]; [key: string]: unknown }
        : undefined;
      let mergedData = incomingData;
      if (incomingData) {
        const existingRaw = await fs.promises.readFile(sessionFile, "utf-8").catch(() => null);
        let existingPayload: { messages?: unknown[] } | null = null;
        if (existingRaw) {
          try { existingPayload = JSON.parse(existingRaw) as { messages?: unknown[] }; } catch { existingPayload = null; }
        }
        mergedData = mergeSessionPayloadForDisk(
          { id: sessionId, ...incomingData },
          existingPayload,
        );
      }

      const payload = mergedData
        ? await externalizeSessionPayload(chatDir, sessionId, mergedData as { messages?: unknown[] })
        : mergedData;
      
      // Use file lock to prevent concurrent writes to the same session file and index
      const storeFile = path.join(chatDir, "chat-store.json");
      await withFileLock(sessionFile, async () => {
        await atomicWriteFile(sessionFile, JSON.stringify(payload, null, 2));
      });
      
      if (payload && typeof payload === "object") {
        await withFileLock(storeFile, async () => {
          await upsertChatStoreIndexEntry(chatDir, resolved, payload as Record<string, unknown>, sessionId, {
            activeSessionId,
          });
        });
        const indexAfter = await fs.promises.readFile(storeFile, "utf-8").catch(() => null);
        let indexSessionIds: string[] = [];
        if (indexAfter) {
          try {
            const parsed = JSON.parse(indexAfter) as { sessions?: Array<{ id?: string }> };
            indexSessionIds = (parsed.sessions || []).map((s) => s.id || "").filter(Boolean);
          } catch { /* ignore */ }
        }
        sessionDiagServer("backend:chat-session-sync:done", {
          projectPath,
          sessionId,
          activeSessionId,
          indexSessionIds,
        });
      }
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "写入会话文件失败" });
    }
  });

  // POST /backend/vibe/chat-session-delete — 立即删除磁盘 session 文件并 patch index
  middlewares.use("/backend/vibe/chat-session-delete", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as {
        projectPath?: string;
        sessionId?: string;
        activeSessionId?: string;
      };
      const projectPath = (body.projectPath || "").trim();
      const sessionId = (body.sessionId || "").trim();
      const activeSessionId = (body.activeSessionId || "").trim();
      if (!projectPath || !sessionId) {
        sendJson(res, 400, { ok: false, error: "缺少 projectPath 或 sessionId" });
        return;
      }

      const resolved = path.resolve(projectPath);
      const chatDir = AIALL_DATA_DIR;
      const storeFile = path.join(chatDir, "chat-store.json");

      sessionDiagServer("backend:chat-session-delete:start", {
        projectPath,
        sessionId,
        activeSessionId,
      });

      const index = await withFileLock(storeFile, async () =>
        deleteChatStoreSession(chatDir, projectPath, sessionId, {
          activeSessionId: activeSessionId || undefined,
        }),
      );
      invalidateChatStoreCache(resolved);

      sessionDiagServer("backend:chat-session-delete:done", {
        projectPath,
        sessionId,
        activeSessionId: index.activeSessionId,
        indexSessionIds: index.sessions.map((s) => s.id),
      });

      sendJson(res, 200, {
        ok: true,
        activeSessionId: index.activeSessionId,
        sessionCount: index.sessions.length,
        syncedAt: index.syncedAt,
        sessions: index.sessions.map((s) => ({
          id: s.id,
          title: s.title,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          messageCount: s.messageCount,
          status: s.status,
        })),
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : "删除会话文件失败",
      });
    }
  });

  // POST /backend/vibe/agent/run
  middlewares.use("/backend/vibe/agent/run", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    let body: {
      prompt?: string;
      history?: Array<{ role?: string; content?: string }>;
      projectPath?: string;
      endpoint?: string;
      apiKey?: string;
      model?: string;
      mode?: "ask" | "build";
      maxTurns?: number;
      openFilePath?: string;
      imageDataUrls?: string[];
      webProxyUrl?: string;
      runProfile?: {
        kind?: "interactive" | "execute_plan";
        targetFiles?: string[];
        userIntent?: string;
      };
      executionMode?: boolean;
    };

    try {
      body = (await readJsonBody(req)) as typeof body;
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "解析请求体失败" });
      return;
    }

    const prompt = (body.prompt || "").trim();
    const projectPath = (body.projectPath || "").trim();
    const endpoint = (body.endpoint || "").trim();
    const model = (body.model || "").trim();
    const imageDataUrls = Array.isArray(body.imageDataUrls)
      ? body.imageDataUrls.filter((url): url is string => typeof url === "string" && url.startsWith("data:image/"))
      : undefined;

    if ((!prompt && !imageDataUrls?.length) || !projectPath || !endpoint || !model) {
      sendJson(res, 400, { error: "缺少 prompt、projectPath、endpoint 或 model" });
      return;
    }

    // Open SSE immediately so the client leaves "connecting_local" before slow validation/agent work.
    sendSseHeaders(res);
    sendSseEvent(res, "status", { phase: "connected" });
    try { fs.appendFileSync(".debug.log", `[${new Date().toISOString()}] [agent-route] SSE opened, projectPath=${projectPath} model=${model}\n`); } catch {}

    const resolvedRoot = path.resolve(projectPath);
    const rootStat = await fs.promises.stat(resolvedRoot).catch(() => null);
    if (!rootStat?.isDirectory()) {
      try { fs.appendFileSync(".debug.log", `[${new Date().toISOString()}] [agent-route] projectPath invalid: ${resolvedRoot}\n`); } catch {}
      sendSseEvent(res, "error", { message: "projectPath 不是有效目录" });
      sendSseEvent(res, "done", { writtenFiles: [], turns: 0 });
      res.end();
      return;
    }
    try { fs.appendFileSync(".debug.log", `[${new Date().toISOString()}] [agent-route] projectPath OK, calling runVibeAgent...\n`); } catch {}

    const controller = new AbortController();
    let keepaliveTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
      try {
        sendSseComment(res);
      } catch {
        if (keepaliveTimer) {
          clearInterval(keepaliveTimer);
          keepaliveTimer = null;
        }
      }
    }, AGENT_SSE_KEEPALIVE_MS);
    const stopKeepalive = () => {
      if (keepaliveTimer) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
      }
    };
    const abort = () => controller.abort();
    req.on("close", abort);
    res.on("close", () => {
      stopKeepalive();
      abort();
    });

    try {
      const mode: VibeChatMode =
        body.mode === "ask" || body.mode === "plan" || body.mode === "explore" ? body.mode : "build";
      try { fs.appendFileSync(".debug.log", `[${new Date().toISOString()}] [agent-route] mode=${mode} prompt="${prompt.slice(0, 80)}"\n`); } catch {}

      const history = Array.isArray(body.history)
        ? body.history
            .filter(
              (m): m is { role: "user" | "assistant"; content: string } =>
                (m.role === "user" || m.role === "assistant") && Boolean(String(m.content || "").trim()),
            )
            .map((m) => ({ role: m.role, content: String(m.content).trim() }))
        : undefined;

      try { fs.appendFileSync(".debug.log", `[${new Date().toISOString()}] [agent-route] calling runVibeAgent...\n`); } catch {}
      await runVibeAgent({
        projectRoot: resolvedRoot,
        prompt,
        history,
        openFilePath: body.openFilePath?.trim() || undefined,
        endpoint,
        apiKey: body.apiKey || "",
        model,
        mode,
        maxTurns: body.maxTurns,
        imageDataUrls,
        webProxyUrl: body.webProxyUrl?.trim() || undefined,
        runProfile:
          body.runProfile?.kind === "execute_plan"
            ? {
                kind: "execute_plan",
                targetFiles: Array.isArray(body.runProfile.targetFiles)
                  ? body.runProfile.targetFiles.map((p) => String(p).trim()).filter(Boolean)
                  : undefined,
                userIntent: body.runProfile.userIntent?.trim() || undefined,
              }
            : body.executionMode
              ? { kind: "execute_plan" }
              : undefined,
        executionMode: body.executionMode === true,
        signal: controller.signal,
        onEvent: (event) => {
          try {
            sendSseEvent(res, event.type, event.data);
          } catch {
            // client disconnected
          }
        },
      });
    } catch (error) {
      try { fs.appendFileSync(".debug.log", `[${new Date().toISOString()}] [agent-route] runVibeAgent ERROR: ${error instanceof Error ? error.message : String(error)}\n`); } catch {}
      try {
        sendSseEvent(res, "error", {
          message: error instanceof Error ? error.message : "Agent 运行失败",
        });
      } catch {
        // ignore
      }
      try {
        sendSseEvent(res, "done", { writtenFiles: [], pendingFiles: [], turns: 0 });
      } catch {
        // ignore
      }
    } finally {
      stopKeepalive();
    }

    try {
      res.end();
    } catch {
      // ignore
    }
  });

  // GET/POST /backend/vibe/project-memory
  middlewares.use("/backend/vibe/project-memory", async (req, res) => {
    try {
      if (req.method === "GET") {
        const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
        const projectPath = (url.searchParams.get("projectPath") || "").trim();
        if (!projectPath) {
          sendJson(res, 400, { ok: false, error: "缺少 projectPath" });
          return;
        }
        const result = await readProjectMemory(projectPath);
        if (!result.ok) {
          sendJson(res, 400, result);
          return;
        }
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST") {
        const body = (await readJsonBody(req)) as {
          projectPath?: string;
          content?: string;
          appendSection?: string;
          appendLines?: string[];
        };
        const projectPath = body.projectPath?.trim() || "";
        if (!projectPath) {
          sendJson(res, 400, { ok: false, error: "缺少 projectPath" });
          return;
        }

        const appendSection = String(body.appendSection ?? "").trim();
        const appendLines = Array.isArray(body.appendLines)
          ? body.appendLines.map((line) => String(line ?? "").trim()).filter(Boolean)
          : [];

        if (appendSection && appendLines.length) {
          if (!isProjectMemorySection(appendSection)) {
            sendJson(res, 400, { ok: false, error: "appendSection 须为 术语、导航 或 偏好" });
            return;
          }
          const result = await appendProjectMemory(projectPath, appendSection, appendLines);
          if (!result.ok) {
            sendJson(res, 400, result);
            return;
          }
          const readBack = await readProjectMemory(projectPath);
          sendJson(res, 200, {
            ok: true,
            path: result.path,
            size: result.size,
            truncated: result.truncated,
            content: readBack.ok ? readBack.content : "",
            maxChars: readBack.ok ? readBack.maxChars : undefined,
          });
          return;
        }

        const result = await writeProjectMemory(projectPath, body.content ?? "");
        if (!result.ok) {
          sendJson(res, 400, result);
          return;
        }
        sendJson(res, 200, result);
        return;
      }

      sendJson(res, 405, { ok: false, error: "仅支持 GET / POST" });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : "项目记忆操作失败",
      });
    }
  });

  // GET/POST /backend/vibe/project-knowledge
  middlewares.use("/backend/vibe/project-knowledge", async (req, res) => {
    try {
      if (req.method === "GET") {
        const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
        const projectPath = (url.searchParams.get("projectPath") || "").trim();
        if (!projectPath) {
          sendJson(res, 400, { ok: false, error: "缺少 projectPath" });
          return;
        }
        const result = await readProjectKnowledge(projectPath);
        if (!result.ok) {
          sendJson(res, 400, result);
          return;
        }
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST") {
        const body = (await readJsonBody(req)) as {
          projectPath?: string;
          body?: string;
          content?: string;
          gitHead?: string;
          fromExplore?: boolean;
          exploreRounds?: number;
        };
        const projectPath = body.projectPath?.trim() || "";
        if (!projectPath) {
          sendJson(res, 400, { ok: false, error: "缺少 projectPath" });
          return;
        }

        const knowledgeBody = String(body.body ?? body.content ?? "");
        const result = await writeProjectKnowledge(projectPath, knowledgeBody, {
          gitHead: body.gitHead?.trim() || undefined,
          fromExplore: Boolean(body.fromExplore),
          exploreRounds:
            typeof body.exploreRounds === "number" ? body.exploreRounds : undefined,
        });
        if (!result.ok) {
          sendJson(res, 400, result);
          return;
        }
        const readBack = await readProjectKnowledge(projectPath);
        sendJson(res, 200, {
          ok: true,
          path: result.path,
          size: result.size,
          truncated: result.truncated,
          meta: result.meta,
          content: readBack.ok ? readBack.content : "",
          body: readBack.ok ? readBack.body : knowledgeBody,
          maxChars: readBack.ok ? readBack.maxChars : undefined,
          promptMaxChars: readBack.ok ? readBack.promptMaxChars : undefined,
        });
        return;
      }

      sendJson(res, 405, { ok: false, error: "仅支持 GET / POST" });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : "项目知识库操作失败",
      });
    }
  });

  // GET /backend/vibe/project-architect-review/context
  middlewares.use("/backend/vibe/project-architect-review/context", async (req, res) => {
    try {
      if (req.method !== "GET") {
        sendJson(res, 405, { ok: false, error: "仅支持 GET" });
        return;
      }
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const projectPath = (url.searchParams.get("projectPath") || "").trim();
      if (!projectPath) {
        sendJson(res, 400, { ok: false, error: "缺少 projectPath" });
        return;
      }
      const result = await buildArchitectReviewContext(projectPath);
      if (result.ok) {
        // Invalidate read cache so the next GET picks up fresh data after the review completes.
        invalidateArchitectReviewCache(projectPath);
      }
      sendJson(res, result.ok ? 200 : 400, result);
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : "获取架构评审上下文失败",
      });
    }
  });

  // GET/DELETE /backend/vibe/project-architect-review/history
  // MUST be registered before the generic /backend/vibe/project-architect-review handler
  // to avoid the generic handler catching /history requests.
  middlewares.use("/backend/vibe/project-architect-review/history", async (req, res) => {
    try {
      if (req.method === "GET") {
        const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
        const projectPath = (url.searchParams.get("projectPath") || "").trim();
        const reviewId = (url.searchParams.get("reviewId") || "").trim();
        if (!projectPath) {
          sendJson(res, 400, { ok: false, error: "缺少 projectPath" });
          return;
        }
        if (reviewId) {
          const result = await getReviewHistoryDetail(projectPath, reviewId);
          sendJson(res, result.ok ? 200 : 404, result);
          return;
        }
        const result = await listReviewHistory(projectPath);
        sendJson(res, result.ok ? 200 : 400, result);
        return;
      }

      if (req.method === "DELETE") {
        const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
        const projectPath = (url.searchParams.get("projectPath") || "").trim();
        const reviewId = (url.searchParams.get("reviewId") || "").trim();
        if (!projectPath || !reviewId) {
          sendJson(res, 400, { ok: false, error: "缺少 projectPath 或 reviewId" });
          return;
        }
        const result = await deleteReviewFromHistory(projectPath, reviewId);
        sendJson(res, result.ok ? 200 : 400, result);
        return;
      }

      sendJson(res, 405, { ok: false, error: "仅支持 GET / DELETE" });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : "评审历史操作失败",
      });
    }
  });

  // GET/POST /backend/vibe/project-architect-review
  middlewares.use("/backend/vibe/project-architect-review", async (req, res) => {
    try {
      if (req.method === "GET") {
        const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
        const projectPath = (url.searchParams.get("projectPath") || "").trim();
        if (!projectPath) {
          sendJson(res, 400, { ok: false, error: "缺少 projectPath" });
          return;
        }
        const result = await readArchitectReview(projectPath);
        sendJson(res, result.ok ? 200 : 400, result);
        return;
      }

      if (req.method === "POST") {
        const body = (await readJsonBody(req)) as {
          projectPath?: string;
          body?: string;
          content?: string;
          gitHead?: string;
          fromReview?: boolean;
          verdict?: "on_track" | "caution" | "off_track";
          commitCount?: number;
          changedFileCount?: number;
        };
        const projectPath = body.projectPath?.trim() || "";
        if (!projectPath) {
          sendJson(res, 400, { ok: false, error: "缺少 projectPath" });
          return;
        }

        const reviewBody = String(body.body ?? body.content ?? "");
        const result = await writeArchitectReview(projectPath, reviewBody, {
          gitHead: body.gitHead?.trim() || undefined,
          fromReview: Boolean(body.fromReview),
          verdict: body.verdict,
        });
        if (!result.ok) {
          sendJson(res, 400, result);
          return;
        }

        // Save to history if fromReview is true
        if (body.fromReview && reviewBody.trim()) {
          const historyResult = await saveReviewToHistory(projectPath, reviewBody, {
            gitHead: body.gitHead?.trim() || result.meta?.gitHead?.trim() || undefined,
            verdict: body.verdict ?? result.meta?.verdict,
            commitCount: body.commitCount,
            changedFileCount: body.changedFileCount,
          });
          if (!historyResult.ok) {
            console.error("[architect-review] saveReviewToHistory failed:", historyResult.error);
          }
        }

        const readBack = await readArchitectReview(projectPath);
        sendJson(res, 200, {
          ok: true,
          path: result.path,
          size: result.size,
          truncated: result.truncated,
          meta: result.meta,
          content: readBack.ok ? readBack.content : "",
          body: readBack.ok ? readBack.body : reviewBody,
          maxChars: readBack.ok ? readBack.maxChars : undefined,
        });
        return;
      }

      sendJson(res, 405, { ok: false, error: "仅支持 GET / POST" });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : "架构评审报告操作失败",
      });
    }
  });

  // GET/POST /backend/vibe/project-skills
  middlewares.use("/backend/vibe/project-skills", async (req, res) => {
    try {
      if (req.method === "GET") {
        const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
        const projectPath = (url.searchParams.get("projectPath") || "").trim();
        const slug = (url.searchParams.get("slug") || "").trim();
        if (!projectPath) {
          sendJson(res, 400, { ok: false, error: "缺少 projectPath" });
          return;
        }
        if (slug) {
          const result = await readProjectSkill(projectPath, slug);
          sendJson(res, result.ok ? 200 : 400, result);
          return;
        }
        const result = await listProjectSkills(projectPath);
        sendJson(res, result.ok ? 200 : 400, result);
        return;
      }

      if (req.method === "POST") {
        const body = (await readJsonBody(req)) as {
          projectPath?: string;
          action?: string;
          slug?: string;
          kind?: string;
          title?: string;
          content?: string;
          filename?: string;
          archiveContent?: string;
          readCount?: number;
          writtenCount?: number;
        };
        const projectPath = body.projectPath?.trim() || "";
        if (!projectPath) {
          sendJson(res, 400, { ok: false, error: "缺少 projectPath" });
          return;
        }

        const action = String(body.action ?? "upsert").trim();

        if (action === "archive") {
          const filename = String(body.filename ?? "").trim();
          const archiveContent = String(body.archiveContent ?? "");
          if (!filename || !archiveContent.trim()) {
            sendJson(res, 400, { ok: false, error: "缺少 filename 或 archiveContent" });
            return;
          }
          const result = await archiveExplorationNote(projectPath, filename, archiveContent, {
            readCount: Math.max(0, Number(body.readCount) || 0),
            writtenCount: Math.max(0, Number(body.writtenCount) || 0),
          });
          sendJson(res, result.ok ? 200 : 400, result);
          return;
        }

        const slug = String(body.slug ?? "").trim();
        const kind = String(body.kind ?? "").trim();
        const title = String(body.title ?? "").trim();
        const content = String(body.content ?? "").trim();
        if (!slug || !title || !content) {
          sendJson(res, 400, { ok: false, error: "缺少 slug / title / content" });
          return;
        }
        if (kind !== "fact" && kind !== "heuristic" && kind !== "preference") {
          sendJson(res, 400, { ok: false, error: "kind 须为 fact、heuristic 或 preference" });
          return;
        }
        const result = await upsertProjectSkill(projectPath, slug, { kind, title }, content);
        sendJson(res, result.ok ? 200 : 400, result);
        return;
      }

      sendJson(res, 405, { ok: false, error: "仅支持 GET / POST" });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : "项目 skills 操作失败",
      });
    }
  });

  // POST /backend/vibe/memory-usage
  middlewares.use("/backend/vibe/memory-usage", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "仅支持 POST 请求" });
      return;
    }
    try {
      const { trackMemoryUsage, getMemoryUsageStore } = await import("./server/memoryUsageTracker.js");
      const body = (await readJsonBody(req)) as {
        projectPath?: string;
        memoryContent?: string;
        assistantResponse?: string;
      };
      const projectPath = body.projectPath?.trim() || "";
      if (!projectPath) {
        sendJson(res, 400, { ok: false, error: "缺少 projectPath" });
        return;
      }
      if (body.memoryContent && body.assistantResponse) {
        await trackMemoryUsage(projectPath, body.memoryContent, body.assistantResponse);
      }
      const store = await getMemoryUsageStore(projectPath);
      sendJson(res, 200, { ok: true, entries: store.entries });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "记忆使用追踪失败" });
    }
  });

  // GET /backend/vibe/project-health-scan
  middlewares.use("/backend/vibe/project-health-scan", async (req, res) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "", "http://localhost");
      const projectPath = url.searchParams.get("projectPath")?.trim();
      if (!projectPath) {
        sendJson(res, 400, { ok: false, error: "缺少 projectPath 参数" });
        return;
      }

      const result = await scanProjectHealth(projectPath);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : "项目体检失败",
      });
    }
  });

  // POST /backend/vibe/project-context
  middlewares.use("/backend/vibe/project-context", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const result = await buildProjectContext(body.path.trim());
      if (!result.ok) {
        sendJson(res, 400, result);
        return;
      }

      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "收集项目上下文失败" });
    }
  });

  // POST /backend/vibe/open-folder
  middlewares.use("/backend/vibe/open-folder", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }
    try {
      const body = (await readJsonBody(req)) as { path?: string };
      const folderPath = body.path?.trim() || "";
      if (!folderPath) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }
      const result = await openFolderInExplorer(folderPath);
      sendJson(res, result.ok ? 200 : 400, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "打开文件夹失败" });
    }
  });

  // POST /backend/vibe/pick-folder
  middlewares.use("/backend/vibe/pick-folder", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    console.log(`[aiall-debug] /backend/vibe/pick-folder hit`);
    debugLog(`/backend/vibe/pick-folder hit`);
    try {
      let initialPath = "";
      try {
        const body = (await readJsonBody(req)) as { initialPath?: string };
        initialPath = body.initialPath?.trim() || "";
      } catch {
        // empty body is fine
      }

      console.log(`[aiall-debug] calling pickProjectFolder(initialPath=${JSON.stringify(initialPath)})`);
      debugLog(`calling pickProjectFolder(initialPath=${JSON.stringify(initialPath)})`);
      const result = await pickProjectFolder(initialPath);
      console.log(`[aiall-debug] pickProjectFolder result:`, JSON.stringify(result));
      debugLog(`pickProjectFolder result: ${JSON.stringify(result)}`);
      if (result.cancelled) {
        sendJson(res, 200, { ok: false, cancelled: true });
        return;
      }
      if (!result.ok || !result.path) {
        sendJson(res, 500, { ok: false, error: result.error || "未选择文件夹" });
        return;
      }

      const resolved = path.resolve(result.path);
      const stat = await fs.promises.stat(resolved).catch(() => null);
      if (!stat || !stat.isDirectory()) {
        sendJson(res, 400, { ok: false, error: "所选路径不是有效文件夹" });
        return;
      }

      sendJson(res, 200, { ok: true, path: resolved });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "打开文件夹选择器失败" });
    }
  });

  // File operations, Git, and File watcher routes are registered in dedicated modules
  registerFileOpsRoutes(middlewares);
  registerGitRoutes(middlewares);
  registerFileWatcherRoutes(middlewares);
}
