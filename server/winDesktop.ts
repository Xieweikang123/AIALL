/**
 * Windows：主屏截图、模拟左键点击（供本机开发自动化使用）
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function isWin() {
  return process.platform === "win32";
}

function powershellExe(): string {
  const root = process.env.SystemRoot || "C:\\Windows";
  return path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/** 汇聚 Node execFile 抛错时的 stderr，便于排查 PowerShell 真实报错 */
function formatExecError(e: unknown): string {
  if (!e || typeof e !== "object") return String(e);
  const err = e as NodeJS.ErrnoException & { stderr?: Buffer; stdout?: Buffer };
  const stderr = err.stderr ? String(err.stderr).trim() : "";
  const stdout = err.stdout ? String(err.stdout).trim() : "";
  const parts = [err.message || "", stderr && `stderr:\n${stderr}`, stdout && `stdout:\n${stdout}`].filter(Boolean);
  return parts.join("\n");
}

/**
 * 独立 .ps1 文件执行，避免 -Command 单行过长或被错误拆分；
 * 仅截取主显示器 PrimaryScreen（匹配范围限定在主屏）。
 * 在加载 WinForms 之前声明 DPI 感知，避免 125%/150% 缩放下 Bounds（逻辑像素）与 CopyFromScreen（物理像素）不一致导致截图缺边、裁切。
 */
const SCREEN_CAPTURE_PS1 = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class AiallDpi {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);
  public static readonly IntPtr PerMonitorAwareV2 = (IntPtr)(-4);
}
"@
try {
  if (-not [AiallDpi]::SetProcessDpiAwarenessContext([AiallDpi]::PerMonitorAwareV2)) {
    [void][AiallDpi]::SetProcessDPIAware()
  }
} catch {
  [void][AiallDpi]::SetProcessDPIAware()
}
Add-Type -AssemblyName System.Windows.Forms | Out-Null
Add-Type -AssemblyName System.Drawing | Out-Null
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
if ($bounds.Width -lt 1 -or $bounds.Height -lt 1) {
  throw "PrimaryScreen.Bounds 无效: $($bounds.Width)x$($bounds.Height)"
}
$bmp = New-Object System.Drawing.Bitmap([int]$bounds.Width, [int]$bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
try {
  $src = New-Object System.Drawing.Point($bounds.X, $bounds.Y)
  $g.CopyFromScreen($src, [System.Drawing.Point]::Empty, $bmp.Size)
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $ms.ToArray()
  [Console]::Out.Write([Convert]::ToBase64String($bytes))
} finally {
  if ($null -ne $g) { $g.Dispose() }
  if ($null -ne $bmp) { $bmp.Dispose() }
}
`.trim();

async function captureScreenWithPs1File(): Promise<Buffer | { error: string }> {
  const scriptPath = path.join(os.tmpdir(), `aiall-screenshot-${process.pid}-${Date.now()}.ps1`);
  await fs.writeFile(scriptPath, SCREEN_CAPTURE_PS1, "utf8");

  try {
    const { stdout, stderr } = await execFileAsync(
      powershellExe(),
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-NonInteractive", "-File", scriptPath],
      {
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      },
    );

    const errText = stderr ? Buffer.isBuffer(stderr) ? stderr.toString("utf8").trim() : String(stderr).trim() : "";
    const out = stdout
      ? Buffer.isBuffer(stdout)
        ? stdout.toString("utf8")
        : String(stdout)
      : "";
    const b64 = out.replace(/\s+/g, "");
    if (!b64) {
      return {
        error: errText || "stdout 为空（未得到 Base64）。若在无图形会话/远程仅控制台环境运行，CopyFromScreen 会失败。",
      };
    }
    return Buffer.from(b64, "base64");
  } catch (e) {
    return { error: formatExecError(e) };
  } finally {
    await fs.unlink(scriptPath).catch(() => {});
  }
}

/**
 * 可选：本机已安装 ffmpeg 时用 gdigrab 截屏。
 * 注意：`-i desktop` 为整桌虚拟屏，与「仅主屏」不一致；仅在 PowerShell 截屏失败时作兜底。
 */
async function captureScreenWithFfmpeg(): Promise<Buffer | { error: string }> {
  const outPath = path.join(os.tmpdir(), `aiall-ff-${process.pid}-${Date.now()}.png`);
  try {
    await execFileAsync(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-y", "-f", "gdigrab", "-framerate", "1", "-i", "desktop", "-frames:v", "1", outPath],
      { windowsHide: true, timeout: 25_000, maxBuffer: 2 * 1024 * 1024 },
    );
    const buf = await fs.readFile(outPath);
    await fs.unlink(outPath).catch(() => {});
    return buf;
  } catch (e) {
    await fs.unlink(outPath).catch(() => {});
    return { error: formatExecError(e) };
  }
}

/** 主显示器整幅 PNG（匹配与调试预览均以此为搜索范围） */
export async function capturePrimaryScreenPng(): Promise<Buffer | { error: string }> {
  if (!isWin()) return { error: "仅支持 Windows" };

  const ps = await captureScreenWithPs1File();
  if (Buffer.isBuffer(ps)) return ps;

  const ff = await captureScreenWithFfmpeg();
  if (Buffer.isBuffer(ff)) return ff;

  return {
    error: [
      "PowerShell + System.Drawing（主屏）截屏失败：",
      ps.error,
      "",
      "已自动尝试 ffmpeg（gdigrab，截图为整桌虚拟屏，与主屏限定不完全一致）：",
      ff.error,
      "",
      "可尝试：1）在本机图形桌面会话运行 npm run dev；2）安装 ffmpeg 并加入 PATH；3）查看 stderr 是否含 CopyFromScreen / GDI+ 报错。",
    ].join("\n"),
  };
}

/**
 * 多行 here-string 不能可靠地塞进 -Command 单参数，改为临时 .ps1 + -File（与截屏一致）。
 */
const MOUSE_CLICK_PS1 = (x: number, y: number) => `
$ErrorActionPreference = "Stop"
$X = ${x}
$Y = ${y}
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
}
"@
[void][WinMouse]::SetCursorPos($X, $Y)
Start-Sleep -Milliseconds 60
[WinMouse]::mouse_event([WinMouse]::MOUSEEVENTF_LEFTDOWN,0,0,0,[UIntPtr]::Zero)
[WinMouse]::mouse_event([WinMouse]::MOUSEEVENTF_LEFTUP,0,0,0,[UIntPtr]::Zero)
`.trim();

export async function clickLeftAtScreen(x: number, y: number): Promise<void | { error: string }> {
  if (!isWin()) return { error: "仅支持 Windows" };
  const xi = Math.round(Math.max(0, x));
  const yi = Math.round(Math.max(0, y));

  const scriptPath = path.join(os.tmpdir(), `aiall-click-${process.pid}-${Date.now()}.ps1`);
  await fs.writeFile(scriptPath, MOUSE_CLICK_PS1(xi, yi), "utf8");
  try {
    await execFileAsync(
      powershellExe(),
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      {
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
  } catch (e) {
    return { error: `点击失败：${formatExecError(e)}` };
  } finally {
    await fs.unlink(scriptPath).catch(() => {});
  }
}
