import fs from "node:fs";
import path from "node:path";

export type ProjectRuntimeProfile = {
  /** Project contains a desktop shell directory (e.g. src-tauri). */
  hasDesktopShell: boolean;
  /** Project root contains at least one .csproj (ASP.NET / Quartz-style backends). */
  hasDotNetProject: boolean;
  webDevScript?: string;
  desktopDevScript?: string;
  /** First npm verify script (backward compat for single-command hints). */
  verifyScript?: string;
  /** All verify scripts to run in order (typecheck → check → lint → test). */
  verifyScripts?: string[];
};

const VERIFY_SCRIPT_NAMES = ["typecheck", "check", "lint", "test"] as const;

export function resolveVerifyScripts(scripts: Record<string, string>): string[] {
  const commands: string[] = [];
  for (const name of VERIFY_SCRIPT_NAMES) {
    if (scripts[name]) commands.push(`npm run ${name}`);
  }
  if (!commands.length) {
    const build = scripts.build ?? scripts["build:tauri"] ?? "";
    if (/\bvue-tsc\b/.test(build) && /--noEmit/.test(build)) {
      commands.push("npx vue-tsc --noEmit");
    } else if (/\btsc\b/.test(build) && /--noEmit/.test(build)) {
      commands.push("npx tsc --noEmit");
    }
  }
  return commands;
}

function detectHasDotNetProject(projectRoot: string): boolean {
  try {
    return fs.readdirSync(projectRoot).some((name) => name.endsWith(".csproj"));
  } catch {
    return false;
  }
}

/** Structural detection from package.json scripts + desktop shell folder — topic-agnostic. */
export function detectProjectRuntimeProfile(projectRoot: string): ProjectRuntimeProfile {
  const hasDesktopShell = fs.existsSync(path.join(projectRoot, "src-tauri"));
  const hasDotNetProject = detectHasDotNetProject(projectRoot);
  let webDevScript: string | undefined;
  let desktopDevScript: string | undefined;
  let verifyScript: string | undefined;
  let verifyScripts: string[] | undefined;
  try {
    const pkgPath = path.join(projectRoot, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    if (scripts["dev:web"]) webDevScript = "npm run dev:web";
    if (scripts["tauri:dev"]) {
      desktopDevScript = "npm run tauri:dev";
    } else if (scripts["electron:dev"]) {
      desktopDevScript = "npm run electron:dev";
    } else if (scripts.dev && /\btauri\b/.test(scripts.dev)) {
      desktopDevScript = "npm run dev";
    }
    if (scripts.dev && !/\btauri\b/.test(scripts.dev) && !webDevScript) {
      webDevScript = "npm run dev";
    }
    verifyScripts = resolveVerifyScripts(scripts);
    verifyScript = verifyScripts[0];
  } catch {
    /* ignore missing or invalid package.json */
  }
  return { hasDesktopShell, hasDotNetProject, webDevScript, desktopDevScript, verifyScript, verifyScripts };
}
