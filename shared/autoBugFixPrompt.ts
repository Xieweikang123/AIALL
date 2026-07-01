import type { HealthIssue, ProjectHealthScanPayload } from "./projectHealthScan";
import type { ProjectVerifyRunPayload } from "./projectVerifyRun";
import { getVerifyEnvironmentNote } from "./projectVerifyRun";

export type AutoBugFixScope = "tests_only" | "tests_and_errors" | "include_warnings";

export const MAX_AUTO_BUG_FIX_TARGET_FILES = 8;

/** Server-side marker: prompt includes logic review (broader explore, read-before-patch). */
export const AUTO_BUG_FIX_LOGIC_REVIEW_MARKER = "[AUTO_BUG_FIX_LOGIC_REVIEW]";

export type BuildAutoBugFixPromptInput = {
  scan: ProjectHealthScanPayload;
  verifyRun: ProjectVerifyRunPayload;
  scope?: AutoBugFixScope;
  includeLogicReview?: boolean;
  verifyScript?: string;
  verifyCommands?: string[];
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
  includeLogicReview = false,
): boolean {
  if (includeLogicReview) return true;
  return countAutoBugFixWorkItems(scan, verifyRun, scope).total > 0;
}

export function buildAutoBugFixNoWorkSummary(
  scan: ProjectHealthScanPayload,
  verifyRun: ProjectVerifyRunPayload,
  scope: AutoBugFixScope = "tests_and_errors",
): string {
  const parts: string[] = [];
  const { errorCount, warningCount, infoCount } = scan.summary ?? {
    errorCount: 0,
    warningCount: 0,
    infoCount: 0,
  };
  const scanTotal = errorCount + warningCount + infoCount;
  if (scanTotal > 0) {
    parts.push(`扫描 ${scanTotal} 项（${errorCount} error · ${warningCount} warning · ${infoCount} info）`);
  } else {
    parts.push("规则扫描未发现匹配项");
  }
  if (verifyRun.skipped) {
    parts.push("未配置 verify 脚本");
  } else if (verifyRun.ok) {
    parts.push("验证已通过");
  } else {
    parts.push(`验证失败 (exit ${verifyRun.exitCode})`);
  }
  const envNote = getVerifyEnvironmentNote(verifyRun);
  if (envNote) parts.push(envNote);
  if (warningCount > 0 && scope !== "include_warnings") {
    parts.push("warning/info 默认不自动修复（可勾选「包含警告级扫描项」）");
  } else if (errorCount === 0 && verifyRun.ok && scope === "tests_and_errors") {
    parts.push("无 error 级扫描项且测试通过");
  }
  return `${parts.join("；")}，无需启动 Agent 修复。`;
}

function resolveVerifyCommands(input: BuildAutoBugFixPromptInput): string[] {
  if (input.verifyCommands?.length) return input.verifyCommands;
  if (input.verifyRun.verifyCommands?.length) return input.verifyRun.verifyCommands;
  if (input.verifyScript) return [input.verifyScript];
  if (input.verifyRun.command) {
    return input.verifyRun.command.split(/\s→\s/).map((part) => part.trim()).filter(Boolean);
  }
  return [];
}

export function buildAutoBugFixUserIntent(scope: AutoBugFixScope, includeLogicReview = false): string {
  const scopeLabel =
    scope === "tests_only"
      ? "仅修复测试失败"
      : scope === "include_warnings"
        ? "修复测试失败与扫描问题（含警告级）"
        : "修复测试失败与 error 级扫描项";
  const logicSuffix = includeLogicReview ? "；含逻辑审查（逻辑隐患/竞态/边界/错误处理）" : "";
  return `扫描与测试修复：${scopeLabel}${logicSuffix}；仅改确认项，禁止重构或顺手优化`;
}

function buildAutoBugFixLogicReviewSection(scan: ProjectHealthScanPayload): string[] {
  const lines = [
    "## 逻辑审查（须 read 核实后修复）",
    "审查并修复下列维度中经 read/grep 确认的问题；不确定标「待验证」并跳过修改。",
    "1. 明显逻辑错误与未处理边界",
    "2. 异步与 DOM 事件时序、竞态",
    "3. 错误被吞掉或静默失败",
    "4. 重复逻辑与过度耦合",
    "5. 安全与权限边界",
    "",
  ];
  if (scan.issues.length) {
    lines.push("优先从规则扫描命中处深入 read/grep，并补充规则未覆盖的问题：");
    for (const issue of scan.issues.slice(0, 12)) {
      lines.push(formatIssueLine(issue));
    }
    if (scan.issues.length > 12) {
      lines.push(`…还有 ${scan.issues.length - 12} 项扫描命中未列出`);
    }
  } else {
    lines.push("规则扫描无命中；从入口链路抽样 read_file，做广覆盖审查并修复确认项。");
  }
  lines.push("");
  return lines;
}

export function buildAutoBugFixPrompt(input: BuildAutoBugFixPromptInput): string {
  const scope = input.scope ?? "tests_and_errors";
  const includeLogicReview = Boolean(input.includeLogicReview);
  const scanItems = filterScanIssues(input.scan.issues, scope);
  const verify = input.verifyRun;
  const lines = [
    "[AUTO_BUG_FIX]",
    ...(includeLogicReview ? [AUTO_BUG_FIX_LOGIC_REVIEW_MARKER] : []),
    "请修复下列已核实问题；允许 patch_file / write_file（局部修改优先）。",
    "流程：read_file 核实 → patch → run_command 复验；不可在未跑测试时宣称已修复。",
    "仅修复清单内项；grep 圈定项须 read 后确认，误报则跳过并说明；禁止重构、重命名、格式化无关代码。",
    "",
    `修复范围：${buildAutoBugFixUserIntent(scope, includeLogicReview)}`,
    "",
  ];

  if (!verify.skipped && !verify.ok) {
    lines.push("## 验证失败（优先）");
    if (verify.steps?.length) {
      for (const step of verify.steps) {
        const status = step.ok ? "通过" : `失败 (exit ${step.exitCode})`;
        lines.push(`- ${step.command}：${status}`);
      }
    } else {
      lines.push(`命令：${verify.command}`);
      lines.push(`exit code：${verify.exitCode}`);
    }
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
    lines.push("## 验证");
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

  if (includeLogicReview) {
    lines.push(...buildAutoBugFixLogicReviewSection(input.scan));
  }

  const verifyCommands = resolveVerifyCommands(input);
  if (verifyCommands.length) {
    lines.push("## 复验命令（按序执行，任一步失败即停止）");
    for (const cmd of verifyCommands) {
      lines.push(`- ${cmd}`);
    }
    lines.push("");
  }

  lines.push("## 收尾（必须）");
  lines.push("结束前须输出中文总结，包含：已修复项、跳过/待验证项、复验结果；禁止空回复结束。");
  lines.push("即使未发现需改项，也须说明审查范围与结论。");
  lines.push("");

  return lines.join("\n");
}
