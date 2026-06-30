import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  PLAN_DOCUMENTS_DIR,
  PLAN_FILE_REL_PATH,
  buildPlanDocumentRelPath,
  buildPlanFileDocument,
  stripPlanFilePreamble,
  extractPlanContentFromStoredMessage,
  assistantMessageHoldsPlanDocument,
  messageQualifiesForPlanPanel,
  qualifiesPlanPanelSync,
  canForceOpenPlanPanel,
  isPlanClarificationOnly,
  isPlanInlineChatAnswer,
  shouldUsePlanExternalView,
  ensurePlanFileBeforeExecution,
  resolvePlanDocumentRelPath,
} from "./planFile";

vi.mock("./vibeCodingClient", () => ({
  writeFile: vi.fn(),
  readFile: vi.fn(),
}));

import { writeFile, readFile } from "./vibeCodingClient";

const SAMPLE_PLAN = [
  "[PLAN]",
  "",
  "## 修改方案",
  "",
  "将改 `src/foo.ts`：",
  "",
  "```ts",
  "export const x = 1;",
  "```",
].join("\n");

const MSG_ID = "1700000000000-abc123";
const PLAN_PATH = buildPlanDocumentRelPath(MSG_ID);

describe("planFile", () => {
  it("uses per-message paths under .aiall/plans/", () => {
    expect(PLAN_FILE_REL_PATH).toBe(".aiall/PLAN.md");
    expect(PLAN_PATH).toBe(`${PLAN_DOCUMENTS_DIR}/${MSG_ID}.md`);
    expect(resolvePlanDocumentRelPath(MSG_ID)).toBe(PLAN_PATH);
  });

  it("wraps plan body with agent-plan-file preamble", () => {
    const doc = buildPlanFileDocument(SAMPLE_PLAN);
    expect(doc).toContain("<!-- agent-plan-file");
    expect(doc).toContain("## 修改方案");
    expect(stripPlanFilePreamble(doc)).toBe(SAMPLE_PLAN);
  });

  it("stripPlanFilePreamble leaves plain markdown unchanged", () => {
    expect(stripPlanFilePreamble(SAMPLE_PLAN)).toBe(SAMPLE_PLAN);
  });

  it("extractPlanContentFromStoredMessage prefers final roundGroups text", () => {
    const content = extractPlanContentFromStoredMessage(
      {
        id: MSG_ID,
        chatMode: "plan",
        content: "",
        planFilePath: PLAN_PATH,
        roundGroups: [
          {
            turn: 4,
            modelSteps: [],
            toolIds: [],
            response: { assistantText: SAMPLE_PLAN, hasToolCalls: false, isFinal: true, toolCalls: [] },
          },
        ],
      },
      "",
    );
    expect(content).toContain("[PLAN]");
    expect(messageQualifiesForPlanPanel(content, { chatMode: "plan", planFilePath: PLAN_PATH })).toBe(true);
  });

  it("qualifiesPlanPanelSync accepts in-flight plan text", () => {
    expect(
      qualifiesPlanPanelSync("## 修改方案\n", { chatMode: "plan", planFilePath: undefined }, true),
    ).toBe(true);
    expect(
      qualifiesPlanPanelSync("请确认 foo 是指哪种系统？", { chatMode: "plan", planFilePath: undefined }, true),
    ).toBe(false);
  });

  it("canForceOpenPlanPanel rejects clarification-only answers", () => {
    expect(canForceOpenPlanPanel("请确认 foo 是指哪种系统？", { chatMode: "plan" })).toBe(false);
    expect(canForceOpenPlanPanel("", { chatMode: "plan" })).toBe(false);
  });

  it("keeps clarification in chat instead of plan panel", () => {
    const clarification =
      "请确认 foo 是指外部系统还是可视化前端？\n\n1. 外部业务系统\n2. 三维可视化\n3. 其他（请说明）";
    expect(isPlanClarificationOnly(clarification)).toBe(true);
    expect(messageQualifiesForPlanPanel(clarification, { chatMode: "plan", planFilePath: undefined })).toBe(false);
    expect(qualifiesPlanPanelSync(clarification, { chatMode: "plan", planFilePath: undefined }, false)).toBe(false);
    expect(shouldUsePlanExternalView(clarification, { chatMode: "plan", planFilePath: undefined })).toBe(false);
  });

  it("renders informational plan Q&A inline in chat", () => {
    const answer = "日志通过 Serilog 写入 `logs/app-.log`，级别由 appsettings 的 Logging 节配置。";
    expect(isPlanInlineChatAnswer(answer, { chatMode: "plan", planFilePath: undefined })).toBe(true);
    expect(shouldUsePlanExternalView(answer, { chatMode: "plan", planFilePath: undefined })).toBe(false);
    expect(messageQualifiesForPlanPanel(answer, { chatMode: "plan", planFilePath: undefined })).toBe(false);
    expect(assistantMessageHoldsPlanDocument(answer, { chatMode: "plan", planFilePath: undefined })).toBe(false);
    expect(canForceOpenPlanPanel(answer, { chatMode: "plan", planFilePath: undefined })).toBe(false);
  });

  it("keeps plan panel on prior plan when follow-up is quoted plan Q&A", () => {
    const answer = [
      "会的。当前方案中的 `ExecuteAsync` 会先执行 `SyncDataAsync()`，再 `Task.Delay`。",
      "启动时会立即同步一次，之后按间隔执行。",
      "启动 -> SyncDataAsync() -> Task.Delay(30分钟) -> ...",
    ].join("\n");
    expect(isPlanInlineChatAnswer(answer, { chatMode: "plan", planFilePath: undefined })).toBe(true);
    expect(assistantMessageHoldsPlanDocument(answer, { chatMode: "plan", planFilePath: undefined })).toBe(false);
    expect(qualifiesPlanPanelSync(answer, { chatMode: "plan", planFilePath: undefined }, false)).toBe(false);
    expect(assistantMessageHoldsPlanDocument(SAMPLE_PLAN, { chatMode: "plan", planFilePath: PLAN_PATH })).toBe(true);
  });

  it("still uses external view for structured plan documents", () => {
    expect(shouldUsePlanExternalView(SAMPLE_PLAN, { chatMode: "plan", planFilePath: undefined })).toBe(true);
  });

  describe("ensurePlanFileBeforeExecution", () => {
    beforeEach(() => {
      vi.mocked(writeFile).mockReset();
      vi.mocked(readFile).mockReset();
    });

    it("persists missing plan file before resolving execution content", async () => {
      vi.mocked(writeFile).mockResolvedValue({ ok: true });
      vi.mocked(readFile)
        .mockResolvedValueOnce({ ok: false, error: "文件不存在" })
        .mockResolvedValueOnce({
          ok: true,
          content: buildPlanFileDocument(SAMPLE_PLAN),
        });

      const result = await ensurePlanFileBeforeExecution("/proj", SAMPLE_PLAN, MSG_ID);

      expect(writeFile).toHaveBeenCalledWith(PLAN_PATH, expect.any(String), "/proj");
      expect(result.planFilePath).toBe(PLAN_PATH);
      expect(result.planContent).toContain("## 修改方案");
      expect(result.persistError).toBeUndefined();
    });

    it("skips write when plan file exists and prefers disk content", async () => {
      vi.mocked(readFile).mockResolvedValue({
        ok: true,
        content: buildPlanFileDocument(`${SAMPLE_PLAN}\n\n（用户已编辑）`),
      });

      const result = await ensurePlanFileBeforeExecution(
        "/proj",
        SAMPLE_PLAN,
        MSG_ID,
        PLAN_PATH,
      );

      expect(writeFile).not.toHaveBeenCalled();
      expect(result.planFilePath).toBe(PLAN_PATH);
      expect(result.planContent).toContain("用户已编辑");
    });

    it("uses distinct paths for distinct message ids", async () => {
      const otherPath = buildPlanDocumentRelPath("1700000000001-def456");
      expect(otherPath).not.toBe(PLAN_PATH);
      vi.mocked(readFile).mockResolvedValue({
        ok: true,
        content: buildPlanFileDocument("## 修改方案\n\nplan B"),
      });

      const result = await ensurePlanFileBeforeExecution(
        "/proj",
        SAMPLE_PLAN,
        "1700000000001-def456",
        otherPath,
      );

      expect(result.planFilePath).toBe(otherPath);
      expect(result.planContent).toContain("plan B");
    });

    it("returns persistError and falls back to bubble text when write fails", async () => {
      vi.mocked(readFile).mockResolvedValue({ ok: false, error: "文件不存在" });
      vi.mocked(writeFile).mockResolvedValue({ ok: false, error: "权限不足" });

      const result = await ensurePlanFileBeforeExecution("/proj", SAMPLE_PLAN, MSG_ID);

      expect(result.persistError).toBe("权限不足");
      expect(result.planContent).toBe(SAMPLE_PLAN);
      expect(result.planFilePath).toBe(PLAN_PATH);
    });

    it("re-persists when planFilePath is set but disk file is missing", async () => {
      vi.mocked(readFile)
        .mockResolvedValueOnce({ ok: false, error: "文件不存在" })
        .mockResolvedValueOnce({
          ok: true,
          content: buildPlanFileDocument(SAMPLE_PLAN),
        });
      vi.mocked(writeFile).mockResolvedValue({ ok: true });

      const result = await ensurePlanFileBeforeExecution(
        "/proj",
        SAMPLE_PLAN,
        MSG_ID,
        PLAN_PATH,
      );

      expect(writeFile).toHaveBeenCalledWith(PLAN_PATH, expect.any(String), "/proj");
      expect(result.planFilePath).toBe(PLAN_PATH);
      expect(result.planContent).toContain("## 修改方案");
    });
  });
});
