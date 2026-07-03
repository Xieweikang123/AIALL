import type { IconTemplateItem, IconTemplateListResponse } from "../types/iconTemplates";
import { backendUrl } from "./backendBase";
import { invokeBackend, isTauriEnv, tauriInvoke } from "./tauriInvoke";

const BASE = backendUrl("/backend/icon-templates");

function mapTauriIconTemplates(templates: unknown[]): IconTemplateListResponse["items"] {
  return templates.map((raw) => {
    const t = raw as Record<string, unknown>;
    const pngBase64 = typeof t.pngBase64 === "string" ? t.pngBase64 : "";
    return {
      id: String(t.id ?? ""),
      name: String(t.name ?? ""),
      aliases: Array.isArray(t.aliases) ? (t.aliases as string[]) : [],
      note: String(t.note ?? ""),
      imageFile: typeof t.imageFile === "string" ? t.imageFile : null,
      createdAt: String(t.createdAt ?? ""),
      updatedAt: String(t.updatedAt ?? ""),
      imageUrl: pngBase64 ? `data:image/png;base64,${pngBase64}` : null,
    };
  });
}

export async function fetchIconTemplateList(): Promise<IconTemplateListResponse> {
  if (isTauriEnv()) {
    const result = await tauriInvoke<{
      ok: boolean;
      templates: unknown[];
      storePath?: string;
      imagesPath?: string;
    }>("icon_templates_list");
    if (!result.ok) {
      throw new Error("获取模板列表失败");
    }
    return {
      ok: true,
      storePath: result.storePath ?? "",
      imagesPath: result.imagesPath ?? "",
      items: mapTauriIconTemplates(result.templates ?? []),
    };
  }

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
  if (isTauriEnv()) {
    const result = await tauriInvoke<{ ok: boolean; item?: IconTemplateItem; error?: string }>(
      "icon_templates_save",
      { ...payload },
    );
    if (!result.ok || !result.item) {
      throw new Error(result.error || "保存失败");
    }
    return { ok: true, item: result.item };
  }

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
  if (isTauriEnv()) {
    const result = await tauriInvoke<{ ok: boolean; error?: string }>("icon_templates_delete", { id });
    if (!result.ok) {
      throw new Error(result.error || "删除失败");
    }
    return;
  }

  const res = await fetch(`${BASE}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  const data = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `删除失败 HTTP ${res.status}`);
  }
}

/** 仅在本机 Windows + npm run dev：截屏并在当前桌面查找该模板，不点击 */
/** Match algorithm ids aligned with Rust automation matcher. */
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
  try {
    const data = await invokeBackend<Record<string, unknown>>(
      "automation_test_icon_template",
      { templateId: id },
      async () => {
        const res = await fetch(backendUrl("/backend/automation/test-match"), {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ id }),
        });
        return (await res.json()) as Record<string, unknown>;
      },
    );

    const errText = typeof data.error === "string" ? data.error : "";
    const b64 = typeof data.screenPngBase64 === "string" ? data.screenPngBase64 : undefined;

    if (data.ok === true) {
      return {
        ok: true,
        id: String(data.id ?? id),
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
      error: errText || "模板匹配失败",
      ...(b64 ? { screenPngBase64: b64 } : {}),
    };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
