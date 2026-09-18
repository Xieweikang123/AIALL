import { describe, expect, it } from "vitest";
import {
  SESSION_GOAL_MAX_CHARS,
  compressSessionGoal,
  repairTruncatedSessionGoal,
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

  it("keeps typical one-line demands within the default cap without clipping", () => {
    const demand =
      "选中内容 /// 状态:0 待处理 1 已处理 2 已拒绝 3 草稿 4 待补发 5 已结束 6 待厂家回复 7 内部等处理 10 已删除 11 已关闭";
    expect(demand.length).toBeLessThanOrEqual(SESSION_GOAL_MAX_CHARS);
    expect(compressSessionGoal(demand)).toBe(demand);
  });

  it("repairs a goal clipped under an older shorter cap", () => {
    const full =
      "选中内容 /// 状态:0 待处理 1 已处理 2 已拒绝 3 草稿 4 待补发 5 已结束 6 待厂家回复 7 内部等处理 10 已删除 11 已关闭";
    const clipped = `${full.slice(0, 79)}…`;
    expect(
      repairTruncatedSessionGoal({
        existingGoal: clipped,
        userPrompts: [full, "改吧"],
      }),
    ).toBe(full);
  });

  it("keeps short clear prompts intact", () => {
    expect(compressSessionGoal("修复粘贴图片上传")).toBe("修复粘贴图片上传");
  });

  it("does not refresh when clarification is needed without understanding", () => {
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

  it("refreshes clarification turns when understanding explains the gap", () => {
    expect(
      resolveSessionGoalUpdate({
        prompt: "帮我改一下",
        needsClarification: true,
        existingGoal: "修复上传",
        understanding: "意图不清：未指明要改的对象或文件",
      }),
    ).toBe("意图不清：未指明要改的对象或文件");
  });

  it("prefers classifier understanding over raw prompt compress", () => {
    const prompt =
      "选中内容 /// 状态:0 待处理 1 已处理 2 已拒绝 3 草稿 4 待补发 5 已结束 6 待厂家回复 7 内部等处理 10 已删除";
    expect(
      resolveSessionGoalUpdate({
        prompt,
        needsClarification: false,
        understanding: "为选中内容补充状态枚举含义说明",
      }),
    ).toBe("为选中内容补充状态枚举含义说明");
  });

  it("does not refresh on confirmation-only continuations even with understanding", () => {
    expect(
      shouldRefreshSessionGoal({
        prompt: "改吧",
        existingGoal: "修复上传",
        understanding: "确认执行上文修改",
      }),
    ).toBe(false);
    expect(
      resolveSessionGoalUpdate({
        prompt: "改吧",
        existingGoal: "修复上传",
        understanding: "确认执行上文修改",
      }),
    ).toBeUndefined();
  });

  it("falls back to prompt compress when understanding is missing", () => {
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

  it("never refreshes from auto-resume system prompts", () => {
    const resume =
      "【自动续跑】上次运行因连接中断而暂停。请从断点继续完成原始任务，不要重复已完成的工具步骤或已写入的修改。\n\n原始任务（摘要）：\n修复粘贴图片上传";
    expect(shouldRefreshSessionGoal({ prompt: resume, existingGoal: "修复粘贴图片上传" })).toBe(false);
    expect(resolveSessionGoalUpdate({ prompt: resume, existingGoal: "修复粘贴图片上传" })).toBeUndefined();
    expect(
      resolveSessionGoalUpdate({
        prompt: resume,
        needsClarification: false,
      }),
    ).toBeUndefined();
  });
});
