// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick } from "vue";

/**
 * 回归：轨迹抽屉里新轮次的思考条目首次出现时，`ChatMarkdown` 刚挂载、
 * 节流后的流式 HTML 已在缓存里，但 `streamingContentRef` 那时还是 null，
 * 首帧 patch 会被丢弃；若之后内容不再变化，watch 也就不会再触发 ——
 * 正文长文本落在空白框里（框被 `--live` 的 max-height 撑开）。
 *
 * 修复：`onMounted` / `onUpdated` 补画一次（幂等，靠 lastStreamPatchHtml 去重）。
 * 详见 `ChatMarkdown.vue` 的 `paintStreamingBody`。
 */

vi.mock("dompurify", () => ({
  default: {
    sanitize: (html: string) => html,
    addHook: vi.fn(),
  },
}));

import ChatMarkdown from "./ChatMarkdown.vue";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mountChatMarkdown(props: { content: string; streaming: boolean }) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  createApp({
    render: () => h(ChatMarkdown, { ...props, interactive: false }),
  }).mount(host);
  await nextTick();
  // Streaming markdown is throttled (~80ms); wait for the first painted frame.
  await delay(220);
  await nextTick();
  return host;
}

describe("ChatMarkdown 流式正文补画", () => {
  it("流式中：节流首帧落在挂载后，live 正文被画出来（不是空盒）", async () => {
    const host = await mountChatMarkdown({ content: "Hello world from reasoning.", streaming: true });
    const body = host.querySelector(".msg-markdown-stream-body") as HTMLElement | null;
    expect(body).not.toBeNull();
    expect((body?.textContent ?? "").trim()).toContain("Hello world from reasoning.");
  });

  it("非流式：定稿正文照常渲染", async () => {
    const host = await mountChatMarkdown({ content: "Final answer text.", streaming: false });
    const body = host.querySelector(".msg-markdown-body") as HTMLElement | null;
    expect(body).not.toBeNull();
    expect((body?.textContent ?? "").trim()).toContain("Final answer text.");
  });
});
