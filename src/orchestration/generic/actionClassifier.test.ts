import { describe, expect, it } from "vitest";
import {
  classifyUserAction,
  isConsultativeRootAction,
} from "./actionClassifier";

describe("isConsultativeRootAction", () => {
  it("detects trailing 是啥 without question mark", () => {
    expect(isConsultativeRootAction("当前项目测试接口是啥")).toBe(true);
  });

  it("detects leading explain verb", () => {
    expect(isConsultativeRootAction("解释这个项目是做什么的")).toBe(true);
  });

  it("rejects explicit implement intent", () => {
    expect(isConsultativeRootAction("帮我把输入框改成可聚焦")).toBe(false);
  });

  it("rejects empty prompt", () => {
    expect(isConsultativeRootAction("")).toBe(false);
  });
});

describe("classifyUserAction", () => {
  it("returns consultative for inquiry root verb", () => {
    expect(classifyUserAction("当前项目测试接口是啥")).toBe("consultative");
  });

  it("returns implement when change verb present", () => {
    expect(classifyUserAction("帮我把输入框改成可聚焦")).toBe("implement");
  });

  it("returns neutral for ambiguous short text", () => {
    expect(classifyUserAction("这个组件怎么回事")).toBe("neutral");
  });
});
