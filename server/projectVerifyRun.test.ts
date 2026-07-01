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
    expect(result.ok).toBe(true);
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
    expect(result.ok).toBe(true);
    expect(result.failingFiles).toEqual([]);
    expect(result.verifyCommands).toEqual(["npm run test"]);
  });

  it("marks ok false when shell command fails", async () => {
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
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.failingFiles).toContain("src/foo.test.ts");
  });

  it("runs verify scripts in order and stops on first failure", async () => {
    const root = makeProject({
      "package.json": JSON.stringify({
        scripts: {
          typecheck: "vue-tsc --noEmit",
          lint: "eslint .",
          test: "vitest run",
        },
      }),
    });
    const run = vi.spyOn(projectShell, "runProjectShellCommand");
    run.mockResolvedValueOnce({
      ok: true,
      exitCode: 0,
      stdout: "types ok",
      stderr: "",
      timedOut: false,
    });
    run.mockResolvedValueOnce({
      ok: false,
      exitCode: 1,
      stdout: "lint failed",
      stderr: "",
      timedOut: false,
    });

    const result = await runProjectVerify(root);
    expect(run).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.steps).toHaveLength(2);
    expect(result.steps?.[0]?.ok).toBe(true);
    expect(result.steps?.[1]?.ok).toBe(false);
    expect(result.verifyCommands).toEqual(["npm run typecheck", "npm run lint", "npm run test"]);
    expect(result.command).toBe("npm run typecheck → npm run lint");
  });
});
