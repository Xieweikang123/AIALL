/**
 * 自研模板匹配：RGBA 逐字节「智能探针 + 蓄水池 + 整图一致比例」路径。
 * 截屏与模板均为 RGBA 内存序（与 sharp raw 一致）；逐像素四通道全等。
 */

export interface ProbeMatchOptions {
  /** 蓄水池容量，默认由环境变量 SELFDEV_FULL_VERIFY_TOPN 决定（50，上限 200） */
  reservoirSize: number;
  /** legacy 两轮固定探针（左上+中心 / 右上+左下） */
  legacyTwoRoundProbe: boolean;
  minScore: number;
}

export interface ProbeMatchResult {
  bestX: number;
  bestY: number;
  score: number;
}

function delayImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** 四邻 RGB 差分和；Alpha=0 不参与特征分 */
function edgeStrength(tpl: Uint8Array, tw: number, th: number, x: number, y: number): number {
  const i = (y * tw + x) * 4;
  if (tpl[i + 3] === 0) return -1;
  const r = tpl[i];
  const g = tpl[i + 1];
  const b = tpl[i + 2];
  let s = 0;
  const dirs: [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  for (const [dx, dy] of dirs) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= tw || ny < 0 || ny >= th) continue;
    const j = (ny * tw + nx) * 4;
    s += Math.abs(r - tpl[j]) + Math.abs(g - tpl[j + 1]) + Math.abs(b - tpl[j + 2]);
  }
  return s;
}

function uniqProbes(ox: number[], oy: number[]): { ox: number[]; oy: number[] } {
  const seen = new Set<string>();
  const rx: number[] = [];
  const ry: number[] = [];
  for (let i = 0; i < ox.length; i++) {
    const k = `${ox[i]},${oy[i]}`;
    if (seen.has(k)) continue;
    seen.add(k);
    rx.push(ox[i]);
    ry.push(oy[i]);
  }
  return { ox: rx, oy: ry };
}

/**
 * 至多 16 点：必含 (0,0)；探针 1 为除左上外边缘强度最大点；其余按强度贪心并控制 Chebyshev 间距（先≥2 再≥1）。
 */
export function buildSmartProbes(tw: number, th: number, tpl: Uint8Array): { ox: number[]; oy: number[] } {
  const maxPoints = 16;
  const edges: { x: number; y: number; e: number }[] = [];
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const e = edgeStrength(tpl, tw, th, x, y);
      if (e < 0) continue;
      edges.push({ x, y, e });
    }
  }
  edges.sort((a, b) => b.e - a.e);

  type P = { x: number; y: number };
  const used: P[] = [{ x: 0, y: 0 }];

  let p1: P = { x: 0, y: 0 };
  for (const c of edges) {
    if (c.x !== 0 || c.y !== 0) {
      p1 = { x: c.x, y: c.y };
      break;
    }
  }
  used.push(p1);

  const cheby = (a: P, b: P) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const minChebyToSet = (p: P) => {
    let m = Infinity;
    for (const u of used) m = Math.min(m, cheby(p, u));
    return m;
  };

  const ox: number[] = [0, p1.x];
  const oy: number[] = [0, p1.y];

  const tryAdd = (minDist: number): boolean => {
    for (const c of edges) {
      if (ox.length >= maxPoints) return false;
      const p: P = { x: c.x, y: c.y };
      if (used.some((u) => u.x === p.x && u.y === p.y)) continue;
      if (minChebyToSet(p) >= minDist) {
        used.push(p);
        ox.push(p.x);
        oy.push(p.y);
        return true;
      }
    }
    return false;
  };

  while (ox.length < maxPoints) {
    let moved = false;
    while (ox.length < maxPoints && tryAdd(2)) moved = true;
    if (ox.length >= maxPoints) break;
    while (ox.length < maxPoints && tryAdd(1)) moved = true;
    if (ox.length >= maxPoints) break;
    if (!moved) {
      for (const c of edges) {
        if (ox.length >= maxPoints) break;
        const p: P = { x: c.x, y: c.y };
        if (used.some((u) => u.x === p.x && u.y === p.y)) continue;
        used.push(p);
        ox.push(p.x);
        oy.push(p.y);
      }
      break;
    }
  }

  return uniqProbes(ox, oy);
}

