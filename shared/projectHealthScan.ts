export type HealthIssueSeverity = "error" | "warning" | "info";

export type HealthIssueCategory = "debt" | "debug" | "smell" | "security";

export type HealthIssue = {
  id: string;
  severity: HealthIssueSeverity;
  title: string;
  detail: string;
  category: HealthIssueCategory;
  file?: string;
  line?: number;
  pattern?: string;
};

export type ProjectHealthScanSummary = {
  errorCount: number;
  warningCount: number;
  infoCount: number;
};

export type ProjectHealthScanPayload = {
  projectPath: string;
  scannedAt: string;
  durationMs: number;
  issues: HealthIssue[];
  summary: ProjectHealthScanSummary;
  checksRun: string[];
};

export const HEALTH_CATEGORY_LABELS: Record<HealthIssueCategory, string> = {
  security: "安全风险",
  smell: "坏味道",
  debug: "调试残留",
  debt: "技术债",
};

export const HEALTH_CATEGORY_ORDER: HealthIssueCategory[] = [
  "security",
  "smell",
  "debug",
  "debt",
];

export function healthIssueCount(result: ProjectHealthScanPayload | null | undefined): number {
  if (!result) return 0;
  return result.summary.errorCount + result.summary.warningCount;
}

function formatIssueLine(issue: HealthIssue): string {
  const loc = issue.file ? ` (${issue.file}${issue.line ? `:${issue.line}` : ""})` : "";
  const lines = [`- [${issue.severity}] ${issue.title}${loc}`];
  if (issue.detail) lines.push(`  ${issue.detail}`);
  return lines.join("\n");
}

/** Ask-mode prompt for deep code review (logic, race, boundaries — not syntax/lint). */
export function buildCodeReviewPrompt(result: ProjectHealthScanPayload): string {
  const lines = [
    "请对当前项目进行只读代码审查，聚焦问题代码（逻辑隐患、竞态、边界、错误处理、耦合与安全），不要检查语法或运行 lint/typecheck。",
    "禁止修改任何文件；每条结论须附相对路径或符号证据，不确定标「待验证」。",
    "",
    `项目路径：${result.projectPath}`,
    `扫描时间：${result.scannedAt}`,
    `规则扫描统计：${result.summary.errorCount} 错误 · ${result.summary.warningCount} 警告 · ${result.summary.infoCount} 提示`,
    "",
    "审查维度：",
    "1. 明显逻辑错误与未处理边界",
    "2. 异步与 DOM 事件时序、竞态",
    "3. 错误被吞掉或静默失败",
    "4. 重复逻辑与过度耦合",
    "5. 安全与权限边界",
    "",
  ];

  if (result.issues.length) {
    lines.push("规则扫描优先核查清单（grep 圈定，可能有误报，须 read_file 核实）：");
    for (const issue of result.issues) {
      lines.push(formatIssueLine(issue));
    }
    lines.push("");
    lines.push("请从上述位置出发深入 read/grep，并补充规则未覆盖的问题；按严重程度输出修复建议。");
  } else {
    lines.push("规则扫描未发现常见坏味道。请从入口链路抽样 read_file，做广覆盖审查并列出问题。");
  }

  return lines.join("\n");
}
