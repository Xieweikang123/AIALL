/**
 * 桌面截图与模板小图的灰度 NCC 匹配（用于自动化点击）
 * 核心系数与积分图加速来自 fastools 自研实现（OpenCV TM_CCOEFF_NORMED 对齐）。
 */
import sharp from "sharp";
import { buildSatSumAndSq, nccAtWithSat, prepareTemplate, rgbaToGrayOpenCV } from "./selfDevTemplateMatch";

export interface MatchHit {
  /** 模板左上角在原图中的像素坐标（近似整数） */
  topLeftX: number;
  topLeftY: number;
  clickX: number;
  clickY: number;
  /** 归一化互相关系数，约 -1～1 */
  score: number;
}

type GrayBundle = {
  grayS: Uint8Array;
  sat: Float64Array;
  sat2: Float64Array;
  Wp: number;
  tnorm: Float32Array;
  nTpl: number;
  sw: number;
  sh: number;
  tw: number;
  th: number;
  scale: number;
};

/** 将两张图缩放到匹配尺度，转 OpenCV 同款 BT.601 灰度并预建积分图与模板归一化 */
async function prepareGrays(
  screenPng: Buffer,
  templatePng: Buffer,
  maxScreenWidth: number,
): Promise<GrayBundle | { error: string }> {
  const metaS = await sharp(screenPng).metadata();
  const metaT = await sharp(templatePng).metadata();
  if (!metaS.width || !metaS.height || !metaT.width || !metaT.height) {
    return { error: "无法读取图片尺寸" };
  }

  const sw0 = metaS.width;
  const sh0 = metaS.height;
  const tw0 = metaT.width;
  const th0 = metaT.height;
  const scale = Math.min(1, maxScreenWidth / sw0);

  const sw = Math.max(1, Math.round(sw0 * scale));
  const sh = Math.max(1, Math.round(sh0 * scale));
  const tw = Math.max(1, Math.round(tw0 * scale));
  const th = Math.max(1, Math.round(th0 * scale));

  if (tw > sw || th > sh) {
    return { error: "模板图大于当前搜索区域，请在「图标模板」中换一张更小的局部截图" };
  }

  const { data: bufS, info: iS } = await sharp(screenPng)
    .resize(sw, sh)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data: bufT, info: iT } = await sharp(templatePng)
    .resize(tw, th)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (iS.width !== sw || iS.height !== sh || iT.width !== tw || iT.height !== th) {
    return { error: "内部缩放与缓冲区不一致" };
  }

  const grayS = rgbaToGrayOpenCV(new Uint8Array(bufS), sw, sh);
  const grayT = rgbaToGrayOpenCV(new Uint8Array(bufT), tw, th);
  const tplPrep = prepareTemplate(grayT, tw, th);
  if (tplPrep.degenerate) {
    return { error: "模板近似纯色，无法稳定匹配，请换一张更具纹理的截图" };
  }
  const { sat, sat2, Wp } = buildSatSumAndSq(grayS, sw, sh);
  const nTpl = tw * th;
  return {
    grayS,
    sat,
    sat2,
    Wp,
    tnorm: tplPrep.tnorm,
    nTpl,
    sw,
    sh,
    tw,
    th,
    scale,
  };
}

/** raw 差小于此值视为并列，此时用 verticalWeight 打破平局（略偏向屏中下方，减轻顶栏假阳性） */
const NCC_RAW_TIE_EPS = 1e-4;

/**
 * 全屏搜索时略降低「屏幕最上一带」的权重；仅在与最优 raw NCC 几乎并列时参与选点，不作为主排序。
 */
function fullScreenVerticalWeight(centerY: number, sh: number): number {
  if (sh < 1) return 1;
  const p = centerY / sh;
  if (p < 0.06) return 0.82;
  if (p < 0.12) return 0.92;
  if (p < 0.18) return 0.97;
  return 1;
}

