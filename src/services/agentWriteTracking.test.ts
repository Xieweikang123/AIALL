import { describe, expect, it } from "vitest";
import {
  collectSuccessfulWritePathsFromTools,
  isSuccessfulWriteToolSummary,
  mergeWrittenFilePaths,
  resolveCumulativeWrittenFiles,
  resolveTaskWrittenFilesForResume,
} from "./agentWriteTracking";

describe("agentWriteTracking", () => {
  it("collects paths from successful write tools", () => {
    expect(
      collectSuccessfulWritePathsFromTools([
        {
          name: "patch_file",
          ok: true,
          summary: "已修改 src/views/VibeCodingView.vue",
          args: { path: "src/views/VibeCodingView.vue" },
        },
        {
          name: "patch_file",
          ok: false,
          summary: "old_string 未出现在已读片段中",
          args: { path: "src/foo.ts" },
        },
        {
          name: "grep",
          ok: true,
          summary: "找到 3 处匹配",
          args: { pattern: "foo" },
        },
      ]),
    ).toEqual(["src/views/VibeCodingView.vue"]);
  });

  it("merges resume segment writes across sources", () => {
    expect(
      resolveCumulativeWrittenFiles({
        priorWrittenFiles: ["src/views/VibeCodingView.vue"],
        tools: [
          {
            name: "patch_file",
            ok: true,
            summary: "已修改 src/components/vibe/AutoBugFixPanel.vue",
            args: { path: "src/components/vibe/AutoBugFixPanel.vue" },
          },
        ],
        serverWrittenFiles: ["src/components/vibe/AutoBugFixPanel.vue"],
      }),
    ).toEqual(["src/views/VibeCodingView.vue", "src/components/vibe/AutoBugFixPanel.vue"]);
  });

  it("deduplicates normalized paths", () => {
    expect(
      mergeWrittenFilePaths(
        ["src\\a.ts"],
        ["src/a.ts"],
        ["src/a.ts"],
      ),
    ).toEqual(["src/a.ts"]);
  });

  it("resolveTaskWrittenFilesForResume prefers tool history over stale writtenFiles", () => {
    expect(
      resolveTaskWrittenFilesForResume({
        writtenFiles: ["src/components/vibe/AutoBugFixPanel.vue"],
        tools: [
          {
            name: "patch_file",
            ok: true,
            summary: "已修改 src/views/VibeCodingView.vue",
            args: { path: "src/views/VibeCodingView.vue" },
          },
          {
            name: "patch_file",
            ok: true,
            summary: "已修改 src/components/vibe/AutoBugFixPanel.vue",
            args: { path: "src/components/vibe/AutoBugFixPanel.vue" },
          },
        ],
      }),
    ).toEqual(["src/components/vibe/AutoBugFixPanel.vue", "src/views/VibeCodingView.vue"]);
  });

  it("rejects error-like write summaries", () => {
    expect(isSuccessfulWriteToolSummary("错误：缺少 path")).toBe(false);
    expect(isSuccessfulWriteToolSummary("已修改 src/foo.ts")).toBe(true);
  });
});
