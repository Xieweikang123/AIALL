import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatInvokeError,
  invokeBackend,
  isTauriEnv,
  tauriInvoke,
  WEB_REQUIRES_TAURI_MESSAGE,
  webRequiresTauriError,
} from "./tauriInvoke";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  Channel: class {},
}));

afterEach(() => {
  vi.unstubAllGlobals();
  invokeMock.mockClear();
});

describe("isTauriEnv", () => {
  it("无 window 时返回 false", () => {
    // Node 测试环境默认无 __TAURI_INTERNALS__
    expect(isTauriEnv()).toBe(false);
  });

  it("有 __TAURI_INTERNALS__ 时返回 true", () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    expect(isTauriEnv()).toBe(true);
  });
});

describe("invokeBackend", () => {
  it("VITEST 环境（非 Tauri）走 httpFallback", async () => {
    const fallback = vi.fn().mockResolvedValue({ ok: true });
    const result = await invokeBackend("some_cmd", { a: 1 }, fallback);
    expect(result).toEqual({ ok: true });
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("非 Tauri 且无 fallback 时抛出桌面版提示", async () => {
    await expect(invokeBackend("some_cmd", {})).rejects.toThrow(WEB_REQUIRES_TAURI_MESSAGE);
  });
});

describe("formatInvokeError", () => {
  it("string 错误取 trim 后内容", () => {
    expect(formatInvokeError("  boom  ", "fallback")).toBe("boom");
  });

  it("空 string 回退到 fallback", () => {
    expect(formatInvokeError("   ", "fallback")).toBe("fallback");
  });

  it("Error 实例取 message", () => {
    expect(formatInvokeError(new Error("oops"), "fallback")).toBe("oops");
  });

  it("未知类型回退到 fallback", () => {
    expect(formatInvokeError(42, "fallback")).toBe("fallback");
    expect(formatInvokeError(null, "fallback")).toBe("fallback");
  });
});

describe("tauriInvoke", () => {
  it("调用 @tauri-apps 的 invoke", async () => {
    invokeMock.mockResolvedValue({ ok: true });
    const result = await tauriInvoke("cmd_name", { x: 1 });
    expect(invokeMock).toHaveBeenCalledWith("cmd_name", { x: 1 });
    expect(result).toEqual({ ok: true });
  });
});

describe("webRequiresTauriError", () => {
  it("返回桌面版提示 Error", () => {
    const err = webRequiresTauriError();
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(WEB_REQUIRES_TAURI_MESSAGE);
  });
});
