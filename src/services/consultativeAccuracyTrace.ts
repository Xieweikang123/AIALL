/** Consultative accuracy / behavior Q&A — trace depth and premature-answer guards. */

export function normalizeConsultativeReadPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").trim().toLowerCase();
}

/**
 * The guard cannot infer architectural layers from file names. A repository may use
 * any directory layout, so it only rejects a single-file trace; call-graph evidence
 * is established by the model's grep/read work and the final answer.
 */
export function hasConsultativeAccuracyTraceDepth(readPaths: string[]): boolean {
  const distinctPaths = new Set(
    readPaths.map(normalizeConsultativeReadPath).filter(Boolean),
  );
  return distinctPaths.size >= 2;
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
    "【准确度·须完成证据链】用户问输出/行为是否准确，不是 UI 定位题。",
    "grep 命中相关符号后须按实际调用关系继续 read 定义、调用方/被调用方、条件分支与最终结果点；不要假设固定目录、框架或 backend/middleware 层。",
    "回答须基于已读代码说明实际注入的上下文与条件；禁止用「如果 prompt 包含…」猜测；禁止写「想让我深入看一下」或「基于已有信息直接回答」。",
  ].join("");
}

export function buildConsultativeAccuracyTraceRetryHint(readPaths: string[]): string {
  const listed =
    readPaths.length > 0
      ? `已 read：${readPaths.slice(-4).join("、")}。`
      : "尚未 read 任何文件。";
  return [
    "【准确度·trace 未完成】当前只读到局部代码，尚未形成足以证明结论的证据链，不能结案。",
    listed,
    "请继续：根据已读符号 grep 其调用方/被调用方 → read_file 决定结果的条件与最终结果点 → 再给出最终答案。",
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
