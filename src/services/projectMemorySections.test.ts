import { describe, expect, it } from "vitest";
import {
  appendProjectMemorySection,
  isProjectMemorySection,
} from "./projectMemorySections";

describe("projectMemorySections", () => {
  it("appends under existing section", () => {
    const base = "## 导航\n\n- 已有条目";
    const merged = appendProjectMemorySection(base, "导航", ["新路径：`src/foo.ts`"]);
    expect(merged).toContain("- 已有条目");
    expect(merged).toContain("- 新路径：`src/foo.ts`");
  });

  it("creates section when missing", () => {
    const merged = appendProjectMemorySection("", "术语", ["用户说「侧边栏」指 Sidebar.vue"]);
    expect(merged).toContain("## 术语");
    expect(merged).toContain("侧边栏");
  });

  it("validates section ids", () => {
    expect(isProjectMemorySection("导航")).toBe(true);
    expect(isProjectMemorySection("其他")).toBe(false);
  });
});
