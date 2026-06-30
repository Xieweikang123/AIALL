import { describe, expect, it } from "vitest";
import { ref, nextTick } from "vue";
import { useStableAgentAnswer } from "./useStableAgentAnswer";

describe("useStableAgentAnswer", () => {
  it("keeps last substantive answer when live preview clears during run", async () => {
    const source = ref("这是一段足够长的流式回答内容，不应在工具轮次之间被清空。");
    const running = ref(true);
    const { stableAnswer } = useStableAgentAnswer(
      () => source.value,
      () => running.value,
    );

    await nextTick();
    expect(stableAnswer.value).toContain("流式回答");

    source.value = "";
    await nextTick();
    expect(stableAnswer.value).toContain("流式回答");

    source.value = "这是一段足够长的流式回答内容，不应在工具轮次之间被清空。补充更多细节。";
    await nextTick();
    expect(stableAnswer.value).toContain("补充更多细节");

    running.value = false;
    source.value = "最终定稿";
    await nextTick();
    expect(stableAnswer.value).toBe("最终定稿");
  });

  it("clears stale failure text when a new run starts after recoverable interrupt", async () => {
    const source = ref("[Agent 运行失败] 运行中断（未生成最终回复）");
    const running = ref(false);
    const { stableAnswer } = useStableAgentAnswer(
      () => source.value,
      () => running.value,
    );

    await nextTick();
    expect(stableAnswer.value).toContain("运行失败");

    running.value = true;
    source.value = "";
    await nextTick();
    expect(stableAnswer.value).toBe("");
  });
});
