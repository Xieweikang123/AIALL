/** Consultative behavior-purpose Q&A — trace usage branches before finalize. */

import { isDeferredBehaviorAnswerReply } from "./consultativeAccuracyTrace";
import { DEFINITION_VALUE_TOKEN_RE } from "./agentStructuralPatterns";

/** Reply hedges purpose without citing code branches or call sites. */
export function isSpeculativeBehaviorPurposeReply(text: string): boolean {
  const body = text.replace(/\s*\[图已理解\]\s*/g, "").trim();
  if (!body) return false;
  if (/可能.{0,32}(?:作为|用于|在).{0,32}(?:标识|状态|流程|标记)/.test(body)) {
    return true;
  }
  if (/具体使用位置需要查看|需要查看引用|须查看引用|具体用法需要/.test(body)) {
    return true;
  }
  if (/可能在.{0,20}(?:流程|场景|处理)中/.test(body)) {
    return true;
  }
  return false;
}

const ENUM_VALUE_LINE_RE = DEFINITION_VALUE_TOKEN_RE;

/** Lists enum/field values again without explaining runtime branches. */
export function isEnumListingWithoutUsageReply(text: string): boolean {
  const body = text.replace(/\s*\[图已理解\]\s*/g, "").trim();
  if (!body) return false;
  ENUM_VALUE_LINE_RE.lastIndex = 0;
  const enumHits = (body.match(ENUM_VALUE_LINE_RE) || []).length;
  if (enumHits < 2) return false;
  return !hasBehaviorUsageEvidenceInReply(body);
}

/** User-visible reply cites runtime usage or another concrete result path. */
export function hasBehaviorUsageEvidenceInReply(text: string): boolean {
  const body = text.replace(/\s*\[图已理解\]\s*/g, "").trim();
  if (!body) return false;
  return (
    /(?:if\s*\(|switch\s*\(|==|!=|===|!==)/.test(body) ||
    /(?:当|若|只有|满足|否则|则|时会|才会|分支|调用|更新|修改|校验|回滚|写入|改为|设置为)/.test(body) ||
    /`[A-Za-z_][\w]*`\s*(?:方法|函数|逻辑|分支)/.test(body) ||
    /(?:Process|Update|Revert|Handle)[A-Za-z]+\w*/.test(body)
  );
}

/** Opens with explore intent but delivers enum list / speculation instead of usage trace. */
export function hasUnfulfilledExplorePreamble(text: string): boolean {
  const body = text.replace(/\s*\[图已理解\]\s*/g, "").trim();
  if (!/让我在.{0,40}(?:搜索|查看|排查|定位|read|grep)/i.test(body)) return false;
  return isSpeculativeBehaviorPurposeReply(body) || isEnumListingWithoutUsageReply(body);
}

export function buildBehaviorPurposeTraceHint(): string {
  return [
    "【行为·用途/作用】用户问字段/枚举/类型的实际用途，不是再要定义列表。",
    "grep 符号命中后须 read 引用处（条件分支、调用关系或结果构造），说明「满足何条件 → 得到什么结果」；结果可以是返回值、异常、状态、事件或外部影响。",
    "禁止只复述枚举值；禁止「可能…作为状态标识」「具体使用位置需要查看」等推给用户查。",
    "若已 read 到分支逻辑，须在答复中引用条件与结果（可写方法名与分支差异）。",
  ].join("");
}

export function buildBehaviorPurposeTraceRetryHint(readPaths: string[]): string {
  const listed =
    readPaths.length > 0
      ? `已 read：${readPaths.slice(-4).join("、")}。`
      : "尚未 read 任何文件。";
  return [
    "【行为·用途 trace 未完成】答复仍在猜测或重复枚举定义，未说明代码中的实际分支、调用关系或结果。",
    listed,
    "请继续：grep 枚举/字段符号 → read_file 引用处完整 if/else 或调用方 → 再输出最终答案。",
    "禁止写「可能需要查看引用」；禁止用「可能…流程中作为标识」代替已读逻辑。",
  ].join("");
}

export function shouldBlockBehaviorPurposeFinalize(params: {
  behaviorPurpose: boolean;
  consultativeReadPaths: string[];
  replyText: string;
}): boolean {
  if (!params.behaviorPurpose) return false;

  const reply = params.replyText;
  if (isDeferredBehaviorAnswerReply(reply)) return true;
  if (hasUnfulfilledExplorePreamble(reply)) return true;
  if (isSpeculativeBehaviorPurposeReply(reply)) return true;
  if (isEnumListingWithoutUsageReply(reply)) return true;

  if (
    params.consultativeReadPaths.length >= 2 &&
    !hasBehaviorUsageEvidenceInReply(reply)
  ) {
    return true;
  }

  return false;
}
