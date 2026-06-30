import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runProjectVerify } from "./projectVerifyRun";
import * as projectShell from "./projectShell";

describe("projectVerifyRun", () => {
  const dirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeProject(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiall-verify-"));
    dirs.push(root);
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
    }
    return root;
  }

  it("skips when no verify script in package.json", async () => {
    const root = makeProject({
      "package.json": JSON.stringify({ name: "x", scripts: { dev: "vite" } }),
    });
    const result = await runProjectVerify(root);
    expect(result.skipped).toBe(true);
    expect(result.command).toBe("");
  });

  it("runs npm test when defined", async () => {
    const root = makeProject({
      "package.json": JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" } }),
    });
    vi.spyOn(projectShell, "runProjectShellCommand").mockResolvedValue({
      ok: true,
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      timedOut: false,
    });
    const result = await runProjectVerify(root);
    expect(result.command).toBe("npm run test");
    expect(result.exitCode).toBe(0);
    expect(result.failingFiles).toEqual([]);
  });

  it("extracts failing files from output", async () => {
    const root = makeProject({
      "package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
    });
    vi.spyOn(projectShell, "runProjectShellCommand").mockResolvedValue({
      ok: false,
      exitCode: 1,
      stdout: "FAIL src/foo.test.ts > case",
      stderr: "at src/foo.test.ts:12:3",
      timedOut: false,
    });
    const result = await runProjectVerify(root);
    expect(result.failingFiles).toContain("src/foo.test.ts");
  });
});
