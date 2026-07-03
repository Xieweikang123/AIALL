import { invoke, Channel } from "@tauri-apps/api/core";
import type { VibeAgentEvent } from "../../shared/agentTypes";
import type { VibeAgentRunRequest } from "./vibeAgentClient";

/** Shown when browser UI preview calls backend features removed with sidecar (Strategy B). */
export const WEB_REQUIRES_TAURI_MESSAGE =
  "此功能需在 Tauri 桌面版中使用。请在项目根目录运行：npm run dev";

export function isTauriEnv(): boolean {
  return typeof window !== "undefined" && !!(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

function allowHttpFallbackInNodeTests(): boolean {
  return typeof process !== "undefined" && Boolean(process.env.VITEST);
}

export function webRequiresTauriError(): Error {
  return new Error(WEB_REQUIRES_TAURI_MESSAGE);
}

/** Tauri 桌面版走 invoke；浏览器预览拒绝 sidecar；Vitest 仍可走 httpFallback 测客户端契约。 */
export async function invokeBackend<T>(
  cmd: string,
  args: Record<string, unknown>,
  httpFallback?: () => Promise<T>,
): Promise<T> {
  if (!isTauriEnv()) {
    if (allowHttpFallbackInNodeTests() && httpFallback) {
      return httpFallback();
    }
    throw webRequiresTauriError();
  }
  return tauriInvoke<T>(cmd, args);
}

export async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args ?? {});
}

export function formatInvokeError(error: unknown, fallback: string): string {
  if (typeof error === "string") return error.trim() || fallback;
  if (error instanceof Error) return error.message.trim() || fallback;
  return fallback;
}

export function runAgentChannel(
  request: VibeAgentRunRequest,
  onEvent: (event: VibeAgentEvent | { type: "unknown"; data: unknown }) => void,
) {
  const channel = new Channel<VibeAgentEvent | { type: "unknown"; data: unknown }>();
  channel.onmessage = onEvent;
  return {
    promise: invoke("agent_run", { request, onEvent: channel }),
    abort: () => {
      void tauriInvoke("agent_cancel").catch(() => {});
    },
  };
}

/**
 * 带 Channel 流式的 Tauri invoke。
 * Tauri 环境下用 Channel 接收流式事件；Web 预览直接拒绝。
 */
export function invokeWithChannel<T>(
  cmd: string,
  args: Record<string, unknown>,
  onEvent: (event: { type: string; data: unknown }) => void,
  _httpFallback?: () => Promise<T>,
): { promise: Promise<T>; abort: () => void } {
  if (!isTauriEnv()) {
    const err = webRequiresTauriError();
    onEvent({ type: "error", data: { message: err.message } });
    return { promise: Promise.reject(err), abort: () => {} };
  }
  const channel = new Channel<{ type: string; data: unknown }>();
  channel.onmessage = onEvent;
  return {
    promise: invoke(cmd, { ...args, onEvent: channel }) as Promise<T>,
    abort: () => {},
  };
}
