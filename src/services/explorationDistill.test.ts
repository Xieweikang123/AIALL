import { describe, expect, it } from "vitest";
import { distillExplorationRun, buildExplorationArchiveMarkdown } from "./explorationDistill";

describe("explorationDistill", () => {
  it("returns offer false when exploration threshold not met", () => {
    const result = distillExplorationRun({
      tools: [{ name: "read_file", ok: true, args: { path: "src/a.ts" } }],
      chatMode: "build",
    });
    expect(result.offer).toBe(false);
  });

  it("includes memory, archive, and skill proposals on rich exploration", () => {
    const tools = [
      { name: "read_file", ok: true, args: { path: "src/a.ts" } },
      { name: "read_file", ok: true, args: { path: "src/b.ts" } },
      { name: "read_file", ok: true, args: { path: "src/c.ts" } },
    ];
    const result = distillExplorationRun({
      tools,
      writtenFiles: ["src/a.ts"],
      chatMode: "build",
      totalTurns: 10,
      hadAttachedImage: true,
    });
    expect(result.offer).toBe(true);
    expect(result.memoryCandidates.length).toBeGreaterThan(0);
    expect(result.archive?.filename).toMatch(/\.md$/);
    expect(result.skillProposals.some((s) => s.slug === "ui-screenshot-locate")).toBe(true);
  });

  it("archive includes key findings from assistant text", () => {
    const content = buildExplorationArchiveMarkdown({
      readPaths: ["src/App.vue", "src/router/index.ts", "src/views/Home.vue"],
      writtenPaths: ["src/App.vue"],
      turnCount: 5,
      assistantText:
        "根因假设：App.vue 的路由配置缺少 fallback\n已读取关键文件，确认 router 使用 hash history\n下一步需要修改 App.vue 添加默认路由",
    });
    expect(content).toContain("## 关键发现");
    expect(content).toContain("根因假设");
    expect(content).toContain("## 涉及模块");
    expect(content).toContain("src（2 个文件）");
    expect(content).toContain("## 写入文件");
    expect(content).toContain("`src/App.vue`");
  });

  it("archive skips findings when no assistant text", () => {
    const content = buildExplorationArchiveMarkdown({
      readPaths: ["src/App.vue"],
      writtenPaths: [],
      turnCount: 3,
    });
    expect(content).not.toContain("## 关键发现");
    expect(content).toContain("## 涉及模块");
  });
});
