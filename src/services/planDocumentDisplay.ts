import { extractPlanFilePaths, looksLikeModificationPlan } from "./agentContinuation";

export type PlanDocumentDisplay = {
  isPlan: boolean;
  files: string[];
  codeBlockCount: number;
};

export function parsePlanDocumentDisplay(content: string): PlanDocumentDisplay {
  const text = content.trim();
  const files = extractPlanFilePaths(text);
  const codeBlocks = text.match(/```[\w-]*\n[\s\S]*?```/g) ?? [];
  return {
    isPlan: looksLikeModificationPlan(text),
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
  if (options?.whileStreaming) return content;
  const { isPlan, files } = parsePlanDocumentDisplay(content);
  if (!isPlan) return content;
  return injectPlanFileAnchors(content, files);
}
