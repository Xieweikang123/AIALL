import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("backendUrl", () => {
  it("无 VITE_BACKEND_URL 时返回相对路径并规范斜杠", async () => {
    const { backendUrl, getBackendBase } = await import("./backendBase");
    expect(backendUrl("/backend/vibe/list")).toBe("/backend/vibe/list");
    expect(backendUrl("backend/vibe/list")).toBe("/backend/vibe/list");
    expect(getBackendBase()).toBe("");
  });

  it("设置 VITE_BACKEND_URL 后拼接前缀（去掉尾斜杠）", async () => {
    process.env.VITE_BACKEND_URL = "http://127.0.0.1:8787/";
    const { backendUrl, getBackendBase } = await import("./backendBase");
    expect(getBackendBase()).toBe("http://127.0.0.1:8787");
    expect(backendUrl("/api/agent/run")).toBe("http://127.0.0.1:8787/api/agent/run");
    delete process.env.VITE_BACKEND_URL;
  });
});
