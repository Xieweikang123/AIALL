import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectPath } from "./server/vibeFs";

/** Mirrors resolvePathInsideOptionalRoot in vibeRoutesFileOps.ts */
function resolvePathInsideOptionalRoot(
  inputPath: string,
  projectRoot?: string,
): { ok: true; path: string } | { ok: false; error: string } {
  const trimmed = String(inputPath || "").trim();
  if (!trimmed) return { ok: false, error: "路径不能为空" };

  const rootInput = projectRoot?.trim();
  if (!rootInput) return { ok: true, path: path.resolve(trimmed) };

  return resolveProjectPath(rootInput, trimmed);
}

describe("resolvePathInsideOptionalRoot", () => {
  it("joins relative paths under projectRoot, not process.cwd()", () => {
    const root = path.resolve("D:/project/AIALL");
    const rel = ".aiall/plans/1782798668699-f47331912b3478.md";
    const result = resolvePathInsideOptionalRoot(rel, root);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe(path.resolve(root, rel));
    }
  });

  it("rejects paths outside projectRoot", () => {
    const root = path.resolve("D:/project/AIALL");
    const result = resolvePathInsideOptionalRoot("../other/file.md", root);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("路径超出项目根目录");
  });
});
