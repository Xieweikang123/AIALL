import { describe, expect, it } from "vitest";
import {
  applyAnnotationsToDocument,
  buildExplainNodePrompt,
  parseCodeMapAnnotations,
} from "./codeMapAnnotate";
import type { CodeMapDocument } from "./codeMapTypes";

const sampleDoc: CodeMapDocument = {
  schemaVersion: 1,
  projectRoot: "/tmp/demo",
  generatedAt: "2026-01-01T00:00:00.000Z",
  nodes: [
    { id: "mod:src", kind: "module", label: "src", path: "src" },
    { id: "entry:src/main.ts", kind: "entry", label: "main.ts", path: "src/main.ts" },
  ],
  edges: [],
};

describe("parseCodeMapAnnotations", () => {
  it("parses raw json object", () => {
    const parsed = parseCodeMapAnnotations('{"mod:src":"前端源码","entry:src/main.ts":"应用入口"}');
    expect(parsed).toEqual({
      "mod:src": "前端源码",
      "entry:src/main.ts": "应用入口",
    });
  });

  it("parses fenced json and truncates long summaries", () => {
    const long = "x".repeat(80);
    const parsed = parseCodeMapAnnotations(`\`\`\`json\n{"mod:src":"${long}"}\n\`\`\``);
    expect(parsed?.["mod:src"]?.length).toBe(40);
  });
});

describe("applyAnnotationsToDocument", () => {
  it("merges summaries by node id", () => {
    const next = applyAnnotationsToDocument(sampleDoc, { "mod:src": "模块根" });
    expect(next.nodes[0].summary).toBe("模块根");
    expect(next.nodes[1].summary).toBeUndefined();
  });
});

describe("buildExplainNodePrompt", () => {
  it("includes path and asks for evidence", () => {
    const prompt = buildExplainNodePrompt(sampleDoc.nodes[1]);
    expect(prompt).toContain("src/main.ts");
    expect(prompt).toContain("勿凭猜测");
  });
});
