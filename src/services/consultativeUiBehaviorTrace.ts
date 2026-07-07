/** Consultative UI state / persistence behavior Q&A — trace side effects before finalize. */

import { assistantProvidedCodeLocationEvidence } from "./agentStructuralPatterns";
import { isUiStatePersistenceQuestionPrompt } from "../orchestration/generic/userIntentClassifiers";

export const SPECULATIVE_CODE_ANALYSIS_RE =
  /(?:根据代码|查阅了|通过\s*grep|在该文件中|代码分析)/;

const SHALLOW_STATE_INDEPENDENCE_RE =
  /(?:两个独立|互不干扰|不会触动|只改\s*\w+|存储在不同)/;

/** State/logic layer vs view/presentation layer — stack-agnostic path shapes. */
const STATE_LAYER_PATH_RE =
  /(?:^|\/)(?:composables|hooks|stores|state|services|models|lib|domain)(?:\/|$)/i;
const VIEW_LAYER_PATH_RE =
  /(?:^|\/)(?:views|pages|components|screens|ui|app|widgets)(?:\/|$)/i;

function normalizeTracePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function pathInStateLayer(filePath: string): boolean {
  return STATE_LAYER_PATH_RE.test(normalizeTracePath(filePath));
}

function pathInViewLayer(filePath: string): boolean {
  return VIEW_LAYER_PATH_RE.test(normalizeTracePath(filePath));
}

const CITED_FILE_PATH_RE =
  /[`("']?((?:[\w.-]+\/)+[\w.-]+\.(?:vue|tsx?|jsx?|ts|cs|scss|css))[`)"']?/gi;

export function normalizeConsultativePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "").trim().toLowerCase();
}

export function consultativePathMatches(read: string, cited: string): boolean {
  const r = normalizeConsultativePath(read);
  const c = normalizeConsultativePath(cited);
  if (!r || !c) return false;
  return r === c || r.endsWith(`/${c}`) || c.endsWith(`/${r}`) || r.endsWith(c) || c.endsWith(r);
}

export function extractCitedFilePaths(text: string): string[] {
  const paths = new Set<string>();
  CITED_FILE_PATH_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CITED_FILE_PATH_RE.exec(text)) !== null) {
    const path = match[1]?.replace(/\\/g, "/").trim();
    if (path) paths.add(path);
  }
  return [...paths];
}

export function replyCitesUnreadPaths(replyText: string, readPaths: string[]): boolean {
  const cited = extractCitedFilePaths(replyText);
  if (!cited.length) return false;
  if (!readPaths.length) return true;
  return cited.some((c) => !readPaths.some((r) => consultativePathMatches(r, c)));
}

export function replyClaimsCodeWithoutToolEvidence(
  replyText: string,
  consultativeReadPaths: string[],
  visionLocateToolsUsed: boolean,
): boolean {
  const body = replyText.replace(/\s*\[图已理解\]\s*/g, "").trim();
  if (!body) return false;

  const citesCode =
    assistantProvidedCodeLocationEvidence(body) || SPECULATIVE_CODE_ANALYSIS_RE.test(body);
  if (!citesCode) return false;

  if (/(?:第\s*\d+\s*行|约第\s*\d+)/.test(body) && consultativeReadPaths.length === 0) {
    return true;
  }

  if (
    SPECULATIVE_CODE_ANALYSIS_RE.test(body) &&
    !visionLocateToolsUsed &&
    consultativeReadPaths.length === 0
  ) {
    return true;
  }

  return replyCitesUnreadPaths(body, consultativeReadPaths);
}

export function isShallowStateIndependenceClaim(
  replyText: string,
  consultativeReadPaths: string[],
  grepPatterns: string[],
): boolean {
  const body = replyText.replace(/\s*\[图已理解\]\s*/g, "").trim();
  if (!SHALLOW_STATE_INDEPENDENCE_RE.test(body)) return false;
  if (/watch\s*\(|\.value\s*=|collapse|expand|emit\s*\(/i.test(body)) return false;

  const grepBlob = grepPatterns.join("\n");
  if (/watch|collapse|expand/i.test(grepBlob)) return false;

  if (consultativeReadPaths.length >= 2) {
    const hasStateLayer = consultativeReadPaths.some(pathInStateLayer);
    const hasViewLayer = consultativeReadPaths.some(pathInViewLayer);
    if (hasStateLayer && hasViewLayer) return false;
  }

  if (consultativeReadPaths.length === 1 && pathInViewLayer(consultativeReadPaths[0]!)) {
    return true;
  }

  return consultativeReadPaths.length === 0;
}

export function isUiStateBehaviorQuestion(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  if (isUiStatePersistenceQuestionPrompt(text)) return true;
  return /(?:切换|切到|切回).{0,24}(?:会|会不会|还会).{0,24}(?:打开|关闭|展开|折叠|显示|隐藏|恢复|保留|再次)/.test(
    text,
  );
}

export function shouldBlockConsultativeUiBehaviorFinalize(params: {
  readOnlyBuildRun: boolean;
  prompt: string;
  replyText: string;
  consultativeReadPaths: string[];
  consultativeReadFailedPaths?: string[];
  visionLocateToolsUsed: boolean;
  grepPatterns?: string[];
}): boolean {
  if (!params.readOnlyBuildRun) return false;

  if (
    replyClaimsCodeWithoutToolEvidence(
      params.replyText,
      params.consultativeReadPaths,
      params.visionLocateToolsUsed,
    )
  ) {
    return true;
  }

  if (
    isUiStateBehaviorQuestion(params.prompt) &&
    !params.visionLocateToolsUsed &&
    params.consultativeReadPaths.length === 0
  ) {
    return true;
  }

  if (
    isShallowStateIndependenceClaim(
      params.replyText,
      params.consultativeReadPaths,
      params.grepPatterns ?? [],
    )
  ) {
    return true;
  }

  const failed = params.consultativeReadFailedPaths ?? [];
  if (
    failed.length > 0 &&
    extractCitedFilePaths(params.replyText).some((cited) =>
      failed.some((f) => consultativePathMatches(f, cited)),
    )
  ) {
    return true;
  }

  return false;
}

export function buildConsultativeUiBehaviorTraceHint(): string {
  return [
    "",
    "【UI 状态·行为题】用户问切换/返回后某面板或区域是否仍展开/可见/保持原状。",
    "须 grep 可见 tab 文案或 mode/composable 符号 → read 切换 handler → 再 grep/read watch、collapse/expand 或 emit 副作用。",
    "禁止只断言「两个 ref 独立、互不干扰」；mode 变更时可能有 watch 主动改另一状态。",
    "行号须来自 read_file；read 失败的路径禁止引用；勿沿用会话历史中已证伪的文件路径。",
  ].join("\n");
}

export function buildConsultativeUiBehaviorTraceRetryHint(
  readPaths: string[],
  failedPaths: string[] = [],
): string {
  const listed =
    readPaths.length > 0 ? `已 read：${readPaths.slice(-4).join("、")}。` : "本轮尚未成功 read 任何文件。";
  const failed =
    failedPaths.length > 0
      ? `read 失败路径：${failedPaths.slice(-3).join("、")}——禁止继续引用。`
      : "";
  return [
    "【UI 状态·trace 未完成】你在未核对副作用的情况下给出了代码结论或「独立状态」断言。",
    listed,
    failed,
    "请继续：grep tab/mode 符号 → read 切换入口 → grep/read watch 或 collapse/expand 调用方，再输出最终答案。",
    "若与上轮结论矛盾，须显式更正；禁止凭记忆写行号或虚构路径。",
  ].join("");
}
