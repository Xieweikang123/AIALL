import { writeFile } from "./vibeCodingClient";
import { vibeChatSessionDiskFilePath } from "./vibeChatStorage";
import { buildAgentTraceTurns } from "./agentTraceTimeline";
import type { AgentRoundGroupView } from "./agentRoundGroups";

const TRACE_DIR_REL = ".aiall/agent-traces";

export type AgentTraceDumpInput = {
  projectPath: string;
  sessionId?: string | null;
  messageId?: string | null;
  roundGroups: AgentRoundGroupView[];
};

export type AgentTraceDumpResult =
  | { ok: true; absolutePath: string; clipboardText: string }
  | { ok: false; error: string };

function safeToken(value: string | null | undefined, fallback: string): string {
  const raw = (value ?? "").trim();
  if (!raw) return fallback;
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48) || fallback;
}

function joinProjectRel(projectPath: string, rel: string): string {
  const root = projectPath.replace(/[/\\]+$/, "");
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root}${sep}${rel.replace(/\//g, sep)}`;
}

/** 把当前内存中的完整轨迹落到 `.aiall/agent-traces/`，返回绝对路径供复制排查。 */
export async function dumpAgentTraceToFile(input: AgentTraceDumpInput): Promise<AgentTraceDumpResult> {
  const projectPath = input.projectPath.trim();
  if (!projectPath) {
    return { ok: false, error: "请先打开项目" };
  }
  if (!input.roundGroups.length) {
    return { ok: false, error: "暂无轨迹数据可导出" };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const msgToken = safeToken(input.messageId, "msg");
  const fileName = `trace-${stamp}-${msgToken}.json`;
  const relPath = `${TRACE_DIR_REL}/${fileName}`;

  const sessionId = input.sessionId?.trim() || null;
  const sessionDiskPath = sessionId ? vibeChatSessionDiskFilePath(sessionId) : null;
  const absoluteGuess = joinProjectRel(projectPath, relPath);

  const payload = {
    exportedAt: new Date().toISOString(),
    projectPath,
    sessionId,
    sessionDiskPath,
    messageId: input.messageId ?? null,
    roundGroupCount: input.roundGroups.length,
    turns: buildAgentTraceTurns(input.roundGroups),
    roundGroups: input.roundGroups,
  };

  const written = await writeFile(relPath, `${JSON.stringify(payload, null, 2)}\n`, projectPath);
  if (!written.ok) {
    return { ok: false, error: written.error || "写入轨迹文件失败" };
  }

  const absolutePath = written.path || absoluteGuess;
  const lines = [absolutePath];
  if (sessionDiskPath) lines.push(`session: ${sessionDiskPath}`);
  if (input.messageId) lines.push(`messageId: ${input.messageId}`);

  return {
    ok: true,
    absolutePath,
    clipboardText: lines.join("\n"),
  };
}
