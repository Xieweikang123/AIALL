import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENTS_MD_REL_PATH,
  AGENTS_GUIDE_MAX_CHARS,
  extractAgentsGuideForPrompt,
  formatAgentsGuideForPrompt,
  isBlockedAgentsGuideSection,
  readProjectAgentsGuide,
} from "./vibeProjectAgentsGuide";

const SAMPLE_AGENTS = `# 项目术语约定

| 用户说 | 实际指 |
|--------|--------|
| 文件面板 | \`src/components/vibe/FilePanel.vue\` |

## 项目结构

- \`src/views/Foo.vue\` — 主页面

## Agent 编排与提示词（通用性）

编排层禁止绑定业务词。

## 会话文件存储

会话在 AppData 下。

## 开发约定

禁止 console.log

## 事件竞态调试准则

先穷举事件时序。
`;

describe("vibeProjectAgentsGuide", () => {
  let tmpDir = "";

  afterEach(async () => {
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
      tmpDir = "";
    }
  });

  it("blocks developer-only section titles", () => {
    expect(isBlockedAgentsGuideSection("Agent 编排与提示词（通用性）")).toBe(true);
    expect(isBlockedAgentsGuideSection("开发约定")).toBe(true);
    expect(isBlockedAgentsGuideSection("事件竞态调试准则")).toBe(true);
    expect(isBlockedAgentsGuideSection("项目结构")).toBe(false);
  });

  it("extractAgentsGuideForPrompt keeps terminology and runtime sections", () => {
    const { content } = extractAgentsGuideForPrompt(SAMPLE_AGENTS);
    expect(content).toContain("项目术语约定");
    expect(content).toContain("文件面板");
    expect(content).toContain("## 项目结构");
    expect(content).toContain("## 会话文件存储");
    expect(content).not.toContain("Agent 编排");
    expect(content).not.toContain("开发约定");
    expect(content).not.toContain("事件竞态");
  });

  it("truncates oversized guide", () => {
    const huge = `# 术语\n\n${"x".repeat(AGENTS_GUIDE_MAX_CHARS + 500)}`;
    const { content, truncated } = extractAgentsGuideForPrompt(huge);
    expect(truncated).toBe(true);
    expect(content.length).toBeLessThanOrEqual(AGENTS_GUIDE_MAX_CHARS + 20);
  });

  it("formatAgentsGuideForPrompt skips empty content", () => {
    expect(formatAgentsGuideForPrompt("")).toBe("");
  });

  it("readProjectAgentsGuide returns empty when AGENTS.md missing", async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "agents-guide-"));
    const result = await readProjectAgentsGuide(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toBe("");
    expect(result.path).toBe(AGENTS_MD_REL_PATH);
  });

  it("readProjectAgentsGuide reads project AGENTS.md", async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "agents-guide-"));
    await fs.promises.writeFile(path.join(tmpDir, AGENTS_MD_REL_PATH), SAMPLE_AGENTS, "utf-8");
    const result = await readProjectAgentsGuide(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toContain("文件面板");
    expect(result.content).not.toContain("Agent 编排");
  });
});
