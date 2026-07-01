import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWriteStage, executeTool } from "./agentToolExecutor";

describe("executeTool vision grep guard", () => {
  let tmpDir = "";

  afterEach(async () => {
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
      tmpDir = "";
    }
  });

  it("probes low-spread vision grep without ReferenceError", async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "agent-tool-"));
    const vuePath = path.join(tmpDir, "src", "components", "Panel.vue");
    await fs.promises.mkdir(path.dirname(vuePath), { recursive: true });
    await fs.promises.writeFile(
      vuePath,
      "<template>\n  <button>会话</button>\n  <button>项目</button>\n</template>\n",
      "utf-8",
    );

    const toolGuard = {
      readFileRanges: new Map(),
      visionMisreadActive: false,
      patchAnchorLocated: false,
      teleportBodyConfirmed: false,
      visionLocateActive: true,
      visionAnchorQuotes: ["会话", "项目"],
      visionNarrativeText: "截图显示会话和项目 Tab",
    };

    const result = await executeTool(
      tmpDir,
      "grep",
      { pattern: "会话" },
      createWriteStage(),
      "build",
      undefined,
      undefined,
      undefined,
      undefined,
      toolGuard,
    );

    expect(result).not.toMatch(/isVisionGrepLowSpread is not defined/i);
    expect(result).toMatch(/Panel\.vue:\d+:/);
  });
});
