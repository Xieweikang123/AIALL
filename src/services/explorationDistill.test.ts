import { describe, expect, it } from "vitest";
import { distillExplorationRun } from "./explorationDistill";

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
});
