import type { Connect } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".vue", ".json", ".html", ".css", ".scss", ".less",
  ".md", ".txt", ".yaml", ".yml", ".toml", ".xml", ".svg", ".sql", ".sh", ".bash",
  ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp", ".cs",
  ".php", ".swift", ".kt", ".r", ".m", ".mm", ".lua", ".pl",
  ".env", ".gitignore", ".dockerignore", ".editorconfig", ".prettierrc",
  ".eslintrc", ".babelrc", ".log", ".csv", ".ini", ".cfg",
  ".svelte", ".astro", ".mdx",
]);

const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg", "__pycache__", ".cache",
  "dist", "build", ".next", ".nuxt", "target",
]);

/** List directory entries */
async function listDirectory(dirPath: string) {
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const items: Array<{
    name: string;
    path: string;
    isDirectory: boolean;
    isFile: boolean;
    extension: string;
    size?: number;
  }> = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (IGNORE_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dirPath, entry.name);
    const stat = await fs.promises.stat(fullPath).catch(() => null);

    items.push({
      name: entry.name,
      path: fullPath,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
      extension: entry.isFile() ? path.extname(entry.name).toLowerCase() : "",
      size: stat?.size,
    });
  }

  items.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return items;
}

/** Read file content */
async function readFileContent(filePath: string) {
  const stat = await fs.promises.stat(filePath);

  if (stat.size > 2 * 1024 * 1024) {
    return { ok: false as const, error: "文件过大（超过 2MB），无法预览", size: stat.size };
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext) && stat.size > 0) {
    const fd = await fs.promises.open(filePath, "r");
    try {
      const buf = Buffer.alloc(512);
      const { bytesRead } = await fd.read(buf, 0, 512, 0);
      if (buf.subarray(0, bytesRead).includes(0)) {
        return { ok: false as const, error: "二进制文件，无法预览", size: stat.size };
      }
    } finally {
      await fd.close();
    }
  }

  const content = await fs.promises.readFile(filePath, "utf-8");
  return { ok: true as const, content, size: stat.size, encoding: "utf-8" };
}

/** Write file content */
async function writeFileContent(filePath: string, content: string) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(filePath, content, "utf-8");
  const stat = await fs.promises.stat(filePath);
  return { ok: true, size: stat.size };
}

/** Search files by name pattern */
async function searchFiles(dirPath: string, query: string, maxResults = 30) {
  const results: Array<{ name: string; path: string; isDirectory: boolean }> = [];
  const lowerQuery = query.toLowerCase();

  async function walk(currentDir: string, depth: number) {
    if (depth > 6 || results.length >= maxResults) return;
    try {
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxResults) break;
        if (entry.name.startsWith(".") || IGNORE_DIRS.has(entry.name)) continue;
        if (entry.name.toLowerCase().includes(lowerQuery)) {
          results.push({
            name: entry.name,
            path: path.join(currentDir, entry.name),
            isDirectory: entry.isDirectory(),
          });
        }
        if (entry.isDirectory()) {
          await walk(path.join(currentDir, entry.name), depth + 1);
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  await walk(dirPath, 0);
  return results;
}

function powershellExe(): string {
  const root = process.env.SystemRoot || "C:\\Windows";
  return path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/** ASCII-only script; Chinese title comes from env to avoid .ps1 encoding issues. */
const FOLDER_PICKER_PS1 = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$title = if ($env:AIALL_DIALOG_DESC) { $env:AIALL_DIALOG_DESC } else { 'Select project folder' }
$initial = $env:AIALL_INITIAL_DIR
$selected = $null

function Try-ModernFolderPicker {
  [void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms')
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title = $title
  $dialog.Filter = 'Folders|no.files'
  $dialog.FileName = 'Folder Selection.'
  $dialog.CheckFileExists = $false
  $dialog.CheckPathExists = $true
  $dialog.ValidateNames = $false
  $dialog.Multiselect = $false
  if ($initial -and (Test-Path -LiteralPath $initial -PathType Container)) {
    $dialog.InitialDirectory = $initial
  }
  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return $null }
  $name = $dialog.FileName
  if ([System.IO.Directory]::Exists($name)) { return $name }
  $parent = [System.IO.Path]::GetDirectoryName($name)
  if ($parent -and [System.IO.Directory]::Exists($parent)) { return $parent }
  return $null
}

function Try-LegacyFolderPicker {
  $shell = New-Object -ComObject Shell.Application
  $root = 0
  if ($initial -and (Test-Path -LiteralPath $initial -PathType Container)) { $root = $initial }
  $folder = $shell.BrowseForFolder(0, $title, 0x41, $root)
  if ($null -ne $folder) { return $folder.Self.Path }
  return $null
}

try { $selected = Try-ModernFolderPicker } catch { }
if (-not $selected) {
  try { $selected = Try-LegacyFolderPicker } catch { }
}
if ($selected) { [Console]::Out.Write($selected) }
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

  try {
    const env = { ...process.env, AIALL_DIALOG_DESC: "选择项目文件夹" };
    if (initialPath?.trim()) env.AIALL_INITIAL_DIR = path.resolve(initialPath.trim());

    const { stdout, stderr } = await execFileAsync(
      powershellExe(),
      ["-NoProfile", "-Sta", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      { windowsHide: false, maxBuffer: 4 * 1024 * 1024, env },
    );

    const errText = stderr ? String(stderr).trim() : "";
    if (errText && !stdout) {
      return { ok: false, error: errText };
    }

    const selected = (stdout ? String(stdout) : "").trim();
    if (!selected) return { ok: false, cancelled: true };
    return { ok: true, path: selected };
  } catch (error) {
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

    try {
      let initialPath = "";
      try {
        const body = (await readJsonBody(req)) as { initialPath?: string };
        initialPath = body.initialPath?.trim() || "";
      } catch {
        // empty body is fine
      }

      const result = await pickProjectFolder(initialPath);
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
        await fs.promises.rmdir(resolved);
      } else {
        await fs.promises.unlink(resolved);
      }

      sendJson(res, 200, { ok: true, path: resolved });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "删除失败" });
    }
  });
}
