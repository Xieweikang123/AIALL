import { describe, expect, it } from "vitest";
import { parseClarificationChoices } from "./parseClarificationChoices";

describe("parseClarificationChoices", () => {
  it("parses multi-question bullet clarification into option groups", () => {
    const text = [
      "## 歧义术语澄清",
      "",
      "为准确规划，请先回答以下问题：",
      "",
      "**1. 你提到的「foo」具体指的是什么？**",
      "",
      "- Web 端三维可视化平台",
      "- 桌面建模软件对接",
      "- 专业 GIS 或 BIM 系统",
      "- 其他（请说明）",
      "",
      "**2. 主要需要通过 API 实现哪些功能？**",
      "",
      "- 查询模型元数据",
      "- 上传/下载模型文件",
      "- 控制场景对象状态",
    ].join("\n");

    const parsed = parseClarificationChoices(text);
    expect(parsed?.questions).toHaveLength(2);
    expect(parsed?.questions[0].options).toHaveLength(4);
    expect(parsed?.questions[1].options).toHaveLength(3);
    expect(parsed?.displayText).not.toContain("Web 端三维可视化平台");
    expect(parsed?.displayText).toContain("foo");
  });

  it("parses numbered options under each question", () => {
    const text = [
      "请确认 foo 的含义？",
      "",
      "**1. foo 指什么？**",
      "1. 外部业务系统",
      "2. 可视化前端",
      "3. 其他（请说明）",
    ].join("\n");

    const parsed = parseClarificationChoices(text);
    expect(parsed?.questions).toHaveLength(1);
    expect(parsed?.questions[0].options.map((o) => o.fullText)).toEqual([
      "外部业务系统",
      "可视化前端",
      "其他（请说明）",
    ]);
  });

  it("returns null when no question has enough options", () => {
    const text = [
      "**1. foo 是什么？**",
      "- 仅一个选项",
    ].join("\n");
    expect(parseClarificationChoices(text)).toBeNull();
  });
});
