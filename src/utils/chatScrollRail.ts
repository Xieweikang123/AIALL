/**
 * 「会话导航导轨」的纯几何计算：把每条消息在滚动内容里的绝对位置，
 * 映射成右侧导轨上的 0~1 归一化刻度，并挑出当前视口中心的那条。
 *
 * 之所以单独抽成纯函数，是因为「当前在看的问是哪个」这类判断最容易写错
 * （边界、零高度、内容不足一屏），放这里可以用 vitest 直接覆盖。
 */

export type ChatRailAnchorInput = {
  id: string;
  /** 消息块在滚动内容坐标系里的顶部（offsetTop）。 */
  top: number;
  /** 消息块高度。 */
  height: number;
};

export type ChatRailAnchor = {
  id: string;
  /** 归一化位置（0~1），导轨上的刻度画在这里。 */
  pos: number;
  /** 是否与当前视口区间相交（即用户正在看这条）。 */
  inView: boolean;
};

export type ChatRailViewport = {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
};

/** 消息块高度为 0（尚未布局完）时用它兜底，避免除零 / 刻度全叠在一点。 */
const MIN_BLOCK_HEIGHT = 1;

/**
 * 刻度纵向收拢到的区间（相对手柄高度）。
 *
 * 直接用 0~1 铺满整个滚动区会让首尾刻度顶到上下边缘，看着"散满一列"；
 * 收进 20%~80% 后整列上下居中，同时保留刻度之间的相对间距（线性缩放不变比值）。
 */
export const RAIL_BAND_START = 0.2;
export const RAIL_BAND_END = 0.8;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** 把 0~1 的绝对位置压进居中的一段，保留相对间距。 */
function contentFractionToBand(fraction: number): number {
  return RAIL_BAND_START + clamp01(fraction) * (RAIL_BAND_END - RAIL_BAND_START);
}

/**
 * 计算导轨刻度。
 *
 * 位置只按**提问的顺序等距排列**（第 i 条落在 `i/(n-1)`），不看消息高度：
 * - 按真实位置排会因消息长短不一而间隔忽疏忽密（短消息挤、长回复后空一截），看着散；
 * - 等距后整齐好点，也与展开目录的行距一致。
 *   代价是看不出「哪条之间内容多」，这是刻意的取舍。
 *
 * 不依赖 `scrollHeight` 也顺带避免了「往上滚时懒渲染内容撑高、刻度缩成一团」。
 *
 * @param anchors 按文档顺序排列的消息块。
 * @param viewport 滚动容器的当前几何（只用于判断是否可滚动与标记 inView）。
 * @returns 与 anchors 等长的刻度数组；内容不足一屏时返回空数组（导轨无需显示）。
 */
export function computeChatRailAnchors(
  anchors: ReadonlyArray<ChatRailAnchorInput>,
  viewport: ChatRailViewport,
): ChatRailAnchor[] {
  if (!anchors.length) return [];
  // 内容还没长过一屏：没有可滚动空间，导轨没有意义。
  if (!(viewport.scrollHeight > viewport.clientHeight + 1)) return [];

  const count = anchors.length;
  const viewTop = viewport.scrollTop;
  const viewBottom = viewport.scrollTop + viewport.clientHeight;

  return anchors.map((anchor, index) => {
    const height = Math.max(MIN_BLOCK_HEIGHT, anchor.height);
    const inView = anchor.top < viewBottom && anchor.top + height > viewTop;
    // 只有一条提问时居中显示，避免贴着上边缘。
    const fraction = count > 1 ? index / (count - 1) : 0.5;
    return {
      id: anchor.id,
      pos: contentFractionToBand(fraction),
      inView,
    };
  });
}

/**
 * 导轨比例滑块（替代原生滚动条的位置指示）。
 *
 * 与刻度不同，滑块必须反映**真实滚动比例**（`scrollTop / maxScroll`），
 * 这样用户才看得出「滚到哪、还剩多少」。返回归一化 top/size，可直接乘轨道高度。
 */
export type ChatRailThumb = {
  /** 滑块顶端位置（0~1）。 */
  top: number;
  /** 滑块高度占比（0~1，最小可见高度由调用方兜底）。 */
  size: number;
};

export function computeRailThumb(viewport: ChatRailViewport): ChatRailThumb | null {
  const { scrollTop, clientHeight, scrollHeight } = viewport;
  if (!(scrollHeight > clientHeight + 1)) return null;
  const maxScroll = scrollHeight - clientHeight;
  const size = clamp01(clientHeight / scrollHeight);
  const top = clamp01(scrollTop / maxScroll) * (1 - size);
  return { top, size };
}

/** 拖动滑块时：滑块在轨道上的归一化位置 → 目标 scrollTop（与 computeRailThumb 互逆）。 */
export function railThumbTopToScrollTop(
  thumbTop: number,
  viewport: Pick<ChatRailViewport, "clientHeight" | "scrollHeight">,
): number {
  const { clientHeight, scrollHeight } = viewport;
  if (!(scrollHeight > clientHeight + 1)) return 0;
  const maxScroll = scrollHeight - clientHeight;
  const size = clamp01(clientHeight / scrollHeight);
  const denom = 1 - size;
  if (denom <= 0) return 0;
  return clamp01(thumbTop / denom) * maxScroll;
}

/**
 * 当前视口里最靠中间的那条消息（用于点亮当前刻度 / 浮层当前项）。
 * 返回 null 表示没有消息落在视口内。
 */
export function pickActiveChatRailAnchor(
  anchors: ReadonlyArray<ChatRailAnchorInput>,
  viewport: ChatRailViewport,
): string | null {
  if (!anchors.length) return null;
  if (!(viewport.scrollHeight > viewport.clientHeight + 1)) return null;

  const viewCenter = viewport.scrollTop + viewport.clientHeight / 2;
  let bestId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) {
    const height = Math.max(MIN_BLOCK_HEIGHT, anchor.height);
    const center = anchor.top + height / 2;
    const distance = Math.abs(center - viewCenter);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = anchor.id;
    }
  }
  return bestId;
}
