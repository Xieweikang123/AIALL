import fs from "node:fs";
import path from "node:path";
import type {
  HealthIssue,
  HealthIssueCategory,
  HealthIssueSeverity,
  ProjectHealthScanPayload,
} from "../shared/projectHealthScan";
import { grepInProject } from "./vibeFs";

export type { HealthIssue, ProjectHealthScanPayload as ProjectHealthScanResult } from "../shared/projectHealthScan";
export { buildCodeReviewPrompt, healthIssueCount } from "../shared/projectHealthScan";

type ScanRule = {
  id: string;
  category: HealthIssueCategory;
  severity: HealthIssueSeverity;
  pattern: string;
  title: string;
  maxMatches: number;
  excludePathRe?: RegExp;
};

const SCAN_RULES: ScanRule[] = [
  {
    id: "debt-marker",
    category: "debt",
    severity: "info",
    pattern: String.raw`\b(TODO|FIXME|HACK|XXX|BUG)\b`,
    title: "未完成标记",
    maxMatches: 24,
  },
  {
    id: "debug-console",
    category: "debug",
    severity: "warning",
    pattern: String.raw`\bconsole\.(log|debug|info)\s*\(`,
    title: "调试输出未清理",
    maxMatches: 12,
    excludePathRe: /\.(test|spec)\.[cm]?[jt]sx?$/i,
  },
  {
    id: "smell-empty-catch",
    category: "smell",
    severity: "warning",
    pattern: String.raw`catch\s*\([^)]*\)\s*\{\s*\}`,
    title: "空 catch 吞掉异常",
    maxMatches: 16,
  },
  {
    id: "smell-ts-ignore",
    category: "smell",
    severity: "info",
    pattern: String.raw`@(ts-ignore|ts-expect-error)|eslint-disable`,
    title: "规则绕过注释",
    maxMatches: 16,
  },
  {
    id: "smell-any-type",
    category: "smell",
    severity: "info",
    pattern: String.raw`(: any\b|as any\b)`,
    title: "any 类型使用",
    maxMatches: 16,
  },
  {
    id: "security-eval",
    category: "security",
    severity: "error",
    pattern: String.raw`\beval\s*\(|new Function\s*\(`,
    title: "动态代码执行",
    maxMatches: 8,
  },
  {
    id: "security-innerhtml",
    category: "security",
    severity: "warning",
    pattern: String.raw`\.innerHTML\s*=`,
    title: "直接赋值 innerHTML",
    maxMatches: 12,
  },
  {
    id: "security-hardcoded-secret",
    category: "security",
    severity: "error",
    pattern: String.raw`(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}['"]`,
    title: "疑似硬编码密钥",
    maxMatches: 8,
    excludePathRe: /\.(example|sample|template)|\.env\.|mock|fixture|test|spec/i,
  },
];

const SKIP_PATH_RE = /node_modules|dist\/|\.git\/|build\/|coverage\//;

function countBySeverity(issues: HealthIssue[]) {
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  for (const issue of issues) {
    if (issue.severity === "error") errorCount += 1;
    else if (issue.severity === "warning") warningCount += 1;
    else infoCount += 1;
  }
  return { errorCount, warningCount, infoCount };
}

function shouldSkipMatch(relative: string, text: string, rule: ScanRule): boolean {
  if (SKIP_PATH_RE.test(relative)) return true;
  if (rule.excludePathRe?.test(relative)) return true;
  if (rule.id === "security-hardcoded-secret") {
    const lower = text.toLowerCase();
    if (/placeholder|example|changeme|your[-_]|xxx|dummy|fake|test/i.test(lower)) return true;
    if (/['"]\s*['"]/.test(text)) return true;
  }
  return false;
}

function issueId(ruleId: string, relative: string, line: number): string {
  return `${ruleId}-${relative.replace(/[^\w.-]+/g, "_")}-${line}`;
}

async function runGrepRule(
  projectRoot: string,
  rule: ScanRule,
  issues: HealthIssue[],
  checksRun: string[],
): Promise<void> {
  checksRun.push(`grep:${rule.id}`);
  const result = await grepInProject(projectRoot, rule.pattern, rule.maxMatches);
  if (!result.ok) return;

  for (const match of result.matches) {
    if (shouldSkipMatch(match.relative, match.text, rule)) continue;
    const snippet = match.text.trim().slice(0, 80);
    issues.push({
      id: issueId(rule.id, match.relative, match.line),
      severity: rule.severity,
      title: rule.title,
      detail: `${match.relative}:${match.line}${snippet ? ` — ${snippet}` : ""}`,
      category: rule.category,
      file: match.relative,
      line: match.line,
      pattern: rule.id,
    });
  }
}

export async function scanProjectHealth(projectPath: string): Promise<ProjectHealthScanPayload & { ok: true }> {
  const started = Date.now();
  const projectRoot = path.resolve(projectPath);
  const stat = await fs.promises.stat(projectRoot).catch(() => null);
  if (!stat?.isDirectory()) {
    return {
      ok: true,
      projectPath: projectRoot,
      scannedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      issues: [{
        id: "invalid-path",
        severity: "error",
        title: "无效的项目路径",
        detail: "路径不存在或不是目录。",
        category: "smell",
      }],
      summary: { errorCount: 1, warningCount: 0, infoCount: 0 },
      checksRun: [],
    };
  }

  const issues: HealthIssue[] = [];
  const checksRun: string[] = [];

  for (const rule of SCAN_RULES) {
    await runGrepRule(projectRoot, rule, issues, checksRun);
  }

  return {
    ok: true,
    projectPath: projectRoot,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    issues,
    summary: countBySeverity(issues),
    checksRun,
  };
}
