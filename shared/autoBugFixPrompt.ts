import type { HealthIssue, ProjectHealthScanPayload } from "./projectHealthScan";
import type { ProjectVerifyRunPayload } from "./projectVerifyRun";

export type AutoBugFixScope = "tests_only" | "tests_and_errors" | "include_warnings";

export const MAX_AUTO_BUG_FIX_TARGET_FILES = 8;

export type BuildAutoBugFixPromptInput = {
  scan: ProjectHealthScanPayload;
  verifyRun: ProjectVerifyRunPayload;
  scope?: AutoBugFixScope;
  verifyScript?: string;
};

function formatIssueLine(issue: HealthIssue): string {
  const loc = issue.file ? ` (${issue.file}${issue.line ? `:${issue.line}` : ""})` : "";
  return `- [${issue.severity}] ${issue.title}${loc}${issue.detail ? ` — ${issue.detail}` : ""}`;
}

function filterScanIssues(issues: HealthIssue[], scope: AutoBugFixScope): HealthIssue[] {
  if (scope === "include_warnings") {
    return issues.filter((issue) => issue.category !== "debt");
  }
  if (scope === "tests_and_errors") {
    return issues.filter((issue) => issue.severity === "error");
  }
  return [];
}

export function collectAutoBugFixTargetFiles(
  scan: ProjectHealthScanPayload,
  verifyRun: ProjectVerifyRunPayload,
  scope: AutoBugFixScope = "tests_and_errors",
): string[] {
  const files = new Set<string>();
  for (const file of verifyRun.failingFiles ?? []) {
    const norm = file.replace(/\\/g, "/").trim();
    if (norm) files.add(norm);
  }
  for (const issue of filterScanIssues(scan.issues, scope)) {
    const norm = issue.file?.replace(/\\/g, "/").trim();
    if (norm) files.add(norm);
  }
  return [...files].slice(0, MAX_AUTO_BUG_FIX_TARGET_FILES);
}

export function countAutoBugFixWorkItems(
  scan: ProjectHealthScanPayload,
  verifyRun: ProjectVerifyRunPayload,
  scope: AutoBugFixScope = "tests_and_errors",
): { testFailures: number; scanItems: number; total: number } {
  const testFailures = verifyRun.skipped ? 0 : verifyRun.ok ? 0 : Math.max(1, verifyRun.failingFiles.length || 1);
  const scanItems = filterScanIssues(scan.issues, scope).length;
  return { testFailures, scanItems, total: testFailures + scanItems };
}

export function needsAutoBugFix(
  scan: ProjectHealthScanPayload,
  verifyRun: ProjectVerifyRunPayload,
  scope: AutoBugFixScope = "tests_and_errors",
): boolean {
  return countAutoBugFixWorkItems(scan, verifyRun, scope).total > 0;
}

export function buildAutoBugFixUserIntent(scope: AutoBugFixScope): string {
  const scopeLabel =
    scope === "tests_only"
      ? "仅修复测试失败"
      : scope === "include_warnings"
        ? "修复测试失败与扫描问题（含警告级）"
        : "修复测试失败与 error 级扫描项";
  return `一键自动修复：${scopeLabel}；仅改清单内项，禁止重构或顺手优化`;
}

export function buildAutoBugFixPrompt(input: BuildAutoBugFixPromptInput): string {
  const scope = input.scope ?? "tests_and_errors";
  const scanItems = filterScanIssues(input.scan.issues, scope);
  const verify = input.verifyRun;
  const lines = [
    "[AUTO_BUG_FIX]",
    "请修复下列已核实问题；允许 patch_file / write_file（局部修改优先）。",
    "流程：read_file 核实 → patch → run_command 复验；不可在未跑测试时宣称已修复。",
    "仅修复清单内项；grep 圈定项须 read 后确认，误报则跳过并说明；禁止重构、重命名、格式化无关代码。",
    "",
    `修复范围：${buildAutoBugFixUserIntent(scope)}`,
    "",
  ];

  if (!verify.skipped && !verify.ok) {
    lines.push("## 测试失败（优先）");
    lines.push(`命令：${verify.command}`);
    lines.push(`exit code：${verify.exitCode}`);
    if (verify.failingFiles.length) {
      lines.push(`失败文件：${verify.failingFiles.join("、")}`);
    }
    const tail = [verify.stdout, verify.stderr].filter(Boolean).join("\n").trim();
    if (tail) {
      lines.push("");
      lines.push("输出摘要：");
      lines.push(tail.slice(-4000));
    }
    lines.push("");
  } else if (verify.skipped) {
    lines.push("## 测试");
    lines.push(`跳过：${verify.skipReason || "无 verify 脚本"}`);
    lines.push("");
  }

  if (scanItems.length) {
    lines.push("## 规则扫描（须 read 核实后再改）");
    for (const issue of scanItems) {
      lines.push(formatIssueLine(issue));
    }
    lines.push("");
  }

  if (input.verifyScript) {
    lines.push(`复验命令：${input.verifyScript}`);
  }

  return lines.join("\n");
}
