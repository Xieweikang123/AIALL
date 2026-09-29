import { describe, expect, it } from "vitest";
import { pendingRunBelongsToSession } from "./agentHmrRecovery";

describe("pendingRunBelongsToSession", () => {
  it("treats a matching session id as belonging to the active session", () => {
    expect(pendingRunBelongsToSession("sess-a", "sess-a")).toBe(true);
  });

  it("rejects a pending run from another session", () => {
    expect(pendingRunBelongsToSession("sess-a", "sess-b")).toBe(false);
  });

  it("keeps legacy records without a session id for backward compatibility", () => {
    expect(pendingRunBelongsToSession(undefined, "sess-b")).toBe(true);
    expect(pendingRunBelongsToSession("", "sess-b")).toBe(true);
    expect(pendingRunBelongsToSession("   ", "sess-b")).toBe(true);
  });

  it("trims surrounding whitespace before comparing", () => {
    expect(pendingRunBelongsToSession("  sess-a  ", "sess-a")).toBe(true);
  });
});
