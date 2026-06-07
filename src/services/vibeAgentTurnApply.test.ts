import { describe, expect, it } from "vitest";
import {
  formatPendingApprovalLabel,
  isDeleteNotFoundError,
  resolveAgentDoneFileAction,
} from "./vibeAgentTurnApply";

describe("isDeleteNotFoundError", () => {
  it("matches Chinese not-found messages from the delete API", () => {
    expect(isDeleteNotFoundError("文件或目录不存在")).toBe(true);
  });

  it("matches common English not-found messages", () => {
    expect(isDeleteNotFoundError("ENOENT: no such file")).toBe(true);
    expect(isDeleteNotFoundError("Not Found")).toBe(true);
  });

  it("does not treat other failures as already deleted", () => {
    expect(isDeleteNotFoundError("路径超出项目根目录")).toBe(false);
    expect(isDeleteNotFoundError("删除失败")).toBe(false);
    expect(isDeleteNotFoundError(undefined)).toBe(false);
  });
});

describe("resolveAgentDoneFileAction", () => {
  const diffs = ["src/a.ts", "src/b.ts"];

  it("reports server-written files on normal completion", () => {
    expect(
      resolveAgentDoneFileAction({
        chatMode: "build",
        wasAborted: false,
        serverPendingFiles: [],
        serverWrittenFiles: diffs,
        turnFileDiffPaths: diffs,
      }),
    ).toEqual({ autoApply: false, pendingApproval: false, writtenFiles: diffs });
  });

  it("does not prompt for approval when build mode was stopped mid-run", () => {
    expect(
      resolveAgentDoneFileAction({
        chatMode: "build",
        wasAborted: true,
        serverPendingFiles: [],
        serverWrittenFiles: diffs,
        turnFileDiffPaths: diffs,
      }),
    ).toEqual({ autoApply: false, pendingApproval: false, writtenFiles: diffs });
  });

  it("falls back to turn diffs when server writtenFiles are empty", () => {
    expect(
      resolveAgentDoneFileAction({
        chatMode: "build",
        wasAborted: true,
        serverPendingFiles: [],
        serverWrittenFiles: [],
        turnFileDiffPaths: ["lib/x.ts"],
      }),
    ).toEqual({ autoApply: false, pendingApproval: false, writtenFiles: ["lib/x.ts"] });
  });

  it("does not report written files without changes", () => {
    expect(
      resolveAgentDoneFileAction({
        chatMode: "build",
        wasAborted: false,
        serverPendingFiles: [],
        serverWrittenFiles: [],
        turnFileDiffPaths: [],
      }),
    ).toEqual({ autoApply: false, pendingApproval: false, writtenFiles: undefined });
  });
});

describe("formatPendingApprovalLabel", () => {
  it("describes mixed changes", () => {
    expect(
      formatPendingApprovalLabel({
        "a.ts": { deleted: true },
        "b.ts": {},
      }),
    ).toBe("待确认 1 个文件删除、1 个文件修改");
  });

  it("prefixes stopped runs", () => {
    expect(formatPendingApprovalLabel({ "a.ts": {} }, true)).toBe("已停止 · 1 个文件修改");
  });
});
