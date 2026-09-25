/**
 * 「回复时自动跟随到底部」的跟随判定。
 *
 * 规则（产品语义，只有一条）：
 *   - 触底 → 跟随（内容增长时自动滚到底）
 *   - 没触底 → 不跟随（用户在看历史，别拽他）
 *
 * 关键设计：**触底判定只由「用户输入」和「内容增长后恢复」两个时刻触发**，
 * 绝不由 scroll 事件无差别驱动。原因是跟随过程中程序自己写 scrollTop、以及
 * 内容一次长高都会触发 scroll 事件，此时测到的 `remaining` 是弹簧的瞬时落后
 * （例如内容长 35px、弹簧一帧只追 3px → remaining=33），会被误判成「用户离开了底部」，
 * 从而永久停止跟随。这是历史 bug 的根因。
 */

/** 真触底容差（px）。刻意取小值：用户往上翻一点点就应视为离开底部，避免被拽回。 */
export const FOLLOW_BOTTOM_TOLERANCE_PX = 2;

/** 容器是否真的可滚动（不足一屏时滚轮/触摸无效，不应视为「用户离开底部」）。 */
export function canScrollContainer(scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight > clientHeight + 1;
}

/** 是否真触底。 */
export function isTrulyAtBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  tolerance = FOLLOW_BOTTOM_TOLERANCE_PX,
): boolean {
  const remaining = scrollHeight - scrollTop - clientHeight;
  return remaining <= tolerance;
}

/**
 * 用户产生滚动意图时的跟随判定。
 *
 * 容器滚不动（内容不足一屏）时保持原状态：此时滚轮无效，不能算用户离开底部。
 * 否则以「此刻是否触底」为准 —— 这同时覆盖了「往上翻 → 停」与「翻回底部 → 恢复」。
 */
export function decideFollowAfterUserInput(input: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  wasFollowing: boolean;
  tolerance?: number;
}): boolean {
  const { scrollTop, scrollHeight, clientHeight, wasFollowing, tolerance } = input;
  if (!canScrollContainer(scrollHeight, clientHeight)) return wasFollowing;
  return isTrulyAtBottom(scrollTop, scrollHeight, clientHeight, tolerance);
}

/**
 * 内容增长后的跟随恢复判定。
 *
 * 只在当前「未跟随」时才可能恢复（跟随中无需判定，直接继续跟）。
 * 触底即恢复，让用户手动滚回底部后自动重新跟上。
 */
export function decideFollowAfterContentGrowth(input: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  wasFollowing: boolean;
  tolerance?: number;
}): boolean {
  const { scrollTop, scrollHeight, clientHeight, wasFollowing, tolerance } = input;
  if (wasFollowing) return true;
  return isTrulyAtBottom(scrollTop, scrollHeight, clientHeight, tolerance);
}

/**
 * 滚动事件中「是否应恢复跟随」的判定。
 *
 * 返回 true 仅当：当前**未跟随** 且 已真触底。
 * 未跟随时检测触底是必需的 —— 用户滚到底后往往不再产生新的 wheel 事件，
 * 只靠用户输入事件判定会漏掉最后一次，表现为「滚回底部却不再跟随」。
 *
 * 已跟随时恒返回 false：滚动事件在跟随中由程序自身触发（写 scrollTop）或内容增长触发，
 * 此时的 remaining 是弹簧瞬时落后，绝不能据此改变跟随状态（历史 bug 根因）。
 */
export function shouldRecoverFollowOnScroll(input: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  isFollowing: boolean;
  tolerance?: number;
}): boolean {
  const { scrollTop, scrollHeight, clientHeight, isFollowing, tolerance } = input;
  if (isFollowing) return false;
  return isTrulyAtBottom(scrollTop, scrollHeight, clientHeight, tolerance);
}
