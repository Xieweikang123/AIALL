import fs from "node:fs";
import path from "node:path";

export type ProjectRuntimeProfile = {
  /** Project contains a desktop shell directory (e.g. src-tauri). */
  hasDesktopShell: boolean;
  webDevScript?: string;
  desktopDevScript?: string;
  /** npm script for post-change verification (typecheck / lint / test), if detectable. */
  verifyScript?: string;
};

const VERIFY_SCRIPT_NAMES = ["typecheck", "check", "lint", "test"] as const;

function resolveVerifyScript(scripts: Record<string, string>): string | undefined {
  for (const name of VERIFY_SCRIPT_NAMES) {
    if (scripts[name]) return `npm run ${name}`;
  }
  const build = scripts.build ?? "";
  if (/\bvue-tsc\b/.test(build) && /--noEmit/.test(build)) return "npx vue-tsc --noEmit";
  if (/\btsc\b/.test(build) && /--noEmit/.test(build)) return "npx tsc --noEmit";
  return undefined;
}

/** Structural detection from package.json scripts + desktop shell folder — topic-agnostic. */
export function detectProjectRuntimeProfile(projectRoot: string): ProjectRuntimeProfile {
  const hasDesktopShell = fs.existsSync(path.join(projectRoot, "src-tauri"));
  let webDevScript: string | undefined;
  let desktopDevScript: string | undefined;
  let verifyScript: string | undefined;
  try {
    const pkgPath = path.join(projectRoot, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    if (scripts.dev) webDevScript = "npm run dev";
    if (scripts["tauri:dev"]) desktopDevScript = "npm run tauri:dev";
    if (scripts["electron:dev"]) desktopDevScript = "npm run electron:dev";
    verifyScript = resolveVerifyScript(scripts);
  } catch {
    /* ignore missing or invalid package.json */
  }
  return { hasDesktopShell, webDevScript, desktopDevScript, verifyScript };
}

/** Shell syntax for run_command — Windows uses PowerShell, not bash. */
export function buildShellAwarenessHint(platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") return "";
  return [
    "",
    "【运行环境·Shell】本项目 run_command 在 Windows 上通过 PowerShell 执行。",
    "· 链式命令用 `;` 分隔，勿用 `&&`（cmd/bash 语法会失败）；",
    "· 勿用 `head`/`tail`/`grep` 等 Unix 管道工具，改用 `Select-Object -First N` 或项目 npm script；",
    "· 切换目录示例：`cd D:\\path\\to\\project; npm run test`；",
    "· 优先从 package.json scripts 选用命令（如 test、build、typecheck），避免手写 fragile 管道。",
  ].join("\n");
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
