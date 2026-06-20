import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildRuntimeAwarenessHint, detectProjectRuntimeProfile } from "./agentRuntimeHint";

describe("agentRuntimeHint", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeProject(pkgScripts: Record<string, string>, withTauri = true): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiall-runtime-"));
    dirs.push(root);
    fs.mkdirSync(path.join(root, "src-tauri"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: pkgScripts }, null, 2),
      "utf8",
    );
    if (!withTauri) {
      fs.rmSync(path.join(root, "src-tauri"), { recursive: true, force: true });
    }
    return root;
  }

  it("detects desktop shell and dev scripts", () => {
    const root = makeProject({ dev: "vite", "tauri:dev": "tauri dev" });
    const profile = detectProjectRuntimeProfile(root);
    expect(profile.hasDesktopShell).toBe(true);
    expect(profile.webDevScript).toBe("npm run dev");
    expect(profile.desktopDevScript).toBe("npm run tauri:dev");
  });

  it("returns empty hint for web-only projects", () => {
    const root = makeProject({ dev: "vite" }, false);
    expect(buildRuntimeAwarenessHint(detectProjectRuntimeProfile(root))).toBe("");
  });

  it("builds runtime awareness hint for desktop shell projects", () => {
    const root = makeProject({ dev: "vite", "tauri:dev": "tauri dev" });
    const hint = buildRuntimeAwarenessHint(detectProjectRuntimeProfile(root));
    expect(hint).toContain("桌面壳");
    expect(hint).toContain("npm run dev");
    expect(hint).toContain("npm run tauri:dev");
    expect(hint).toContain("降级");
  });
});
