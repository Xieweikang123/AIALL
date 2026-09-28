import { describe, expect, it } from "vitest";
import {
  AGENT_TRACE_BODY_LENGTHS,
  AGENT_TRACE_ENTRY_KINDS,
  AGENT_TRACE_KIND_UI,
  AGENT_TRACE_VIEW_PRESETS,
  DEFAULT_AGENT_TRACE_VIEW,
  applyAgentTraceViewPreset,
  collapseTracePreview,
  createDefaultAgentTraceView,
  normalizeAgentTraceView,
  prepareTraceReasoningMarkdown,
  resolveAgentTraceBodySpec,
  shouldExpandTraceKind,
  truncateTraceDetail,
  withTraceBodyLength,
  withTraceExpand,
  withTraceTransientPhases,
  withTraceAutoMaximize,
  type AgentTraceViewConfig,
} from "./agentTraceView";

function view(overrides: Partial<AgentTraceViewConfig> = {}): AgentTraceViewConfig {
  return { ...createDefaultAgentTraceView(), ...overrides };
}

describe("agentTraceView 默认配置", () => {
  it("默认只展开思考过程，其余折叠（= 旧「标准」档，升级后默认体验不变）", () => {
    expect(shouldExpandTraceKind("reasoning")).toBe(true);
    for (const kind of ["request", "response", "tool", "phase"] as const) {
      expect(shouldExpandTraceKind(kind)).toBe(false);
    }
    expect(DEFAULT_AGENT_TRACE_VIEW.bodyLength).toBe("long");
    expect(DEFAULT_AGENT_TRACE_VIEW.transientPhases).toBe(false);
    // 默认不自动放大：升级后默认体验与旧版一致，放大要用户主动开
    expect(DEFAULT_AGENT_TRACE_VIEW.autoMaximize).toBe(false);
  });

  it("createDefaultAgentTraceView 每次给新对象（别把默认值交出去被改脏）", () => {
    const first = createDefaultAgentTraceView();
    first.expand.tool = true;
    first.bodyLength = "full";

    expect(createDefaultAgentTraceView().expand.tool).toBe(false);
    expect(createDefaultAgentTraceView().bodyLength).toBe("long");
  });
});

describe("agentTraceView 正交性（这是拆掉「详细度档位」的全部理由）", () => {
  it("单独打开工具，不牵动其它任何类型", () => {
    const base = view();
    const withTool = withTraceExpand(base, "tool", true);

    expect(shouldExpandTraceKind("tool", withTool)).toBe(true);
    // 关键：其余四类的展开态与开关前完全一致
    for (const kind of AGENT_TRACE_ENTRY_KINDS.filter((k) => k !== "tool")) {
      expect(shouldExpandTraceKind(kind, withTool)).toBe(shouldExpandTraceKind(kind, base));
    }
    // 正文截断档也不该被动
    expect(withTool.bodyLength).toBe(base.bodyLength);
    expect(withTool.transientPhases).toBe(base.transientPhases);
    expect(withTool.autoMaximize).toBe(base.autoMaximize);
  });

  it("单独关掉思考，不牵动工具（旧的链式档位做不到这件事）", () => {
    const base = withTraceExpand(view(), "tool", true);
    const closed = withTraceExpand(base, "reasoning", false);

    expect(shouldExpandTraceKind("reasoning", closed)).toBe(false);
    expect(shouldExpandTraceKind("tool", closed)).toBe(true);
  });

  it("任意类型组合都可达（旧档位只有 4 个固定组合）", () => {
    // 5 个类型 → 2^5 = 32 种展开组合，逐个构造并要求互不相同
    const seen = new Set<string>();
    for (let mask = 0; mask < 2 ** AGENT_TRACE_ENTRY_KINDS.length; mask += 1) {
      let next = createDefaultAgentTraceView();
      AGENT_TRACE_ENTRY_KINDS.forEach((kind, index) => {
        next = withTraceExpand(next, kind, (mask >> index & 1) === 1);
      });
      seen.add(JSON.stringify(next.expand));
    }

    expect(seen.size).toBe(2 ** AGENT_TRACE_ENTRY_KINDS.length);
  });

  it("改开关返回新对象，不改原配置", () => {
    const base = view();
    withTraceExpand(base, "tool", true);
    withTraceBodyLength(base, "full");
    withTraceTransientPhases(base, true);
    withTraceAutoMaximize(base, true);

    expect(base).toEqual(createDefaultAgentTraceView());
  });

  it("思考放大开关只动 autoMaximize，不牵动展开 / 正文 / 瞬态阶段", () => {
    const base = withTraceExpand(view(), "tool", true);
    const on = withTraceAutoMaximize(base, true);

    expect(on.autoMaximize).toBe(true);
    expect(on.expand).toEqual(base.expand);
    expect(on.bodyLength).toBe(base.bodyLength);
    expect(on.transientPhases).toBe(base.transientPhases);
  });
});

