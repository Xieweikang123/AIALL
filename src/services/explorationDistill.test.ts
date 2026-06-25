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

  it("archives explore runs as project overview", () => {
    const tools = [
      { name: "read_file", ok: true, args: { path: "src/a.ts" } },
      { name: "read_file", ok: true, args: { path: "src/b.ts" } },
      { name: "read_file", ok: true, args: { path: "src/c.ts" } },
    ];
    const result = distillExplorationRun({
      tools,
      chatMode: "explore",
      totalTurns: 8,
      assistantText: "<!-- project-report -->\n# 项目理解报告\n\n## 技术栈\nvue",
    });
    expect(result.offer).toBe(true);
    expect(result.archive?.filename).toMatch(/^project-overview-/);
    expect(result.archive?.content).toContain("kind: project_overview");
    expect(result.archive?.content).toContain("项目理解报告");
  });

  it("archive content summary replaces file path list", () => {
    const content = buildExplorationArchiveMarkdown({
      readPaths: ["src/App.vue", "src/router/index.ts", "src/views/Home.vue"],
      writtenPaths: ["src/App.vue"],
      turnCount: 5,
      assistantText:
        "根因假设：App.vue 的路由配置缺少 fallback\n已读取关键文件，确认 router 使用 hash history\n下一步需要修改 App.vue 添加默认路由",
    });
    expect(content).toContain("# 探索快照");
    expect(content).toContain("根因假设");
    expect(content).toContain("router");
    // Old format: should NOT contain file path list section
    expect(content).not.toContain("## 涉及文件");
    expect(content).not.toContain("`src/App.vue`");
    expect(content).not.toContain("读取 3 个文件");
  });

  it("archive falls back to stats when no assistant text", () => {
    const content = buildExplorationArchiveMarkdown({
      readPaths: ["src/App.vue"],
      writtenPaths: [],
      turnCount: 3,
    });
    expect(content).toContain("# 探索快照");
    expect(content).toContain("读取 1 个文件");
    // No file path list in fallback either
    expect(content).not.toContain("## 涉及文件");
  });
});
