import type { Connect } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { sendSseEvent, sendSseHeaders } from "./server/httpUtils";
import { runVibeAgent } from "./server/vibeAgent";
import {
  listDirectory,
  readFileContent,
  searchFiles,
  writeFileContent,
} from "./server/vibeFs";

const execFileAsync = promisify(execFile);

const DEBUG_LOG = path.join(os.tmpdir(), "aiall-debug.log");
function debugLog(msg: string) {
  fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`);
}
debugLog("=== middleware loaded ===");

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

const KEY_PROJECT_FILES = [
  "package.json",
  "README.md",
  "README",
  "tsconfig.json",
  "vite.config.ts",
  "index.html",
  "src/main.ts",
  "src/main.js",
  "src/App.vue",
  "src/router/index.ts",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
];

const PROJECT_CONTEXT_MAX_NODES = 200;
const PROJECT_CONTEXT_MAX_DEPTH = 4;
const PROJECT_CONTEXT_MAX_CHARS = 100_000;
const PROJECT_CONTEXT_FILE_SLICE = 12_000;

async function buildProjectTree(rootPath: string): Promise<string[]> {
  const lines: string[] = [];
  let nodeCount = 0;

  async function walk(dirPath: string, depth: number, prefix: string) {
    if (depth > PROJECT_CONTEXT_MAX_DEPTH || nodeCount >= PROJECT_CONTEXT_MAX_NODES) return;
    const items = await listDirectory(dirPath);
    for (const item of items) {
      if (nodeCount >= PROJECT_CONTEXT_MAX_NODES) break;
      lines.push(`${prefix}${item.isDirectory ? "[dir] " : ""}${item.name}`);
      nodeCount += 1;
      if (item.isDirectory) {
        await walk(item.path, depth + 1, `${prefix}  `);
      }
    }
  }

  await walk(rootPath, 0, "");
  if (nodeCount >= PROJECT_CONTEXT_MAX_NODES) {
    lines.push("...（目录过多，已截断）");
  }
  return lines;
}

async function buildProjectContext(projectPath: string) {
  const resolved = path.resolve(projectPath);
  const stat = await fs.promises.stat(resolved).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    return { ok: false as const, error: "路径不存在或不是目录" };
  }

  const treeLines = await buildProjectTree(resolved);
  const tree = treeLines.join("\n");
  let usedChars = tree.length;

  const keyFiles: Array<{ path: string; content: string }> = [];
  for (const rel of KEY_PROJECT_FILES) {
    if (usedChars >= PROJECT_CONTEXT_MAX_CHARS) break;
    const fullPath = path.join(resolved, rel);
    const result = await readFileContent(fullPath);
    if (!result.ok) continue;
    const budget = Math.min(PROJECT_CONTEXT_FILE_SLICE, PROJECT_CONTEXT_MAX_CHARS - usedChars);
    if (budget <= 0) break;
    const content = result.content.slice(0, budget);
    keyFiles.push({ path: rel.replace(/\\/g, "/"), content });
    usedChars += content.length + rel.length;
  }

  return {
    ok: true as const,
    path: resolved,
    tree,
    keyFiles,
    truncated: usedChars >= PROJECT_CONTEXT_MAX_CHARS || treeLines.length >= PROJECT_CONTEXT_MAX_NODES,
  };
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
      projectPath?: string;
      endpoint?: string;
      apiKey?: string;
      model?: string;
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
      await runVibeAgent({
        projectRoot: resolvedRoot,
        prompt,
        openFilePath: body.openFilePath?.trim() || undefined,
        endpoint,
        apiKey: body.apiKey || "",
        model,
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
}
