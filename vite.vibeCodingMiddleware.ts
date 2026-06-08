import type { Connect } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { readJsonBody, sendJson, sendSseEvent, sendSseComment, sendSseHeaders } from "./server/httpUtils";
import { chatCompletionWithTools, resolveChatEndpoint } from "./server/aiForward";
import { runVibeAgent } from "./server/vibeAgent";
import { buildProjectContext } from "./server/vibeProjectContext";
import {
  grepInProject,
  listDirectory,
  readFileContent,
  searchFiles,
  writeFileContent,
} from "./server/vibeFs";
import { gitStatus, gitDiff, gitDiffFile, gitDiffContent, gitCommitFileDiff, gitCommit, gitLog, gitIsRepo, gitAdd, gitReset, gitDiscard, gitDiscardAll, gitRemotes, gitFetch, gitPull, gitPush, gitStashList, gitStashSave, gitStashPop, gitStashDrop } from "./server/vibeGit";

const execFileAsync = promisify(execFile);

const DEBUG_LOG = path.join(os.tmpdir(), "aiall-debug.log");
function debugLog(msg: string) {
  fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`);
}
debugLog("=== middleware loaded v2 ===");

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
  // GET /backend/vibe/chat-store-load
  middlewares.use("/backend/vibe/chat-store-load", async (req, res) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const projectPath = (url.searchParams.get("projectPath") || "").trim();
      if (!projectPath) {
        sendJson(res, 400, { ok: false, error: "缺少 projectPath" });
        return;
      }

      const resolved = path.resolve(projectPath);
      const chatDir = path.join(resolved, ".aiall", "vibe-chat-sessions");
      const storeFile = path.join(chatDir, "chat-store.json");
      const raw = await fs.promises.readFile(storeFile, "utf-8").catch(() => null);
      if (!raw) {
        sendJson(res, 404, { ok: false, error: "未找到 chat-store.json" });
        return;
      }

      const index = JSON.parse(raw) as {
        version?: number;
        projectPath?: string;
        activeSessionId?: string;
        sessions?: Array<{
          id?: string;
          title?: string;
          createdAt?: string;
          updatedAt?: string;
          messageCount?: number;
          file?: string;
        }>;
      };
      const metas = Array.isArray(index.sessions) ? index.sessions : [];
      const sessions: Array<{
        id: string;
        title: string;
        createdAt: string;
        updatedAt: string;
        messageCount: number;
        messages: unknown[];
      }> = [];

      for (const meta of metas) {
        const id = (meta.id || "").trim();
        const fileName = (meta.file || (id ? `chat-${safeFilePart(id)}.json` : "")).trim();
        if (!fileName) continue;
        const sessionFile = path.join(chatDir, fileName);
        const sessionRaw = await fs.promises.readFile(sessionFile, "utf-8").catch(() => null);
        if (!sessionRaw) continue;
        const sessionData = JSON.parse(sessionRaw) as { messages?: unknown[] };
        sessions.push({
          id,
          title: meta.title || "新会话",
          createdAt: meta.createdAt || "",
          updatedAt: meta.updatedAt || "",
          messageCount: Array.isArray(sessionData.messages) ? sessionData.messages.length : 0,
          messages: Array.isArray(sessionData.messages) ? sessionData.messages : [],
        });
      }

      if (!sessions.length) {
        sendJson(res, 404, { ok: false, error: "会话目录为空" });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        data: {
          version: index.version || 2,
          projectPath,
          activeSessionId: index.activeSessionId || sessions[0].id,
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
          sessions?: Array<{
            id?: string;
            title?: string;
            createdAt?: string;
            updatedAt?: string;
            messageCount?: number;
            messages?: unknown;
          }>;
        };
      };
      const projectPath = (body.projectPath || "").trim();
      debugLog(`/backend/vibe/chat-store-sync hit, projectPath="${projectPath}"`);
      if (!projectPath) {
        sendJson(res, 400, { ok: false, error: "缺少 projectPath" });
        return;
      }

      const resolved = path.resolve(projectPath);
      const chatDir = path.join(resolved, ".aiall", "vibe-chat-sessions");
      await fs.promises.mkdir(chatDir, { recursive: true });
      const storeFile = path.join(chatDir, "chat-store.json");
      const sessions = Array.isArray(body.data?.sessions) ? body.data.sessions : [];
      debugLog(`chat-store-sync writing ${sessions.length} sessions to ${chatDir}`);
      const index = {
        syncedAt: new Date().toISOString(),
        version: body.data?.version || 2,
        projectPath,
        activeSessionId: body.data?.activeSessionId || "",
        sessions: sessions.map((session) => {
          const id = session.id || "";
          return {
            id,
            title: session.title || "新会话",
            createdAt: session.createdAt || "",
            updatedAt: session.updatedAt || "",
            messageCount: typeof session.messageCount === "number" ? session.messageCount : 0,
            file: id ? `chat-${safeFilePart(id)}.json` : "",
          };
        }),
      };
      await fs.promises.writeFile(
        storeFile,
        JSON.stringify(index, null, 2),
        "utf-8",
      );
      for (const session of sessions) {
        const id = (session.id || "").trim();
        if (!id) continue;
        const sessionFile = path.join(chatDir, `chat-${safeFilePart(id)}.json`);
        await fs.promises.writeFile(
          sessionFile,
          JSON.stringify(
            {
              id,
              title: session.title || "新会话",
              createdAt: session.createdAt || "",
              updatedAt: session.updatedAt || "",
              messages: Array.isArray(session.messages) ? session.messages : [],
            },
            null,
            2,
          ),
          "utf-8",
        );
      }
      debugLog(`chat-store-sync done, path=${chatDir}`);
      sendJson(res, 200, { ok: true, path: chatDir, sessionCount: sessions.length });
    } catch (error) {
      debugLog(`chat-store-sync error: ${error instanceof Error ? error.message : String(error)}`);
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "写入会话库失败" });
    }
  });

  // POST /backend/vibe/chat-session-sync
  middlewares.use("/backend/vibe/chat-session-sync", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { projectPath?: string; sessionId?: string; data?: unknown };
      const projectPath = (body.projectPath || "").trim();
      const sessionId = (body.sessionId || "").trim();
      if (!projectPath || !sessionId) {
        sendJson(res, 400, { ok: false, error: "缺少 projectPath 或 sessionId" });
        return;
      }

      const resolved = path.resolve(projectPath);
      const chatDir = path.join(resolved, ".aiall", "vibe-chat-sessions");
      await fs.promises.mkdir(chatDir, { recursive: true });
      const safeId = safeFilePart(sessionId);
      const sessionFile = path.join(chatDir, `chat-${safeId}.json`);
      await fs.promises.writeFile(sessionFile, JSON.stringify(body.data, null, 2), "utf-8");
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "写入会话文件失败" });
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

    const resolvedRoot = path.resolve(projectPath);
    const rootStat = await fs.promises.stat(resolvedRoot).catch(() => null);
    if (!rootStat?.isDirectory()) {
      sendSseEvent(res, "error", { message: "projectPath 不是有效目录" });
      sendSseEvent(res, "done", { writtenFiles: [], turns: 0 });
      res.end();
      return;
    }

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
      const mode = body.mode === "ask" ? "ask" : "build";

      const history = Array.isArray(body.history)
        ? body.history
            .filter(
              (m): m is { role: "user" | "assistant"; content: string } =>
                (m.role === "user" || m.role === "assistant") && Boolean(String(m.content || "").trim()),
            )
            .map((m) => ({ role: m.role, content: String(m.content).trim() }))
        : undefined;

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
      try {
        sendSseEvent(res, "error", {
          message: error instanceof Error ? error.message : "Agent 运行失败",
        });
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

  // GET /backend/vibe/list
  middlewares.use("/backend/vibe/list", async (req, res) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const dirPath = url.searchParams.get("path") || "";

      if (!dirPath) {
        sendJson(res, 400, { error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(dirPath);
      const stat = await fs.promises.stat(resolved).catch(() => null);
      if (!stat || !stat.isDirectory()) {
        sendJson(res, 400, { error: "路径不存在或不是目录" });
        return;
      }

      const items = await listDirectory(resolved);
      sendJson(res, 200, { ok: true, path: resolved, items });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "读取目录失败" });
    }
  });

  // POST /backend/vibe/read
  middlewares.use("/backend/vibe/read", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; projectRoot?: string };
      if (!body.path) {
        sendJson(res, 400, { error: "缺少 path 参数" });
        return;
      }

      const resolvedPath = resolvePathInsideOptionalRoot(body.path, body.projectRoot);
      if (!resolvedPath.ok) {
        sendJson(res, 400, { error: resolvedPath.error });
        return;
      }
      const resolved = resolvedPath.path;
      const stat = await fs.promises.stat(resolved).catch(() => null);
      if (!stat || !stat.isFile()) {
        sendJson(res, 400, { error: "文件不存在" });
        return;
      }

      const result = await readFileContent(resolved);
      if (!result.ok) {
        sendJson(res, 400, { error: result.error, size: result.size });
        return;
      }

      sendJson(res, 200, { ok: true, content: result.content, size: result.size, path: resolved });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "读取文件失败" });
    }
  });

  // POST /backend/vibe/write
  middlewares.use("/backend/vibe/write", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; content?: string; projectRoot?: string };
      if (!body.path || body.content === undefined) {
        sendJson(res, 400, { error: "缺少 path 或 content 参数" });
        return;
      }

      const resolvedPath = resolvePathInsideOptionalRoot(body.path, body.projectRoot);
      if (!resolvedPath.ok) {
        sendJson(res, 400, { error: resolvedPath.error });
        return;
      }
      const resolved = resolvedPath.path;
      const result = await writeFileContent(resolved, body.content);
      sendJson(res, 200, { ok: true, size: result.size, path: resolved });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "写入文件失败" });
    }
  });

  // GET /backend/vibe/search
  middlewares.use("/backend/vibe/search", async (req, res) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const dirPath = url.searchParams.get("path") || "";
      const query = url.searchParams.get("q") || "";

      if (!dirPath || !query) {
        sendJson(res, 400, { error: "缺少 path 或 q 参数" });
        return;
      }

      const resolved = path.resolve(dirPath);
      const results = await searchFiles(resolved, query);
      sendJson(res, 200, { ok: true, results });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "搜索失败" });
    }
  });

  // GET /backend/vibe/grep
  middlewares.use("/backend/vibe/grep", async (req, res) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const dirPath = url.searchParams.get("path") || "";
      const pattern = url.searchParams.get("q") || "";

      if (!dirPath || !pattern.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 或 q 参数" });
        return;
      }

      const resolved = path.resolve(dirPath);
      const stat = await fs.promises.stat(resolved).catch(() => null);
      if (!stat || !stat.isDirectory()) {
        sendJson(res, 400, { ok: false, error: "路径不存在或不是目录" });
        return;
      }

      const result = await grepInProject(resolved, pattern.trim());
      if (!result.ok) {
        sendJson(res, 400, { ok: false, error: result.error });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        results: result.matches.map((m) => ({
          path: m.file,
          relative: m.relative,
          line: m.line,
          text: m.text,
        })),
      });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "搜索失败" });
    }
  });

  // POST /backend/vibe/create
  middlewares.use("/backend/vibe/create", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; isDirectory?: boolean; content?: string; projectRoot?: string };
      if (!body.path) {
        sendJson(res, 400, { error: "缺少 path 参数" });
        return;
      }

      const resolvedPath = resolvePathInsideOptionalRoot(body.path, body.projectRoot);
      if (!resolvedPath.ok) {
        sendJson(res, 400, { error: resolvedPath.error });
        return;
      }
      const resolved = resolvedPath.path;

      if (body.isDirectory) {
        await fs.promises.mkdir(resolved, { recursive: true });
        sendJson(res, 200, { ok: true, path: resolved, type: "directory" });
      } else {
        const dir = path.dirname(resolved);
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(resolved, body.content || "", "utf-8");
        sendJson(res, 200, { ok: true, path: resolved, type: "file" });
      }
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "创建失败" });
    }
  });

  // DELETE /backend/vibe/delete
  middlewares.use("/backend/vibe/delete", async (req, res) => {
    if (req.method !== "DELETE") {
      sendJson(res, 405, { error: "仅支持 DELETE 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const targetPath = url.searchParams.get("path") || "";
      const projectRoot = url.searchParams.get("projectRoot") || undefined;

      if (!targetPath) {
        sendJson(res, 400, { error: "缺少 path 参数" });
        return;
      }

      const resolvedPath = resolvePathInsideOptionalRoot(targetPath, projectRoot);
      if (!resolvedPath.ok) {
        sendJson(res, 400, { error: resolvedPath.error });
        return;
      }
      const resolved = resolvedPath.path;
      const stat = await fs.promises.stat(resolved).catch(() => null);
      if (!stat) {
        sendJson(res, 404, { error: "文件或目录不存在" });
        return;
      }

      if (stat.isDirectory()) {
        await fs.promises.rm(resolved, { recursive: true, force: true });
      } else {
        await fs.promises.unlink(resolved);
      }

      sendJson(res, 200, { ok: true, path: resolved });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "删除失败" });
    }
  });

  // POST /backend/vibe/rename
  middlewares.use("/backend/vibe/rename", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { from?: string; to?: string; projectRoot?: string };
      const fromPath = (body.from || "").trim();
      const toPath = (body.to || "").trim();

      if (!fromPath || !toPath) {
        sendJson(res, 400, { error: "缺少 from 或 to 参数" });
        return;
      }

      const resolvedFromPath = resolvePathInsideOptionalRoot(fromPath, body.projectRoot);
      const resolvedToPath = resolvePathInsideOptionalRoot(toPath, body.projectRoot);
      if (!resolvedFromPath.ok || !resolvedToPath.ok) {
        sendJson(res, 400, { error: !resolvedFromPath.ok ? resolvedFromPath.error : resolvedToPath.error });
        return;
      }
      const resolvedFrom = resolvedFromPath.path;
      const resolvedTo = resolvedToPath.path;

      const stat = await fs.promises.stat(resolvedFrom).catch(() => null);
      if (!stat) {
        sendJson(res, 404, { error: "源路径不存在" });
        return;
      }

      await fs.promises.mkdir(path.dirname(resolvedTo), { recursive: true });
      await fs.promises.rename(resolvedFrom, resolvedTo);
      sendJson(res, 200, { ok: true, from: resolvedFrom, to: resolvedTo });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "重命名失败" });
    }
  });

  // GET /backend/vibe/git/status
  middlewares.use("/backend/vibe/git/status", async (req, res) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const projectPath = url.searchParams.get("path") || "";

      if (!projectPath) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(projectPath);
      const stat = await fs.promises.stat(resolved).catch(() => null);
      if (!stat || !stat.isDirectory()) {
        sendJson(res, 400, { ok: false, error: "路径不存在或不是目录" });
        return;
      }

      const isRepo = await gitIsRepo(resolved);
      if (!isRepo) {
        sendJson(res, 200, { ok: true, branch: "", files: [], isRepo: false });
        return;
      }

      const result = await gitStatus(resolved);
      sendJson(res, 200, { ...result, isRepo: true });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "获取 Git 状态失败" });
    }
  });

  // GET /backend/vibe/git/diff
  middlewares.use("/backend/vibe/git/diff", async (req, res) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const projectPath = url.searchParams.get("path") || "";
      const filePath = url.searchParams.get("file") || undefined;
      const staged = url.searchParams.get("staged") === "1";

      if (!projectPath) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(projectPath);
      const result = filePath ? await gitDiffFile(resolved, filePath, staged) : await gitDiff(resolved, undefined, staged);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "获取 diff 失败" });
    }
  });

  // GET /backend/vibe/git/diff-content
  middlewares.use("/backend/vibe/git/diff-content", async (req, res) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const projectPath = url.searchParams.get("path") || "";
      const filePath = url.searchParams.get("file") || "";
      const staged = url.searchParams.get("staged") === "1";

      if (!projectPath || !filePath) {
        sendJson(res, 400, { ok: false, error: "缺少 path 或 file 参数" });
        return;
      }

      const resolved = path.resolve(projectPath);
      const result = await gitDiffContent(resolved, filePath, staged);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "获取文件内容失败" });
    }
  });

  // GET /backend/vibe/git/commit-file-diff
  middlewares.use("/backend/vibe/git/commit-file-diff", async (req, res) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const projectPath = url.searchParams.get("path") || "";
      const hash = url.searchParams.get("hash") || "";
      const filePath = url.searchParams.get("file") || "";
      const oldPath = url.searchParams.get("oldFile") || undefined;

      if (!projectPath || !hash || !filePath) {
        sendJson(res, 400, { ok: false, error: "缺少 path、hash 或 file 参数" });
        return;
      }

      const resolved = path.resolve(projectPath);
      const result = await gitCommitFileDiff(resolved, hash, filePath, oldPath);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "获取提交文件 diff 失败" });
    }
  });

  // POST /backend/vibe/git/generate-message
  middlewares.use("/backend/vibe/git/generate-message", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as {
        path?: string;
        endpoint?: string;
        apiKey?: string;
        model?: string;
      };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }
      if (!body.endpoint?.trim() || !body.model?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 AI 配置" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const statusResult = await gitStatus(resolved);
      if (!statusResult.ok) {
        sendJson(res, 400, { ok: false, error: statusResult.error || "获取 Git 状态失败" });
        return;
      }
      const diffResult = await gitDiff(resolved, undefined, true);
      if (!diffResult.ok) {
        sendJson(res, 400, { ok: false, error: diffResult.error || "获取已暂存 diff 失败" });
        return;
      }

      const stagedFiles = statusResult.files.filter((f) => f.staged);
      if (!stagedFiles.length) {
        sendJson(res, 200, { ok: true, message: "" });
        return;
      }

      const diffText = diffResult.patch || "";
      const fileList = stagedFiles.map((f) => `${f.status}: ${f.path}`).join("\n");
      const prompt = `你是一个 Git 提交信息生成器。根据以下已暂存的文件变更生成一条准确的中文提交信息。

已暂存文件列表：
${fileList}

Diff 内容：
${diffText.slice(0, 12000)}

要求：
- 使用中文
- 第一行：简洁概括变更（不超过72字符），使用动词开头，描述"做了什么"
- 如果需要，在第一行后空一行，提供更详细的说明（可选）
- 分析变更类型：新功能、修复、重构、文档、样式、测试、构建、配置等
- 描述变更的目的和影响，而不仅仅是代码改动
- 不要加前缀如 "feat:" 或 "fix:"，直接描述变更内容
- 不要加引号或句号

示例：
添加用户登录功能，支持邮箱和手机号验证
修复订单支付状态同步问题，确保库存及时更新
重构用户模块代码结构，提升可维护性和测试覆盖率
更新项目文档，补充API接口使用说明`;

      const chatEndpoint = resolveChatEndpoint(body.endpoint);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (body.apiKey) headers.Authorization = `Bearer ${body.apiKey}`;

      sendSseHeaders(res);

      const aiResponse = await fetch(chatEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: body.model,
          messages: [{ role: "user", content: prompt }],
          stream: true,
        }),
      });

      if (!aiResponse.ok) {
        const errText = await aiResponse.text().catch(() => "");
        sendSseEvent(res, "error", { message: `AI 请求失败，HTTP ${aiResponse.status}${errText ? `: ${errText.slice(0, 200)}` : ""}` });
        res.end();
        return;
      }

      const reader = aiResponse.body?.getReader();
      if (!reader) {
        sendSseEvent(res, "error", { message: "AI 响应体为空" });
        res.end();
        return;
      }

      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let content = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              content += delta;
              sendSseEvent(res, "delta", { text: delta });
            }
          } catch {
            // skip malformed
          }
        }
      }

      const cleaned = content.trim().replace(/^["'"']|["'"']$/g, "").trim();
      sendSseEvent(res, "done", { message: cleaned });
      res.end();
    } catch (error) {
      sendSseEvent(res, "error", { message: error instanceof Error ? error.message : "生成提交信息失败" });
      res.end();
    }
  });

  // POST /backend/vibe/git/commit
  middlewares.use("/backend/vibe/git/commit", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; message?: string };
      if (!body.path?.trim() || !body.message?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 或 message 参数" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const result = await gitCommit(resolved, body.message.trim());
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "提交失败" });
    }
  });

  // GET /backend/vibe/git/log
  middlewares.use("/backend/vibe/git/log", async (req, res) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const projectPath = url.searchParams.get("path") || "";
      const count = Number(url.searchParams.get("count")) || 20;

      if (!projectPath) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(projectPath);
      const result = await gitLog(resolved, count);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "获取提交历史失败" });
    }
  });

  // POST /backend/vibe/git/add
  middlewares.use("/backend/vibe/git/add", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; files?: string[] };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const result = await gitAdd(resolved, body.files || []);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "暂存失败" });
    }
  });

  // POST /backend/vibe/git/reset
  middlewares.use("/backend/vibe/git/reset", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; files?: string[] };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const result = await gitReset(resolved, body.files || []);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "取消暂存失败" });
    }
  });

  // POST /backend/vibe/git/discard
  middlewares.use("/backend/vibe/git/discard", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; files?: string[] };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const result = body.files && body.files.length > 0
        ? await gitDiscard(resolved, body.files)
        : await gitDiscardAll(resolved);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "丢弃更改失败" });
    }
  });

  // GET /backend/vibe/git/remotes
  middlewares.use("/backend/vibe/git/remotes", async (req, res) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const projectPath = url.searchParams.get("path") || "";

      if (!projectPath) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(projectPath);
      const result = await gitRemotes(resolved);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "获取远程信息失败" });
    }
  });

  // POST /backend/vibe/git/fetch
  middlewares.use("/backend/vibe/git/fetch", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; remote?: string };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const result = await gitFetch(resolved, body.remote?.trim() || undefined);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "Fetch 失败" });
    }
  });

  // POST /backend/vibe/git/pull
  middlewares.use("/backend/vibe/git/pull", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; remote?: string; branch?: string };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const result = await gitPull(resolved, body.remote?.trim() || undefined, body.branch?.trim() || undefined);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "Pull 失败" });
    }
  });

  // POST /backend/vibe/git/push
  middlewares.use("/backend/vibe/git/push", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; remote?: string; branch?: string; setUpstream?: boolean };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const result = await gitPush(resolved, body.remote?.trim() || undefined, body.branch?.trim() || undefined, body.setUpstream);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "Push 失败" });
    }
  });

  // GET /backend/vibe/git/stash-list
  middlewares.use("/backend/vibe/git/stash-list", async (req, res) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const projectPath = url.searchParams.get("path");
      if (!projectPath?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(projectPath.trim());
      const result = await gitStashList(resolved);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, stashes: [], error: error instanceof Error ? error.message : "获取贮藏列表失败" });
    }
  });

  // POST /backend/vibe/git/stash-save
  middlewares.use("/backend/vibe/git/stash-save", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; message?: string };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const result = await gitStashSave(resolved, body.message);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, output: "", error: error instanceof Error ? error.message : "贮藏失败" });
    }
  });

  // POST /backend/vibe/git/stash-pop
  middlewares.use("/backend/vibe/git/stash-pop", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; stashIndex?: number };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const result = await gitStashPop(resolved, body.stashIndex);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, output: "", error: error instanceof Error ? error.message : "弹出贮藏失败" });
    }
  });

  // POST /backend/vibe/git/stash-apply
  middlewares.use("/backend/vibe/git/stash-apply", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; stashIndex?: number };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }
      if (body.stashIndex === undefined) {
        sendJson(res, 400, { ok: false, error: "缺少 stashIndex 参数" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const result = await gitStashApply(resolved, body.stashIndex);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, output: "", error: error instanceof Error ? error.message : "应用贮藏失败" });
    }
  });

  // POST /backend/vibe/git/stash-drop
  middlewares.use("/backend/vibe/git/stash-drop", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; stashIndex?: number };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }
      if (body.stashIndex === undefined) {
        sendJson(res, 400, { ok: false, error: "缺少 stashIndex 参数" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const result = await gitStashDrop(resolved, body.stashIndex);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, output: "", error: error instanceof Error ? error.message : "删除贮藏失败" });
    }
  });

  // POST /backend/vibe/file-watcher/start
  middlewares.use("/backend/vibe/file-watcher/start", async (req, res) => {
    try {
      const body = (await readJsonBody(req)) as { path?: string; watchPaths?: string[] };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const watchPaths = body.watchPaths || [resolved];
      
      const { startGlobalWatcher, getGlobalWatcher } = await import("./server/fileWatcher");
      const watcher = getGlobalWatcher();
      
      if (watcher.isWatching()) {
        await watcher.stop();
      }
      
      await startGlobalWatcher(watchPaths);
      sendJson(res, 200, { ok: true, message: "文件监听已启动", watchedPaths: watcher.getWatchedPaths() });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "启动文件监听失败" });
    }
  });

  // POST /backend/vibe/file-watcher/stop
  middlewares.use("/backend/vibe/file-watcher/stop", async (req, res) => {
    try {
      const { stopGlobalWatcher } = await import("./server/fileWatcher");
      await stopGlobalWatcher();
      sendJson(res, 200, { ok: true, message: "文件监听已停止" });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "停止文件监听失败" });
    }
  });

  // GET /backend/vibe/file-watcher/changes
  middlewares.use("/backend/vibe/file-watcher/changes", async (req, res) => {
    try {
      const { getGlobalWatcher } = await import("./server/fileWatcher");
      const watcher = getGlobalWatcher();
      
      if (!watcher.isWatching()) {
        sendJson(res, 200, { ok: true, changes: [], isWatching: false });
        return;
      }

      // Get changes from the watcher
      const changes: Array<{ type: string; path: string; timestamp: number }> = [];
      
      // Listen for changes for a short period
      const timeout = 1000; // 1 second timeout
      const startTime = Date.now();
      
      const onChanges = (newChanges: Array<{ type: string; path: string; timestamp: number }>) => {
        changes.push(...newChanges);
      };
      
      watcher.on("changes", onChanges);
      
      // Wait for changes or timeout
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (Date.now() - startTime >= timeout) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      });
      
      watcher.removeListener("changes", onChanges);
      
      sendJson(res, 200, { 
        ok: true, 
        changes, 
        isWatching: watcher.isWatching(),
        watchedPaths: watcher.getWatchedPaths()
      });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "获取文件变化失败" });
    }
  });
}
