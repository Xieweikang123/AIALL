import { describe, expect, it } from "vitest";
import { parseAiOptions } from "./parseAiOptions";

describe("parseAiOptions", () => {
  it("detects trailing choice prompts ending with question marks", () => {
    const text = [
      "需要调整工具摘要展示吗？",
      "1. 隐藏/折叠工具摘要（不显示给用户）？",
      "2. 美化样式（如加边框、背景色区分）？",
    ].join("\n");
    const parsed = parseAiOptions(text);
    expect(parsed?.options).toHaveLength(2);
    expect(parsed?.before).toContain("需要调整");
  });

  it("does not treat doc numbered lists as interactive options", () => {
    const text = [
      "## 五、特殊注意事项",
      "",
      "1. **快递单号对应多条记录时**：系统会返回错误提示，要求技术人员手动修改",
      "2. **拦截工单**：与退款工单处理逻辑相同，都会将订单汇总表状态改为1",
      "3. **时间记录**：每次修改都会更新订单汇总表的 `updateTime` 字段",
      "",
      "**总结**：工单处理修改订单汇总表主要发生在**工单状态变为已处理**时。",
    ].join("\n");
    expect(parseAiOptions(text)).toBeNull();
  });

  it("turns implementation confirmations into a single action button", () => {
    const text = "当前还没有点击放大逻辑。需要我实现吗？";
    const parsed = parseAiOptions(text);
    expect(parsed?.before).toBe(text);
    expect(parsed?.options).toEqual([
      {
        index: 0,
        label: "实现",
        fullText: "请实现上面提到的功能/修改",
        showIndex: false,
        action: "implement",
      },
    ]);
  });

  it("does not create implementation action for ordinary explanations", () => {
    expect(parseAiOptions("当前还没有点击放大逻辑。")).toBeNull();
  });
});
