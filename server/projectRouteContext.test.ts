import { describe, expect, it } from "vitest";
import {
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
