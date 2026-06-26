import type { ModelStreamProgress } from "./aiForward";
import type { VibeAgentEvent } from "../shared/agentTypes";
import { sanitizeAgentUserVisibleText } from "./agentExploreGuard";
import { formatElapsedMs } from "./agentContext";

function toolDisplayName(name: string): string {
  const map: Record<string, string> = {
    read_file: "读取文件",
    list_dir: "列出目录",
    grep: "搜索内容",
    search_files: "搜索文件",
    write_file: "写入文件",
    patch_file: "局部修改",
    delete_file: "删除文件",
    web_search: "联网搜索",
    web_extract: "抓取网页",
  };
  return map[name] || name;
}

export function streamProgressDetail(progress: ModelStreamProgress): string {
  const elapsed = formatElapsedMs(progress.elapsedMs);
  if (progress.phase === "request_sent") return "正在发送请求…";
  if (progress.phase === "waiting_first_byte") return `等待模型首包 · ${elapsed}`;
  if (progress.phase === "planning_tools") {
    const names = progress.toolNames.map(toolDisplayName).join("、");
    return names
      ? `规划工具：${names}${progress.toolCallCount > progress.toolNames.length ? "…" : ""} · ${elapsed}`
      : `规划工具调用 · ${elapsed}`;
  }
  if (progress.streamChars > 0) {
    return `流式输出 ${progress.streamChars} 字 · ${progress.streamChunks} 包 · ${elapsed}`;
  }
  if (progress.phase === "streaming") {
    return `流式通道已连接 · 等待内容 · ${elapsed}`;
  }
  return `已等待 ${elapsed}`;
}

export function streamProgressPhase(progress: ModelStreamProgress): string {
  if (progress.phase === "request_sent") return "sending_request";
  if (progress.phase === "waiting_first_byte") return "waiting_model";
  if (progress.phase === "planning_tools") return "planning_tools";
  if (progress.streamChars > 0) return "streaming_model";
  return "waiting_model";
}

export function emitUserVisibleAssistantMessage(
  onEvent: (event: VibeAgentEvent) => void,
  text: string,
  streamedChars: number,
  options?: { force?: boolean },
): void {
  const visible = sanitizeAgentUserVisibleText(text);
  if (visible && (!streamedChars || options?.force)) {
    onEvent({ type: "message", data: { text: visible } });
  }
}
