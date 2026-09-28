import { describe, expect, it } from "vitest";
import {
  collapseTreeNode,
  collapseTreeNodes,
  isChainExpanded,
  nextUnloadedSingleChainDir,
  treeIndentPx,
  type CollapsibleTreeNode,
} from "./treeDisplay";

function dir(name: string, path: string, children?: CollapsibleTreeNode[]): CollapsibleTreeNode {
  return { name, path, isDirectory: true, children };
}

function file(name: string, path: string): CollapsibleTreeNode {
  return { name, path, isDirectory: false };
}

describe("treeIndentPx", () => {
  it("indents shallow levels by 14px", () => {
    expect(treeIndentPx(0)).toBe(8);
    expect(treeIndentPx(1)).toBe(22);
    expect(treeIndentPx(2)).toBe(36);
    expect(treeIndentPx(4)).toBe(64);
  });

  it("narrows deep levels to 9px after level 4", () => {
    expect(treeIndentPx(5)).toBe(73);
    expect(treeIndentPx(6)).toBe(82);
    expect(treeIndentPx(10)).toBe(118);
  });

  it("clamps negative and non-finite depth", () => {
    expect(treeIndentPx(-3)).toBe(8);
    expect(treeIndentPx(Number.NaN)).toBe(8);
  });
});

describe("collapseTreeNode", () => {
  it("keeps a file node unchanged", () => {
    const node = file("Main.java", "src/Main.java");
    const display = collapseTreeNode(node);
    expect(display.name).toBe("Main.java");
    expect(display.path).toBe("src/Main.java");
    expect(display.isDirectory).toBe(false);
    expect(display.chainPaths).toEqual(["src/Main.java"]);
    expect(display.tail).toBe(node);
  });

  it("collapses a single-child directory chain into one display row", () => {
    const entity = dir("entity", "src/main/java/com/vpp/domain/entity", [file("A.java", "src/main/java/com/vpp/domain/entity/A.java")]);
    const domain = dir("domain", "src/main/java/com/vpp/domain", [entity]);
    const vpp = dir("vpp", "src/main/java/com/vpp", [domain]);
    const display = collapseTreeNode(vpp);

    expect(display.name).toBe("vpp/domain/entity");
    expect(display.path).toBe("src/main/java/com/vpp");
    expect(display.chainPaths).toEqual([
      "src/main/java/com/vpp",
      "src/main/java/com/vpp/domain",
      "src/main/java/com/vpp/domain/entity",
    ]);
    expect(display.tail).toBe(entity);
    expect((display.tail.children as CollapsibleTreeNode[])[0].name).toBe("A.java");
  });

  it("stops collapsing when a level also has files", () => {
    const leaf = dir("pkg", "src/pkg", [file("a.ts", "src/pkg/a.ts")]);
    const src = dir("src", "src", [file("index.ts", "src/index.ts"), leaf]);
    const display = collapseTreeNode(src);
    expect(display.name).toBe("src");
    expect(display.chainPaths).toEqual(["src"]);
    expect(display.tail).toBe(src);
  });

  it("stops collapsing when a level has multiple children", () => {
    const a = dir("a", "x/a", [file("a.ts", "x/a/a.ts")]);
    const b = dir("b", "x/b", [file("b.ts", "x/b/b.ts")]);
    const x = dir("x", "x", [a, b]);
    const display = collapseTreeNode(x);
    expect(display.name).toBe("x");
    expect(display.tail).toBe(x);
  });

  it("does not mutate the source tree", () => {
    const leaf = dir("pkg", "src/pkg", [file("a.ts", "src/pkg/a.ts")]);
    const src = dir("src", "src", [leaf]);
    collapseTreeNode(src);
    expect(src.name).toBe("src");
    expect(src.children?.length).toBe(1);
  });

  it("collapses each root independently", () => {
    const chain = dir("a", "a", [dir("b", "a/b", [file("c.ts", "a/b/c.ts")])]);
    const solo = file("readme.md", "readme.md");
    const [first, second] = collapseTreeNodes([chain, solo]);
    expect(first.name).toBe("a/b");
    expect(second.name).toBe("readme.md");
  });
});

describe("isChainExpanded", () => {
  it("is expanded only when the tail node is expanded", () => {
    const chain = dir("a", "a", [dir("b", "a/b", [file("c.ts", "a/b/c.ts")])]);
    const display = collapseTreeNode(chain);
    expect(isChainExpanded(display, new Set(["a"]))).toBe(false);
    expect(isChainExpanded(display, new Set(["a/b"]))).toBe(true);
  });
});

describe("nextUnloadedSingleChainDir", () => {
  const loaded = (n: CollapsibleTreeNode) => (n as { loaded?: boolean }).loaded === true;

  it("returns the next unloaded directory along a single-child chain", () => {
    const b = { ...dir("b", "a/b", []), loaded: false };
    const a = { ...dir("a", "a", [b]), loaded: true };
    expect(nextUnloadedSingleChainDir(a, loaded)).toBe(b);
  });

  it("skips already-loaded links and stops at a branch", () => {
    const c = { ...dir("c", "a/b/c", []), loaded: false };
    const b = { ...dir("b", "a/b", [c]), loaded: true };
    const a = { ...dir("a", "a", [b]), loaded: true };
    expect(nextUnloadedSingleChainDir(a, loaded)).toBe(c);

    const leaf = dir("leaf", "a/b/leaf", []);
    const branched = { ...dir("b", "a/b", [leaf, file("x.ts", "a/b/x.ts")]), loaded: true };
    const parent = { ...dir("a", "a", [branched]), loaded: true };
    expect(nextUnloadedSingleChainDir(parent, loaded)).toBeNull();
  });

  it("returns null when the sole child is a file", () => {
    const a = { ...dir("a", "a", [file("x.ts", "a/x.ts")]), loaded: true };
    expect(nextUnloadedSingleChainDir(a, loaded)).toBeNull();
  });
});
