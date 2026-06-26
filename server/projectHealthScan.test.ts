import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCodeReviewPrompt } from "../shared/projectHealthScan";
import { scanProjectHealth } from "./projectHealthScan";

describe("projectHealthScan", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeProject(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiall-health-"));
    dirs.push(root);
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
    }
    return root;
  }

  it("detects TODO markers as debt", async () => {
    const root = makeProject({
      "src/app.ts": "// TODO: fix later\nexport const ok = true;\n",
    });
    const result = await scanProjectHealth(root);
    expect(result.issues.some((i) => i.pattern === "debt-marker" && i.category === "debt")).toBe(true);
  });

  it("detects empty catch as smell", async () => {
    const root = makeProject({
      "src/app.ts": "try { x(); } catch (e) {}\n",
    });
    const result = await scanProjectHealth(root);
    expect(result.issues.some((i) => i.pattern === "smell-empty-catch")).toBe(true);
  });

  it("detects @ts-ignore as smell", async () => {
    const root = makeProject({
      "src/app.ts": "// @ts-ignore\nconst x = 1;\n",
    });
    const result = await scanProjectHealth(root);
    expect(result.issues.some((i) => i.pattern === "smell-ts-ignore")).toBe(true);
  });

  it("detects eval as security error", async () => {
    const root = makeProject({
      "src/app.ts": "eval('1+1');\n",
    });
    const result = await scanProjectHealth(root);
    const hit = result.issues.find((i) => i.pattern === "security-eval");
    expect(hit?.severity).toBe("error");
    expect(hit?.category).toBe("security");
  });

  it("excludes console.log in test files", async () => {
    const root = makeProject({
      "src/app.test.ts": "console.log('test');\n",
      "src/app.ts": "export const ok = true;\n",
    });
    const result = await scanProjectHealth(root);
    expect(result.issues.some((i) => i.file === "src/app.test.ts")).toBe(false);
  });

  it("detects console.log in source as debug", async () => {
    const root = makeProject({
      "src/app.ts": "console.log('debug');\n",
    });
    const result = await scanProjectHealth(root);
    expect(result.issues.some((i) => i.pattern === "debug-console")).toBe(true);
  });

  it("buildCodeReviewPrompt includes grep hits as priority list", async () => {
    const root = makeProject({
      "src/app.ts": "eval('bad');\n",
    });
    const result = await scanProjectHealth(root);
    const prompt = buildCodeReviewPrompt(result);
    expect(prompt).toContain("只读代码审查");
    expect(prompt).toContain("优先核查清单");
    expect(prompt).toContain("动态代码执行");
  });

  it("buildCodeReviewPrompt asks for broad review when no hits", async () => {
    const root = makeProject({
      "src/app.ts": "export const ok = true;\n",
    });
    const result = await scanProjectHealth(root);
    const prompt = buildCodeReviewPrompt(result);
    expect(prompt).toContain("未发现常见坏味道");
    expect(prompt).toContain("广覆盖审查");
  });
});
