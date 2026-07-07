import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildTopLevelRouteEntries,
  extractTopLevelRoutes,
  extractVuePageDescription,
  stripHtmlToPlainText,
} from "./projectRouteContext";

const FIXTURE_ROUTER = `
const routes = [
  { path: "/", redirect: "/home" },
  {
    path: "/chat",
    name: "Chat",
    component: ChatView,
  },
  {
    path: "/feature",
    component: () => import("../views/FeatureView.vue"),
  },
];
`;

describe("projectRouteContext", () => {
  it("extracts top-level routes from router source", () => {
    const routes = extractTopLevelRoutes(FIXTURE_ROUTER);
    expect(routes.map((r) => r.path)).toEqual(["/chat", "/feature"]);
    expect(routes[0]?.componentRef).toBe("ChatView");
    expect(routes[1]?.componentRef).toContain("FeatureView.vue");
  });

  it("resolves ../views import relative to src/router", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiall-route-resolve-"));
    try {
      fs.mkdirSync(path.join(root, "src", "router"), { recursive: true });
      fs.mkdirSync(path.join(root, "src", "views"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "src/router/index.ts"),
        `{ path: '/x', component: () => import('../views/XView.vue') }`,
        "utf8",
      );
      fs.writeFileSync(
        path.join(root, "src/views/XView.vue"),
        `<template><p class="desc">X page</p></template>`,
        "utf8",
      );
      const entries = await buildTopLevelRouteEntries(root);
      expect(entries[0]?.desc).toBe("X page");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("extracts vue page description from template", () => {
    const desc = extractVuePageDescription(
      '<template><p class="desc">支持 <code>总结 + URL</code> 抓取。</p></template>',
    );
    expect(desc).toContain("总结");
    expect(desc).not.toContain("<code>");
  });

  it("stripHtmlToPlainText removes tags", () => {
    expect(stripHtmlToPlainText("<strong>hello</strong> world")).toBe("hello world");
  });
});
