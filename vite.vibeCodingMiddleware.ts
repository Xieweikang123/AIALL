import type { Connect } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { readJsonBody, sendJson, sendSseEvent, sendSseHeaders } from "./server/httpUtils";
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
import { gitStatus, gitDiff, gitDiffFile, gitDiffContent, gitCommit, gitLog, gitIsRepo, gitAdd, gitReset, gitDiscard, gitDiscardAll, gitRemotes, gitFetch, gitPull, gitPush } from "./server/vibeGit";

const execFileAsync = promisify(execFile);

const DEBUG_LOG = path.join(os.tmpdir(), "aiall-debug.log");
function debugLog(msg: string) {
  fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`);
}
debugLog("=== middleware loaded ===");

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

export function registerVibeCodingMiddleware(middlewares: Connect.Server) {
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

    if (!prompt || !projectPath || !endpoint || !model) {
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
    const abort = () => controller.abort();
    req.on("close", abort);
    res.on("close", abort);

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
      const body = (await readJsonBody(req)) as { path?: string };
      if (!body.path) {
        sendJson(res, 400, { error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(body.path);
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
      const body = (await readJsonBody(req)) as { path?: string; content?: string };
      if (!body.path || body.content === undefined) {
        sendJson(res, 400, { error: "缺少 path 或 content 参数" });
        return;
      }

      const resolved = path.resolve(body.path);
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
      const body = (await readJsonBody(req)) as { path?: string; isDirectory?: boolean; content?: string };
      if (!body.path) {
        sendJson(res, 400, { error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(body.path);

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

      if (!targetPath) {
        sendJson(res, 400, { error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(targetPath);
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
      const body = (await readJsonBody(req)) as { from?: string; to?: string };
      const fromPath = (body.from || "").trim();
      const toPath = (body.to || "").trim();

      if (!fromPath || !toPath) {
        sendJson(res, 400, { error: "缺少 from 或 to 参数" });
        return;
      }

      const resolvedFrom = path.resolve(fromPath);
      const resolvedTo = path.resolve(toPath);

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

      if (!projectPath) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(projectPath);
      const result = filePath ? await gitDiffFile(resolved, filePath) : await gitDiff(resolved);
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

      if (!projectPath || !filePath) {
        sendJson(res, 400, { ok: false, error: "缺少 path 或 file 参数" });
        return;
      }

      const resolved = path.resolve(projectPath);
      const result = await gitDiffContent(resolved, filePath);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "获取文件内容失败" });
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
      const diffResult = await gitDiff(resolved);

      const stagedFiles = statusResult.files.filter((f) => f.staged);
      if (!stagedFiles.length) {
        sendJson(res, 200, { ok: true, message: "" });
        return;
      }

      const diffText = diffResult.patch || "";
      const fileList = stagedFiles.map((f) => `${f.status}: ${f.path}`).join("\n");
      const prompt = `你是一个 Git 提交信息生成器。根据以下已暂存的文件变更生成一条简洁的中文提交信息（一行，不超过 72 个字符）。

已暂存文件列表：
${fileList}

Diff 内容：
${diffText.slice(0, 8000)}

要求：
- 使用中文
- 简明扼要描述做了什么
- 不要加前缀如 "feat:" 或 "fix:"，直接描述变更内容
- 不要加引号或句号`;

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
}
