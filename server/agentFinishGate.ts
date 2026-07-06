import type { WriteStage } from "./agentToolExecutor";
import { isProductiveWritePath } from "../shared/agentExplorationBudget";
import { claimsWriteCompletion, isEmptyOrInsufficientFinalReply, sanitizeAgentUserVisibleText } from "./agentExploreGuard";
import { detectTaskAnchorPolarity } from "../src/orchestration/generic/quotedAmendIntent";

export type FinishGateViolation = {
  code:
    | "execute_plan_target_miss"
    | "execute_plan_no_writes"
    | "phantom_file_claim"
    | "task_anchor_miss"
    | "task_anchor_still_present"
    | "verify_not_run"
    | "verify_regression"
    | "empty_summary";
  detail: string;
};

export type FinishGateInput = {
  rawContent: string;
  writeStage: WriteStage | null;
  isReadOnlyAgent: boolean;
  isPlanExplore: boolean;
  readOnlyBuildRun: boolean;
  isExecutePlan: boolean;
  implementFollowUpRun: boolean;
  targetFiles?: string[];
  taskPrompt?: string;
  automatedBugFixRun?: boolean;
  verifyScriptAvailable?: boolean;
  lastVerifyRunSucceeded?: boolean | null;
};

export type FinishGateResult = {
  blocked: boolean;
  violations: FinishGateViolation[];
};

const SOURCE_FILE_EXT =
  /\.(?:ts|tsx|js|jsx|vue|cs|json|md|yaml|yml|css|scss|html|xml|sql|go|rs|py|toml)$/i;

const MODIFY_CONTEXT_RE =
  /(?:已(?:经)?(?:修改|更新|修复|调整|写入|改为|改成|添加|删除)|改动|变更|patch|write|更新于)/i;

const GENERIC_ANCHOR_BLOCKLIST = new Set([
  "true",
  "false",
  "null",
  "undefined",
  "string",
  "number",
  "object",
  "function",
  "import",
  "export",
  "return",
  "async",
  "await",
  "class",
  "interface",
  "type",
  "const",
  "let",
  "var",
  "build",
  "plan",
  "ask",
]);

export function writtenStagePaths(stage: WriteStage): string[] {
  return stage.writtenList
    .map((entry) => {
      if (typeof entry === "string") return entry.replace(/\\/g, "/").trim();
      const keyed = (entry as { key?: string }).key;
      return String(keyed ?? "").replace(/\\/g, "/").trim();
    })
    .filter(Boolean);
}

export function productiveWrittenPaths(stage: WriteStage): string[] {
  return writtenStagePaths(stage).filter(isProductiveWritePath);
}

export function normalizeTargetPath(path: string): string {
  return path.replace(/\\/g, "/").trim();
}

