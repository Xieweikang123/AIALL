import {
  applyAnnotationsToDocument,
  buildCodeMapAnnotateMessages,
  nodesForAnnotation,
  parseCodeMapAnnotations,
} from "../../shared/codeMapAnnotate";
import type { CodeMapDocument } from "../../shared/codeMapTypes";
import { isTauriEnv, tauriInvoke } from "./tauriInvoke";

export async function annotateCodeMapDocument(params: {
  document: CodeMapDocument;
  endpoint: string;
  apiKey?: string;
  model: string;
  signal?: AbortSignal;
  /** When false (default), skip nodes that already have a summary. */
  force?: boolean;
}): Promise<{ ok: boolean; document?: CodeMapDocument; error?: string; skipped?: boolean }> {
  if (params.signal?.aborted) return { ok: false, error: "已取消" };
  if (!isTauriEnv()) return { ok: false, error: "需在桌面版中标注" };
  if (!params.endpoint.trim() || !params.model.trim()) {
    return { ok: false, error: "AI 配置不完整" };
  }

  const force = params.force === true;
  if (nodesForAnnotation(params.document, { force }).length === 0) {
    return { ok: true, document: params.document, skipped: true };
  }

  const body = {
    model: params.model,
    messages: buildCodeMapAnnotateMessages(params.document, { force }),
    stream: false,
    temperature: 0.2,
  };

  try {
    const result = await tauriInvoke<{ ok: boolean; data?: unknown; error?: string }>("ai_test", {
      endpoint: params.endpoint,
      apiKey: params.apiKey || null,
      body,
    });
    if (params.signal?.aborted) return { ok: false, error: "已取消" };
    if (!result.ok) {
      return { ok: false, error: result.error || "标注失败" };
    }
    const data = result.data as { choices?: Array<{ message?: { content?: string } }> } | undefined;
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return { ok: false, error: "模型返回为空" };
    }
    const annotations = parseCodeMapAnnotations(content);
    if (!annotations) {
      return { ok: false, error: "无法解析标注结果" };
    }
    return {
      ok: true,
      document: applyAnnotationsToDocument(params.document, annotations),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message || "标注失败" };
  }
}
