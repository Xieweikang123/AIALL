/** 本机开发服：按图标模板 id 截屏匹配并点击（仅 Windows 有效） */

import type { MatchAlgorithm } from "./iconTemplatesClient";

export interface OpenByTemplateResult {
  ok: true;
  id: string;
  name: string;
  score: number;
  clickX: number;
  clickY: number;
  topLeftX: number;
  topLeftY: number;
  matchAlgorithm: MatchAlgorithm;
}

export async function openAppByIconTemplateId(id: string): Promise<OpenByTemplateResult> {
  const res = await fetch("/backend/automation/open-by-template", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ id }),
  });
  const data = (await res.json()) as OpenByTemplateResult | { ok?: false; error?: string };
  if (!res.ok || !data.ok) {
    throw new Error((data as { error?: string }).error || `请求失败 HTTP ${res.status}`);
  }
  return data as OpenByTemplateResult;
}
