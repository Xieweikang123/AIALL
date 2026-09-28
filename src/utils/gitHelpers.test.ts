import { describe, expect, it } from "vitest";
import { resolveRepoFilePath } from "./gitHelpers";

describe("resolveRepoFilePath", () => {
  it("joins a repo-relative path onto the active repo root", () => {
    expect(resolveRepoFilePath("D:/ganwei/virtual-power-plant/vpp-java", "docs/业务设计/x.md"))
      .toBe("D:/ganwei/virtual-power-plant/vpp-java/docs/业务设计/x.md");
  });

  it("normalizes backslashes and a trailing slash on the repo root", () => {
    expect(resolveRepoFilePath("D:\\project\\repo\\", "src\\a.ts"))
      .toBe("D:/project/repo/src/a.ts");
  });

  it("resolves a nested file against the nested repo, not the project root", () => {
    // 回归：多仓项目里 Git 面板文件是相对激活子仓的。拼项目根会得到不存在的路径，
    // 「在文件管理器中显示」静默失败——表现为点击没反应。
    const nestedRepo = "D:/ganwei/virtual-power-plant/vpp-java";
    const projectRoot = "D:/ganwei/virtual-power-plant";
    const resolved = resolveRepoFilePath(nestedRepo, "docs/x.md");
    expect(resolved).toBe("D:/ganwei/virtual-power-plant/vpp-java/docs/x.md");
    expect(resolved.startsWith(`${projectRoot}/docs/`)).toBe(false);
  });

  it("returns already-absolute paths unchanged", () => {
    expect(resolveRepoFilePath("D:/project/repo", "D:/other/file.ts")).toBe("D:/other/file.ts");
    expect(resolveRepoFilePath("D:/project/repo", "D:\\other\\file.ts")).toBe("D:\\other\\file.ts");
    expect(resolveRepoFilePath("D:/project/repo", "/home/user/file.ts")).toBe("/home/user/file.ts");
    expect(resolveRepoFilePath("D:/project/repo", "\\\\server\\share\\file.ts")).toBe("\\\\server\\share\\file.ts");
  });

  it("returns an empty string for blank input", () => {
    expect(resolveRepoFilePath("D:/project/repo", "")).toBe("");
    expect(resolveRepoFilePath("D:/project/repo", "   ")).toBe("");
  });

  it("falls back to the relative path when the repo root is empty", () => {
    expect(resolveRepoFilePath("", "src/a.ts")).toBe("src/a.ts");
  });
});
