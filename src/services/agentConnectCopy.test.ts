import { describe, expect, it } from "vitest";
import {
  agentConnectStallMessage,
  agentConnectingStatusText,
  agentConnectTimeoutErrorMessage,
  backendJsonParseErrorMessage,
} from "./agentConnectCopy";

describe("agentConnectCopy", () => {
  it("shows real connection-failure hints on web runtime", () => {
    expect(agentConnectingStatusText("web")).toContain("agent-server");
    expect(agentConnectStallMessage(false, "web")).toContain("agent-server");
    expect(agentConnectStallMessage(false, "web")).not.toContain("Tauri");
    expect(agentConnectTimeoutErrorMessage(false, "web")).toContain("agent-server");
    expect(agentConnectTimeoutErrorMessage(false, "web")).not.toContain("Tauri");
    expect(backendJsonParseErrorMessage("web")).toContain("agent-server");
    expect(backendJsonParseErrorMessage("web")).not.toContain("Tauri");
  });

  it("uses desktop hints on tauri runtime", () => {
    expect(agentConnectingStatusText("tauri")).toBe("正在启动 Agent…");
    expect(agentConnectStallMessage(true, "tauri")).toContain("缩小截图");
    expect(agentConnectStallMessage(true, "tauri")).not.toContain("sidecar");
    expect(backendJsonParseErrorMessage("tauri")).toContain("重启应用");
  });
});
