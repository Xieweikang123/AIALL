import { describe, expect, it } from "vitest";
import {
  compressSessionGoal,
  resolveSessionGoalUpdate,
  shouldRefreshSessionGoal,
} from "./sessionGoal";

describe("sessionGoal", () => {
  it("compresses long prompts to one short line", () => {
    const long =
      "帮我修复粘贴图片后无法上传的问题，另外顺便把会话列表的排序也改一下，还有别忘了加单测覆盖这个路径。";
    const goal = compressSessionGoal(long, 40);
    expect(goal.length).toBeLessThanOrEqual(40);
    expect(goal.endsWith("…") || goal.length <= 40).toBe(true);
  });

  it("keeps short clear prompts intact", () => {
    expect(compressSessionGoal("修复粘贴图片上传")).toBe("修复粘贴图片上传");
  });

  it("does not refresh when clarification is needed", () => {
    expect(
      shouldRefreshSessionGoal({
        prompt: "帮我改一下",
        needsClarification: true,
        existingGoal: "修复上传",
      }),
    ).toBe(false);
    expect(
      resolveSessionGoalUpdate({
        prompt: "帮我改一下",
        needsClarification: true,
        existingGoal: "修复上传",
      }),
    ).toBeUndefined();
  });

  it("does not refresh on confirmation-only continuations", () => {
    expect(
      shouldRefreshSessionGoal({
        prompt: "改吧",
        existingGoal: "修复上传",
      }),
    ).toBe(false);
  });

  it("sets a new goal from a clear first demand", () => {
    expect(
      resolveSessionGoalUpdate({
        prompt: "修复粘贴图片后无法上传的问题",
        needsClarification: false,
      }),
    ).toBe("修复粘贴图片后无法上传的问题");
  });

  it("skips rewrite for execute_plan when a goal already exists", () => {
    expect(
      shouldRefreshSessionGoal({
        prompt: "把上传失败提示也改清楚一点",
        existingGoal: "修复粘贴图片上传",
        runKind: "execute_plan",
      }),
    ).toBe(false);
  });
});
