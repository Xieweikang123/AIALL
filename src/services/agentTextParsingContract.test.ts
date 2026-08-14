import path from "node:path";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MODEL_TEXT_PARSING_SITES,
  findModelTextParsingSymbols,
  scanUnregisteredModelTextParsing,
} from "./agentTextParsingContract";

describe("agentTextParsingContract", () => {
  const repoRoot = path.resolve(import.meta.dirname, "../..");

  it("manifest entries all exist", () => {
    const missing = MODEL_TEXT_PARSING_SITES.filter((site) => !fs.existsSync(path.join(repoRoot, site.relPath)));
    expect(missing.map((site) => site.relPath)).toEqual([]);
  });

  it("every model/assistant text parsing site is registered in the contract manifest", () => {
    const violations = scanUnregisteredModelTextParsing(repoRoot);
    if (violations.size > 0) {
      const detail = [...violations.entries()]
        .map(([file, symbols]) => `${file}: ${symbols.join(", ")}`)
        .join("\n");
      expect.fail(
        `未登记的模型文本解析站点（请登记到 MODEL_TEXT_PARSING_SITES 并说明合规方式）：\n${detail}`,
      );
    }
    expect(violations.size).toBe(0);
  });

  it("sniffs model-text parsing functions but not deterministic format parsers", () => {
    expect(findModelTextParsingSymbols("export function parseAiOptions(text) {}", "ts")).toEqual([
      "parseAiOptions",
    ]);
    expect(
      findModelTextParsingSymbols("export function parseMemoryProposalToolResult(r) {}", "ts"),
    ).toEqual(["parseMemoryProposalToolResult"]);
    expect(findModelTextParsingSymbols("function parseGitStatusPorcelain(stdout) {}", "ts")).toEqual([]);
    expect(findModelTextParsingSymbols("fn extract_complete_ai_batch_groups(x) {}", "rs")).toEqual([
      "extract_complete_ai_batch_groups",
    ]);
    expect(findModelTextParsingSymbols("fn parse_git_status_porcelain(x) {}", "rs")).toEqual([]);
  });
});
