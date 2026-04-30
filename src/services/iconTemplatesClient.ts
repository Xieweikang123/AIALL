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
