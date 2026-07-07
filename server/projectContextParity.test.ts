import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertMinimalProjectContextShape,
  MINIMAL_PROJECT_CONTEXT_KEYS,
} from "../shared/projectContextSchema";
import {
  buildMinimalProjectContextPayload,
  detectProjectStackProfile,
} from "./projectStackProfile";
import { buildTopLevelRouteEntries } from "./projectRouteContext";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = path.join(repoRoot, "src-tauri");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeParityFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiall-ctx-parity-"));
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, "src", "router"), { recursive: true });
  fs.mkdirSync(path.join(root, "src", "views"), { recursive: true });
  fs.mkdirSync(path.join(root, ".aiall", "skills"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      dependencies: { vue: "^3.5.0", "@tauri-apps/api": "^2.0.0" },
      devDependencies: { typescript: "^5.0.0" },
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "src/router/index.ts"),
    `{ path: '/demo', component: () => import('../views/DemoView.vue') }`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "src/views/DemoView.vue"),
    `<template><p class="desc">Demo page for parity</p></template>`,
    "utf8",
  );
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Agents guide\n", "utf8");
  fs.writeFileSync(path.join(root, ".aiall/project-memory.md"), "## 术语\nfoo\n", "utf8");
  fs.writeFileSync(
    path.join(root, ".aiall/skills/demo.md"),
    "---\nkind: fact\ntitle: Demo\n---\nDemo skill body\n",
    "utf8",
  );
  return root;
}

function normalizePayloadRoot<T extends { root: string }>(payload: T): T {
  return { ...payload, root: payload.root.replace(/\\/g, "/") };
}

function sortPayloadForParity(payload: ReturnType<typeof buildMinimalProjectContextPayload>) {
  return {
    ...payload,
    languages: [...payload.languages].sort(),
    runtimes: [...payload.runtimes].sort(),
    frameworks: [...payload.frameworks].sort(),
    capabilities: [...payload.capabilities].sort(),
    entryHints: [...payload.entryHints].sort(),
    routes: payload.routes.map((r) => ({ ...r })),
  };
}

describe("projectContext parity", () => {
  it("exports fixed schema keys", () => {
    expect(MINIMAL_PROJECT_CONTEXT_KEYS).toEqual([
      "root",
      "languages",
      "runtimes",
      "frameworks",
      "capabilities",
      "entryHints",
      "routes",
    ]);
  });

  it("Node payload satisfies fixed schema", async () => {
    const root = makeParityFixture();
    const routes = await buildTopLevelRouteEntries(root);
    const payload = sortPayloadForParity(
      normalizePayloadRoot(
        buildMinimalProjectContextPayload(
          root,
          detectProjectStackProfile(root),
          routes,
        ),
      ),
    );
    assertMinimalProjectContextShape(payload as Record<string, unknown>);
    expect(payload.frameworks).toContain("vue3");
    expect(payload.routes.length).toBeGreaterThan(0);
    expect(payload.routes[0]?.desc).toContain("Demo page");
  });

  it(
    "Node payload matches Rust on shared fixture",
    async () => {
    const root = makeParityFixture();
    const routes = await buildTopLevelRouteEntries(root);
    const payload = sortPayloadForParity(
      normalizePayloadRoot(
        buildMinimalProjectContextPayload(
          root,
          detectProjectStackProfile(root),
          routes,
        ),
      ),
    );
    fs.writeFileSync(
      path.join(root, "node-payload.json"),
      JSON.stringify(payload, null, 2),
      "utf8",
    );

    const result = spawnSync(
      "cargo",
      ["test", "parity_project_context_payload_from_env", "--quiet", "--", "--exact"],
      {
        cwd: tauriDir,
        env: { ...process.env, PARITY_FIXTURE_ROOT: root },
        shell: process.platform === "win32",
        encoding: "utf8",
      },
    );

    if (result.status !== 0) {
      throw new Error(
        `Rust parity test failed (exit ${result.status})\n${result.stdout}\n${result.stderr}`,
      );
    }
    expect(result.status).toBe(0);
    },
    120_000,
  );
});
