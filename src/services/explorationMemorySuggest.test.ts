import { describe, expect, it } from "vitest";
import {
  buildExplorationMemoryCandidates,
  shouldOfferExplorationMemory,
  uniqueReadPathsFromTools,
} from "./explorationMemorySuggest";

describe("explorationMemorySuggest", () => {
  it("collects unique read_file paths", () => {
    const paths = uniqueReadPathsFromTools([
      { name: "read_file", ok: true, args: { path: "src/a.ts" } },
      { name: "read_file", ok: true, args: { path: "src/a.ts" } },
      { name: "read_file", ok: true, args: { path: "src/b.ts" } },
      { name: "grep", ok: true, args: { pattern: "x" } },
    ]);
    expect(paths).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("offers memory after breadth exploration or writes", () => {
    expect(
      shouldOfferExplorationMemory({
        tools: [
          { name: "read_file", args: { path: "a" } },
          { name: "read_file", args: { path: "b" } },
          { name: "read_file", args: { path: "c" } },
        ],
      }),
    ).toBe(true);
    expect(shouldOfferExplorationMemory({ writtenFiles: ["src/x.ts"] })).toBe(true);
    expect(shouldOfferExplorationMemory({ chatMode: "ask", writtenFiles: ["a.ts"] })).toBe(false);
  });

  it("builds navigation candidates from tools", () => {
    const items = buildExplorationMemoryCandidates({
      writtenFiles: ["src/views/Foo.vue"],
      tools: [{ name: "read_file", ok: true, args: { path: "src/other.ts" } }],
    });
    expect(items.some((i) => i.line.includes("Foo.vue"))).toBe(true);
    expect(items.every((i) => i.section === "导航")).toBe(true);
  });
});
