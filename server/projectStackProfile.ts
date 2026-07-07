import fs from "node:fs";
import path from "node:path";

/** Structured stack facts detected from manifests — injected as ground truth, not playbook symbols. */
export type ProjectStackProfile = {
  languages: string[];
  runtimes: string[];
  frameworks: string[];
  capabilities: string[];
  manifestFiles: string[];
  entryHints: string[];
};

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function listRootNames(projectRoot: string): string[] {
  try {
    return fs.readdirSync(projectRoot);
  } catch {
    return [];
  }
}

function detectFromPackageJson(projectRoot: string, profile: ProjectStackProfile): void {
  const pkgPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return;
  profile.manifestFiles.push("package.json");

  const pkg = readJsonFile<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>(pkgPath);
  if (!pkg) return;

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const depNames = Object.keys(deps).map((d) => d.toLowerCase());

  if (depNames.some((d) => d === "vue" || d.startsWith("@vue/"))) {
    profile.frameworks.push("vue");
  }
  if (depNames.some((d) => d === "react" || d.startsWith("@react"))) {
    profile.frameworks.push("react");
  }
  if (depNames.some((d) => d.includes("tauri") || d.startsWith("@tauri-apps/"))) {
    profile.frameworks.push("tauri");
    profile.runtimes.push("desktop-shell");
  }
  if (depNames.some((d) => d.includes("electron"))) {
    profile.frameworks.push("electron");
    profile.runtimes.push("desktop-shell");
  }
  if (depNames.some((d) => d === "typescript" || d.startsWith("@types/"))) {
    profile.languages.push("typescript");
  }
  if (depNames.some((d) => d === "node-cron" || d === "cron" || d === "bull" || d === "agenda")) {
    profile.capabilities.push("scheduled-tasks");
  }
  if (depNames.some((d) => d.includes("@nestjs/schedule"))) {
    profile.frameworks.push("nestjs");
    profile.capabilities.push("scheduled-tasks");
  }

  profile.runtimes.push("node");
}

function detectFromCsproj(projectRoot: string, profile: ProjectStackProfile): void {
  const rootNames = listRootNames(projectRoot);
  const csprojFiles = rootNames.filter((n) => n.endsWith(".csproj"));
  if (!csprojFiles.length) return;

  profile.languages.push("csharp");
  profile.runtimes.push("dotnet");
  for (const file of csprojFiles) {
    profile.manifestFiles.push(file);
  }

  const csprojPath = path.join(projectRoot, csprojFiles[0]!);
  let csprojText = "";
  try {
    csprojText = fs.readFileSync(csprojPath, "utf8");
  } catch {
    csprojText = "";
  }

  if (/Quartz/i.test(csprojText)) {
    profile.frameworks.push("quartz-net");
    profile.capabilities.push("scheduled-tasks");
  }
  if (/Hangfire/i.test(csprojText)) {
    profile.frameworks.push("hangfire");
    profile.capabilities.push("scheduled-tasks");
  }

  for (const entry of ["Program.cs", "Startup.cs"]) {
    if (fs.existsSync(path.join(projectRoot, entry))) {
      profile.entryHints.push(entry);
    }
  }
}

function detectFromOtherManifests(projectRoot: string, profile: ProjectStackProfile): void {
  const checks: Array<{ file: string; language?: string; runtime?: string }> = [
    { file: "Cargo.toml", language: "rust" },
    { file: "go.mod", language: "go" },
    { file: "pyproject.toml", language: "python" },
    { file: "requirements.txt", language: "python" },
  ];

  for (const { file, language } of checks) {
    if (!fs.existsSync(path.join(projectRoot, file))) continue;
    profile.manifestFiles.push(file);
    if (language) profile.languages.push(language);
  }

  if (fs.existsSync(path.join(projectRoot, "src-tauri"))) {
    profile.runtimes.push("desktop-shell");
    if (!profile.frameworks.includes("tauri")) {
      profile.frameworks.push("tauri");
    }
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/** Detect languages, frameworks, and capabilities from root manifests (no regex topic matching). */
export function detectProjectStackProfile(projectRoot: string): ProjectStackProfile {
  const profile: ProjectStackProfile = {
    languages: [],
    runtimes: [],
    frameworks: [],
    capabilities: [],
    manifestFiles: [],
    entryHints: [],
  };

  detectFromPackageJson(projectRoot, profile);
  detectFromCsproj(projectRoot, profile);
  detectFromOtherManifests(projectRoot, profile);

  profile.languages = dedupe(profile.languages);
  profile.runtimes = dedupe(profile.runtimes);
  profile.frameworks = dedupe(profile.frameworks);
  profile.capabilities = dedupe(profile.capabilities);
  profile.manifestFiles = dedupe(profile.manifestFiles);
  profile.entryHints = dedupe(profile.entryHints);

  if (!profile.languages.length && profile.manifestFiles.includes("package.json")) {
    profile.languages.push("javascript");
  }

  return profile;
}

export function stackProfileHasDotNet(profile: ProjectStackProfile): boolean {
  return profile.languages.includes("csharp") || profile.runtimes.includes("dotnet");
}

/** Compact JSON block for system prompt — facts only, no grep symbol prescriptions. */
export function formatProjectStackProfileForPrompt(profile: ProjectStackProfile): string {
  if (!profile.manifestFiles.length) return "";

  const payload = {
    languages: profile.languages,
    runtimes: profile.runtimes,
    frameworks: profile.frameworks,
    capabilities: profile.capabilities,
    manifestFiles: profile.manifestFiles,
    entryHints: profile.entryHints.length ? profile.entryHints : undefined,
  };

  return [
    "",
    "【项目栈 Profile】以下为启动时从 manifest 检测的结构化事实；排查调度/API/框架问题时优先依据 Profile，勿凭记忆臆测栈。",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
  ].join("\n");
}
