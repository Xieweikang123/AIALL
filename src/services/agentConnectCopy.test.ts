import { describe, expect, it } from "vitest";
import {
  agentConnectStallMessage,
  agentConnectingStatusText,
  agentConnectTimeoutErrorMessage,
  backendJsonParseErrorMessage,
} from "./agentConnectCopy";
import { WEB_REQUIRES_TAURI_MESSAGE } from "./tauriInvoke";

describe("agentConnectCopy", () => {
  it("uses desktop-only hints on web runtime", () => {
    expect(agentConnectingStatusText("web")).toContain("Tauri");
    expect(agentConnectStallMessage(false, "web")).toBe(WEB_REQUIRES_TAURI_MESSAGE);
    expect(agentConnectTimeoutErrorMessage(false, "web")).toBe(WEB_REQUIRES_TAURI_MESSAGE);
    expect(backendJsonParseErrorMessage("web")).toBe(WEB_REQUIRES_TAURI_MESSAGE);
  });

  it("uses desktop hints on tauri runtime", () => {
    expect(agentConnectingStatusText("tauri")).toBe("正在启动 Agent…");
    expect(agentConnectStallMessage(true, "tauri")).toContain("缩小截图");
    expect(agentConnectStallMessage(true, "tauri")).not.toContain("sidecar");
    expect(backendJsonParseErrorMessage("tauri")).toContain("重启应用");
  });
});
