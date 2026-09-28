// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";

vi.mock("dompurify", () => ({
  default: {
    sanitize: (html: string) => html,
    addHook: vi.fn(),
  },
}));

import ChatComposerEditor from "./ChatComposerEditor.vue";
import { readComposerDraftHtml } from "../utils/composerDraftStorage";

/**
 * 回归：点 AI 选项 / 示例 chip（`setPlainText`）属程序化写入，不触发 input 事件，
 * 早期实现不落盘草稿 —— 用户不追加输入直接刷新，输入框内容就丢了。
 * 修复：`setPlainText` 结束后显式 `saveDraftToStorage()`。
 */

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mountComposer(draftKey: string) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const composerRef = ref<InstanceType<typeof ChatComposerEditor> | null>(null);
  createApp({
    setup() {
      return () => h(ChatComposerEditor, { draftKey, ref: composerRef });
    },
  }).mount(host);
  await nextTick();
  await delay(0);
  return { host, composerRef };
}

describe("ChatComposerEditor 草稿持久化", () => {
  it("setPlainText 程序化填入后立即写入草稿（无需追加输入）", async () => {
    const draftKey = "test-set-plain-text";
    const { composerRef } = await mountComposer(draftKey);

    composerRef.value!.setPlainText("继续写后端：entity / mapper / service");
    // 落盘改为异步（IndexedDB）；测试环境无 indexedDB 会降级回 localStorage
    await delay(0);

    const html = readComposerDraftHtml(draftKey);
    expect(html).not.toBeNull();
    expect(html).toContain("继续写后端");
  });

  it("程序化填入后重挂载能恢复内容（模拟刷新）", async () => {
    const draftKey = "test-restore-after-remount";
    const first = await mountComposer(draftKey);
    first.composerRef.value!.setPlainText("先停在这里，我自己看看表结构");
    await delay(0);

    first.host.remove();

    const second = await mountComposer(draftKey);
    await delay(10);
    const editor = second.host.querySelector(".composer-editor") as HTMLElement;
    expect(editor.textContent ?? "").toContain("先停在这里");
  });
});