function matchNccGrid(
  bundle: GrayBundle,
  stride: number,
  minScore: number,
): { best: number; bestX: number; bestY: number } | { error: string } {
  const { grayS, sat, sat2, Wp, tnorm, nTpl, sw, sh, tw, th } = bundle;

  let bestRaw = -2;
  let bestTieW = -1;
  let bestX = 0;
  let bestY = 0;
  let maxRawOverall = -2;

  for (let y = 0; y <= sh - th; y += stride) {
    for (let x = 0; x <= sw - tw; x += stride) {
      const ncc = nccAtWithSat(tnorm, grayS, sat, sat2, sw, tw, th, x, y, nTpl, Wp);
      if (ncc > -1 && ncc > maxRawOverall) maxRawOverall = ncc;
      if (ncc < -1) continue;
      const cy = y + th / 2;
      const w = fullScreenVerticalWeight(cy, sh);
      if (ncc > bestRaw + NCC_RAW_TIE_EPS) {
        bestRaw = ncc;
        bestTieW = w;
        bestX = x;
        bestY = y;
      } else if (Math.abs(ncc - bestRaw) <= NCC_RAW_TIE_EPS && w > bestTieW) {
        bestTieW = w;
        bestX = x;
        bestY = y;
      }
    }
  }

  if (bestRaw < minScore) {
    return {
      error: `未找到足够相似的区域（选中位置 raw NCC ${bestRaw.toFixed(3)}，全图最高 raw ${maxRawOverall.toFixed(3)}，阈值 ${minScore}）。请更新模板截图或裁剪更具辨识度的局部。`,
    };
  }
  return { best: bestRaw, bestX, bestY };
}

/** 在粗匹配最佳点附近做步长 1 精细搜索（主键：raw NCC 最大；并列时用垂直权重） */
function refineAround(
  bundle: GrayBundle,
  cx: number,
  cy: number,
  radius: number,
): { bestX: number; bestY: number; best: number } {
  const { grayS, sat, sat2, Wp, tnorm, nTpl, sw, sh, tw, th } = bundle;

  const centerNcc = nccAtWithSat(tnorm, grayS, sat, sat2, sw, tw, th, cx, cy, nTpl, Wp);
  let bestRaw = centerNcc > -1 ? centerNcc : -2;
  let bestTieW =
    centerNcc > -1 ? fullScreenVerticalWeight(cy + th / 2, sh) : -1;
  let bestX = cx;
  let bestY = cy;
  const x0 = Math.max(0, cx - radius);
  const x1 = Math.min(sw - tw, cx + radius);
  const y0 = Math.max(0, cy - radius);
  const y1 = Math.min(sh - th, cy + radius);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const ncc = nccAtWithSat(tnorm, grayS, sat, sat2, sw, tw, th, x, y, nTpl, Wp);
      if (ncc < -1) continue;
      const cy0 = y + th / 2;
      const w = fullScreenVerticalWeight(cy0, sh);
      if (ncc > bestRaw + NCC_RAW_TIE_EPS) {
        bestRaw = ncc;
        bestTieW = w;
        bestX = x;
        bestY = y;
      } else if (Math.abs(ncc - bestRaw) <= NCC_RAW_TIE_EPS && w > bestTieW) {
        bestTieW = w;
        bestX = x;
        bestY = y;
      }
    }
  }
  return { bestX, bestY, best: bestRaw };
}

function hitFromBest(
  bundle: GrayBundle,
  bestX: number,
  bestY: number,
  bestScore: number,
  offsetX: number,
  offsetY: number,
): MatchHit {
  const { tw, th, scale } = bundle;
  const cx = bestX + tw / 2;
  const cy = bestY + th / 2;
  const clickX = Math.round(cx / scale + offsetX);
  const clickY = Math.round(cy / scale + offsetY);
  return {
    topLeftX: Math.round(bestX / scale + offsetX),
    topLeftY: Math.round(bestY / scale + offsetY),
    clickX,
    clickY,
    score: bestScore,
  };
}

/**
 * 整屏截图与模板做灰度 NCC（fastools 自研：BT.601 + 积分图）。
 * 选点以 raw NCC 最大为主；与最优值几乎并列时略偏向屏中下方，映射回原分辨率坐标。
 */
export async function findTemplateNcc(
  screenPng: Buffer,
  templatePng: Buffer,
  options?: {
    maxScreenWidth?: number;
    stride?: number;
    minScore?: number;
  },
): Promise<MatchHit | { error: string }> {
  const maxScreenWidth = options?.maxScreenWidth ?? 960;
  const strideCoarse = options?.stride ?? 2;
  const minScore = options?.minScore ?? 0.72;

  const prep = await prepareGrays(screenPng, templatePng, maxScreenWidth);
  if ("error" in prep) return prep;

  const coarse = matchNccGrid(prep, strideCoarse, minScore);
  if ("error" in coarse) return coarse;

  const refined = refineAround(prep, coarse.bestX, coarse.bestY, Math.max(8, strideCoarse * 4));

  return hitFromBest(prep, refined.bestX, refined.bestY, refined.best, 0, 0);
}
