import { describe, expect, it } from "vitest";
import { buildSessionOutline, formatOutlinePreview } from "./sessionOutline";

describe("buildSessionOutline", () => {
  it("lists only non-empty user turns in order", () => {
    const items = buildSessionOutline([
      { id: "u1", role: "user", content: "第一问" },
      { id: "a1", role: "assistant", content: "答" },
      { id: "u2", role: "user", content: "  " },
      { id: "u3", role: "user", content: "第二问\n多行" },
    ]);
    expect(items).toEqual([
      { id: "u1", index: 1, preview: "第一问" },
      { id: "u3", index: 2, preview: "第二问 多行" },
    ]);
  });

  it("strips reference attachments from preview", () => {
    const items = buildSessionOutline([
      {
        id: "u1",
        role: "user",
        content: "看看这个文件\n\n## 📎 引用\nfoo.ts",
      },
    ]);
    expect(items[0]?.preview).toBe("看看这个文件");
  });
});

describe("formatOutlinePreview", () => {
  it("truncates long text", () => {
    const long = "字".repeat(80);
    const preview = formatOutlinePreview(long);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.length).toBe(57);
  });
});
