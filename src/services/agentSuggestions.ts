export type AgentSuggestionAction = "send" | "implement" | "execute_plan";

export type AgentSuggestion = {
  label: string;
  action?: AgentSuggestionAction;
  text?: string;
};

const MAX_SUGGESTIONS = 3;
const VALID_ACTIONS = new Set<AgentSuggestionAction>(["send", "implement", "execute_plan"]);

const AGENT_SUGGESTIONS_BLOCK_RE = /<!--\s*agent-suggestions\s*-->\s*```(?:json)?\s*([\s\S]*?)```/i;

function normalizeSuggestion(raw: unknown): AgentSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const label = typeof item.label === "string" ? item.label.trim() : "";
  if (!label || label.length > 24) return null;

  const actionRaw = typeof item.action === "string" ? item.action.trim() : "send";
  const action = VALID_ACTIONS.has(actionRaw as AgentSuggestionAction)
    ? (actionRaw as AgentSuggestionAction)
    : "send";

  const text = typeof item.text === "string" ? item.text.trim() : "";
  if (action === "send" && !text) return null;

  return {
    label,
    action,
    text: text || undefined,
  };
}

/** Remove agent-suggestions block (and any trailing partial marker during streaming). */
export function stripAgentSuggestions(text: string): string {
  const markerIdx = text.indexOf("<!-- agent-suggestions");
  if (markerIdx >= 0) return text.slice(0, markerIdx).trimEnd();
  return text.replace(AGENT_SUGGESTIONS_BLOCK_RE, "").trimEnd();
}

export function parseAgentSuggestions(text: string): { content: string; suggestions: AgentSuggestion[] } {
  const blockMatch = text.match(AGENT_SUGGESTIONS_BLOCK_RE);
  let suggestions: AgentSuggestion[] = [];
  if (blockMatch) {
    try {
      const parsed = JSON.parse(blockMatch[1].trim()) as unknown;
      if (Array.isArray(parsed)) {
        suggestions = parsed
          .map(normalizeSuggestion)
          .filter((item): item is AgentSuggestion => item !== null)
          .slice(0, MAX_SUGGESTIONS);
      }
    } catch {
      // ignore invalid JSON
    }
  }
  return { content: stripAgentSuggestions(text), suggestions };
}

/** System-prompt hint: model appends structured next-step suggestions when user input is needed. */
export function buildAgentSuggestionsPromptHint(): string {
  return [
    "【可选·下一步建议】当本轮回复结束且需要用户决策或选择后续操作时，在正文全部输出完毕后追加（对用户不可见，客户端解析为输入框上方按钮）：",
    "<!-- agent-suggestions -->",
    "```json",
    '[{"label":"短按钮文案","action":"send","text":"点击后发送给 agent 的完整消息"}]',
    "```",
    "字段：label（≤12字）、action（send|implement|execute_plan）；action 为 send 时必填 text。",
    "最多 3 条。纯说明、已执行完修改、工具运行中间过程——勿输出该块。",
    "implement：用户确认按上文方案改代码；execute_plan：Plan 模式方案已就绪待执行；send：普通续聊。",
  ].join("\n");
}
