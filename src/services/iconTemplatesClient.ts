import type { IconTemplateItem, IconTemplateListResponse } from "../types/iconTemplates";

const BASE = "/backend/icon-templates";

export async function fetchIconTemplateList(): Promise<IconTemplateListResponse> {
  const res = await fetch(BASE, { method: "GET" });
  const data = (await res.json()) as IconTemplateListResponse | { ok?: false; error?: string };
  if (!res.ok || !("items" in data) || !data.ok) {
    throw new Error((data as { error?: string }).error || `请求失败 HTTP ${res.status}`);
  }
  return data;
}

export interface UpsertIconTemplatePayload {
  id: string;
  name: string;
  aliases?: string[];
  note?: string;
  /** data URL 或纯 base64；不传则更新元数据时保留原图 */
  imageBase64?: string | null;
  /** 为 true 时移除模板图文件 */
  clearImage?: boolean;
}

export async function upsertIconTemplate(payload: UpsertIconTemplatePayload): Promise<{ ok: true; item: IconTemplateItem }> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { ok?: boolean; error?: string; item?: IconTemplateItem };
  if (!res.ok || !data.ok || !data.item) {
    throw new Error(data.error || `保存失败 HTTP ${res.status}`);
  }
  return { ok: true, item: data.item };
}

export async function deleteIconTemplate(id: string): Promise<void> {
  const res = await fetch(`${BASE}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  const data = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `删除失败 HTTP ${res.status}`);
  }
}

/** 仅在本机 Windows + npm run dev：截屏并在当前桌面查找该模板，不点击 */
/** 与 server/templateMatch.MatchAlgorithm 同步 */
export type MatchAlgorithm =
  | "rgba_smart_probe_reservoir"
  | "rgba_legacy_probe_reservoir"
  | "rgb_tolerant_sparse_sad"
  | "rgb_tolerant_multiscale_sad";

export interface TestIconTemplateMatchOk {
  ok: true;
  id: string;
  name: string;
  score: number;
  clickX: number;
  clickY: number;
  topLeftX: number;
  topLeftY: number;
  matchAlgorithm: MatchAlgorithm;
  /** 本次用于匹配的整屏 PNG（Base64，不含 data URL 前缀） */
  screenPngBase64: string;
}

export type TestIconTemplateMatchResult =
  | TestIconTemplateMatchOk
  | { ok: false; error: string; screenPngBase64?: string };

/** 不抛错：成功 / 失败均可能带整屏截屏 Base64，便于界面展示 */
export async function testIconTemplateMatch(id: string): Promise<TestIconTemplateMatchResult> {
  const res = await fetch("/backend/automation/test-match", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ id }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  const errText = typeof data.error === "string" ? data.error : "";
  const b64 = typeof data.screenPngBase64 === "string" ? data.screenPngBase64 : undefined;

  if (res.ok && data.ok === true) {
    return {
      ok: true,
      id: String(data.id ?? ""),
      name: String(data.name ?? ""),
      score: Number(data.score),
      clickX: Number(data.clickX),
      clickY: Number(data.clickY),
      topLeftX: Number(data.topLeftX),
      topLeftY: Number(data.topLeftY),
      matchAlgorithm: data.matchAlgorithm as MatchAlgorithm,
      screenPngBase64: b64 ?? "",
    };
  }

  return {
    ok: false,
    error: errText || `请求失败 HTTP ${res.status}`,
    ...(b64 ? { screenPngBase64: b64 } : {}),
  };
}
