import { describe, expect, it } from "vitest";
import {
  buildAbortExitSummary,
  buildIntrospectProbeBlockedMessage,
  buildStructuredAssetWriteNudge,
  countSchemaTablesInPayload,
  isEphemeralProbePath,
  isIntrospectBusinessRoutePatch,
  isProductiveDeliverableWrite,
  looksLikeStructuredSchemaPayload,
} from "../../shared/agentProbeGuard";

describe("agentProbeGuard", () => {
  it("detects ephemeral probe paths", () => {
    expect(isEphemeralProbePath("schema_result.json")).toBe(true);
    expect(isEphemeralProbePath(".aiall/probe/read_schema.py")).toBe(true);
    expect(isEphemeralProbePath("Models/Foo.cs")).toBe(false);
  });

  it("detects structured schema payloads", () => {
    const payload = JSON.stringify({
      tableCount: 2,
      schema: [{ tableName: "foo_base", columns: [{ COLUMN_NAME: "id" }] }],
    });
    expect(looksLikeStructuredSchemaPayload(payload)).toBe(true);
    expect(countSchemaTablesInPayload(payload)).toBe(2);
  });

  it("blocks introspect business route patches", () => {
    expect(
      isIntrospectBusinessRoutePatch(
        "Controllers/FooController.cs",
        "    }\n}",
        '    [HttpGet("schema-db1")]\n    public IActionResult GetSchema() {\n        var sql = "SELECT * FROM information_schema.TABLES";\n    }\n}',
      ),
    ).toBe(true);
    expect(
      isIntrospectBusinessRoutePatch(
        "src/utils/foo.ts",
        "export function a() {}",
        "export function b() {}",
      ),
    ).toBe(false);
  });

  it("builds structured asset write nudge", () => {
    expect(buildStructuredAssetWriteNudge(2)).toContain("2 个结构单元");
    expect(buildStructuredAssetWriteNudge(2)).toContain("write_file");
  });

  it("distinguishes deliverable writes from probe artifacts", () => {
    expect(isProductiveDeliverableWrite("write_file", "Models/Foo.cs")).toBe(true);
    expect(isProductiveDeliverableWrite("write_file", "schema_result.json")).toBe(false);
  });

  it("builds abort exit summary from tools", () => {
    const summary = buildAbortExitSummary({
      tools: [
        {
          name: "run_command",
          ok: true,
          summary: JSON.stringify({ tableCount: 2, schema: [{ tableName: "a" }, { tableName: "b" }] }),
        },
        {
          name: "write_file",
          ok: true,
          args: { path: "schema_result.json" },
        },
      ],
      writtenFiles: ["schema_result.json", "Controllers/FooController.cs"],
    });
    expect(summary).toContain("运行中断摘要");
    expect(summary).toContain("2 个表");
    expect(summary).toContain("实体");
    expect(summary).toContain("schema_result.json");
  });

  it("blocked message mentions probe directory", () => {
    expect(buildIntrospectProbeBlockedMessage()).toContain(".aiall/probe/");
  });
});
