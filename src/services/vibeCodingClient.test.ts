import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  grepContent,
  listDirectory,
  readFile,
  searchFiles,
  writeFile,
} from "./vibeCodingClient";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

function mockFetchJson(data: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("vibeCodingClient", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists a directory with an encoded path", async () => {
    const fetchMock = mockFetchJson({ ok: true, path: "D:/项目/demo", items: [] });

    const result = await listDirectory("D:/项目/demo");

    expect(result).toEqual({ ok: true, path: "D:/项目/demo", items: [] });
    expect(fetchMock).toHaveBeenCalledWith("/backend/vibe/list?path=D%3A%2F%E9%A1%B9%E7%9B%AE%2Fdemo");
  });

  it("posts read requests with project root", async () => {
    const fetchMock = mockFetchJson({ ok: true, content: "hello", path: "D:/demo/a.ts", size: 5 });

    const result = await readFile("D:/demo/a.ts", "D:/demo");

    expect(result).toEqual({ ok: true, content: "hello", path: "D:/demo/a.ts", size: 5 });
    expect(fetchMock).toHaveBeenCalledWith("/backend/vibe/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "D:/demo/a.ts", projectRoot: "D:/demo" }),
    });
  });

  it("posts write requests with content and project root", async () => {
    const fetchMock = mockFetchJson({ ok: true, path: "D:/demo/a.ts", size: 11 });

    const result = await writeFile("D:/demo/a.ts", "hello world", "D:/demo");

    expect(result).toEqual({ ok: true, path: "D:/demo/a.ts", size: 11 });
    expect(fetchMock).toHaveBeenCalledWith("/backend/vibe/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "D:/demo/a.ts", content: "hello world", projectRoot: "D:/demo" }),
    });
  });

  it("searches files and grep content with encoded query strings", async () => {
    const fetchMock = mockFetchJson({ ok: true, results: [] });

    await searchFiles("D:/demo", "foo bar");
    await grepContent("D:/demo", "const value");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/backend/vibe/search?path=D%3A%2Fdemo&q=foo%20bar");
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/backend/vibe/grep?path=D%3A%2Fdemo&q=const%20value");
  });

  it("returns stable failure results when fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(listDirectory("D:/demo")).resolves.toEqual({
      ok: false,
      path: "D:/demo",
      items: [],
      error: "network down",
    });
    await expect(readFile("D:/demo/a.ts")).resolves.toEqual({
      ok: false,
      content: "",
      path: "D:/demo/a.ts",
      size: 0,
      error: "network down",
    });
    await expect(writeFile("D:/demo/a.ts", "hello")).resolves.toEqual({
      ok: false,
      path: "D:/demo/a.ts",
      size: 0,
      error: "network down",
    });
    await expect(searchFiles("D:/demo", "foo")).resolves.toEqual({ ok: false, results: [], error: "network down" });
    await expect(grepContent("D:/demo", "foo")).resolves.toEqual({ ok: false, results: [], error: "network down" });
  });
});
