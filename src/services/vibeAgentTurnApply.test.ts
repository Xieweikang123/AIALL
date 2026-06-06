import { describe, expect, it } from "vitest";
import { isDeleteNotFoundError } from "./vibeAgentTurnApply";

describe("isDeleteNotFoundError", () => {
  it("matches Chinese not-found messages from the delete API", () => {
    expect(isDeleteNotFoundError("文件或目录不存在")).toBe(true);
  });

  it("matches common English not-found messages", () => {
    expect(isDeleteNotFoundError("ENOENT: no such file")).toBe(true);
    expect(isDeleteNotFoundError("Not Found")).toBe(true);
  });

  it("does not treat other failures as already deleted", () => {
    expect(isDeleteNotFoundError("路径超出项目根目录")).toBe(false);
    expect(isDeleteNotFoundError("删除失败")).toBe(false);
    expect(isDeleteNotFoundError(undefined)).toBe(false);
  });
});
