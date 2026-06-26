export type VibeChatMode = "ask" | "build" | "plan" | "explore";

export type VibeChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type VibeAgentEvent =
  | {
      type: "status";
      data: {
        phase: string;
        turn?: number;
        maxTurns?: number;
        openFile?: string;
        model?: string;
        retryAttempt?: number;
        retryMaxAttempts?: number;
        retryError?: string;
        detail?: string;
        contextMessages?: number;
        contextChars?: number;
        streamChars?: number;
        streamChunks?: number;
        toolCallCount?: number;
        elapsedMs?: number;
      };
    }
  | { type: "tool_start"; data: { id: string; name: string; args: Record<string, unknown> } }
  | { type: "tool_end"; data: { id: string; name: string; ok: boolean; summary: string; result?: string } }
  | { type: "message"; data: { text: string } }
  | { type: "message_delta"; data: { delta: string } }
  | { type: "file_diff"; data: { path: string; before: string; after: string; deleted?: boolean; created?: boolean } }
  | {
      type: "agent_context";
      data: {
        mode: VibeChatMode;
        systemPrompt: string;
        history: Array<{ role: string; content: string }>;
        projectContext?: string;
        maxTurns?: number;
        model?: string;
        openFile?: string;
      };
    }
  | {
      type: "turn_trace";
      data: { turn: number; maxTurns?: number; assistantText: string; hasToolCalls: boolean };
    }
  | {
      type: "turn_request";
      data: {
        turn: number;
        maxTurns?: number;
        model?: string;
        contextMessages: number;
        contextChars: number;
        messages: Array<{ role: string; content: string; toolCalls?: string }>;
      };
    }
  | {
      type: "turn_response";
      data: {
        turn: number;
        maxTurns?: number;
        assistantText: string;
        toolCalls: Array<{ id: string; name: string; arguments: string }>;
        hasToolCalls: boolean;
        isFinal: boolean;
      };
    }
  | { type: "error"; data: { message: string } }
  | { type: "done"; data: { writtenFiles: string[]; pendingFiles: string[]; turns: number; truncated?: boolean } };
