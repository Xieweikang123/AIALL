use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const SCREEN_CAPTURE_PS1: &str = r#"
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
"#;

fn make_click_ps1(x: i32, y: i32) -> String {
  format!(
    r#"$ErrorActionPreference = "Stop"
$X = {x}
$Y = {y}
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class AiallDpi {{
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);
  public static readonly IntPtr PerMonitorAwareV2 = (IntPtr)(-4);
}}
public class WinMouse {{
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
}}
"@
try {{
  if (-not [AiallDpi]::SetProcessDpiAwarenessContext([AiallDpi]::PerMonitorAwareV2)) {{
    [void][AiallDpi]::SetProcessDPIAware()
  }}
}} catch {{
  [void][AiallDpi]::SetProcessDPIAware()
}}
[void][WinMouse]::SetCursorPos($X, $Y)
Start-Sleep -Milliseconds 60
[WinMouse]::mouse_event([WinMouse]::MOUSEEVENTF_LEFTDOWN,0,0,0,[UIntPtr]::Zero)
[WinMouse]::mouse_event([WinMouse]::MOUSEEVENTF_LEFTUP,0,0,0,[UIntPtr]::Zero)
"#,
    x = x,
    y = y
  )
}

fn powershell_exe() -> String {
  let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
  format!("{}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", root)
}

fn temp_script_path(prefix: &str) -> PathBuf {
  let ts = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_nanos();
  std::env::temp_dir().join(format!("aiall-{}-{}.ps1", prefix, ts))
}

fn run_powershell(script: &str) -> Result<String, String> {
  let script_path = temp_script_path("script");
  std::fs::write(&script_path, script).map_err(|e| format!("写入临时脚本失败: {e}"))?;

  let result = Command::new(powershell_exe())
    .args([
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-NonInteractive",
      "-File",
    ])
    .arg(&script_path)
    .output()
    .map_err(|e| format!("执行 PowerShell 失败: {e}"));

  let _ = std::fs::remove_file(&script_path);

  let output = result?;
  let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
  let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

  if !output.status.success() {
    let msg = if !stderr.is_empty() { stderr } else { stdout.clone() };
    return Err(format!("PowerShell 错误: {msg}"));
  }

  Ok(stdout)
}

pub async fn capture_primary_screen_png() -> Result<Vec<u8>, String> {
  let result = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, String> {
    let stdout = run_powershell(SCREEN_CAPTURE_PS1)?;
    let b64 = stdout.replace(char::is_whitespace, "");
    if b64.is_empty() {
      return Err("stdout 为空（未得到 Base64）。请确认在有图形会话的环境中运行。".into());
    }
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
      .decode(&b64)
      .map_err(|e| format!("Base64 解码失败: {e}"))
  })
  .await
  .map_err(|e| format!("任务失败: {e}"))?;
  result
}

pub async fn click_left_at_screen(x: i32, y: i32) -> Result<(), String> {
  let result = tokio::task::spawn_blocking(move || -> Result<(), String> {
    let script = make_click_ps1(x, y);
    run_powershell(&script)?;
    Ok(())
  })
  .await
  .map_err(|e| format!("任务失败: {e}"))?;
  result
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn powershell_exe_returns_valid_path() {
    let path = powershell_exe();
    assert!(path.contains("powershell.exe"));
    assert!(path.contains("System32"));
  }

  #[test]
  fn make_click_ps1_contains_coordinates() {
    let script = make_click_ps1(100, 200);
    assert!(script.contains("$X = 100"));
    assert!(script.contains("$Y = 200"));
    assert!(script.contains("SetCursorPos"));
    assert!(script.contains("mouse_event"));
  }

  #[test]
  fn temp_script_path_has_prefix_and_suffix() {
    let path = temp_script_path("test");
    let filename = path.file_name().unwrap().to_string_lossy();
    assert!(filename.starts_with("aiall-test-"), "filename should start with prefix");
    assert!(filename.ends_with(".ps1"), "filename should end with .ps1");
  }
}


