import { describe, expect, it } from "vitest";
import { buildGitLogGraph } from "./useGitLogGraph";

describe("buildGitLogGraph", () => {
  it("keeps a linear history in one lane", () => {
    const rows = buildGitLogGraph([
      { hash: "c", parents: ["b"] },
      { hash: "b", parents: ["a"] },
      { hash: "a", parents: [] },
    ]);
    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(rows[0].connections).toEqual([{ fromLane: 0, toLane: 0 }]);
  });

  it("allocates adjacent lanes for a merge commit", () => {
    const rows = buildGitLogGraph([
      { hash: "merge", parents: ["main", "feature"] },
      { hash: "feature", parents: ["base"] },
      { hash: "main", parents: ["base"] },
      { hash: "base", parents: [] },
    ]);
    expect(rows[0].connections).toEqual([
      { fromLane: 0, toLane: 0 },
      { fromLane: 0, toLane: 1 },
    ]);
    expect(rows[1].lane).toBe(1);
  });

  it("does not create a fake lane for a missing parent", () => {
    const rows = buildGitLogGraph([{ hash: "tip", parents: ["outside-page"] }]);
    expect(rows[0].lane).toBe(0);
    expect(rows[0].connections).toEqual([{ fromLane: 0, toLane: 0 }]);
  });

  it("preserves an existing lane when a second branch appears", () => {
    const rows = buildGitLogGraph([
      { hash: "feature-tip", parents: ["feature-base"] },
      { hash: "main-tip", parents: ["main-base"] },
      { hash: "feature-base", parents: ["root"] },
      { hash: "main-base", parents: ["root"] },
      { hash: "root", parents: [] },
    ]);
    expect(rows[0].lane).toBe(0);
    expect(rows[1].lane).toBe(0);
    expect(rows[2].lane).toBe(1);
    expect(rows[3].lane).toBe(0);
  });
});
