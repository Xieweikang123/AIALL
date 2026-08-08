import { describe, expect, it } from "vitest";
import { detectScriptAt, projectDirFromUriPath } from "./monacoNpmScriptHover";

const PKG = `{
  "name": "demo",
  "scripts": {
    "dev": "vue-cli-service serve",
    "build": "vue-cli-service build --mode=prod",
    "render": "node scripts/render.js --out {data}"
  }
}`;

describe("detectScriptAt", () => {
  it("命中 scripts 内的脚本键", () => {
    const keyStart = PKG.indexOf(`"dev"`);
    const hit = detectScriptAt(PKG, keyStart + 1);
    expect(hit).toEqual({
      name: "dev",
      start: keyStart,
      end: keyStart + `"dev"`.length,
    });
  });

  it("命中后续带花括号字符串值的脚本键（括号匹配跳过字符串）", () => {
    const keyStart = PKG.indexOf(`"render"`);
    const hit = detectScriptAt(PKG, keyStart + 2);
    expect(hit?.name).toBe("render");
  });

  it("悬停在脚本值上不命中", () => {
    const valueStart = PKG.indexOf(`"vue-cli-service serve"`);
    expect(detectScriptAt(PKG, valueStart + 1)).toBeNull();
  });

  it("scripts 对象外（顶层键）不命中", () => {
    const nameStart = PKG.indexOf(`"name"`);
    expect(detectScriptAt(PKG, nameStart + 1)).toBeNull();
  });

  it("scripts 键自身不命中", () => {
    const scriptsStart = PKG.indexOf(`"scripts"`);
    expect(detectScriptAt(PKG, scriptsStart + 1)).toBeNull();
  });

  it("无 scripts 时不命中", () => {
    expect(detectScriptAt(`{ "name": "x" }`, 4)).toBeNull();
  });

  it("非法 JSON 时不命中", () => {
    expect(detectScriptAt(`{ "scripts": {`, 5)).toBeNull();
  });
});

describe("projectDirFromUriPath", () => {
  it("Windows 路径", () => {
    expect(projectDirFromUriPath("/D:/project/AIALL/package.json")).toBe("D:/project/AIALL");
  });

  it("Unix 路径", () => {
    expect(projectDirFromUriPath("/home/user/repo/package.json")).toBe("/home/user/repo");
  });
});