/** Extract high-signal anchors from the task prompt — structure only, no feature binding. */
export function extractTaskContractAnchors(taskPrompt: string): string[] {
  const text = taskPrompt.trim();
  if (!text) return [];

  const anchors: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string) => {
    const value = raw.trim();
    if (!value || value.length < 2 || value.length > 80) return;
    const key = value.toLowerCase();
    if (seen.has(key) || GENERIC_ANCHOR_BLOCKLIST.has(key)) return;
    if (SOURCE_FILE_EXT.test(value) || /^\.?\/?[\w./-]+$/.test(value) && value.includes("/")) return;
    seen.add(key);
    anchors.push(value);
  };

  for (const match of text.matchAll(/`([^`]{2,80})`/g)) {
    add(match[1]);
  }

  for (const match of text.matchAll(
    /(\d+)\s*(?:分钟|min(?:ute)?s?|m(?![a-z])|秒|sec(?:ond)?s?|s(?![a-z])|毫秒|ms|小时|h(?![a-z]))/gi,
  )) {
    add(match[0].replace(/\s+/g, ""));
  }

  for (const match of text.matchAll(/\b[A-Z][a-zA-Z0-9]{2,}(?:[A-Z][a-zA-Z0-9]+)+\b/g)) {
    add(match[0]);
  }

  return anchors.slice(0, 8);
}

/** Paths mentioned in the summary as modified — used to catch phantom file claims. */
export function extractClaimedModifiedPaths(text: string): string[] {
  const body = sanitizeAgentUserVisibleText(text);
  if (!body) return [];

  const paths = new Set<string>();
  const pathRe = /([\w./-]+\.(?:ts|tsx|js|jsx|vue|cs|json|md|yaml|yml|css|scss))/gim;
  const documentHasModifyContext = MODIFY_CONTEXT_RE.test(body);

  for (const match of body.matchAll(pathRe)) {
    const candidate = normalizeTargetPath(match[1]);
    if (!candidate || candidate.startsWith("http")) continue;
    if (!documentHasModifyContext) {
      const start = Math.max(0, match.index ?? 0);
      const window = body.slice(Math.max(0, start - 40), Math.min(body.length, start + candidate.length + 20));
      if (!MODIFY_CONTEXT_RE.test(window)) continue;
    }
    paths.add(candidate);
  }

  return [...paths];
}

function pathsOverlap(written: string[], targets: string[]): boolean {
  if (!written.length || !targets.length) return false;
  const writtenSet = new Set(written.map(normalizeTargetPath));
  return targets.some((target) => {
    const normalized = normalizeTargetPath(target);
    if (writtenSet.has(normalized)) return true;
    const base = normalized.split("/").pop() ?? normalized;
    return [...writtenSet].some(
      (path) => path === normalized || path.endsWith(`/${normalized}`) || path.endsWith(`/${base}`),
    );
  });
}

function stagedContentIncludesAnchor(stage: WriteStage, anchor: string): boolean {
  const needle = anchor.toLowerCase().replace(/\s+/g, "");
  if (!needle) return true;

  const durationMatch = needle.match(/^(\d+)(?:分钟|min(?:ute)?s?|m|秒|sec(?:ond)?s?|s|毫秒|ms|小时|h)?$/i);
  if (durationMatch) {
    const numeric = durationMatch[1];
    for (const relPath of writtenStagePaths(stage)) {
      const content = stage.files.get(relPath);
      if (!content) continue;
      if (new RegExp(`\\b${numeric}\\b`).test(content)) return true;
    }
    return false;
  }

  for (const relPath of writtenStagePaths(stage)) {
    const content = stage.files.get(relPath);
    if (!content) continue;
    const haystack = content.toLowerCase().replace(/\s+/g, "");
    if (haystack.includes(needle)) return true;
  }
  return false;
}

export function shouldRunFinishGate(params: {
  isReadOnlyAgent: boolean;
  isPlanExplore: boolean;
  readOnlyBuildRun: boolean;
  writeStage: WriteStage | null;
}): boolean {
  if (params.isReadOnlyAgent || params.isPlanExplore || params.readOnlyBuildRun) return false;
  return params.writeStage !== null;
}

export function evaluateFinishGate(input: FinishGateInput): FinishGateResult {
  if (!shouldRunFinishGate(input)) {
    return { blocked: false, violations: [] };
  }

  const stage = input.writeStage!;
  const productiveWrites = productiveWrittenPaths(stage);
  const claimsDone = claimsWriteCompletion(input.rawContent);
  const violations: FinishGateViolation[] = [];
  const targetFiles = (input.targetFiles ?? []).map(normalizeTargetPath).filter(Boolean);

  if (input.isExecutePlan && targetFiles.length > 0 && claimsDone) {
    if (productiveWrites.length === 0) {
      violations.push({
        code: "execute_plan_no_writes",
        detail: `方案目标文件 ${targetFiles.join("、")} 尚未落盘任何 productive 修改`,
      });
    } else if (!pathsOverlap(productiveWrites, targetFiles)) {
      violations.push({
        code: "execute_plan_target_miss",
        detail: `已修改 ${productiveWrites.join("、")}，但未触及方案目标 ${targetFiles.join("、")}`,
      });
    }
  }

  if (productiveWrites.length > 0) {
    const summaryClaimsModifications =
      claimsDone || MODIFY_CONTEXT_RE.test(sanitizeAgentUserVisibleText(input.rawContent));
    if (summaryClaimsModifications) {
      const writtenSet = new Set(productiveWrites.map(normalizeTargetPath));
      for (const claimed of extractClaimedModifiedPaths(input.rawContent)) {
        if (writtenSet.has(claimed)) continue;
        const base = claimed.split("/").pop() ?? claimed;
        const matched = [...writtenSet].some(
          (path) => path === claimed || path.endsWith(`/${claimed}`) || path.endsWith(`/${base}`),
        );
        if (!matched) {
          violations.push({
            code: "phantom_file_claim",
            detail: `总结声称已修改 ${claimed}，但本轮未写入该文件（实际写入：${productiveWrites.join("、") || "无"}）`,
          });
        }
      }
    }
  }

  const taskPrompt = (input.taskPrompt ?? "").trim();
  const { polarity, excludeAnchors } = detectTaskAnchorPolarity(taskPrompt);
  const anchors = extractTaskContractAnchors(taskPrompt);

  if (claimsDone && productiveWrites.length > 0 && excludeAnchors.length > 0 && polarity === "must_exclude") {
    const stillPresent = excludeAnchors.filter((anchor) => stagedContentIncludesAnchor(stage, anchor));
    if (stillPresent.length > 0) {
      violations.push({
        code: "task_anchor_still_present",
        detail: `用户要求移除，但已写入内容仍包含：${stillPresent.join("、")}`,
      });
    }
  }

  if (claimsDone && productiveWrites.length > 0 && anchors.length > 0) {
    const excludeKeys = new Set(excludeAnchors.map((anchor) => anchor.toLowerCase()));
    const includeAnchors =
      polarity === "must_exclude"
        ? anchors.filter((anchor) => !excludeKeys.has(anchor.toLowerCase()))
        : anchors;
    const missing = includeAnchors.filter((anchor) => !stagedContentIncludesAnchor(stage, anchor));
    if (missing.length > 0) {
      violations.push({
        code: "task_anchor_miss",
        detail: `任务契约锚点未出现在已写入内容中：${missing.join("、")}`,
      });
    }
  }

  if (
    input.automatedBugFixRun &&
    claimsDone &&
    input.verifyScriptAvailable &&
    input.lastVerifyRunSucceeded !== true
  ) {
    violations.push({
      code: "verify_not_run",
      detail: "扫描修复须在宣称完成前成功 run_command 执行 verify 脚本",
    });
  }

  if (input.automatedBugFixRun && input.lastVerifyRunSucceeded === false && claimsDone) {
    violations.push({
      code: "verify_regression",
      detail: "最近一次 verify 命令仍失败，不可宣称修复完成",
    });
  }

  if (
    input.automatedBugFixRun &&
    isEmptyOrInsufficientFinalReply(sanitizeAgentUserVisibleText(input.rawContent))
  ) {
    violations.push({
      code: "empty_summary",
      detail: "扫描修复结束前须输出中文总结（已修复项 / 跳过项 / 复验结果）；禁止空回复结束",
    });
  }

  return {
    blocked: violations.length > 0,
    violations,
  };
}

export function buildFinishGateRetryNudge(result: FinishGateResult): string {
  const lines = [
    "【收尾门禁·红军驳回】你的总结与真实落盘不一致，禁止交付虚假收尾。",
    "请对照下列问题修正代码或改写总结（失败项须如实标注「未生效」）：",
  ];
  for (const violation of result.violations) {
    lines.push(`- ${violation.detail}`);
  }
  lines.push(
    "核对后再回复：① 仅声称 writeStage 中已成功修改的文件；② 方案/任务中的关键锚点须出现在 diff；③ 未完成的文件或 patch 失败须明确写出。",
  );
  return lines.join("\n");
}
