// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  composerDraftMetaKey,
  composerDraftPreviewText,
  composerDraftStorageKey,
  extractDropContents,
  hasComposerDraft,
  inlineDropContents,
  persistComposerDraft,
  previewTextFromHtml,
  readComposerDraft,
  readComposerDraftHtml,
  removeComposerDraft,
} from "./composerDraftStorage";

/**
 * 草稿存储回归：
 * - 拖入文件全文（data-drop-content）必须从 HTML 中剥离，改存 IndexedDB；
 * - IndexedDB 不可用时（jsdom / 隐私模式）降级回 localStorage，且内容自包含；
 * - 旧格式（整块 HTML 存 localStorage）仍能被读取。
 */

function dropChipHtml(content: string): string {
  return `<span class="composer-chip composer-chip-drop" contenteditable="false" data-drop-path="/a/b.ts" data-drop-name="b.ts" data-drop-content="${content}">📄b.ts</span>`;
}

describe("composerDraftStorage · 拖入文件正文剥离", () => {
  it("extractDropContents 把正文换成 data-drop-ref 并返回映射", () => {
    const { html, contents } = extractDropContents(`<div>${dropChipHtml("const x = 1;")}</div>`);

    expect(html).not.toContain("data-drop-content");
    expect(html).toContain('data-drop-ref="drop-ref-0"');
    expect(contents).toEqual({ "drop-ref-0": "const x = 1;" });
  });

  it("多个拖入文件各自分配 ref", () => {
    const { html, contents } = extractDropContents(
      dropChipHtml("A") + dropChipHtml("B"),
    );
    expect(Object.values(contents)).toEqual(["A", "B"]);
    expect(html.match(/data-drop-ref="drop-ref-\d"/g)).toHaveLength(2);
  });

  it("inlineDropContents 语义可逆（内容以字符为准，不绑定具体实体写法）", () => {
    const original = `<div>${dropChipHtml("body &amp; &lt;tags&gt;")}</div>`;
    const { html, contents } = extractDropContents(original);
    expect(contents["drop-ref-0"]).toBe("body & <tags>");

    const back = inlineDropContents(html, contents);
    const div = document.createElement("div");
    div.innerHTML = back;
    expect(div.querySelector(".composer-chip-drop")!.getAttribute("data-drop-content")).toBe(
      "body & <tags>",
    );
    expect(back).not.toContain("data-drop-ref");
  });

  it("正文含引号 / & 时也能可逆（属性转义往返）", () => {
    const serialized = `<span class="composer-chip composer-chip-drop" data-drop-content="say &quot;hi&quot; &amp; bye">📄x</span>`;
    const { html, contents } = extractDropContents(serialized);
    expect(contents["drop-ref-0"]).toBe('say "hi" & bye');

    const back = inlineDropContents(html, contents);
    const span = document.createElement("span");
    span.innerHTML = back;
    expect(span.querySelector(".composer-chip-drop")!.getAttribute("data-drop-content")).toBe(
      'say "hi" & bye',
    );
  });

  it("没有拖入文件时原样返回", () => {
    const html = "<div>hello</div>";
    const { html: out, contents } = extractDropContents(html);
    expect(out).toBe(html);
    expect(contents).toEqual({});
  });
});

describe("composerDraftStorage · 摘要", () => {
  it("previewTextFromHtml 把图片折成 [图片] 并去标签", () => {
    const preview = previewTextFromHtml('<div>hi <img src="data:x"> there</div>');
    expect(preview).toBe("hi [图片] there");
  });

  it("纯图片草稿的摘要显示为 [图片]", () => {
    expect(previewTextFromHtml('<span class="composer-chip-image"><img></span>')).toBe("[图片]");
  });
});

describe("composerDraftStorage · 持久化与兼容（IDB 不可用 → localStorage 降级）", () => {
  const draftKey = "unit-draft";

  beforeEach(() => {
    localStorage.clear();
  });

  it("持久化后写标记键 + 降级 HTML 键；标记键体积不含大块内容", async () => {
    const bigContent = "x".repeat(50_000);
    const { html, contents } = extractDropContents(dropChipHtml(bigContent));
    const ok = await persistComposerDraft(draftKey, {
      html,
      preview: "拖了个文件",
      inlineDropContents: contents,
    });

    // jsdom 无 indexedDB → 走 localStorage 降级
    expect(ok).toBe(true);
    expect(localStorage.getItem(composerDraftMetaKey(draftKey))).toBe("拖了个文件");
    // 降级 HTML 必须自包含（正文已内联回来）
    const fallback = localStorage.getItem(composerDraftStorageKey(draftKey))!;
    expect(fallback).toContain(bigContent);
  });

  it("hasComposerDraft / previewText 读的是轻量标记", async () => {
    await persistComposerDraft(draftKey, { html: "<div>hi</div>", preview: "hi" });
    expect(hasComposerDraft(draftKey)).toBe(true);
    expect(composerDraftPreviewText(draftKey)).toBe("hi");
  });

  it("readComposerDraft 优先读 IndexedDB，缺失时回退 localStorage（旧格式）", async () => {
    // 旧格式：只有整块 HTML，没有标记键
    localStorage.setItem(composerDraftStorageKey(draftKey), "<div>legacy</div>");
    expect(hasComposerDraft(draftKey)).toBe(true);
    expect(composerDraftPreviewText(draftKey)).toBe("legacy");

    const stored = await readComposerDraft(draftKey);
    expect(stored?.html).toBe("<div>legacy</div>");
    expect(readComposerDraftHtml(draftKey)).toBe("<div>legacy</div>");
  });

  it("removeComposerDraft 清掉标记键与旧 HTML 键", async () => {
    await persistComposerDraft(draftKey, { html: "<div>hi</div>", preview: "hi" });
    await removeComposerDraft(draftKey);
    expect(hasComposerDraft(draftKey)).toBe(false);
    expect(localStorage.getItem(composerDraftMetaKey(draftKey))).toBeNull();
    expect(localStorage.getItem(composerDraftStorageKey(draftKey))).toBeNull();
  });
});
