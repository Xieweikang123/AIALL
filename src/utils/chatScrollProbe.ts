/**
 * 临时排障探针：「回复时不跟随往下滚动」。
 *
 * 直接写日志，无开关（按 AGENTS.md 约定：调试日志不加门控）。
 * 输出到 `%APPDATA%\aiall\debug-logs\<项目名_hash>\scroll-probe.log`，Agent 可直接读取。
 * 排查结束后删除本文件及其全部引用。
 */
import { appendDebugLogFile } from "./debugLog";

const LOG_FILE = "scroll-probe.log";

type ProbeEntry = { t: number; tag: string; data?: unknown };

export function chatScrollProbe(tag: string, data?: unknown) {
  const entry: ProbeEntry = { t: Date.now(), tag, data };
  appendDebugLogFile(LOG_FILE, JSON.stringify(entry), "scroll-probe");
}

/** 读取滚动容器当前的几何量，null 表示容器不存在。 */
export function readScrollGeometry(el: HTMLElement | null | undefined) {
  if (!el) return null;
  return {
    scrollTop: Math.round(el.scrollTop),
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    remaining: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
  };
}
