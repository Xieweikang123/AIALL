import { describe, expect, it } from "vitest";
import { resolveEditorViewMode } from "./editorViewMode";

describe("resolveEditorViewMode", () => {
  it("diff 模式优先于一切", () => {
    expect(
      resolveEditorViewMode({ path: "docs/note.md", showDiffMode: true, previewEnabled: true }),
    ).toBe("diff");
    expect(
      resolveEditorViewMode({ path: "src/a.ts", showDiffMode: true, previewEnabled: false }),
    ).toBe("diff");
  });

  it("md + 预览偏好开启且非 diff 时为预览", () => {
    expect(
      resolveEditorViewMode({ path: "docs/note.md", showDiffMode: false, previewEnabled: true }),
    ).toBe("preview");
  });

  it("md 但预览偏好关闭时为编辑", () => {
    expect(
      resolveEditorViewMode({ path: "docs/note.md", showDiffMode: false, previewEnabled: false }),
    ).toBe("edit");
  });

  it("非 md 即使预览偏好开启也是编辑（不误开预览）", () => {
    expect(
      resolveEditorViewMode({ path: "src/a.ts", showDiffMode: false, previewEnabled: true }),
    ).toBe("edit");
  });

  it("git 虚拟路径后缀为 .md 时同样按 md 处理", () => {
    expect(
      resolveEditorViewMode({
        path: "git-index://docs/note.md",
        showDiffMode: false,
        previewEnabled: true,
      }),
    ).toBe("preview");
  });
});
