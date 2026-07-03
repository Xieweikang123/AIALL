/** 本机开发服：按图标模板 id 截屏匹配并点击（仅 Windows 有效） */

import { backendUrl } from "./backendBase";
import { invokeBackend, isTauriEnv, tauriInvoke } from "./tauriInvoke";
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

export interface CaptureScreenResult {
  ok: boolean;
  data?: string;
  error?: string;
}

export interface FindTemplateResult {
  ok: boolean;
  topLeftX?: number;
  topLeftY?: number;
  clickX?: number;
  clickY?: number;
  score?: number;
  matchAlgorithm?: string;
  error?: string;
}

export async function captureScreenTauri(): Promise<CaptureScreenResult> {
  if (!isTauriEnv()) {
    return { ok: false, error: "非 Tauri 环境" };
  }
  return tauriInvoke<CaptureScreenResult>("automation_capture_screen");
}

export async function clickAtTauri(x: number, y: number): Promise<{ ok: boolean; error?: string }> {
  if (!isTauriEnv()) {
    return { ok: false, error: "非 Tauri 环境" };
  }
  return tauriInvoke<{ ok: boolean; error?: string }>("automation_click_at", { x, y });
}

export async function findTemplateTauri(screenPng: string, templatePng: string, minScore?: number): Promise<FindTemplateResult> {
  if (!isTauriEnv()) {
    return { ok: false, error: "非 Tauri 环境" };
  }
  return tauriInvoke<FindTemplateResult>("automation_find_template", {
    screenPngB64: screenPng,
    templatePngB64: templatePng,
    minScore: minScore ?? null,
  });
}

export async function openAppByIconTemplateId(id: string): Promise<OpenByTemplateResult> {
  const data = await invokeBackend<OpenByTemplateResult | { ok: false; error?: string }>(
    "automation_open_by_template",
    { templateId: id },
    async () => {
      const res = await fetch(backendUrl("/backend/automation/open-by-template"), {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ id }),
      });
      const text = await res.text();
      return JSON.parse(text);
    },
  );
  if (!data.ok) {
    throw new Error((data as { error?: string }).error || "自动化操作失败");
  }
  return data as OpenByTemplateResult;
}
