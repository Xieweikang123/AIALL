import { describe, expect, it } from "vitest";
import {
  findToolMarkupStart,
  hasTextToolCallMarkup,
  parseTextToolCallsFromContent,
  stripTextToolCallMarkup,
  TextToolCallStreamFilter,
} from "./textToolCallMarkup";

const INVOKE_SAMPLE = [
  "黄色确实没有生效，Plan 仍然是蓝色。让我找到正确的组件位置重新修改。",
  "<function_calls>",
  '<invoke name="grep">',
  '<parameter name="pattern">plan',
  "</parameter>",
  "</invoke>",
  "</function_calls>",
].join("\n");

describe("stripTextToolCallMarkup", () => {
  it("strips anthropic-style function_calls blocks", () => {
    expect(stripTextToolCallMarkup(INVOKE_SAMPLE)).toBe(
      "黄色确实没有生效，Plan 仍然是蓝色。让我找到正确的组件位置重新修改。",
    );
  });

  it("strips trailing inline tool_call tag", () => {
    expect(stripTextToolCallMarkup("继续排查。<tool_call>")).toBe("继续排查。");
  });

  it("strips legacy function= markup", () => {
    expect(stripTextToolCallMarkup("说明\n<function=grep>\n<parameter=pattern>plan")).toBe("说明");
  });

  it("strips tool_invocation blocks with inline JSON arguments", () => {
    const sample = [
      "我来修改样式。",
      '<tool_invocation name="patch_file" arguments={"path":"src/components/vibe/AutoBugFixPanel.vue","old_string":"foo","new_string":"bar"}>',
    ].join("\n");
    expect(stripTextToolCallMarkup(sample)).toBe("我来修改样式。");
  });
});

describe("hasTextToolCallMarkup", () => {
  it("detects invoke markup", () => {
    expect(hasTextToolCallMarkup(INVOKE_SAMPLE)).toBe(true);
    expect(hasTextToolCallMarkup("普通回答")).toBe(false);
  });
});

describe("findToolMarkupStart", () => {
  it("finds earliest markup token", () => {
    const idx = findToolMarkupStart(INVOKE_SAMPLE);
    expect(INVOKE_SAMPLE.slice(idx, idx + 16)).toBe("<function_calls>");
  });
});

describe("parseTextToolCallsFromContent", () => {
  it("parses invoke blocks with named parameters", () => {
    expect(parseTextToolCallsFromContent(INVOKE_SAMPLE)).toEqual([
      { name: "grep", args: { pattern: "plan" } },
    ]);
  });

  it("parses read_file invoke with path and limit", () => {
    const content = [
      "<function_calls>",
      '<invoke name="read_file">',
      '<parameter name="path">src/components/vibe/AgentModeSwitch.vue',
      '<parameter name="limit">120',
      "</invoke>",
      "</function_calls>",
    ].join("\n");
    expect(parseTextToolCallsFromContent(content)).toEqual([
      {
        name: "read_file",
        args: { path: "src/components/vibe/AgentModeSwitch.vue", limit: "120" },
      },
    ]);
  });

  it("parses tool_invocation blocks with JSON arguments", () => {
    const content =
      '<tool_invocation name="patch_file" arguments={"path":"src/foo.vue","old_string":"a","new_string":"b"}>';
    expect(parseTextToolCallsFromContent(content)).toEqual([
      { name: "patch_file", args: { path: "src/foo.vue", old_string: "a", new_string: "b" } },
    ]);
  });
});

describe("TextToolCallStreamFilter", () => {
  it("stops streaming once invoke markup begins", () => {
    const filter = new TextToolCallStreamFilter();
    expect(filter.push("说明文字")).toBe("说明文字");
    expect(filter.push("<function_calls>")).toBe("");
    expect(filter.getVisibleText()).toBe("说明文字");
  });

  it("holds back partial tool_invocation tag until complete", () => {
    const filter = new TextToolCallStreamFilter();
    expect(filter.push("说明")).toBe("说明");
    expect(filter.push("<tool_inv")).toBe("");
    expect(filter.push('ocation name="grep" arguments={"pattern":"plan"}>')).toBe("");
    expect(filter.getVisibleText()).toBe("说明");
  });

  it("does not leak tool_invocation prefix while tag streams char by char", () => {
    const filter = new TextToolCallStreamFilter();
    expect(filter.push("我来修改。")).toBe("我来修改。");
    const tag =
      '<tool_invocation name="patch_file" arguments={"path":"src/foo.vue","old_string":"a","new_string":"b"}>';
    for (const ch of tag) {
      expect(filter.push(ch)).toBe("");
    }
    expect(filter.getVisibleText()).toBe("我来修改。");
  });
});
