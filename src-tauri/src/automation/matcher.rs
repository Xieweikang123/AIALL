use rand::Rng;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchHit {
    pub top_left_x: i32,
    pub top_left_y: i32,
    pub click_x: i32,
    pub click_y: i32,
    pub score: f64,
    pub match_algorithm: String,
}

pub struct MatchOptions {
    pub min_score: f64,
    pub tolerant_min_score: f64,
    pub legacy_two_round_probe: bool,
    pub reservoir_size: usize,
}

impl Default for MatchOptions {
    fn default() -> Self {
        Self {
            min_score: 0.72,
            tolerant_min_score: 0.88,
            legacy_two_round_probe: false,
            reservoir_size: 50,
        }
    }
}

pub async fn find_template_match(
    screen_png: &[u8],
    template_png: &[u8],
    options: &MatchOptions,
) -> Result<MatchHit, String> {
    let screen = screen_png.to_vec();
    let template = template_png.to_vec();
    let opts = MatchOptions { ..*options };
    tokio::task::spawn_blocking(move || find_template_match_sync(&screen, &template, &opts))
        .await
        .map_err(|e| format!("模板匹配任务失败: {e}"))?
}

fn find_template_match_sync(
    screen_png: &[u8],
    template_png: &[u8],
    options: &MatchOptions,
) -> Result<MatchHit, String> {
    let screen_img =
        image::load_from_memory(screen_png).map_err(|e| format!("解码截屏 PNG 失败: {e}"))?;
    let template_img =
        image::load_from_memory(template_png).map_err(|e| format!("解码模板 PNG 失败: {e}"))?;

    let screen = screen_img.to_rgba8();
    let tpl = template_img.to_rgba8();
    let sw = screen.width() as usize;
    let sh = screen.height() as usize;
    let tw = tpl.width() as usize;
    let th = tpl.height() as usize;

    // Convert DynamicImage to RgbaImage for resize later
    let tpl_rgba = tpl.clone();

    if tw > sw || th > sh {
        return Err("模板图大于搜索区域，请换一张更小的局部截图".into());
    }

    let sb = screen.as_raw();
    let tb = tpl.as_raw();

    // Stage 1: RGBA exact
    let probe_result = match_rgba(sb, sw, sh, tb, tw, th, options);
    if let Ok(hit) = probe_result {
        return Ok(hit);
    }
    let exact_err = probe_result.unwrap_err();

    // Stage 2: RGB tolerant multi-scale
    match match_rgb_multiscale(sb, sw, sh, tb, tw, th, &tpl_rgba, options) {
        Ok(hit) => Ok(hit),
        Err(e) => Err(format!("{exact_err}；{e}")),
    }
}

type RgbaRow = [u8];

fn rgba_px(data: &[u8], stride: usize, x: usize, y: usize) -> &[u8] {
    let i = (y * stride + x) * 4;
    &data[i..i + 4]
}

fn edge_strength(tpl: &[u8], tw: usize, th: usize, x: usize, y: usize, min_alpha: u8) -> f64 {
    let i = (y * tw + x) * 4;
    if tpl[i + 3] < min_alpha {
        return -1.0;
    }
    let r = tpl[i] as f64;
    let g = tpl[i + 1] as f64;
    let b = tpl[i + 2] as f64;
    let mut s = 0.0f64;
    for &(dx, dy) in &[(-1i32, 0), (1, 0), (0, -1), (0, 1)] {
        let nx = x as i32 + dx;
        let ny = y as i32 + dy;
        if nx < 0 || nx >= tw as i32 || ny < 0 || ny >= th as i32 {
            continue;
        }
        let j = (ny as usize * tw + nx as usize) * 4;
        if tpl[j + 3] < min_alpha {
            continue;
        }
        s += (r - tpl[j] as f64).abs()
            + (g - tpl[j + 1] as f64).abs()
            + (b - tpl[j + 2] as f64).abs();
    }
    s
}

