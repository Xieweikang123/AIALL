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

  it("turns implementation confirmations into interactive action buttons", () => {
    const text = "当前还没有点击放大逻辑。需要我实现吗？";
    const parsed = parseAiOptions(text);
    expect(parsed?.before).toBe(text);
    expect(parsed?.options).toEqual([
      {
        index: 0,
        label: "需要",
        fullText: "请实现上面提到的功能/修改",
        showIndex: false,
        action: "implement",
      },
      {
        index: 1,
        label: "不需要",
        fullText: "不需要，谢谢",
        showIndex: false,
      },
    ]);
  });

  it("handles variations like 需要我改吗？", () => {
    const text = "这是要改的代码。需要我改吗？";
    const parsed = parseAiOptions(text);
    expect(parsed?.before).toBe(text);
    expect(parsed?.options?.[0].label).toBe("需要");
    expect(parsed?.options?.[1].label).toBe("不需要");
  });

  it("does not create implementation action for ordinary explanations", () => {
    expect(parseAiOptions("当前还没有点击放大逻辑。")).toBeNull();
  });

  it("parses complete option blocks from partial streaming text", () => {
    const text = [
      "需要调整工具摘要展示吗？",
      "1. 隐藏/折叠工具摘要（不显示给用户）？",
      "2. 美化样式（如加边框、背景色区分）？",
    ].join("\n");
    const parsed = parseAiOptions(text);
    expect(parsed?.options).toHaveLength(2);
    expect(parsed?.before).toContain("需要调整");
  });

  it("handles markdown bold wrappers inside options", () => {
    const text = [
      "你想要哪种效果？",
      "1. **选项一**",
      "2. **选项二**",
    ].join("\n");
    const parsed = parseAiOptions(text);
    expect(parsed?.options).toHaveLength(2);
    expect(parsed?.options?.[0].label).toBe("选项一");
    expect(parsed?.options?.[1].label).toBe("选项二");
  });

  it("allows options without question marks if preceded by a question prompt", () => {
    const text = [
      "你想用什么语言？请选择：",
      "1. TypeScript",
      "2. JavaScript",
    ].join("\n");
    const parsed = parseAiOptions(text);
    expect(parsed?.options).toHaveLength(2);
    expect(parsed?.options?.[0].label).toBe("TypeScript");
    expect(parsed?.options?.[1].label).toBe("JavaScript");
  });

  it("does not treat architecture review summaries as interactive options", () => {
    const text = [
      "总结",
      "",
      "项目在架构设计和 Rust 迁移上做得很扎实，核心建议集中在：",
      "",
      "1. **巩固 parity 机制**——prompt、常量、行为的 TS↔Rust 一致性校验要更强",
      "2. **server/ 目录做最终清理规划**——明确哪些保留、哪些废弃",
      "3. **增加集成级测试**——单元测试已好，但完整 Agent 循环的端到端测试还有空间",
      "4. **关注编排代码的长期卫生**——定期扫描 Tier 1/2 是否被业务话术污染",
      "",
      "结论清晰了。以下是最终答案：",
    ].join("\n");
    expect(parseAiOptions(text)).toBeNull();
  });

  it("does not treat prose mentioning 你希望 as a choice prompt", () => {
    const text = [
      "如果你希望继续深化，核心建议集中在：",
      "",
      "1. **选项 A**",
      "2. **选项 B**",
    ].join("\n");
    expect(parseAiOptions(text)).toBeNull();
  });

  it("supports multiple list prefixes like letters and brackets", () => {
    const text1 = [
      "你想怎么处理？",
      "A. 方式一",
      "B. 方式二",
    ].join("\n");
    const parsed1 = parseAiOptions(text1);
    expect(parsed1?.options).toHaveLength(2);
    expect(parsed1?.options?.[0].label).toBe("方式一");
    expect(parsed1?.options?.[1].label).toBe("方式二");

    const text2 = [
      "请问你想选择？",
      "[1] TypeScript",
      "[2] JavaScript",
    ].join("\n");
    const parsed2 = parseAiOptions(text2);
    expect(parsed2?.options).toHaveLength(2);
    expect(parsed2?.options?.[0].label).toBe("TypeScript");
    expect(parsed2?.options?.[1].label).toBe("JavaScript");
  });
});
