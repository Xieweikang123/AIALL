import type { IconTemplateItem } from "../types/iconTemplates";

/**
 * 解析用户「打开/启动/运行 + 目标」类指令。
 */
export interface OpenAppIntent {
  targetPhrase: string;
}

export function parseOpenAppIntent(text: string): OpenAppIntent | null {
  const rest = String(text || "").trim();
  if (!rest) return null;

  const m = rest.match(/^(?:请)?(?:帮我)?(?:打开|启动|运行)\s*(.+)$/u);
  if (!m) return null;
  const target = m[1].trim();
  if (!target) return null;
  return { targetPhrase: target };
}

/**
 * 用显示名、别名、id 在模板列表中解析出模板 id
 */
export function resolveIconTemplateId(phrase: string, items: IconTemplateItem[]): string | null {
  const p = phrase.trim();
  if (!p) return null;
  const lower = p.toLowerCase();

  for (const it of items) {
    if (it.id === lower) return it.id;
  }
  for (const it of items) {
    const nm = it.name.trim();
    if (nm === p || nm.toLowerCase() === lower) return it.id;
    for (const a of it.aliases || []) {
      const ax = String(a || "").trim();
      if (ax && (ax === p || ax.toLowerCase() === lower)) return it.id;
    }
  }
  for (const it of items) {
    const nm = it.name.trim();
    if (nm && (p.includes(nm) || nm.includes(p))) return it.id;
    for (const a of it.aliases || []) {
      const ax = String(a || "").trim();
      if (ax && (p.includes(ax) || ax.includes(p))) return it.id;
    }
  }
  return null;
}
