/**
 * 桌面截图与模板小图匹配（用于自动化点击）
 * 优先使用 RGBA 精确探针；未命中时回退到 RGB 容错候选匹配。
 */
import sharp from "sharp";
import { matchRgbaProbeReservoir } from "./selfDevProbeMatch";
import { matchRgbTolerant } from "./tolerantTemplateMatch";

/** 本次命中采用的匹配管线（便于调试与 UI 展示） */
export type MatchAlgorithm =
  | "rgba_smart_probe_reservoir"
  | "rgba_legacy_probe_reservoir"
  | "rgb_tolerant_sparse_sad"
  | "rgb_tolerant_multiscale_sad";

export interface MatchHit {
  /** 模板左上角在原图中的像素坐标（近似整数） */
  topLeftX: number;
  topLeftY: number;
  clickX: number;
  clickY: number;
  /** 整模板 RGBA 逐像素全等的占比 [0,1]（经置信阈值判定） */
  score: number;
  matchAlgorithm: MatchAlgorithm;
}

export interface FindTemplateMatchOptions {
  minScore?: number;
  tolerantMinScore?: number;
  /** 对应 SELFDEV_LEGACY_TWO_ROUND_PROBE：两轮固定探针 */
  legacyTwoRoundProbe?: boolean;
  /** 蓄水池大小，默认 50，上限 200 */
  fullVerifyTopN?: number;
}

function parseEnvBool(name: string, def: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  return raw === "1" || raw.toLowerCase() === "true";
}

