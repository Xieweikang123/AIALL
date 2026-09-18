import { afterEach, describe, expect, it, vi } from "vitest";

const classifyUserIntentWithAiClient = vi.fn();

vi.mock("./agentIntentClassifierClient", () => ({
  classifyUserIntentWithAiClient: (...args: unknown[]) => classifyUserIntentWithAiClient(...args),
}));

import {
  IntentClassifierUnavailableError,
  resolveAgentRequestUserIntentAsync,
} from "./agentRequestIntent";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    primary: "implement",
    consultativeTopic: "none",
    implementFollowUp: false,
    uiDefect: false,
    codeReview: false,
    behaviorContradiction: false,
    behaviorPurpose: false,
    accuracyQuestion: false,
    implementationStatus: false,
    agentStepClarification: false,
    userErrorQuote: false,
    uiAppearance: false,
    configBindingTopic: null,
    understanding: "按用户要求修改代码",
    ...overrides,
  };
}

function baseInput() {
  return {
    prompt: "帮我改一下",
    mode: "build" as const,
    hasImage: false,
    endpoint: "https://ai.example/v1",
    model: "gpt-4o",
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("resolveAgentRequestUserIntentAsync hard gate", () => {
  it("returns the resolved intent when the AI classifier produces a payload", async () => {
    classifyUserIntentWithAiClient.mockResolvedValue({ payload: payload() });
    const resolved = await resolveAgentRequestUserIntentAsync(baseInput());
    expect(resolved.primary).toBe("implement");
  });

  it("throws instead of falling back when the classifier yields no payload", async () => {
    classifyUserIntentWithAiClient.mockResolvedValue({ payload: null, error: "model returned empty" });
    await expect(resolveAgentRequestUserIntentAsync(baseInput())).rejects.toBeInstanceOf(
      IntentClassifierUnavailableError,
    );
  });

  it("throws when the classifier request itself fails", async () => {
    classifyUserIntentWithAiClient.mockRejectedValue(new Error("boom"));
    await expect(resolveAgentRequestUserIntentAsync(baseInput())).rejects.toThrow(/意图识别失败/);
  });

  it("throws when the AI classifier is disabled by env (no mode-default fallback)", async () => {
    vi.stubEnv("AIALL_INTENT_CLASSIFIER", "off");
    classifyUserIntentWithAiClient.mockResolvedValue(null);
    await expect(resolveAgentRequestUserIntentAsync(baseInput())).rejects.toThrow(
      /AIALL_INTENT_CLASSIFIER/,
    );
  });

  it("reports the failure through onStatus before throwing", async () => {
    classifyUserIntentWithAiClient.mockResolvedValue({ payload: null, error: "timeout" });
    const onStatus = vi.fn();
    await expect(
      resolveAgentRequestUserIntentAsync(baseInput(), onStatus),
    ).rejects.toBeInstanceOf(IntentClassifierUnavailableError);
    const lastCall = onStatus.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe("intent_classified");
    expect(lastCall?.[2]?.aiFailed).toBe(true);
    expect(lastCall?.[2]?.aiError).toBe("timeout");
  });
});
