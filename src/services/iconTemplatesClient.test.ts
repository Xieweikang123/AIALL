import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteIconTemplate,
  fetchIconTemplateList,
  testIconTemplateMatch,
  upsertIconTemplate,
} from "./iconTemplatesClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("iconTemplatesClient（web / 非 Tauri 环境）", () => {
  it("fetchIconTemplateList 返回桌面版降级错误", async () => {
    const result = await fetchIconTemplateList();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("仅桌面版");
  });

  it("upsertIconTemplate 抛桌面版错误", async () => {
    await expect(upsertIconTemplate({ id: "x", name: "n" })).rejects.toThrow("仅桌面版");
  });

  it("deleteIconTemplate 抛桌面版错误", async () => {
    await expect(deleteIconTemplate("x")).rejects.toThrow("仅桌面版");
  });

  it("testIconTemplateMatch 返回降级错误（不抛错）", async () => {
    const result = await testIconTemplateMatch("tpl-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("仅桌面版");
    }
  });
});