describe("agentTraceView 快捷预设（= 旧四档，行为与数值都照搬）", () => {
  it("四个预设与旧档位语义一一对应", () => {
    const expanded = (id: "brief" | "standard" | "detailed" | "full") =>
      AGENT_TRACE_ENTRY_KINDS.filter((kind) => shouldExpandTraceKind(kind, applyAgentTraceViewPreset(id)));

    expect(expanded("brief")).toEqual([]);
    expect(expanded("standard")).toEqual(["reasoning"]);
    expect(expanded("detailed")).toEqual(["reasoning", "tool"]);
    expect(expanded("full")).toEqual([...AGENT_TRACE_ENTRY_KINDS]);
  });

  it("预设的正文长度 / 瞬态阶段与旧档位一致", () => {
    expect(applyAgentTraceViewPreset("brief").bodyLength).toBe("short");
    expect(applyAgentTraceViewPreset("brief").transientPhases).toBe(false);
    expect(applyAgentTraceViewPreset("standard").bodyLength).toBe("long");
    expect(applyAgentTraceViewPreset("detailed").transientPhases).toBe(true);
    expect(applyAgentTraceViewPreset("detailed").bodyLength).toBe("long");
    expect(applyAgentTraceViewPreset("full").bodyLength).toBe("full");
    expect(applyAgentTraceViewPreset("full").transientPhases).toBe(true);
    // 预设不碰「自动放大」—— 它不属于旧的详细度档位语义
    for (const id of ["brief", "standard", "detailed", "full"] as const) {
      expect(applyAgentTraceViewPreset(id).autoMaximize).toBe(false);
    }
  });

  it("每个预设 id 唯一且都有中文标签与说明", () => {
    const ids = AGENT_TRACE_VIEW_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of AGENT_TRACE_VIEW_PRESETS) {
      expect(preset.label).not.toBe("");
      expect(preset.hint).not.toBe("");
    }
  });
});

describe("agentTraceView 归一化（脏存档不能把面板搞坏）", () => {
  it("旧档位字符串映射到同名预设", () => {
    expect(normalizeAgentTraceView("standard")).toEqual(applyAgentTraceViewPreset("standard"));
    expect(normalizeAgentTraceView("detailed").expand.tool).toBe(true);
    expect(normalizeAgentTraceView("full").bodyLength).toBe("full");
  });

  it("旧存档形状 { detail: 'detailed' } 也认，不静默回落默认值", () => {
    const normalized = normalizeAgentTraceView({ detail: "detailed" });
    expect(normalized).toEqual(applyAgentTraceViewPreset("detailed"));
  });

  it("非法 / 空值一律回落到默认配置", () => {
    const fallback = createDefaultAgentTraceView();
    expect(normalizeAgentTraceView(undefined)).toEqual(fallback);
    expect(normalizeAgentTraceView(null)).toEqual(fallback);
    expect(normalizeAgentTraceView("nonsense")).toEqual(fallback);
    expect(normalizeAgentTraceView(42)).toEqual(fallback);
    expect(normalizeAgentTraceView({})).toEqual(fallback);
  });

  it("部分字段的对象补默认值，脏字段回落默认", () => {
    const partial = normalizeAgentTraceView({ expand: { tool: true } });
    expect(partial.expand.tool).toBe(true);
    // 缺失的字段回落该类型的默认值 —— 默认档里思考是展开的，
    // 残缺存档不能把思考折叠掉（表现为"打开面板看不到思考过程"）
    expect(partial.expand.reasoning).toBe(true);
    expect(partial.bodyLength).toBe("long");
    expect(partial.transientPhases).toBe(false);

    // 显式的脏值（"yes"/1）按"关"处理，而不是把默认的 true 也一起吃掉
    const dirtyFlag = normalizeAgentTraceView({ expand: { tool: "yes" as never } });
    expect(dirtyFlag.expand.tool).toBe(false);
    expect(dirtyFlag.expand.reasoning).toBe(true);

    const dirty = normalizeAgentTraceView({
      expand: { tool: "yes" as never },
      bodyLength: "huge" as never,
      transientPhases: 1 as never,
    });
    expect(dirty).toEqual(createDefaultAgentTraceView());
  });

  it("归一化返回的对象不被默认值共享（改它不会污染后续调用）", () => {
    const first = normalizeAgentTraceView("standard");
    first.expand.request = true;

    expect(normalizeAgentTraceView("standard").expand.request).toBe(false);
    expect(DEFAULT_AGENT_TRACE_VIEW.expand.request).toBe(false);
  });
});

