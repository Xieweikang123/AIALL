import fs from "node:fs";
import path from "node:path";

export type ProjectRuntimeProfile = {
  /** Project contains a desktop shell directory (e.g. src-tauri). */
  hasDesktopShell: boolean;
  webDevScript?: string;
  desktopDevScript?: string;
};

/** Structural detection from package.json scripts + desktop shell folder — topic-agnostic. */
export function detectProjectRuntimeProfile(projectRoot: string): ProjectRuntimeProfile {
  const hasDesktopShell = fs.existsSync(path.join(projectRoot, "src-tauri"));
  let webDevScript: string | undefined;
  let desktopDevScript: string | undefined;
  try {
    const pkgPath = path.join(projectRoot, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
    if (pkg.scripts?.dev) webDevScript = "npm run dev";
    if (pkg.scripts?.["tauri:dev"]) desktopDevScript = "npm run tauri:dev";
    if (pkg.scripts?.["electron:dev"]) desktopDevScript = "npm run electron:dev";
  } catch {
    /* ignore missing or invalid package.json */
  }
  return { hasDesktopShell, webDevScript, desktopDevScript };
}

/** Injected when a desktop shell is detected — guides runtime-aware testing, not feature-specific. */
export function buildRuntimeAwarenessHint(profile: ProjectRuntimeProfile): string {
  if (!profile.hasDesktopShell) return "";
  const lines = [
    "",
    "【运行环境·结构检测】项目含桌面壳目录（如 src-tauri）。",
    "涉及系统/原生 API（通知、对话框、文件系统权限等）时，须区分：",
    "· 纯 Web 开发服务器（通常仅 Vite/浏览器）— 原生 API 不可用或仅为降级；",
    "· 桌面壳运行时 — 原生 API 经 IPC 调用操作系统。",
    "给用户的测试步骤须写清应使用哪条 npm script；禁止把 Web 端降级 UI（站内横幅、alert）描述为「系统/原生能力已成功」。",
  ];
  if (profile.webDevScript && profile.desktopDevScript) {
    lines.push(`Web 前端：${profile.webDevScript}；桌面壳：${profile.desktopDevScript}。`);
  } else if (profile.desktopDevScript) {
    lines.push(`桌面壳启动：${profile.desktopDevScript}。`);
  }
  return lines.join("\n");
}