/** 第一轮：左上 + 几何中心；第二轮：右上 + 左下（略去与首轮重复坐标） */
export function buildLegacyProbeRounds(
  tw: number,
  th: number,
): { round1: { ox: number[]; oy: number[] }; round2: { ox: number[]; oy: number[] } } {
  const cx = Math.floor((tw - 1) / 2);
  const cy = Math.floor((th - 1) / 2);
  type Pt = { x: number; y: number };
  const r1: Pt[] = [
    { x: 0, y: 0 },
    { x: cx, y: cy },
  ];
  const r2: Pt[] = [];
  if (tw > 1) r2.push({ x: tw - 1, y: 0 });
  if (th > 1) r2.push({ x: 0, y: th - 1 });

  function dedup(src: Pt[]): { ox: number[]; oy: number[] } {
    const seen = new Set<string>();
    const ox: number[] = [];
    const oy: number[] = [];
    for (const p of src) {
      const k = `${p.x},${p.y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      ox.push(p.x);
      oy.push(p.y);
    }
    return { ox, oy };
  }

  const round1 = dedup(r1);
  let round2 = dedup(r2);
  const s1 = new Set(round1.ox.map((x, i) => `${x},${round1.oy[i]}`));
  const ox2: number[] = [];
  const oy2: number[] = [];
  for (let i = 0; i < round2.ox.length; i++) {
    const k = `${round2.ox[i]},${round2.oy[i]}`;
    if (!s1.has(k)) {
      ox2.push(round2.ox[i]);
      oy2.push(round2.oy[i]);
    }
  }
  round2 = { ox: ox2, oy: oy2 };
  return { round1, round2 };
}

function rgbaEqualAt(
  screen: Uint8Array,
  sw: number,
  sh: number,
  tpl: Uint8Array,
  tw: number,
  th: number,
  px: number,
  py: number,
  tx: number,
  ty: number,
): boolean {
  if (tx < 0 || ty < 0 || tx >= tw || ty >= th) return false;
  const sx = px + tx;
  const sy = py + ty;
  if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) return false;
  const si = (sy * sw + sx) * 4;
  const ti = (ty * tw + tx) * 4;
  const s = screen;
  const t = tpl;
  return (
    s[si] === t[ti] &&
    s[si + 1] === t[ti + 1] &&
    s[si + 2] === t[ti + 2] &&
    s[si + 3] === t[ti + 3]
  );
}

/** 整模板 RGBA 四通道全等的像素占比 ∈ [0,1] */
export function fullTemplateRgbaPixelMatchFraction(
  screen: Uint8Array,
  sw: number,
  sh: number,
  tpl: Uint8Array,
  tw: number,
  th: number,
  px: number,
  py: number,
): number {
  if (px < 0 || py < 0 || px + tw > sw || py + th > sh) return 0;
  let ok = 0;
  const n = tw * th;
  for (let ty = 0; ty < th; ty++) {
    const rowS = (py + ty) * sw * 4;
    const rowT = ty * tw * 4;
    for (let tx = 0; tx < tw; tx++) {
      const si = rowS + tx * 4;
      const ti = rowT + tx * 4;
      if (
        screen[si] === tpl[ti] &&
        screen[si + 1] === tpl[ti + 1] &&
        screen[si + 2] === tpl[ti + 2] &&
        screen[si + 3] === tpl[ti + 3]
      ) {
        ok++;
      }
    }
  }
  return n > 0 ? ok / n : 0;
}

/**
 * 置信度：须同时满足 score≥threshold 与 score≥min(0.95, threshold)（高阈值时仍有 0.95 底线含义由二者共同约束）。
 */
export function passesDualConfidence(score: number, threshold: number): boolean {
  return score >= threshold && score >= Math.min(0.95, threshold);
}

export async function matchRgbaProbeReservoir(
  screen: Uint8Array,
  sw: number,
  sh: number,
  tpl: Uint8Array,
  tw: number,
  th: number,
  opts: ProbeMatchOptions,
): Promise<ProbeMatchResult | { error: string }> {
  const { reservoirSize, legacyTwoRoundProbe, minScore } = opts;
  if (tw > sw || th > sh) return { error: "模板大于搜索区域" };

  let ox: number[] = [];
  let oy: number[] = [];
  let round1ox: number[] | null = null;
  let round1oy: number[] | null = null;
  let round2ox: number[] | null = null;
  let round2oy: number[] | null = null;
  let fastCount = 0;

  if (legacyTwoRoundProbe) {
    const { round1, round2 } = buildLegacyProbeRounds(tw, th);
    round1ox = round1.ox;
    round1oy = round1.oy;
    round2ox = round2.ox;
    round2oy = round2.oy;
  } else {
    const p = buildSmartProbes(tw, th, tpl);
    ox = p.ox;
    oy = p.oy;
    fastCount = Math.min(2, ox.length);
  }

  if (!legacyTwoRoundProbe && ox.length === 0) return { error: "模板无有效探针点" };

  const verifyStart = fastCount;
  const reservoir: { px: number; py: number }[] = [];
  let acceptCount = 0;

  for (let py = 0; py <= sh - th; py++) {
    await delayImmediate();
    for (let px = 0; px <= sw - tw; px++) {
      let pass = true;

      if (legacyTwoRoundProbe && round1ox && round1oy) {
        for (let k = 0; k < round1ox.length; k++) {
          if (!rgbaEqualAt(screen, sw, sh, tpl, tw, th, px, py, round1ox[k]!, round1oy[k]!)) {
            pass = false;
            break;
          }
        }
        if (!pass) continue;
        if (round2ox && round2oy && round2ox.length > 0) {
          for (let k = 0; k < round2ox.length; k++) {
            if (!rgbaEqualAt(screen, sw, sh, tpl, tw, th, px, py, round2ox[k]!, round2oy[k]!)) {
              pass = false;
              break;
            }
          }
        }
      } else {
        for (let k = 0; k < fastCount; k++) {
          if (!rgbaEqualAt(screen, sw, sh, tpl, tw, th, px, py, ox[k]!, oy[k]!)) {
            pass = false;
            break;
          }
        }
        if (!pass) continue;
        for (let k = verifyStart; k < ox.length; k++) {
          if (!rgbaEqualAt(screen, sw, sh, tpl, tw, th, px, py, ox[k]!, oy[k]!)) {
            pass = false;
            break;
          }
        }
      }

      if (pass) {
        acceptCount++;
        if (reservoir.length < reservoirSize) {
          reservoir.push({ px, py });
        } else {
          const j = Math.floor(Math.random() * acceptCount);
          if (j < reservoirSize) reservoir[j] = { px, py };
        }
      }
    }
  }

  if (reservoir.length === 0) {
    return { error: `未找到与探针一致的窗口（阈值相关校验尚未执行；请降低相似度要求或更新模板）` };
  }

  let bestScore = -1;
  let bestX = 0;
  let bestY = 0;
  for (const c of reservoir) {
    const frac = fullTemplateRgbaPixelMatchFraction(screen, sw, sh, tpl, tw, th, c.px, c.py);
    if (frac > bestScore) {
      bestScore = frac;
      bestX = c.px;
      bestY = c.py;
    }
  }

  if (!passesDualConfidence(bestScore, minScore)) {
    return {
      error: `未找到足够相似的区域（整图一致比例 ${bestScore.toFixed(3)}，要求≥${minScore} 且满足置信规则）。请更新模板或略降低阈值。`,
    };
  }

  return { bestX, bestY, score: bestScore };
}
