// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from "vitest";
import { createApp, h, nextTick } from "vue";

vi.mock("dompurify", () => ({
  default: { sanitize: (html: string) => html, addHook: vi.fn() },
}));

import AgentTraceDrawer from "./AgentTraceDrawer.vue";
import {
  __resetAgentTraceDrawerForTest,
  closeTraceDrawer,
  openTraceDrawer,
  setTraceGroupResolver,
  setTraceMessageExistsResolver,
  setTraceToolsResolver,
  setTraceRunningResolver,
  loadTraceScrollSnapshot,
} from "../services/agentTraceDrawer";
import type { AgentRoundGroup } from "../services/agentRoundGroups";

function groups(): AgentRoundGroup[] {
  return [
    {
      turn: 1,
      modelSteps: [],
      toolIds: [],
      reasoning: "思考".repeat(50),
      request: {
        contextMessages: 1,
        contextChars: 10,
        messages: [{ role: "system", content: "系统提示词" }],
      },
      response: { assistantText: "回复", toolCalls: [], hasToolCalls: false, isFinal: true },
    },
  ];
}

function mountDrawer() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp({ render: () => h(AgentTraceDrawer) });
  app.mount(host);
  return { host, app };
}

/** jsdom 里 scrollHeight/clientHeight 恒为 0，手动给个可滚动的几何。 */
function primeScrollable(el: HTMLElement, scrollHeight = 1000, clientHeight = 400) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => clientHeight });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("轨迹抽屉滚动位置跨重开保留", () => {
  beforeEach(() => {
    __resetAgentTraceDrawerForTest();
    setTraceGroupResolver(() => groups());
    setTraceToolsResolver(() => []);
    setTraceMessageExistsResolver(() => true);
    setTraceRunningResolver(() => false);
  });

  it("用户滚到半空后关闭重开，不停在底部而是恢复位置", async () => {
    const { app, host } = mountDrawer();
    openTraceDrawer("msg-1", [], undefined, "sess-1");
    await nextTick();
    await delay(30);

    const body = host.querySelector(".agent-trace-drawer-body") as HTMLElement;
    expect(body).not.toBeNull();
    primeScrollable(body);

    // 用户滚到 250（非底部，阈值 24 → 1000-250-400=350 > 24）
    body.scrollTop = 250;
    body.dispatchEvent(new Event("scroll"));
    await nextTick();
    expect(loadTraceScrollSnapshot("msg-1")?.follow).toBe(false);
    expect(loadTraceScrollSnapshot("msg-1")?.top).toBe(250);

    // 关闭 → 重开
    closeTraceDrawer();
    await nextTick();
    openTraceDrawer("msg-1", [], undefined, "sess-1");
    await nextTick();
    // 立即给新 body 注入可滚几何（恢复逻辑在 0/60/200ms 多次重试）
    const body2 = host.querySelector(".agent-trace-drawer-body") as HTMLElement;
    primeScrollable(body2);
    await delay(260);

    // 恢复逻辑写回 250；没有被「强制拉到底」覆盖
    expect(body2.scrollTop).toBe(250);
    app.unmount();
  });

  it("首次打开（无存档）落到底部", async () => {
    const { app, host } = mountDrawer();
    openTraceDrawer("msg-new", [], undefined, "sess-1");
    await nextTick();
    const body = host.querySelector(".agent-trace-drawer-body") as HTMLElement;
    primeScrollable(body);
    await delay(30);
    // 触发内容增长跟随
    groups().push({
      turn: 2,
      modelSteps: [],
      toolIds: [],
      response: { assistantText: "x", toolCalls: [], hasToolCalls: false, isFinal: true },
    });
    await delay(60);
    // 跟随态：落到底（代码写 scrollTop = scrollHeight；jsdom 不夹取，故等于 1000）
    expect(body.scrollTop).toBe(1000);
    app.unmount();
  });
});