fn build_smart_probes(tpl: &[u8], tw: usize, th: usize) -> (Vec<usize>, Vec<usize>) {
    let max_pts = 16usize;
    let mut scored: Vec<(usize, usize, f64)> = Vec::new();
    for y in 0..th {
        for x in 0..tw {
            let e = edge_strength(tpl, tw, th, x, y, 1);
            if e >= 0.0 {
                scored.push((x, y, e));
            }
        }
    }
    scored.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));

    if scored.is_empty() {
        return (vec![0], vec![0]);
    }

    let mut ox = vec![0usize];
    let mut oy = vec![0usize];
    let mut used: Vec<(usize, usize)> = vec![(0, 0)];

    // second point: highest edge excluding (0,0)
    for &(x, y, _) in &scored {
        if x != 0 || y != 0 {
            ox.push(x);
            oy.push(y);
            used.push((x, y));
            break;
        }
    }

    let cheby = |a: (usize, usize), b: (usize, usize)| -> usize {
        let dx = if a.0 > b.0 { a.0 - b.0 } else { b.0 - a.0 };
        let dy = if a.1 > b.1 { a.1 - b.1 } else { b.1 - a.1 };
        dx.max(dy)
    };

    for &(x, y, _) in &scored {
        if ox.len() >= max_pts {
            break;
        }
        if used.contains(&(x, y)) {
            continue;
        }
        if used.iter().any(|&u| cheby((x, y), u) < 2) {
            continue;
        }
        used.push((x, y));
        ox.push(x);
        oy.push(y);
    }

    for &(x, y, _) in &scored {
        if ox.len() >= max_pts {
            break;
        }
        if used.contains(&(x, y)) {
            continue;
        }
        used.push((x, y));
        ox.push(x);
        oy.push(y);
    }

    (ox, oy)
}

fn rgba_exact_at(
    screen: &[u8],
    sw: usize,
    tpl: &[u8],
    tw: usize,
    px: usize,
    py: usize,
    tx: usize,
    ty: usize,
) -> bool {
    let si = ((py + ty) * sw + (px + tx)) * 4;
    let ti = (ty * tw + tx) * 4;
    screen[si..si + 4] == tpl[ti..ti + 4]
}

fn full_rgba_score(
    screen: &[u8],
    sw: usize,
    sh: usize,
    tpl: &[u8],
    tw: usize,
    th: usize,
    px: usize,
    py: usize,
) -> f64 {
    if px + tw > sw || py + th > sh {
        return 0.0;
    }
    let n = tw * th;
    if n == 0 {
        return 0.0;
    }
    let ok: usize = (0..th)
        .flat_map(|ty| {
            (0..tw).filter_map(move |tx| {
                if rgba_exact_at(screen, sw, tpl, tw, px, py, tx, ty) {
                    Some(1)
                } else {
                    None
                }
            })
        })
        .count();
    ok as f64 / n as f64
}

fn match_rgba(
    screen: &[u8],
    sw: usize,
    sh: usize,
    tpl: &[u8],
    tw: usize,
    th: usize,
    opts: &MatchOptions,
) -> Result<MatchHit, String> {
    let (ox, oy) = build_smart_probes(tpl, tw, th);
    if ox.is_empty() {
        return Err("模板无有效探针点".into());
    }

    let fast_n = ox.len().min(2);
    let mut reservoir: Vec<(usize, usize)> = Vec::new();
    let mut accept = 0usize;
    let mut rng = rand::thread_rng();

    for py in 0..=(sh - th) {
        for px in 0..=(sw - tw) {
            let pass =
                (0..ox.len()).all(|k| rgba_exact_at(screen, sw, tpl, tw, px, py, ox[k], oy[k]));
            if !pass {
                continue;
            }
            accept += 1;
            if reservoir.len() < opts.reservoir_size {
                reservoir.push((px, py));
            } else {
                let j = rng.gen_range(0..accept);
                if j < opts.reservoir_size {
                    reservoir[j] = (px, py);
                }
            }
        }
    }

    if reservoir.is_empty() {
        return Err("未找到与探针一致的窗口".into());
    }

    let (best_x, best_y, best_score) =
        reservoir
            .iter()
            .fold((0, 0, -1.0f64), |(bx, by, bs), &(px, py)| {
                let s = full_rgba_score(screen, sw, sh, tpl, tw, th, px, py);
                if s > bs {
                    (px, py, s)
                } else {
                    (bx, by, bs)
                }
            });

    if best_score < opts.min_score || best_score < opts.min_score.min(0.95) {
        return Err(format!(
            "未找到足够相似的区域（RGBA {:.3}，要求≥{}）",
            best_score, opts.min_score
        ));
    }

    Ok(MatchHit {
        top_left_x: best_x as i32,
        top_left_y: best_y as i32,
        click_x: (best_x as f64 + tw as f64 / 2.0) as i32,
        click_y: (best_y as f64 + th as f64 / 2.0) as i32,
        score: best_score,
        match_algorithm: "rgba_smart_probe_reservoir".into(),
    })
}

