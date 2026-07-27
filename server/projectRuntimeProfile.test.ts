import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectProjectRuntimeProfile } from "./projectRuntimeProfile";

describe("projectRuntimeProfile", () => {
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

  it("detects desktop shell and dev scripts (split web + tauri:dev)", () => {
    const root = makeProject({ dev: "vite", "tauri:dev": "tauri dev" });
    const profile = detectProjectRuntimeProfile(root);
    expect(profile.hasDesktopShell).toBe(true);
    expect(profile.hasDotNetProject).toBe(false);
    expect(profile.webDevScript).toBe("npm run dev");
    expect(profile.desktopDevScript).toBe("npm run tauri:dev");
  });

  it("detects desktop shell when dev runs tauri and dev:web serves vite", () => {
    const root = makeProject({ dev: "tauri dev", "dev:web": "vite" });
    const profile = detectProjectRuntimeProfile(root);
    expect(profile.hasDesktopShell).toBe(true);
    expect(profile.webDevScript).toBe("npm run dev:web");
    expect(profile.desktopDevScript).toBe("npm run dev");
  });

  it("detects web-only projects without desktop shell", () => {
    const root = makeProject({ dev: "vite" }, false);
    expect(detectProjectRuntimeProfile(root).hasDesktopShell).toBe(false);
  });

  it("detects dotnet project from csproj at repo root", () => {
    const root = makeProject({ dev: "vite" }, false);
    fs.writeFileSync(path.join(root, "App.csproj"), "<Project></Project>", "utf8");
    expect(detectProjectRuntimeProfile(root).hasDotNetProject).toBe(true);
  });

  it("detects verify script from package.json scripts", () => {
    const withTypecheck = makeProject({ typecheck: "vue-tsc --noEmit", build: "vite build" }, false);
    expect(detectProjectRuntimeProfile(withTypecheck).verifyScript).toBe("npm run typecheck");

    const withLint = makeProject({ lint: "eslint .", build: "vite build" }, false);
    expect(detectProjectRuntimeProfile(withLint).verifyScript).toBe("npm run lint");

    const withVueTscBuild = makeProject({ build: "vue-tsc --noEmit && vite build" }, false);
    expect(detectProjectRuntimeProfile(withVueTscBuild).verifyScript).toBe("npx vue-tsc --noEmit");

    const withTestOnly = makeProject({ test: "vitest run" }, false);
    expect(detectProjectRuntimeProfile(withTestOnly).verifyScript).toBe("npm run test");

    const withPipeline = makeProject(
      { typecheck: "vue-tsc --noEmit", lint: "eslint .", test: "vitest run" },
      false,
    );
    expect(detectProjectRuntimeProfile(withPipeline).verifyScripts).toEqual([
      "npm run typecheck",
      "npm run lint",
      "npm run test",
    ]);
  });
});
