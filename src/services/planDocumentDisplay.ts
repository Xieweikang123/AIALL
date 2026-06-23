import { extractPlanFilePaths, looksLikeModificationPlan } from "./agentContinuation";

export type PlanDocumentDisplay = {
  isPlan: boolean;
  isPartialPlan: boolean;
  files: string[];
  codeBlockCount: number;
};

/** Detect in-progress plan output before the full plan structure is complete. */
export function looksLikeStreamingPlanContent(content: string): boolean {
  const text = content.trim();
  if (!text) return false;
  if (/(?:^|\n)\s*(?:##\s*修改方案|\[PLAN\]|<!--\s*agent-plan\s*-->)/i.test(text)) return true;
  return /修改方案|涉及文件|详细改动/i.test(text) && extractPlanFilePaths(text).length > 0;
}

export function parsePlanDocumentDisplay(content: string): PlanDocumentDisplay {
  const text = content.trim();
  const files = extractPlanFilePaths(text);
  const codeBlocks = text.match(/```[\w-]*\n[\s\S]*?```/g) ?? [];
  const isCompletePlan = looksLikeModificationPlan(text);
  const isPartialPlan = !isCompletePlan && looksLikeStreamingPlanContent(text);
  return {
    isPlan: isCompletePlan || isPartialPlan,
    isPartialPlan,
    files,
    codeBlockCount: codeBlocks.length,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Inject scroll targets before the first mention of each plan file path. */
export function injectPlanFileAnchors(content: string, files: readonly string[]): string {
  if (!files.length) return content;
  let result = content;
  const anchored = new Set<string>();

  files.forEach((file, index) => {
    if (anchored.has(file)) return;
    const anchor = `<span id="plan-file-${index}" class="plan-file-anchor"></span>`;
    const ticked = `\`${file}\``;
    if (result.includes(ticked)) {
      result = result.replace(ticked, `${anchor}${ticked}`);
      anchored.add(file);
      return;
    }
    const re = new RegExp(`(?<![\`\\w./])(${escapeRegExp(file)})(?![\`\\w./])`);
    if (re.test(result)) {
      result = result.replace(re, `${anchor}$1`);
      anchored.add(file);
    }
  });

  return result;
}

export function enrichPlanMarkdownForDisplay(
  content: string,
  options?: { whileStreaming?: boolean },
): string {
  const { isPlan, files } = parsePlanDocumentDisplay(content);
  if (!isPlan || !files.length) return content;
  if (options?.whileStreaming) return content;
  return injectPlanFileAnchors(content, files);
}
