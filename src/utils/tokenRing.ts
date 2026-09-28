/**
 * 上下文用量圆环的几何计算。
 *
 * 纯函数：把「已用 / 上限」换算成 SVG `stroke-dashoffset`，便于单测，
 * 也避免把魔法数散落在模板里。
 */

/** SVG 圆环描边宽度（viewBox 单位）。 */
export const TOKEN_RING_STROKE = 3;
/** viewBox 边长；半径 = size/2 - stroke/2 - 留白，由调用方给 r。 */
export const TOKEN_RING_VIEWBOX = 36;

/** 圆周长，用于 dasharray。 */
export function ringCircumference(radius: number): number {
  return 2 * Math.PI * radius;
}

/**
 * 把占用比例（0~1）换算为 `stroke-dashoffset`。
 * 比例为 0 时偏移 = 周长（整圈都不可见）；比例为 1 时偏移 = 0（整圈可见）。
 * 比例越界会被夹到 [0, 1]。
 */
export function contextRingDashOffset(ratio: number, radius: number): number {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
  return ringCircumference(radius) * (1 - clamped);
}
