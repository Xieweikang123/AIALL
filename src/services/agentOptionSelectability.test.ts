import { describe, expect, it } from "vitest";
import { isAgentOptionSelectable } from "./agentOptionSelectability";

describe("isAgentOptionSelectable", () => {
  it("没有轮次在跑时一律可点（包括翻回看的旧回复）", () => {
    // 回归：旧规则是「只有列表里最后一条 Agent 消息能点」，用户翻回刚读完的
    // 那一轮想选它给的选项时按钮是灰的（实测被投诉）
    expect(isAgentOptionSelectable({})).toBe(true);
    expect(isAgentOptionSelectable({ messageRunning: false, sending: false })).toBe(true);
  });

  it("有轮次在跑时禁用（点了会打断正在跑的那一轮）", () => {
    expect(isAgentOptionSelectable({ sending: true })).toBe(false);
    expect(isAgentOptionSelectable({ messageRunning: true, sending: false })).toBe(false);
  });
});
