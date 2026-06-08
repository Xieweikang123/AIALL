import { describe, expect, it } from "vitest";
import { mergeSessionMessagesForDisk, mergeSessionPayloadForDisk } from "./chatStoreMerge";

describe("chatStoreMerge", () => {
  it("prefers incoming messages when non-empty", () => {
    expect(mergeSessionMessagesForDisk([{ role: "user" }], [{ role: "assistant" }])).toEqual([
      { role: "user" },
    ]);
  });

  it("preserves disk messages when incoming is empty", () => {
    expect(mergeSessionMessagesForDisk([], [{ role: "assistant", content: "hi" }])).toEqual([
      { role: "assistant", content: "hi" },
    ]);
  });

  it("allows intentional empty when disk is also empty", () => {
    expect(mergeSessionMessagesForDisk([], [])).toEqual([]);
    expect(mergeSessionMessagesForDisk([], undefined)).toEqual([]);
  });

  it("mergeSessionPayloadForDisk keeps other fields", () => {
    const merged = mergeSessionPayloadForDisk(
      { id: "s1", title: "t", messages: [] },
      { messages: [{ role: "user" }] },
    );
    expect(merged.id).toBe("s1");
    expect(merged.messages).toHaveLength(1);
  });
});
