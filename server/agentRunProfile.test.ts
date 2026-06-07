import { describe, expect, it } from "vitest";
import {
  checkToolAllowed,
  createRunToolPolicy,
  formatTargetFileManifest,
} from "./agentRunProfile";

describe("createRunToolPolicy", () => {
  it("scopes execute_plan reads to validated targets", () => {
    const policy = createRunToolPolicy(
      { kind: "execute_plan", targetFiles: ["src/a.ts"] },
      [{ requested: "src/a.ts", status: "ok", resolved: "src/a.ts", lines: 120 }],
    );
    expect(policy.allowExplore).toBe(false);
    expect(policy.targetFiles.has("src/a.ts")).toBe(true);
    expect(checkToolAllowed("read_file", { path: "src/b.ts" }, policy, { readFileCalls: 0 })).toContain(
      "只能读取",
    );
    expect(checkToolAllowed("read_file", { path: "src/a.ts" }, policy, { readFileCalls: 0 })).toBeNull();
    expect(checkToolAllowed("grep", { pattern: "foo" }, policy, { readFileCalls: 0 })).toContain("禁止");
  });
});

describe("formatTargetFileManifest", () => {
  it("marks missing files and suggestions", () => {
    const text = formatTargetFileManifest([
      { requested: "src/views/AiAssistantView.vue", status: "missing", suggestions: ["src/views/VibeCodingView.vue"] },
      { requested: "src/a.ts", status: "ok", resolved: "src/a.ts", lines: 40 },
    ]);
    expect(text).toContain("AiAssistantView.vue");
    expect(text).toContain("VibeCodingView.vue");
    expect(text).toContain("✓ src/a.ts");
  });
});
