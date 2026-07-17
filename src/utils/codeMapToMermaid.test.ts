import { describe, expect, it } from "vitest";
import type { CodeMapDocument } from "../../shared/codeMapTypes";
import { codeMapToMermaid } from "./codeMapToMermaid";
import { computeTreeLayout, visibleNodeIds } from "./codeMapLayout";

const doc: CodeMapDocument = {
  schemaVersion: 1,
  projectRoot: "/tmp/demo",
  generatedAt: "2026-01-01T00:00:00.000Z",
  nodes: [
    { id: "mod:.", kind: "root", label: "demo", path: "." },
    { id: "mod:src", kind: "module", label: "src", path: "src" },
    { id: "entry:src/main.ts", kind: "entry", label: "main.ts", path: "src/main.ts" },
  ],
  edges: [
    { id: "c1", source: "mod:.", target: "mod:src", kind: "contains" },
    { id: "c2", source: "mod:src", target: "entry:src/main.ts", kind: "contains" },
  ],
};

describe("codeMapToMermaid", () => {
  it("emits flowchart with sanitized ids", () => {
    const text = codeMapToMermaid(doc);
    expect(text.startsWith("flowchart TB")).toBe(true);
    expect(text).toContain("mod_src");
    expect(text).toContain("-->");
  });
});

describe("codeMapLayout", () => {
  it("assigns positions for all nodes", () => {
    const positions = computeTreeLayout(doc);
    expect(Object.keys(positions).sort()).toEqual(
      ["entry:src/main.ts", "mod:.", "mod:src"].sort(),
    );
  });

  it("stacks children downward instead of a single ultra-wide row", () => {
    const wide: CodeMapDocument = {
      ...doc,
      nodes: [
        { id: "mod:.", kind: "root", label: "demo", path: "." },
        ...Array.from({ length: 8 }, (_, i) => ({
          id: `mod:m${i}`,
          kind: "module" as const,
          label: `m${i}`,
          path: `m${i}`,
        })),
      ],
      edges: Array.from({ length: 8 }, (_, i) => ({
        id: `e${i}`,
        source: "mod:.",
        target: `mod:m${i}`,
        kind: "contains" as const,
      })),
    };
    const positions = computeTreeLayout(wide);
    const xs = Object.values(positions).map((p) => p.x);
    const ys = Object.values(positions).map((p) => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    // 8 siblings wrap to 2 rows of 4 → taller than a single row, bounded width
    expect(height).toBeGreaterThan(0);
    expect(width).toBeLessThan(200 * 8);
    expect(new Set(ys.filter((y) => y > 0)).size).toBeGreaterThanOrEqual(2);
  });

  it("hides descendants of collapsed nodes", () => {
    const visible = visibleNodeIds(doc, new Set(["mod:src"]));
    expect(visible.has("mod:.")).toBe(true);
    expect(visible.has("mod:src")).toBe(true);
    expect(visible.has("entry:src/main.ts")).toBe(false);
  });
});
