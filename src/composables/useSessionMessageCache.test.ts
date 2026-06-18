import { describe, expect, it } from "vitest";
import { useSessionMessageCache } from "./useSessionMessageCache";

describe("useSessionMessageCache", () => {
  it("keeps message object refs in snapshot", () => {
    const cache = useSessionMessageCache<{ id: string; content: string }>();
    const msg = { id: "a1", content: "hi" };
    cache.snapshot("s1", [msg]);
    msg.content = "updated";
    expect(cache.get("s1")?.[0]?.content).toBe("updated");
  });

  it("patches cached messages by id", () => {
    const cache = useSessionMessageCache<{ id: string; streaming?: boolean }>();
    cache.snapshot("s1", [{ id: "m1", streaming: true }]);
    cache.patchMessage("s1", "m1", { streaming: false });
    expect(cache.get("s1")?.[0]?.streaming).toBe(false);
  });
});
