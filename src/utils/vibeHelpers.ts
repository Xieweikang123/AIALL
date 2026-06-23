import type { AgentRoundGroup } from "../services/agentRoundGroups";

export function phaseBadgeLabel(phase?: string): string {
  switch (phase) {
    case "connecting_local":
    case "stream_connected":
    case "connected":
      return "连接";
    case "reconnecting":
      return "重连";
    case "preparing":
    case "starting":
    case "building_context":
      return "准备";
    case "compacting_context":
      return "上下文";
    case "vision_first_turn":
      return "读图";
    case "vision_first_turn_done":
    case "vision_first_turn_skipped":
    case "vision_anchor_prefgrep":
      return "读图";
    case "waiting_model":
    case "thinking":
    case "retrying_model":
    case "sending_request":
      return "模型";
    case "streaming_model":
      return "输出";
    case "planning_tools":
      return "规划";
    case "executing_tool":
    case "executing_tools":
      return "工具";
    case "summarizing_tools":
      return "整理";
    case "continuing":
      return "续跑";
    case "aborted":
      return "停止";
    default:
      return "";
  }
}

export function appendStatusDetail(base: string, detail?: string): string {
  const extra = detail?.trim();
  if (!extra || isRedundantAgentStatusDetail(base, extra)) return base;
  if (base.endsWith("…") && extra.endsWith("…") && base.slice(0, -1) === extra.slice(0, -1)) {
    return base;
  }
  return `${base} · ${extra}`;
}

/** Clears live Agent status UI; history stays in statusLog / roundGroups. */
export function assistantTransientUiClearPatch(): {
  status: "";
  agentPhase: undefined;
  agentDetail: undefined;
  streaming: false;
  agentWaitStartedAt: undefined;
} {
  return {
    status: "",
    agentPhase: undefined,
    agentDetail: undefined,
    streaming: false,
    agentWaitStartedAt: undefined,
  };
}

