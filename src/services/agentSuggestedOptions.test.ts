import { describe, expect, it } from "vitest";
import {
  buildSuggestedOptionsPrompt,
  parseSuggestedOptionsResponse,
} from "./agentSuggestedOptions";

describe("parseSuggestedOptionsResponse", () => {
  it("parses a valid isChoice JSON object", () => {
    const result = parseSuggestedOptionsResponse(
      '{"isChoice": true, "options": ["好，按你说的做", "不用了，谢谢"]}',
    );
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result?.[0]).toMatchObject({ label: "好，按你说的做", fullText: "好，按你说的做", showIndex: false });
    expect(result?.[1]).toMatchObject({ label: "不用了，谢谢", index: 1 });
  });

  it("tolerates a markdown code fence", () => {
    const result = parseSuggestedOptionsResponse(
      '```json\n{"isChoice": true, "options": ["A", "B", "C"]}\n```',
    );
    expect(result).not.toBeNull();
    expect(result).toHaveLength(3);
  });

  it("returns [] when isChoice is false", () => {
    expect(parseSuggestedOptionsResponse('{"isChoice": false, "options": []}')).toEqual([]);
  });

  it("returns [] when options is not an array", () => {
    expect(parseSuggestedOptionsResponse('{"isChoice": true, "options": "nope"}')).toEqual([]);
  });

  it("returns [] when fewer than 2 options", () => {
    expect(parseSuggestedOptionsResponse('{"isChoice": true, "options": ["only one"]}')).toEqual([]);
  });

  it("deduplicates repeated options and caps at 4", () => {
    const result = parseSuggestedOptionsResponse(
      '{"isChoice": true, "options": ["A", "A", "B", "C", "D", "E"]}',
    );
    expect(result?.map((o) => o.label)).toEqual(["A", "B", "C", "D"]);
  });

  it("trims and skips blank options", () => {
    const result = parseSuggestedOptionsResponse(
      '{"isChoice": true, "options": ["  A  ", "", "B"]}',
    );
    expect(result?.map((o) => o.label)).toEqual(["A", "B"]);
  });

  it("returns null for invalid JSON", () => {
    expect(parseSuggestedOptionsResponse("not json at all")).toBeNull();
    expect(parseSuggestedOptionsResponse("")).toBeNull();
  });

  it("returns [] when isChoice is true but options is missing", () => {
    expect(parseSuggestedOptionsResponse('{"isChoice": true}')).toEqual([]);
  });

  it("returns null for a non-object payload", () => {
    expect(parseSuggestedOptionsResponse('"just a string"')).toBeNull();
  });
});

describe("buildSuggestedOptionsPrompt", () => {
  it("embeds the assistant text and asks for strict JSON", () => {
    const prompt = buildSuggestedOptionsPrompt("要我清理这些死样式吗？");
    expect(prompt).toContain("要我清理这些死样式吗？");
    expect(prompt).toContain("isChoice");
    expect(prompt).toContain("不要 markdown 围栏");
  });
});
