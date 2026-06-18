import { describe, expect, it } from "vitest";
import { createAgentSessionRunManager } from "./agentSessionRuns";

describe("createAgentSessionRunManager", () => {
  it("tracks independent runs per session", () => {
    const mgr = createAgentSessionRunManager();
    const genA = mgr.start("session-a", "msg-a", { id: "msg-a" }, false);
    const genB = mgr.start("session-b", "msg-b", { id: "msg-b" }, true);
    expect(genA).not.toBe(genB);
    expect(mgr.isValid("session-a", genA)).toBe(true);
    expect(mgr.isValid("session-b", genB)).toBe(true);
    expect(mgr.size()).toBe(2);
  });

  it("invalidates only the targeted session", () => {
    const mgr = createAgentSessionRunManager();
    const genA = mgr.start("session-a", "msg-a", { id: "msg-a" }, false);
    const genB = mgr.start("session-b", "msg-b", { id: "msg-b" }, false);
    mgr.invalidate("session-a");
    expect(mgr.isValid("session-a", genA)).toBe(false);
    expect(mgr.isValid("session-b", genB)).toBe(true);
  });

  it("removes session without affecting others", () => {
    const mgr = createAgentSessionRunManager();
    mgr.start("session-a", "msg-a", { id: "msg-a" }, false);
    mgr.start("session-b", "msg-b", { id: "msg-b" }, false);
    mgr.remove("session-a");
    expect(mgr.has("session-a")).toBe(false);
    expect(mgr.has("session-b")).toBe(true);
    expect(mgr.size()).toBe(1);
  });
});
