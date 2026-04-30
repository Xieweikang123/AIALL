/**
 * 自研模板匹配核心（源自 fastools `src/selfDevTemplateMatch.js` 的 NCC 路径）：
 * - 灰度：OpenCV 同款 8bit 定点 BT.601（与 CV RGBA2GRAY 一致）
 * - 模板：零均值并单位化（TM_CCOEFF_NORMED 的模板侧）
 * - 截屏灰度建平方积分图：窗口 sum / sumSq 为 O(1)，点积仍为每位置 O(tw×th)
 */

const SHIFT = 14;
const ROUND = 1 << (SHIFT - 1);

/** RGBA → 灰度，与 cv.cvtColor(..., COLOR_RGBA2GRAY) 的 8UC1 一致 */
export function rgbaToGrayOpenCV(buf: Uint8Array, w: number, h: number): Uint8Array {
  const g = new Uint8Array(w * h);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      const r = buf[i];
      const gv = buf[i + 1];
      const b = buf[i + 2];
      const yv = (b * 1868 + gv * 9617 + r * 4899 + ROUND) >> SHIFT;
      g[y * w + x] = yv < 0 ? 0 : yv > 255 ? 255 : yv;
    }
  }
  return g;
}

export function prepareTemplate(tpl: Uint8Array, tw: number, th: number): { tnorm: Float32Array; degenerate: boolean } {
  const n = tw * th;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += tpl[i];
  mean /= n;
  let sumSq = 0;
  const tnorm = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = tpl[i] - mean;
    tnorm[i] = d;
    sumSq += d * d;
  }
  if (sumSq <= 1e-9) {
    return { tnorm, degenerate: true };
  }
  const inv = 1 / Math.sqrt(sumSq);
  for (let i = 0; i < n; i++) tnorm[i] *= inv;
  return { tnorm, degenerate: false };
}

/**
 * 灰度平方积分图：I[y][x] = Σ gray[0..y-1][0..x-1]，尺寸 (sh+1)×(sw+1)
 */
export function buildSatSumAndSq(
  gray: Uint8Array,
  sw: number,
  sh: number,
): { sat: Float64Array; sat2: Float64Array; Wp: number } {
  const Wp = sw + 1;
  const Hp = sh + 1;
  const nn = Wp * Hp;
  const sat = new Float64Array(nn);
  const sat2 = new Float64Array(nn);
  for (let y = 1; y < Hp; y++) {
    const gy = (y - 1) * sw;
    const row = y * Wp;
    const rowUp = (y - 1) * Wp;
    for (let x = 1; x < Wp; x++) {
      const v = gray[gy + (x - 1)];
      const v2 = v * v;
      const idx = row + x;
      const a = rowUp + x;
      const b = row + (x - 1);
      const c = rowUp + (x - 1);
      sat[idx] = v + sat[a] + sat[b] - sat[c];
      sat2[idx] = v2 + sat2[a] + sat2[b] - sat2[c];
    }
  }
  return { sat, sat2, Wp };
}

/**
 * 单位置 TM_CCOEFF_NORMED（截屏块与预归一化模板的归一化相关）
 */
export function nccAtWithSat(
  tnorm: Float32Array,
  gray: Uint8Array,
  sat: Float64Array,
  sat2: Float64Array,
  sw: number,
  tw: number,
  th: number,
  px: number,
  py: number,
  n: number,
  Wp: number,
): number {
  const y0 = py;
  const x0 = px;
  const y1 = py + th;
  const x1 = px + tw;
  const i11 = y1 * Wp + x1;
  const i01 = y0 * Wp + x1;
  const i10 = y1 * Wp + x0;
  const i00 = y0 * Wp + x0;
  const sum = sat[i11] - sat[i01] - sat[i10] + sat[i00];
  const sumSq = sat2[i11] - sat2[i01] - sat2[i10] + sat2[i00];

  let dot = 0;
  for (let j = 0; j < th; j++) {
    const base = (py + j) * sw + px;
    for (let i = 0; i < tw; i++) {
      dot += gray[base + i] * tnorm[j * tw + i];
    }
  }
  const denI = sumSq - (sum * sum) / n;
  if (denI <= 1e-9) {
    return -2;
  }
  return dot / Math.sqrt(denI);
}