fn rgb_fuzzy_score(
    screen: &[u8],
    sw: usize,
    tpl: &[u8],
    tw: usize,
    px: usize,
    py: usize,
    probes: &[(usize, usize)],
) -> f64 {
    let mut diff = 0.0f64;
    for &(tx, ty) in probes {
        let si = ((py + ty) * sw + (px + tx)) * 4;
        let ti = (ty * tw + tx) * 4;
        diff += (screen[si] as f64 - tpl[ti] as f64).abs();
        diff += (screen[si + 1] as f64 - tpl[ti + 1] as f64).abs();
        diff += (screen[si + 2] as f64 - tpl[ti + 2] as f64).abs();
    }
    1.0 - diff / (probes.len() as f64 * 3.0 * 255.0)
}

fn full_rgb_score(
    screen: &[u8],
    sw: usize,
    tpl: &[u8],
    tw: usize,
    th: usize,
    px: usize,
    py: usize,
) -> f64 {
    if px + tw > sw {
        return 0.0;
    }
    let mut diff = 0.0f64;
    let mut count = 0usize;
    for ty in 0..th {
        for tx in 0..tw {
            let ti = (ty * tw + tx) * 4;
            if tpl[ti + 3] < 16 {
                continue;
            }
            let si = ((py + ty) * sw + (px + tx)) * 4;
            diff += (screen[si] as f64 - tpl[ti] as f64).abs();
            diff += (screen[si + 1] as f64 - tpl[ti + 1] as f64).abs();
            diff += (screen[si + 2] as f64 - tpl[ti + 2] as f64).abs();
            count += 1;
        }
    }
    if count == 0 {
        return 0.0;
    }
    1.0 - diff / (count as f64 * 3.0 * 255.0)
}

fn build_rgb_probes(tpl: &[u8], tw: usize, th: usize, max_n: usize) -> Vec<(usize, usize)> {
    let mut scored: Vec<(usize, usize, f64)> = Vec::new();
    for y in 0..th {
        for x in 0..tw {
            let e = edge_strength(tpl, tw, th, x, y, 16);
            if e >= 0.0 {
                scored.push((x, y, e));
            }
        }
    }
    scored.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));

    let min_d = (tw.min(th) / 7).max(2);
    let mut out: Vec<(usize, usize)> = Vec::new();
    for &(x, y, _) in &scored {
        if out.len() >= max_n {
            break;
        }
        let ok = out.iter().all(|&(px, py)| {
            let dx = if x > px { x - px } else { px - x };
            let dy = if y > py { y - py } else { py - y };
            dx.max(dy) >= min_d
        });
        if ok {
            out.push((x, y));
        }
    }
    for &(x, y, _) in &scored {
        if out.len() >= max_n {
            break;
        }
        if !out.contains(&(x, y)) {
            out.push((x, y));
        }
    }
    if out.is_empty() {
        out.push((tw / 2, th / 2));
    }
    out
}

