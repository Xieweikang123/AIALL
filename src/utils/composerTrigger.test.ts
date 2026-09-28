import { describe, expect, it } from "vitest";
import { matchMentionTrigger, matchPresetTrigger, triggerDeleteCount } from "./composerTrigger";

describe("composerTrigger", () => {
  it("matches @mention at line start or after whitespace", () => {
    expect(matchMentionTrigger("@foo")).toBe("foo");
    expect(matchMentionTrigger("看下 @bar")).toBe("bar");
    expect(matchMentionTrigger("line1\n@baz")).toBe("baz");
  });

  it("does not match @ inside a token (email / word)", () => {
    expect(matchMentionTrigger("a@b")).toBeNull();
    expect(matchMentionTrigger("user@host.com")).toBeNull();
  });

  it("matches /preset at line start or after whitespace", () => {
    expect(matchPresetTrigger("/")).toBe("");
    expect(matchPresetTrigger("/解释")).toBe("解释");
    expect(matchPresetTrigger("帮我 /test")).toBe("test");
  });

  it("does not match slash inside URLs or paths", () => {
    expect(matchPresetTrigger("https://a.com/b")).toBeNull();
    expect(matchPresetTrigger("src/utils/foo")).toBeNull();
    expect(matchPresetTrigger("a /b")).toBe("b");
  });

  it("delete count covers the trigger symbol plus keyword", () => {
    expect(triggerDeleteCount("abc")).toBe(4);
    expect(triggerDeleteCount("")).toBe(1);
  });
});
