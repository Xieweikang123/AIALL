/** Consultative accuracy / behavior Q&A — trace depth and premature-answer guards. */

export function normalizeConsultativeReadPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").trim().toLowerCase();
}

/** Entry layer: composable, component, or view handling user action. */
export function isConsultativeEntryLayerPath(filePath: string): boolean {
  const p = normalizeConsultativeReadPath(filePath);
  return /(?:^|\/)src\/(?:composables|components|views)\//.test(p);
}

/** Client API or service forwarding to backend. */
export function isConsultativeClientLayerPath(filePath: string): boolean {
  const p = normalizeConsultativeReadPath(filePath);
  return /(?:^|\/)src\/services\//.test(p);
}

/** Backend route, handler, or middleware where prompt/data is assembled. */
export function isConsultativeBackendLayerPath(filePath: string): boolean {
  const p = normalizeConsultativeReadPath(filePath);
  return /(?:^|\/)server\//.test(p) || /middleware/.test(p);
}

/**
 * Accuracy questions need entry + (client or backend) + backend/prompt layer evidence.
 * At least two distinct reads spanning entry and implementation/prompt construction.
 */
export function hasConsultativeAccuracyTraceDepth(readPaths: string[]): boolean {
  if (readPaths.length < 2) return false;
  const hasEntry = readPaths.some(isConsultativeEntryLayerPath);
  const hasBackend = readPaths.some(isConsultativeBackendLayerPath);
  return hasEntry && hasBackend;
}

export function isDeferredBehaviorAnswerReply(text: string): boolean {
  const body = text.replace(/\s*\[图已理解\]\s*/g, "").trim();
  if (!body) return false;
  return (
    /想让我.{0,32}(?:看|深入|确认|排查|读)/.test(body) ||
    /(?:要不要|是否需要|是否).{0,16}(?:看|深入|确认).{0,16}(?:prompt|构造|实现)/.test(body) ||
    /基于已有信息直接回答/.test(body)
  );
}

/** Conditional implementation advice without code evidence (e.g. 「如果 prompt 包含…」). */
export function isSpeculativeImplementationReply(text: string): boolean {
  const body = text.replace(/\s*\[图已理解\]\s*/g, "").trim();
  if (!body) return false;
  if (/(?:如果|若).{0,40}(?:prompt|注入|上下文).{0,48}(?:较|会|可能|偏高|偏低|够|不够)/.test(body)) {
    return true;
  }
  if (/如果只是.{0,24}(?:文件名|列表|名字)/.test(body)) return true;
  return false;
}

export function buildConsultativeAccuracyTraceHint(): string {
  return [
    "【准确度·须 trace 到 prompt 构造】用户问输出/行为是否准确，不是 UI 定位题。",
    "grep 命中入口后须 read 并沿调用链向下：composable/组件 → API 客户端（若有）→ backend 路由/middleware 中 prompt 或数据处理处。",
    "回答须基于已读代码说明实际注入的上下文与条件；禁止用「如果 prompt 包含…」猜测；禁止写「想让我深入看一下」或「基于已有信息直接回答」。",
  ].join("");
}

export function buildConsultativeAccuracyTraceRetryHint(readPaths: string[]): string {
  const listed =
    readPaths.length > 0
      ? `已 read：${readPaths.slice(-4).join("、")}。`
      : "尚未 read 任何文件。";
  return [
    "【准确度·trace 未完成】尚未读到 backend/middleware 的 prompt 或数据处理实现，不能结案。",
    listed,
    "请继续：grep 客户端调用的 API 路径或 handler 符号 → read_file backend/middleware 中 prompt 构造处 → 再给出最终答案。",
    "禁止用条件句猜测；禁止反问用户要不要继续查。",
  ].join("");
}

export function shouldBlockConsultativeAccuracyFinalize(params: {
  accuracyConsultative: boolean;
  visionLocateToolsUsed: boolean;
  consultativeReadPaths: string[];
  replyText: string;
}): boolean {
  if (!params.accuracyConsultative) return false;

  if (isDeferredBehaviorAnswerReply(params.replyText)) return true;
  if (isSpeculativeImplementationReply(params.replyText)) return true;

  if (
    params.visionLocateToolsUsed &&
    !hasConsultativeAccuracyTraceDepth(params.consultativeReadPaths)
  ) {
    return true;
  }

  return false;
}
