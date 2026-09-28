/**
 * 会话输入框「/ 预设提示词」的全局存储。
 *
 * 全局共享（不按项目隔离）：所有项目复用同一份预设，存 localStorage。
 * 预设只是用户可编辑的文本模板，命中后填进输入框、由用户手动发送，
 * 不参与 Agent 编排，也不进 system prompt。
 */

import { lsGetJson, lsRemove, lsSetJson } from "./localStorageSafe";

export const PROMPT_PRESETS_STORAGE_KEY = "aiall-prompt-presets";

export interface PromptPreset {
  id: string;
  /** 下拉里显示的名字，同时用于 `/` 关键词匹配 */
  name: string;
  /** 选中后填入输入框的正文 */
  content: string;
}

/** 内置预设：仅在本地从未写过预设时作为初始值，用户可任意增删改。 */
export const DEFAULT_PROMPT_PRESETS: PromptPreset[] = [
  { id: "preset-explain", name: "解释代码", content: "请解释以下代码的作用、关键流程和边界问题：\n" },
  { id: "preset-test", name: "补单元测试", content: "为以下代码补充单元测试，覆盖正常路径与边界情况：\n" },
  { id: "preset-refactor", name: "重构", content: "在不改变行为的前提下重构以下代码，提升可读性与可维护性：\n" },
  { id: "preset-bug", name: "定位 Bug", content: "以下现象存在问题，请先定位根因，再给出最小修复方案：\n" },
];

export function createPromptPresetId(): string {
  return `pp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 把任意来源（localStorage / 旧版本）的数据规整成合法预设数组。 */
export function sanitizePromptPresets(raw: unknown): PromptPreset[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PromptPreset[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const content = typeof item.content === "string" ? item.content : "";
    if (!name && !content.trim()) continue;
    let id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : "";
    if (!id || seen.has(id)) id = createPromptPresetId();
    seen.add(id);
    out.push({ id, name: name || "未命名预设", content });
  }
  return out;
}

/**
 * 读取预设。区分「从未写过」（返回内置默认）与「写过但为空」（返回空数组，
 * 表示用户主动删光了，不能再用默认值盖回去）。
 */
export function readPromptPresets(): PromptPreset[] {
  const raw = lsGetJson<unknown>(PROMPT_PRESETS_STORAGE_KEY);
  if (raw === null) return DEFAULT_PROMPT_PRESETS.map((p) => ({ ...p }));
  return sanitizePromptPresets(raw);
}

export function writePromptPresets(list: PromptPreset[]): boolean {
  return lsSetJson(PROMPT_PRESETS_STORAGE_KEY, sanitizePromptPresets(list));
}

export function clearPromptPresets(): void {
  lsRemove(PROMPT_PRESETS_STORAGE_KEY);
}
