export const PROJECT_MEMORY_SECTIONS = ["术语", "导航", "偏好"] as const;
export type ProjectMemorySection = (typeof PROJECT_MEMORY_SECTIONS)[number];

export const PROJECT_MEMORY_SECTION_TEMPLATE = `# 项目记忆

与 AGENTS.md 互补：AGENTS.md 存稳定术语；此处存探索结论与用户偏好。AI 每次对话会自动读取。

## 术语

（本项目特有、AGENTS.md 未覆盖的用户说法 → 模块/文件）

## 导航

（常用入口、目录约定、探索涉及的源码路径）

## 偏好

（编码风格、语言、工作流习惯）
`;

export function isProjectMemorySection(value: string): value is ProjectMemorySection {
  return (PROJECT_MEMORY_SECTIONS as readonly string[]).includes(value);
}

export function appendProjectMemorySection(
  existing: string,
  section: ProjectMemorySection,
  lines: string[],
): string {
  const bullets = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith("- ") ? line : `- ${line}`));
  if (!bullets.length) return existing.replace(/\r\n/g, "\n").trim();

  let normalized = existing.replace(/\r\n/g, "\n").trim();
  if (!normalized) normalized = PROJECT_MEMORY_SECTION_TEMPLATE.trim();

  const header = `## ${section}`;
  const sectionRe = new RegExp(`^## ${section}\\s*$`, "m");

  if (!sectionRe.test(normalized)) {
    return `${normalized}\n\n${header}\n\n${bullets.join("\n")}`;
  }

  const parts = normalized.split(/\n(?=## )/);
  const rebuilt: string[] = [];
  for (const part of parts) {
    const trimmed = part.trimEnd();
    if (sectionRe.test(trimmed)) {
      rebuilt.push(`${trimmed}\n${bullets.join("\n")}`);
    } else {
      rebuilt.push(part);
    }
  }
  return rebuilt.join("\n\n").trim();
}
