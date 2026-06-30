import { describe, expect, it } from "vitest";
import { createWriteStage } from "./agentToolExecutor";
import {
  buildFinishGateRetryNudge,
  evaluateFinishGate,
  extractClaimedModifiedPaths,
  extractTaskContractAnchors,
  productiveWrittenPaths,
} from "./agentFinishGate";

describe("extractTaskContractAnchors", () => {
  it("extracts backtick identifiers and duration literals", () => {
    const anchors = extractTaskContractAnchors("使用 `Serilog`，同步间隔 30 分钟");
    expect(anchors).toContain("Serilog");
    expect(anchors.some((a) => /30/.test(a))).toBe(true);
  });

  it("skips source file paths", () => {
    expect(extractTaskContractAnchors("改 `src/foo.ts`")).toEqual([]);
  });
});

describe("extractClaimedModifiedPaths", () => {
  it("finds paths mentioned near modification verbs", () => {
    expect(
      extractClaimedModifiedPaths("已修改 src/services/sync.ts 的定时逻辑"),
    ).toEqual(["src/services/sync.ts"]);
  });

  it("ignores paths without modification context", () => {
    expect(extractClaimedModifiedPaths("请查看 src/services/sync.ts")).toEqual([]);
  });
});

describe("evaluateFinishGate", () => {
  it("blocks execute_plan when target files were not written", () => {
    const stage = createWriteStage();
    stage.files.set("src/other.ts", "export const x = 1;\n");
    stage.writtenList.push("src/other.ts");

    const result = evaluateFinishGate({
      rawContent: "已完成修改，刷新查看。",
      writeStage: stage,
      isReadOnlyAgent: false,
      isPlanExplore: false,
      readOnlyBuildRun: false,
      isExecutePlan: true,
      implementFollowUpRun: false,
      targetFiles: ["src/foo.ts"],
      taskPrompt: "执行方案",
    });

    expect(result.blocked).toBe(true);
    expect(result.violations.some((v) => v.code === "execute_plan_target_miss")).toBe(true);
  });

  it("blocks phantom file claims in the summary", () => {
    const stage = createWriteStage();
    stage.files.set("src/a.ts", "export const a = 1;\n");
    stage.writtenList.push("src/a.ts");

    const result = evaluateFinishGate({
      rawContent: "已更新 src/a.ts 与 src/b.ts。",
      writeStage: stage,
      isReadOnlyAgent: false,
      isPlanExplore: false,
      readOnlyBuildRun: false,
      isExecutePlan: false,
      implementFollowUpRun: false,
    });

    expect(result.blocked).toBe(true);
    expect(result.violations.some((v) => v.code === "phantom_file_claim")).toBe(true);
  });

  it("blocks when task anchors are missing from staged content", () => {
    const stage = createWriteStage();
    stage.files.set("src/logger.ts", "console.log('hello');\n");
    stage.writtenList.push("src/logger.ts");

    const result = evaluateFinishGate({
      rawContent: "修改已完成。",
      writeStage: stage,
      isReadOnlyAgent: false,
      isPlanExplore: false,
      readOnlyBuildRun: false,
      isExecutePlan: true,
      implementFollowUpRun: false,
      targetFiles: ["src/logger.ts"],
      taskPrompt: "接入 `Serilog`，间隔 30分钟",
    });

    expect(result.blocked).toBe(true);
    expect(result.violations.some((v) => v.code === "task_anchor_miss")).toBe(true);
  });

  it("passes when target files and anchors are satisfied", () => {
    const stage = createWriteStage();
    stage.files.set(
      "src/logger.ts",
      "using Serilog;\nvar interval = TimeSpan.FromMinutes(30);\n",
    );
    stage.writtenList.push("src/logger.ts");

    const result = evaluateFinishGate({
      rawContent: "已修改 src/logger.ts，Serilog 已接入。",
      writeStage: stage,
      isReadOnlyAgent: false,
      isPlanExplore: false,
      readOnlyBuildRun: false,
      isExecutePlan: true,
      implementFollowUpRun: false,
      targetFiles: ["src/logger.ts"],
      taskPrompt: "接入 `Serilog`，间隔 30分钟",
    });

    expect(result.blocked).toBe(false);
    expect(productiveWrittenPaths(stage)).toEqual(["src/logger.ts"]);
  });

  it("blocks when removal anchors still present in staged content", () => {
    const stage = createWriteStage();
    stage.files.set(
      "src/config.ts",
      "export const TargetSymbol = true;\nexport const Other = 1;\n",
    );
    stage.writtenList.push("src/config.ts");

    const taskPrompt = [
      "【用户意图·已解析】用户引用了上一轮助手总结或代码块，短句是对引用内容的修订（不是新任务）。",
      "操作：remove",
      "scope：scopeA",
      "目标符号：TargetSymbol",
      "用户补充：也移除",
    ].join("\n");

    const result = evaluateFinishGate({
      rawContent: "已完成修改。",
      writeStage: stage,
      isReadOnlyAgent: false,
      isPlanExplore: false,
      readOnlyBuildRun: false,
      isExecutePlan: false,
      implementFollowUpRun: false,
      taskPrompt,
    });

    expect(result.blocked).toBe(true);
    expect(result.violations.some((v) => v.code === "task_anchor_still_present")).toBe(true);
  });

  it("passes when removal anchors are absent from staged content", () => {
    const stage = createWriteStage();
    stage.files.set("src/config.ts", "export const Other = 1;\n");
    stage.writtenList.push("src/config.ts");

    const taskPrompt = [
      "【用户意图·已解析】用户引用了上一轮助手总结或代码块，短句是对引用内容的修订（不是新任务）。",
      "操作：remove",
      "scope：scopeA",
      "目标符号：TargetSymbol",
      "用户补充：也移除",
    ].join("\n");

    const result = evaluateFinishGate({
      rawContent: "已从 scopeA 移除 TargetSymbol。",
      writeStage: stage,
      isReadOnlyAgent: false,
      isPlanExplore: false,
      readOnlyBuildRun: false,
      isExecutePlan: false,
      implementFollowUpRun: false,
      taskPrompt,
    });

    expect(result.blocked).toBe(false);
  });

  it("does not require removed symbols to appear in diff (must_exclude)", () => {
    const stage = createWriteStage();
    stage.files.set("src/config.ts", "export const Other = 1;\n");
    stage.writtenList.push("src/config.ts");

    const result = evaluateFinishGate({
      rawContent: "修改已完成。",
      writeStage: stage,
      isReadOnlyAgent: false,
      isPlanExplore: false,
      readOnlyBuildRun: false,
      isExecutePlan: true,
      implementFollowUpRun: false,
      targetFiles: ["src/config.ts"],
      taskPrompt: "> Agent: scopeA：保留 TargetSymbol\n\n也移除",
    });

    expect(result.violations.some((v) => v.code === "task_anchor_miss")).toBe(false);
  });

  it("buildFinishGateRetryNudge includes violation details", () => {
    const nudge = buildFinishGateRetryNudge({
      blocked: true,
      violations: [{ code: "phantom_file_claim", detail: "总结声称已修改 src/b.ts" }],
    });
    expect(nudge).toContain("收尾门禁");
    expect(nudge).toContain("src/b.ts");
  });
});
