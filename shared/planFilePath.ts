/** Legacy single-file plan path (pre per-message plans). */
export const LEGACY_PLAN_DOCUMENT_REL_PATH = ".aiall/PLAN.md";

/** Directory for per-plan message documents. */
export const PLAN_DOCUMENTS_DIR = ".aiall/plans";

/** @deprecated Prefer per-message paths under {@link PLAN_DOCUMENTS_DIR}. */
export const PLAN_DOCUMENT_REL_PATH = LEGACY_PLAN_DOCUMENT_REL_PATH;

export function buildPlanDocumentRelPath(messageId: string): string {
  const safe = messageId.replace(/\\/g, "/").trim().replace(/\//g, "-");
  if (!safe || safe.includes("..")) {
    throw new Error("invalid plan message id");
  }
  return `${PLAN_DOCUMENTS_DIR}/${safe}.md`;
}

/** Resolve on-disk path for a plan message (migrates off legacy shared PLAN.md). */
export function resolvePlanDocumentRelPath(
  messageId: string,
  existingPlanFilePath?: string,
): string {
  const existing = existingPlanFilePath?.replace(/\\/g, "/").trim();
  if (existing && isPlanDocumentPath(existing) && existing !== LEGACY_PLAN_DOCUMENT_REL_PATH) {
    return existing;
  }
  return buildPlanDocumentRelPath(messageId);
}

export function isPlanDocumentPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").trim();
  if (normalized === LEGACY_PLAN_DOCUMENT_REL_PATH) return true;
  if (!normalized.startsWith(`${PLAN_DOCUMENTS_DIR}/`)) return false;
  if (normalized.includes("..")) return false;
  return normalized.endsWith(".md");
}

export function buildPlanDocumentBuildModeBlockedMessage(toolName: string): string {
  return (
    `错误：Build/执行阶段勿对 ${PLAN_DOCUMENTS_DIR}/ 下方案文件或 ${LEGACY_PLAN_DOCUMENT_REL_PATH} 调用 ${toolName}；` +
    "方案文档由 Plan 模式或客户端维护，请只修改业务代码。"
  );
}
