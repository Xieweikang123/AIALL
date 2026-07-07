import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertMinimalProjectContextShape,
} from "../shared/projectContextSchema";
import {
  buildMinimalProjectContextPayload,
  detectProjectStackProfile,
  formatMinimalProjectContextBlock,
  formatProjectStackProfileForPrompt,
  stackProfileHasDotNet,
} from "./projectStackProfile";

describe("projectStackProfile", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeRoot(init: (root: string) => void): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiall-stack-"));
    dirs.push(root);
    init(root);
    return root;
  }

  it("detects vue + tauri + node from package.json and src-tauri", () => {
    const root = makeRoot((r) => {
      fs.mkdirSync(path.join(r, "src-tauri"));
      fs.writeFileSync(
        path.join(r, "package.json"),
        JSON.stringify({
          dependencies: { vue: "^3.0.0", "@tauri-apps/api": "^2.0.0" },
          devDependencies: { typescript: "^5.0.0" },
        }),
        "utf8",
      );
    });
    const profile = detectProjectStackProfile(root);
    expect(profile.languages).toContain("typescript");
    expect(profile.frameworks).toContain("vue3");
    expect(profile.frameworks).toContain("tauri");
    expect(profile.runtimes).toContain("node");
    expect(profile.runtimes).toContain("desktop-shell");
  });

  it("detects dotnet + quartz from csproj", () => {
    const root = makeRoot((r) => {
      fs.writeFileSync(
        path.join(r, "App.csproj"),
        '<Project><ItemGroup><PackageReference Include="Quartz" Version="3.0.0" /></ItemGroup></Project>',
        "utf8",
      );
      fs.writeFileSync(path.join(r, "Program.cs"), "// entry", "utf8");
    });
    const profile = detectProjectStackProfile(root);
    expect(stackProfileHasDotNet(profile)).toBe(true);
    expect(profile.frameworks).toContain("quartz-net");
    expect(profile.capabilities).toContain("scheduled-tasks");
    expect(profile.entryHints).toContain("Program.cs");
  });

  it("detects node-cron scheduled-tasks capability", () => {
    const root = makeRoot((r) => {
      fs.writeFileSync(
        path.join(r, "package.json"),
        JSON.stringify({ dependencies: { "node-cron": "^3.0.0" } }),
        "utf8",
      );
    });
    const profile = detectProjectStackProfile(root);
    expect(profile.capabilities).toContain("scheduled-tasks");
    expect(stackProfileHasDotNet(profile)).toBe(false);
  });

  it("formats compact json block for prompt injection", () => {
    const block = formatMinimalProjectContextBlock("/tmp/demo", {
      languages: ["typescript"],
      runtimes: ["node"],
      frameworks: ["vue3"],
      capabilities: [],
      manifestFiles: ["package.json"],
      entryHints: [],
    });
    expect(block).toContain("【项目上下文】");
    expect(block).toContain('"frameworks"');
    expect(block).toContain("vue3");
    expect(block).toContain('"routes": []');
    expect(block).not.toContain("CronSchedule");
  });

  it("fixed schema always includes all array keys", () => {
    const payload = buildMinimalProjectContextPayload("/tmp/demo", {
      languages: [],
      runtimes: [],
      frameworks: [],
      capabilities: [],
      manifestFiles: [],
      entryHints: [],
    });
    assertMinimalProjectContextShape(payload as Record<string, unknown>);
    expect(Object.keys(payload).sort()).toEqual([
      "capabilities",
      "entryHints",
      "frameworks",
      "languages",
      "root",
      "routes",
      "runtimes",
    ]);
    expect(payload.routes).toEqual([]);
  });

  it("detects vue3 from package version", () => {
    const root = makeRoot((r) => {
      fs.writeFileSync(
        path.join(r, "package.json"),
        JSON.stringify({ dependencies: { vue: "^3.5.0" } }),
        "utf8",
      );
    });
    const profile = detectProjectStackProfile(root);
    expect(profile.frameworks).toContain("vue3");
  });

  it("detects aspnet-core from csproj", () => {
    const root = makeRoot((r) => {
      fs.writeFileSync(
        path.join(r, "App.csproj"),
        '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Microsoft.AspNetCore.OpenApi" Version="8.0.0" /></ItemGroup></Project>',
        "utf8",
      );
    });
    const profile = detectProjectStackProfile(root);
    expect(profile.frameworks).toContain("aspnet-core");
  });

  it("returns empty format block when no manifests", () => {
    const root = makeRoot(() => {});
    const profile = detectProjectStackProfile(root);
    expect(formatProjectStackProfileForPrompt(profile)).toBe("");
  });
});
