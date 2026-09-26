import { describe, expect, it } from "vitest";
import {
  AGENT_TRACE_DETAIL_LEVELS,
  DEFAULT_AGENT_TRACE_DETAIL,
  collapseTracePreview,
  normalizeAgentTraceDetail,
  resolveAgentTraceDetailSpec,
  shouldExpandTraceKind,
  truncateTraceDetail,
} from "./agentTraceDetail";

describe("agentTraceDetail", () => {
  it("默认档位是标准档，且是合法档位之一", () => {
    expect(AGENT_TRACE_DETAIL_LEVELS).toContain(DEFAULT_AGENT_TRACE_DETAIL);
    expect(DEFAULT_AGENT_TRACE_DETAIL).toBe("standard");
  });

  it("未知/非法档位回落到标准档（旧存档脏值不清空面板）", () => {
    expect(normalizeAgentTraceDetail("nonsense")).toBe("standard");
    expect(normalizeAgentTraceDetail(undefined)).toBe("standard");
    expect(normalizeAgentTraceDetail(null)).toBe("standard");
    expect(normalizeAgentTraceDetail("brief")).toBe("brief");
    expect(normalizeAgentTraceDetail("full")).toBe("full");
  });

  it("标准档起思考默认展开（这是「实时看思考过程」的落点）", () => {
    expect(shouldExpandTraceKind("reasoning", "brief")).toBe(false);
    expect(shouldExpandTraceKind("reasoning", "standard")).toBe(true);
    expect(shouldExpandTraceKind("reasoning", "detailed")).toBe(true);
    expect(shouldExpandTraceKind("reasoning", "full")).toBe(true);
  });

  it("展开程度逐档递增：简略全折叠 → 标准思考 → 详细+工具 → 全量全部", () => {
    const expandedKinds = (level: (typeof AGENT_TRACE_DETAIL_LEVELS)[number]) =>
      ["request", "response", "reasoning", "tool", "phase"].filter((kind) =>
        shouldExpandTraceKind(kind as never, level),
      );

    expect(expandedKinds("brief")).toEqual([]);
    expect(expandedKinds("standard")).toEqual(["reasoning"]);
    expect(expandedKinds("detailed")).toEqual(["reasoning", "tool"]);
    expect(expandedKinds("full")).toEqual(["request", "response", "reasoning", "tool", "phase"]);

    // 单调递增：高档位展开的类型集合必须是低档位的超集
    for (let i = 1; i < AGENT_TRACE_DETAIL_LEVELS.length; i += 1) {
      const prev = new Set(expandedKinds(AGENT_TRACE_DETAIL_LEVELS[i - 1]));
      const cur = expandedKinds(AGENT_TRACE_DETAIL_LEVELS[i]);
      for (const kind of prev) {
        expect(cur, `${kind} 在低档展开了却在高档没有`).toContain(kind);
      }
      expect(cur.length, "高档位展开的类型不应少于低档位").toBeGreaterThanOrEqual(prev.size);
    }
  });

  it("只有详细档与全量档保留瞬态 loop 阶段", () => {
    expect(resolveAgentTraceDetailSpec("brief").transientPhases).toBe(false);
    expect(resolveAgentTraceDetailSpec("standard").transientPhases).toBe(false);
    expect(resolveAgentTraceDetailSpec("detailed").transientPhases).toBe(true);
    expect(resolveAgentTraceDetailSpec("full").transientPhases).toBe(true);
  });

  it("按档位截断正文，并标注原始长度", () => {
    const text = "x".repeat(1000);
    const brief = truncateTraceDetail(text, "brief");
    expect(brief.length).toBeLessThan(1000);
    expect(brief).toContain("已截断");
    expect(brief).toContain("共 1000 字符");
  });

  it("全量档不截断", () => {
    const text = "y".repeat(120_000);
    const full = truncateTraceDetail(text, "full");
    expect(full.length).toBe(120_000);
    expect(full).not.toContain("已截断");
  });

  it("短文本在任何档位都不加截断标记", () => {
    for (const level of AGENT_TRACE_DETAIL_LEVELS) {
      expect(truncateTraceDetail("短内容", level)).toBe("短内容");
    }
  });

  it("截断前先 trim，避免正文首尾空白撑长度", () => {
    expect(truncateTraceDetail("  内容  ", "standard")).toBe("内容");
  });

  it("折叠行预览按档位取长度，并压平换行", () => {
    const text = `第一行\n第二行 ${"x".repeat(200)}`;
    const brief = collapseTracePreview(text, "brief");
    expect(brief).not.toContain("\n");
    expect(brief.length).toBeLessThanOrEqual(60);

    const full = collapseTracePreview(text, "full");
    expect(full.length).toBeLessThanOrEqual(160);
    expect(full.length).toBeGreaterThan(brief.length);
  });
});