/** Server turn preamble duplicated in compact waiting_model status lines. */
export function isRedundantAgentStatusDetail(base: string, detail?: string): boolean {
  const extra = detail?.trim();
  if (!extra) return false;
  if (/^第 \d+ 轮：等待模型响应$/.test(extra)) return true;
  if (base === "正在发送模型请求…" && extra === "正在发送请求…") return true;
  return false;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function computeDiffHtml(before: string, after: string, maxLines = 80): { htmlBefore: string; htmlAfter: string } {
  const aLines = before.split("\n");
  const bLines = after.split("\n");
  const maxLen = Math.max(aLines.length, bLines.length);
  const aResult: string[] = [];
  const bResult: string[] = [];
  for (let i = 0; i < maxLen && (aResult.length < maxLines || bResult.length < maxLines); i++) {
    const aLine = i < aLines.length ? aLines[i] : undefined;
    const bLine = i < bLines.length ? bLines[i] : undefined;
    if (aLine === undefined) {
      aResult.push(`<span class="diff-line diff-add">${escapeHtml(bLine!)}</span>`);
      bResult.push(`<span class="diff-line diff-add">${escapeHtml(bLine!)}</span>`);
    } else if (bLine === undefined) {
      aResult.push(`<span class="diff-line diff-del">${escapeHtml(aLine)}</span>`);
      bResult.push(`<span class="diff-line diff-del">${escapeHtml(aLine)}</span>`);
    } else if (aLine === bLine) {
      aResult.push(`<span class="diff-line">${escapeHtml(aLine)}</span>`);
      bResult.push(`<span class="diff-line">${escapeHtml(bLine)}</span>`);
    } else {
      aResult.push(`<span class="diff-line diff-del">${escapeHtml(aLine)}</span>`);
      bResult.push(`<span class="diff-line diff-add">${escapeHtml(bLine)}</span>`);
    }
  }
  const tail = maxLen > maxLines ? `\n<span class="diff-overflow">… 共 ${aLines.length} / ${bLines.length} 行</span>` : "";
  return {
    htmlBefore: aResult.join("\n") + tail,
    htmlAfter: bResult.join("\n") + tail,
  };
}

export function truncateDiffPreview(text: string, max = 1200): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…（共 ${text.length} 字符）`;
}

export function cleanStatusLogText(text: string): string {
  return text.replace(/^正在/, "").replace(/…$/, "").replace(/\.\.\.\s*$/, "").trim();
}

export function statusLogPhaseClass(text: string): string {
  if (text.includes("连接") || text.includes("已连接")) return "phase-connecting";
  if (text.includes("扫描") || text.includes("项目上下文") || text.includes("准备问答") || text.includes("组装")) return "phase-context";
  if (text.includes("压缩") || text.includes("准备模型上下文")) return "phase-compacting";
  if (text.includes("发送模型请求") || text.includes("等待模型") || text.includes("重试")) return "phase-model";
  if (text.includes("模型输出") || text.includes("规划工具")) return "phase-streaming";
  if (text.includes("执行") && text.includes("工具")) return "phase-tool";
  if (text.includes("整理")) return "phase-summarize";
  if (text.includes("停止")) return "phase-aborted";
  return "phase-default";
}

export function formatCharCount(chars: number): string {
  if (chars >= 1000000) return `${(chars / 1000000).toFixed(1)}M`;
  if (chars >= 1000) return `${(chars / 1000).toFixed(1)}K`;
  return `${chars}`;
}

export function formatContextChars(chars: number): string {
  if (chars >= 10_000) return `${(chars / 10_000).toFixed(1)} 万字符`;
  if (chars >= 1000) return `${(chars / 1000).toFixed(1)}k 字符`;
  return `${chars} 字符`;
}

export function modelStepPhaseLabel(phase: string): string {
  switch (phase) {
    case "compacting_context": return "上下文";
    case "sending_request": return "请求";
    case "waiting_model":
    case "retrying_model": return "等待";
    case "streaming_model": return "输出";
    case "planning_tools": return "规划";
    case "summarizing_tools": return "整理";
    case "connecting_local":
    case "stream_connected":
    case "connected":
    case "reconnecting": return "连接";
    case "preparing":
    case "starting":
    case "building_context": return "准备";
    default: return "步骤";
  }
}

export function turnMessageRoleLabel(role: string): string {
  switch (role) {
    case "system": return "系统";
    case "user": return "用户";
    case "assistant": return "助手";
    case "tool": return "工具结果";
    default: return role;
  }
}

export function formatSessionTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function hasAgentProcessSteps(msg: { tools?: unknown[]; roundGroups?: { turn: number; toolIds?: unknown[]; modelSteps: unknown[] }[] }): boolean {
  return Boolean(
    msg.tools?.length ||
      msg.roundGroups?.some(
        (group) => group.turn > 0 && ((group.toolIds?.length ?? 0) > 0 || group.modelSteps.length > 0),
      ),
  );
}

export function shouldShowMessageBubble(msg: { role: string; content?: string; images?: unknown[] }, hasAgentActivity?: boolean): boolean {
  if (msg.role === "user") return Boolean(msg.content?.trim() || (msg.images?.length ?? 0) > 0);
  if (hasAgentActivity) return false;
  return Boolean(msg.content?.trim());
}

/** Last message is user with no following assistant (e.g. lost on session switch). */
export function isOrphanedUserReply(
  messages: Array<{ role: string }>,
  chatSending: boolean,
): boolean {
  if (chatSending || messages.length === 0) return false;
  return messages[messages.length - 1]?.role === "user";
}

/** Agent run started but assistant placeholder not yet in the list. */
export function isAwaitingAssistantPlaceholder(
  messages: Array<{ role: string }>,
  chatSending: boolean,
): boolean {
  return chatSending && messages[messages.length - 1]?.role === "user";
}

export function isNetworkError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return /failed to fetch|networkerror|network error|fetcherror|load failed/.test(msg);
}

export function genId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function fileName(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || p;
}

export function normalizePathKey(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

export function joinProjectPath(base: string, relative: string): string {
  const rel = relative.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel) return base;
  if (/^[a-zA-Z]:/.test(rel)) return rel;
  const baseNorm = base.replace(/\\/g, "/").replace(/\/$/, "");
  return `${baseNorm}/${rel}`;
}

export function isVirtualSchemePath(path: string): boolean {
  return path.startsWith("git-index://") || path.startsWith("git-history://");
}

export function displayFilePath(path: string): string {
  if (!path) return "";
  if (path.startsWith("git-index://")) return path.slice("git-index://".length);
  if (path.startsWith("git-history://")) {
    const rest = path.slice("git-history://".length);
    const slash = rest.indexOf("/");
    return slash >= 0 ? rest.slice(slash + 1) : rest;
  }
  return path;
}

export function entryToNode<T extends { isDirectory: boolean; children?: T[] }>(entry: T): T & { loaded: boolean } {
  return { ...entry, children: entry.isDirectory ? [] : undefined, loaded: !entry.isDirectory };
}

export function roundGroupSetupLabel(group: { turn: number }): string {
  return group.turn === 0 ? "准备阶段" : `第 ${group.turn} 轮`;
}

export function isActiveModelStep(group: { active?: boolean }, _step: { phase: string }): boolean {
  return !!group.active;
}

export function formatToolMeta(
  name: string,
  args: Record<string, unknown>,
): { name: string; icon: string; title: string; detail: string; label: string } {
  const path = String(args.path ?? "").trim();
  const pattern = String(args.pattern ?? "").trim();
  const query = String(args.query ?? "").trim();

  if (name === "read_file") {
    const offset = Number(args.offset) || 1;
    const limit = Math.min(800, Math.max(1, Number(args.limit) || 500));
    const detail = path ? `${path} · 行 ${offset}–${offset + limit - 1}` : "";
    return { name, icon: "📄", title: "读取文件", detail, label: detail ? `读取文件 ${detail}` : "读取文件" };
  }
  if (name === "write_file") {
    const content = typeof args.content === "string" ? args.content : "";
    const detail = path ? `${path}${content ? ` · ${content.length} 字符` : ""}` : "";
    return { name, icon: "✏️", title: "写入文件", detail, label: detail ? `写入文件 ${detail}` : "写入文件" };
  }
  if (name === "patch_file") {
    const detail = path || "";
    return { name, icon: "🔧", title: "局部修改", detail, label: detail ? `局部修改 ${detail}` : "局部修改" };
  }
  if (name === "delete_file") {
    const detail = path || "";
    return { name, icon: "🗑️", title: "删除文件", detail, label: detail ? `删除文件 ${detail}` : "删除文件" };
  }
  if (name === "list_dir") {
    const detail = path || "项目根目录";
    return { name, icon: "📁", title: "浏览目录", detail, label: `浏览目录 ${detail}` };
  }
  if (name === "grep") {
    const detail = pattern ? `「${pattern}」` : "";
    return { name, icon: "🔍", title: "搜索代码", detail, label: detail ? `搜索代码 ${detail}` : "搜索代码" };
  }
  if (name === "search_files") {
    const detail = query ? `「${query}」` : "";
    return { name, icon: "🔎", title: "搜索文件", detail, label: detail ? `搜索文件 ${detail}` : "搜索文件" };
  }

  return { name, icon: "⚙️", title: name, detail: "", label: name };
}

export function syncRoundGroupsPatch(msg: { roundGroups?: AgentRoundGroup[] }): { roundGroups?: AgentRoundGroup[] } {
  return {
    roundGroups: msg.roundGroups?.map((group) => ({
      ...group,
      modelSteps: group.modelSteps.map((step) => ({ ...step })),
      toolIds: [...group.toolIds],
      request: group.request
        ? { ...group.request, messages: group.request.messages.map((message) => ({ ...message })) }
        : undefined,
      response: group.response
        ? { ...group.response, toolCalls: group.response.toolCalls.map((call) => ({ ...call })) }
        : undefined,
    })),
  };
}

/** 聊天消息区「视为在底部」的 scroll 余量（px），ChatPanel 与 VibeCodingView 共用 */
export const CHAT_SCROLL_BOTTOM_THRESHOLD = 80;
