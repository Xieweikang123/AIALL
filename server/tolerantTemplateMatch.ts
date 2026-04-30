/**
 * RGB tolerant template matching.
 *
 * This path is intentionally approximate: it finds candidates with a small set
 * of high-information probe pixels, then verifies them with full-template RGB
 * mean absolute difference. Alpha is used only to ignore transparent template
 * pixels.
 */

export interface TolerantMatchOptions {
  minScore: number;
  stride: number;
  probeCount: number;
  candidateCount: number;
}

export interface TolerantMatchResult {
  bestX: number;
  bestY: number;
  score: number;
}

type Probe = {
  x: number;
  y: number;
};

type Candidate = {
  x: number;
  y: number;
  probeScore: number;
};

function delayImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function pixelOffset(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

function templateAlphaAt(tpl: Uint8Array, tw: number, x: number, y: number): number {
  return tpl[pixelOffset(tw, x, y) + 3] ?? 255;
}

function edgeStrength(tpl: Uint8Array, tw: number, th: number, x: number, y: number): number {
  if (templateAlphaAt(tpl, tw, x, y) < 16) return -1;
  const i = pixelOffset(tw, x, y);
  const r = tpl[i]!;
  const g = tpl[i + 1]!;
  const b = tpl[i + 2]!;
  let score = 0;
  const dirs: Array<[number, number]> = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  for (const [dx, dy] of dirs) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= tw || ny >= th) continue;
    if (templateAlphaAt(tpl, tw, nx, ny) < 16) continue;
    const j = pixelOffset(tw, nx, ny);
    score += Math.abs(r - tpl[j]!) + Math.abs(g - tpl[j + 1]!) + Math.abs(b - tpl[j + 2]!);
  }

  return score;
}

function buildTolerantProbes(tpl: Uint8Array, tw: number, th: number, maxCount: number): Probe[] {
  const scored: Array<Probe & { edge: number }> = [];
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const edge = edgeStrength(tpl, tw, th, x, y);
      if (edge >= 0) scored.push({ x, y, edge });
    }
  }

  scored.sort((a, b) => b.edge - a.edge);
  const probes: Probe[] = [];
  const minDist = Math.max(2, Math.floor(Math.min(tw, th) / 7));

  for (const p of scored) {
    if (probes.length >= maxCount) break;
    let farEnough = true;
    for (const used of probes) {
      if (Math.max(Math.abs(p.x - used.x), Math.abs(p.y - used.y)) < minDist) {
        farEnough = false;
        break;
      }
    }
    if (farEnough) probes.push({ x: p.x, y: p.y });
  }

  for (const p of scored) {
    if (probes.length >= maxCount) break;
    if (!probes.some((used) => used.x === p.x && used.y === p.y)) probes.push({ x: p.x, y: p.y });
  }

  if (probes.length === 0) {
    probes.push({ x: Math.floor(tw / 2), y: Math.floor(th / 2) });
  }

  return probes;
}

function rgbProbeScoreAt(
  screen: Uint8Array,
  sw: number,
  tpl: Uint8Array,
  tw: number,
  px: number,
  py: number,
  probes: Probe[],
): number {
  let diff = 0;
  for (const p of probes) {
    const si = pixelOffset(sw, px + p.x, py + p.y);
    const ti = pixelOffset(tw, p.x, p.y);
    diff += Math.abs(screen[si]! - tpl[ti]!);
    diff += Math.abs(screen[si + 1]! - tpl[ti + 1]!);
    diff += Math.abs(screen[si + 2]! - tpl[ti + 2]!);
  }
  return 1 - diff / (probes.length * 3 * 255);
}

export function fullTemplateRgbSimilarity(
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

  let diff = 0;
  let count = 0;
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const ti = pixelOffset(tw, tx, ty);
      if ((tpl[ti + 3] ?? 255) < 16) continue;

      const si = pixelOffset(sw, px + tx, py + ty);
      diff += Math.abs(screen[si]! - tpl[ti]!);
      diff += Math.abs(screen[si + 1]! - tpl[ti + 1]!);
      diff += Math.abs(screen[si + 2]! - tpl[ti + 2]!);
      count++;
    }
  }

  return count > 0 ? 1 - diff / (count * 3 * 255) : 0;
}

function rememberCandidate(candidates: Candidate[], next: Candidate, maxCount: number) {
  if (candidates.some((c) => Math.abs(c.x - next.x) <= 1 && Math.abs(c.y - next.y) <= 1)) return;

  let insertAt = candidates.findIndex((c) => next.probeScore > c.probeScore);
  if (insertAt < 0) insertAt = candidates.length;
  if (insertAt >= maxCount) return;

  candidates.splice(insertAt, 0, next);
  if (candidates.length > maxCount) candidates.pop();
}

export async function matchRgbTolerant(
  screen: Uint8Array,
  sw: number,
  sh: number,
  tpl: Uint8Array,
  tw: number,
  th: number,
  opts: TolerantMatchOptions,
): Promise<TolerantMatchResult | { error: string }> {
  if (tw > sw || th > sh) return { error: "模板大于搜索区域" };

  const stride = Math.max(1, opts.stride);
  const probes = buildTolerantProbes(tpl, tw, th, opts.probeCount);
  const candidates: Candidate[] = [];

  for (let py = 0; py <= sh - th; py += stride) {
    await delayImmediate();
    for (let px = 0; px <= sw - tw; px += stride) {
      const probeScore = rgbProbeScoreAt(screen, sw, tpl, tw, px, py, probes);
      rememberCandidate(candidates, { x: px, y: py, probeScore }, opts.candidateCount);
    }
  }

  if (candidates.length === 0) return { error: "未找到可验证的候选区域" };

  let bestScore = -1;
  let bestX = 0;
  let bestY = 0;
  const seen = new Set<string>();
  const radius = Math.max(1, stride + 1);

  for (const c of candidates) {
    for (let y = Math.max(0, c.y - radius); y <= Math.min(sh - th, c.y + radius); y++) {
      for (let x = Math.max(0, c.x - radius); x <= Math.min(sw - tw, c.x + radius); x++) {
        const key = `${x},${y}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const score = fullTemplateRgbSimilarity(screen, sw, sh, tpl, tw, th, x, y);
        if (score > bestScore) {
          bestScore = score;
          bestX = x;
          bestY = y;
        }
      }
    }
  }

  if (bestScore < opts.minScore) {
    return {
      error: `未找到足够相似的区域（RGB 容错相似度 ${bestScore.toFixed(3)}，要求≥${opts.minScore}）`,
    };
  }

  return { bestX, bestY, score: bestScore };
}