function parseEnvInt(name: string, def: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function parseEnvFloat(name: string, def: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  const n = Number.parseFloat(raw);
  if (Number.isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function parseEnvScales(name: string, def: number[]): number[] {
  const raw = process.env[name];
  if (!raw) return def;

  const scales = raw
    .split(",")
    .map((x) => Number.parseFloat(x.trim()))
    .filter((x) => Number.isFinite(x) && x >= 0.5 && x <= 2);

  const seen = new Set<string>();
  const out: number[] = [];
  for (const scale of scales.length > 0 ? scales : def) {
    const key = scale.toFixed(3);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(scale);
  }
  return out;
}

type RgbaBundle = {
  screen: Uint8Array;
  tpl: Uint8Array;
  sw: number;
  sh: number;
  tw: number;
  th: number;
  scale: number;
};

/** 截屏与模板均保持原始分辨率解码为 RGBA raw（不做缩小缩放，避免插值改变像素） */
async function prepareRgba(screenPng: Buffer, templatePng: Buffer): Promise<RgbaBundle | { error: string }> {
  const { data: bufS, info: iS } = await sharp(screenPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data: bufT, info: iT } = await sharp(templatePng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const sw = iS.width;
  const sh = iS.height;
  const tw = iT.width;
  const th = iT.height;

  if (!sw || !sh || !tw || !th) {
    return { error: "无法读取图片尺寸" };
  }

  if (tw > sw || th > sh) {
    return { error: "模板图大于当前搜索区域，请在「图标模板」中换一张更小的局部截图" };
  }

  return {
    screen: new Uint8Array(bufS),
    tpl: new Uint8Array(bufT),
    sw,
    sh,
    tw,
    th,
    scale: 1,
  };
}

function hitFromRgba(
  bundle: RgbaBundle,
  bestX: number,
  bestY: number,
  bestScore: number,
  offsetX: number,
  offsetY: number,
  matchAlgorithm: MatchAlgorithm,
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
    matchAlgorithm,
  };
}

/**
 * 匹配入口：
 * 1. RGBA 探针 + 蓄水池 + 整图一致比例，适合模板来自同一次屏幕像素来源时快速命中。
 * 2. RGB 容错候选 + 完整 SAD 验证，并尝试少量模板缩放，适合抗锯齿/截图压缩/DPI 轻微差异。
 * - SELFDEV_LEGACY_TWO_ROUND_PROBE=1：两轮固定探针
 * - SELFDEV_FULL_VERIFY_TOPN：蓄水池大小（默认 50，最大 200）
 * - TEMPLATE_MATCH_TOLERANT_MIN_SCORE：容错路径阈值（默认 0.88）
 * - TEMPLATE_MATCH_SCALES：容错路径模板缩放列表（默认 1,0.9,1.1,0.8,1.25）
 */
export async function findTemplateMatch(
  screenPng: Buffer,
  templatePng: Buffer,
  options?: FindTemplateMatchOptions,
): Promise<MatchHit | { error: string }> {
  const minScore = options?.minScore ?? 0.72;

  const prep = await prepareRgba(screenPng, templatePng);
  if ("error" in prep) return prep;

  const reservoirSize = Math.min(
    200,
    Math.max(1, options?.fullVerifyTopN ?? parseEnvInt("SELFDEV_FULL_VERIFY_TOPN", 50, 1, 200)),
  );
  const legacy = options?.legacyTwoRoundProbe ?? parseEnvBool("SELFDEV_LEGACY_TWO_ROUND_PROBE", false);

  const r = await matchRgbaProbeReservoir(
    prep.screen,
    prep.sw,
    prep.sh,
    prep.tpl,
    prep.tw,
    prep.th,
    {
      reservoirSize,
      legacyTwoRoundProbe: legacy,
      minScore,
    },
  );
  const probeAlgo: MatchAlgorithm = legacy ? "rgba_legacy_probe_reservoir" : "rgba_smart_probe_reservoir";
  if (!("error" in r)) return hitFromRgba(prep, r.bestX, r.bestY, r.score, 0, 0, probeAlgo);

  const exactError = r.error;
  const tolerantMinScore =
    options?.tolerantMinScore ?? parseEnvFloat("TEMPLATE_MATCH_TOLERANT_MIN_SCORE", 0.88, 0.5, 0.99);
  const stride = parseEnvInt("TEMPLATE_MATCH_TOLERANT_STRIDE", 2, 1, 6);
  const probeCount = parseEnvInt("TEMPLATE_MATCH_TOLERANT_PROBES", 24, 6, 64);
  const candidateCount = parseEnvInt("TEMPLATE_MATCH_TOLERANT_CANDIDATES", 90, 10, 300);
  const earlyAcceptScore = parseEnvFloat("TEMPLATE_MATCH_TOLERANT_EARLY_ACCEPT", 0.965, 0.9, 1);
  const scales = parseEnvScales("TEMPLATE_MATCH_SCALES", [1, 0.9, 1.1, 0.8, 1.25]);

  let best:
    | {
        score: number;
        x: number;
        y: number;
        tw: number;
        th: number;
        scale: number;
        tpl: Uint8Array;
      }
    | null = null;
  const tolerantErrors: string[] = [];

  for (const tplScale of scales) {
    const tw = Math.max(1, Math.round(prep.tw * tplScale));
    const th = Math.max(1, Math.round(prep.th * tplScale));
    if (tw > prep.sw || th > prep.sh) continue;

    let tpl = prep.tpl;
    if (tw !== prep.tw || th !== prep.th) {
      const { data } = await sharp(templatePng)
        .resize(tw, th, { fit: "fill", kernel: "lanczos3" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      tpl = new Uint8Array(data);
    }

    const tolerant = await matchRgbTolerant(prep.screen, prep.sw, prep.sh, tpl, tw, th, {
      minScore: tolerantMinScore,
      stride,
      probeCount,
      candidateCount,
    });

    if ("error" in tolerant) {
      tolerantErrors.push(`${tplScale.toFixed(2)}x: ${tolerant.error}`);
      continue;
    }

    if (!best || tolerant.score > best.score) {
      best = {
        score: tolerant.score,
        x: tolerant.bestX,
        y: tolerant.bestY,
        tw,
        th,
        scale: tplScale,
        tpl,
      };
    }

    if (tplScale === 1 && tolerant.score >= earlyAcceptScore) {
      break;
    }
  }

  if (!best) {
    const extra = tolerantErrors.length > 0 ? `；容错路径：${tolerantErrors.join("；")}` : "";
    return { error: `${exactError}${extra}` };
  }

  return hitFromRgba(
    { ...prep, tpl: best.tpl, tw: best.tw, th: best.th },
    best.x,
    best.y,
    best.score,
    0,
    0,
    best.scale === 1 ? "rgb_tolerant_sparse_sad" : "rgb_tolerant_multiscale_sad",
  );
}