describe("agentTraceView 正文截断与预览", () => {
  it("短档截断并标注原始长度", () => {
    const text = "x".repeat(1000);
    const short = truncateTraceDetail(text, view({ bodyLength: "short" }));
    expect(short.length).toBeLessThan(1000);
    expect(short).toContain("已截断");
    expect(short).toContain("共 1000 字符");
  });

  it("不截断档原样返回", () => {
    const text = "y".repeat(120_000);
    const full = truncateTraceDetail(text, view({ bodyLength: "full" }));
    expect(full.length).toBe(120_000);
    expect(full).not.toContain("已截断");
  });

  it("短文本在任何档位都不加截断标记", () => {
    for (const bodyLength of AGENT_TRACE_BODY_LENGTHS) {
      expect(truncateTraceDetail("短内容", view({ bodyLength }))).toBe("短内容");
    }
  });

  it("截断前先 trim，避免正文首尾空白撑长度", () => {
    expect(truncateTraceDetail("  内容  ", view())).toBe("内容");
  });

  it("折叠行预览按正文档取长度，并压平换行", () => {
    const text = `第一行\n第二行 ${"x".repeat(200)}`;
    const short = collapseTracePreview(text, view({ bodyLength: "short" }));
    expect(short).not.toContain("\n");
    expect(short.length).toBeLessThanOrEqual(60);

    const full = collapseTracePreview(text, view({ bodyLength: "full" }));
    expect(full.length).toBeLessThanOrEqual(160);
    expect(full.length).toBeGreaterThan(short.length);
  });

  it("非法正文档回落到默认档（面板不会拿到 undefined 的截断参数）", () => {
    expect(resolveAgentTraceBodySpec("huge").maxDetailChars).toBe(20_000);
    expect(resolveAgentTraceBodySpec(undefined).label).toBe("长");
  });
});

describe("prepareTraceReasoningMarkdown", () => {
  it("无截断标记时原样返回（完整思考交给 ChatMarkdown 的流式兜底）", () => {
    const text = "先看目录\n\n```ts\nconst x = 1;";
    expect(prepareTraceReasoningMarkdown(text)).toBe(text);
  });

  it("去掉截断提示 —— 它对 Markdown 是噪音", () => {
    const detail = truncateTraceDetail("普通思考".repeat(200), view({ bodyLength: "short" }));
    expect(detail).toContain("已截断");
    const out = prepareTraceReasoningMarkdown(detail);
    expect(out).not.toContain("已截断");
    expect(out).not.toContain("字符）");
  });

  it("截断点落在代码围栏内时补上结束围栏（否则整块被吞成代码块）", () => {
    // 构造：截断位置切在未闭合围栏内部
    const text = `说明文字\n\n\`\`\`ts\nconst a = 1;\n${"x".repeat(500)}`;
    const detail = truncateTraceDetail(text, view({ bodyLength: "short" }));
    expect((detail.match(/^```/gm) ?? []).length % 2).toBe(1);

    const out = prepareTraceReasoningMarkdown(detail);
    expect((out.match(/^```/gm) ?? []).length % 2).toBe(0);
    expect(out.endsWith("```")).toBe(true);
  });

  it("截断点落在围栏外时不补围栏（成对围栏原样保留）", () => {
    const text = `\`\`\`ts\nconst a = 1;\n\`\`\`\n\n${"x".repeat(500)}`;
    const detail = truncateTraceDetail(text, view({ bodyLength: "short" }));
    expect((detail.match(/^```/gm) ?? []).length % 2).toBe(0);

    const out = prepareTraceReasoningMarkdown(detail);
    expect(out).not.toContain("已截断");
    expect((out.match(/^```/gm) ?? []).length % 2).toBe(0);
    expect(out.endsWith("```")).toBe(false);
  });

  it("纯截断提示 / 空文本返回空串（不渲染空块）", () => {
    expect(prepareTraceReasoningMarkdown("")).toBe("");
    expect(prepareTraceReasoningMarkdown("…（已截断，共 5 字符）")).toBe("");
  });
});

describe("agentTraceView UI 元数据", () => {
  it("每种类型都有单字标签，配置 chip 与条目行共用同一份（别各写一遍会漂）", () => {
    expect(AGENT_TRACE_ENTRY_KINDS.map((kind) => AGENT_TRACE_KIND_UI[kind].label)).toEqual([
      "思",
      "具",
      "发",
      "回",
      "态",
    ]);
    for (const kind of AGENT_TRACE_ENTRY_KINDS) {
      expect(AGENT_TRACE_KIND_UI[kind].title).not.toBe("");
      expect(AGENT_TRACE_KIND_UI[kind].chipTitle).not.toBe("");
    }
  });
});