fn match_rgb_multiscale(
    screen: &[u8],
    sw: usize,
    sh: usize,
    tpl: &[u8],
    tw: usize,
    th: usize,
    tpl_img: &image::RgbaImage,
    opts: &MatchOptions,
) -> Result<MatchHit, String> {
    let scales = [1.0, 0.9, 1.1, 0.8, 1.25];
    let stride = 2usize;
    let probe_n = 24usize;
    let cand_n = 90usize;
    let early_accept = 0.965;

    let mut best: Option<(i32, i32, f64, String)> = None;

    for &s in &scales {
        let ntw = (tw as f64 * s).round().max(1.0) as u32;
        let nth = (th as f64 * s).round().max(1.0) as u32;
        if ntw as usize > sw || nth as usize > sh {
            continue;
        }

        let tpl_data = if ntw as usize != tw || nth as usize != th {
            let r =
                image::imageops::resize(tpl_img, ntw, nth, image::imageops::FilterType::Lanczos3);
            r.into_raw()
        } else {
            tpl.to_vec()
        };
        let ntw = ntw as usize;
        let nth = nth as usize;

        let probes = build_rgb_probes(&tpl_data, ntw, nth, probe_n);
        let mut candidates: Vec<(usize, usize, f64)> = Vec::new();
        let mut py = 0;
        while py + nth <= sh {
            let mut px = 0;
            while px + ntw <= sw {
                let ps = rgb_fuzzy_score(screen, sw, &tpl_data, ntw, px, py, &probes);
                let near = candidates.iter().any(|&(cx, cy, _)| {
                    let dx = if px > cx { px - cx } else { cx - px };
                    let dy = if py > cy { py - cy } else { cy - py };
                    dx.max(dy) <= 1
                });
                if !near {
                    let pos = candidates.iter().position(|&(_, _, sc)| ps > sc);
                    if let Some(idx) = pos {
                        if idx < cand_n {
                            candidates.insert(idx, (px, py, ps));
                            if candidates.len() > cand_n {
                                candidates.pop();
                            }
                        }
                    } else if candidates.len() < cand_n {
                        candidates.push((px, py, ps));
                    }
                }
                px += stride;
            }
            py += stride;
        }

        for &(cx, cy, _) in &candidates {
            let x0 = if cx > stride { cx - stride - 1 } else { 0 };
            let x1 = (sw - ntw).min(cx + stride + 1);
            let y0 = if cy > stride { cy - stride - 1 } else { 0 };
            let y1 = (sh - nth).min(cy + stride + 1);
            for y in y0..=y1 {
                for x in x0..=x1 {
                    let sc = full_rgb_score(screen, sw, &tpl_data, ntw, nth, x, y);
                    if sc > opts.tolerant_min_score {
                        let improved = best.as_ref().map_or(true, |&(_, _, ref bsc, _)| sc > *bsc);
                        if improved {
                            let algo = if (s - 1.0).abs() < 1e-6 {
                                "rgb_tolerant_sparse_sad"
                            } else {
                                "rgb_tolerant_multiscale_sad"
                            };
                            best = Some((x as i32, y as i32, sc, algo.into()));
                        }
                    }
                }
            }
        }

        if let Some(ref b) = best {
            if (s - 1.0).abs() < 1e-6 && b.2 >= early_accept {
                break;
            }
        }
    }

    best.map(|(bx, by, sc, algo)| MatchHit {
        top_left_x: bx,
        top_left_y: by,
        click_x: bx,
        click_y: by,
        score: sc,
        match_algorithm: algo,
    })
    .ok_or_else(|| "未找到足够相似的区域".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn match_options_defaults() {
        let opts = MatchOptions::default();
        assert!((opts.min_score - 0.72).abs() < 1e-9);
        assert!((opts.tolerant_min_score - 0.88).abs() < 1e-9);
        assert!(!opts.legacy_two_round_probe);
        assert_eq!(opts.reservoir_size, 50);
    }
}
